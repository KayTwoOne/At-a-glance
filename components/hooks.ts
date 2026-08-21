/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "@webpack/common";

/** Current epoch ms, refreshed on an interval - clocks, countdowns, "due" checks */
export function useNow(intervalMs: number): number {
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
}

/**
 * Re-renders on an interval while `enabled`, without carrying any state of its
 * own. For data Discord doesn't emit store updates for (e.g. voice states in
 * guilds you aren't viewing) where reading fresh on each render is enough.
 */
export function usePoll(intervalMs: number, enabled: boolean) {
    const [, tick] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => {
        if (!enabled) return;
        const id = setInterval(tick, intervalMs);
        return () => clearInterval(id);
    }, [intervalMs, enabled]);
}

/**
 * How many dashboard columns the available width can hold: 3, 2 or 1.
 *
 * Measured on the container rather than the viewport, so Discord's server rail
 * and any other chrome are already excluded and the numbers mean what they say.
 * The count has to be known in JS because widgets are bucketed into columns
 * there; CSS alone could size tracks but could not decide what goes in them.
 */
export function useColumnCount(ref: React.RefObject<HTMLElement | null>): number {
    const [count, setCount] = React.useState(2);

    React.useEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver !== "function") return;

        const observer = new ResizeObserver(entries => {
            const width = entries[0]?.contentRect.width ?? 0;
            const next = width >= 1600 ? 3 : width >= 1000 ? 2 : 1;
            // Only re-render when the answer actually changes, not on every
            // observed pixel of a window drag
            setCount(prev => (prev === next ? prev : next));
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [ref]);

    return count;
}
