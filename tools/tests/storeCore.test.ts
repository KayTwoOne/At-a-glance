/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { type ConfigStore, createConfigStore, RETRY_DELAYS_MS, type StoreDeps } from "../../storeCore";

interface Cfg { notes: string; }
interface Deferred { key: string; resolve(value: unknown): void; reject(error: unknown): void; }

const A = "111111111111111111";
const B = "222222222222222222";
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(initial: Record<string, unknown> = {}) {
    const disk = new Map<string, unknown>(Object.entries(initial));
    const timers = new Map<number, { fn: () => void; ms: number; }>();
    let nextTimer = 1;
    const h = {
        disk,
        timers,
        writes: [] as [string, unknown][],
        removed: [] as string[],
        deferred: [] as Deferred[],
        errors: [] as string[],
        // The store's state at every onChange, in order
        states: [] as string[],
        loaded: 0,
        reads: 0,
        user: A as string | null,
        failNextReads: 0,
        failWrites: false,
        deferReads: false,
        runTimers() {
            for (const [id, timer] of [...timers]) {
                timers.delete(id);
                timer.fn();
            }
        }
    };
    const deps: StoreDeps<Cfg> = {
        read: key => {
            h.reads++;
            if (h.deferReads) return new Promise((resolve, reject) => h.deferred.push({ key, resolve, reject }));
            if (h.failNextReads > 0) {
                h.failNextReads--;
                return Promise.reject(new Error("IndexedDB read failed"));
            }
            return Promise.resolve(disk.get(key));
        },
        write: async (key, value) => {
            if (h.failWrites) throw new Error("IndexedDB write failed");
            h.writes.push([key, structuredClone(value)]);
            disk.set(key, structuredClone(value));
        },
        remove: async key => {
            h.removed.push(key);
            disk.delete(key);
        },
        currentUserId: () => h.user,
        keyFor: id => `AtAGlance_${id}`,
        legacyKeyFor: id => `Dashboard_${id}`,
        sanitize: raw => ({ notes: typeof (raw as any)?.notes === "string" ? (raw as any).notes : "" }),
        fresh: () => ({ notes: "" }),
        setTimer: (fn, ms) => {
            const id = nextTimer++;
            timers.set(id, { fn, ms });
            return id;
        },
        clearTimer: handle => void timers.delete(handle as number),
        onError: message => void h.errors.push(message),
        // `store` is declared below; onChange only ever runs after it exists
        onChange: () => void h.states.push(store.state()),
        onLoaded: () => void h.loaded++
    };
    const store: ConfigStore<Cfg> = createConfigStore(deps);
    return { h, store };
}

test("a successful read makes the store ready for that account", async () => {
    const { h, store } = harness({ [`AtAGlance_${A}`]: { notes: "hello" } });
    await store.load();
    assert.equal(store.state(), "ready");
    assert.equal(store.owner(), A);
    assert.equal(store.get().notes, "hello");
    assert.equal(store.canWrite(), true);
    assert.equal(h.loaded, 1);
});

test("a failed read writes nothing, refuses writes and schedules a retry", async () => {
    const { h, store } = harness({ [`AtAGlance_${A}`]: { notes: "keep me" } });
    h.failNextReads = 1;
    await store.load();
    assert.equal(store.state(), "failed");
    assert.equal(store.canWrite(), false);
    store.get().notes = "an edit made while failed";
    store.persist();
    assert.deepEqual(h.writes, []);
    assert.deepEqual([...h.timers.values()].map(t => t.ms), [RETRY_DELAYS_MS[0]]);
    assert.equal(h.disk.get(`AtAGlance_${A}`) && (h.disk.get(`AtAGlance_${A}`) as Cfg).notes, "keep me");
});

test("a retry recovers the stored data without writing", async () => {
    const { h, store } = harness({ [`AtAGlance_${A}`]: { notes: "keep me" } });
    h.failNextReads = 1;
    await store.load();
    h.runTimers();
    await settle();
    assert.equal(store.state(), "ready");
    assert.equal(store.get().notes, "keep me");
    assert.deepEqual(h.writes, []);
});

test("a retry from failed stays failed until it succeeds", async () => {
    const { h, store } = harness({ [`AtAGlance_${A}`]: { notes: "keep me" } });
    h.failNextReads = 1;
    await store.load();
    assert.equal(store.state(), "failed");
    h.states.length = 0;
    h.deferReads = true;
    h.runTimers();
    await settle();
    assert.equal(store.state(), "failed");
    h.deferred[0].resolve({ notes: "keep me" });
    await settle();
    assert.equal(store.state(), "ready");
    assert.equal(store.get().notes, "keep me");
    // The failed panel never flickered to the loading line on the way
    assert.deepEqual(h.states, ["ready"]);
});

test("a retry that fails again stays failed, and schedules the next one", async () => {
    const { h, store } = harness();
    h.failNextReads = 2;
    await store.load();
    h.states.length = 0;
    h.runTimers();
    await settle();
    assert.equal(store.state(), "failed");
    assert.ok(!h.states.includes("loading"));
    assert.deepEqual([...h.timers.values()].map(t => t.ms), [RETRY_DELAYS_MS[1]]);
});

test("switching account from failed still clears the old config and owner", async () => {
    const { h, store } = harness({ [`AtAGlance_${B}`]: { notes: "bee" } });
    h.failNextReads = 1;
    await store.load();
    store.get().notes = "scribble made while failed";
    h.user = B;
    h.deferReads = true;
    const pending = store.load();
    await settle();
    assert.equal(store.state(), "failed");
    assert.equal(store.owner(), null);
    assert.equal(store.get().notes, "");
    h.deferred[0].resolve({ notes: "bee" });
    await pending;
    assert.equal(store.state(), "ready");
    assert.equal(store.owner(), B);
    assert.equal(store.get().notes, "bee");
});

test("retries continue every 30 seconds after the first three", async () => {
    const { h, store } = harness();
    h.failNextReads = 99;
    await store.load();
    for (const delay of RETRY_DELAYS_MS) {
        assert.deepEqual([...h.timers.values()].map(t => t.ms), [delay]);
        h.runTimers();
        await settle();
    }
    const last = RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    for (let round = 0; round < 2; round++) {
        assert.equal(store.state(), "failed");
        assert.deepEqual([...h.timers.values()].map(t => t.ms), [last]);
        h.runTimers();
        await settle();
    }
    assert.equal(store.state(), "failed");
    assert.deepEqual([...h.timers.values()].map(t => t.ms), [last]);
});

test("retryNow starts again from the first delay", async () => {
    const { h, store } = harness();
    h.failNextReads = 99;
    await store.load();
    h.runTimers();
    await settle();
    await store.retryNow();
    assert.deepEqual([...h.timers.values()].map(t => t.ms), [RETRY_DELAYS_MS[0]]);
});

test("an older load that resolves last is dropped", async () => {
    const { h, store } = harness();
    h.deferReads = true;
    const first = store.load();
    h.user = B;
    const second = store.load();
    await settle();
    const [readA, readB] = h.deferred;
    readB.resolve({ notes: "bee" });
    await settle();
    readA.resolve({ notes: "ay" });
    await Promise.all([first, second]);
    assert.equal(store.owner(), B);
    assert.equal(store.get().notes, "bee");
});

test("an older load for the same account that resolves last is dropped", async () => {
    const { h, store } = harness();
    h.deferReads = true;
    const first = store.load();
    const second = store.load();
    await settle();
    const [readOld, readNew] = h.deferred;
    readNew.resolve({ notes: "new" });
    await settle();
    readOld.resolve({ notes: "old" });
    await Promise.all([first, second]);
    assert.equal(store.owner(), A);
    assert.equal(store.get().notes, "new");
});

test("a read for an account that is no longer logged in is dropped", async () => {
    const { h, store } = harness();
    h.deferReads = true;
    const pending = store.load();
    await settle();
    h.user = B;
    h.deferred[0].resolve({ notes: "ay" });
    await pending;
    assert.equal(store.owner(), null);
    assert.equal(store.canWrite(), false);
    assert.notEqual(store.get().notes, "ay");
});

test("switching accounts saves the old account's pending edit to its own key first", async () => {
    const { h, store } = harness({ [`AtAGlance_${A}`]: { notes: "a" }, [`AtAGlance_${B}`]: { notes: "b" } });
    await store.load();
    store.get().notes = "a edited";
    store.persist(500);
    h.user = B;
    await store.load();
    assert.deepEqual(h.writes, [[`AtAGlance_${A}`, { notes: "a edited" }]]);
    assert.equal(store.owner(), B);
    assert.equal(store.get().notes, "b");
    h.runTimers();
    await settle();
    assert.equal(h.writes.length, 1);
});

test("a reconnect for the same account saves pending edits and does not re-read", async () => {
    const { h, store } = harness({ [`AtAGlance_${A}`]: { notes: "a" } });
    await store.load();
    const readsBefore = h.reads;
    store.get().notes = "typed";
    store.persist(500);
    await store.load();
    assert.equal(h.reads, readsBefore);
    assert.equal(store.state(), "ready");
    assert.equal(store.get().notes, "typed");
    assert.deepEqual(h.writes.at(-1), [`AtAGlance_${A}`, { notes: "typed" }]);
});

test("persist is debounced into one write", async () => {
    const { h, store } = harness({ [`AtAGlance_${A}`]: { notes: "a" } });
    await store.load();
    store.get().notes = "one";
    store.persist(200);
    store.get().notes = "two";
    store.persist(200);
    h.runTimers();
    await settle();
    assert.deepEqual(h.writes, [[`AtAGlance_${A}`, { notes: "two" }]]);
});

test("writes are refused once the logged-in account differs from the owner", async () => {
    const { h, store } = harness({ [`AtAGlance_${A}`]: { notes: "a" } });
    await store.load();
    h.user = B;
    assert.equal(store.canWrite(), false);
});

test("legacy data is migrated and the old key removed after the write", async () => {
    const { h, store } = harness({ [`Dashboard_${A}`]: { notes: "old" } });
    await store.load();
    assert.equal(store.state(), "ready");
    assert.equal(store.get().notes, "old");
    assert.deepEqual(h.writes, [[`AtAGlance_${A}`, { notes: "old" }]]);
    assert.deepEqual(h.removed, [`Dashboard_${A}`]);
});

test("a failed migration write keeps the legacy key and still loads", async () => {
    const { h, store } = harness({ [`Dashboard_${A}`]: { notes: "old" } });
    h.failWrites = true;
    await store.load();
    assert.equal(store.state(), "ready");
    assert.equal(store.get().notes, "old");
    assert.deepEqual(h.removed, []);
});

test("reset saves pending edits, then forgets the account", async () => {
    const { h, store } = harness({ [`AtAGlance_${A}`]: { notes: "a" } });
    await store.load();
    store.get().notes = "last words";
    store.persist(500);
    await store.reset();
    assert.deepEqual(h.writes, [[`AtAGlance_${A}`, { notes: "last words" }]]);
    assert.equal(store.state(), "idle");
    assert.equal(store.owner(), null);
    assert.equal(store.canWrite(), false);
});
