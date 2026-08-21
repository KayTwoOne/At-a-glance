/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Evaluates Vencord's built renderer.js with minimal browser shims.
//
// Why this exists: esbuild bundles every plugin into one renderer.js, and
// touching a lazy webpack proxy (React, Modal, any @webpack/common export) at
// module scope throws during bundle evaluation - before Discord's webpack
// exists - and silently kills ALL of Vencord. It looks like a botched install;
// it's actually one bad top-level line. This harness catches that class of bug
// in seconds instead of a confusing in-client debugging session.
//
// Usage (from the Vencord checkout root, after `pnpm build`):
//   node src/userplugins/atAGlance/tools/verify-bundle.js dist/renderer.js
//
// Discord's webpack is absent here, so if evaluation finishes, startup would
// survive in the real client too.
const fs = require("fs");
const path = require("path");

const noop = () => { };
const noopEl = () => makeEl();
function makeEl() {
    return new Proxy(function () { }, {
        get: (t, p) => {
            if (p === "style") return new Proxy({}, { get: () => "", set: () => true });
            if (p === "classList") return { add: noop, remove: noop, toggle: noop, contains: () => false };
            if (p === "children" || p === "childNodes") return [];
            if (p === "appendChild" || p === "append" || p === "prepend" || p === "removeChild" || p === "insertBefore") return el => el;
            if (p === "addEventListener" || p === "removeEventListener" || p === "setAttribute" || p === "removeAttribute") return noop;
            if (p === "getAttribute") return () => null;
            if (p === "cloneNode") return noopEl;
            if (p === "querySelector" || p === "closest") return () => null;
            if (p === "querySelectorAll") return () => [];
            if (p === "getBoundingClientRect") return () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
            if (p === Symbol.toPrimitive) return () => "[el]";
            return makeEl();
        },
        set: () => true,
        apply: () => makeEl()
    });
}

const documentShim = new Proxy({}, {
    get: (t, p) => {
        if (p === "createElement" || p === "createElementNS" || p === "createTextNode") return noopEl;
        if (p === "getElementById" || p === "querySelector") return () => null;
        if (p === "querySelectorAll" || p === "getElementsByTagName" || p === "elementsFromPoint") return () => [];
        if (p === "addEventListener" || p === "removeEventListener") return noop;
        if (p === "documentElement" || p === "head" || p === "body") return makeEl();
        if (p === "readyState") return "loading";
        if (p === "createComment") return noopEl;
        return makeEl();
    },
    set: () => true
});

// Installed via defineProperty, NOT direct globalThis.foo = ... assignments:
// (a) direct script assignments would register these shims as global *types*
// for the whole TS project, clobbering the real VencordNative declaration, and
// (b) some Node globals (navigator) are getter-only and refuse plain sets.
// Node's globalThis has no DOM event methods, so anything calling
// window.addEventListener at module scope blows up before we can judge whether
// the bundle is actually healthy. Equicord's larger plugin set does exactly
// that, where Vencord's never did.
if (typeof globalThis.addEventListener !== "function") {
    globalThis.addEventListener = noop;
    globalThis.removeEventListener = noop;
    globalThis.dispatchEvent = () => true;
}

const shims = {
    window: globalThis,
    self: globalThis,
    document: documentShim,
    navigator: { userAgent: "eval-harness", platform: "Win32", language: "en-US", languages: ["en-US"], maxTouchPoints: 0, clipboard: {} },
    location: { href: "https://discord.com/app", hostname: "discord.com", pathname: "/app", search: "", protocol: "https:", origin: "https://discord.com" },
    MutationObserver: class { observe() { } disconnect() { } },
    IntersectionObserver: class { observe() { } disconnect() { } },
    ResizeObserver: class { observe() { } disconnect() { } },
    requestAnimationFrame: cb => setTimeout(cb, 0),
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    indexedDB: { open: () => ({ onupgradeneeded: null, onsuccess: null, onerror: null }) },
    CSS: { supports: () => false },

    // Preload-provided native bridge - settings are read synchronously at startup
    VencordNative: new Proxy({}, {
        get: () => new Proxy(function () { }, {
            get: (target, fn) => {
                if (fn === "get") return () => ({});
                if (fn === "getSettingsDir") return () => "/tmp";
                return () => Promise.resolve("");
            },
            apply: () => undefined
        })
    })
};

for (const [key, value] of Object.entries(shims)) {
    try {
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    } catch {
        // Non-configurable global - leave Node's own in place
    }
}
globalThis.performance.memory = undefined;

const src = fs.readFileSync(path.join(process.argv[2]), "utf8");
try {
    // Indirect eval = global scope, like a <script> tag
    (0, eval)(src);
    console.log("RESULT: renderer.js evaluated WITHOUT throwing - top-level is clean");
} catch (e) {
    console.log("RESULT: renderer.js THREW during evaluation:");
    console.log((e && e.stack || String(e)).split("\n").slice(0, 6).join("\n"));
    process.exit(1);
}
