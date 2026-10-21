/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Row helpers for Discord's own saved messages and message reminders. Pure:
// no imports, so tools/tests covers it. It turns a store entry into tidy
// plain text, small chips, a "due" label and a sort order, and it holds the
// queue that moves old local saves across to Discord.
//
// Two rules run through it. A spoiler is never shown, wherever its text came
// from. And a local copy is only ever removed after Discord has accepted the
// save, so a failure loses nothing.

/** The parts of a message record the rows read; Discord's MessageRecord has more */
export interface SavedMessage {
    content?: string;
    attachments?: Array<{ filename?: string; }>;
    embeds?: unknown[];
}

/** One item from SavedMessagesStore. `message` is null when it is deleted or not loaded */
export interface SavedEntry {
    message: SavedMessage | null;
    saveData: {
        channelId: string;
        messageId: string;
        savedAt?: Date;
        dueAt?: Date;
        authorSummary?: string;
        channelSummary?: string;
        messageSummary?: string;
        guildId?: string;
        authorId?: string;
        notes?: string;
    };
}

export interface Chip { kind: "file" | "links" | "embed"; label: string; }

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const pad2 = (n: number) => String(n).padStart(2, "0");

// Stand-ins for text that later steps must not touch. Private-use characters,
// which are also stripped from the input so a message cannot forge one.
const OPEN = "\uE000";
const CLOSE = "\uE001";
const FORGED = /[\uE000\uE001]/g;

// A link in running text. It stops at a stand-in, so one never swallows its digits.
const LINK = /https?:\/\/[^\s<>\uE000\uE001]+/gi;

// [text](url), [text](<url>) and [text](url "title"), with one level of
// brackets allowed in the url for addresses like .../Foo_(bar)
const MASKED_LINK = /\[([^\]\n]+)\]\(\s*(?:<https?:\/\/[^>\s]*>|https?:\/\/(?:[^\s()]|\([^\s()]*\))*)(?:\s+"[^"]*")?\s*\)/g;

const GUIDE_LINKS: Record<string, string> = {
    "customize": "Channels & Roles",
    "browse": "Browse Channels",
    "guide": "Server Guide",
    "linked-roles": "Linked Roles"
};

interface Tokens {
    /** The message with escapes, code and spoilers swapped for stand-ins */
    text: string;
    /** What each stand-in stands for, by number */
    held: string[];
    hold(text: string): string;
}

// Where a run of exactly `ticks` backticks next closes inline code, or -1
function closingTicks(src: string, from: number, ticks: number): number {
    let at = src.indexOf("`", from);
    while (at >= 0) {
        let end = at;
        while (src[end] === "`") end++;
        if (end - at === ticks) return at;
        at = src.indexOf("`", end);
    }
    return -1;
}

// Reads a message once, left to right, as Discord does, and swaps for a
// stand-in everything that must not be read as markdown afterwards. At each
// position the first of these that fits wins: a backslash escape, a fenced
// block, inline code, a spoiler. So code that starts before a || keeps its
// bars as code, and a spoiler that opens first ends at the first || after it,
// hiding whatever that cuts through. One pass means nothing can be hidden or
// shown by the order of a series of rules.
//
// A || with no closing || is plain text in a message, as Discord shows it.
// In a summary, which Discord truncates and may cut before the closing bars,
// it hides the rest instead.
function tokenise(content: string, summary: boolean): Tokens {
    const held: string[] = [];
    const hold = (text: string) => OPEN + (held.push(text) - 1) + CLOSE;
    const src = content.replace(FORGED, "");
    const escape = /\\([^0-9A-Za-z\s])/uy;

    let text = "";
    let i = 0;
    while (i < src.length) {
        const char = src[i];

        if (char === "\\") {
            escape.lastIndex = i;
            const escaped = escape.exec(src);
            if (escaped) {
                text += hold(escaped[1]);
                i += escaped[0].length;
                continue;
            }
        } else if (char === "`") {
            let ticks = 1;
            while (src[i + ticks] === "`") ticks++;

            if (ticks >= 3) {
                const end = src.indexOf("```", i + 3);
                if (end >= 0) {
                    text += hold("[code]");
                    i = end + 3;
                    continue;
                }
            } else {
                const end = closingTicks(src, i + ticks, ticks);
                if (end >= 0) {
                    text += hold(src.slice(i + ticks, end));
                    i = end + ticks;
                    continue;
                }
            }

            // Nothing closes it, so the backticks are just backticks
            text += src.slice(i, i + ticks);
            i += ticks;
            continue;
        } else if (char === "|" && src[i + 1] === "|") {
            // The hidden part has at least one character, so the closing
            // bars start no earlier than three on
            const end = src.indexOf("||", i + 3);
            if (end >= 0) {
                text += hold("[spoiler]");
                i = end + 2;
                continue;
            }
            if (summary) {
                text += hold("[spoiler]");
                break;
            }
            text += "||";
            i += 2;
            continue;
        }

        text += char;
        i++;
    }

    return { text, held, hold };
}

// A timestamp as an absolute local date, written as dueChip writes dates.
// Pure: it never reads the clock.
function absoluteDate(ms: number): string {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "[date]";
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Plain text for a message preview: no markdown, no mention syntax, on one
// line. Spoilers become [spoiler] and their text is dropped, escapes become
// the character they escape, and the contents of code are kept as typed
// rather than read as markdown. Pass { summary: true } for Discord's own
// summary of a message, where an unclosed || hides the rest (see tokenise).
export function flattenMarkdown(content: string, options: { summary?: boolean; } = {}): string {
    const { text, held, hold } = tokenise(content, options.summary === true);
    let s = text;

    // Markers at the start of a line: headings, subtext and quotes
    s = s.replace(/^[ \t]*(?:#{1,3}|-#)[ \t]+/gm, "");
    s = s.replace(/^[ \t]*(?:>>>|>)[ \t]+/gm, "");

    // A masked link keeps its words and loses its address
    s = s.replace(MASKED_LINK, "$1");

    // Mentions, emoji, dates, commands and links become fixed text that
    // emphasis cannot reach
    s = s.replace(/<(https?:\/\/[^\s<>]+)>/g, (_all, url: string) => hold(url));
    s = s.replace(/<a?:(\w+):\d+>/g, (_all, name: string) => hold(`:${name}:`));
    s = s.replace(/<t:(-?\d+)(?::[A-Za-z])?>/g, (_all, seconds: string) => hold(absoluteDate(Number(seconds) * 1000)));
    s = s.replace(/<\/([\p{L}\p{N}_-]+(?: [\p{L}\p{N}_-]+){0,2}):\d+>/gu, (_all, name: string) => hold("/" + name));
    s = s.replace(/<id:(customize|browse|guide|linked-roles)(?::\d+)?>/g, (_all, which: string) => hold(GUIDE_LINKS[which]));
    s = s.replace(/<@&\d+>/g, () => hold("@role"));
    s = s.replace(/<@!?\d+>/g, () => hold("@user"));
    s = s.replace(/<#\d+>/g, () => hold("#channel"));
    s = s.replace(LINK, match => {
        // Markers hugging the end of a link belong to the markdown around it
        const tail = /[*_~|]+$/.exec(match)?.[0] ?? "";
        return hold(tail ? match.slice(0, -tail.length) : match) + tail;
    });

    // Emphasis, widest markers first. Underscores only count at a word edge,
    // so snake_case stays as it is, and a marker needs text right against it,
    // so "2 * 3 * 4" stays as it is.
    s = s.replace(/\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/g, "$1");
    s = s.replace(/(?<![\p{L}\p{N}_])__(?=\S)([\s\S]+?)(?<=\S)__(?![\p{L}\p{N}_])/gu, "$1");
    s = s.replace(/~~(?=\S)([\s\S]+?)(?<=\S)~~/g, "$1");
    s = s.replace(/\*(?=\S)([\s\S]+?)(?<=\S)\*/g, "$1");
    s = s.replace(/(?<![\p{L}\p{N}_])_(?=\S)([\s\S]+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, "$1");

    // Newest held piece first: one can hold an older one
    for (let i = held.length - 1; i >= 0; i--) {
        s = s.split(OPEN + i + CLOSE).join(held[i]);
    }

    return s.replace(/\s+/g, " ").trim();
}

const MAX_CHIP_LABEL = 28;

// What a file chip says: "spoiler" for a SPOILER_ upload, so the name never
// gives it away, else the filename, at most 28 characters with the dots and
// never cut through the middle of an emoji
function fileLabel(filename: string | undefined): string {
    if (!filename) return "attachment";
    if (/^spoiler_/i.test(filename)) return "spoiler";
    const chars = Array.from(filename);
    if (chars.length <= MAX_CHIP_LABEL) return filename;
    return chars.slice(0, MAX_CHIP_LABEL - 3).join("") + "...";
}

// The small tags under a row, always in this order: one per attachment, then
// a link count, then an embed count only when no link already explains it.
// Only links in plain view count: one inside a spoiler would hint at what is
// hidden, and one inside code is not a link. A missing message gives none.
export function messageChips(message: SavedMessage | null | undefined): Chip[] {
    if (!message) return [];
    const chips: Chip[] = [];

    if (Array.isArray(message.attachments)) {
        for (const attachment of message.attachments) {
            chips.push({ kind: "file", label: fileLabel(attachment?.filename) });
        }
    }

    const links = typeof message.content === "string"
        ? tokenise(message.content, false).text.match(LINK)?.length ?? 0
        : 0;
    if (links > 0) {
        chips.push({ kind: "links", label: links === 1 ? "1 link" : `${links} links` });
    } else {
        const embeds = Array.isArray(message.embeds) ? message.embeds.length : 0;
        if (embeds > 0) chips.push({ kind: "embed", label: embeds === 1 ? "1 embed" : `${embeds} embeds` });
    }

    return chips;
}

// The one line of text for a row. The live message when it has words, else
// Discord's own summary of it, else a placeholder. Both go through
// flattenMarkdown, so a spoiler cannot leak by either route, and the summary
// is read as a summary because Discord truncates it.
export function previewText(entry: SavedEntry): string {
    const { message, saveData } = entry;

    if (message && typeof message.content === "string") {
        const text = flattenMarkdown(message.content);
        if (text) return text;
    }

    if (typeof saveData.messageSummary === "string") {
        const summary = flattenMarkdown(saveData.messageSummary, { summary: true });
        if (summary) return summary;
    }

    if (Array.isArray(message?.attachments) && message.attachments.length > 0) return "(attachment)";
    return "(no text)";
}

// The id that tells one entry from another
export function entryKey(e: { saveData: { channelId: string; messageId: string; }; }): string {
    return e.saveData.channelId + "-" + e.saveData.messageId;
}

// The wording for when a reminder is due, with a tone for colouring it.
// Overdue is "OVERDUE n MIN / H / D" (hours from 60 minutes, days from 48
// hours), under 24 hours out is "IN n MIN / H", and further out is
// "TOMORROW HH:MM" or "D MMM HH:MM". A reminder whose time has just arrived
// counts as overdue, and the first minute either way shows as 1. Tomorrow is
// the next calendar day in local time; the clock is 24-hour and the date
// runs day then month. A time that is not a number reads "NO DATE".
export function dueChip(dueAt: number, now: number): { label: string; tone: "over" | "soon" | "later"; } {
    if (!Number.isFinite(dueAt) || !Number.isFinite(now)) return { label: "NO DATE", tone: "later" };

    const diff = dueAt - now;

    if (diff <= 0) {
        const late = -diff;
        if (late < HOUR) return { label: `OVERDUE ${Math.max(1, Math.floor(late / MINUTE))} MIN`, tone: "over" };
        if (late < 48 * HOUR) return { label: `OVERDUE ${Math.floor(late / HOUR)} H`, tone: "over" };
        return { label: `OVERDUE ${Math.floor(late / DAY)} D`, tone: "over" };
    }

    if (diff < HOUR) return { label: `IN ${Math.max(1, Math.floor(diff / MINUTE))} MIN`, tone: "soon" };
    if (diff < DAY) return { label: `IN ${Math.floor(diff / HOUR)} H`, tone: "soon" };

    const due = new Date(dueAt);
    const today = new Date(now);
    const startOfTomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
    const startOfDayAfter = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2).getTime();
    const time = `${pad2(due.getHours())}:${pad2(due.getMinutes())}`;

    if (dueAt >= startOfTomorrow && dueAt < startOfDayAfter) return { label: `TOMORROW ${time}`, tone: "later" };
    return { label: `${due.getDate()} ${MONTHS[due.getMonth()]} ${time}`, tone: "later" };
}

export type MergedReminder<A, B> =
    | { kind: "native"; item: A; dueAt: number; }
    | { kind: "local"; item: B; dueAt: number | null; };

// One list from Discord's reminders and At a glance's own. Earliest first,
// which puts the overdue ones on top without a separate step; equal times
// keep Discord's first; local entries with no time go last in the order they
// came. The inputs are not changed.
export function mergeReminders<A, B>(
    native: Array<{ dueAt: number; item: A; }>,
    local: Array<{ dueAt: number | null; item: B; }>
): Array<MergedReminder<A, B>> {
    const timed: Array<MergedReminder<A, B>> = native.map(n => ({ kind: "native", item: n.item, dueAt: n.dueAt }));
    const untimed: Array<MergedReminder<A, B>> = [];

    for (const l of local) {
        const entry: MergedReminder<A, B> = { kind: "local", item: l.item, dueAt: l.dueAt };
        if (typeof l.dueAt === "number" && Number.isFinite(l.dueAt)) timed.push(entry);
        else untimed.push(entry);
    }

    // Array.prototype.sort is stable, so ties stay in the order they went in
    timed.sort((a, b) => (a.dueAt as number) - (b.dueAt as number));
    return [...timed, ...untimed];
}

/** An old At a glance save. Anything with more fields on it works too */
export interface LocalBookmark { channelId: string; messageId: string; }

export interface MigrationState {
    running: boolean;
    /** Saves Discord accepted, whose local copy is gone */
    done: number;
    /** Saves that did not go through; their local copy is still there */
    failed: Array<{ messageId: string; reason: string; }>;
    total: number;
}

export interface MigrationDeps {
    save(item: LocalBookmark): Promise<void>;
    removeLocal(messageId: string): void;
    wait(ms: number): Promise<void>;
    /** After every change, with a copy the caller may keep */
    onChange(state: MigrationState): void;
}

// A short reason for a failed save. Discord's request errors are plain
// objects rather than Errors, so look in the places a message can be.
function reasonOf(error: unknown): string {
    if (typeof error === "string" && error) return error;
    if (error && typeof error === "object") {
        const e = error as { message?: unknown; text?: unknown; body?: { message?: unknown; } | null; };
        for (const candidate of [e.body?.message, e.message, e.text]) {
            if (typeof candidate === "string" && candidate) return candidate;
        }
    }
    return "Unknown error";
}

// Moves old local saves to Discord one at a time, gapMs apart so Discord's
// rate limit is not hit. A local copy is removed only after its save
// resolves; a rejected save is recorded and the copy stays, and the run
// carries on. Calling run while one is going returns that run's promise, so
// there is never a second one. Run again with the failed items to resume.
export function createMigrationQueue(deps: MigrationDeps, gapMs = 400): {
    run(items: LocalBookmark[]): Promise<MigrationState>;
    state(): MigrationState;
} {
    let current: MigrationState = { running: false, done: 0, failed: [], total: 0 };
    let active: Promise<MigrationState> | null = null;

    const snapshot = (): MigrationState => ({ ...current, failed: current.failed.map(f => ({ ...f })) });
    const publish = () => deps.onChange(snapshot());

    async function process(source: LocalBookmark[]): Promise<MigrationState> {
        // A copy, because removeLocal may well remove from the caller's own list
        const items = source.slice();
        current = { running: true, done: 0, failed: [], total: items.length };
        try {
            publish();
            for (let i = 0; i < items.length; i++) {
                if (i > 0) await deps.wait(gapMs);
                const item = items[i];
                try {
                    await deps.save(item);
                    deps.removeLocal(item.messageId);
                    current.done++;
                } catch (error) {
                    current.failed.push({ messageId: item.messageId, reason: reasonOf(error) });
                }
                publish();
            }
        } finally {
            current.running = false;
            publish();
        }
        return snapshot();
    }

    return {
        run(items) {
            if (active) return active;
            active = process(items).finally(() => { active = null; });
            return active;
        },
        state: snapshot
    };
}

// Whether Discord's own saved messages can be used: the store is there and
// has getMessageBookmarks and getMessageReminders, and the save, remove, refreshIfStale and
// fetchBookmarks actions are all functions. Anything less and the widgets
// keep to the local list. It takes what the lookups handed back, which may be
// lazy proxies that throw on first use when Discord's code was not found, so
// a throw counts as "not available" rather than escaping.
export function isNativeAvailable(store: unknown, actions: unknown): boolean {
    const hasFunction = (holder: unknown, name: string): boolean => {
        if (holder === null || (typeof holder !== "object" && typeof holder !== "function")) return false;
        return typeof (holder as Record<string, unknown>)[name] === "function";
    };

    try {
        return hasFunction(store, "getMessageBookmarks")
            && hasFunction(store, "getMessageReminders")
            && ["save", "remove", "refreshIfStale", "fetchBookmarks"].every(name => hasFunction(actions, name));
    } catch {
        return false;
    }
}
