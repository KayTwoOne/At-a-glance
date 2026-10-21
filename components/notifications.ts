/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, ReadStateStore, useStateFromStores } from "@webpack/common";

import { finders } from "../discordChecks";

const logger = new Logger("AtAGlance");

// Discord's own Inbox internals: the store updates itself in realtime as new
// mentions arrive, the actions hit the same endpoints the native Inbox uses
export const RecentMentionsStore = findStoreLazy(finders.recentMentionsStore.name) as {
    getMentions(): any[] | null;
    hasLoadedEver: boolean;
    loading: boolean;
};

export const MentionActions = findByPropsLazy(...finders.mentionActions.props) as {
    fetchRecentMentions(options: { limit?: number; guildId?: string | null; roles?: boolean; everyone?: boolean; }): Promise<unknown>;
    deleteRecentMention(messageId: string): void;
    clearMentions(): void;
};

/**
 * Clears the inbox for real: acks each channel's read state AND deletes each
 * recent mention server-side (`deleteRecentMention`, the same call the per-row
 * ✕ uses). `clearMentions()` alone only clears locally, so Discord re-populates
 * the list on the next fetch - deleting each mention persists.
 */
export function markAllRead(mentions: any[]) {
    try {
        const channels = [...new Set(mentions.map(m => m.channel_id as string))]
            .map(channelId => ({
                channelId,
                messageId: ReadStateStore.lastMessageId(channelId),
                readStateType: 0
            }))
            .filter(entry => entry.messageId);

        if (channels.length > 0) {
            FluxDispatcher.dispatch({ type: "BULK_ACK", context: "APP", channels });
        }

        // Persistently remove each mention from Discord's inbox
        for (const mention of mentions) {
            if (typeof mention?.id === "string") MentionActions.deleteRecentMention(mention.id);
        }
    } catch (e) {
        logger.error("Failed to mark mentions read", e);
    }
}

/** Marks a channel read the way Discord's own UI does */
export function ackChannel(channelId: string) {
    const messageId = ReadStateStore.lastMessageId(channelId);
    if (!messageId) return;
    FluxDispatcher.dispatch({
        type: "BULK_ACK",
        context: "APP",
        channels: [{ channelId, messageId, readStateType: 0 }]
    });
}

export function ackAllDms(channels: any[]) {
    try {
        const acks = channels
            .map(channel => ({ channelId: channel.id, messageId: ReadStateStore.lastMessageId(channel.id), readStateType: 0 }))
            .filter(entry => entry.messageId);
        if (acks.length > 0) {
            FluxDispatcher.dispatch({ type: "BULK_ACK", context: "APP", channels: acks });
        }
    } catch (e) {
        logger.error("Failed to mark DMs read", e);
    }
}

/** Same persistence as markAllRead's per-mention delete, just for a single row */
export function dismissMention(messageId: string) {
    try {
        MentionActions.deleteRecentMention(messageId);
    } catch (e) {
        logger.error("Failed to dismiss mention", e);
    }
}

/**
 * Everything the hero banner and the Inbox widget both need to count: recent
 * mentions plus every unread DM/group DM. One hook so the two can never
 * disagree, and so dismissal keeps working with the Inbox widget hidden.
 */
export function useNotifications() {
    const mentions = useStateFromStores([RecentMentionsStore], () => RecentMentionsStore.getMentions() ?? [], []);
    const unreadDms = useStateFromStores(
        [ReadStateStore, ChannelStore],
        () => ChannelStore.getSortedPrivateChannels().filter(channel => ReadStateStore.hasUnread(channel.id)),
        []
    );
    return { mentions, unreadDms, total: mentions.length + unreadDms.length };
}
