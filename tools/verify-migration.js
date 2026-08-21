/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Asserts the widget registry's sanitizers and split-widget migration.
//
// Why this exists: widgetOrder, hiddenWidgets and collapsedWidgets are saved
// user layout. A wrong migration silently reshuffles someone's dashboard, and
// none of the four build gates can see it. widgetRegistry.ts is import-free
// precisely so this script can load it.
//
// Usage (from the Vencord checkout root):
//   node src/userplugins/atAGlance/tools/verify-migration.js

const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const SRC = path.join(__dirname, "..", "widgetRegistry.ts");

const { code } = esbuild.transformSync(fs.readFileSync(SRC, "utf8"), {
    loader: "ts",
    format: "cjs",
    target: "node18"
});

const module_ = { exports: {} };
new Function("module", "exports", code)(module_, module_.exports);
const registry = module_.exports;

let failures = 0;
function check(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        console.log(`  PASS  ${name}`);
    } else {
        failures++;
        console.log(`  FAIL  ${name}\n        expected ${e}\n        actual   ${a}`);
    }
}

console.log("widgetRegistry sanitizers");

check(
    "sanitizeWidgetOrder preserves a custom order",
    registry.sanitizeWidgetOrder(["reminders", "pinned-friends"]).slice(0, 2),
    ["reminders", "pinned-friends"]
);

check(
    "sanitizeWidgetOrder appends every missing id",
    registry.sanitizeWidgetOrder(["reminders"]).length,
    registry.WIDGET_IDS.length
);

check(
    "sanitizeWidgetOrder drops unknown ids everywhere, not just from the front",
    [
        registry.sanitizeWidgetOrder(["not-a-widget", "reminders"])[0],
        registry.sanitizeWidgetOrder(["not-a-widget", "reminders"]).length
    ],
    ["reminders", registry.WIDGET_IDS.length]
);

console.log("\nsplit-widget migration");

// A v3 layout with integrations sitting mid-list, not in default position
const v3Order = [
    "pinned-friends", "reminders", "integrations", "quick-access", "client-perf"
];

const migrated = registry.sanitizeWidgetOrder(registry.rewriteSplitWidgets(v3Order));

check(
    "the three replacements land where integrations was",
    migrated.slice(0, 7),
    ["pinned-friends", "reminders", "weather", "spotify", "quick-notes", "quick-access", "client-perf"]
);

check(
    "collapsed state is inherited by all three",
    registry.sanitizeWidgetIdList(registry.rewriteSplitWidgets(["integrations"])).sort(),
    ["quick-notes", "spotify", "weather"]
);

check(
    "hidden state is inherited by all three",
    registry.migrateHiddenWidgets(
        registry.rewriteSplitWidgets(["integrations"]),
        registry.rewriteSplitWidgets(v3Order)
    ).filter(id => ["weather", "spotify", "quick-notes"].includes(id)).sort(),
    ["quick-notes", "spotify", "weather"]
);

check(
    "a config without integrations is untouched",
    registry.rewriteSplitWidgets(["reminders", "quick-access"]),
    ["reminders", "quick-access"]
);

check(
    "integrations no longer survives sanitization",
    registry.sanitizeWidgetIdList(["integrations"]),
    []
);

console.log("\nwidget column migration");

// The registry group a widget belongs to, read straight off WIDGET_META so
// this script does not hardcode a second copy of the social/tools split.
const socialIds = registry.WIDGET_META.filter(w => w.group === "social").map(w => w.id);
const toolsIds = registry.WIDGET_META.filter(w => w.group === "tools").map(w => w.id);
const seed = registry.seedColumnsFromGroups();

check(
    "seedColumnsFromGroups puts every social widget in column 0",
    socialIds.every(id => seed[id] === 0),
    true
);

check(
    "seedColumnsFromGroups puts every tools widget in column 1",
    toolsIds.every(id => seed[id] === 1),
    true
);

check(
    "seedColumnsFromGroups never seeds column 2",
    Object.values(seed).some(column => column === 2),
    false
);

check(
    "a v4 config with no widgetColumns seeds every widget from its group",
    registry.sanitizeWidgetColumns(undefined, seed),
    seed
);

for (const bad of [7, -1, "2", 1.5, null]) {
    check(
        `an out-of-range or wrong-typed column (${JSON.stringify(bad)}) falls back to the seed`,
        registry.sanitizeWidgetColumns({ "pinned-friends": bad }, seed)["pinned-friends"],
        seed["pinned-friends"]
    );
}

check(
    "an unknown widget id in stored columns is dropped",
    registry.sanitizeWidgetColumns({ "not-a-widget": 1 }, seed)["not-a-widget"],
    undefined
);

check(
    "a valid stored column survives untouched",
    registry.sanitizeWidgetColumns({ "pinned-friends": 2 }, seed)["pinned-friends"],
    2
);

console.log("\nquick tools timer/stopwatch migration");

check(
    "sanitizeTimerState on a missing field falls back to the default",
    registry.sanitizeTimerState({ minutes: "12", seconds: "30", endsAt: null }),
    { hours: "0", minutes: "12", seconds: "30", endsAt: null }
);

check(
    "sanitizeTimerState on wrong-typed fields falls back to defaults",
    registry.sanitizeTimerState({ hours: 1, minutes: null, seconds: "9999", endsAt: "soon" }),
    registry.DEFAULT_TIMER_STATE
);

check(
    "sanitizeTimerState rejects a non-positive endsAt",
    registry.sanitizeTimerState({ hours: "0", minutes: "5", seconds: "0", endsAt: 0 }).endsAt,
    null
);

check(
    "a valid stored timer survives untouched",
    registry.sanitizeTimerState({ hours: "1", minutes: "30", seconds: "45", endsAt: 1234567890 }),
    { hours: "1", minutes: "30", seconds: "45", endsAt: 1234567890 }
);

check(
    "sanitizeStopwatchState on a missing field falls back to the default",
    registry.sanitizeStopwatchState({ running: true }),
    { running: false, startedAt: 0, elapsed: 0 }
);

check(
    "sanitizeStopwatchState on wrong-typed fields falls back to defaults",
    registry.sanitizeStopwatchState({ running: "yes", startedAt: "later", elapsed: null }),
    registry.DEFAULT_STOPWATCH_STATE
);

check(
    "sanitizeStopwatchState forces running false when startedAt is invalid",
    registry.sanitizeStopwatchState({ running: true, startedAt: -1, elapsed: 500 }).running,
    false
);

check(
    "a valid stored stopwatch survives untouched",
    registry.sanitizeStopwatchState({ running: true, startedAt: 1000, elapsed: 2000 }),
    { running: true, startedAt: 1000, elapsed: 2000 }
);

if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
}
console.log("\nAll assertions passed.");
