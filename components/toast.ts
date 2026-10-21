/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import * as Common from "@webpack/common";

import { GlanceToastKind, toastCall } from "./toastCall";

export type { GlanceToastKind };

// A plain Equicord utility, not a webpack lazy proxy, so module scope is safe
const logger = new Logger("AtAGlance");

/** One toast, on whichever fork is running. A toast is never worth a crash, but a failed one leaves a line in the console. */
export function glanceToast(text: string, kind: GlanceToastKind = "message") {
    try {
        const common = Common as any;
        common.showToast(...toastCall(common, text, kind));
    } catch (e) {
        logger.warn("Toast failed", e);
    }
}
