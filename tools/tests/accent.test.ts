/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveAccentTokens, ON_ACCENT_DARK, ON_ACCENT_LIGHT, pickTextTone } from "../../accent";
import { contrastRatio } from "../../colour";

test("the default cyan keeps its colour and gets a dark label", () => {
    const t = deriveAccentTokens({ accent: "#00a8fc", primary: "#5865f2", nameColor: null, surfaces: ["#232428"] });
    assert.equal(t.accentUi, "#00a8fc");
    assert.equal(t.onAccent, ON_ACCENT_DARK);
    assert.ok(contrastRatio(t.onAccent, t.accentUi) >= 4.5);
    assert.equal(t.accentText, "#00a8fc");
});

test("blurple keeps a white label", () => {
    const t = deriveAccentTokens({ accent: "#5865f2", primary: "#5865f2", nameColor: null, surfaces: ["#1d1418"] });
    assert.equal(t.onAccent, ON_ACCENT_LIGHT);
    assert.ok(contrastRatio(t.onAccent, t.accentUi) >= 4.5);
});

test("an accent identical to the surface is pushed until it passes", () => {
    const t = deriveAccentTokens({ accent: "#1d1418", primary: "#1d1418", nameColor: null, surfaces: ["#1d1418"] });
    assert.ok(contrastRatio(t.accentUi, "#1d1418") >= 3);
    assert.ok(contrastRatio(t.accentText, "#1d1418") >= 4.5);
    assert.ok(contrastRatio(t.onAccent, t.accentUi) >= 4.5);
});

test("on a light surface the accent is darkened, not lightened", () => {
    const t = deriveAccentTokens({ accent: "#f06aa8", primary: "#d33699", nameColor: null, surfaces: ["#efe4e8"] });
    assert.ok(contrastRatio(t.accentUi, "#efe4e8") >= 3);
    assert.ok(contrastRatio(t.accentText, "#efe4e8") >= 4.5);
    assert.ok(contrastRatio(t.onAccent, t.accentUi) >= 4.5);
});

test("every token passes against every surface of a gradient", () => {
    const surfaces = ["#2a2230", "#1d1a24"];
    const t = deriveAccentTokens({ accent: "#3b2f4a", primary: "#6a3f8f", nameColor: null, surfaces });
    for (const s of surfaces) {
        assert.ok(contrastRatio(t.accentUi, s) >= 3, s);
        assert.ok(contrastRatio(t.accentText, s) >= 4.5, s);
        assert.ok(contrastRatio(t.nameFrom, s) >= 3, s);
        assert.ok(contrastRatio(t.nameTo, s) >= 3, s);
    }
});

test("a custom name colour drives both stops and is corrected to 3:1", () => {
    const t = deriveAccentTokens({ accent: "#00a8fc", primary: "#5865f2", nameColor: "#2a1a20", surfaces: ["#140c0f"] });
    assert.equal(t.nameFrom, t.nameTo);
    assert.ok(contrastRatio(t.nameFrom, "#140c0f") >= 3);
});

test("pickTextTone takes whichever text survives the worst stop", () => {
    // 3.0.0 averaged these to luminance 0.521, under its 0.55 cut-off, and kept light text at 1.16:1
    assert.equal(pickTextTone(["#f4ecef", "#d33699"]), "dark");
    assert.equal(pickTextTone(["#171717"]), "light");
    assert.equal(pickTextTone(["#5865f2", "#00a8fc"]), "dark");
    assert.equal(pickTextTone(["#0b0809", "#3a0f18"]), "light");
});

const worst = (hex: string, surfaces: string[]) => Math.min(...surfaces.map(s => contrastRatio(hex, s)));

test("#0066ff on a Discord dark surface keeps 3:1 and a 4.5:1 label", () => {
    const surfaces = ["#2b2d31"];
    const t = deriveAccentTokens({ accent: "#0066ff", primary: "#0066ff", nameColor: null, surfaces });
    assert.ok(worst(t.accentUi, surfaces) >= 3, `accentUi ${t.accentUi} at ${worst(t.accentUi, surfaces)}`);
    assert.ok(contrastRatio(t.onAccent, t.accentUi) >= 4.5, `label ${t.onAccent} on ${t.accentUi}`);
});

test("light-theme accents keep 3:1 against both tinted ends", () => {
    const surfaces = ["#e2e2e2", "#edf8f8"];
    for (const accent of ["#009999", "#33cc00", "#ff9900"]) {
        const t = deriveAccentTokens({ accent, primary: accent, nameColor: null, surfaces });
        assert.ok(worst(t.accentUi, surfaces) >= 3, `${accent}: accentUi ${t.accentUi} at ${worst(t.accentUi, surfaces)}`);
        assert.ok(contrastRatio(t.onAccent, t.accentUi) >= 4.5, `${accent}: label ${t.onAccent} on ${t.accentUi}`);
    }
});

test("tokens pass when the tinted ends straddle the midpoint", () => {
    const surfaces = ["#77787b", "#232528"];
    const t = deriveAccentTokens({ accent: "#00a8fc", primary: "#cccccc", nameColor: null, surfaces });
    assert.ok(worst(t.accentUi, surfaces) >= 3, `accentUi ${t.accentUi} at ${worst(t.accentUi, surfaces)}`);
    assert.ok(worst(t.nameFrom, surfaces) >= 3, `nameFrom ${t.nameFrom} at ${worst(t.nameFrom, surfaces)}`);
    assert.ok(worst(t.nameTo, surfaces) >= 3, `nameTo ${t.nameTo} at ${worst(t.nameTo, surfaces)}`);
    assert.ok(contrastRatio(t.onAccent, t.accentUi) >= 4.5, `label ${t.onAccent} on ${t.accentUi}`);
});

test("when 4.5:1 is unreachable, accentText is the best worst-case", () => {
    const surfaces = ["#77787b", "#232528"];
    const t = deriveAccentTokens({ accent: "#00a8fc", primary: "#cccccc", nameColor: null, surfaces });
    assert.ok(worst(t.accentText, surfaces) >= 4.4, `accentText ${t.accentText} at ${worst(t.accentText, surfaces)}`);
});

const SWEEP_ACCENTS = [
    "#000000", "#ffffff", "#0066ff", "#00a8fc", "#5865f2", "#f06aa8",
    "#009999", "#33cc00", "#ff9900", "#8a8a8a", "#1d1418", "#ffd000"
];
// No single colour reaches 4.5:1 against both of these (grey peaks at 4.41:1)
const STRADDLE = ["#77787b", "#232528"];
const SWEEP_SURFACES = [
    ["#2b2d31"],
    ["#1e1f22", "#313338"],
    ["#ffffff"],
    ["#e2e2e2", "#edf8f8"],
    STRADDLE
];

for (const surfaces of SWEEP_SURFACES) {
    test(`every accent passes its ratios on ${surfaces.join(" and ")}`, () => {
        for (const accent of SWEEP_ACCENTS) {
            const t = deriveAccentTokens({ accent, primary: accent, nameColor: null, surfaces });
            const at = `${accent} on ${surfaces.join(",")}`;
            assert.ok(worst(t.accentUi, surfaces) >= 3, `${at}: accentUi ${t.accentUi} at ${worst(t.accentUi, surfaces)}`);
            assert.ok(contrastRatio(t.onAccent, t.accentUi) >= 4.5, `${at}: label ${t.onAccent} on ${t.accentUi}`);
            assert.ok(worst(t.nameFrom, surfaces) >= 3, `${at}: nameFrom ${t.nameFrom} at ${worst(t.nameFrom, surfaces)}`);
            assert.ok(worst(t.nameTo, surfaces) >= 3, `${at}: nameTo ${t.nameTo} at ${worst(t.nameTo, surfaces)}`);
            if (surfaces !== STRADDLE) {
                assert.ok(worst(t.accentText, surfaces) >= 4.5, `${at}: accentText ${t.accentText} at ${worst(t.accentText, surfaces)}`);
            }
        }
    });
}
