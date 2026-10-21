/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The wording on a Saved Messages row and its footer. Pure: the widget reads
// Discord's stores and hands plain values in, so tools/tests covers it. Dates
// are local and the clock is passed in, never read.

import type { MigrationState } from "./savedRows";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Discord hands over a Date; a number or an ISO string is read too, and
// anything else is not a time
function toMillis(value: unknown): number {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;
    if (typeof value === "string") return Date.parse(value);
    return NaN;
}

/**
 * When a message was saved, as short as it can be: "saved just now", "saved 5
 * min ago", "saved 2 h ago", then "yesterday" for the previous calendar day
 * once a day has passed, then "3 Oct", with the year when it is not this one.
 * A time that cannot be read, or the epoch used for none, gives an empty
 * string so the row shows no time at all.
 */
export function savedAgo(savedAt: unknown, now: number): string {
    const then = toMillis(savedAt);
    if (!Number.isFinite(then) || then <= 0 || !Number.isFinite(now)) return "";

    const diff = now - then;
    if (diff < MINUTE) return "saved just now";
    if (diff < HOUR) return `saved ${Math.floor(diff / MINUTE)} min ago`;
    if (diff < DAY) return `saved ${Math.floor(diff / HOUR)} h ago`;

    const today = new Date(now);
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const startOfYesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime();
    if (then >= startOfYesterday && then < startOfToday) return "yesterday";

    const d = new Date(then);
    const date = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
    return d.getFullYear() === today.getFullYear() ? date : `${date} ${d.getFullYear()}`;
}

/** The parts of a Discord user a row reads */
export interface UserFacts { globalName?: string | null; username?: string | null; }

const clean = (text: unknown) => typeof text === "string" ? text.trim() : "";

/** The author's display name, else their username, else Discord's own summary of them, else "Unknown" */
export function savedAuthor(user: UserFacts | null | undefined, authorSummary: string | undefined): string {
    return clean(user?.globalName) || clean(user?.username) || clean(authorSummary) || "Unknown";
}

/** What the row needs to know about the channel; null when Discord's channel store does not have it */
export interface ChannelFacts {
    kind: "dm" | "group" | "guild";
    name?: string | null;
    guildName?: string | null;
}

/**
 * Where a message lives, as the mockup writes it: "Server · #channel",
 * "Direct message", or a group DM's name. When the channel is not loaded (or a
 * server channel has no name) Discord's own summary stands in, as given, and
 * an unnamed group DM uses it before falling back to "Group DM".
 */
export function savedLocation(channel: ChannelFacts | null | undefined, channelSummary: string | undefined): string {
    const summary = clean(channelSummary);
    const fallback = summary || "Unknown channel";
    if (!channel) return fallback;

    if (channel.kind === "dm") return "Direct message";
    if (channel.kind === "group") return clean(channel.name) || summary || "Group DM";

    const name = clean(channel.name);
    if (!name) return fallback;
    const server = clean(channel.guildName);
    return server ? `${server} · #${name}` : `#${name}`;
}

/**
 * The legacy row's progress wording. While the run goes it names the save
 * under way ("Moving 3 of 7", never past the total). Afterwards it says what
 * happened: "Moved 7", "Moved 5, 2 couldn't be moved", or "3 couldn't be
 * moved" when none went across. Empty for a run that had nothing in it.
 */
export function moveProgress(state: MigrationState): string {
    const { running, done, failed, total } = state;
    if (running) return `Moving ${Math.min(total, done + failed.length + 1)} of ${total}`;
    if (total === 0) return "";
    if (failed.length === 0) return `Moved ${done}`;
    if (done === 0) return `${failed.length} couldn't be moved`;
    return `Moved ${done}, ${failed.length} couldn't be moved`;
}

/**
 * The reasons behind "couldn't be moved", one per line, for the status line's
 * title. Undefined when nothing failed, so no empty tooltip is attached.
 */
export function failureTitle(state: MigrationState): string | undefined {
    if (state.failed.length === 0) return undefined;
    return state.failed.map(f => f.reason).join("\n");
}

/** What sits under the bookmark rows */
export type BookmarksFooter = "loading" | "more" | "failed" | "empty" | "end";

/**
 * Picks the footer from Discord's fetch state. A failure wins. Loading holds
 * while the widget's first look is pending or Discord is fetching, so the
 * empty message never shows early. If the first look is over and Discord still
 * reports nothing fetched, that is a failure Discord did not say so about, and
 * saying "no bookmarks" would be a guess.
 */
export function bookmarksFooter(input: {
    fetchState: string;
    hasFetched: boolean;
    pending: boolean;
    shown: number;
}): BookmarksFooter {
    const { fetchState, hasFetched, pending, shown } = input;
    if (fetchState === "FAILED") return "failed";
    if (pending || fetchState === "LOADING") return "loading";
    if (!hasFetched) return "failed";
    if (fetchState === "LOADED_HAS_MORE") return "more";
    return shown === 0 ? "empty" : "end";
}
