/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";

import { WeatherLocation } from "./data";
import { settings } from "./settings";

const logger = new Logger("AtAGlance");

// Open-Meteo: keyless, free, no account or personal data involved.
// These are the ONLY hosts this plugin ever talks to, and only when the user
// has explicitly configured a weather location.
const GEOCODE_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";

const FETCH_TIMEOUT_MS = 10_000;
const MIN_REFRESH_MINUTES = 5;
const DEFAULT_REFRESH_MINUTES = 10;

// Floored here, not just in the settings UI - this is the actual gate against
// hammering Open-Meteo, regardless of how a stale or hand-edited value got in.
function cacheTtlMs(): number {
    const configured = settings.store.weatherRefreshMinutes;
    const minutes = typeof configured === "number" && Number.isFinite(configured)
        ? configured
        : DEFAULT_REFRESH_MINUTES;
    return Math.max(MIN_REFRESH_MINUTES, minutes) * 60 * 1000;
}

export interface WeatherNow {
    temperatureC: number;
    windKmh: number;
    isDay: boolean;
    condition: string;
    fetchedAt: number;
}

// WMO weather interpretation codes → human label
const WMO_CONDITIONS: Array<[codes: number[], label: string]> = [
    [[0], "Clear sky"],
    [[1], "Mostly clear"],
    [[2], "Partly cloudy"],
    [[3], "Overcast"],
    [[45, 48], "Fog"],
    [[51, 53, 55, 56, 57], "Drizzle"],
    [[61, 63, 65, 66, 67], "Rain"],
    [[71, 73, 75, 77], "Snow"],
    [[80, 81, 82], "Rain showers"],
    [[85, 86], "Snow showers"],
    [[95], "Thunderstorm"],
    [[96, 99], "Thunderstorm with hail"]
];

function conditionFromCode(code: unknown): string {
    if (typeof code !== "number") return "Unknown";
    return WMO_CONDITIONS.find(([codes]) => codes.includes(code))?.[1] ?? "Unknown";
}

// A compact emoji per WMO band, for the forecast strip
export function emojiFromCode(code: unknown, isDay = true): string {
    if (typeof code !== "number") return "❓";
    if (code === 0) return isDay ? "☀️" : "🌙";
    if (code <= 2) return isDay ? "🌤️" : "☁️";
    if (code === 3) return "☁️";
    if (code <= 48) return "🌫️";
    if (code <= 57) return "🌦️";
    if (code <= 67) return "🌧️";
    if (code <= 77) return "🌨️";
    if (code <= 82) return "🌧️";
    if (code <= 86) return "🌨️";
    return "⛈️";
}

async function fetchJson(url: string): Promise<unknown> {
    // Belt-and-braces: never fetch anywhere but the two fixed endpoints
    if (!url.startsWith(GEOCODE_ENDPOINT) && !url.startsWith(FORECAST_ENDPOINT)) {
        throw new Error("Refusing to fetch non-allowlisted URL");
    }

    const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        // Plain anonymous request: no cookies or credentials of any kind
        credentials: "omit",
        referrerPolicy: "no-referrer"
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

/**
 * Searches for locations matching the user's query.
 * Returns at most 5 validated results, or [] on any failure.
 */
export async function searchLocations(query: string): Promise<WeatherLocation[]> {
    const trimmed = query.trim().slice(0, 64);
    if (trimmed.length < 2) return [];

    try {
        const url = `${GEOCODE_ENDPOINT}?name=${encodeURIComponent(trimmed)}&count=5&format=json`;
        const data = await fetchJson(url) as { results?: unknown; };
        if (!Array.isArray(data.results)) return [];

        const out: WeatherLocation[] = [];
        for (const raw of data.results.slice(0, 5)) {
            if (typeof raw !== "object" || raw === null) continue;
            const { name, admin1, country, latitude, longitude } = raw as Record<string, unknown>;

            if (typeof name !== "string" || name.length === 0) continue;
            if (typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 90) continue;
            if (typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180) continue;

            const region = typeof admin1 === "string" && admin1 ? admin1
                : typeof country === "string" && country ? country : "";
            const label = region ? `${name}, ${region}` : name;

            out.push({ name: label.slice(0, 80), lat: latitude, lon: longitude });
        }
        return out;
    } catch (e) {
        logger.error("Location search failed", e);
        return [];
    }
}

const weatherCache = new Map<string, WeatherNow>();

/**
 * Fetches current weather for a validated location. Results are cached for
 * the user's configured refresh interval (weatherRefreshMinutes, floor 5
 * minutes) so repeatedly opening the dashboard doesn't hammer the API.
 */
export async function fetchWeather(location: WeatherLocation): Promise<WeatherNow | null> {
    const lat = Math.max(-90, Math.min(90, location.lat));
    const lon = Math.max(-180, Math.min(180, location.lon));
    const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;

    const cached = weatherCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < cacheTtlMs()) return cached;

    try {
        const url = `${FORECAST_ENDPOINT}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
            + "&current=temperature_2m,weather_code,wind_speed_10m,is_day";
        const data = await fetchJson(url) as { current?: Record<string, unknown>; };

        const { current } = data;
        if (typeof current !== "object" || current === null) return null;

        const temperature = current.temperature_2m;
        const wind = current.wind_speed_10m;
        if (typeof temperature !== "number" || !Number.isFinite(temperature)) return null;

        const result: WeatherNow = {
            temperatureC: temperature,
            windKmh: typeof wind === "number" && Number.isFinite(wind) ? wind : 0,
            isDay: current.is_day === 1,
            condition: conditionFromCode(current.weather_code),
            fetchedAt: Date.now()
        };
        weatherCache.set(cacheKey, result);
        return result;
    } catch (e) {
        logger.error("Weather fetch failed", e);
        return null;
    }
}

export function celsiusToFahrenheit(c: number) {
    return c * 9 / 5 + 32;
}

export interface ForecastDay {
    /** ISO date, e.g. "2026-07-10" */
    date: string;
    minC: number;
    maxC: number;
    code: number;
}

const forecastCache = new Map<string, { days: ForecastDay[]; fetchedAt: number; }>();

/**
 * Fetches a short daily forecast (today + next few days) for a validated
 * location. Same allowlisted endpoint and caching discipline as fetchWeather.
 */
export async function fetchForecast(location: WeatherLocation): Promise<ForecastDay[] | null> {
    const lat = Math.max(-90, Math.min(90, location.lat));
    const lon = Math.max(-180, Math.min(180, location.lon));
    const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;

    const cached = forecastCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < cacheTtlMs()) return cached.days;

    try {
        const url = `${FORECAST_ENDPOINT}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
            + "&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=5&timezone=auto";
        const data = await fetchJson(url) as { daily?: Record<string, unknown>; };

        const { daily } = data;
        if (typeof daily !== "object" || daily === null) return null;

        const dates = daily.time;
        const maxes = daily.temperature_2m_max;
        const mins = daily.temperature_2m_min;
        const codes = daily.weather_code;
        if (!Array.isArray(dates) || !Array.isArray(maxes) || !Array.isArray(mins) || !Array.isArray(codes)) {
            return null;
        }

        const days: ForecastDay[] = [];
        for (let i = 0; i < Math.min(5, dates.length); i++) {
            const date = dates[i];
            const maxC = maxes[i];
            const minC = mins[i];
            const code = codes[i];
            if (typeof date !== "string") continue;
            if (typeof maxC !== "number" || typeof minC !== "number") continue;
            days.push({
                date,
                maxC,
                minC,
                code: typeof code === "number" ? code : 0
            });
        }

        forecastCache.set(cacheKey, { days, fetchedAt: Date.now() });
        return days;
    } catch (e) {
        logger.error("Forecast fetch failed", e);
        return null;
    }
}
