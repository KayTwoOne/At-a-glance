/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The check that stands between an old local save and Discord. Pure: no
// imports, so tools/tests covers it. Saving a message to Discord with no due
// time is a bookmark, and doing that to a message Discord already holds as a
// reminder would drop its due time. So a message Discord already holds is
// never sent again, and when this cannot tell whether Discord holds it, it
// refuses rather than guess.

/** The two questions it asks SavedMessagesStore */
export interface HeldStore {
    isMessageBookmarked(channelId: string, messageId: string): boolean;
    isMessageReminder(channelId: string, messageId: string): boolean;
}

export interface SaveTarget { channelId: string; messageId: string; }

// A boolean answer from the store, or a refusal. Anything else (a missing
// method, a throw, a non-boolean) means the store cannot be trusted to have
// said "no", and a wrong "no" is the one answer that loses data.
function answer(ask: () => unknown): boolean {
    let result: unknown;
    try {
        result = ask();
    } catch (cause) {
        throw Object.assign(new Error("Cannot tell whether Discord already holds this message"), { cause });
    }
    if (typeof result !== "boolean") throw new Error("Cannot tell whether Discord already holds this message");
    return result;
}

/**
 * Sends `item` to Discord with `save` unless Discord already holds it as a
 * bookmark or a reminder. Resolves "held" without sending anything in that
 * case, "saved" once `save` has resolved, and rejects if `save` rejects or if
 * the store cannot say whether it holds the message.
 */
export async function saveUnlessHeld(
    store: HeldStore,
    save: (item: SaveTarget) => Promise<unknown>,
    item: SaveTarget
): Promise<"saved" | "held"> {
    const { channelId, messageId } = item;

    if (answer(() => store.isMessageBookmarked(channelId, messageId))) return "held";
    if (answer(() => store.isMessageReminder(channelId, messageId))) return "held";

    await save({ channelId, messageId });
    return "saved";
}
