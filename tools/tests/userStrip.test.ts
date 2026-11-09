/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// While the dashboard is open, Discord's own user section stands in the server list
// as Limelight's strip. Kaylum, 9 Nov 2026: it came out window-wide, because
// CollapsibleUI pins the same section with left: 0; right: 0; width: auto, all
// !important, from a selector three attributes strong (four while hovered), and the
// strip's rules were only two. They are now four attributes and two elements strong.
const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const PREFIX = 'body[data-vc-glance-open] :is([class^="sidebar_"], [class*=" sidebar_"]) > section[data-vc-glance-panels]:is([class^="panels_"], [class*=" panels_"]):not(#vc-glance-strip-guard)';

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1].trim(), body: m[2] }));
const stripRules = rules.filter(r => r.selector.includes("data-vc-glance-panels"));

test("every rule on Discord's user section carries the strong prefix", () => {
    assert.ok(stripRules.length > 5);
    for (const r of stripRules) {
        for (const part of r.selector.split(/,\s*(?=body)/)) assert.ok(part.trim().startsWith(PREFIX), part);
    }
});

test("the section is fixed, 56px wide and centred in the server list", () => {
    const section = stripRules.find(r => r.selector === PREFIX);
    assert.ok(section);
    assert.match(section.body, /position:\s*fixed\s*!important/);
    assert.match(section.body, /(?:^|[;\s])width:\s*56px\s*!important/);
    assert.match(section.body, /max-width:\s*56px\s*!important/);
    // CollapsibleUI sets a 264px min-width while hovered, and a min-width beats a max-width
    assert.match(section.body, /min-width:\s*56px\s*!important/);
    assert.match(section.body, /inset:\s*auto auto 8px calc\(\(var\(--custom-guild-list-width, 72px\) - 56px\) \/ 2\)\s*!important/);
});

test("Discord's section is laid out, never hidden, and the hand-drawn strip is gone", () => {
    for (const r of stripRules) {
        if (r.selector === PREFIX) assert.equal(/visibility:\s*hidden/.test(r.body), false);
    }
    assert.equal(css.includes(".vc-glance-rail-"), false);
});
