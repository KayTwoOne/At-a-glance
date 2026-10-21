/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { bookmarksFooter, failureTitle, moveProgress, savedAgo, savedAuthor, savedLocation } from "../../savedLabels";
import type { MigrationState } from "../../savedRows";

const MIN = 60_000;
const HOUR = 60 * MIN;

// A local-time instant, with a 1-based month so the dates read like the labels
const local = (y: number, month: number, d: number, h = 0, mi = 0) => new Date(y, month - 1, d, h, mi).getTime();

// savedAgo

test("savedAgo says just now inside the first minute, and for a clock a little ahead", () => {
    const now = local(2026, 10, 20, 12, 0);
    assert.equal(savedAgo(now, now), "saved just now");
    assert.equal(savedAgo(now - 59_000, now), "saved just now");
    assert.equal(savedAgo(now + 5 * MIN, now), "saved just now");
});

test("savedAgo counts minutes under an hour and hours under a day", () => {
    const now = local(2026, 10, 20, 12, 0);
    assert.equal(savedAgo(now - MIN, now), "saved 1 min ago");
    assert.equal(savedAgo(now - 59 * MIN, now), "saved 59 min ago");
    assert.equal(savedAgo(now - HOUR, now), "saved 1 h ago");
    assert.equal(savedAgo(now - 2 * HOUR - 30 * MIN, now), "saved 2 h ago");
    assert.equal(savedAgo(now - 23 * HOUR - 59 * MIN, now), "saved 23 h ago");
});

test("savedAgo keeps counting hours across midnight until a full day has passed", () => {
    const now = local(2026, 10, 20, 1, 0);
    assert.equal(savedAgo(local(2026, 10, 19, 23, 0), now), "saved 2 h ago");
});

test("savedAgo says yesterday for the previous calendar day once a day has passed", () => {
    const now = local(2026, 10, 20, 9, 0);
    assert.equal(savedAgo(local(2026, 10, 19, 8, 0), now), "yesterday");
    assert.equal(savedAgo(local(2026, 10, 19, 0, 0), now), "yesterday");
});

test("savedAgo gives a short date for older saves, with the year only when it is not this one", () => {
    const now = local(2026, 10, 20, 9, 0);
    assert.equal(savedAgo(local(2026, 10, 18, 23, 0), now), "18 Oct");
    assert.equal(savedAgo(local(2026, 10, 3, 10, 0), now), "3 Oct");
    assert.equal(savedAgo(local(2026, 1, 1, 0, 0), now), "1 Jan");
    assert.equal(savedAgo(local(2025, 12, 31, 23, 0), now), "31 Dec 2025");
});

test("savedAgo reads a Date, a number or a date string alike", () => {
    const now = local(2026, 10, 20, 12, 0);
    const then = now - 3 * HOUR;
    assert.equal(savedAgo(new Date(then), now), "saved 3 h ago");
    assert.equal(savedAgo(then, now), "saved 3 h ago");
    assert.equal(savedAgo(new Date(then).toISOString(), now), "saved 3 h ago");
});

test("savedAgo gives nothing for a time it cannot read, so the row shows no time", () => {
    const now = local(2026, 10, 20, 12, 0);
    assert.equal(savedAgo(undefined, now), "");
    assert.equal(savedAgo(null, now), "");
    assert.equal(savedAgo(new Date(0), now), "");
    assert.equal(savedAgo(0, now), "");
    assert.equal(savedAgo(NaN, now), "");
    assert.equal(savedAgo(new Date("not a date"), now), "");
    assert.equal(savedAgo("later", now), "");
    assert.equal(savedAgo({} as unknown as Date, now), "");
    assert.equal(savedAgo(now - HOUR, NaN), "");
});

// savedAuthor

test("savedAuthor prefers the display name, then the username, then Discord's summary", () => {
    assert.equal(savedAuthor({ globalName: "Wren", username: "wren01" }, "wren summary"), "Wren");
    assert.equal(savedAuthor({ globalName: null, username: "wren01" }, "wren summary"), "wren01");
    assert.equal(savedAuthor({ globalName: "", username: "" }, "wren summary"), "wren summary");
    assert.equal(savedAuthor(null, "wren summary"), "wren summary");
    assert.equal(savedAuthor(undefined, "  wren summary  "), "wren summary");
});

test("savedAuthor says Unknown when nothing names the author", () => {
    assert.equal(savedAuthor(null, undefined), "Unknown");
    assert.equal(savedAuthor(undefined, ""), "Unknown");
    assert.equal(savedAuthor({}, "   "), "Unknown");
});

// savedLocation

test("savedLocation names a server channel after its server, as the mockup does", () => {
    assert.equal(savedLocation({ kind: "guild", name: "announcements", guildName: "Night Owls" }, "x"), "Night Owls · #announcements");
});

test("savedLocation leaves the server off when it is not known", () => {
    assert.equal(savedLocation({ kind: "guild", name: "announcements" }, "x"), "#announcements");
    assert.equal(savedLocation({ kind: "guild", name: "announcements", guildName: "" }, "x"), "#announcements");
});

test("savedLocation falls back to Discord's summary for a server channel with no name", () => {
    assert.equal(savedLocation({ kind: "guild", guildName: "Night Owls" }, "general"), "general");
    assert.equal(savedLocation({ kind: "guild", name: "" }, undefined), "Unknown channel");
});

test("savedLocation says Direct message for a DM and the name for a group DM", () => {
    assert.equal(savedLocation({ kind: "dm" }, "juno"), "Direct message");
    assert.equal(savedLocation({ kind: "group", name: "Weekend plans" }, "x"), "Weekend plans");
});

test("savedLocation names an unnamed group DM from Discord's summary, else Group DM", () => {
    assert.equal(savedLocation({ kind: "group" }, "Ollie, Juno and Wren"), "Ollie, Juno and Wren");
    assert.equal(savedLocation({ kind: "group", name: "" }, "  Ollie, Juno  "), "Ollie, Juno");
    assert.equal(savedLocation({ kind: "group", name: "   " }, undefined), "Group DM");
    assert.equal(savedLocation({ kind: "group" }, ""), "Group DM");
    assert.equal(savedLocation({ kind: "group", name: "Weekend plans" }, "Ollie, Juno"), "Weekend plans");
});

test("savedLocation uses Discord's channel summary when the channel is not loaded", () => {
    assert.equal(savedLocation(null, "general"), "general");
    assert.equal(savedLocation(undefined, "  general  "), "general");
    assert.equal(savedLocation(null, ""), "Unknown channel");
    assert.equal(savedLocation(null, undefined), "Unknown channel");
});

// moveProgress

const state = (over: Partial<MigrationState> = {}): MigrationState => ({ running: false, done: 0, failed: [], total: 0, ...over });
const failures = (n: number) => Array.from({ length: n }, (_, i) => ({ messageId: String(i), reason: "x" }));

test("moveProgress names the save under way while the run goes", () => {
    assert.equal(moveProgress(state({ running: true, total: 7 })), "Moving 1 of 7");
    assert.equal(moveProgress(state({ running: true, total: 7, done: 2 })), "Moving 3 of 7");
    assert.equal(moveProgress(state({ running: true, total: 7, done: 4, failed: failures(1) })), "Moving 6 of 7");
});

test("moveProgress never reads past the total", () => {
    assert.equal(moveProgress(state({ running: true, total: 7, done: 7 })), "Moving 7 of 7");
    assert.equal(moveProgress(state({ running: true, total: 3, done: 1, failed: failures(2) })), "Moving 3 of 3");
});

test("moveProgress says how many moved once the run is over", () => {
    assert.equal(moveProgress(state({ total: 7, done: 7 })), "Moved 7");
    assert.equal(moveProgress(state({ total: 1, done: 1 })), "Moved 1");
});

test("moveProgress says how many could not be moved", () => {
    assert.equal(moveProgress(state({ total: 7, done: 5, failed: failures(2) })), "Moved 5, 2 couldn't be moved");
    assert.equal(moveProgress(state({ total: 7, done: 6, failed: failures(1) })), "Moved 6, 1 couldn't be moved");
});

test("moveProgress does not claim a move when nothing moved", () => {
    assert.equal(moveProgress(state({ total: 3, done: 0, failed: failures(3) })), "3 couldn't be moved");
});

test("moveProgress is empty for a run that never had anything", () => {
    assert.equal(moveProgress(state()), "");
});

// bookmarksFooter

const footer = (over: Partial<Parameters<typeof bookmarksFooter>[0]> = {}) =>
    bookmarksFooter({ fetchState: "LOADED_FINISHED", hasFetched: true, pending: false, shown: 3, ...over });

test("bookmarksFooter offers Load more only while Discord has more", () => {
    assert.equal(footer({ fetchState: "LOADED_HAS_MORE" }), "more");
    assert.equal(footer({ fetchState: "LOADED_FINISHED" }), "end");
});

test("bookmarksFooter says loading while the first look is under way, or Discord is fetching", () => {
    assert.equal(footer({ pending: true, hasFetched: false, shown: 0 }), "loading");
    assert.equal(footer({ fetchState: "LOADING", shown: 0 }), "loading");
    assert.equal(footer({ fetchState: "LOADING", shown: 25 }), "loading");
});

test("bookmarksFooter shows the empty state only when Discord has answered and there is nothing", () => {
    assert.equal(footer({ shown: 0 }), "empty");
    assert.equal(footer({ shown: 0, fetchState: "LOADED_HAS_MORE" }), "more");
});

test("bookmarksFooter reports a failed load, including one nothing confirms", () => {
    assert.equal(footer({ fetchState: "FAILED", shown: 0 }), "failed");
    assert.equal(footer({ fetchState: "FAILED", shown: 25 }), "failed");
    assert.equal(footer({ fetchState: "LOADED_FINISHED", hasFetched: false, shown: 0 }), "failed");
});

test("bookmarksFooter never says empty while a load is pending", () => {
    assert.equal(footer({ pending: true, shown: 0 }), "loading");
    assert.equal(footer({ pending: true, fetchState: "FAILED", shown: 0 }), "failed");
});

// failureTitle

test("failureTitle lists each failure reason on its own line", () => {
    const failed = [
        { messageId: "1", reason: "rate limited" },
        { messageId: "2", reason: "Account changed" },
        { messageId: "3", reason: "rate limited" }
    ];
    assert.equal(failureTitle(state({ total: 5, done: 2, failed })), ["rate limited", "Account changed", "rate limited"].join("\n"));
});

test("failureTitle is undefined when nothing failed", () => {
    assert.equal(failureTitle(state({ total: 3, done: 3 })), undefined);
    assert.equal(failureTitle(state()), undefined);
});
