/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Lets node:test load plugin/logic modules that import each other without
// file extensions, which Equicord's tsconfig requires. Only relative
// specifiers with no extension are touched, and only when a .ts file exists.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
    resolve(specifier, context, nextResolve) {
        const relative = specifier.startsWith("./") || specifier.startsWith("../");
        if (relative && context.parentURL && !/\.[cm]?[jt]sx?$/.test(specifier)) {
            const url = new URL(specifier + ".ts", context.parentURL);
            if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context);
        }
        return nextResolve(specifier, context);
    }
});
