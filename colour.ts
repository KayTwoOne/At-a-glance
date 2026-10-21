/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Colour maths. Pure: no imports, so tools/tests covers it. Ported from Limelight's plugin/logic/colour.ts.

export interface Rgb { r: number; g: number; b: number; }

const HEX6 = /^#?([0-9a-fA-F]{6})$/;
const HEX3 = /^#?([0-9a-fA-F]{3})$/;

export function normaliseHex(input: unknown): string | null {
    if (typeof input !== "string") return null;
    const trimmed = input.trim();
    const six = HEX6.exec(trimmed);
    if (six) return "#" + six[1].toLowerCase();
    const three = HEX3.exec(trimmed);
    if (three) {
        const s = three[1].toLowerCase();
        return "#" + s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    }
    return null;
}

export function hexToRgb(hex: string): Rgb {
    const n = normaliseHex(hex) ?? "#000000";
    return {
        r: parseInt(n.slice(1, 3), 16),
        g: parseInt(n.slice(3, 5), 16),
        b: parseInt(n.slice(5, 7), 16)
    };
}

function channel(n: number): string {
    const value = Number.isFinite(n) ? Math.round(n) : 0;
    return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}

export function rgbToHex(r: number, g: number, b: number): string {
    return "#" + channel(r) + channel(g) + channel(b);
}

function linear(c: number): number {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
    const { r, g, b } = hexToRgb(hex);
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(a: string, b: string): number {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const hi = Math.max(la, lb);
    const lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
}

export function mixHex(a: string, b: string, t: number): string {
    const k = Math.max(0, Math.min(1, t));
    const x = hexToRgb(a);
    const y = hexToRgb(b);
    return rgbToHex(x.r + (y.r - x.r) * k, x.g + (y.g - x.g) * k, x.b + (y.b - x.b) * k);
}

// Steps towards white in twentieths until the ratio is met. Integer steps
// avoid the floating point drift a 0.05 accumulator would pick up. With
// `notDarker`, a candidate must also be at least as light as that colour, so a
// colour that passes by being darker than the surface keeps lightening.
export function lightenToContrast(hex: string, against: string, minRatio: number, notDarker?: string): string {
    const floor = notDarker ? relativeLuminance(notDarker) : 0;
    for (let i = 0; i <= 20; i++) {
        const candidate = mixHex(hex, "#ffffff", i / 20);
        if (contrastRatio(candidate, against) >= minRatio && relativeLuminance(candidate) >= floor) return candidate;
    }
    return "#ffffff";
}

// Above this luminance, black contrasts more than white does: (L + 0.05) / 0.05
// passes 1.05 / (L + 0.05) at about 0.179.
export const LIGHT_SURFACE_LUMINANCE = 0.18;

export function isLightSurface(hex: string): boolean {
    return relativeLuminance(hex) > LIGHT_SURFACE_LUMINANCE;
}

// Looks for a colour on the line from `hex` to white and the line from `hex` to
// black, in twentieths, trying the preferred end first at each step. It searches
// both ways because one direction can be a dead end: against two surfaces either
// side of mid-grey, or where a label constraint rules out the band just past
// the target, only the other direction passes. If nothing passes it returns the
// best-scoring candidate, so the caller degrades gracefully rather than
// snapping back towards the surface. Earlier candidates win ties.
export function searchContrast(hex: string, preferLighter: boolean, passes: (c: string) => boolean, score: (c: string) => number): string {
    const start = normaliseHex(hex) ?? hex;
    if (passes(start)) return start;
    const ends = preferLighter ? ["#ffffff", "#000000"] : ["#000000", "#ffffff"];
    let best = start;
    let bestScore = score(start);
    for (let i = 1; i <= 20; i++) {
        for (const end of ends) {
            const candidate = mixHex(start, end, i / 20);
            if (passes(candidate)) return candidate;
            const candidateScore = score(candidate);
            if (candidateScore > bestScore) {
                best = candidate;
                bestScore = candidateScore;
            }
        }
    }
    return best;
}

const RGB_FN = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d+(?:\.\d+)?)(%)?)?\s*\)$/i;

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

// One component of a modern colour function: a number, a percentage where
// `percentScale` says what 100% means (null refuses percentages), an optional
// unit suffix, or the keyword `none`, which is 0.
function component(token: string, percentScale: number | null, unit = ""): number | null {
    let text = token.toLowerCase();
    if (text === "none") return 0;
    let scale = 1;
    if (text.endsWith("%")) {
        if (percentScale === null) return null;
        text = text.slice(0, -1);
        scale = percentScale;
    } else if (unit && text.endsWith(unit)) {
        text = text.slice(0, -unit.length);
    }
    if (!NUMBER.test(text)) return null;
    const n = Number(text) * scale;
    return Number.isFinite(n) ? n : null;
}

function encodeSrgb(c: number): number {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(1, v)) * 255;
}

// OKLab to sRGB with Bjorn Ottosson's published matrices.
function oklabToHex(L: number, a: number, b: number): string {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return rgbToHex(
        encodeSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        encodeSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        encodeSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    );
}

const MODERN_FN = /^(oklab|oklch|color)\(\s*([^()]*?)\s*\)$/i;

function parseModern(trimmed: string): { hex: string; alpha: number; } | null {
    const m = MODERN_FN.exec(trimmed);
    if (!m) return null;
    const parts = m[2].split("/");
    if (parts.length > 2) return null;
    let alpha = 1;
    if (parts.length === 2) {
        const parsed = component(parts[1].trim(), 0.01);
        if (parsed === null) return null;
        alpha = Math.max(0, Math.min(1, parsed));
    }
    const tokens = parts[0].trim().split(/\s+/);
    const fn = m[1].toLowerCase();
    if (fn === "color") {
        if (tokens.length !== 4 || tokens[0].toLowerCase() !== "srgb") return null;
        const channels = tokens.slice(1).map(t => component(t, 0.01));
        if (channels.includes(null)) return null;
        const [r, g, b] = channels as number[];
        // color(srgb) channels are already gamma encoded
        return { hex: rgbToHex(Math.max(0, Math.min(1, r)) * 255, Math.max(0, Math.min(1, g)) * 255, Math.max(0, Math.min(1, b)) * 255), alpha };
    }
    if (tokens.length !== 3) return null;
    const L = component(tokens[0], 0.01);
    if (L === null) return null;
    if (fn === "oklab") {
        const a = component(tokens[1], null);
        const b = component(tokens[2], null);
        return a === null || b === null ? null : { hex: oklabToHex(L, a, b), alpha };
    }
    const chroma = component(tokens[1], null);
    const hue = component(tokens[2], null, "deg");
    if (chroma === null || hue === null) return null;
    const radians = hue * Math.PI / 180;
    return { hex: oklabToHex(L, chroma * Math.cos(radians), chroma * Math.sin(radians)), alpha };
}

/**
 * Parses a CSS colour string. It accepts exactly: hex (3 or 6 digits, with or
 * without #); rgb() and rgba(), comma or space separated, with an optional
 * alpha as a number or percentage; oklab(L a b) and oklch(L C h), the forms
 * Chromium returns for color-mix() values, with L as a number 0..1 or a
 * percentage and h in degrees; and color(srgb r g b) with channels as numbers
 * 0..1 or percentages. The three modern forms take an optional "/ alpha" and
 * accept the keyword none, which is 0. Out-of-gamut colours clamp to sRGB.
 * Anything else, including named colours and other colour spaces, is null.
 */
export function parseCssColour(value: string): { hex: string; alpha: number; } | null {
    const trimmed = value.trim();
    const hex = normaliseHex(trimmed);
    if (hex) return { hex, alpha: 1 };
    const m = RGB_FN.exec(trimmed);
    if (!m) return parseModern(trimmed);
    let alpha = m[4] === undefined ? 1 : Number(m[4]);
    if (m[5]) alpha /= 100;
    return { hex: rgbToHex(Number(m[1]), Number(m[2]), Number(m[3])), alpha: Math.max(0, Math.min(1, alpha)) };
}
