/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { toastCall } from "../../components/toastCall";

test("Vencord's legacy API gets a message and a type", () => {
    const Toasts = { Type: { MESSAGE: "message", SUCCESS: "success", FAILURE: "failure" } };
    assert.deepEqual(toastCall({ Toasts }, "Saved", "success"), ["Saved", "success"]);
    assert.deepEqual(toastCall({ Toasts }, "Nope", "failure"), ["Nope", "failure"]);
    assert.deepEqual(toastCall({ Toasts }, "Hi", "message"), ["Hi", "message"]);
});

test("Equicord's API gets one object with a variant", () => {
    assert.deepEqual(toastCall({}, "Saved", "success"), [{ text: "Saved", variant: "success" }]);
    assert.deepEqual(toastCall({}, "Nope", "failure"), [{ text: "Nope", variant: "critical" }]);
    assert.deepEqual(toastCall({}, "Hi", "message"), [{ text: "Hi", variant: "default" }]);
});
