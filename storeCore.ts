/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The load/save state machine behind data.ts. Pure: no imports, so
// tools/tests drives it with fake storage and fake timers.
//
// The rule it exists for: nothing is written until this account's saved
// data has been read, and it is only ever written back to the account it
// was read for. A failed read used to swap in an empty config and mark it
// loaded, so the next click saved the empty config over the real one.

export type LoadState = "idle" | "loading" | "ready" | "failed";

// A failed load retries after each of these in turn, then keeps going at the
// last one for as long as it stays failed.
export const RETRY_DELAYS_MS = [2_000, 10_000, 30_000];

export interface StoreDeps<T> {
    read(key: string): Promise<unknown>;
    write(key: string, value: T): Promise<void>;
    remove(key: string): Promise<void>;
    currentUserId(): string | null | undefined;
    keyFor(userId: string): string;
    legacyKeyFor(userId: string): string;
    sanitize(raw: unknown): T;
    fresh(): T;
    setTimer(fn: () => void, ms: number): unknown;
    clearTimer(handle: unknown): void;
    onError?(message: string, error: unknown): void;
    /** After any change of state or of which config object is current */
    onChange(): void;
    /** Once per successful load, after the config is replaced and before onChange */
    onLoaded?(config: T): void;
}

export interface ConfigStore<T> {
    get(): T;
    state(): LoadState;
    owner(): string | null;
    canWrite(): boolean;
    load(): Promise<void>;
    retryNow(): Promise<void>;
    persist(debounceMs?: number): void;
    reset(): Promise<void>;
}

export function createConfigStore<T>(deps: StoreDeps<T>): ConfigStore<T> {
    let config = deps.fresh();
    let state: LoadState = "idle";
    // The account `config` was read for. Writes go to this account only.
    let owner: string | null = null;
    // Bumped by every load and reset; a load whose number is stale is dropped.
    let seq = 0;
    let retryIndex = 0;
    let retryHandle: unknown = null;
    let persistHandle: unknown = null;
    let persistPending = false;

    function setState(next: LoadState) {
        state = next;
        deps.onChange();
    }

    async function writeTo(userId: string, value: T) {
        try {
            await deps.write(deps.keyFor(userId), value);
        } catch (e) {
            deps.onError?.("Failed to save config", e);
        }
    }

    function clearPersistTimer() {
        if (persistHandle !== null) {
            deps.clearTimer(persistHandle);
            persistHandle = null;
        }
    }

    function cancelRetry() {
        if (retryHandle !== null) {
            deps.clearTimer(retryHandle);
            retryHandle = null;
        }
    }

    /** Writes a pending debounced save now, to the account it belongs to. */
    async function flush() {
        clearPersistTimer();
        if (!persistPending) return;
        persistPending = false;
        if (state === "ready" && owner) await writeTo(owner, config);
    }

    function scheduleRetry() {
        cancelRetry();
        const delay = RETRY_DELAYS_MS[Math.min(retryIndex++, RETRY_DELAYS_MS.length - 1)];
        retryHandle = deps.setTimer(() => {
            retryHandle = null;
            void load();
        }, delay);
    }

    async function readWithMigration(userId: string): Promise<unknown> {
        const raw = await deps.read(deps.keyFor(userId));
        if (raw !== undefined) return raw;
        const legacy = await deps.read(deps.legacyKeyFor(userId));
        if (legacy === undefined) return undefined;
        // The legacy key goes only once the new one is safely written
        try {
            await deps.write(deps.keyFor(userId), deps.sanitize(legacy));
            await deps.remove(deps.legacyKeyFor(userId)).catch(() => { });
        } catch (e) {
            deps.onError?.("Failed to migrate the legacy config", e);
        }
        return legacy;
    }

    async function load() {
        const userId = deps.currentUserId();
        if (!userId) return;

        // Same account, already loaded (a reconnect): its data is already in
        // memory and nothing else writes its key, so there is nothing to
        // re-read. Just land any pending edit. Re-reading would replace the
        // live config object and drop an edit made while the read was in flight.
        if (state === "ready" && owner === userId) {
            await flush();
            return;
        }

        const mine = ++seq;
        cancelRetry();

        // A different account, or nothing loaded yet. The previous account's
        // pending edit goes to the previous account's key, then nothing of it
        // is shown or written again.
        const previous = owner;
        const snapshot = config;
        const pending = persistPending && state === "ready";
        clearPersistTimer();
        persistPending = false;
        owner = null;
        config = deps.fresh();
        // A retry from "failed" reads without announcing "loading": the panel
        // keeps saying it failed until the read answers, rather than flashing
        // the loading line every time the retry timer fires. Nothing is
        // pending or shown from a failed state, so only the label stays put.
        if (state !== "failed") setState("loading");
        if (pending && previous) await writeTo(previous, snapshot);

        let raw: unknown;
        try {
            raw = await readWithMigration(userId);
        } catch (e) {
            if (mine !== seq) return;
            deps.onError?.("Failed to load config", e);
            owner = null;
            config = deps.fresh();
            setState("failed");
            scheduleRetry();
            return;
        }

        if (mine !== seq || deps.currentUserId() !== userId) return;
        config = deps.sanitize(raw);
        owner = userId;
        retryIndex = 0;
        state = "ready";
        deps.onLoaded?.(config);
        deps.onChange();
    }

    function persist(debounceMs = 0) {
        if (state !== "ready" || !owner) return;
        persistPending = true;
        clearPersistTimer();
        const target = owner;
        persistHandle = deps.setTimer(() => {
            persistHandle = null;
            if (!persistPending) return;
            persistPending = false;
            if (state === "ready" && owner === target) void writeTo(target, config);
        }, debounceMs);
    }

    async function reset() {
        const mine = ++seq;
        cancelRetry();
        await flush();
        if (mine !== seq) return;
        owner = null;
        config = deps.fresh();
        retryIndex = 0;
        setState("idle");
    }

    return {
        get: () => config,
        state: () => state,
        owner: () => owner,
        canWrite: () => state === "ready" && owner !== null && owner === deps.currentUserId(),
        load,
        retryNow: () => {
            retryIndex = 0;
            return load();
        },
        persist,
        reset
    };
}
