/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import { findCssClassesLazy } from "@webpack";
import { ChannelStore, React, ReactDOM, ReadStateStore, useStateFromStores } from "@webpack/common";

import { triggeredReminderCount, useGlanceConfig } from "../data";
import { finders } from "../discordChecks";
import { attentionTotal } from "../reminderView";
import { settings } from "../settings";
import { ChannelPopupHost } from "./ChannelPopup";
import { openGlance, useGlanceEnabled, useGlanceOpen } from "./GlanceLayer";
import { DashboardIcon } from "./icons";
import { nativeSavesAvailable, useNativeReminders } from "./nativeSaves";

// Discord's own sidebar row CSS module: `channel` provides the li metrics
// (margin, max-width). The inner layout is deliberately NOT reused - the
// native `link` class uses justify-content:space-between, which breaks a
// simple icon+label row - so the pill is fully styled by the plugin using
// Discord's current design tokens instead.
const rowClasses = findCssClassesLazy(...finders.sidebarRowClasses.names);

function activate(e: React.KeyboardEvent | React.MouseEvent) {
    e.preventDefault();
    openGlance();
}

interface TabSignalProps {
    mentions: number;
    /** The plugin's own reminders that have fired */
    remindersDue: number;
    /** Discord's reminders that are overdue */
    overdue: number;
    hasUnread: boolean;
}

/** The tab's red count, or its white dot when there is only something unread */
function TabSignal({ mentions, remindersDue, overdue, hasUnread }: TabSignalProps) {
    const total = attentionTotal(mentions, remindersDue, overdue);
    if (total > 0) return <span className="vc-glance-badge vc-glance-tab-badge">{total > 99 ? "99+" : total}</span>;
    return hasUnread ? <span className="vc-glance-unread-dot vc-glance-tab-badge" /> : null;
}

/** The same, counting Discord's overdue reminders. Its own component because the hook may only render when Discord's reminders exist. */
function NativeTabSignal(props: Omit<TabSignalProps, "overdue">) {
    const { overdueCount } = useNativeReminders();
    return <TabSignal {...props} overdue={overdueCount} />;
}

/** The sidebar tab rendered above the Friends row */
export function GlanceTab() {
    const { tabLabel } = settings.use(["tabLabel"]);
    const selected = useGlanceOpen();
    const enabled = useGlanceEnabled();
    const { pinnedUsers, watchedChannels, reminders } = useGlanceConfig();

    // Fired reminders count toward the tab badge even with the view closed;
    // a slow tick keeps the count honest while timers cross their due time
    const [, forceTick] = React.useReducer(x => x + 1, 0);
    const hasPendingTimers = reminders.some(r => r.dueAt !== null);
    React.useEffect(() => {
        if (!hasPendingTimers) return;
        const id = setInterval(forceTick, 30_000);
        return () => clearInterval(id);
    }, [hasPendingTimers]);
    const remindersDue = triggeredReminderCount();

    // Aggregate across everything pinned: mention count as a red badge,
    // plain unreads as a white dot - mirroring native sidebar signals
    const { mentions, hasUnread } = useStateFromStores([ReadStateStore, ChannelStore], () => {
        let mentions = 0;
        let hasUnread = false;

        for (const channelId of watchedChannels) {
            mentions += ReadStateStore.getMentionCount(channelId);
            if (!hasUnread && !ChannelStore.getChannel(channelId)?.isVocal() && ReadStateStore.hasUnread(channelId)) {
                hasUnread = true;
            }
        }
        for (const userId of pinnedUsers) {
            const dmChannelId = ChannelStore.getDMFromUserId(userId);
            if (dmChannelId) mentions += ReadStateStore.getMentionCount(dmChannelId);
        }
        return { mentions, hasUnread };
    }, [pinnedUsers.join(","), watchedChannels.join(",")]);

    // Discord keeps rendering this patched-in tab after the plugin stops, until
    // it restarts. Nothing here would work then, so it renders nothing.
    if (!enabled) return null;

    return (
        <li className={classes("vc-glance-tab", rowClasses.channel)}>
            <div
                className={"vc-glance-tab-pill" + (selected ? " vc-glance-tab-selected" : "")}
                role="button"
                tabIndex={0}
                aria-label={tabLabel || "At a glance"}
                onClick={activate}
                onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") activate(e);
                }}
            >
                <DashboardIcon className="vc-glance-tab-icon" size={20} />
                <div className="vc-glance-tab-label">{tabLabel || "At a glance"}</div>
                {nativeSavesAvailable()
                    ? <NativeTabSignal mentions={mentions} remindersDue={remindersDue} hasUnread={hasUnread} />
                    : <TabSignal mentions={mentions} remindersDue={remindersDue} overdue={0} hasUnread={hasUnread} />
                }
            </div>

            {/* The channel popup is hosted HERE, not in GlanceLayer. GlanceTab
                is always mounted while the dashboard is open (openGlance lands
                on /channels/@me), and it was already in Discord's React tree
                before the dashboard was. Portals keep React context, so
                Discord's expression picker and autocomplete get the app-level
                providers they need (they render nothing without them, which is
                exactly what broke when the popup moved off Discord's modal
                system). The portal to body keeps the fixed backdrop's
                positioning independent of the sidebar's DOM. */}
            <ErrorBoundary noop>
                {ReactDOM.createPortal(<ChannelPopupHost />, document.body)}
            </ErrorBoundary>
        </li>
    );
}
