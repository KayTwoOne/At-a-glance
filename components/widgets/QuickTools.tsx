/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyToClipboard } from "@utils/clipboard";
import { moment, React, showToast, Toasts } from "@webpack/common";

import {
    getQuickToolsTab,
    getStopwatchState,
    getTimerState,
    onConfigLoad,
    PersistedStopwatchState,
    PersistedTimerState,
    QUICK_TOOL_IDS,
    QuickToolId,
    setQuickToolsTab,
    setStopwatchState,
    setTimerState
} from "../../data";
import { settings } from "../../settings";
import { Dropdown } from "../Dropdown";
import { useNow } from "../hooks";
import { CloseIcon } from "../icons";
import { WidgetCard } from "../WidgetCard";

/**
 * A useState-like store whose value lives at module scope, so it SURVIVES the
 * component unmounting. Collapsing the Quick Tools card unmounts its body
 * (WidgetCard only renders children while expanded), which used to wipe every
 * tool back to zero; backing them with this keeps a running stopwatch/timer and
 * the calculator's state intact across collapse, page close, and reopen. Running
 * clocks are stored as absolute timestamps, so they keep advancing while hidden.
 */
function persistentState<T>(initial: T) {
    let value = initial;
    const listeners = new Set<() => void>();
    const set = (next: T | ((prev: T) => T)) => {
        value = typeof next === "function" ? (next as (prev: T) => T)(value) : next;
        for (const listener of listeners) listener();
    };
    const use = (): [T, typeof set] => {
        const [, force] = React.useReducer((x: number) => x + 1, 0);
        React.useEffect(() => {
            listeners.add(force);
            return () => void listeners.delete(force);
        }, []);
        return [value, set];
    };
    return { use, set, get: () => value };
}

/** Zones with exactly one unambiguous meaning that aren't themselves IANA
 *  zone identifiers, so a strict lookup against the canonical list would
 *  reject them. Deliberately short: real abbreviations like BST, IST, CST and
 *  EST each name more than one zone and must never be added here. */
const EXTRA_ZONE_ALLOWLIST = ["UTC", "GMT"];

let ianaZones: string[] | null = null;
/** The full canonical IANA zone list (418 entries). Computed on first use,
 *  not as a module-scope const - real work at import time here would slow
 *  down every page load for a tab most users never open. */
function getIanaZones(): string[] {
    ianaZones ??= Intl.supportedValuesOf("timeZone");
    return ianaZones;
}

let suggestibleZones: string[] | null = null;
/** IANA list plus the allowlist, in that priority order, for the datalist. */
function getSuggestibleZones(): string[] {
    suggestibleZones ??= [...EXTRA_ZONE_ALLOWLIST, ...getIanaZones()];
    return suggestibleZones;
}

let zoneByLowerCase: Map<string, string> | null = null;
/** Case-insensitive lookup, "europe/london" -> "Europe/London". Built once,
 *  lazily, alongside getIanaZones(). */
function getZoneByLowerCase(): Map<string, string> {
    if (!zoneByLowerCase) {
        zoneByLowerCase = new Map();
        for (const zone of getIanaZones()) zoneByLowerCase.set(zone.toLowerCase(), zone);
        for (const zone of EXTRA_ZONE_ALLOWLIST) zoneByLowerCase.set(zone.toLowerCase(), zone);
    }
    return zoneByLowerCase;
}

/**
 * Resolves user input to a canonical zone name, case-insensitively, or null
 * if it isn't a real, unambiguous zone. "Intl didn't throw" is too
 * permissive to validate with: Intl.DateTimeFormat also accepts BST and
 * resolves it to Bangladesh Standard Time, not British Summer Time - a wrong
 * clock that still "validates". Checking against the real IANA list (plus
 * the tiny allowlist above) rejects that while still accepting UTC and GMT,
 * neither of which is in the list itself.
 */
function resolveTimezone(tz: string): string | null {
    return getZoneByLowerCase().get(tz.toLowerCase()) ?? null;
}

function formatTime(now: number, timeZone?: string) {
    try {
        return new Intl.DateTimeFormat(void 0, {
            hour: "2-digit", minute: "2-digit", second: "2-digit",
            hour12: false, timeZone
        }).format(now);
    } catch {
        return "--:--:--";
    }
}

// The one place the four-zone cap is written down. Both the read side
// (parseTimezones) and the write side (addTimezone) point at it, so the
// settings field and the Clock tab can never disagree about the limit.
const MAX_EXTRA_TIMEZONES = 4;

/** Same parse the settings field has always used: split, trim, drop anything
 *  that doesn't look like a real zone, cap at four. Silent here is correct -
 *  this only ever runs against already-stored data, never a fresh keystroke.
 *  Resolving through resolveTimezone also normalises casing, so a zone saved
 *  as "europe/london" displays and matches as "Europe/London". */
function parseTimezones(raw: string) {
    return raw
        .split(",")
        .map(z => z.trim())
        .filter(z => z.length > 0 && z.length <= 40)
        .map(z => resolveTimezone(z))
        .filter((z): z is string => z !== null)
        .slice(0, MAX_EXTRA_TIMEZONES);
}

function zoneLabel(zone: string) {
    return zone.split("/").pop()?.replaceAll("_", " ") ?? zone;
}

type AddZoneError = "invalid" | "duplicate" | "limit";

const ADD_ZONE_MESSAGES: Record<AddZoneError, string> = {
    invalid: "Not a recognised time zone. Use the Area/Location form, e.g. Europe/Berlin.",
    duplicate: "That zone is already on the list.",
    limit: `You can track up to ${MAX_EXTRA_TIMEZONES} extra zones at once. Remove one to add another.`
};

/** Writes straight back to the same comma-separated setting the text field
 *  edits, so the Clock tab is a second door onto one room, not a second room.
 *  Stores the canonical name resolveTimezone returns, not the raw input, so
 *  "europe/london" is saved (and later displayed) as "Europe/London". */
function addTimezone(raw: string): AddZoneError | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.length > 40) return "invalid";
    const zone = resolveTimezone(trimmed);
    if (!zone) return "invalid";

    const current = parseTimezones(settings.store.extraTimezones);
    if (current.includes(zone)) return "duplicate";
    if (current.length >= MAX_EXTRA_TIMEZONES) return "limit";

    settings.store.extraTimezones = [...current, zone].join(", ");
    return null;
}

function removeTimezone(zone: string) {
    const current = parseTimezones(settings.store.extraTimezones);
    settings.store.extraTimezones = current.filter(z => z !== zone).join(", ");
}

const MAX_ZONE_SUGGESTIONS = 50;

/** Suggestions for the <datalist>, filtered to what's been typed so far
 *  rather than dumping all 418+ zones into the DOM on every keystroke. Empty
 *  query gives no suggestions - the field isn't narrowed down to anything
 *  yet, so there's nothing useful to offer. */
function suggestTimezones(query: string): string[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const matches: string[] = [];
    for (const zone of getSuggestibleZones()) {
        if (zone.toLowerCase().includes(q)) {
            matches.push(zone);
            if (matches.length >= MAX_ZONE_SUGGESTIONS) break;
        }
    }
    return matches;
}

function DigitalClock() {
    const now = useNow(1000);
    const { extraTimezones } = settings.use(["extraTimezones"]);
    const [newZone, setNewZone] = React.useState("");
    const [error, setError] = React.useState<AddZoneError | null>(null);

    const zones = React.useMemo(() => parseTimezones(extraTimezones), [extraTimezones]);
    const suggestions = React.useMemo(() => suggestTimezones(newZone), [newZone]);

    const handleAdd = () => {
        const result = addTimezone(newZone);
        if (result) { setError(result); return; }
        setNewZone("");
        setError(null);
    };

    return (
        <div className="vc-glance-clock-rows">
            <div className="vc-glance-clock-row">
                <span className="vc-glance-clock-zone">Local</span>
                <span className="vc-glance-clock-time">{formatTime(now)}</span>
                {/* Local can't be removed, but the row still needs a third
                    child the same width as the remove button so its time
                    lands in the same column as the rows below it. */}
                <span className="vc-glance-clock-spacer" aria-hidden="true" />
            </div>
            {zones.map(zone => (
                <div className="vc-glance-clock-row" key={zone}>
                    <span className="vc-glance-clock-zone">{zoneLabel(zone)}</span>
                    <span className="vc-glance-clock-time">{formatTime(now, zone)}</span>
                    <button
                        className="vc-glance-icon-button vc-glance-clock-remove"
                        aria-label={`Remove ${zoneLabel(zone)} clock`}
                        onClick={() => removeTimezone(zone)}
                    >
                        <CloseIcon size={14} />
                    </button>
                </div>
            ))}
            <div className="vc-glance-clock-add">
                <input
                    className="vc-glance-input"
                    type="text"
                    maxLength={40}
                    placeholder="Add a time zone, e.g. Europe/Berlin"
                    list="vc-glance-clock-zone-options"
                    value={newZone}
                    onChange={e => {
                        setNewZone(e.target.value);
                        if (error) setError(null);
                    }}
                    onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
                    aria-label="Time zone to add"
                />
                {/* Filtered per-keystroke by suggestTimezones rather than listing
                    every IANA zone up front, so typing "Pra" can suggest
                    Europe/Prague without the datalist ever holding hundreds of
                    unrelated options at once. */}
                <datalist id="vc-glance-clock-zone-options">
                    {suggestions.map(zone => <option key={zone} value={zone} />)}
                </datalist>
                <button
                    className="vc-glance-button vc-glance-button-brand"
                    disabled={!newZone.trim()}
                    onClick={handleAdd}
                >
                    Add
                </button>
            </div>
            {error && (
                <span className="vc-glance-hint vc-glance-hint-error" role="alert">
                    {ADD_ZONE_MESSAGES[error]}
                </span>
            )}
        </div>
    );
}

// One shared AudioContext. It's created and unlocked on the "Set" click (a user
// gesture), so the chime can still fire later from a timeout even if the widget
// is collapsed or the page is closed by then.
let audioCtx: AudioContext | null = null;

/** Create/resume the AudioContext during a user gesture so later playback works */
function primeAudio() {
    try {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return;
        audioCtx ??= new Ctx();
        if (audioCtx!.state === "suspended") void audioCtx!.resume();
    } catch {
        // audio unavailable - the toast still fires
    }
}

/**
 * A short, soft three-note chime (C6-E6-G6) on sine waves with a gentle
 * attack/decay envelope - a pleasant "ding", nothing jarring. Soft-fails
 * anywhere Web Audio isn't available.
 */
function playTimerChime() {
    try {
        primeAudio();
        const ctx = audioCtx;
        if (!ctx) return;

        const notes = [1046.5, 1318.5, 1568.0]; // C6, E6, G6
        const master = ctx.createGain();
        master.gain.value = 0.18; // quiet by design
        master.connect(ctx.destination);

        notes.forEach((freq, i) => {
            const t0 = ctx.currentTime + i * 0.14;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = freq;
            // soft ramp up, gentle exponential tail - no click, no harshness
            gain.gain.setValueAtTime(0.0001, t0);
            gain.gain.exponentialRampToValueAtTime(1, t0 + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
            osc.connect(gain);
            gain.connect(master);
            osc.start(t0);
            osc.stop(t0 + 0.55);
        });
    } catch {
        // audio unavailable - the toast still fires
    }
}

function formatDuration(totalMs: number) {
    const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
    const h = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const m = String(Math.floor(totalSeconds / 60) % 60).padStart(2, "0");
    const s = String(totalSeconds % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
}

interface LapEntry {
    /** 1-based, in press order - stable even once the list is capped */
    n: number;
    /** Elapsed ms (from the current run's start) at the moment this lap was pressed */
    elapsedMs: number;
}

// A dashboard card, not a stopwatch app's training log: twenty laps covers any
// realistic single session, and once hit Lap just disables rather than
// evicting laps the user pressed the button specifically to keep.
const MAX_LAPS = 20;

interface StopwatchState {
    running: boolean;
    /** Absolute ms the current run counts from (Date.now() - accumulated) */
    startedAt: number;
    /** Frozen elapsed ms while paused */
    elapsed: number;
    laps: LapEntry[];
}
const stopwatchStore = persistentState<StopwatchState>({ running: false, startedAt: 0, elapsed: 0, laps: [] });

/** Writes the subset of StopwatchState that survives a restart. Laps are
 *  excluded on purpose (see MAX_LAPS) - every run starts its lap list fresh,
 *  restart or not. Called only from start/pause/reset, never per tick. */
function persistStopwatch(sw: StopwatchState) {
    setStopwatchState({ running: sw.running, startedAt: sw.startedAt, elapsed: sw.elapsed });
}

function Stopwatch() {
    const [sw, setSw] = stopwatchStore.use();

    // While running, re-render to advance the display; the value itself is
    // derived from absolute time, so it stays correct even after being hidden.
    React.useEffect(() => {
        if (!sw.running) return;
        const id = setInterval(() => setSw(s => ({ ...s })), 250);
        return () => clearInterval(id);
    }, [sw.running]);

    const elapsed = sw.running ? Date.now() - sw.startedAt : sw.elapsed;

    const toggle = () => {
        const next: StopwatchState = sw.running
            ? { ...sw, running: false, elapsed: Date.now() - sw.startedAt }
            : { ...sw, running: true, startedAt: Date.now() - sw.elapsed };
        setSw(next);
        persistStopwatch(next);
    };

    const reset = () => {
        const next: StopwatchState = { running: false, startedAt: 0, elapsed: 0, laps: [] };
        setSw(next);
        persistStopwatch(next);
    };

    const lap = () => {
        if (!sw.running || sw.laps.length >= MAX_LAPS) return;
        const elapsedMs = Date.now() - sw.startedAt;
        // Newest first, so the list reads top-down like the running total does.
        setSw(s => ({ ...s, laps: [{ n: s.laps.length + 1, elapsedMs }, ...s.laps] }));
    };

    return (
        <>
            <div className="vc-glance-tool-display">{formatDuration(elapsed)}</div>
            <div className="vc-glance-tool-buttons">
                {sw.running && (
                    <button
                        className="vc-glance-button vc-glance-button-secondary"
                        onClick={lap}
                        disabled={sw.laps.length >= MAX_LAPS}
                    >
                        Lap
                    </button>
                )}
                <button className="vc-glance-button vc-glance-button-brand" onClick={toggle}>
                    {sw.running ? "Pause" : "Start"}
                </button>
                <button className="vc-glance-button vc-glance-button-danger" onClick={reset}>
                    Reset
                </button>
            </div>
            {sw.laps.length > 0 && (
                <div className="vc-glance-lap-list">
                    {sw.laps.map((entry, i) => (
                        <div className="vc-glance-lap-row" key={entry.n}>
                            <span className="vc-glance-lap-index">Lap {entry.n}</span>
                            <span className="vc-glance-lap-split">
                                {formatDuration(entry.elapsedMs - (sw.laps[i + 1]?.elapsedMs ?? 0))}
                            </span>
                            <span className="vc-glance-lap-total">{formatDuration(entry.elapsedMs)}</span>
                        </div>
                    ))}
                </div>
            )}
        </>
    );
}

function clampInt(value: string, max: number) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, max);
}

interface TimerState {
    hours: string;
    minutes: string;
    seconds: string;
    /** Absolute ms the countdown ends at, or null when idle */
    endsAt: number | null;
}
const timerStore = persistentState<TimerState>({ hours: "0", minutes: "5", seconds: "0", endsAt: null });

/** Writes the full TimerState - unlike the stopwatch there's nothing to
 *  exclude, the input fields are as cheap to keep as endsAt. Called only from
 *  armTimer/stopTimer, never per tick. */
function persistTimer(t: TimerState) {
    setTimerState({ hours: t.hours, minutes: t.minutes, seconds: t.seconds, endsAt: t.endsAt });
}

// The completion side-effects (clear, toast, chime) are driven by a module-level
// timeout, NOT the component - so they fire even if the Quick Tools card is
// collapsed or the page is closed when the countdown hits zero.
let timerHandle: ReturnType<typeof setTimeout> | null = null;

/** The one place a countdown finishes, whether that happens live (the
 *  setTimeout below firing) or is discovered on load because endsAt already
 *  passed while Discord was shut - see resumeTimer. Same store-level toast and
 *  chime either way, never swallowed. */
/** How long after a missed completion it is still worth announcing. Past this,
 *  a timer that expired while Discord was shut is dropped without a sound. */
const MISSED_TIMER_GRACE_MS = 60 * 60 * 1000;

/** The user-facing half of a completion, split out so the catch-up path on
 *  load can clear storage first and only then decide whether to announce. */
function announceTimerFinished() {
    showToast("⏰ Quick Tools timer finished!", Toasts.Type.SUCCESS);
    if (settings.store.timerSound) playTimerChime();
}

function completeTimer() {
    timerHandle = null;
    timerStore.set(t => ({ ...t, endsAt: null }));
    persistTimer(timerStore.get());
    announceTimerFinished();
}

function scheduleTimerCompletion(endsAt: number) {
    if (timerHandle) clearTimeout(timerHandle);
    timerHandle = setTimeout(completeTimer, Math.max(0, endsAt - Date.now()));
}

function stopTimer() {
    if (timerHandle) {
        clearTimeout(timerHandle);
        timerHandle = null;
    }
    timerStore.set(t => ({ ...t, endsAt: null }));
    persistTimer(timerStore.get());
}

function armTimer(totalMs: number) {
    const endsAt = Date.now() + totalMs;
    timerStore.set(t => ({ ...t, endsAt }));
    scheduleTimerCompletion(endsAt);
    persistTimer(timerStore.get());
}

/** Called from the plugin's stop() so a pending timer can't fire after disable */
export function disposeQuickTools() {
    if (timerHandle) {
        clearTimeout(timerHandle);
        timerHandle = null;
    }
    if (audioCtx) {
        try { void audioCtx.close(); } catch { /* already closed */ }
        audioCtx = null;
    }
}

/** Both fields are absolute epoch values, so a run that was going when Discord
 *  closed is already correct the instant this runs - Date.now() - startedAt
 *  naturally includes the closed interval. No separate "resume" math needed,
 *  same as a live tick. */
function resumeStopwatch(saved: PersistedStopwatchState) {
    stopwatchStore.set({
        running: saved.running,
        startedAt: saved.startedAt,
        elapsed: saved.elapsed,
        laps: []
    });
}

function resumeTimer(saved: PersistedTimerState) {
    timerStore.set({ hours: saved.hours, minutes: saved.minutes, seconds: saved.seconds, endsAt: saved.endsAt });

    if (saved.endsAt === null) return; // idle - nothing to (re)schedule

    if (saved.endsAt > Date.now()) {
        scheduleTimerCompletion(saved.endsAt);
        return;
    }

    // endsAt passed while Discord was closed.
    //
    // Clear the stored timer BEFORE deciding whether to announce it. Doing it
    // the other way round means a completion that fails to reach storage for
    // any reason leaves the expired endsAt behind, and then every subsequent
    // launch re-discovers the same dead timer and chimes again forever.
    // Clearing first makes this self-limiting whatever else happens.
    const overdueBy = Date.now() - saved.endsAt;
    timerStore.set(t => ({ ...t, endsAt: null }));
    persistTimer(timerStore.get());

    // A missed completion is still worth hearing, but only while it could
    // plausibly still matter. Past the grace window it is discarded quietly:
    // a timer that ran out yesterday going off at launch is noise, not a
    // reminder.
    if (overdueBy <= MISSED_TIMER_GRACE_MS) announceTimerFinished();
}

// Runs once, the first time config finishes loading (app startup / plugin
// enable) - not on every reconnect or account switch, both of which also fire
// loadConfig(). Without this guard a mid-session reconnect would overwrite the
// live stopwatch (laps included) and re-diff the timer against storage that's
// already stale compared to what's sitting in the module right now.
let hydratedFromConfig = false;

onConfigLoad(() => {
    if (hydratedFromConfig) return;
    hydratedFromConfig = true;

    resumeStopwatch(getStopwatchState());
    resumeTimer(getTimerState());
});

function CountdownTimer() {
    const [timer] = timerStore.use();
    const now = useNow(250);

    const remaining = timer.endsAt === null ? null : Math.max(0, timer.endsAt - now);

    const setField = (patch: Partial<TimerState>) => timerStore.set(t => ({ ...t, ...patch }));

    const start = () => {
        // Runs on a click (user gesture): unlock audio now so the chime can play
        // later even from the background timeout.
        primeAudio();
        const totalMs = (
            (clampInt(timer.hours, 99) * 60 + clampInt(timer.minutes, 59)) * 60
            + clampInt(timer.seconds, 59)
        ) * 1000;
        if (totalMs > 0) armTimer(totalMs);
    };

    return remaining === null
        ? (
            <div className="vc-glance-timer-inputs">
                <input
                    className="vc-glance-input vc-glance-timer-input"
                    type="text" inputMode="numeric" maxLength={2}
                    value={timer.hours} placeholder="Hr"
                    onChange={e => setField({ hours: e.target.value.replace(/\D/g, "") })}
                    aria-label="Hours"
                />
                <span className="vc-glance-timer-sep">:</span>
                <input
                    className="vc-glance-input vc-glance-timer-input"
                    type="text" inputMode="numeric" maxLength={2}
                    value={timer.minutes} placeholder="Min"
                    onChange={e => setField({ minutes: e.target.value.replace(/\D/g, "") })}
                    aria-label="Minutes"
                />
                <span className="vc-glance-timer-sep">:</span>
                <input
                    className="vc-glance-input vc-glance-timer-input"
                    type="text" inputMode="numeric" maxLength={2}
                    value={timer.seconds} placeholder="Sec"
                    onChange={e => setField({ seconds: e.target.value.replace(/\D/g, "") })}
                    aria-label="Seconds"
                />
                <button className="vc-glance-button vc-glance-button-brand" onClick={start}>Set</button>
            </div>
        )
        : (
            <>
                <div className="vc-glance-tool-display">{formatDuration(remaining)}</div>
                <div className="vc-glance-tool-buttons">
                    <button className="vc-glance-button vc-glance-button-danger" onClick={stopTimer}>
                        Cancel
                    </button>
                </div>
            </>
        );
}

type CalcOp = "+" | "−" | "×" | "÷";

interface CalcState {
    display: string;
    accumulator: number | null;
    op: CalcOp | null;
    /** true while the user is typing the current operand */
    typing: boolean;
}

const CALC_INITIAL: CalcState = { display: "0", accumulator: null, op: null, typing: false };
const calcStore = persistentState<CalcState>(CALC_INITIAL);

function applyOp(a: number, b: number, op: CalcOp): number {
    switch (op) {
        case "+": return a + b;
        case "−": return a - b;
        case "×": return a * b;
        case "÷": return b === 0 ? NaN : a / b;
    }
}

function formatResult(n: number): string {
    if (!Number.isFinite(n)) return "Error";
    const str = String(Math.round(n * 1e10) / 1e10);
    return str.length > 12 ? n.toPrecision(8) : str;
}

/** Classic immediate-execution 4-function calculator. No eval, no parsing. */
function Calculator() {
    const [state, setState] = calcStore.use();

    const press = (key: string) => setState(prev => {
        if (key === "C") return CALC_INITIAL;

        if (key >= "0" && key <= "9") {
            const display = prev.typing && prev.display !== "0" ? prev.display + key : key;
            return display.length > 12 ? prev : { ...prev, display, typing: true };
        }

        if (key === ".") {
            if (prev.typing && prev.display.includes(".")) return prev;
            return { ...prev, display: prev.typing ? prev.display + "." : "0.", typing: true };
        }

        const current = parseFloat(prev.display);
        if (Number.isNaN(current)) return CALC_INITIAL;

        if (key === "=") {
            if (prev.op === null || prev.accumulator === null) return { ...prev, typing: false };
            return { display: formatResult(applyOp(prev.accumulator, current, prev.op)), accumulator: null, op: null, typing: false };
        }

        // Operator pressed: fold any pending operation first
        const accumulator = prev.op !== null && prev.accumulator !== null && prev.typing
            ? applyOp(prev.accumulator, current, prev.op)
            : current;
        return { display: formatResult(accumulator), accumulator, op: key as CalcOp, typing: false };
    });

    const keys = ["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "−", "C", "0", ".", "+"];

    return (
        <>
            <div className="vc-glance-calc-display" aria-live="polite">{state.display}</div>
            <div className="vc-glance-calc-grid">
                {keys.map(key => (
                    <button
                        key={key}
                        className={"vc-glance-calc-key" + (/\d|\./.test(key) ? "" : " vc-glance-calc-key-op")}
                        onClick={() => press(key)}
                    >
                        {key}
                    </button>
                ))}
                <button className="vc-glance-calc-key vc-glance-calc-key-equals" onClick={() => press("=")}>=</button>
            </div>
        </>
    );
}

/* Discord's <t:unix:FORMAT> dynamic timestamps - the thing people open
   HammerTime in a browser tab for. Pick a moment, pick a style, copy the code;
   it renders in every reader's own timezone. */

const TIMESTAMP_FORMATS: Array<{ label: string; value: string; }> = [
    { label: "Relative (in 3 hours)", value: "R" },
    { label: "Short time (16:20)", value: "t" },
    { label: "Long time (16:20:30)", value: "T" },
    { label: "Short date (20/04/2026)", value: "d" },
    { label: "Long date (20 April 2026)", value: "D" },
    { label: "Date & time", value: "f" },
    { label: "Weekday, date & time", value: "F" }
];

/** Approximates how Discord will render <t:unix:fmt>, for the live preview */
function previewTimestamp(ms: number, format: string): string {
    const m = moment(ms);
    switch (format) {
        case "t": return m.format("HH:mm");
        case "T": return m.format("HH:mm:ss");
        case "d": return m.format("L");
        case "D": return m.format("LL");
        case "f": return m.format("LL HH:mm");
        case "F": return m.format("dddd, LL HH:mm");
        default: return m.fromNow();
    }
}

/** datetime-local wants "YYYY-MM-DDTHH:mm" in local time */
function toLocalInputValue(ms: number): string {
    return moment(ms).format("YYYY-MM-DDTHH:mm");
}

// value starts empty and lazy-inits to "now" on first open, so a picked time
// survives collapse but an untouched builder still opens on the current moment.
const timestampStore = persistentState<{ value: string; format: string; }>({ value: "", format: "R" });

function TimestampBuilder() {
    const [ts, setTs] = timestampStore.use();

    React.useEffect(() => {
        if (!ts.value) setTs(t => ({ ...t, value: toLocalInputValue(Date.now()) }));
    }, []);

    const { format } = ts;
    const value = ts.value || toLocalInputValue(Date.now());
    const setValue = (v: string) => setTs(t => ({ ...t, value: v }));
    const setFormat = (f: string) => setTs(t => ({ ...t, format: f }));

    const parsed = Date.parse(value);
    const valid = Number.isFinite(parsed);
    const code = valid ? `<t:${Math.floor(parsed / 1000)}:${format}>` : "";

    const copy = () => {
        if (!valid) return;
        // Vencord's helper uses DiscordNative.clipboard on desktop (the raw web
        // clipboard API is unreliable inside the desktop sandbox) and the web
        // clipboard in the browser build.
        copyToClipboard(code)
            .then(() => showToast("Timestamp copied - paste it into any chat.", Toasts.Type.SUCCESS))
            .catch(() => showToast("Couldn't copy to clipboard.", Toasts.Type.FAILURE));
    };

    return (
        <>
            <input
                className="vc-glance-input vc-glance-timestamp-when"
                type="datetime-local"
                value={value}
                onChange={e => setValue(e.target.value)}
                aria-label="Timestamp date and time"
            />
            <Dropdown
                className="vc-glance-timestamp-format"
                options={TIMESTAMP_FORMATS}
                value={format}
                onChange={setFormat}
                ariaLabel="Timestamp style"
            />
            <div className="vc-glance-timestamp-out">
                <span className="vc-glance-timestamp-preview">
                    {valid ? previewTimestamp(parsed, format) : "Pick a date"}
                </span>
                <button
                    className="vc-glance-button vc-glance-button-brand"
                    disabled={!valid}
                    onClick={copy}
                >
                    Copy
                </button>
            </div>
        </>
    );
}

const TOOL_LABELS: Record<QuickToolId, string> = {
    clock: "Clock",
    timer: "Timer",
    stopwatch: "Stopwatch",
    timestamp: "Timestamp",
    calculator: "Calculator"
};

const TOOL_VIEWS: Record<QuickToolId, () => React.ReactNode> = {
    clock: () => <DigitalClock />,
    timer: () => <CountdownTimer />,
    stopwatch: () => <Stopwatch />,
    timestamp: () => <TimestampBuilder />,
    calculator: () => <Calculator />
};

/** A tool is "live" when it is still doing something you would want to be told about */
function isToolLive(id: QuickToolId): boolean {
    if (id === "timer") return timerStore.get().endsAt !== null;
    if (id === "stopwatch") return stopwatchStore.get().running;
    return false;
}

export function QuickToolsWidget() {
    // getQuickToolsTab() needs no subscription of its own: WidgetColumn already
    // calls useGlanceConfig() (via useOrderedWidgets) and re-invokes
    // WIDGET_RENDERERS on every config change, so a tab click's setQuickToolsTab
    // -> emit() re-creates this component with the new tab already in place.
    // timerStore/stopwatchStore are a separate, module-local subscription
    // (unrelated to the config store above) - they keep running underneath
    // regardless of which tab is mounted, and .use() here (rather than leaving
    // it to the unmounted tool's own component) is what keeps the live dot
    // honest across a tab switch.
    timerStore.use();
    stopwatchStore.use();

    const tab = getQuickToolsTab();
    const tabRefs = React.useRef(new Map<QuickToolId, HTMLButtonElement>());

    // Roving tabindex: arrow keys move both the selection and the actual DOM
    // focus, so a screen reader or keyboard user landing back on Tab doesn't
    // stall on a button that just became tabIndex=-1.
    const onTabKeyDown = (e: React.KeyboardEvent) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const i = QUICK_TOOL_IDS.indexOf(tab);
        const next = e.key === "ArrowRight"
            ? (i + 1) % QUICK_TOOL_IDS.length
            : (i - 1 + QUICK_TOOL_IDS.length) % QUICK_TOOL_IDS.length;
        const nextId = QUICK_TOOL_IDS[next];
        setQuickToolsTab(nextId);
        tabRefs.current.get(nextId)?.focus();
    };

    return (
        <WidgetCard id="quick-tools">
            {/* "tool-tab", not "tab" - .vc-glance-tab is already the sidebar entry's
                class (GlanceTab.tsx); reusing it here would leak this hover/active/live
                styling onto that unrelated row. */}
            <div className="vc-glance-tool-tabstrip" role="tablist" aria-label="Quick tools" onKeyDown={onTabKeyDown}>
                {QUICK_TOOL_IDS.map(id => (
                    <button
                        key={id}
                        ref={el => {
                            if (el) tabRefs.current.set(id, el);
                            else tabRefs.current.delete(id);
                        }}
                        role="tab"
                        id={`vc-glance-tool-tab-${id}`}
                        aria-selected={tab === id}
                        aria-controls={`vc-glance-tool-tabpanel-${id}`}
                        tabIndex={tab === id ? 0 : -1}
                        className={"vc-glance-tool-tab" + (tab === id ? " vc-glance-tool-tab-active" : "")}
                        onClick={() => setQuickToolsTab(id)}
                    >
                        {TOOL_LABELS[id]}
                        {isToolLive(id) && <span className="vc-glance-tool-tab-live" aria-label="running" />}
                    </button>
                ))}
            </div>
            <div
                className="vc-glance-tool-tabpanel"
                role="tabpanel"
                id={`vc-glance-tool-tabpanel-${tab}`}
                aria-labelledby={`vc-glance-tool-tab-${tab}`}
            >
                {TOOL_VIEWS[tab]()}
            </div>
        </WidgetCard>
    );
}
