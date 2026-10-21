/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { type HeldStore, saveUnlessHeld } from "../../savedGuard";

const item = { channelId: "100", messageId: "200" };

function store(bookmarked: boolean, reminder: boolean) {
    const asked: string[] = [];
    const held: HeldStore = {
        isMessageBookmarked(c, m) { asked.push(`bookmarked ${c}-${m}`); return bookmarked; },
        isMessageReminder(c, m) { asked.push(`reminder ${c}-${m}`); return reminder; }
    };
    return { held, asked };
}

function recorder(result: "resolve" | "reject" = "resolve") {
    const sent: unknown[] = [];
    const save = async (target: unknown) => {
        sent.push(target);
        if (result === "reject") throw { message: "rate limited" };
    };
    return { save, sent };
}

test("saveUnlessHeld sends a message Discord does not hold, with only its ids", async () => {
    const { held, asked } = store(false, false);
    const { save, sent } = recorder();
    const result = await saveUnlessHeld(held, save, { ...item, extra: "ignored" } as typeof item);
    assert.equal(result, "saved");
    assert.deepEqual(sent, [{ channelId: "100", messageId: "200" }]);
    assert.deepEqual(asked, ["bookmarked 100-200", "reminder 100-200"]);
});

test("saveUnlessHeld sends nothing when Discord already holds a bookmark", async () => {
    const { held } = store(true, false);
    const { save, sent } = recorder();
    assert.equal(await saveUnlessHeld(held, save, item), "held");
    assert.deepEqual(sent, []);
});

test("saveUnlessHeld sends nothing when Discord already holds a reminder, so its due time is kept", async () => {
    const { held } = store(false, true);
    const { save, sent } = recorder();
    assert.equal(await saveUnlessHeld(held, save, item), "held");
    assert.deepEqual(sent, []);
});

test("saveUnlessHeld sends nothing when Discord holds it both ways", async () => {
    const { held } = store(true, true);
    const { save, sent } = recorder();
    assert.equal(await saveUnlessHeld(held, save, item), "held");
    assert.deepEqual(sent, []);
});

test("saveUnlessHeld rejects, and sends nothing, when the store cannot answer", async () => {
    const { save, sent } = recorder();

    const noBookmarkCheck = { isMessageReminder: () => false } as unknown as HeldStore;
    await assert.rejects(saveUnlessHeld(noBookmarkCheck, save, item), /Cannot tell whether Discord already holds/);

    const noReminderCheck = { isMessageBookmarked: () => false } as unknown as HeldStore;
    await assert.rejects(saveUnlessHeld(noReminderCheck, save, item), /Cannot tell whether Discord already holds/);

    const throwing: HeldStore = {
        isMessageBookmarked() { throw new Error("proxyLazy called on a primitive value"); },
        isMessageReminder: () => false
    };
    await assert.rejects(saveUnlessHeld(throwing, save, item), /Cannot tell whether Discord already holds/);

    const throwingReminder: HeldStore = {
        isMessageBookmarked: () => false,
        isMessageReminder() { throw new Error("boom"); }
    };
    await assert.rejects(saveUnlessHeld(throwingReminder, save, item), /Cannot tell whether Discord already holds/);

    assert.deepEqual(sent, []);
});

test("saveUnlessHeld rejects when an answer is not a boolean, rather than treating it as no", async () => {
    const { save, sent } = recorder();
    const vague = { isMessageBookmarked: () => undefined, isMessageReminder: () => false } as unknown as HeldStore;
    await assert.rejects(saveUnlessHeld(vague, save, item), /Cannot tell/);
    const vagueReminder = { isMessageBookmarked: () => false, isMessageReminder: () => null } as unknown as HeldStore;
    await assert.rejects(saveUnlessHeld(vagueReminder, save, item), /Cannot tell/);
    assert.deepEqual(sent, []);
});

test("saveUnlessHeld keeps the original error as the cause of a refusal", async () => {
    const original = new Error("boom");
    const throwing: HeldStore = { isMessageBookmarked() { throw original; }, isMessageReminder: () => false };
    await assert.rejects(saveUnlessHeld(throwing, recorder().save, item), (error: Error & { cause?: unknown; }) => error.cause === original);
});

test("saveUnlessHeld passes on a failed save, so the caller keeps its local copy", async () => {
    const { held } = store(false, false);
    const { save } = recorder("reject");
    await assert.rejects(saveUnlessHeld(held, save, item), (error: { message?: string; }) => error.message === "rate limited");
});
