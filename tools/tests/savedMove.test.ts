/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ACCOUNT_CHANGED, guardAccount, type MoveGate, moveToDiscord, sameAccount } from "../../savedMove";
import { createMigrationQueue, type LocalBookmark } from "../../savedRows";

const A: LocalBookmark = { channelId: "1", messageId: "10" };
const B: LocalBookmark = { channelId: "1", messageId: "11" };

interface Setup {
    log: string[];
    gates: MoveGate[];
    ran: LocalBookmark[][];
    deps: Parameters<typeof moveToDiscord>[0];
}

function setup(over: Partial<Parameters<typeof moveToDiscord>[0]> & { state?: string | (() => string); } = {}): Setup {
    const log: string[] = [];
    const gates: MoveGate[] = [];
    const ran: LocalBookmark[][] = [];
    const { state, ...rest } = over;
    const deps: Parameters<typeof moveToDiscord>[0] = {
        busy: () => false,
        ensureLoaded: async () => { log.push("ensure"); },
        fetchState: () => {
            log.push("state");
            return typeof state === "function" ? state() : state ?? "LOADED_FINISHED";
        },
        hasFetched: () => { log.push("fetched"); return true; },
        isStale: () => { log.push("stale"); return false; },
        items: () => [A, B],
        run: async items => { log.push("run"); ran.push(items); },
        onGate: gate => { gates.push(gate); },
        ...rest
    };
    return { log, gates, ran, deps };
}

test("moveToDiscord loads Discord's bookmarks, checks the fetch, then runs the queue", async () => {
    const { log, gates, ran, deps } = setup();
    assert.equal(await moveToDiscord(deps), "ran");
    assert.deepEqual(log, ["ensure", "state", "fetched", "stale", "run"]);
    assert.deepEqual(gates, ["checking", "open"]);
    assert.deepEqual(ran, [[A, B]]);
});

test("moveToDiscord hands the queue a copy, not the list it was given", async () => {
    const list = [A, B];
    const { ran, deps } = setup({ items: () => list });
    await moveToDiscord(deps);
    assert.deepEqual(ran[0], list);
    assert.notEqual(ran[0], list);
});

test("moveToDiscord stops with unreachable when the fetch failed, and sends nothing", async () => {
    const { log, gates, ran, deps } = setup({ state: "FAILED" });
    assert.equal(await moveToDiscord(deps), "unreachable");
    assert.deepEqual(log, ["ensure", "state"]);
    assert.deepEqual(gates, ["checking", "unreachable"]);
    assert.equal(ran.length, 0);
});

test("moveToDiscord treats a loading that throws as unreachable", async () => {
    const { log, gates, ran, deps } = setup({ ensureLoaded: async () => { throw new Error("offline"); } });
    assert.equal(await moveToDiscord(deps), "unreachable");
    assert.deepEqual(log, []);
    assert.deepEqual(gates, ["checking", "unreachable"]);
    assert.equal(ran.length, 0);
});

test("moveToDiscord treats a fetch state it cannot read as unreachable", async () => {
    const { gates, ran, deps } = setup({ state: () => { throw new Error("store gone"); } });
    assert.equal(await moveToDiscord(deps), "unreachable");
    assert.deepEqual(gates, ["checking", "unreachable"]);
    assert.equal(ran.length, 0);
});

test("moveToDiscord reads the fetch state only after loading has finished", async () => {
    let loaded = false;
    const { deps } = setup({
        ensureLoaded: async () => {
            await new Promise(resolve => setImmediate(resolve));
            loaded = true;
        },
        state: () => (loaded ? "LOADED_FINISHED" : "FAILED")
    });
    assert.equal(await moveToDiscord(deps), "ran");
});

test("moveToDiscord opens for both settled fetch states", async () => {
    for (const state of ["LOADED_HAS_MORE", "LOADED_FINISHED"]) {
        const { ran, deps } = setup({ state });
        assert.equal(await moveToDiscord(deps), "ran", state);
        assert.equal(ran.length, 1, state);
    }
});

test("moveToDiscord asks the person to wait while Discord is still loading, and sends nothing", async () => {
    const { log, gates, ran, deps } = setup({ state: "LOADING" });
    assert.equal(await moveToDiscord(deps), "loading");
    assert.deepEqual(log, ["ensure", "state"]);
    assert.deepEqual(gates, ["checking", "loading"]);
    assert.equal(ran.length, 0);
});

test("moveToDiscord treats a fetch state it does not know as unreachable", async () => {
    for (const state of ["", "SOMETHING_NEW", "loaded_finished"]) {
        const { gates, ran, deps } = setup({ state });
        assert.equal(await moveToDiscord(deps), "unreachable", state);
        assert.deepEqual(gates, ["checking", "unreachable"], state);
        assert.equal(ran.length, 0, state);
    }
});

test("moveToDiscord stops when Discord reports nothing fetched, even with a settled state", async () => {
    const { log, gates, ran, deps } = setup({ hasFetched: () => false });
    assert.equal(await moveToDiscord(deps), "unreachable");
    assert.deepEqual(gates, ["checking", "unreachable"]);
    assert.equal(ran.length, 0);
    assert.ok(!log.includes("run"));
});

test("moveToDiscord stops when Discord's lists are still marked stale", async () => {
    const { gates, ran, deps } = setup({ isStale: () => true });
    assert.equal(await moveToDiscord(deps), "unreachable");
    assert.deepEqual(gates, ["checking", "unreachable"]);
    assert.equal(ran.length, 0);
});

test("moveToDiscord needs a true hasFetched and a false isStale, not merely truthy ones", async () => {
    const odd = [
        { hasFetched: () => undefined as unknown as boolean },
        { hasFetched: () => 1 as unknown as boolean },
        { isStale: () => undefined as unknown as boolean },
        { isStale: () => 0 as unknown as boolean }
    ];
    for (const over of odd) {
        const { ran, deps } = setup(over);
        assert.equal(await moveToDiscord(deps), "unreachable", Object.keys(over).join());
        assert.equal(ran.length, 0);
    }
});

test("moveToDiscord treats a throwing hasFetched or isStale as unreachable", async () => {
    const boom = () => { throw new Error("store gone"); };
    for (const over of [{ hasFetched: boom }, { isStale: boom }]) {
        const { gates, ran, deps } = setup(over);
        assert.equal(await moveToDiscord(deps), "unreachable");
        assert.deepEqual(gates, ["checking", "unreachable"]);
        assert.equal(ran.length, 0);
    }
});

test("moveToDiscord reads all three checks after loading has finished", async () => {
    let loaded = false;
    const reads: boolean[] = [];
    const { deps } = setup({
        ensureLoaded: async () => {
            await new Promise(resolve => setImmediate(resolve));
            loaded = true;
        },
        hasFetched: () => { reads.push(loaded); return true; },
        isStale: () => { reads.push(loaded); return false; }
    });
    await moveToDiscord(deps);
    assert.deepEqual(reads, [true, true]);
});

test("moveToDiscord does nothing while another move is under way", async () => {
    const { log, gates, ran, deps } = setup({ busy: () => true });
    assert.equal(await moveToDiscord(deps), "busy");
    assert.deepEqual(log, []);
    assert.deepEqual(gates, []);
    assert.equal(ran.length, 0);
});

test("moveToDiscord has nothing to do once the old list is empty", async () => {
    const { gates, ran, deps } = setup({ items: () => [] });
    assert.equal(await moveToDiscord(deps), "nothing");
    assert.deepEqual(gates, ["checking", "open"]);
    assert.equal(ran.length, 0);
});

test("moveToDiscord reads the old list after the gate, not before", async () => {
    let list = [A];
    const { ran, deps } = setup({
        ensureLoaded: async () => { list = [A, B]; },
        items: () => list
    });
    await moveToDiscord(deps);
    assert.deepEqual(ran[0], [A, B]);
});

test("moveToDiscord leaves the gate open if the queue itself throws", async () => {
    const { gates, deps } = setup({ run: async () => { throw new Error("boom"); } });
    await assert.rejects(moveToDiscord(deps), /boom/);
    assert.deepEqual(gates, ["checking", "open"]);
});

test("moveToDiscord drives the real queue: a held or saved message goes, a refused one stays", async () => {
    const local = [A, B];
    const removed: string[] = [];
    const queue = createMigrationQueue({
        save: async item => { if (item.messageId === B.messageId) throw { message: "rate limited" }; },
        removeLocal: id => { removed.push(id); },
        wait: async () => {},
        onChange: () => {}
    });
    const { deps } = setup({ items: () => local, run: items => queue.run(items) });
    assert.equal(await moveToDiscord(deps), "ran");
    const final = queue.state();
    assert.equal(final.done, 1);
    assert.deepEqual(final.failed, [{ messageId: B.messageId, reason: "rate limited" }]);
    assert.deepEqual(removed, [A.messageId]);
});

// sameAccount and guardAccount

test("sameAccount is true only for the same, known account", () => {
    assert.equal(sameAccount("100", "100"), true);
    assert.equal(sameAccount("100", "200"), false);
    assert.equal(sameAccount("100", null), false);
    assert.equal(sameAccount("100", undefined), false);
    assert.equal(sameAccount(null, null), false);
    assert.equal(sameAccount(undefined, undefined), false);
    assert.equal(sameAccount("", ""), false);
});

function steps() {
    const calls: string[] = [];
    return {
        calls,
        save: async (item: LocalBookmark) => { calls.push("save " + item.messageId); },
        removeLocal: (messageId: string) => { calls.push("remove " + messageId); }
    };
}

test("guardAccount lets both steps through while the account is the one the run began on", async () => {
    const s = steps();
    const guarded = guardAccount(() => "100", () => "100", s);
    await guarded.save(A);
    guarded.removeLocal(A.messageId);
    assert.deepEqual(s.calls, ["save 10", "remove 10"]);
});

test("guardAccount refuses a save on another account, without calling the step", async () => {
    const s = steps();
    const guarded = guardAccount(() => "100", () => "200", s);
    await assert.rejects(guarded.save(A), { message: ACCOUNT_CHANGED });
    assert.deepEqual(s.calls, []);
});

test("guardAccount refuses to remove a local copy on another account, without calling the step", () => {
    const s = steps();
    const guarded = guardAccount(() => "100", () => "200", s);
    assert.throws(() => guarded.removeLocal(A.messageId), { message: ACCOUNT_CHANGED });
    assert.deepEqual(s.calls, []);
});

test("guardAccount refuses everything when the run began with no known account, or the account is lost", async () => {
    const s = steps();
    const unknownStart = guardAccount(() => null, () => "100", s);
    await assert.rejects(unknownStart.save(A), { message: ACCOUNT_CHANGED });
    const lost = guardAccount(() => "100", () => null, s);
    assert.throws(() => lost.removeLocal(A.messageId), { message: ACCOUNT_CHANGED });
    assert.deepEqual(s.calls, []);
});

test("guardAccount reads both accounts at each step, so a switch part-way through is caught", async () => {
    const s = steps();
    let current = "100";
    const guarded = guardAccount(() => "100", () => current, s);
    await guarded.save(A);
    current = "200";
    await assert.rejects(guarded.save(B), { message: ACCOUNT_CHANGED });
    assert.deepEqual(s.calls, ["save 10"]);
});

test("an account switch part-way through a run keeps every local copy and counts the rest failed", async () => {
    const local = [A, B];
    const removed: string[] = [];
    let current = "100";
    const guarded = guardAccount(() => "100", () => current, {
        save: async () => { current = "200"; },
        removeLocal: id => { removed.push(id); }
    });
    const queue = createMigrationQueue({ ...guarded, wait: async () => {}, onChange: () => {} });
    const final = await queue.run(local);
    // The first save went through on the account it began on, but by the time
    // its local copy would go the list is the other account's, so it stays too
    assert.deepEqual(removed, []);
    assert.equal(final.done, 0);
    assert.deepEqual(final.failed.map(f => f.reason), [ACCOUNT_CHANGED, ACCOUNT_CHANGED]);
});
