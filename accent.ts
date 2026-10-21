/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// One accent, contrast-checked. Primary stays the dominant tint; Accent drives
// every interactive highlight, corrected until it passes WCAG against the
// surfaces it actually sits on. Pure: imports only colour.ts.

import { contrastRatio, LIGHT_SURFACE_LUMINANCE, relativeLuminance, searchContrast } from "./colour";

export const TEXT_LIGHT = "#dbdee1";
export const TEXT_DARK = "#17181b";
export const ON_ACCENT_LIGHT = "#ffffff";
export const ON_ACCENT_DARK = "#111214";

export type TextTone = "light" | "dark";

/** Whichever text survives the worst of these background stops. A tie keeps light, the dashboard's default. */
export function pickTextTone(stops: string[]): TextTone {
    const worst = (text: string) => Math.min(...stops.map(s => contrastRatio(text, s)));
    return worst(TEXT_DARK) > worst(TEXT_LIGHT) ? "dark" : "light";
}

export interface AccentTokens {
    /** Fills, outlines, progress, toggles: 3:1 against every surface (WCAG 1.4.11) */
    accentUi: string;
    /** Text on an accentUi fill: 4.5:1 against it */
    onAccent: string;
    /** Links and accent-coloured text: 4.5:1 against every surface */
    accentText: string;
    /** The greeting name's gradient stops: 3:1, since it is large text */
    nameFrom: string;
    nameTo: string;
}

function worstRatio(hex: string, surfaces: string[]): number {
    return Math.min(...surfaces.map(s => contrastRatio(hex, s)));
}

// Move the colour away from the surfaces: lighter on a dark backdrop, darker on a light one.
function preferLighter(surfaces: string[]): boolean {
    const mean = surfaces.reduce((sum, s) => sum + relativeLuminance(s), 0) / surfaces.length;
    return mean <= LIGHT_SURFACE_LUMINANCE;
}

// One colour that clears minRatio against every surface at once. Fixing one
// surface at a time can undo another (the two ends of a gradient), so each
// candidate is judged on its worst surface. If 4.5:1 is out of reach, as when
// the ends straddle mid-grey, the best worst-case colour is kept.
function passAll(hex: string, surfaces: string[], minRatio: number): string {
    return searchContrast(hex, preferLighter(surfaces), c => worstRatio(c, surfaces) >= minRatio, c => worstRatio(c, surfaces));
}

function labelRatio(fill: string): number {
    return Math.max(contrastRatio(ON_ACCENT_LIGHT, fill), contrastRatio(ON_ACCENT_DARK, fill));
}

function bestLabel(fill: string): string {
    return contrastRatio(ON_ACCENT_LIGHT, fill) >= contrastRatio(ON_ACCENT_DARK, fill) ? ON_ACCENT_LIGHT : ON_ACCENT_DARK;
}

export function deriveAccentTokens(input: { accent: string; primary: string; nameColor: string | null; surfaces: string[]; }): AccentTokens {
    const { surfaces } = input;
    // Mid-tones exist where neither label reaches 4.5:1, so the fill is searched
    // for 3:1 on the surfaces and 4.5:1 for its label together.
    const accentUi = searchContrast(
        input.accent,
        preferLighter(surfaces),
        c => worstRatio(c, surfaces) >= 3 && labelRatio(c) >= 4.5,
        c => Math.min(worstRatio(c, surfaces) / 3, labelRatio(c) / 4.5)
    );
    const [from, to] = input.nameColor ? [input.nameColor, input.nameColor] : [input.primary, input.accent];
    return {
        accentUi,
        onAccent: bestLabel(accentUi),
        accentText: passAll(input.accent, surfaces, 4.5),
        nameFrom: passAll(from, surfaces, 3),
        nameTo: passAll(to, surfaces, 3)
    };
}
