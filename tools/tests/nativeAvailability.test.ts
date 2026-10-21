/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { isNativeAvailable } from "../../savedRows";

const fn = () => { };

const goodStore = () => ({ getMessageBookmarks: fn, getMessageReminders: fn });
const goodActions = () => ({ save: fn, remove: fn, refreshIfStale: fn, fetchBookmarks: fn });

// A stand-in for a lazy finder whose Discord code was not found: it throws
// the moment anything is read from it
function unresolved(): unknown {
    return new Proxy({}, {
        get() { throw new Error("proxyLazy called on a primitive value"); }
    });
}

test("isNativeAvailable is true when the store and all four actions are present", () => {
    assert.equal(isNativeAvailable(goodStore(), goodActions()), true);
});

test("isNativeAvailable is false when the store is missing", () => {
    assert.equal(isNativeAvailable(undefined, goodActions()), false);
    assert.equal(isNativeAvailable(null, goodActions()), false);
});

test("isNativeAvailable is false when the store has no getMessageBookmarks", () => {
    assert.equal(isNativeAvailable({}, goodActions()), false);
    assert.equal(isNativeAvailable({ getMessageReminders: fn }, goodActions()), false);
    assert.equal(isNativeAvailable({ getMessageBookmarks: "not a function" }, goodActions()), false);
});

test("isNativeAvailable is false when the store has no getMessageReminders", () => {
    assert.equal(isNativeAvailable({ getMessageBookmarks: fn }, goodActions()), false);
    assert.equal(isNativeAvailable({ getMessageBookmarks: fn, getMessageReminders: undefined }, goodActions()), false);
    assert.equal(isNativeAvailable({ getMessageBookmarks: fn, getMessageReminders: "not a function" }, goodActions()), false);
});

test("isNativeAvailable is false when the actions module is missing", () => {
    assert.equal(isNativeAvailable(goodStore(), undefined), false);
    assert.equal(isNativeAvailable(goodStore(), null), false);
    assert.equal(isNativeAvailable(goodStore(), {}), false);
});

test("isNativeAvailable is false when any one action is missing", () => {
    for (const name of ["save", "remove", "refreshIfStale", "fetchBookmarks"] as const) {
        const actions: Record<string, unknown> = goodActions();
        delete actions[name];
        assert.equal(isNativeAvailable(goodStore(), actions), false, `without ${name}`);
    }
});

test("isNativeAvailable is false when an action is there but is not a function", () => {
    assert.equal(isNativeAvailable(goodStore(), { ...goodActions(), fetchBookmarks: undefined }), false);
    assert.equal(isNativeAvailable(goodStore(), { ...goodActions(), save: {} }), false);
});

test("isNativeAvailable takes a store or actions that are functions, as lazy proxies are", () => {
    const callableStore = Object.assign(() => { }, { getMessageBookmarks: fn, getMessageReminders: fn });
    assert.equal(isNativeAvailable(callableStore, goodActions()), true);
});

test("isNativeAvailable counts a lookup that throws as not available", () => {
    assert.equal(isNativeAvailable(unresolved(), goodActions()), false);
    assert.equal(isNativeAvailable(goodStore(), unresolved()), false);
    assert.equal(isNativeAvailable(unresolved(), unresolved()), false);
});

test("isNativeAvailable ignores extra members on either side", () => {
    assert.equal(isNativeAvailable({ ...goodStore(), extra: 1 }, { ...goodActions(), other: fn }), true);
});

test("isNativeAvailable does not call anything it checks", () => {
    let calls = 0;
    const spy = () => { calls++; };
    const store = { getMessageBookmarks: spy, getMessageReminders: spy };
    const actions = { save: spy, remove: spy, refreshIfStale: spy, fetchBookmarks: spy };
    assert.equal(isNativeAvailable(store, actions), true);
    assert.equal(calls, 0);
});
