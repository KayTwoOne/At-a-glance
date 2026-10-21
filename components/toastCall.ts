/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Which arguments showToast wants. Vencord still takes (message, type) and
// exports Toasts.Type; Equicord takes one { text, variant } object and has no
// Toasts export. Pure, so tools/tests can pin both shapes.

export type GlanceToastKind = "message" | "success" | "failure";

export function toastCall(common: { Toasts?: any; }, text: string, kind: GlanceToastKind): unknown[] {
    const legacy = common.Toasts?.Type;
    if (legacy) {
        const type = kind === "success" ? legacy.SUCCESS : kind === "failure" ? legacy.FAILURE : legacy.MESSAGE;
        return [text, type];
    }
    const variant = kind === "success" ? "success" : kind === "failure" ? "critical" : "default";
    return [{ text, variant }];
}
