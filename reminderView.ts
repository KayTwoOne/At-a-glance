/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the Reminders widget decides before it draws: which rows the All /
// Messages / Notes filter keeps, whether the filter is worth showing, how many
// things want attention, how Discord's reminders go into the merged list, what
// the empty list says, and how long a snooze is. Pure: no imports, so
// tools/tests covers it. Nothing here changes its input.

export type ReminderFilter = "all" | "messages" | "notes";

export const REMINDER_FILTERS: ReadonlyArray<{ value: ReminderFilter; label: string; }> = [
    { value: "all", label: "All" },
    { value: "messages", label: "Messages" },
    { value: "notes", label: "Notes" }
];

export interface ReminderCounts { all: number; messages: number; notes: number; }

/** A row in the merged list: Discord's reminder ("native") or one of the person's own text notes ("local") */
interface Kinded { kind: "native" | "local"; }

/** How many rows there are of each kind */
export function reminderCounts(list: ReadonlyArray<Kinded>): ReminderCounts {
    let messages = 0;
    for (const row of list) {
        if (row.kind === "native") messages++;
    }
    return { all: list.length, messages, notes: list.length - messages };
}

/** The rows a filter keeps, in their order. A new array; an unknown filter keeps everything */
export function selectReminders<T extends Kinded>(list: readonly T[], filter: ReminderFilter): T[] {
    if (filter === "messages") return list.filter(row => row.kind === "native");
    if (filter === "notes") return list.filter(row => row.kind === "local");
    return list.slice();
}

/**
 * Whether the filter is worth drawing. With only one kind of row there is
 * nothing to tell apart, but it never disappears under a choice other than All,
 * because it is the way back.
 */
export function showReminderFilter(counts: ReminderCounts, filter: ReminderFilter): boolean {
    if (filter !== "all") return true;
    return counts.messages > 0 && counts.notes > 0;
}

/**
 * The number for a badge: the counts added together. Anything that is not a
 * finite, non-negative number counts as nothing, and fractions are dropped, so
 * one bad reading cannot turn the badge into "NaN".
 */
export function attentionTotal(...counts: number[]): number {
    let total = 0;
    for (const count of counts) {
        if (typeof count === "number" && Number.isFinite(count) && count > 0) total += Math.floor(count);
    }
    return total;
}

/** A due time as milliseconds. Discord hands over a Date; a number or an ISO string is read too. Null when there is none */
export function nativeDueMs(dueAt: unknown): number | null {
    let ms = NaN;
    if (dueAt instanceof Date) ms = dueAt.getTime();
    else if (typeof dueAt === "number") ms = dueAt;
    else if (typeof dueAt === "string") ms = Date.parse(dueAt);
    return Number.isFinite(ms) ? ms : null;
}

// The last instant a Date can hold. A reminder without a readable time still
// has to go somewhere in the order, and the end is the only fair place.
const LAST_INSTANT = 8.64e15;

/**
 * Discord's reminders as the input mergeReminders wants. A reminder whose time
 * cannot be read is kept, sorted last among the timed ones, rather than dropped;
 * its row says "NO DATE".
 */
export function nativeReminderItems<E extends { saveData: { dueAt?: unknown; }; }>(entries: readonly E[]): Array<{ dueAt: number; item: E; }> {
    return entries.map(item => ({ item, dueAt: nativeDueMs(item.saveData.dueAt) ?? LAST_INSTANT }));
}

/**
 * Parses a HHH:MM:SS / MM:SS / SS duration string into milliseconds.
 * Returns null for anything empty or malformed.
 */
export function parseDurationMs(value: string): number | null {
    const parts = value.trim().split(":").map(p => p.trim());
    if (parts.length < 1 || parts.length > 3) return null;
    if (parts.some(p => !/^\d{1,3}$/.test(p))) return null;

    const nums = parts.map(Number);
    let h = 0, m = 0, s = 0;
    if (nums.length === 3) [h, m, s] = nums;
    else if (nums.length === 2) [m, s] = nums;
    else [s] = nums;

    const totalMs = ((h * 3600) + (m * 60) + s) * 1000;
    return totalMs > 0 ? totalMs : null;
}

const MINUTE = 60_000;

/**
 * A custom snooze length, from what was typed. At least a minute: anything
 * shorter is a slip (a bare "30" reads as seconds), and Discord's own reminders
 * work in minutes. Null when it is not a length or is too short.
 */
export function snoozeLengthMs(value: string): number | null {
    const ms = parseDurationMs(value);
    return ms !== null && ms >= MINUTE ? ms : null;
}

/** The words for an empty list, in up to three parts so the widget can set `strong` in bold */
export interface EmptyCopy { before: string; strong?: string; after?: string; }

const EMPTY_COPY: Record<ReminderFilter, EmptyCopy> = {
    all: { before: "Nothing to remember (yet). Add a note above, or right-click a message and choose ", strong: "Create Reminder", after: "." },
    messages: { before: "No message reminders. Right-click a message and choose ", strong: "Create Reminder", after: "." },
    notes: { before: "No notes. Add one above, with or without a timer." }
};

/** What an empty list says under each filter. An unknown filter gets the All wording */
export function reminderEmptyCopy(filter: ReminderFilter): EmptyCopy {
    return EMPTY_COPY[filter] ?? EMPTY_COPY.all;
}
