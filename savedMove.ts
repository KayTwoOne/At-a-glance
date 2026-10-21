/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The steps in front of the Move to Discord queue, and the account check
// around it. Pure: every outside thing is handed in, so tools/tests covers it.
// The queue only skips a save Discord already holds if Discord's bookmarks are
// loaded first, and a refresh that failed leaves the store looking empty, so
// nothing starts until Discord positively says its bookmarks are loaded.

import type { LocalBookmark } from "./savedRows";

/** Where the step before the queue has got to */
export type MoveGate = "checking" | "open" | "unreachable" | "loading";

export interface MoveDeps {
    /** True while a move is already under way, so a second click does nothing */
    busy(): boolean;
    /** Never rejects in practice (see ensureBookmarksLoaded); a rejection counts as unreachable anyway */
    ensureLoaded(): Promise<void>;
    /** The bookmark fetch state, read only after loading has finished */
    fetchState(): string;
    /** Whether Discord has fetched its bookmarks at all, read after loading has finished */
    hasFetched(): boolean;
    /** Whether Discord has marked its lists stale and not yet refreshed them, read after loading has finished */
    isStale(): boolean;
    /** The old saves still held locally, read after the gate so it is current */
    items(): LocalBookmark[];
    run(items: LocalBookmark[]): Promise<unknown>;
    onGate(gate: MoveGate): void;
}

/**
 * Loads Discord's bookmarks, checks they really did load, then runs the queue
 * over the old saves.
 *
 * The gate opens only when all three hold: the fetch state is LOADED_HAS_MORE
 * or LOADED_FINISHED, Discord says it has fetched (true), and its lists are
 * not stale (false). LOADING stops with "loading" (try again in a moment).
 * Anything else, including a state it does not know, a non-boolean answer or a
 * read that throws, stops with "unreachable": a swallowed failure leaves the
 * store looking empty, and an empty-looking store would make every save go to
 * Discord, turning a reminder it holds into a plain bookmark.
 *
 * Resolves "ran" once the queue has finished, "loading" or "unreachable" when
 * the gate stopped it (nothing was sent), "nothing" when no old saves were
 * left, and "busy" when a move was already under way.
 */
export async function moveToDiscord(deps: MoveDeps): Promise<"ran" | "loading" | "unreachable" | "nothing" | "busy"> {
    if (deps.busy()) return "busy";

    deps.onGate("checking");
    let verdict: "open" | "loading" | "unreachable";
    try {
        await deps.ensureLoaded();
        const state = deps.fetchState();
        if (state === "LOADING") verdict = "loading";
        else if (state !== "LOADED_HAS_MORE" && state !== "LOADED_FINISHED") verdict = "unreachable";
        else if (deps.hasFetched() !== true) verdict = "unreachable";
        else if (deps.isStale() !== false) verdict = "unreachable";
        else verdict = "open";
    } catch {
        verdict = "unreachable";
    }

    deps.onGate(verdict);
    if (verdict !== "open") return verdict;

    const items = deps.items().slice();
    if (items.length === 0) return "nothing";

    await deps.run(items);
    return "ran";
}

/** What an item is rejected with once the signed-in account is not the one the run began on */
export const ACCOUNT_CHANGED = "Account changed";

/** True only when both ids are known and equal. An unknown account is never the same one. */
export function sameAccount(startedAs: string | null | undefined, now: string | null | undefined): boolean {
    return typeof startedAs === "string" && startedAs !== "" && startedAs === now;
}

/**
 * Wraps the queue's two per-item steps so neither does anything once the
 * signed-in account is not the one the run began on. A guarded save rejects and
 * a guarded removal throws, both with ACCOUNT_CHANGED and without calling the
 * step, so the queue counts the item as failed and keeps its local copy: the
 * old list now on screen belongs to the other account, and the save would go to
 * the other account's Discord. Both ids are read at every step, not once.
 */
export function guardAccount(
    startedAs: () => string | null | undefined,
    current: () => string | null | undefined,
    steps: { save(item: LocalBookmark): Promise<void>; removeLocal(messageId: string): void; }
): { save(item: LocalBookmark): Promise<void>; removeLocal(messageId: string): void; } {
    const check = () => {
        if (!sameAccount(startedAs(), current())) throw new Error(ACCOUNT_CHANGED);
    };
    return {
        async save(item) {
            check();
            await steps.save(item);
        },
        removeLocal(messageId) {
            check();
            steps.removeLocal(messageId);
        }
    };
}
