/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import {
    AccessibilityStore,
    ContextMenuApi,
    FluxDispatcher,
    Menu,
    NavigationRouter,
    React,
    Tooltip
} from "@webpack/common";

import {
    LoadState,
    MAX_COLUMNS,
    resetLayout,
    restoreDefaults,
    retryLoadConfig,
    setColumnOrder,
    setWidgetColumn,
    toggleWidgetHidden,
    useGlanceConfig,
    useGlanceLoadState,
    useOrderedWidgets,
    WIDGET_META,
    WidgetId,
    widgetsInColumn } from "../data";
import { matchesKeyboardCombo } from "../hotkeys";
import { settings } from "../settings";
import { useAppearance } from "./appearance";
import { closeChannelPopup, isChannelPopupOpen } from "./ChannelPopup";
import { CommandPalette } from "./CommandPalette";
import { closeCustomizePanel, CustomizePanel, openCustomizePanel } from "./CustomizePanel";
import { GlanceHeader } from "./GlanceHeader";
import { useColumnCount } from "./hooks";
import { CheckIcon, DashboardIcon, DotsIcon, EyeIcon, GripIcon, PaletteIcon, PlusIcon } from "./icons";
import { openConfirm } from "./PromptModal";
import { RailUserStrip } from "./RailUserStrip";
import { glanceToast } from "./toast";
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

/* ========== enabled flag ========== */

// Patches persist until Discord restarts, so after the plugin stops, the
// sidebar tab and the host are still rendered by Discord. Opening the dashboard
// then would show "Loading your dashboard" for ever, because stop() reset the
// store. This flag says whether the plugin is running: start() sets it, stop()
// clears it, and while it is false the tab renders nothing and nothing opens.
let glanceEnabled = false;
const enabledListeners = new Set<() => void>();

export function setGlanceEnabled(enabled: boolean) {
    if (glanceEnabled === enabled) return;
    glanceEnabled = enabled;
    // A startup open still waiting for the host is moot once the plugin stops
    if (!enabled) cancelPendingOpen();
    for (const listener of [...enabledListeners]) {
        try {
            listener();
        } catch { }
    }
}

export function useGlanceEnabled() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => {
        enabledListeners.add(forceUpdate);
        return () => void enabledListeners.delete(forceUpdate);
    }, []);
    return glanceEnabled;
}

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

/* ========== host: a cell of Discord's own app grid ========== */

// How many hosts are mounted. The AppView patch renders exactly one; zero
// means Discord's layout changed under the patch.
let hostCount = 0;

/**
 * Rendered by the AppView patch (discordChecks.ts) as a child of Discord's
 * content subgrid. Discord's layout places and sizes it - right of the guild
 * rail, under the title and notice bars, beside the theme editor when that
 * docks - so nothing here measures anything. Being in Discord's own tree
 * also gives the dashboard Discord's context providers.
 */
export function GlanceHost() {
    const open = useGlanceOpen();
    React.useEffect(() => {
        hostCount++;
        // A startup open was waiting for this host to mount
        if (pendingOpen) {
            cancelPendingOpen();
            openGlance();
        }
        return () => void hostCount--;
    }, []);
    if (!open) return null;
    return (
        <div className="vc-glance-host">
            <SafeGlanceLayer />
        </div>
    );
}

export function openGlance() {
    if (!glanceEnabled || layerOpen) return;
    // Land on the neutral DM home underneath, so no user-DM state lingers
    // anywhere in the chrome and GlanceTab (the channel popup's host) is mounted
    try {
        NavigationRouter.transitionTo("/channels/@me");
    } catch { }
    // Lets CSS hide Discord's own user panel while RailUserStrip replaces it
    document.body.setAttribute("data-vc-glance-open", "");
    openedAt = Date.now();
    const thisOpen = openedAt;
    setLayerOpen(true);
    // No host means the AppView patch did not apply: say so rather than
    // leave the tab looking selected over an unchanged page.
    setTimeout(() => {
        if (layerOpen && openedAt === thisOpen && hostCount === 0) {
            closeGlance();
            glanceToast("At a glance could not open - Discord's layout has changed.", "failure");
        }
    }, 2000);
}

// The startup open. It differs from openGlance in one way: it does not trust
// openGlance's 2 s no-host check. On a cold start, a slow disk or the first run
// after an update, Discord's AppView can commit later than that, and the check
// would close the dashboard and claim the layout had changed when it had not. So
// if no host is mounted yet, this waits for GlanceHost to mount and only gives up
// after a much longer fallback. User-initiated opens (the sidebar tab) keep the
// short check, because by then the app has long since rendered.
const PENDING_OPEN_FALLBACK_MS = 20_000;
let pendingOpen = false;
let pendingOpenTimer: ReturnType<typeof setTimeout> | null = null;

function cancelPendingOpen() {
    pendingOpen = false;
    if (pendingOpenTimer !== null) {
        clearTimeout(pendingOpenTimer);
        pendingOpenTimer = null;
    }
}

export function openGlanceWhenReady() {
    if (!glanceEnabled) return;
    if (hostCount > 0) {
        openGlance();
        return;
    }
    cancelPendingOpen();
    pendingOpen = true;
    pendingOpenTimer = setTimeout(() => {
        pendingOpenTimer = null;
        // GlanceHost clears the flag when it mounts, so a set flag means it never did
        if (!pendingOpen) return;
        pendingOpen = false;
        glanceToast("At a glance could not open - Discord's layout has changed.", "failure");
    }, PENDING_OPEN_FALLBACK_MS);
}

export function closeGlance() {
    if (!layerOpen) return;
    setLayerOpen(false);
    setEditMode(false);
    setPrivacyMode(false);
    closeCustomizePanel();
    document.body.removeAttribute("data-vc-glance-open");
}

/** Called from the plugin's stop() so a disabled plugin never leaves the dashboard open, or Discord's user panel hidden */
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

/* ========== load states ========== */

/** Shown instead of the workspace until this account's data has loaded. An
 *  empty grid in its place would look exactly like lost data. */
function LoadStatePanel({ state }: { state: LoadState; }) {
    if (state === "failed") {
        return (
            <div className="vc-glance-load-failed" role="alert">
                <svg className="vc-glance-load-icon" width="38" height="38" viewBox="0 0 38 38" fill="none" aria-hidden="true">
                    <rect x="5" y="9" width="28" height="22" rx="5" stroke="currentColor" strokeWidth="2" />
                    <path d="M5 15h28" stroke="currentColor" strokeWidth="2" />
                    <path d="M19 20v4.5M19 27.5v.5" stroke="var(--vcg-t-text-primary)" strokeWidth="2.4" strokeLinecap="round" />
                </svg>
                <h2 className="vc-glance-load-title">Your dashboard couldn't be loaded</h2>
                <p className="vc-glance-load-body">Nothing has been changed or lost. At a glance will keep trying, or you can try now.</p>
                <button className="vc-glance-button vc-glance-button-brand" onClick={() => void retryLoadConfig()}>
                    Try again
                </button>
            </div>
        );
    }
    return (
        <div className="vc-glance-load-pending" role="status">
            <span className="vc-glance-load-spinner" aria-hidden="true" />
            Loading your dashboard
        </div>
    );
}

/* ========== the layer ========== */

function GlanceLayer() {
    const { tabLabel } = settings.use(["tabLabel"]);
    const { hiddenWidgets } = useGlanceConfig();
    const { materialClass, style: appearanceStyle, onLightTheme } = useAppearance();
    const privacyMode = usePrivacyMode();
    const loadState = useGlanceLoadState();
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
        // and the dashboard would just sit there. Close on it (and any explicit
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

        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("click", onNavClick, true);
        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("click", onNavClick, true);
            FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect);
            // Covers the dashboard unmounting by any path other than closeGlance(),
            // for example the host unmounting along with AppView
            setLayerOpen(false);
            setEditMode(false);
            setPrivacyMode(false);
            closeCustomizePanel();
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
                    {loadState === "ready" ? <Workspace /> : <LoadStatePanel state={loadState} />}
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

            {/* The channel popup host stays in GlanceTab: GlanceTab is always
                mounted while the dashboard is open (openGlance lands on
                /channels/@me), and it was already in Discord's tree before the
                dashboard was. */}
        </div>
    );
}

const SafeGlanceLayer = ErrorBoundary.wrap(GlanceLayer);
