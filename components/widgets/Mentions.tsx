/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { findByPropsLazy } from "@webpack";
import {
    ChannelStore,
    GuildStore,
    IconUtils,
    MessageStore,
    moment,
    Parser,
    React,
    ReadStateStore,
    Tooltip,
    UserStore,
    useStateFromStores
} from "@webpack/common";

import { openChannelPopup } from "../ChannelPopup";
import { CheckIcon, CloseIcon } from "../icons";
import { ackAllDms, ackChannel, markAllRead, MentionActions, RecentMentionsStore } from "../notifications";
import { WidgetCard } from "../WidgetCard";

const logger = new Logger("AtAGlance");

// Pulls a channel's newest message into MessageStore so the DM preview is the
// real latest, not a stale cached one. Exported so other files needing the
// same module (the popup's reply-jump, for one) reuse this lookup instead of
// declaring their own copy of the same findByPropsLazy call.
export const MessageFetchActions = findByPropsLazy("fetchMessages", "jumpToMessage") as {
    fetchMessages(options: { channelId: string; limit?: number; }): Promise<unknown>;
    jumpToMessage(options: { channelId: string; messageId: string; flash?: boolean; jumpType?: string; }): void;
};

const MAX_SHOWN = 15;

function mentionLocation(message: any): string {
    const channel = ChannelStore.getChannel(message.channel_id);
    if (!channel) return "Unknown channel";
    if (channel.isDM?.()) return "Direct message";
    if (channel.isMultiUserDM?.()) return channel.name || "Group DM";
    const guildName = channel.getGuildId?.() ? GuildStore.getGuild(channel.getGuildId())?.name : undefined;
    return `#${channel.name}${guildName ? ` · ${guildName}` : ""}`;
}

function MentionRow({ message }: { message: any; }) {
    const { author } = message;
    const name = author?.globalName || author?.username || "Unknown";

    return (
        <div
            className="vc-glance-row vc-glance-mention-row"
            role="button"
            tabIndex={0}
            aria-label={`Open mention from ${name}`}
            onClick={() => openChannelPopup(message.channel_id)}
            onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openChannelPopup(message.channel_id);
                }
            }}
        >
            <img
                className="vc-glance-avatar vc-glance-mention-avatar"
                src={author?.getAvatarURL?.(void 0, 40, false)}
                alt=""
                draggable={false}
            />
            <div className="vc-glance-row-text">
                <span className="vc-glance-mention-meta">
                    <span className="vc-glance-mention-author">{name}</span>
                    <span className="vc-glance-mention-location">{mentionLocation(message)}</span>
                    <span className="vc-glance-msg-time">{moment(message.timestamp).fromNow()}</span>
                </span>
                <span className="vc-glance-mention-content">
                    {message.content
                        ? Parser.parse(message.content, true, { channelId: message.channel_id })
                        : <i>(no text content)</i>}
                </span>
            </div>
            <div className="vc-glance-row-actions" onClick={e => e.stopPropagation()}>
                <Tooltip text="Dismiss mention">
                    {props => (
                        <button
                            {...props}
                            className="vc-glance-icon-button"
                            onClick={() => MentionActions.deleteRecentMention(message.id)}
                        >
                            <CloseIcon size={14} />
                        </button>
                    )}
                </Tooltip>
            </div>
        </div>
    );
}

/** Name + avatar for a DM (recipient) or group DM (channel); also used by the hero panel */
export function dmIdentity(channel: any): { name: string; avatarUrl: string | undefined; } {
    if (channel.isMultiUserDM?.()) {
        // getChannelIconURL exists at runtime but isn't in the typings; guard it
        const iconUrl = channel.icon
            ? (IconUtils as any).getChannelIconURL?.({ id: channel.id, icon: channel.icon, size: 40 })
            : undefined;
        return { name: channel.name || "Group DM", avatarUrl: iconUrl };
    }
    const user = UserStore.getUser(channel.getRecipientId?.());
    return {
        name: user?.globalName || user?.username || "Unknown",
        avatarUrl: user?.getAvatarURL(void 0, 40, false)
    };
}

function DmRow({ channel }: { channel: any; }) {
    const mentionCount = useStateFromStores([ReadStateStore], () => ReadStateStore.getMentionCount(channel.id), [channel.id]);
    const { name, avatarUrl } = dmIdentity(channel);

    // Preview the REAL newest message. ReadStateStore.lastMessageId is the
    // authoritative latest id (kept current for unread tracking) - channel
    // .lastMessageId lags for channels you're not viewing, which is what made
    // stale old messages show. Subscribe to MessageStore so the row fills in
    // once the fetch below lands; until then, honest "New message".
    const lastMessage = useStateFromStores([MessageStore, ReadStateStore], () => {
        const latestId = ReadStateStore.lastMessageId(channel.id);
        return latestId ? MessageStore.getMessage(channel.id, latestId) : null;
    }, [channel.id]);
    const preview = lastMessage?.content
        || (lastMessage?.attachments?.length ? "📎 Attachment" : "New message");

    return (
        <div
            className="vc-glance-row vc-glance-mention-row"
            role="button"
            tabIndex={0}
            aria-label={`Open DM with ${name}`}
            onClick={() => openChannelPopup(channel.id)}
            onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openChannelPopup(channel.id);
                }
            }}
        >
            {avatarUrl
                ? <img className="vc-glance-avatar vc-glance-mention-avatar" src={avatarUrl} alt="" draggable={false} />
                : <div className="vc-glance-avatar vc-glance-mention-avatar vc-glance-avatar-placeholder" />
            }
            <div className="vc-glance-row-text">
                <span className="vc-glance-mention-meta">
                    <span className="vc-glance-mention-author">{name}</span>
                    {lastMessage && <span className="vc-glance-msg-time">{moment(lastMessage.timestamp).fromNow()}</span>}
                </span>
                <span className="vc-glance-mention-content">{preview}</span>
            </div>
            <div className="vc-glance-row-actions" onClick={e => e.stopPropagation()}>
                {mentionCount > 0 && (
                    <span className="vc-glance-badge">{mentionCount > 99 ? "99+" : mentionCount}</span>
                )}
                <Tooltip text="Mark as read">
                    {props => (
                        <button {...props} className="vc-glance-icon-button" onClick={() => ackChannel(channel.id)}>
                            <CheckIcon size={15} />
                        </button>
                    )}
                </Tooltip>
            </div>
        </div>
    );
}

type InboxTab = "mentions" | "dms";

/**
 * Command-centre inbox: two tabs over the same card - Mentions (Discord's recent
 * mentions inbox) and Direct Messages (every unread DM/group DM, pinned or not).
 * The header's "Mark all read" acts on whichever tab you're viewing.
 */
export function MentionsWidget() {
    const [tab, setTab] = React.useState<InboxTab>("mentions");

    const mentions = useStateFromStores([RecentMentionsStore], () => RecentMentionsStore.getMentions(), []);
    const unreadDms = useStateFromStores(
        [ReadStateStore, ChannelStore],
        () => ChannelStore.getSortedPrivateChannels().filter(channel => ReadStateStore.hasUnread(channel.id)),
        []
    );

    // First open: pull the mentions inbox through Discord's own fetch
    React.useEffect(() => {
        if (!RecentMentionsStore.hasLoadedEver && !RecentMentionsStore.loading) {
            try {
                MentionActions.fetchRecentMentions({ limit: 25 });
            } catch (e) {
                logger.error("Failed to fetch recent mentions", e);
            }
        }
    }, []);

    const mentionCount = mentions?.length ?? 0;
    const dmCount = unreadDms.length;
    const shownMentions = mentions?.slice(0, MAX_SHOWN) ?? null;
    const shownDms = unreadDms.slice(0, MAX_SHOWN);

    // While the DMs tab is up, pull the newest message for any shown DM whose
    // latest isn't cached, so previews are the actual last message. Once each,
    // bounded to what's on screen (≤15) - the rows re-render when it lands.
    const fetchedRef = React.useRef<Set<string>>(new Set());
    React.useEffect(() => {
        if (tab !== "dms") return;
        for (const channel of shownDms) {
            if (fetchedRef.current.has(channel.id)) continue;
            const latestId = ReadStateStore.lastMessageId(channel.id);
            if (latestId && !MessageStore.getMessage(channel.id, latestId)) {
                fetchedRef.current.add(channel.id);
                try {
                    MessageFetchActions.fetchMessages({ channelId: channel.id, limit: 1 });
                } catch (e) {
                    logger.error("Failed to fetch DM preview", e);
                }
            }
        }
    }, [tab, shownDms.map(c => c.id).join(",")]);

    const canMarkAll = tab === "mentions" ? mentionCount > 0 : dmCount > 0;
    const markAll = () => {
        if (tab === "mentions") markAllRead(mentions ?? []);
        else ackAllDms(unreadDms);
    };

    return (
        <WidgetCard
            id="mentions"
            actions={
                canMarkAll
                    ? <button className="vc-glance-link-button" onClick={markAll}>Mark all as read</button>
                    : undefined
            }
        >
            <div className="vc-glance-inbox-tabs" role="tablist">
                <button
                    role="tab"
                    aria-selected={tab === "mentions"}
                    className={"vc-glance-inbox-tab" + (tab === "mentions" ? " vc-glance-inbox-tab-active" : "")}
                    onClick={() => setTab("mentions")}
                >
                    Mentions
                    {mentionCount > 0 && <span className="vc-glance-inbox-tab-count">{mentionCount > 99 ? "99+" : mentionCount}</span>}
                </button>
                <button
                    role="tab"
                    aria-selected={tab === "dms"}
                    className={"vc-glance-inbox-tab" + (tab === "dms" ? " vc-glance-inbox-tab-active" : "")}
                    onClick={() => setTab("dms")}
                >
                    Direct Messages
                    {dmCount > 0 && <span className="vc-glance-inbox-tab-count">{dmCount > 99 ? "99+" : dmCount}</span>}
                </button>
            </div>

            {tab === "mentions"
                ? shownMentions == null
                    ? <div className="vc-glance-hint">Loading your inbox…</div>
                    : shownMentions.length === 0
                        ? <div className="vc-glance-empty">All caught up - no recent mentions. 🎉</div>
                        : (
                            <div className="vc-glance-row-list">
                                {shownMentions.map((message: any) => (
                                    <MentionRow key={message.id} message={message} />
                                ))}
                                {mentions!.length > MAX_SHOWN && (
                                    <span className="vc-glance-hint">
                                        +{mentions!.length - MAX_SHOWN} older mentions in Discord's inbox
                                    </span>
                                )}
                            </div>
                        )
                : shownDms.length === 0
                    ? <div className="vc-glance-empty">No unread direct messages. 📭</div>
                    : (
                        <div className="vc-glance-row-list">
                            {shownDms.map(channel => (
                                <DmRow key={channel.id} channel={channel} />
                            ))}
                            {dmCount > MAX_SHOWN && (
                                <span className="vc-glance-hint">+{dmCount - MAX_SHOWN} more unread</span>
                            )}
                        </div>
                    )
            }
        </WidgetCard>
    );
}
