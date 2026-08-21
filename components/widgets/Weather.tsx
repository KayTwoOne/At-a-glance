/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { moment, React } from "@webpack/common";

import { setWeatherLocation, useGlanceConfig, WeatherLocation } from "../../data";
import { settings } from "../../settings";
import {
    celsiusToFahrenheit,
    emojiFromCode,
    fetchForecast,
    fetchWeather,
    ForecastDay,
    searchLocations,
    WeatherNow
} from "../../weather";
import { useNow } from "../hooks";
import { WidgetCard } from "../WidgetCard";

export function WeatherCard() {
    const { weatherLocation } = useGlanceConfig();
    const { temperatureUnit } = settings.use(["temperatureUnit"]);

    const [query, setQuery] = React.useState("");
    const [results, setResults] = React.useState<WeatherLocation[]>([]);
    const [searching, setSearching] = React.useState(false);
    const [weather, setWeather] = React.useState<WeatherNow | null>(null);
    const [forecast, setForecast] = React.useState<ForecastDay[] | null>(null);
    const [failed, setFailed] = React.useState(false);

    // Ticks once a minute purely to keep the "Updated X ago" line current -
    // a relative label doesn't need a per-second timer to stay honest.
    useNow(60_000);

    React.useEffect(() => {
        setWeather(null);
        setForecast(null);
        setFailed(false);
        if (!weatherLocation) return;

        let cancelled = false;
        fetchWeather(weatherLocation).then(result => {
            if (cancelled) return;
            setWeather(result);
            setFailed(result === null);
        });
        fetchForecast(weatherLocation).then(days => {
            if (!cancelled) setForecast(days);
        });
        return () => { cancelled = true; };
    }, [weatherLocation?.lat, weatherLocation?.lon]);

    const runSearch = async () => {
        if (searching || query.trim().length < 2) return;
        setSearching(true);
        const found = await searchLocations(query);
        setResults(found);
        setSearching(false);
    };

    if (!weatherLocation) {
        return (
            <>
                <div className="vc-glance-weather-search">
                    <input
                        className="vc-glance-input"
                        type="text"
                        maxLength={64}
                        placeholder="Search a city…"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") runSearch(); }}
                    />
                    <button className="vc-glance-button vc-glance-button-brand" disabled={searching} onClick={runSearch}>
                        {searching ? "…" : "Search"}
                    </button>
                </div>
                {results.length > 0 && (
                    <div className="vc-glance-weather-results">
                        {results.map(loc => (
                            <button
                                key={`${loc.lat},${loc.lon}`}
                                className="vc-glance-weather-result"
                                onClick={() => {
                                    setWeatherLocation(loc);
                                    setResults([]);
                                    setQuery("");
                                }}
                            >
                                {loc.name}
                            </button>
                        ))}
                    </div>
                )}
                <span className="vc-glance-hint">
                    Weather data comes from Open-Meteo, fetched only after you pick a location.
                </span>
            </>
        );
    }

    const temp = weather === null ? null
        : temperatureUnit === "f"
            ? `${Math.round(celsiusToFahrenheit(weather.temperatureC))}°F`
            : `${Math.round(weather.temperatureC)}°C`;

    return (
        <>
            <button className="vc-glance-link-button" onClick={() => setWeatherLocation(null)}>
                Change location
            </button>
            {weather === null
                ? <span className="vc-glance-hint">{failed ? "Couldn't load weather right now." : "Loading…"}</span>
                : (
                    <>
                        <div className="vc-glance-weather-now">
                            <span className="vc-glance-weather-emoji" aria-hidden>{weather.isDay ? "☀️" : "🌙"}</span>
                            <div className="vc-glance-row-text">
                                <span className="vc-glance-row-title">
                                    <span className="vc-glance-weather-location">{weatherLocation.name}</span>: {temp}
                                </span>
                                <span className="vc-glance-row-subtitle">
                                    {weather.condition} • wind {Math.round(weather.windKmh)} km/h
                                </span>
                            </div>
                        </div>
                        {forecast && forecast.length > 1 && (
                            <div className="vc-glance-forecast">
                                {forecast.slice(1).map(day => {
                                    const label = new Date(day.date).toLocaleDateString(void 0, { weekday: "short" });
                                    const hi = temperatureUnit === "f" ? Math.round(celsiusToFahrenheit(day.maxC)) : Math.round(day.maxC);
                                    const lo = temperatureUnit === "f" ? Math.round(celsiusToFahrenheit(day.minC)) : Math.round(day.minC);
                                    return (
                                        <div key={day.date} className="vc-glance-forecast-day">
                                            <span className="vc-glance-forecast-label">{label}</span>
                                            <span className="vc-glance-forecast-emoji" aria-hidden>{emojiFromCode(day.code)}</span>
                                            <span className="vc-glance-forecast-temp">
                                                <span className="vc-glance-forecast-hi">{hi}°</span>
                                                <span className="vc-glance-forecast-lo">{lo}°</span>
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        <span className="vc-glance-hint vc-glance-weather-updated">
                            Updated {moment(weather.fetchedAt).fromNow()}
                        </span>
                    </>
                )
            }
        </>
    );
}

export function WeatherWidget() {
    return (
        <WidgetCard id="weather">
            <WeatherCard />
        </WidgetCard>
    );
}
