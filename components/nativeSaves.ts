/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { filters, findStoreLazy, mapMangledModuleLazy } from "@webpack";
import { useStateFromStores } from "@webpack/common";

import { finders } from "../discordChecks";
import { saveUnlessHeld } from "../savedGuard";
import { isNativeAvailable, type LocalBookmark, type SavedEntry } from "../savedRows";

const logger = new Logger("AtAGlance");

// Discord's own bookmarks and message reminders (Inbox > Bookmarks and
// Reminders). This file is the only place the plugin touches them, so a change
// on Discord's side lands here. Nothing below is read at module scope: both
// lookups are lazy and only resolve on first use, and a lazy used in the same
// tick it was made hands back a stand-in that always looks like a function, so
// nativeSavesAvailable() must not be called while the plugin is loading.

export type BookmarksFetchState = "LOADING" | "LOADED_HAS_MORE" | "LOADED_FINISHED" | "FAILED";

/** What SavedMessagesStore answers; only the methods this bridge calls */
export interface SavedMessagesStoreLike {
    /** Bookmarks fetched so far, newest first */
    getMessageBookmarks(): SavedEntry[];
    /** Reminders, by due time */
    getMessageReminders(): SavedEntry[];
    /** Every bookmark Discord knows of, fetched or not */
    getBookmarkCount(): number;
    getOverdueMessageReminderCount(): number;
    getBookmarksFetchState(): BookmarksFetchState;
    hasFetchedBookmarks(): boolean;
    /** True for a bookmark (no due time) only; a reminder is not one */
    isMessageBookmarked(channelId: string, messageId: string): boolean;
    /** True for a message saved with a due time */
    isMessageReminder(channelId: string, messageId: string): boolean;
    getIsStale(): boolean;
}

/** The four actions Discord's saved messages module exports, by the names given here */
export interface SavedMessageActionsLike {
    /** A bookmark when dueAt is left out, a reminder when it is set. Saving again changes the time */
    save(args: { channelId: string; messageId: string; dueAt?: Date; source?: string; }): Promise<SavedEntry>;
    remove(args: { channelId: string; messageId: string; }): Promise<boolean>;
    /** Reloads reminders and bookmark ids when Discord has marked them stale; does nothing otherwise */
    refreshIfStale(): Promise<void>;
    /** 25 bookmarks at a time; loadMore asks for the next 25 */
    fetchBookmarks(args?: { loadMore?: boolean; }): Promise<void>;
}

export const SavedMessagesStore = findStoreLazy(finders.savedMessagesStore.name) as SavedMessagesStoreLike;

// The module is found by its manifest strings (spread: the manifest is a
// readonly tuple, the finder wants a plain array), and each export is picked
// out by a string inside its own function
export const SavedMessageActions = mapMangledModuleLazy([...finders.savedMessageActions.strings], {
    save: filters.byCode("PUT_SAVED_MESSAGE"),
    remove: filters.byCode("DELETE_SAVED_MESSAGE"),
    refreshIfStale: filters.byCode("getIsStale"),
    fetchBookmarks: filters.byCode("GET_BOOKMARKS")
}) as SavedMessageActionsLike;

// A failure is logged the first time only: a hook runs on every render and a
// failing one would otherwise fill the console
const logged = new Set<string>();
function failedOnce(what: string, error: unknown) {
    if (logged.has(what)) return;
    logged.add(what);
    logger.error(`Discord's saved messages: ${what} failed`, error);
}

let available = false;

/**
 * True when Discord's saved messages store and actions were found and have the
 * parts used here. Probed on demand and kept once true; while false it probes
 * again on the next call, in case Discord's code had not loaded yet.
 */
export function nativeSavesAvailable(): boolean {
    if (available) return true;
    available = isNativeAvailable(SavedMessagesStore, SavedMessageActions);
    if (!available && !logged.has("lookup")) {
        logged.add("lookup");
        logger.warn("Discord's saved messages store or actions were not found, so the local list is used");
    }
    return available;
}

const NO_ENTRIES: SavedEntry[] = [];

// One reading from the store: a failed read gives the fallback, and the same
// failure is not logged twice
function readStore<T>(what: string, read: () => T | null | undefined, fallback: T): T {
    try {
        return read() ?? fallback;
    } catch (error) {
        failedOnce(what, error);
        return fallback;
    }
}

const readEntries = (what: string, read: () => SavedEntry[] | null | undefined) =>
    readStore<SavedEntry[]>(what, () => {
        const list = read();
        return Array.isArray(list) ? list : null;
    }, NO_ENTRIES);

// The stores a hook listens to. Empty when Discord's is missing, so a hook
// cannot throw while subscribing, and the readings below fall back instead.
const watched = () => nativeSavesAvailable() ? [SavedMessagesStore] : [];

export interface NativeBookmarks {
    /** The bookmarks Discord has fetched so far, newest first */
    entries: SavedEntry[];
    /** All of the user's bookmarks, including ones not fetched yet */
    count: number;
    fetchState: BookmarksFetchState;
    hasFetched: boolean;
}

// Each value is read on its own, so each one is stable from render to render:
// the store hands back the same array until something changes (it keeps one
// copy per change), and the rest are plain numbers, strings and booleans.
// getLastChanged() is no use as a change marker here; the store only moves it
// when an entry is added or deleted, not when one is updated.

/**
 * Discord's bookmarks, live. Render a component that calls this only when
 * nativeSavesAvailable() is true: it subscribes to Discord's lazily found
 * store, and with the store missing it can only hand back empty values.
 *
 * `entries` is Discord's own array, shared with its store and the same
 * between changes. Never change it; copy it first before sorting, filtering
 * or reversing.
 */
export function useNativeBookmarks(): NativeBookmarks {
    const stores = watched();
    const entries = useStateFromStores(stores, () => readEntries("reading bookmarks", () => SavedMessagesStore.getMessageBookmarks()), []);
    const count = useStateFromStores(stores, () => readStore("counting bookmarks", () => SavedMessagesStore.getBookmarkCount(), 0), []);
    const fetchState = useStateFromStores(stores, () => readStore<BookmarksFetchState>("reading the bookmark fetch state", () => SavedMessagesStore.getBookmarksFetchState(), "LOADED_FINISHED"), []);
    const hasFetched = useStateFromStores(stores, () => readStore("reading whether bookmarks were fetched", () => SavedMessagesStore.hasFetchedBookmarks(), false), []);
    return { entries, count, fetchState, hasFetched };
}

export interface NativeReminders {
    /** Discord's reminders, by due time, overdue ones first */
    entries: SavedEntry[];
    overdueCount: number;
}

/**
 * Discord's message reminders, live. Render a component that calls this only
 * when nativeSavesAvailable() is true: it subscribes to Discord's lazily found
 * store, and with the store missing it can only hand back empty values.
 *
 * `entries` is Discord's own array, shared with its store and the same
 * between changes. Never change it; copy it first before sorting, filtering
 * or reversing.
 */
export function useNativeReminders(): NativeReminders {
    const stores = watched();
    const entries = useStateFromStores(stores, () => readEntries("reading reminders", () => SavedMessagesStore.getMessageReminders()), []);
    const overdueCount = useStateFromStores(stores, () => readStore("counting overdue reminders", () => SavedMessagesStore.getOverdueMessageReminderCount(), 0), []);
    return { entries, overdueCount };
}

// Reading from Discord: a failure is logged once and otherwise ignored, since
// the widgets simply carry on with what is already loaded
async function fetchFromDiscord(what: string, run: () => Promise<void>): Promise<void> {
    try {
        if (!nativeSavesAvailable()) return;
        await run();
    } catch (error) {
        failedOnce(what, error);
    }
}

/** Asks Discord for the next 25 bookmarks. Discord does nothing if there is no more, or a fetch is under way */
export function loadMoreBookmarks(): Promise<void> {
    return fetchFromDiscord("loading more bookmarks", () => SavedMessageActions.fetchBookmarks({ loadMore: true }));
}

/**
 * Makes sure the first bookmarks are loaded. Discord refreshes the lists after
 * each connection, but not necessarily before the dashboard first opens, so
 * this waits for a refresh if one is due and fetches the first 25 if none has
 * been. It never rejects: a failure is logged once and the call just returns.
 */
export function ensureBookmarksLoaded(): Promise<void> {
    return fetchFromDiscord("loading bookmarks", async () => {
        await SavedMessageActions.refreshIfStale();
        if (!SavedMessagesStore.hasFetchedBookmarks()) await SavedMessageActions.fetchBookmarks({});
    });
}

// Writing to Discord: a failure is logged once and then thrown on, because the
// caller has to know. Moving a local save across removes the local copy only
// once this resolves, so swallowing a failure here would lose the save.
async function writeToDiscord<T>(what: string, run: () => Promise<T>): Promise<T> {
    try {
        if (!nativeSavesAvailable()) throw new Error("Discord's saved messages are not available");
        return await run();
    } catch (error) {
        failedOnce(what, error);
        throw error;
    }
}

type SavedRef = { saveData: { channelId: string; messageId: string; }; };

/**
 * Takes a bookmark or reminder off the user's list in Discord. Rejects if
 * Discord refuses or is not available, after logging it once, so every caller
 * must catch.
 */
export async function removeSaved(entry: SavedRef): Promise<void> {
    const { channelId, messageId } = entry.saveData;
    await writeToDiscord("removing a saved message", () => SavedMessageActions.remove({ channelId, messageId }));
}

/**
 * Sets a reminder to go off `ms` from now, by saving it again with the new
 * time. Rejects if `ms` is not a finite number, or if Discord refuses or is not
 * available, after logging it once, so every caller must catch.
 */
export async function snoozeReminder(entry: SavedRef, ms: number): Promise<void> {
    // An invalid date would reach Discord as no time at all, which turns the
    // reminder into a plain bookmark
    if (!Number.isFinite(ms)) {
        const error = new Error("Cannot snooze for an unknown length of time");
        failedOnce("snoozing a reminder for an unknown length of time", error);
        throw error;
    }
    const { channelId, messageId } = entry.saveData;
    const dueAt = new Date(Date.now() + ms);
    await writeToDiscord("snoozing a reminder", () => SavedMessageActions.save({ channelId, messageId, dueAt }));
}

/**
 * Saves an old local bookmark to Discord as a bookmark with no reminder time.
 *
 * If Discord already holds the message, as a bookmark or as a reminder, it
 * resolves without sending anything: a save with no time would turn an
 * existing reminder into a plain bookmark and lose its due time. The local
 * copy is then safe to drop, since Discord has the message.
 *
 * Callers must await ensureBookmarksLoaded() before starting a run of these
 * (the Move to Discord queue does). Until Discord's first refresh has landed,
 * the store holds no bookmark ids, so it would answer "not held" for
 * everything. If the store cannot answer at all this rejects instead of
 * guessing.
 *
 * Rejects if Discord refuses or is not available, after logging it once, so
 * every caller must catch. The migration queue relies on that: it removes a
 * local copy only after this resolves.
 */
export async function saveLocalToDiscord(local: LocalBookmark): Promise<void> {
    const { channelId, messageId } = local;
    await writeToDiscord("saving a local bookmark", async () => {
        await saveUnlessHeld(SavedMessagesStore, item => SavedMessageActions.save(item), { channelId, messageId });
    });
}
