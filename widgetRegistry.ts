/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * The widget registry and every pure function that sanitizes a stored widget
 * id list. Deliberately import-free: tools/verify-migration.js transpiles this
 * file and runs it under node, which cannot resolve Vencord's aliases.
 */

export type WidgetGroup = "social" | "tools";

// A plain key, not a component reference: this file loads under node in
// tools/verify-migration.js, which cannot resolve JSX or Vencord path aliases.
// WidgetCard.tsx is what maps each key to an actual icon component.
export type WidgetIconKey =
    | "people"
    | "hash"
    | "chat"
    | "bookmark"
    | "calendar"
    | "gear"
    | "bell"
    | "weather"
    | "music"
    | "note"
    | "pulse"
    | "dashboard";

export const WIDGET_META = [
    { id: "pinned-friends", label: "Pinned Friends", group: "social", icon: "people" },
    { id: "quick-access", label: "Quick Access Channels", group: "social", icon: "hash" },
    { id: "mentions", label: "Inbox", group: "social", icon: "chat" },
    { id: "bookmarks", label: "Saved Messages", group: "social", icon: "bookmark" },
    { id: "events", label: "Upcoming Events", group: "social", icon: "calendar" },
    { id: "quick-tools", label: "Quick Tools", group: "tools", icon: "gear" },
    { id: "reminders", label: "Reminders", group: "tools", icon: "bell" },
    { id: "weather", label: "Weather", group: "tools", icon: "weather" },
    { id: "spotify", label: "Now Playing", group: "tools", icon: "music" },
    { id: "quick-notes", label: "Quick Notes", group: "tools", icon: "note" },
    { id: "client-perf", label: "Client Performance", group: "tools", icon: "pulse" },
    // Optional remote control for the separate OrionQuests plugin. Off unless the
    // user opts in via Add Widget, and inert unless that plugin is also enabled.
    { id: "orion", label: "Orion", group: "tools", icon: "dashboard", defaultHidden: true }
] as const satisfies ReadonlyArray<{ id: string; label: string; group: WidgetGroup; icon: WidgetIconKey; defaultHidden?: boolean; }>;

export type WidgetId = typeof WIDGET_META[number]["id"];
export const WIDGET_IDS = WIDGET_META.map(w => w.id) as WidgetId[];
/** Widgets that start hidden - shown only once the user enables them */
export const DEFAULT_HIDDEN_WIDGETS = WIDGET_META
    .filter(w => "defaultHidden" in w && w.defaultHidden)
    .map(w => w.id) as WidgetId[];

export function sanitizeWidgetIdList(value: unknown): WidgetId[] {
    if (!Array.isArray(value)) return [];
    return WIDGET_IDS.filter(id => value.includes(id));
}

/**
 * Like sanitizeWidgetIdList, but keeps default-hidden widgets hidden for users
 * upgrading from a config that predates them. A default-hidden widget the stored
 * order has never listed is brand-new to this user, so it starts hidden; once
 * they've seen it (it's in their saved order) their explicit choice is honoured.
 */
export function migrateHiddenWidgets(hidden: unknown, storedOrder: unknown): WidgetId[] {
    const out = sanitizeWidgetIdList(hidden);
    const known = Array.isArray(storedOrder) ? storedOrder : [];
    for (const id of DEFAULT_HIDDEN_WIDGETS) {
        if (!out.includes(id) && !known.includes(id)) out.push(id);
    }
    return out;
}

/** Widgets that were split into several, old id mapped to its replacements in order */
const SPLIT_WIDGETS: Record<string, string[]> = {
    integrations: ["weather", "spotify", "quick-notes"]
};

/**
 * Substitutes a split widget's id with its replacements IN PLACE, so a saved
 * column keeps its shape. Letting the old id fall out and the new ones be
 * appended would drop three fresh cards at the bottom of every existing
 * layout, which is exactly the reshuffle this migration exists to prevent.
 * Runs per-field before the sanitizers, which then drop anything unrecognised.
 */
export function rewriteSplitWidgets(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const id of value) {
        if (typeof id !== "string") continue;
        const replacements = SPLIT_WIDGETS[id];
        if (replacements) out.push(...replacements);
        else out.push(id);
    }
    return out;
}

/** Stored order filtered to known ids, with any missing ids appended in default order */
/**
 * Preserves the INPUT order (deduped, valid ids only), then appends any widgets
 * missing from it. NOTE: must NOT use sanitizeWidgetIdList here - that iterates
 * WIDGET_IDS (default order) and would throw away the user's custom ordering,
 * resetting layout on every save/load.
 */
export function sanitizeWidgetOrder(value: unknown): WidgetId[] {
    const out: WidgetId[] = [];
    if (Array.isArray(value)) {
        for (const id of value) {
            if (WIDGET_IDS.includes(id as WidgetId) && !out.includes(id as WidgetId)) {
                out.push(id as WidgetId);
            }
        }
    }
    for (const id of WIDGET_IDS) {
        if (!out.includes(id)) out.push(id);
    }
    return out;
}

/** Widgets can occupy any of three columns; a fresh install only ever seeds
 *  two of them so upgrading looks exactly like before (see seedColumnsFromGroups). */
export const MAX_COLUMNS = 3;

/**
 * A widget's starting column, derived from its registry group. This is
 * consulted once, at migration time, never again: after that the column is
 * the user's own data. Nothing seeds to column 2 on purpose - a fresh install
 * (and a fresh upgrade) keeps the two-column shape people already have, and
 * the third column is somewhere they move things to deliberately.
 */
export function seedColumnsFromGroups(): Partial<Record<WidgetId, number>> {
    const out: Partial<Record<WidgetId, number>> = {};
    for (const w of WIDGET_META) {
        out[w.id] = w.group === "tools" ? 1 : 0;
    }
    return out;
}

/**
 * Rebuilds a widget-column map by allowlist: only known widget ids, only
 * integers 0 to MAX_COLUMNS - 1. Anything else - a missing entry, a float, a
 * numeric string, an out-of-range number - falls back to `seed`, not to a
 * clamp, so a corrupted value cannot silently colonize a real column.
 */
export function sanitizeWidgetColumns(
    value: unknown,
    seed: Partial<Record<WidgetId, number>>
): Partial<Record<WidgetId, number>> {
    const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
    const out: Partial<Record<WidgetId, number>> = {};
    for (const id of WIDGET_IDS) {
        const stored = source[id];
        const valid = typeof stored === "number" && Number.isInteger(stored) && stored >= 0 && stored < MAX_COLUMNS;
        out[id] = valid ? stored : seed[id];
    }
    return out;
}

export type WidgetEmptyBehaviour = "show" | "collapse" | "hide";
const EMPTY_BEHAVIOURS: WidgetEmptyBehaviour[] = ["show", "collapse", "hide"];

/**
 * Spotify renders a persistent "nothing playing" state. As one row inside the
 * old combined widget that was tolerable; as its own card it is a permanently
 * dead panel for anyone who does not use Spotify, so it hides itself instead.
 */
const DEFAULT_EMPTY_BEHAVIOUR: Partial<Record<string, WidgetEmptyBehaviour>> = {
    spotify: "hide"
};

export function sanitizeEmptyBehaviour(value: unknown): Partial<Record<string, WidgetEmptyBehaviour>> {
    const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
    const out: Partial<Record<string, WidgetEmptyBehaviour>> = {};
    for (const id of WIDGET_IDS) {
        const stored = source[id];
        if (EMPTY_BEHAVIOURS.includes(stored as WidgetEmptyBehaviour)) out[id] = stored as WidgetEmptyBehaviour;
        else if (DEFAULT_EMPTY_BEHAVIOUR[id]) out[id] = DEFAULT_EMPTY_BEHAVIOUR[id];
    }
    return out;
}

export type QuickToolId = "clock" | "timer" | "stopwatch" | "timestamp" | "calculator";
export const QUICK_TOOL_IDS: QuickToolId[] = ["clock", "timer", "stopwatch", "timestamp", "calculator"];

export function sanitizeQuickToolsTab(value: unknown): QuickToolId {
    return QUICK_TOOL_IDS.includes(value as QuickToolId) ? value as QuickToolId : "clock";
}

/** The countdown timer's persisted snapshot - not written on every tick, only
 *  at arm/cancel, so this only ever needs to represent "idle" or "counting
 *  down to this absolute moment", never a live countdown value. */
export interface PersistedTimerState {
    hours: string;
    minutes: string;
    seconds: string;
    /** Absolute ms the countdown ends at, or null when idle */
    endsAt: number | null;
}

export const DEFAULT_TIMER_STATE: PersistedTimerState = {
    hours: "0",
    minutes: "5",
    seconds: "0",
    endsAt: null
};

// Digit-only, same shape the input fields already enforce via replace(/\D/g).
// Capped at 3 characters so a corrupted store value can't hand the input an
// arbitrarily long string to render.
const TIMER_DIGITS_RE = /^\d{0,3}$/;

function sanitizeTimerDigits(value: unknown, fallback: string): string {
    return typeof value === "string" && TIMER_DIGITS_RE.test(value) ? value : fallback;
}

/**
 * Allowlist sanitizer for the persisted timer snapshot. Every field falls
 * back independently, so a pre-hours stored value (no `hours` key at all)
 * still loads cleanly with hours defaulting to "0" rather than the whole
 * object being discarded.
 */
export function sanitizeTimerState(value: unknown): PersistedTimerState {
    const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
    const endsAt = typeof source.endsAt === "number" && Number.isFinite(source.endsAt) && source.endsAt > 0
        ? source.endsAt
        : null;
    return {
        hours: sanitizeTimerDigits(source.hours, DEFAULT_TIMER_STATE.hours),
        minutes: sanitizeTimerDigits(source.minutes, DEFAULT_TIMER_STATE.minutes),
        seconds: sanitizeTimerDigits(source.seconds, DEFAULT_TIMER_STATE.seconds),
        endsAt
    };
}

/** The stopwatch's persisted snapshot. Laps are deliberately not part of this
 *  shape - they reset every run and are never written to config, see the cap
 *  and reasoning next to MAX_LAPS in QuickTools.tsx. */
export interface PersistedStopwatchState {
    running: boolean;
    /** Absolute ms the current run counts from (Date.now() - accumulated) */
    startedAt: number;
    /** Frozen elapsed ms while paused */
    elapsed: number;
}

export const DEFAULT_STOPWATCH_STATE: PersistedStopwatchState = {
    running: false,
    startedAt: 0,
    elapsed: 0
};

/**
 * Allowlist sanitizer for the persisted stopwatch snapshot. A corrupted or
 * missing `startedAt` forces `running` back to false too - a "running"
 * stopwatch anchored to a fallback of 0 would render as decades of elapsed
 * time instead of failing safe to idle.
 */
export function sanitizeStopwatchState(value: unknown): PersistedStopwatchState {
    const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
    const startedAtValid = typeof source.startedAt === "number" && Number.isFinite(source.startedAt) && source.startedAt >= 0;
    const elapsedValid = typeof source.elapsed === "number" && Number.isFinite(source.elapsed) && source.elapsed >= 0;
    return {
        running: source.running === true && startedAtValid,
        startedAt: startedAtValid ? source.startedAt as number : DEFAULT_STOPWATCH_STATE.startedAt,
        elapsed: elapsedValid ? source.elapsed as number : DEFAULT_STOPWATCH_STATE.elapsed
    };
}
