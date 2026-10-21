/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { ContextMenuApi, Menu, React, Tooltip } from "@webpack/common";

import {
    getEmptyBehaviour,
    isWidgetCollapsed,
    moveWidget,
    moveWidgetColumn,
    setEmptyBehaviour,
    toggleWidgetCollapsed,
    toggleWidgetHidden,
    useGlanceConfig,
    WIDGET_META,
    WidgetIconKey,
    WidgetId
} from "../data";
import { useEditMode, useWidgetDrag } from "./GlanceLayer";
import {
    BellIcon,
    BookmarkIcon,
    CalendarIcon,
    ChatIcon,
    ChevronIcon,
    DashboardIcon,
    DotsIcon,
    GearIcon,
    GripIcon,
    HashIcon,
    MusicIcon,
    NoteIcon,
    PeopleIcon,
    PulseIcon,
    WeatherIcon
} from "./icons";

// widgetRegistry.ts keeps `icon` a plain string (that file is import-free, loaded
// under node by tools/verify-migration.js) - this is where the key becomes a component.
const WIDGET_ICONS: Record<WidgetIconKey, React.ComponentType<{ size?: number; className?: string; }>> = {
    people: PeopleIcon,
    hash: HashIcon,
    chat: ChatIcon,
    bookmark: BookmarkIcon,
    calendar: CalendarIcon,
    gear: GearIcon,
    bell: BellIcon,
    weather: WeatherIcon,
    music: MusicIcon,
    note: NoteIcon,
    pulse: PulseIcon,
    dashboard: DashboardIcon
};

interface WidgetCardProps {
    id: WidgetId;
    /** Overrides the registry label in the header - e.g. a Now Playing widget naming its live platform */
    label?: string;
    /** Optional element(s) rendered at the right edge of the header */
    actions?: React.ReactNode;
    /** Short header line the widget supplies, visible collapsed AND expanded */
    summary?: React.ReactNode;
    /** Quiet dot for "something is in here", for widgets that do not want a count */
    indicator?: boolean;
    /** When > 0: red badge on the header + a subtle shine sweep, even collapsed */
    attention?: number;
    /** Does the widget currently have nothing to show - drives "Collapse when empty" */
    empty?: boolean;
    children: React.ReactNode;
}

/**
 * A real component, not an inline callback, so `useGlanceConfig` can subscribe
 * it to the store. The menu body used to be an arrow function passed straight
 * to openContextMenu: it rendered once, read the empty behaviour, and never
 * heard about the change it had just made. The setting saved fine, but the
 * radio tick stayed put, which reads as a dead control.
 */
function CardMenu({ id }: { id: WidgetId; }) {
    useGlanceConfig();
    const behaviour = getEmptyBehaviour(id);

    return (
        <Menu.Menu
            navId="vc-glance-widget-menu"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Widget options"
        >
            <Menu.MenuItem id="vc-glance-widget-up" label="Move up" action={() => moveWidget(id, -1)} />
            <Menu.MenuItem id="vc-glance-widget-down" label="Move down" action={() => moveWidget(id, 1)} />
            <Menu.MenuItem id="vc-glance-widget-col-prev" label="Move to previous column" action={() => moveWidgetColumn(id, -1)} />
            <Menu.MenuItem id="vc-glance-widget-col-next" label="Move to next column" action={() => moveWidgetColumn(id, 1)} />
            <Menu.MenuSeparator />
            <Menu.MenuItem id="vc-glance-widget-empty" label="When empty">
                <Menu.MenuRadioItem
                    id="vc-glance-empty-show"
                    group={`vc-glance-empty-${id}`}
                    label="Keep visible"
                    checked={behaviour === "show"}
                    action={() => setEmptyBehaviour(id, "show")}
                />
                <Menu.MenuRadioItem
                    id="vc-glance-empty-collapse"
                    group={`vc-glance-empty-${id}`}
                    label="Collapse when empty"
                    checked={behaviour === "collapse"}
                    action={() => setEmptyBehaviour(id, "collapse")}
                />
                <Menu.MenuRadioItem
                    id="vc-glance-empty-hide"
                    group={`vc-glance-empty-${id}`}
                    label="Hide when empty"
                    checked={behaviour === "hide"}
                    action={() => setEmptyBehaviour(id, "hide")}
                />
            </Menu.MenuItem>
            <Menu.MenuItem
                id="vc-glance-widget-hide"
                label="Hide widget"
                color="danger"
                action={() => toggleWidgetHidden(id)}
            />
        </Menu.Menu>
    );
}

function openCardMenu(e: React.MouseEvent, id: WidgetId) {
    e.preventDefault();
    e.stopPropagation();
    ContextMenuApi.openContextMenu(e, () => <CardMenu id={id} />);
}

/**
 * Parts of the header that own their own click. Anything else in the header
 * (title, summary, badge, icon, the empty space between them) toggles the card.
 * The actions slot is listed as a whole, so a gap between two of its buttons does
 * nothing rather than collapsing the card under a near-miss.
 */
const HEADER_OWN_CLICK =
    'button, a, input, textarea, select, [role="button"], [role="menuitem"], .vc-glance-card-grip, .vc-glance-card-actions';

/** Shared shell for all widgets: card surface, collapsible header, drag handle, error isolation */
export function WidgetCard({ id, label, actions, summary, indicator = false, attention = 0, empty = false, children }: WidgetCardProps) {
    // Subscribing here keeps collapse state live without prop-drilling
    useGlanceConfig();
    const editMode = useEditMode();
    const drag = useWidgetDrag();
    const collapsed = isWidgetCollapsed(id);
    const behaviour = getEmptyBehaviour(id);
    // "Collapse when empty" is a rendering decision, not a stored one - writing
    // it into collapsedWidgets would leave the widget stuck collapsed once
    // content returns, silently overwriting the user's own manual choice.
    const autoCollapsed = Boolean(empty) && behaviour === "collapse";
    // Lets the user peek at an auto-collapsed widget's empty state without
    // touching collapsedWidgets. Session-only: it resets below whenever the
    // widget stops being empty, so a stale click from long ago can't keep a
    // widget open past the point it has something to hide again.
    const [peeking, setPeeking] = React.useState(false);
    // Keyed on `empty` itself, not autoCollapsed: this fires both when the
    // widget fills back up AND when it goes empty again, so a peek from
    // ten minutes ago can never carry over into the next empty spell.
    React.useEffect(() => {
        setPeeking(false);
    }, [empty]);
    const showCollapsed = collapsed || (autoCollapsed && !peeking);
    const meta = WIDGET_META.find(w => w.id === id);
    const resolvedLabel = label ?? meta?.label ?? id;
    const Icon = meta ? WIDGET_ICONS[meta.icon] : undefined;

    // The chevron and the rest of the header share this: when the only reason the
    // card looks collapsed is the empty-behaviour default (not the user's own
    // stored choice), the click is about peeking at that state this session, not
    // about rewriting the stored preference.
    const handleToggle = () => {
        if (autoCollapsed && !collapsed) setPeeking(p => !p);
        else toggleWidgetCollapsed(id);
    };

    // The whole header is the target, not just the title text. A click that began
    // on a control inside it (the chevron, the options button, an action, the drag
    // grip) belongs to that control, so it is left alone; the chevron toggles
    // through its own onClick and must not also toggle here. The match is bounded
    // to this header so a card nested in some outer button or link cannot swallow
    // the click. Keyboard access stays on the chevron: the header itself has no
    // tabIndex or role, so it adds no second tab stop.
    const handleHeaderClick = (e: React.MouseEvent<HTMLElement>) => {
        const owner = (e.target as Element).closest(HEADER_OWN_CLICK);
        if (owner && e.currentTarget.contains(owner)) return;
        handleToggle();
    };

    return (
        <section
            className={
                "vc-glance-card"
                + (showCollapsed ? " vc-glance-card-collapsed" : "")
                + (attention > 0 ? " vc-glance-card-attention" : "")
            }
            onContextMenu={e => openCardMenu(e, id)}
        >
            <header className="vc-glance-card-header" onClick={handleHeaderClick}>
                <button
                    className="vc-glance-card-collapse"
                    aria-label={showCollapsed ? `Expand ${resolvedLabel}` : `Collapse ${resolvedLabel}`}
                    aria-expanded={!showCollapsed}
                    onClick={handleToggle}
                >
                    <ChevronIcon className="vc-glance-chevron" size={16} />
                </button>
                {editMode && drag && (
                    <Tooltip text="Drag to rearrange">
                        {props => (
                            <div
                                {...props}
                                className="vc-glance-card-grip"
                                onPointerDown={e => drag.beginDrag(id, e)}
                            >
                                <GripIcon size={14} />
                            </div>
                        )}
                    </Tooltip>
                )}
                {Icon && <Icon className="vc-glance-card-icon" size={16} />}
                <div className="vc-glance-card-heading">
                    <h2 className="vc-glance-card-title">
                        {resolvedLabel}
                    </h2>
                    {/* Renders collapsed AND expanded - a collapsed card that says nothing
                        is dead space, which is the problem this slot exists to fix */}
                    {summary && <span className="vc-glance-card-summary">{summary}</span>}
                </div>
                {attention > 0
                    ? <span className="vc-glance-badge">{attention > 99 ? "99+" : attention}</span>
                    // A count wins when there is one; showing the dot too would just be noise
                    : indicator && <span className="vc-glance-card-indicator vc-glance-unread-dot" aria-label="Unread activity" />
                }
                {actions && !showCollapsed && <div className="vc-glance-card-actions">{actions}</div>}
                <Tooltip text="Widget options">
                    {props => (
                        <button
                            {...props}
                            className="vc-glance-icon-button"
                            onClick={e => openCardMenu(e, id)}
                        >
                            <DotsIcon size={16} />
                        </button>
                    )}
                </Tooltip>
            </header>
            {!showCollapsed && (
                <div className="vc-glance-card-body">
                    <ErrorBoundary>
                        {children}
                    </ErrorBoundary>
                </div>
            )}
        </section>
    );
}
