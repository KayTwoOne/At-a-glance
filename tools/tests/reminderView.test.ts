/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    attentionTotal,
    nativeDueMs,
    nativeReminderItems,
    parseDurationMs,
    reminderCounts,
    reminderEmptyCopy,
    type ReminderFilter,
    selectReminders,
    showReminderFilter,
    snoozeLengthMs
} from "../../reminderView";
import { mergeReminders } from "../../savedRows";

type Row = { kind: "native" | "local"; id: string; };

const native = (id: string): Row => ({ kind: "native", id });
const note = (id: string): Row => ({ kind: "local", id });

// reminderCounts

test("reminderCounts splits Discord's reminders from text notes", () => {
    const list = [native("a"), note("b"), native("c"), native("d"), note("e")];
    assert.deepEqual(reminderCounts(list), { all: 5, messages: 3, notes: 2 });
});

test("reminderCounts is all zeros for an empty list", () => {
    assert.deepEqual(reminderCounts([]), { all: 0, messages: 0, notes: 0 });
});

test("reminderCounts does not change the list", () => {
    const list = [native("a"), note("b")];
    const copy = list.map(r => ({ ...r }));
    reminderCounts(list);
    assert.deepEqual(list, copy);
});

// selectReminders

test("selectReminders: All keeps every row in its order", () => {
    const list = [note("a"), native("b"), note("c"), native("d")];
    assert.deepEqual(selectReminders(list, "all").map(r => r.id), ["a", "b", "c", "d"]);
});

test("selectReminders: Messages keeps only Discord's reminders, in order", () => {
    const list = [note("a"), native("b"), note("c"), native("d")];
    assert.deepEqual(selectReminders(list, "messages").map(r => r.id), ["b", "d"]);
});

test("selectReminders: Notes keeps only text notes, in order", () => {
    const list = [note("a"), native("b"), note("c"), native("d")];
    assert.deepEqual(selectReminders(list, "notes").map(r => r.id), ["a", "c"]);
});

test("selectReminders gives an empty list when nothing matches", () => {
    assert.deepEqual(selectReminders([native("a")], "notes"), []);
    assert.deepEqual(selectReminders([note("a")], "messages"), []);
    assert.deepEqual(selectReminders([], "all"), []);
});

test("selectReminders hands back a new array and leaves the input alone", () => {
    const list = [note("a"), native("b")];
    const before = list.slice();
    const all = selectReminders(list, "all");
    assert.notEqual(all, list);
    assert.deepEqual(list, before);
    all.reverse();
    assert.deepEqual(list, before);
});

test("selectReminders: an unknown filter shows everything rather than nothing", () => {
    const list = [note("a"), native("b")];
    assert.equal(selectReminders(list, "bogus" as ReminderFilter).length, 2);
});

test("the selection matches what the counts promised", () => {
    const list = [native("a"), note("b"), native("c")];
    const counts = reminderCounts(list);
    for (const filter of ["all", "messages", "notes"] as const) {
        assert.equal(selectReminders(list, filter).length, counts[filter]);
    }
});

// showReminderFilter

test("the filter shows once there are both kinds to tell apart", () => {
    assert.equal(showReminderFilter({ all: 3, messages: 2, notes: 1 }, "all"), true);
    assert.equal(showReminderFilter({ all: 2, messages: 1, notes: 1 }, "all"), true);
});

test("the filter stays away when there is only one kind or nothing", () => {
    assert.equal(showReminderFilter({ all: 3, messages: 3, notes: 0 }, "all"), false);
    assert.equal(showReminderFilter({ all: 2, messages: 0, notes: 2 }, "all"), false);
    assert.equal(showReminderFilter({ all: 0, messages: 0, notes: 0 }, "all"), false);
});

test("the filter does not vanish under a choice that is not All", () => {
    // The last message reminder was marked done while Messages was selected:
    // the control that gets the person back to All has to stay
    assert.equal(showReminderFilter({ all: 2, messages: 0, notes: 2 }, "messages"), true);
    assert.equal(showReminderFilter({ all: 0, messages: 0, notes: 0 }, "notes"), true);
});

// attentionTotal

test("attentionTotal adds the counts up", () => {
    assert.equal(attentionTotal(2, 3), 5);
    assert.equal(attentionTotal(0, 4), 4);
    assert.equal(attentionTotal(1, 0, 6), 7);
    assert.equal(attentionTotal(), 0);
});

test("attentionTotal counts anything that is not a sensible number as nothing", () => {
    assert.equal(attentionTotal(Number.NaN, 2), 2);
    assert.equal(attentionTotal(Infinity, 2), 2);
    assert.equal(attentionTotal(-3, 2), 2);
    assert.equal(attentionTotal(undefined as unknown as number, null as unknown as number, 1), 1);
    assert.equal(attentionTotal("4" as unknown as number, 1), 1);
});

test("attentionTotal keeps whole numbers", () => {
    assert.equal(attentionTotal(1.9, 1), 2);
});

// nativeDueMs

test("nativeDueMs reads a Date, a number or an ISO string", () => {
    const at = Date.UTC(2026, 9, 20, 9, 30);
    assert.equal(nativeDueMs(new Date(at)), at);
    assert.equal(nativeDueMs(at), at);
    assert.equal(nativeDueMs(new Date(at).toISOString()), at);
});

test("nativeDueMs gives null for a missing or unreadable time", () => {
    assert.equal(nativeDueMs(undefined), null);
    assert.equal(nativeDueMs(null), null);
    assert.equal(nativeDueMs(new Date("nonsense")), null);
    assert.equal(nativeDueMs("soon"), null);
    assert.equal(nativeDueMs(Number.NaN), null);
    assert.equal(nativeDueMs({}), null);
});

// nativeReminderItems

type Stored = { id: string; saveData: { dueAt?: unknown; }; };
const stored = (id: string, dueAt: unknown): Stored => ({ id, saveData: { dueAt } });

test("nativeReminderItems pairs each reminder with its due time and keeps the original", () => {
    const a = stored("a", new Date(5000));
    const b = stored("b", new Date(1000));
    const items = nativeReminderItems([a, b]);
    assert.deepEqual(items.map(i => i.dueAt), [5000, 1000]);
    assert.equal(items[0].item, a);
    assert.equal(items[1].item, b);
});

test("nativeReminderItems keeps a reminder with no readable time, sorting it after the rest", () => {
    const list = [stored("lost", undefined), stored("late", new Date(9_000)), stored("soon", new Date(1_000))];
    const merged = mergeReminders(nativeReminderItems(list), []);
    assert.deepEqual(merged.map(m => (m.item as Stored).id), ["soon", "late", "lost"]);
});

test("nativeReminderItems puts such a reminder ahead of untimed notes, as timed ones go", () => {
    const merged = mergeReminders(
        nativeReminderItems([stored("lost", undefined)]),
        [{ dueAt: null, item: { id: "note" } }]
    );
    assert.deepEqual(merged.map(m => m.kind), ["native", "local"]);
});

test("nativeReminderItems does not change the list it is given", () => {
    const list = [stored("a", new Date(2000)), stored("b", new Date(1000))];
    const before = list.slice();
    nativeReminderItems(list);
    assert.deepEqual(list, before);
});

test("merged, filtered and counted together: what the widget does", () => {
    const merged = mergeReminders(
        nativeReminderItems([stored("m1", new Date(3000)), stored("m2", new Date(1000))]),
        [
            { dueAt: 2000, item: { id: "n1" } },
            { dueAt: null, item: { id: "n2" } }
        ]
    );
    const counts = reminderCounts(merged);
    assert.deepEqual(counts, { all: 4, messages: 2, notes: 2 });
    assert.deepEqual(selectReminders(merged, "all").map(m => (m.item as { id: string; }).id), ["m2", "n1", "m1", "n2"]);
    assert.deepEqual(selectReminders(merged, "messages").map(m => (m.item as { id: string; }).id), ["m2", "m1"]);
    assert.deepEqual(selectReminders(merged, "notes").map(m => (m.item as { id: string; }).id), ["n1", "n2"]);
});

// parseDurationMs

test("parseDurationMs reads hours, minutes and seconds, with the short forms", () => {
    assert.equal(parseDurationMs("00:15:00"), 15 * 60_000);
    assert.equal(parseDurationMs("1:30:00"), 90 * 60_000);
    assert.equal(parseDurationMs("90:00"), 90 * 60_000);
    assert.equal(parseDurationMs("45"), 45_000);
    assert.equal(parseDurationMs("  2:00  "), 120_000);
});

test("parseDurationMs gives null for nothing, zero or something that is not a length", () => {
    for (const value of ["", "   ", "0", "00:00:00", "soon", "1:2:3:4", "1.5", "-5", ":30", "12:", "1234"]) {
        assert.equal(parseDurationMs(value), null, JSON.stringify(value));
    }
});

// snoozeLengthMs

test("snoozeLengthMs accepts a minute or more", () => {
    assert.equal(snoozeLengthMs("00:15:00"), 15 * 60_000);
    assert.equal(snoozeLengthMs("1:00"), 60_000);
    assert.equal(snoozeLengthMs("60"), 60_000);
    assert.equal(snoozeLengthMs("00:00:90"), 90_000);
});

test("snoozeLengthMs rejects anything under a minute", () => {
    assert.equal(snoozeLengthMs("59"), null);
    assert.equal(snoozeLengthMs("0:59"), null);
    assert.equal(snoozeLengthMs("00:00:01"), null);
    assert.equal(snoozeLengthMs("00:00:30"), null);
});

test("snoozeLengthMs rejects what parseDurationMs rejects", () => {
    for (const value of ["", "0", "later", "1:2:3:4"]) {
        assert.equal(snoozeLengthMs(value), null, JSON.stringify(value));
    }
});

// reminderEmptyCopy

const copyText = (copy: { before: string; strong?: string; after?: string; }) => copy.before + (copy.strong ?? "") + (copy.after ?? "");

test("reminderEmptyCopy says something for every filter, naming Discord's Create Reminder where it applies", () => {
    assert.equal(
        copyText(reminderEmptyCopy("all")),
        "Nothing to remember (yet). Add a note above, or right-click a message and choose Create Reminder."
    );
    assert.equal(reminderEmptyCopy("all").strong, "Create Reminder");
    assert.equal(
        copyText(reminderEmptyCopy("messages")),
        "No message reminders. Right-click a message and choose Create Reminder."
    );
    assert.equal(reminderEmptyCopy("messages").strong, "Create Reminder");
    assert.equal(copyText(reminderEmptyCopy("notes")), "No notes. Add one above, with or without a timer.");
    assert.equal(reminderEmptyCopy("notes").strong, undefined);
});

test("reminderEmptyCopy falls back to the All wording for a filter it does not know", () => {
    assert.deepEqual(reminderEmptyCopy("bogus" as ReminderFilter), reminderEmptyCopy("all"));
});

test("reminderEmptyCopy has no em or en dashes", () => {
    for (const filter of ["all", "messages", "notes"] as const) {
        assert.doesNotMatch(copyText(reminderEmptyCopy(filter)), /[\u2013\u2014]/);
    }
});
