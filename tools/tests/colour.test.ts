/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    contrastRatio, hexToRgb, isLightSurface, lightenToContrast, mixHex,
    normaliseHex, parseCssColour, relativeLuminance, rgbToHex, searchContrast
} from "../../colour";

test("normaliseHex accepts six and three digit hex, with or without #, any case", () => {
    assert.equal(normaliseHex("#AABBCC"), "#aabbcc");
    assert.equal(normaliseHex("aabbcc"), "#aabbcc");
    assert.equal(normaliseHex("abc"), "#aabbcc");
    assert.equal(normaliseHex("  #0e4d49  "), "#0e4d49");
});

test("normaliseHex rejects everything else without throwing", () => {
    for (const bad of ["red", "", "#12345", "#gggggg", "#1234567", 123, null, undefined, {}, []]) {
        assert.equal(normaliseHex(bad), null, String(bad));
    }
});

test("hex and rgb convert both ways, clamping and rounding channels", () => {
    assert.deepEqual(hexToRgb("#23a55a"), { r: 35, g: 165, b: 90 });
    assert.equal(rgbToHex(300, -5, 12.6), "#ff000d");
    assert.equal(rgbToHex(Number.NaN, 0, 0), "#000000");
});

test("relativeLuminance runs from 0 for black to 1 for white", () => {
    assert.equal(relativeLuminance("#000000"), 0);
    assert.ok(Math.abs(relativeLuminance("#ffffff") - 1) < 1e-9);
    assert.ok(relativeLuminance("#23a55a") > relativeLuminance("#0e4d49"));
});

test("contrastRatio matches WCAG reference values", () => {
    assert.ok(Math.abs(contrastRatio("#ffffff", "#000000") - 21) < 0.01);
    assert.equal(contrastRatio("#2b2d31", "#2b2d31"), 1);
});

test("mixHex blends in sRGB and clamps t", () => {
    assert.equal(mixHex("#000000", "#ffffff", 0.5), "#808080");
    assert.equal(mixHex("#000000", "#ffffff", 5), "#ffffff");
    assert.equal(mixHex("#000000", "#ffffff", -1), "#000000");
});

test("lightenToContrast reaches the target, and leaves colours that already pass alone", () => {
    const surface = "#1e1f22";
    const lifted = lightenToContrast("#0e4d49", surface, 3);
    assert.ok(contrastRatio(lifted, surface) >= 3);
    assert.equal(lightenToContrast("#d8f35a", surface, 3), "#d8f35a");
});

test("isLightSurface splits where black and white contrast equally", () => {
    assert.equal(isLightSurface("#ffffff"), true);
    assert.equal(isLightSurface("#efe4e8"), true);
    assert.equal(isLightSurface("#1d1418"), false);
    assert.equal(isLightSurface("#5865f2"), false);
});

test("searchContrast returns the colour itself when it already passes", () => {
    assert.equal(searchContrast("#00a8fc", true, c => contrastRatio(c, "#232428") >= 3, c => contrastRatio(c, "#232428")), "#00a8fc");
});

test("searchContrast tries the preferred end first, then the other, at each step", () => {
    const seen: string[] = [];
    searchContrast("#808080", true, c => { seen.push(c); return false; }, () => 0);
    assert.deepEqual(seen.slice(0, 5), ["#808080", mixHex("#808080", "#ffffff", 0.05), mixHex("#808080", "#000000", 0.05), mixHex("#808080", "#ffffff", 0.1), mixHex("#808080", "#000000", 0.1)]);
    assert.equal(seen.length, 41);
    seen.length = 0;
    searchContrast("#808080", false, c => { seen.push(c); return false; }, () => 0);
    assert.deepEqual(seen.slice(0, 3), ["#808080", mixHex("#808080", "#000000", 0.05), mixHex("#808080", "#ffffff", 0.05)]);
});

test("searchContrast finds a pass in the other direction when the preferred one cannot", () => {
    // Against mid-grey a light colour needs to be near white; prefer lighter but only black-ward passes here
    const out = searchContrast("#777777", true, c => contrastRatio(c, "#ffffff") >= 7, c => contrastRatio(c, "#ffffff"));
    assert.ok(contrastRatio(out, "#ffffff") >= 7);
    assert.ok(relativeLuminance(out) < relativeLuminance("#777777"));
});

test("searchContrast returns the highest score when nothing passes, earlier candidates winning ties", () => {
    const against = ["#77787b", "#232528"];
    const worst = (c: string) => Math.min(...against.map(s => contrastRatio(c, s)));
    const seen: string[] = [];
    const out = searchContrast("#cccccc", true, c => { seen.push(c); return false; }, worst);
    const expected = seen.reduce((best, c) => (worst(c) > worst(best) ? c : best));
    assert.equal(out, expected);
    assert.ok(worst(out) > worst("#cccccc"));
    assert.equal(searchContrast("#123456", true, () => false, () => 1), "#123456");
});

test("4.5:1 is always reachable, whatever the surface", () => {
    for (const surface of ["#000000", "#2e2e2e", "#777777", "#8a8a8a", "#b0b0b0", "#ffffff", "#5865f2", "#00a8fc"]) {
        const passes = (c: string) => contrastRatio(c, surface) >= 4.5;
        const out = searchContrast(surface, !isLightSurface(surface), passes, c => contrastRatio(c, surface));
        assert.ok(passes(out), surface);
    }
});

test("parseCssColour reads the forms getComputedStyle returns", () => {
    assert.deepEqual(parseCssColour("rgb(29, 20, 24)"), { hex: "#1d1418", alpha: 1 });
    assert.deepEqual(parseCssColour("rgba(29, 20, 24, 0.5)"), { hex: "#1d1418", alpha: 0.5 });
    assert.deepEqual(parseCssColour("rgb(29 20 24 / 50%)"), { hex: "#1d1418", alpha: 0.5 });
    assert.deepEqual(parseCssColour("#1D1418"), { hex: "#1d1418", alpha: 1 });
    assert.equal(parseCssColour("transparent"), null);
});

// Compares each channel of a hex colour with another, within a tolerance.
function nearHex(actual: string | undefined, expected: string, tolerance = 2): boolean {
    if (!actual) return false;
    const a = hexToRgb(actual);
    const e = hexToRgb(expected);
    return Math.abs(a.r - e.r) <= tolerance && Math.abs(a.g - e.g) <= tolerance && Math.abs(a.b - e.b) <= tolerance;
}

test("parseCssColour reads the oklab colours Discord's color-mix variables resolve to", () => {
    const text = parseCssColour("oklab(0.897479 -0.000516713 -0.00580448)");
    assert.ok(nearHex(text?.hex, "#dbdee1"), String(text?.hex));
    assert.equal(text?.alpha, 1);
    const surface = parseCssColour("oklab(0.261892 0.00204925 -0.00715911)");
    assert.ok(nearHex(surface?.hex, "#242428"), String(surface?.hex));
    assert.equal(surface?.alpha, 1);
});

test("parseCssColour reads an oklab alpha as a number or a percentage, and a lightness percentage", () => {
    assert.equal(parseCssColour("oklab(0.5 0 0 / 50%)")?.alpha, 0.5);
    assert.equal(parseCssColour("oklab(0.5 0 0 / 0.25)")?.alpha, 0.25);
    assert.equal(parseCssColour("oklab(0.5 0 0 / none)")?.alpha, 0);
    assert.equal(parseCssColour("oklab(50% 0 0)")?.hex, parseCssColour("oklab(0.5 0 0)")?.hex);
});

test("parseCssColour treats the none keyword as zero", () => {
    assert.deepEqual(parseCssColour("oklab(none 0 0)"), { hex: "#000000", alpha: 1 });
    assert.deepEqual(parseCssColour("oklab(0.5 none none)"), parseCssColour("oklab(0.5 0 0)"));
});

test("parseCssColour reads oklch, with or without a deg suffix", () => {
    const red = parseCssColour("oklch(0.627955 0.257683 29.2339)");
    assert.ok(nearHex(red?.hex, "#ff0000"), String(red?.hex));
    assert.equal(red?.alpha, 1);
    assert.equal(parseCssColour("oklch(0.627955 0.257683 29.2339deg)")?.hex, red?.hex);
    assert.equal(parseCssColour("oklch(0.5 0.1 120 / 40%)")?.alpha, 0.4);
});

test("parseCssColour reads color(srgb), with numbers or percentages", () => {
    assert.deepEqual(parseCssColour("color(srgb 1 0 0)"), { hex: "#ff0000", alpha: 1 });
    assert.deepEqual(parseCssColour("color(srgb 100% 0% 0%)"), { hex: "#ff0000", alpha: 1 });
    assert.deepEqual(parseCssColour("color(srgb 0.2 0.4 0.6 / 0.5)"), { hex: "#336699", alpha: 0.5 });
});

test("parseCssColour rejects malformed colour functions and unsupported colour spaces", () => {
    for (const bad of ["oklab(0.5 0)", "oklab(0.5 0 0 0)", "oklab(0.5 0 0 / 1 / 1)", "oklab(red 0 0)", "oklab()", "color(display-p3 1 0 0)", "color(srgb 1 0)", "oklch(0.5 0.1)", "oklab(0.5, 0, 0)"]) {
        assert.equal(parseCssColour(bad), null, bad);
    }
});
