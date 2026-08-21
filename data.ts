/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";
import { React, UserStore } from "@webpack/common";

import {
    DEFAULT_HIDDEN_WIDGETS,
    DEFAULT_STOPWATCH_STATE,
    DEFAULT_TIMER_STATE,
    MAX_COLUMNS,
    migrateHiddenWidgets,
    PersistedStopwatchState,
    PersistedTimerState,
    QUICK_TOOL_IDS,
    QuickToolId,
    rewriteSplitWidgets,
    sanitizeEmptyBehaviour,
    sanitizeQuickToolsTab,
    sanitizeStopwatchState,
    sanitizeTimerState,
    sanitizeWidgetColumns,
    sanitizeWidgetIdList,
    sanitizeWidgetOrder,
    seedColumnsFromGroups,
    WIDGET_IDS,
    WIDGET_META,
    WidgetEmptyBehaviour,
    WidgetIconKey,
    WidgetId
} from "./widgetRegistry";

export { MAX_COLUMNS, QUICK_TOOL_IDS, WIDGET_META };
export type { PersistedStopwatchState, PersistedTimerState, QuickToolId, WidgetEmptyBehaviour, WidgetIconKey, WidgetId };

// Computed once: WIDGET_META is a static literal, so every widget's seed
// column never changes at runtime. Recomputing it per call (fresh config,
// every sanitize, every getWidgetColumn) would just be wasted work.
const SEED_COLUMNS = seedColumnsFromGroups();

const logger = new Logger("AtAGlance");

export interface WeatherLocation {
    name: string;
    lat: number;
    lon: number;
}

export type GlanceMaterial = "classic" | "acrylic" | "glass";
export const GLANCE_MATERIALS: GlanceMaterial[] = ["classic", "acrylic", "glass"];

/** How the page background is painted:
 *  - theme: follow Discord's client/Nitro theme (default; translucent surfaces)
 *  - solid: an opaque colour that overrides the theme entirely
 *  - gradient: an opaque primary→accent gradient that overrides the theme */
export type GlanceBackgroundMode = "theme" | "solid" | "gradient";
export const GLANCE_BG_MODES: GlanceBackgroundMode[] = ["theme", "solid", "gradient"];

export interface GlanceAppearance {
    material: GlanceMaterial;
    /** Base tint colour for the cards, #rrggbb */
    primary: string;
    /** Secondary tint / shine colour, #rrggbb */
    accent: string;
    /** 0-100 slider; rendering caps the real effect so 100 stays tasteful */
    intensity: number;
    /** Gradient/shine direction in degrees, 0-360 */
    angle: number;
    /** Page background source (theme override) */
    backgroundMode: GlanceBackgroundMode;
    /** Solid background colour when backgroundMode === "solid", #rrggbb */
    backgroundColor: string;
    /** 0-100: how opaque the widget cards are over an override background */
    surfaceOpacity: number;
    /** Greeting-name colour override, #rrggbb; null = follow the accent gradient */
    nameColor: string | null;
}

export const DEFAULT_APPEARANCE: GlanceAppearance = {
    material: "classic",
    primary: "#5865f2",
    accent: "#00a8fc",
    intensity: 0,
    angle: 135,
    backgroundMode: "solid",
    backgroundColor: "#171717",
    surfaceOpacity: 90,
    nameColor: null
};

export interface GlanceConfig {
    version: 6;
    /** User IDs pinned to the "Pinned Friends" widget */
    pinnedUsers: string[];
    /** Channel IDs in "Quick Access" (guild text/voice, group DMs); split by type at render */
    watchedChannels: string[];
    /** Free-form quick notes, rendered as plain text only */
    notes: string;
    /** Location for the weather card, chosen by the user via search */
    weatherLocation: WeatherLocation | null;
    /** Widgets hidden via the "Add Widget" menu */
    hiddenWidgets: WidgetId[];
    /** Widgets currently collapsed to just their header */
    collapsedWidgets: WidgetId[];
    /** Quick Access guild sections collapsed to just their header (guild id, or "dm") */
    collapsedGuilds: string[];
    /** Display order - a sanitized permutation of all widget ids */
    widgetOrder: WidgetId[];
    /** Which column each widget sits in. Seeded once from the registry's group,
     *  then owned entirely by the user. */
    widgetColumns: Partial<Record<WidgetId, number>>;
    /** Per-widget behaviour when the widget has nothing to show */
    widgetEmptyBehaviour: Partial<Record<WidgetId, WidgetEmptyBehaviour>>;
    /** Which Quick Tools tab is showing */
    quickToolsTab: QuickToolId;
    /** Countdown timer snapshot, written only at arm/cancel - see setTimerState */
    timerState: PersistedTimerState;
    /** Stopwatch snapshot, written only at start/pause/reset - see setStopwatchState */
    stopwatchState: PersistedStopwatchState;
    /** Material/colour customization */
    appearance: GlanceAppearance;
    /** Saved messages: IDs + a plain-text snapshot so rows render instantly forever */
    bookmarks: GlanceBookmark[];
    /** Custom reminders, optionally timed */
    reminders: GlanceReminder[];
}

export interface GlanceBookmark {
    channelId: string;
    messageId: string;
    /** Author id, for the DM/message mini-avatar */
    authorId?: string;
    /** Guild id when the message is in a server, for the server icon */
    guildId?: string;
    authorName: string;
    snippet: string;
    location: string;
    savedAt: number;
}

export interface GlanceReminder {
    id: string;
    text: string;
    /** Epoch ms when it should trigger; null = untimed note-style reminder */
    dueAt: number | null;
    createdAt: number;
    /** True once the background scheduler has fired a desktop notification */
    notified?: boolean;
}

const MAX_BOOKMARKS = 100;
const MAX_REMINDERS = 50;
const MAX_REMINDER_TEXT = 200;

// Hard caps so a corrupted or maliciously edited IndexedDB entry can never
// balloon into unbounded memory/render work.
const MAX_PINNED_USERS = 50;
const MAX_WATCHED_CHANNELS = 100;
const MAX_NOTES_LENGTH = 20_000;
const MAX_LOCATION_NAME = 80;

// Discord snowflakes are 17-21 digit decimal strings. Every ID persisted by
// this plugin must match this shape; anything else is dropped on load.
const SNOWFLAKE_RE = /^\d{17,21}$/;

function freshConfig(): GlanceConfig {
    return {
        version: 6,
        pinnedUsers: [],
        watchedChannels: [],
        notes: "",
        weatherLocation: null,
        hiddenWidgets: [...DEFAULT_HIDDEN_WIDGETS],
        collapsedWidgets: [],
        collapsedGuilds: [],
        widgetOrder: [...WIDGET_IDS],
        widgetColumns: { ...SEED_COLUMNS },
        widgetEmptyBehaviour: sanitizeEmptyBehaviour(undefined),
        quickToolsTab: "clock",
        timerState: { ...DEFAULT_TIMER_STATE },
        stopwatchState: { ...DEFAULT_STOPWATCH_STATE },
        appearance: { ...DEFAULT_APPEARANCE },
        bookmarks: [],
        reminders: []
    };
}

let config: GlanceConfig = freshConfig();
// The account the in-memory config belongs to. Mutations are not persisted
// until a load for a known account has happened, so one account's data can
// never be written to another account's storage key.
let loadedForUser: string | null = null;

const listeners = new Set<() => void>();

// A second, narrower listener set, separate from useGlanceConfig()'s: module-
// local state that lives outside `config` (Quick Tools' timer/stopwatch) needs
// to know when a load has replaced `config` wholesale, but must not be woken by
// every other mutation emit() already covers - that would defeat the point of
// keeping that state off the big listener list in the first place.
type ConfigLoadListener = (loaded: GlanceConfig) => void;
const configLoadListeners = new Set<ConfigLoadListener>();

/** Runs once per loadConfig() resolution (startup, reconnect, account switch),
 *  after `config` has already been replaced with the freshly loaded snapshot. */
export function onConfigLoad(listener: ConfigLoadListener): () => void {
    configLoadListeners.add(listener);
    return () => void configLoadListeners.delete(listener);
}

function storageKey(userId: string) {
    return `AtAGlance_${userId}`;
}

/** Pre-rename storage key; migrated transparently on first load */
function legacyStorageKey(userId: string) {
    return `Dashboard_${userId}`;
}

function emit() {
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch (e) {
            logger.error("Config listener errored", e);
        }
    }
}

function sanitizeIdList(value: unknown, max: number): string[] {
    if (!Array.isArray(value)) return [];

    const out: string[] = [];
    for (const item of value) {
        if (typeof item !== "string" || !SNOWFLAKE_RE.test(item)) continue;
        if (out.includes(item)) continue;
        out.push(item);
        if (out.length >= max) break;
    }
    return out;
}

export function sanitizeLocation(value: unknown): WeatherLocation | null {
    if (typeof value !== "object" || value === null) return null;
    const { name, lat, lon } = value as Record<string, unknown>;

    if (typeof name !== "string" || name.length === 0) return null;
    if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90) return null;
    if (typeof lon !== "number" || !Number.isFinite(lon) || Math.abs(lon) > 180) return null;

    return { name: name.slice(0, MAX_LOCATION_NAME), lat, lon };
}

// Quick Access groups its watched channels by server; the collapse key is a
// guild snowflake or the literal "dm" bucket for private channels.
const GUILD_COLLAPSE_KEY_RE = /^(?:\d{17,21}|dm)$/;
function sanitizeGuildCollapseList(value: unknown, max = 100): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
        if (typeof item !== "string" || !GUILD_COLLAPSE_KEY_RE.test(item)) continue;
        if (out.includes(item)) continue;
        out.push(item);
        if (out.length >= max) break;
    }
    return out;
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
}

export function sanitizeAppearance(raw: unknown): GlanceAppearance {
    const source = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    return {
        material: GLANCE_MATERIALS.includes(source.material as GlanceMaterial)
            ? source.material as GlanceMaterial
            : DEFAULT_APPEARANCE.material,
        primary: typeof source.primary === "string" && HEX_COLOR_RE.test(source.primary)
            ? source.primary.toLowerCase()
            : DEFAULT_APPEARANCE.primary,
        accent: typeof source.accent === "string" && HEX_COLOR_RE.test(source.accent)
            ? source.accent.toLowerCase()
            : DEFAULT_APPEARANCE.accent,
        intensity: clampNumber(source.intensity, 0, 100, DEFAULT_APPEARANCE.intensity),
        angle: clampNumber(source.angle, 0, 360, DEFAULT_APPEARANCE.angle),
        backgroundMode: GLANCE_BG_MODES.includes(source.backgroundMode as GlanceBackgroundMode)
            ? source.backgroundMode as GlanceBackgroundMode
            : DEFAULT_APPEARANCE.backgroundMode,
        backgroundColor: typeof source.backgroundColor === "string" && HEX_COLOR_RE.test(source.backgroundColor)
            ? source.backgroundColor.toLowerCase()
            : DEFAULT_APPEARANCE.backgroundColor,
        surfaceOpacity: clampNumber(source.surfaceOpacity, 0, 100, DEFAULT_APPEARANCE.surfaceOpacity),
        nameColor: typeof source.nameColor === "string" && HEX_COLOR_RE.test(source.nameColor)
            ? source.nameColor.toLowerCase()
            : null
    };
}

/**
 * Validates untrusted data (from IndexedDB) into a well-formed config.
 * Only explicitly known fields are copied over; unknown keys are discarded.
 * Transparently migrates v1/v2 configs (same core fields, fewer keys).
 */
export function sanitizeConfig(raw: unknown): GlanceConfig {
    const source = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    return {
        version: 6,
        pinnedUsers: sanitizeIdList(source.pinnedUsers, MAX_PINNED_USERS),
        watchedChannels: sanitizeIdList(source.watchedChannels, MAX_WATCHED_CHANNELS),
        notes: typeof source.notes === "string" ? source.notes.slice(0, MAX_NOTES_LENGTH) : "",
        weatherLocation: sanitizeLocation(source.weatherLocation),
        hiddenWidgets: migrateHiddenWidgets(
            rewriteSplitWidgets(source.hiddenWidgets),
            rewriteSplitWidgets(source.widgetOrder)
        ),
        collapsedWidgets: sanitizeWidgetIdList(rewriteSplitWidgets(source.collapsedWidgets)),
        collapsedGuilds: sanitizeGuildCollapseList(source.collapsedGuilds),
        widgetOrder: sanitizeWidgetOrder(rewriteSplitWidgets(source.widgetOrder)),
        widgetColumns: sanitizeWidgetColumns(source.widgetColumns, SEED_COLUMNS),
        widgetEmptyBehaviour: sanitizeEmptyBehaviour(source.widgetEmptyBehaviour),
        quickToolsTab: sanitizeQuickToolsTab(source.quickToolsTab),
        timerState: sanitizeTimerState(source.timerState),
        stopwatchState: sanitizeStopwatchState(source.stopwatchState),
        appearance: sanitizeAppearance(source.appearance),
        bookmarks: sanitizeBookmarks(source.bookmarks),
        reminders: sanitizeReminders(source.reminders)
    };
}

function cleanString(value: unknown, max: number): string {
    return typeof value === "string" ? value.slice(0, max) : "";
}

function sanitizeBookmarks(value: unknown): GlanceBookmark[] {
    if (!Array.isArray(value)) return [];
    const out: GlanceBookmark[] = [];
    for (const raw of value) {
        if (typeof raw !== "object" || raw === null) continue;
        const b = raw as Record<string, unknown>;
        if (typeof b.channelId !== "string" || !SNOWFLAKE_RE.test(b.channelId)) continue;
        if (typeof b.messageId !== "string" || !SNOWFLAKE_RE.test(b.messageId)) continue;
        if (out.some(existing => existing.messageId === b.messageId)) continue;
        out.push({
            channelId: b.channelId,
            messageId: b.messageId,
            authorId: typeof b.authorId === "string" && SNOWFLAKE_RE.test(b.authorId) ? b.authorId : undefined,
            guildId: typeof b.guildId === "string" && SNOWFLAKE_RE.test(b.guildId) ? b.guildId : undefined,
            authorName: cleanString(b.authorName, 40),
            snippet: cleanString(b.snippet, 160),
            location: cleanString(b.location, 80),
            savedAt: typeof b.savedAt === "number" && Number.isFinite(b.savedAt) ? b.savedAt : 0
        });
        if (out.length >= MAX_BOOKMARKS) break;
    }
    return out;
}

function sanitizeReminders(value: unknown): GlanceReminder[] {
    if (!Array.isArray(value)) return [];
    const out: GlanceReminder[] = [];
    for (const raw of value) {
        if (typeof raw !== "object" || raw === null) continue;
        const r = raw as Record<string, unknown>;
        const text = cleanString(r.text, MAX_REMINDER_TEXT).trim();
        if (!text) continue;
        const id = cleanString(r.id, 32) || `${Date.now()}-${out.length}`;
        if (out.some(existing => existing.id === id)) continue;
        out.push({
            id,
            text,
            dueAt: typeof r.dueAt === "number" && Number.isFinite(r.dueAt) ? r.dueAt : null,
            createdAt: typeof r.createdAt === "number" && Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
            notified: r.notified === true
        });
        if (out.length >= MAX_REMINDERS) break;
    }
    return out;
}

/* ---- bookmarks ---- */

export function isBookmarked(messageId: string) {
    return config.bookmarks.some(b => b.messageId === messageId);
}

export function addBookmark(bookmark: Omit<GlanceBookmark, "savedAt">) {
    if (isBookmarked(bookmark.messageId)) return;
    if (config.bookmarks.length >= MAX_BOOKMARKS) {
        logger.warn("Bookmark list is full");
        return;
    }
    const [clean] = sanitizeBookmarks([{ ...bookmark, savedAt: Date.now() }]);
    if (!clean) return;
    config.bookmarks.unshift(clean);
    emit();
    persist();
}

export function removeBookmark(messageId: string) {
    const index = config.bookmarks.findIndex(b => b.messageId === messageId);
    if (index === -1) return;
    config.bookmarks.splice(index, 1);
    emit();
    persist();
}

/* ---- reminders ---- */

export function addReminder(text: string, dueAt: number | null) {
    const [clean] = sanitizeReminders([{
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        dueAt,
        createdAt: Date.now(),
        notified: false
    }]);
    if (!clean || config.reminders.length >= MAX_REMINDERS) return;
    config.reminders.push(clean);
    emit();
    persist();
}

export function removeReminder(id: string) {
    const index = config.reminders.findIndex(r => r.id === id);
    if (index === -1) return;
    config.reminders.splice(index, 1);
    emit();
    persist();
}

export function snoozeReminder(id: string, ms: number) {
    const reminder = config.reminders.find(r => r.id === id);
    if (!reminder) return;
    reminder.dueAt = Date.now() + ms;
    reminder.notified = false;
    emit();
    persist();
}

/** Marks a reminder's desktop notification as fired (scheduler bookkeeping) */
export function markReminderNotified(id: string) {
    const reminder = config.reminders.find(r => r.id === id);
    if (!reminder || reminder.notified) return;
    reminder.notified = true;
    persist();
}

/** Reminders whose timer has fired and are waiting for attention */
export function triggeredReminderCount(now = Date.now()) {
    return config.reminders.filter(r => r.dueAt !== null && r.dueAt <= now).length;
}

/** Due reminders that haven't yet fired a desktop notification */
export function pendingReminderNotifications(now = Date.now()): GlanceReminder[] {
    return config.reminders.filter(r => r.dueAt !== null && r.dueAt <= now && !r.notified);
}

export function setAppearance(patch: Partial<GlanceAppearance>) {
    config.appearance = sanitizeAppearance({ ...config.appearance, ...patch });
    emit();
    persist(200);
}

export async function loadConfig() {
    const meId = UserStore.getCurrentUser()?.id;
    if (!meId || !SNOWFLAKE_RE.test(meId)) return;

    try {
        let raw = await DataStore.get(storageKey(meId));
        if (raw === undefined) {
            // One-time migration from the old "Dashboard" plugin name
            raw = await DataStore.get(legacyStorageKey(meId));
            if (raw !== undefined) {
                await DataStore.set(storageKey(meId), sanitizeConfig(raw));
                await DataStore.del(legacyStorageKey(meId)).catch(() => { });
            }
        }
        config = sanitizeConfig(raw);
        loadedForUser = meId;
    } catch (e) {
        logger.error("Failed to load config", e);
        config = freshConfig();
        loadedForUser = meId;
    }
    for (const listener of [...configLoadListeners]) {
        try {
            listener(config);
        } catch (e) {
            logger.error("Config load listener errored", e);
        }
    }
    emit();
}

let persistTimeout: ReturnType<typeof setTimeout> | undefined;

function persist(debounceMs = 0) {
    if (!loadedForUser) return;
    clearTimeout(persistTimeout);
    persistTimeout = setTimeout(async () => {
        if (!loadedForUser) return;
        try {
            await DataStore.set(storageKey(loadedForUser), config);
        } catch (e) {
            logger.error("Failed to save config", e);
        }
    }, debounceMs);
}

export function getConfig(): GlanceConfig {
    return config;
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

/** React hook returning the live config, re-rendering on any change */
export function useGlanceConfig(): GlanceConfig {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => subscribe(forceUpdate), []);
    return config;
}

export function isUserPinned(userId: string) {
    return config.pinnedUsers.includes(userId);
}

export function isChannelWatched(channelId: string) {
    return config.watchedChannels.includes(channelId);
}

function toggleId(list: string[], id: string, max: number) {
    if (!SNOWFLAKE_RE.test(id)) return;

    const index = list.indexOf(id);
    if (index === -1) {
        if (list.length >= max) {
            logger.warn("List is full, not adding", id);
            return;
        }
        list.push(id);
    } else {
        list.splice(index, 1);
    }

    emit();
    persist();
}

export function togglePinnedUser(userId: string) {
    toggleId(config.pinnedUsers, userId, MAX_PINNED_USERS);
}

export function toggleWatchedChannel(channelId: string) {
    toggleId(config.watchedChannels, channelId, MAX_WATCHED_CHANNELS);
}

/** Moves a pinned user up (-1) or down (+1) */
export function movePinnedUser(id: string, delta: -1 | 1) {
    moveWithinSubset(config.pinnedUsers, id, delta, config.pinnedUsers);
}

/** True when `next` is exactly a reordering of `current` (no adds/drops/dupes) */
function isPermutation(current: string[], next: string[]): boolean {
    if (next.length !== current.length) return false;
    const set = new Set(current);
    return new Set(next).size === next.length && next.every(id => set.has(id));
}

/** Replaces the pinned-friends order wholesale (drag & drop commit) */
export function setPinnedOrder(orderedIds: string[]) {
    if (!isPermutation(config.pinnedUsers, orderedIds)) return;
    config.pinnedUsers = [...orderedIds];
    emit();
    persist();
}

/** Replaces the watched-channel order wholesale (server drag & drop commit -
 *  section order is derived from where each server's channels first appear) */
export function setWatchedChannelsOrder(orderedIds: string[]) {
    if (!isPermutation(config.watchedChannels, orderedIds)) return;
    config.watchedChannels = [...orderedIds];
    emit();
    persist();
}

/**
 * Moves a watched channel up/down relative to its *visible* siblings.
 * `subsetIds` is the rendered sub-list (e.g. only voice channels), so a voice
 * channel never swaps past text channels stored between them.
 */
export function moveWatchedChannel(id: string, delta: -1 | 1, subsetIds: string[]) {
    moveWithinSubset(config.watchedChannels, id, delta, subsetIds);
}

function moveWithinSubset(master: string[], id: string, delta: -1 | 1, subsetIds: string[]) {
    const subsetPos = subsetIds.indexOf(id);
    const neighborId = subsetIds[subsetPos + delta];
    if (subsetPos === -1 || neighborId === undefined) return;

    const from = master.indexOf(id);
    const to = master.indexOf(neighborId);
    if (from === -1 || to === -1) return;

    [master[from], master[to]] = [master[to], master[from]];
    emit();
    persist();
}

export function setNotes(text: string) {
    if (typeof text !== "string") return;
    config.notes = text.slice(0, MAX_NOTES_LENGTH);
    // No emit: notes are edited through a controlled textarea; re-rendering
    // every keystroke through the global listener list is wasted work
    persist(800);
}

export function setWeatherLocation(location: WeatherLocation | null) {
    config.weatherLocation = location === null ? null : sanitizeLocation(location);
    emit();
    persist();
}

export function toggleWidgetHidden(id: WidgetId) {
    if (!WIDGET_IDS.includes(id)) return;
    const index = config.hiddenWidgets.indexOf(id);
    if (index === -1) config.hiddenWidgets.push(id);
    else config.hiddenWidgets.splice(index, 1);
    emit();
    persist();
}

export function isWidgetCollapsed(id: WidgetId) {
    return config.collapsedWidgets.includes(id);
}

export function toggleWidgetCollapsed(id: WidgetId) {
    if (!WIDGET_IDS.includes(id)) return;
    const index = config.collapsedWidgets.indexOf(id);
    if (index === -1) config.collapsedWidgets.push(id);
    else config.collapsedWidgets.splice(index, 1);
    emit();
    persist();
}

export function getEmptyBehaviour(id: WidgetId): WidgetEmptyBehaviour {
    return config.widgetEmptyBehaviour[id] ?? "show";
}

export function setEmptyBehaviour(id: WidgetId, value: WidgetEmptyBehaviour) {
    config.widgetEmptyBehaviour = sanitizeEmptyBehaviour({ ...config.widgetEmptyBehaviour, [id]: value });
    emit();
    persist();
}

export function getWidgetColumn(id: WidgetId): number {
    return config.widgetColumns[id] ?? SEED_COLUMNS[id] ?? 0;
}

/** Unlike sanitizeWidgetColumns' seed-fallback for corrupted storage, a direct
 *  call here is a computed value (a drop target, a keyboard move) - it just
 *  needs its bounds respected, not to be thrown out wholesale. */
export function setWidgetColumn(id: WidgetId, column: number) {
    if (!WIDGET_IDS.includes(id)) return;
    config.widgetColumns = { ...config.widgetColumns, [id]: clampNumber(column, 0, MAX_COLUMNS - 1, 0) };
    emit();
    persist();
}

/** Layout back to the registry's seeds: display order and column assignment
 *  only. Everything else - pins, notes, hidden widgets, bookmarks, reminders,
 *  the weather location - is content, not layout, and stays put. */
export function resetLayout() {
    config.widgetOrder = [...WIDGET_IDS];
    config.widgetColumns = { ...SEED_COLUMNS };
    emit();
    persist();
}

/** Reset layout, plus unhides whatever starts visible by default - the
 *  "start over" action, not just an arrangement undo. Still leaves pins,
 *  notes, bookmarks, reminders and the weather location alone. */
export function restoreDefaults() {
    config.widgetOrder = [...WIDGET_IDS];
    config.widgetColumns = { ...SEED_COLUMNS };
    config.hiddenWidgets = [...DEFAULT_HIDDEN_WIDGETS];
    emit();
    persist();
}

export function getQuickToolsTab(): QuickToolId {
    return config.quickToolsTab;
}

export function setQuickToolsTab(id: QuickToolId) {
    config.quickToolsTab = sanitizeQuickToolsTab(id);
    emit();
    persist();
}

export function getTimerState(): PersistedTimerState {
    return config.timerState;
}

/** Deliberately no emit(): nothing outside Quick Tools' own module-local
 *  listeners reads timerState, and QuickTools.tsx only calls this at arm/
 *  cancel - waking the whole useGlanceConfig() tree on every one of those
 *  would be the exact per-render cost this split was built to avoid. */
export function setTimerState(state: PersistedTimerState) {
    config.timerState = sanitizeTimerState(state);
    persist();
}

export function getStopwatchState(): PersistedStopwatchState {
    return config.stopwatchState;
}

/** Same reasoning as setTimerState: called only at start/pause/reset, never
 *  per tick, and never needs to wake anything outside Quick Tools itself. */
export function setStopwatchState(state: PersistedStopwatchState) {
    config.stopwatchState = sanitizeStopwatchState(state);
    persist();
}

export function isGuildCollapsed(guildKey: string) {
    return config.collapsedGuilds.includes(guildKey);
}

/** Collapse/expand a Quick Access server section (guild snowflake, or "dm") */
export function toggleGuildCollapsed(guildKey: string) {
    if (!GUILD_COLLAPSE_KEY_RE.test(guildKey)) return;
    const index = config.collapsedGuilds.indexOf(guildKey);
    if (index === -1) config.collapsedGuilds.push(guildKey);
    else config.collapsedGuilds.splice(index, 1);
    emit();
    persist();
}

/** Replaces one column's ordering wholesale (drag & drop commit) */
export function setColumnOrder(column: number, orderedIds: WidgetId[]) {
    const valid = orderedIds.filter(id => getWidgetColumn(id) === column);
    const others = config.widgetOrder.filter(id => getWidgetColumn(id) !== column);
    config.widgetOrder = sanitizeWidgetOrder([...valid, ...others]);
    emit();
    persist();
}

/** Moves a widget up/down within its own column's display order */
export function moveWidget(id: WidgetId, delta: -1 | 1) {
    // Column, not registry group. The group only seeds a first-run column now,
    // so filtering by it would shuffle a widget past neighbours it no longer
    // shares a column with.
    const column = getWidgetColumn(id);
    const columnIds = config.widgetOrder.filter(w => getWidgetColumn(w) === column);
    moveWithinSubset(config.widgetOrder, id, delta, columnIds);
}

/** Moves a widget to the column before (-1) or after (+1) its own, landing at
 *  the end of that column's order - the keyboard equivalent of dragging it
 *  across for anyone who cannot use a pointer. No-ops past the first/last column. */
export function moveWidgetColumn(id: WidgetId, delta: -1 | 1) {
    if (!WIDGET_IDS.includes(id)) return;
    const current = getWidgetColumn(id);
    const target = current + delta;
    if (target < 0 || target > MAX_COLUMNS - 1) return;

    setWidgetColumn(id, target);
    const siblings = widgetsInColumn(target).filter(w => w !== id);
    siblings.push(id);
    setColumnOrder(target, siblings);
}

/** Widgets in a column, in display order (hidden ones excluded) */
/**
 * Visible widgets in a column, in order. Plain read, for callers that already
 * subscribe to the config and cannot use a hook (a loop over columns).
 *
 * `renderedCount` folds assignments that do not fit the current width into the
 * last visible column, so a narrow window shows everything rather than hiding
 * whatever was parked on the right. This is a DISPLAY decision only: the stored
 * assignment is never rewritten, or dragging the window narrow once would
 * permanently flatten a layout the user built.
 */
export function widgetsInColumn(column: number, renderedCount = MAX_COLUMNS): WidgetId[] {
    const last = Math.max(0, renderedCount - 1);
    return config.widgetOrder.filter(id => {
        if (config.hiddenWidgets.includes(id)) return false;
        return Math.min(getWidgetColumn(id), last) === column;
    });
}

export function useOrderedWidgets(column: number, renderedCount = MAX_COLUMNS): WidgetId[] {
    useGlanceConfig();
    return widgetsInColumn(column, renderedCount);
}
