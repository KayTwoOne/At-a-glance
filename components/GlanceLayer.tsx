/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import {
    AccessibilityStore,
    ContextMenuApi,
    createRoot,
    FluxDispatcher,
    Menu,
    NavigationRouter,
    React,
    showToast,
    Toasts,
    Tooltip
} from "@webpack/common";

import {
    MAX_COLUMNS,
    resetLayout,
    restoreDefaults,
    setColumnOrder,
    setWidgetColumn,
    toggleWidgetHidden,
    useGlanceConfig,
    useOrderedWidgets,
    WIDGET_META,
    WidgetId,
    widgetsInColumn } from "../data";
import { matchesKeyboardCombo } from "../hotkeys";
import { settings } from "../settings";
import { useAppearance, useOnLightTheme } from "./appearance";
import { closeChannelPopup, isChannelPopupOpen } from "./ChannelPopup";
import { CommandPalette } from "./CommandPalette";
import { closeCustomizePanel, CustomizePanel, openCustomizePanel } from "./CustomizePanel";
import { GlanceHeader } from "./GlanceHeader";
import { useColumnCount } from "./hooks";
import { CheckIcon, DashboardIcon, DotsIcon, EyeIcon, GripIcon, PaletteIcon, PlusIcon } from "./icons";
import { openConfirm } from "./PromptModal";
import { RailUserStrip } from "./RailUserStrip";
import { BookmarksWidget } from "./widgets/Bookmarks";
import { ClientPerfWidget } from "./widgets/ClientPerf";
import { EventsWidget } from "./widgets/Events";
import { MentionsWidget } from "./widgets/Mentions";
import { OrionWidget } from "./widgets/Orion";
import { PinnedFriendsWidget } from "./widgets/PinnedFriends";
import { QuickAccessWidget } from "./widgets/QuickAccess";
import { QuickNotesWidget } from "./widgets/QuickNotes";
import { QuickToolsWidget } from "./widgets/QuickTools";
import { RemindersWidget } from "./widgets/Reminders";
import { SpotifyWidget } from "./widgets/Spotify";
import { WeatherWidget } from "./widgets/Weather";

const logger = new Logger("AtAGlance");

const WIDGET_RENDERERS: Record<WidgetId, () => React.ReactNode> = {
    "pinned-friends": () => <PinnedFriendsWidget />,
    "quick-access": () => <QuickAccessWidget />,
    "mentions": () => <MentionsWidget />,
    "bookmarks": () => <BookmarksWidget />,
    "events": () => <EventsWidget />,
    "quick-tools": () => <QuickToolsWidget />,
    "reminders": () => <RemindersWidget />,
    "weather": () => <WeatherWidget />,
    "spotify": () => <SpotifyWidget />,
    "quick-notes": () => <QuickNotesWidget />,
    "client-perf": () => <ClientPerfWidget />,
    "orion": () => <OrionWidget />
};

/* ========== open/close state ========== */

let layerOpen = false;
let openedAt = 0;
const openStateListeners = new Set<() => void>();

function setLayerOpen(open: boolean) {
    if (layerOpen === open) return;
    layerOpen = open;
    for (const listener of [...openStateListeners]) {
        try {
            listener();
        } catch { }
    }
}

export function useGlanceOpen() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => {
        openStateListeners.add(forceUpdate);
        return () => void openStateListeners.delete(forceUpdate);
    }, []);
    return layerOpen;
}

/* ========== edit mode ========== */

// Session-only, same as layerOpen above and for the same reason: nobody
// wants to reopen the dashboard already in edit mode, so this never touches
// storage and always starts false alongside the layer.
let editMode = false;
const editModeListeners = new Set<() => void>();

function setEditMode(next: boolean) {
    if (editMode === next) return;
    editMode = next;
    // The grip's own visibility is gated in React (WidgetCard, off the hook
    // below); this class only drives the purely presentational boundary and
    // empty-column treatment, which CSS can react to on its own.
    document.body.classList.toggle("vc-glance-editing", next);
    for (const listener of [...editModeListeners]) {
        try {
            listener();
        } catch { }
    }
}

export function useEditMode() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => {
        editModeListeners.add(forceUpdate);
        return () => void editModeListeners.delete(forceUpdate);
    }, []);
    return editMode;
}

/* ========== privacy mode ========== */

// Session-only, same shape and same reasoning as editMode above: this exists
// for a screen share or screenshot happening right now, not as a setting to
// remember, so the next time the dashboard opens it starts unblurred rather
// than surprising whoever's screen it is.
let privacyMode = false;
const privacyModeListeners = new Set<() => void>();

function setPrivacyMode(next: boolean) {
    if (privacyMode === next) return;
    privacyMode = next;
    document.body.classList.toggle("vc-glance-privacy", next);
    for (const listener of [...privacyModeListeners]) {
        try {
            listener();
        } catch { }
    }
}

export function usePrivacyMode() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => {
        privacyModeListeners.add(forceUpdate);
        return () => void privacyModeListeners.delete(forceUpdate);
    }, []);
    return privacyMode;
}

/* ========== native chrome handling ========== */

/**
 * Finds Discord's draggable top chrome (OS titlebar strip and, in the visual
 * refresh, the app toolbar row below it). The overlay starts underneath them
 * so window dragging and the min/max/close buttons keep working.
 */
function measureTopChrome(): { top: number; bars: HTMLElement[]; } {
    const bars: HTMLElement[] = [];
    let top = 0;
    try {
        for (const y of [6, 26, 44, 64]) {
            for (const el of document.elementsFromPoint(window.innerWidth * 0.6, y)) {
                const html = el as HTMLElement;
                if (html.closest(".vc-glance-overlay")) continue;
                if (bars.includes(html)) continue;
                if (getComputedStyle(html).getPropertyValue("-webkit-app-region") === "drag") {
                    bars.push(html);
                    top = Math.max(top, html.getBoundingClientRect().bottom);
                }
            }
        }
    } catch (e) {
        logger.error("Failed to measure top chrome", e);
    }
    return { top, bars };
}

let hiddenToolbar: HTMLElement | null = null;

/**
 * Blanks the app toolbar's channel-specific contents (the ".kay in a DM" info)
 * while the overlay is open, keeping the bar itself for styling and window
 * dragging. Only done when the OS titlebar (window buttons) is a SEPARATE bar,
 * so window controls can never be hidden by accident.
 */
function coverToolbar(bars: HTMLElement[]) {
    if (bars.length < 2) return;
    const toolbar = bars.reduce((a, b) =>
        a.getBoundingClientRect().bottom >= b.getBoundingClientRect().bottom ? a : b
    );
    toolbar.setAttribute("data-vc-glance-chrome", "");
    hiddenToolbar = toolbar;
}

function uncoverToolbar() {
    hiddenToolbar?.removeAttribute("data-vc-glance-chrome");
    hiddenToolbar = null;
}

/* ========== native theme editor handling ========== */

/* Two earlier attempts tried to IDENTIFY Discord's "Customise your theme"
   panel by its shape and both failed. The first required position fixed or
   absolute, which never matches: the panel pushes Discord's content aside
   rather than floating over it, so it is an in-flow sibling and computes as
   static. Relaxing that check is worse, not better - with the dashboard open,
   the page behind it is usually Friends, whose "Active Now" rail is also
   docked right, also full height, and also about 340px. Shape cannot tell the
   two apart.

   So this measures the CHANGE instead. Where docked right-side chrome begins
   is baselined when the overlay opens, while no editor can be open. Anything
   that later claims more of that edge moves the boundary left, and THAT delta
   is the panel. Active Now is in the baseline, so it can never be mistaken for
   the editor.

   A fifth problem showed up once the first four were fixed: opening from a
   tab with no rail of its own (Quests) rather than one that already has
   Active Now (Friends) baselines against the bare window, because
   openGlance() starts watching before its own navigation to Friends has
   rendered anything. Active Now then mounts a beat later, the boundary walks
   left exactly like a panel appearing would, and the dashboard opens
   squashed. THEME_EDITOR_SETTLE_MS below gives the page a short window to
   actually settle before any delta from it is trusted. */

// Below this, a shift is noise (a scrollbar, a hover chrome change), not a
// docked panel worth reflowing the whole dashboard for.
const THEME_EDITOR_MIN_DELTA = 120;
// Widest thing still credible as a docked rail. Deliberately absolute: rails
// are a fixed size regardless of window width.
const RAIL_MAX_WIDTH = 520;
// However confident the measurement, never surrender more than one panel's
// worth of the dashboard. A runaway walk should cost a stripe, not the view.
const THEME_EDITOR_MAX_INSET = 560;
// openGlance() navigates to Friends and starts watching in the same tick,
// before Friends has rendered - so its "Active Now" rail mounts a beat later
// and the boundary walks left as the page catches up, not because a panel
// appeared. This window gives it that beat before any delta is trusted. 600ms
// comfortably covers a route transition plus one render (both normally land
// in well under half that even on a slow machine) while staying short enough
// that a theme editor genuinely already open when the overlay opens - see
// themeEditorBaselineKnown, which is what actually keeps that case safe - is
// only briefly unrecognised rather than left overlapping for a while.
const THEME_EDITOR_SETTLE_MS = 600;

// The last inset we actually applied, remembered ACROSS overlay close/reopen
// (the module outlives the overlay). Reopening while the editor is already up
// captures a baseline that already contains it, so the delta is zero and the
// dashboard would overlap the editor again. This is what we knew last time.
let lastThemeEditorInset = 0;

/**
 * The leftmost edge of a rail whose right edge sits at `rightEdge`, if any.
 * Returned RAW, not rounded to a pixel: `measureRightBoundary` rounds it
 * where it needs an integer to chain hops with, but hands the first hop's
 * unrounded value back to its own caller too, so a caller sizing an inset off
 * it can round toward more space instead of inheriting whatever direction
 * Math.round happened to pick.
 */
function railLeftEdgeAt(rightEdge: number): number | null {
    let leftmost: number | null = null;
    const x = Math.round(rightEdge) - 3;
    if (x < 0) return null;

    // Several heights, the way measureTopChrome samples several depths: one
    // sample can land on a tooltip or a rounded corner and miss the rail.
    for (const fraction of [0.3, 0.5, 0.7]) {
        const y = Math.round(window.innerHeight * fraction);
        for (const el of document.elementsFromPoint(x, y)) {
            const html = el as HTMLElement;
            if (html === document.documentElement || html === document.body) continue;
            // Our own overlay is on top of everything; never measure ourselves
            if (html.closest(".vc-glance-overlay")) continue;

            const rect = html.getBoundingClientRect();
            const endsHere = Math.abs(rect.right - rightEdge) <= 4;
            const tall = rect.height >= window.innerHeight * 0.5;
            // An absolute cap, not a fraction of the window. Discord's rails are
            // a fixed size (Active Now about 420, the theme editor about 340)
            // and do not grow with the window. A percentage let the friends
            // list itself qualify on a wide screen, so the walk hopped straight
            // through the page and squashed the dashboard against the left.
            const isRail = rect.width > 0 && rect.width <= RAIL_MAX_WIDTH;

            if (endsHere && tall && isRail) {
                leftmost = leftmost === null ? rect.left : Math.min(leftmost, rect.left);
            }
        }
    }
    return leftmost;
}

/** What `measureRightBoundary` found: the walked boundary for DETECTING a
 *  change, plus the outermost rail's own raw left edge for SIZING one. */
interface RightBoundary {
    boundary: number;
    outermostLeft: number | null;
}

/**
 * Where the contiguous stack of docked right-side rails begins, and where the
 * single rail actually touching the window's right edge begins.
 *
 * Walking the whole stack matters for `boundary`, and getting this wrong is
 * what broke an earlier attempt. Measuring only the outermost rail looks
 * correct until the theme editor opens: it takes the window edge and shoves
 * "Active Now" inward, so Active Now stops touching the edge and drops out of
 * the measurement. The boundary then moves RIGHT (1713 to about 1790 on a
 * 2133px window), which reads as the chrome shrinking rather than a panel
 * appearing. Following each rail to the next one left keeps the whole stack
 * in view, so a new panel can only ever push the boundary further left.
 *
 * `outermostLeft` is just the FIRST hop of that same walk, kept raw instead of
 * rounded. It is one direct measurement of a single rail's edge, with none of
 * the second (or third) hop's rounding and tolerance-matching slack folded in
 * on top. See applyThemeEditorInset for why that distinction is the fix.
 */
function measureRightBoundary(): RightBoundary {
    let boundary = window.innerWidth;
    let outermostLeft: number | null = null;
    try {
        // Bounded: MAX_COLUMNS-ish depth is plenty for real chrome, and a cap
        // means a pathological layout can never spin here.
        for (let hops = 0; hops < 5; hops++) {
            const left = railLeftEdgeAt(boundary);
            if (left === null || left >= boundary) break;
            if (hops === 0) outermostLeft = left;
            boundary = Math.round(left);
        }
    } catch (e) {
        logger.error("Failed to measure the right boundary", e);
        return { boundary: window.innerWidth, outermostLeft: null };
    }
    return { boundary, outermostLeft };
}

function themeEditorDebug(message: string, detail: Record<string, unknown>) {
    // Read defensively: a setting added after a user's config was written can
    // come back undefined, and a diagnostic that silently no-ops is worse than
    // useless when it is the only thing telling us why a feature does nothing.
    if (settings.store.debugThemeEditor !== true) return;
    logger.info(`[theme editor] ${message}`, detail);
}

let themeEditorObserver: MutationObserver | null = null;
let themeEditorDebounce: ReturnType<typeof setTimeout> | null = null;
let themeEditorResizeHandler: (() => void) | null = null;
let themeEditorWidth = 0;
// Where docked right-side chrome sat when the overlay opened. null until first
// measured; reset on close so a stale baseline can never survive into a new
// session with a different window size or page.
let themeEditorBaseline: number | null = null;
// Wall-clock deadline for the settling window a call to watchThemeEditor()
// starts. Checked fresh against Date.now() from inside
// applyThemeEditorInset() on every call rather than driven by a timer of its
// own: the mutation observer's debounce below already calls that function
// repeatedly while the page is still moving (that is what settling needs to
// observe in the first place), so the window just stops being honoured once
// the clock runs out instead of needing something to notice and flip it off.
let themeEditorSettleUntil = 0;
// True once this session's baseline is a KNOWN value rather than a first
// guess - specifically, once the "restored from a previous session" branch
// below has fired. Settling exists only to smooth over an ambiguous first
// guess; a restored baseline is not a guess, it is memory of where the editor
// actually was. Without this, the settling window's leftward tracking would
// walk that restored baseline straight back down to the raw boundary on the
// very next mutation and undo the fix restoring it was for.
let themeEditorBaselineKnown = false;

/** Pulls the overlay's right edge in by the panel's measured width, or lets it go full width again. */
function applyThemeEditorInset() {
    if (!overlayContainer) return;

    const { boundary, outermostLeft } = measureRightBoundary();

    // A baseline wider than the window is impossible and means it was captured
    // at a different window size (dragging between monitors, or any resize).
    // Left alone it poisons every later delta: a 2273px baseline on a 2133px
    // window reads as ~1000px of panel and squashes the dashboard, and because
    // the inset is remembered, reopening cannot clear it either.
    if (themeEditorBaseline !== null && themeEditorBaseline > window.innerWidth) {
        themeEditorDebug("baseline discarded, wider than the window", {
            baseline: themeEditorBaseline, window: window.innerWidth
        });
        themeEditorBaseline = null;
        lastThemeEditorInset = 0;
        themeEditorBaselineKnown = false;
    }

    // First measurement of this overlay session. If we insetted last time and
    // the same amount of rail is still there, the editor never closed while we
    // were away: hold that width OUT of the baseline, or it gets treated as
    // normal chrome and the dashboard overlaps the editor exactly as it did
    // before this was handled.
    if (themeEditorBaseline === null && lastThemeEditorInset > 0) {
        themeEditorBaseline = boundary + lastThemeEditorInset;
        themeEditorBaselineKnown = true;
        themeEditorDebug("baseline restored from a previous session", {
            boundary, carried: lastThemeEditorInset, baseline: themeEditorBaseline
        });
    }

    // Whether an ambiguous first guess is still being smoothed out - see
    // THEME_EDITOR_SETTLE_MS. A known baseline (just restored above) never
    // enters settling: there is nothing ambiguous left to smooth over, and
    // letting it settle anyway would immediately undo the restore.
    const settling = !themeEditorBaselineKnown && Date.now() < themeEditorSettleUntil;

    if (settling) {
        // Still arriving: follow the boundary in EITHER direction as rails
        // mount, rather than only ratcheting outward. This is what makes
        // Active Now mounting a beat late read as "the page wasn't ready yet"
        // instead of "a 420px panel appeared".
        if (themeEditorBaseline === null || boundary !== themeEditorBaseline) {
            themeEditorDebug("baseline settling", { boundary, previous: themeEditorBaseline });
            themeEditorBaseline = boundary;
        }
    } else if (themeEditorBaseline === null || boundary > themeEditorBaseline) {
        // The boundary can legitimately move RIGHT: navigating away from a
        // view that had a rail, or collapsing the member list. That is a new
        // normal, not an editor closing, so the baseline follows it up. Once
        // settling is over it only ever ratchets outward, which is what keeps
        // a genuine editor readable as a leftward delta rather than being
        // absorbed into the baseline.
        themeEditorDebug("baseline set", { boundary, previous: themeEditorBaseline });
        themeEditorBaseline = boundary;
    }

    // The delta only ever DETECTS that a panel appeared; it must not also be
    // used to SIZE the gap for it. It is the difference between two walks
    // that can each be a hop or two deep, and every hop both rounds a
    // fractional getBoundingClientRect value and matches "ends here" within a
    // 4px tolerance. That slack is harmless for a yes/no detection but shows
    // up directly as an undersized inset if it is spent on the width too -
    // which is exactly how "Customise" ended up clipped by a few pixels.
    const delta = themeEditorBaseline - boundary;
    // While settling, whatever the delta says is not trusted enough to act
    // on. Failure here costs nothing, same as any other low-confidence
    // measurement below: no inset rather than a wrong one.
    const editorPresent = !settling && delta >= THEME_EDITOR_MIN_DELTA;

    // Once a panel is confirmed, size off ONE direct measurement instead: the
    // outermost rail - the one actually touching the window's right edge - is
    // the same rail the walk above visits first, so this costs nothing extra.
    // Ceil, not round: a sub-pixel edge must always cost a little too MUCH gap,
    // never a little too little, or the same wrong-direction rounding just
    // moves here instead of going away.
    let width = 0;
    let insetSource: "settling" | "not-detected" | "no-measurement" | "outermost-edge" | "clamped" =
        settling ? "settling" : "not-detected";
    if (editorPresent) {
        if (outermostLeft === null) {
            // Delta says a panel is there but the direct measurement came back
            // empty (a mid-mutation DOM read, most likely). No confident
            // measurement means no inset, same as if nothing had been detected.
            insetSource = "no-measurement";
        } else {
            const measured = Math.ceil(window.innerWidth - outermostLeft);
            // Clamped: a measurement gone wrong should cost a stripe of the
            // dashboard, never the whole view. One panel's worth is the most
            // that can ever be legitimate here.
            width = Math.min(measured, THEME_EDITOR_MAX_INSET);
            insetSource = measured > THEME_EDITOR_MAX_INSET ? "clamped" : "outermost-edge";
        }
    }

    themeEditorDebug("measured", {
        boundary, baseline: themeEditorBaseline, delta, outermostLeft, settling, source: insetSource, applying: width
    });

    if (width === themeEditorWidth) return;
    themeEditorWidth = width;
    lastThemeEditorInset = width;
    overlayContainer.style.right = width > 0 ? `${width}px` : "";
    themeEditorDebug("applied", { right: overlayContainer.style.right || "(full width)" });
}

/**
 * Watches the app root for the editor panel mounting or unmounting so the
 * overlay can react without polling. Geometry is cheap to re-check but not
 * free, so bursts of unrelated mutations (message list virtualisation, typing
 * indicators, the dashboard's own drag-and-drop) are coalesced into one
 * recheck ~120ms after things go quiet rather than one per mutation record.
 */
function watchThemeEditor() {
    const root = document.getElementById("app-mount") ?? document.body;
    const observer = new MutationObserver(() => {
        if (themeEditorDebounce) clearTimeout(themeEditorDebounce);
        themeEditorDebounce = setTimeout(() => {
            themeEditorDebounce = null;
            applyThemeEditorInset();
        }, 120);
    });
    try {
        observer.observe(root, { childList: true, subtree: true });
    } catch (e) {
        logger.error("Failed to watch for the theme editor panel", e);
        return;
    }
    themeEditorObserver = observer;

    // A baseline only describes one window size. Resizing, or dragging between
    // monitors, invalidates it completely: the old value survived into the new
    // window and every delta after that was measured against a boundary that no
    // longer existed. Throw it away and measure the new window fresh.
    themeEditorResizeHandler = () => {
        themeEditorBaseline = null;
        lastThemeEditorInset = 0;
        themeEditorWidth = 0;
        if (overlayContainer) overlayContainer.style.right = "";
        themeEditorDebug("window resized, re-baselining", { window: window.innerWidth });
        applyThemeEditorInset();
    };
    window.addEventListener("resize", themeEditorResizeHandler);

    // Opens this session's settling window - see THEME_EDITOR_SETTLE_MS. Must
    // be set before the synchronous measurement just below, since that first
    // call is itself allowed to settle.
    themeEditorSettleUntil = Date.now() + THEME_EDITOR_SETTLE_MS;
    themeEditorBaselineKnown = false;

    // Synchronous initial measurement so an already-open editor narrows the
    // overlay before its first paint, instead of opening full width and
    // jumping narrow a moment later.
    applyThemeEditorInset();

    // One unconditional line per open. Two silent failures of this feature were
    // impossible to tell apart from the code never running at all, so this
    // proves it ran and states what it saw. The per-change detail stays behind
    // the debug setting; this is the heartbeat.
    logger.info(
        `[theme editor] watching. baseline ${themeEditorBaseline}px, window ${window.innerWidth}px, `
        + `settling for ${THEME_EDITOR_SETTLE_MS}ms unless already known.`
        + " Enable the theme editor debug setting for per-change detail."
    );
}

function stopWatchingThemeEditor() {
    themeEditorBaseline = null;
    themeEditorSettleUntil = 0;
    themeEditorBaselineKnown = false;
    if (themeEditorResizeHandler) {
        window.removeEventListener("resize", themeEditorResizeHandler);
        themeEditorResizeHandler = null;
    }
    themeEditorObserver?.disconnect();
    themeEditorObserver = null;
    if (themeEditorDebounce) {
        clearTimeout(themeEditorDebounce);
        themeEditorDebounce = null;
    }
    themeEditorWidth = 0;
    if (overlayContainer) overlayContainer.style.right = "";
}

/* ========== mount / unmount ========== */

let overlayRoot: ReturnType<typeof createRoot> | null = null;
let overlayContainer: HTMLDivElement | null = null;

export function openGlance() {
    if (layerOpen) return;
    try {
        // Land on the neutral DM home underneath, so no user-DM state lingers
        // anywhere in the chrome - this view is its own thing
        try {
            NavigationRouter.transitionTo("/channels/@me");
        } catch { }

        const { top, bars } = measureTopChrome();
        coverToolbar(bars);

        overlayContainer = document.createElement("div");
        overlayContainer.className = "vc-glance-overlay";
        overlayContainer.style.top = `${top}px`;
        (document.getElementById("app-mount") ?? document.body).appendChild(overlayContainer);
        // Before the first render, so a theme editor already open narrows the
        // overlay from its very first paint instead of opening full width
        // and snapping narrow a frame later.
        watchThemeEditor();
        overlayRoot = createRoot(overlayContainer);
        overlayRoot.render(<SafeGlanceLayer />);
        // Lets CSS hide Discord's own bottom-left user panel (and its game
        // activity chip) while our rail strip replaces it
        document.body.setAttribute("data-vc-glance-open", "");
        openedAt = Date.now();
        setLayerOpen(true);
    } catch (e) {
        logger.error("Failed to mount overlay", e);
        showToast("At a glance could not open - Discord internals may have changed.", Toasts.Type.FAILURE);
        uncoverToolbar();
        stopWatchingThemeEditor();
        overlayContainer?.remove();
        overlayContainer = null;
        overlayRoot = null;
    }
}

export function closeGlance() {
    if (!layerOpen) return;
    setLayerOpen(false);
    setEditMode(false);
    setPrivacyMode(false);
    closeCustomizePanel();
    uncoverToolbar();
    stopWatchingThemeEditor();
    document.body.removeAttribute("data-vc-glance-open");

    const root = overlayRoot;
    const container = overlayContainer;
    overlayRoot = null;
    overlayContainer = null;

    // Deferred so unmounting never happens synchronously from inside one of
    // the overlay's own event handlers
    setTimeout(() => {
        try {
            root?.unmount();
        } catch (e) {
            logger.error("Failed to unmount overlay", e);
        }
        container?.remove();
    }, 0);
}

/** Called from the plugin's stop() so a disabled plugin never leaves a dead overlay behind */
export function closeGlanceIfOpen() {
    if (layerOpen) closeGlance();
}

/* ========== add widget menu ========== */

function openAddWidgetMenu(e: React.MouseEvent, hiddenWidgets: WidgetId[]) {
    ContextMenuApi.openContextMenu(e, () => (
        <Menu.Menu
            navId="vc-glance-add-widget"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Toggle widgets"
        >
            {WIDGET_META.map(w => (
                <Menu.MenuCheckboxItem
                    key={w.id}
                    id={`vc-glance-toggle-${w.id}`}
                    label={w.label}
                    checked={!hiddenWidgets.includes(w.id)}
                    action={() => toggleWidgetHidden(w.id)}
                />
            ))}
        </Menu.Menu>
    ));
}

/* ========== edit mode entry point ========== */

function confirmResetLayout() {
    openConfirm({
        title: "Reset layout?",
        body: "Widget order and columns go back to their defaults. Hidden widgets, pins, notes, bookmarks, reminders and your weather location are untouched.",
        confirmText: "Reset layout",
        onConfirm: resetLayout
    });
}

function confirmRestoreDefaults() {
    openConfirm({
        title: "Restore defaults?",
        body: "Widget order, columns and hidden widgets all go back to their defaults. Pins, notes, bookmarks, reminders and your weather location are untouched.",
        confirmText: "Restore defaults",
        onConfirm: restoreDefaults
    });
}

function openLayoutMenu(e: React.MouseEvent) {
    ContextMenuApi.openContextMenu(e, () => (
        <Menu.Menu
            navId="vc-glance-layout-menu"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Layout options"
        >
            <Menu.MenuItem id="vc-glance-reset-layout" label="Reset layout" color="danger" action={confirmResetLayout} />
            <Menu.MenuItem id="vc-glance-restore-defaults" label="Restore defaults" color="danger" action={confirmRestoreDefaults} />
        </Menu.Menu>
    ));
}

/**
 * Edit Layout / Done, and - only while editing - the reset/restore overflow
 * beside it. Layout-mutating actions live behind edit mode rather than in the
 * always-visible Add Widget menu, the same "hide it until you're editing"
 * idea as the drag grip below.
 */
function EditModeControls() {
    const editing = useEditMode();

    if (!editing) {
        return (
            <button className="vc-glance-button vc-glance-button-secondary" onClick={() => setEditMode(true)}>
                <GripIcon size={16} />
                Edit Layout
            </button>
        );
    }

    return (
        <>
            <button className="vc-glance-button vc-glance-button-secondary" onClick={() => setEditMode(false)}>
                <CheckIcon size={16} />
                Done
            </button>
            <Tooltip text="Layout options">
                {props => (
                    <button
                        {...props}
                        className="vc-glance-icon-button"
                        aria-label="Layout options"
                        onClick={openLayoutMenu}
                    >
                        <DotsIcon size={16} />
                    </button>
                )}
            </Tooltip>
        </>
    );
}

/* ========== drag & drop ========== */

interface DragState {
    id: WidgetId;
    /** Rendered column the widget was picked up from - seeds the initial
     *  landing index. Not consulted at commit time: the write there is
     *  unconditional, see the comment in finish() for why. */
    originColumn: number;
    width: number;
    height: number;
    x: number;
    y: number;
    grabX: number;
    grabY: number;
    overColumn: number;
    overIndex: number;
}

interface DragController {
    beginDrag(id: WidgetId, e: React.PointerEvent): void;
}

// Created on first use, NEVER at module scope: `React` from @webpack/common
// is a lazy proxy, and touching it while the bundle is still evaluating
// (before Discord's webpack exists) throws and kills the whole renderer.
let dragContext: React.Context<DragController | null> | undefined;

function getDragContext() {
    return dragContext ??= React.createContext<DragController | null>(null);
}

export function useWidgetDrag() {
    return React.useContext(getDragContext());
}

let widgetDragActive = false;

/**
 * Renders however many columns are either actually assigned something or, while
 * a drag is in progress, one more than that - so the next column over exists as
 * a real drop target instead of only appearing after something already lives
 * there. That circularity (nothing renders column 2 until it holds a widget, but
 * nothing can be dropped into column 2 until it renders) is the whole reason the
 * "+1 during drag" branch exists below.
 *
 * Column 0 always renders, so an entirely empty dashboard still has somewhere to
 * put things back.
 */
function Workspace() {
    useGlanceConfig();
    const ref = React.useRef<HTMLDivElement>(null);
    const widthAllows = useColumnCount(ref);
    const reduceMotion = AccessibilityStore.useReducedMotion;

    // Drag state lives here, above any one column, so a pointer that leaves
    // the column it started in is still tracked rather than going invisible
    // the moment it crosses a column boundary.
    const [drag, setDrag] = React.useState<DragState | null>(null);
    const dragRef = React.useRef<DragState | null>(null);
    // Set while a drag's listeners are attached, cleared on finish. Lets the
    // unmount effect below cancel a drag left running when the dashboard
    // closes mid-gesture, rather than leaving window listeners behind forever.
    const cleanupRef = React.useRef<(() => void) | null>(null);
    React.useEffect(() => () => cleanupRef.current?.(), []);

    // How far right anything is actually assigned, ignoring width. Column 0
    // always renders so an empty dashboard still has somewhere to drop things.
    let assigned = 1;
    for (let i = MAX_COLUMNS - 1; i >= 1; i--) {
        if (widgetsInColumn(i).length > 0) { assigned = i + 1; break; }
    }
    const wanted = drag ? Math.min(assigned + 1, MAX_COLUMNS) : assigned;
    const rendered = Math.min(wanted, widthAllows);
    // Read from event handlers below, which run outside React's render and
    // need the fold width as it stands right now, not as it stood when the
    // drag began.
    const renderedRef = React.useRef(rendered);
    renderedRef.current = rendered;

    const controller = React.useMemo<DragController>(() => ({
        beginDrag(id, e) {
            if (e.button !== 0 || dragRef.current) return;
            const card = ref.current?.querySelector<HTMLElement>(`[data-glance-widget="${id}"]`);
            const originEl = card?.closest<HTMLElement>("[data-glance-column]");
            if (!card || !originEl) return;

            e.preventDefault();
            const originColumn = Number(originEl.dataset.glanceColumn);
            const rect = card.getBoundingClientRect();
            const state: DragState = {
                id,
                originColumn,
                width: rect.width,
                height: rect.height,
                x: e.clientX,
                y: e.clientY,
                grabX: e.clientX - rect.left,
                grabY: e.clientY - rect.top,
                overColumn: originColumn,
                overIndex: Math.max(0, widgetsInColumn(originColumn, renderedRef.current).indexOf(id))
            };
            dragRef.current = state;
            widgetDragActive = true;
            document.body.classList.add("vc-glance-dragging");
            setDrag(state);

            // Column first (by horizontal band, so an empty column with no
            // cards yet - zero height - is still a valid target), then index
            // within whichever column that turned out to be.
            const locateTarget = (clientX: number, clientY: number) => {
                const columns = [...(ref.current?.querySelectorAll<HTMLElement>("[data-glance-column]") ?? [])];
                if (!columns.length) return null;

                let target = columns[0];
                let bestDist = Infinity;
                for (const el of columns) {
                    const r = el.getBoundingClientRect();
                    const dist = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
                    if (dist < bestDist) {
                        bestDist = dist;
                        target = el;
                    }
                }

                const cards = [...target.querySelectorAll<HTMLElement>("[data-glance-widget]")]
                    .filter(el => el.dataset.glanceWidget !== state.id);
                let overIndex = cards.length;
                for (let i = 0; i < cards.length; i++) {
                    const r = cards[i].getBoundingClientRect();
                    if (clientY < r.top + r.height / 2) { overIndex = i; break; }
                }
                return { column: Number(target.dataset.glanceColumn), overIndex };
            };

            const onMove = (ev: PointerEvent) => {
                const { current } = dragRef;
                if (!current) return;
                const hit = locateTarget(ev.clientX, ev.clientY);
                const next: DragState = {
                    ...current,
                    x: ev.clientX,
                    y: ev.clientY,
                    overColumn: hit?.column ?? current.overColumn,
                    overIndex: hit?.overIndex ?? current.overIndex
                };
                dragRef.current = next;
                setDrag(next);
            };

            const finish = (commit: boolean) => {
                const { current } = dragRef;
                dragRef.current = null;
                cleanupRef.current = null;
                widgetDragActive = false;
                document.body.classList.remove("vc-glance-dragging");
                setDrag(null);
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
                window.removeEventListener("keydown", onKey, true);

                if (commit && current) {
                    // Written unconditionally, even when overColumn matches
                    // originColumn: at a folded width a widget's STORED column
                    // can sit higher than the one it is actually rendered in,
                    // and setColumnOrder below only accepts siblings whose
                    // stored column already equals the target - so a drop has
                    // to settle the real column first, or a folded widget's
                    // own reorder would be silently rejected by its own commit.
                    setWidgetColumn(current.id, current.overColumn);
                    const siblings = widgetsInColumn(current.overColumn, renderedRef.current)
                        .filter(w => w !== current.id);
                    siblings.splice(Math.min(current.overIndex, siblings.length), 0, current.id);
                    setColumnOrder(current.overColumn, siblings);
                }
            };

            const onUp = () => finish(true);
            const onKey = (ev: KeyboardEvent) => {
                if (ev.key === "Escape") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    finish(false);
                }
            };

            cleanupRef.current = () => finish(false);
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
            window.addEventListener("keydown", onKey, true);
        }
        // Everything read inside comes off refs (dragRef, renderedRef, ref
        // itself never changes identity), so this never needs to be recreated.
    }), []);

    const DragContext = getDragContext();

    return (
        <DragContext.Provider value={controller}>
            <div className="vc-glance-workspace" data-columns={rendered} ref={ref}>
                {Array.from({ length: rendered }, (_, column) => (
                    <WidgetColumn key={column} column={column} renderedCount={rendered} drag={drag} />
                ))}
            </div>

            {drag && (
                <div
                    className={"vc-glance-drag-ghost" + (reduceMotion ? " vc-glance-no-motion" : "")}
                    style={{
                        width: drag.width,
                        left: drag.x - drag.grabX,
                        top: drag.y - drag.grabY
                    }}
                >
                    {WIDGET_RENDERERS[drag.id]()}
                </div>
            )}
        </DragContext.Provider>
    );
}

function WidgetColumn({ column, renderedCount, drag }: { column: number; renderedCount: number; drag: DragState | null; }) {
    const widgets = useOrderedWidgets(column, renderedCount);
    // Null unless the shared drag is actually hovering THIS column, so a drop
    // slot only ever renders in one place at a time no matter how many
    // columns are mounted.
    const dropHere = drag && drag.overColumn === column ? drag : null;
    const visible = drag ? widgets.filter(id => id !== drag.id) : widgets;

    const slots: React.ReactNode[] = [];
    visible.forEach((id, i) => {
        if (dropHere && i === dropHere.overIndex) {
            slots.push(
                <div
                    key="vc-glance-drop-slot"
                    className="vc-glance-drop-slot"
                    style={{ height: dropHere.height }}
                />
            );
        }
        slots.push(
            <div key={id} data-glance-widget={id} className="vc-glance-widget-slot">
                {WIDGET_RENDERERS[id]()}
            </div>
        );
    });
    if (dropHere && dropHere.overIndex >= visible.length) {
        slots.push(
            <div
                key="vc-glance-drop-slot"
                className="vc-glance-drop-slot"
                style={{ height: dropHere.height }}
            />
        );
    }

    return (
        // No fallback message when empty: a column is just wherever widgets
        // happen to be assigned, not a labelled region promising content. The
        // empty div itself stays in the DOM (never display: none) so it works
        // as a cross-column drop target, including the preview column
        // Workspace renders ahead of anything actually being assigned to it.
        // data-glance-column is what a drag in any OTHER column uses to find
        // this one; it has to survive independent of the vc-glance-column-N
        // class, which exists for the stagger animation, not identification.
        <div className={`vc-glance-column vc-glance-column-${column}`} data-glance-column={column}>
            {slots}
        </div>
    );
}

/* ========== the layer ========== */

function GlanceLayer() {
    const { tabLabel } = settings.use(["tabLabel"]);
    const { hiddenWidgets } = useGlanceConfig();
    const { materialClass, style: appearanceStyle } = useAppearance();
    const onLightTheme = useOnLightTheme();
    const privacyMode = usePrivacyMode();
    const [paletteOpen, setPaletteOpen] = React.useState(false);
    const paletteOpenRef = React.useRef(false);
    paletteOpenRef.current = paletteOpen;

    // Palette hotkey runs in the CAPTURE phase so it fires before - and
    // stops - Discord's own shortcut (e.g. its Ctrl+K quick switcher). The
    // combo is user-configurable; default Shift+Space avoids any collision.
    React.useEffect(() => {
        function onPaletteKey(e: KeyboardEvent) {
            const combo = settings.store.commandPaletteHotkey?.trim();
            if (!combo || !matchesKeyboardCombo(e, combo)) return;

            // Don't hijack a plain (no ctrl/alt/meta) combo while the user is
            // typing - e.g. Shift+Space must still type a space in a text box,
            // including the palette's own search input
            if (!e.ctrlKey && !e.altKey && !e.metaKey) {
                const target = e.target as HTMLElement | null;
                if (target?.closest?.("input, textarea, [contenteditable=\"true\"]")) return;
            }

            e.preventDefault();
            e.stopPropagation();
            setPaletteOpen(true);
        }
        window.addEventListener("keydown", onPaletteKey, true);
        return () => window.removeEventListener("keydown", onPaletteKey, true);
    }, []);

    React.useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            // Bubble phase + guards: modals, menus, the channel popup, the
            // palette and an active widget drag all get first crack at Escape
            if (e.key === "Escape" && !e.defaultPrevented && !isChannelPopupOpen() && !widgetDragActive && !paletteOpenRef.current) {
                closeGlance();
            }
        }

        // Navigating anywhere (clicking a server in the still-interactive
        // rail, a mention, etc.) dismisses the view like a normal page.
        // Grace period swallows the CHANNEL_SELECT our own open triggers.
        function onChannelSelect(event: any) {
            if (event?.channelId && Date.now() - openedAt > 800) closeGlance();
        }

        // The home / Direct-Messages button in the guild rail navigates to
        // /channels/@me - where we already are - so it fires no CHANNEL_SELECT
        // and the overlay would just sit there. Close on it (and any explicit
        // home/Friends link) so it behaves like leaving a page. Capture phase +
        // a tick's delay so Discord's own navigation still runs and lands you
        // back on Friends. HOME_SELECTOR stays broad on purpose (Discord's ids
        // churn): the guild-nav home item, or any anchor straight to @me.
        function onNavClick(e: MouseEvent) {
            if (Date.now() - openedAt < 400) return;
            const target = e.target as HTMLElement | null;
            if (target?.closest?.('[data-list-item-id="guildsnav___home"], a[href="/channels/@me"], a[href="/channels/@me/"]')) {
                closeGlance();
            }
        }

        function onResize() {
            if (overlayContainer) overlayContainer.style.top = `${measureTopChrome().top}px`;
            // The editor's own width (and whether it still passes the
            // full-height check) can change with the window, same as the
            // top chrome above
            applyThemeEditorInset();
        }

        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("resize", onResize);
        window.addEventListener("click", onNavClick, true);
        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("resize", onResize);
            window.removeEventListener("click", onNavClick, true);
            FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect);
            // Covers the overlay being removed by any path other than closeGlance()
            setLayerOpen(false);
            setEditMode(false);
            setPrivacyMode(false);
            closeCustomizePanel();
            uncoverToolbar();
            stopWatchingThemeEditor();
            document.body.removeAttribute("data-vc-glance-open");
            // Don't let a still-open popup auto-reappear next time we open
            closeChannelPopup();
        };
    }, []);

    return (
        <div
            className={"vc-glance-layer" + materialClass + (onLightTheme ? " vc-glance-on-light" : "")}
            style={appearanceStyle}
        >
            <div className="vc-glance-frame">
                {/* Native-style top bar; the title doubles as the way back out */}
                <header className="vc-glance-topbar">
                    <Tooltip text="Back to Discord">
                        {props => (
                            <button {...props} className="vc-glance-topbar-back" onClick={closeGlance}>
                                <DashboardIcon className="vc-glance-topbar-icon" size={20} />
                                <span className="vc-glance-topbar-title">{tabLabel || "At a glance"}</span>
                            </button>
                        )}
                    </Tooltip>
                    <div className="vc-glance-topbar-actions">
                        <EditModeControls />
                        <button
                            className="vc-glance-button vc-glance-button-brand"
                            onClick={e => openAddWidgetMenu(e, hiddenWidgets)}
                        >
                            <PlusIcon size={16} />
                            Add Widget
                        </button>
                        <Tooltip text="Customization">
                            {props => (
                                <button
                                    {...props}
                                    className="vc-glance-icon-button"
                                    onClick={openCustomizePanel}
                                >
                                    <PaletteIcon size={18} />
                                </button>
                            )}
                        </Tooltip>
                        {/* Blurs pinned friends, server names and the weather location so
                            the dashboard can be screen-shared without a live decode of who
                            the user talks to. The pressed state doubles as the "still on"
                            indicator once the blurred widgets themselves scroll out of view,
                            since this button lives in the topbar and never does. */}
                        <Tooltip text={privacyMode ? "Turn off privacy blur" : "Turn on privacy blur"}>
                            {props => (
                                <button
                                    {...props}
                                    className={"vc-glance-icon-button" + (privacyMode ? " vc-glance-icon-button-active" : "")}
                                    aria-pressed={privacyMode}
                                    aria-label={privacyMode ? "Privacy blur is on. Turn off." : "Privacy blur is off. Turn on."}
                                    onClick={() => setPrivacyMode(!privacyMode)}
                                >
                                    <EyeIcon size={18} slash={privacyMode} />
                                </button>
                            )}
                        </Tooltip>
                        <button
                            className="vc-glance-icon-button vc-glance-topbar-close"
                            aria-label="Close (Esc)"
                            onClick={closeGlance}
                        >
                            ✕
                        </button>
                    </div>
                </header>

                <div className="vc-glance-scroll">
                    <ErrorBoundary noop>
                        <GlanceHeader onSearch={() => setPaletteOpen(true)} />
                    </ErrorBoundary>
                    <Workspace />
                </div>
            </div>

            {/* Docked, not modal - a flex sibling of .vc-glance-frame above, so
                opening it narrows the frame (and everything measuring it, like
                the workspace's column count) through ordinary layout instead
                of an inline width the two of them would have to coordinate on. */}
            <ErrorBoundary noop>
                <CustomizePanel />
            </ErrorBoundary>

            <ErrorBoundary noop>
                <RailUserStrip />
            </ErrorBoundary>

            {paletteOpen && (
                <ErrorBoundary noop>
                    <CommandPalette onClose={() => setPaletteOpen(false)} />
                </ErrorBoundary>
            )}

            {/* The channel popup host lives in GlanceTab (Discord's tree), not
                here: this layer is its own React root without Discord's context
                providers, and the expression picker/autocomplete need them. */}
        </div>
    );
}

const SafeGlanceLayer = ErrorBoundary.wrap(GlanceLayer);
