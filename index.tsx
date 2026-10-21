/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { Channel, User } from "@vencord/discord-types";
import { ChannelStore, Menu, SelectedChannelStore, UserStore } from "@webpack/common";

import { closeGlanceIfOpen, GlanceHost, openGlance, openGlanceWhenReady, setGlanceEnabled } from "./components/GlanceLayer";
import { GlanceTab } from "./components/GlanceTab";
import { nativeSavesAvailable } from "./components/nativeSaves";
import { glanceToast } from "./components/toast";
import { disposeQuickTools } from "./components/widgets/QuickTools";
import {
    addBookmark,
    canWriteConfig,
    isBookmarked,
    isChannelWatched,
    isUserPinned,
    loadConfig,
    removeBookmark,
    resetConfig,
    togglePinnedUser,
    toggleWatchedChannel
} from "./data";
import { patches } from "./discordChecks";
import { comboKey, comboParts, matchesKeyboardCombo, modifiersMatch, MOUSE_KEY_NAMES } from "./hotkeys";
import { startReminderScheduler, stopReminderScheduler } from "./reminderScheduler";
import { settings } from "./settings";

// Channel types that make sense on the watchlist. Explicit allowlist - anything
// else (categories, directories, unknown future types) is not offered.
const WATCHABLE_CHANNEL_TYPES = new Set([
    0, // GUILD_TEXT
    2, // GUILD_VOICE
    3, // GROUP_DM
    5, // GUILD_ANNOUNCEMENT
    13, // STAGE_VOICE
    15 // GUILD_FORUM
]);

// If the sidebar patch ever breaks on a Discord update, the tab disappears but
// nothing crashes and these context menu entries keep working.
const SafeGlanceTab = ErrorBoundary.wrap(GlanceTab, { noop: true });

// Same principle: if the dashboard host ever throws, Discord's layout around it carries on.
const SafeGlanceHost = ErrorBoundary.wrap(GlanceHost, { noop: true });

function makeWatchMenuItem(channel: Channel) {
    return (
        <Menu.MenuItem
            id="vc-glance-watch-channel"
            label={isChannelWatched(channel.id) ? "Unwatch on At a glance" : "Watch on At a glance"}
            action={() => toggleWatchedChannel(channel.id)}
        />
    );
}

const UserContext: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user?.id || user.id === UserStore.getCurrentUser()?.id) return;

    const group = findGroupChildrenByChildId("close-dm", children)
        ?? findGroupChildrenByChildId("block", children)
        ?? children;

    group.push(
        <Menu.MenuItem
            id="vc-glance-pin-user"
            label={isUserPinned(user.id) ? "Unpin from At a glance" : "Pin to At a glance"}
            action={() => togglePinnedUser(user.id)}
        />
    );
};

const ChannelContext: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (!channel || !WATCHABLE_CHANNEL_TYPES.has(channel.type)) return;

    const group = findGroupChildrenByChildId("mute-channel", children) ?? children;
    group.push(makeWatchMenuItem(channel));
};

const GroupDmContext: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (!channel || !WATCHABLE_CHANNEL_TYPES.has(channel.type)) return;

    const group = findGroupChildrenByChildId("leave-channel", children) ?? children;
    group.push(makeWatchMenuItem(channel));
};

/** Where a saved message lives, for the bookmark row's location line */
function describeMessageLocation(channel: Channel | undefined): string {
    if (!channel) return "Unknown";
    if (channel.isDM?.()) return "Direct message";
    if (channel.isMultiUserDM?.()) return channel.name || "Group DM";
    return `#${channel.name}`;
}

const MessageContext: NavContextMenuPatchCallback = (children, { message, channel }: { message?: any; channel?: Channel; }) => {
    if (!message?.id || !message?.channel_id) return;

    // Discord's own Bookmark Message and Create Reminder do this job, and sync
    // across devices. Checked here, when the menu opens, never at module scope.
    // Without them this item is the fallback.
    if (nativeSavesAvailable()) return;

    const saved = isBookmarked(message.id);
    children.push(
        <Menu.MenuItem
            id="vc-glance-bookmark"
            label={saved ? "Remove from At a glance" : "Save to At a glance"}
            action={() => {
                if (saved) {
                    removeBookmark(message.id);
                    return;
                }
                // Plain-text snapshot only - renders instantly forever, no refetch
                addBookmark({
                    channelId: message.channel_id,
                    messageId: message.id,
                    authorId: message.author?.id,
                    guildId: channel?.getGuildId?.() ?? undefined,
                    authorName: message.author?.globalName || message.author?.username || "Unknown",
                    snippet: String(message.content ?? "").slice(0, 160)
                        || (message.attachments?.length ? "(attachment)" : "(no text)"),
                    location: describeMessageLocation(channel)
                });
            }}
        />
    );
};

/* ========== quick-pin hotkey ========== */

/**
 * One hotkey, context-aware: a DM pins/unpins that friend; a guild/group
 * channel is added to/removed from the watchlist.
 */
function quickPinChannel(channelId: string | null | undefined) {
    const channel = channelId ? ChannelStore.getChannel(channelId) : null;
    if (!channel) {
        glanceToast("Nothing here to pin to At a glance.", "failure");
        return;
    }
    if (!canWriteConfig()) return;

    if (channel.isDM()) {
        const userId = channel.getRecipientId();
        if (!userId) return;
        const user = UserStore.getUser(userId);
        const name = user?.globalName || user?.username || "this user";
        const wasPinned = isUserPinned(userId);
        togglePinnedUser(userId);
        glanceToast(
            wasPinned ? `Unpinned ${name} from At a glance.` : `Pinned ${name} to At a glance.`,
            "success"
        );
        return;
    }

    if (WATCHABLE_CHANNEL_TYPES.has(channel.type)) {
        const label = channel.name || "channel";
        const wasWatched = isChannelWatched(channel.id);
        toggleWatchedChannel(channel.id);
        glanceToast(
            wasWatched ? `Removed #${label} from At a glance.` : `Watching #${label} on At a glance.`,
            "success"
        );
        return;
    }

    glanceToast("This channel type can't be pinned.", "failure");
}

function onHotkeyKeydown(e: KeyboardEvent) {
    const combo = settings.store.pinHotkey?.trim();
    if (!combo || !matchesKeyboardCombo(e, combo)) return;

    // Bare-key combos stay out of the way while typing; with ctrl/alt/meta
    // held the hotkey works everywhere, including the message box
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        const target = e.target as HTMLElement | null;
        if (target?.closest?.("input, textarea, [contenteditable=\"true\"]")) return;
    }

    e.preventDefault();
    quickPinChannel(SelectedChannelStore.getChannelId());
}

/** Channel id from whatever sidebar/channel link the mouse is over, if any */
function channelIdFromEvent(e: MouseEvent): string | null {
    const link = (e.target as HTMLElement | null)
        ?.closest?.("a[href*='/channels/']") as HTMLAnchorElement | null;
    const match = link?.getAttribute("href")?.match(/\/channels\/(?:@me|\d+)\/(\d{17,21})/);
    return match?.[1] ?? null;
}

/**
 * Mouse binding (default ctrl+middleclick). Runs in the capture phase on
 * window - before Discord's own handlers and the browser default - so the
 * combo never triggers Discord's middle-click behaviour (opening the DM/
 * channel in a new window, autoscroll, etc.). Plain middle-click without the
 * combo's modifiers is left completely untouched.
 */
function onMouseHotkey(e: MouseEvent) {
    if (e.button !== 1) return;

    const combo = settings.store.pinHotkey?.trim();
    if (!combo) return;

    const key = comboKey(combo);
    if (!key || !MOUSE_KEY_NAMES.has(key) || !modifiersMatch(e, comboParts(combo))) return;

    e.preventDefault();
    e.stopPropagation();

    // Suppress every event in the middle-click sequence, but act only once
    if (e.type === "mousedown") {
        quickPinChannel(channelIdFromEvent(e) ?? SelectedChannelStore.getChannelId());
    }
}

const MOUSE_HOTKEY_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "auxclick"] as const;

let startupOpened = false;

export default definePlugin({
    name: "AtAGlance",
    description: "A customizable 'At a glance' tab above the Friends button: pinned friends with quick actions, watched voice/text channels, tools and integrations - all in one Discord-native view.",
    // Public handle, not a legal name; the repo (github.com/KayTwoOne/at-a-glance)
    // is linked from the README. id 0n = no Discord-profile link (none supplied).
    authors: [{ name: "dotkay", id: 0n }],
    tags: ["Utility", "Friends", "Organisation", "Chat"],

    settings,

    contextMenus: {
        "user-context": UserContext,
        "channel-context": ChannelContext,
        "gdm-context": GroupDmContext,
        "message": MessageContext
    },

    patches,

    flux: {
        // Config is stored per account, so (re)load it whenever a connection
        // opens - covers startup, reconnects and account switching
        CONNECTION_OPEN() {
            void loadConfig();

            if (settings.store.openOnStartup && !startupOpened) {
                startupOpened = true;
                // Give the base UI a moment to settle before taking the stage.
                // openGlanceWhenReady, not openGlance: see the note on it in GlanceLayer.
                setTimeout(openGlanceWhenReady, 800);
            }
        },
        LOGOUT() {
            closeGlanceIfOpen();
            void resetConfig();
        }
    },

    start() {
        setGlanceEnabled(true);
        // In case the plugin is enabled while Discord is already connected
        void loadConfig();
        startReminderScheduler();
        window.addEventListener("keydown", onHotkeyKeydown);
        for (const type of MOUSE_HOTKEY_EVENTS) {
            window.addEventListener(type, onMouseHotkey as EventListener, true);
        }
    },

    stop() {
        stopReminderScheduler();
        // Cancels any pending load retry and saves pending edits
        void resetConfig();
        disposeQuickTools();
        window.removeEventListener("keydown", onHotkeyKeydown);
        for (const type of MOUSE_HOTKEY_EVENTS) {
            window.removeEventListener(type, onMouseHotkey as EventListener, true);
        }
        // Before closing: the patched-in tab and host outlive stop(), so this
        // is what stops them opening a dashboard whose store has been reset
        setGlanceEnabled(false);
        closeGlanceIfOpen();
    },

    renderGlanceTab() {
        return <SafeGlanceTab key="vc-glance-tab" />;
    },

    renderGlanceHost() {
        return <SafeGlanceHost key="vc-glance-host" />;
    },

    // Handy for keybind tooling and the console; not used internally
    openGlance
});
