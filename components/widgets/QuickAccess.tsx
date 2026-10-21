/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import {
    ChannelRouter,
    ChannelStore,
    ContextMenuApi,
    GuildMemberStore,
    GuildStore,
    IconUtils,
    Menu,
    PermissionsBits,
    PermissionStore,
    React,
    ReadStateStore,
    SelectedChannelStore,
    Tooltip,
    UserStore,
    useStateFromStores,
    VoiceStateStore
} from "@webpack/common";

import { isGuildCollapsed, moveWatchedChannel, setWatchedChannelsOrder, toggleGuildCollapsed, toggleWatchedChannel, useGlanceConfig } from "../../data";
import { finders } from "../../discordChecks";
import { settings } from "../../settings";
import { guildAcronym } from "../../util";
import { openChannelPopup } from "../ChannelPopup";
import { closeGlance } from "../GlanceLayer";
import { usePoll } from "../hooks";
import { ChatIcon, ChevronIcon, DotsIcon, HashIcon, HeadphonesIcon, MicIcon, SpeakerIcon, VideoIcon } from "../icons";
import { RowDragGhost, RowDropSlot, useRowDrag } from "../rowDrag";
import { glanceToast } from "../toast";
import { WidgetCard } from "../WidgetCard";
import { dmIdentity } from "./Mentions";

const logger = new Logger("AtAGlance");

// The same action Discord runs when you click a voice channel in the sidebar
const VoiceActions = findByPropsLazy(...finders.voiceActions.props) as {
    selectVoiceChannel(channelId: string): void;
};

// Who is talking right now - Discord only receives speaking data for the
// voice channel YOU are connected to, so rings appear only there
const SpeakingStore = findStoreLazy(finders.speakingStore.name) as {
    getSpeakers(): string[];
    addChangeListener(cb: () => void): void;
    removeChangeListener(cb: () => void): void;
};

const MAX_INLINE_AVATARS = 4;

function jumpToChannel(channelId: string) {
    closeGlance();
    try {
        ChannelRouter.transitionToChannel(channelId);
    } catch (e) {
        logger.error("Failed to jump to channel", e);
    }
}

function ChannelMenu({ channelId, isVoice, canJoin, siblingIds, index }: {
    channelId: string; isVoice: boolean; canJoin: boolean; siblingIds: string[]; index: number;
}) {
    // Same shape as the friend menu: go-places first, then ordering, then the
    // item that takes it off the board
    return (
        <Menu.Menu
            navId="vc-glance-channel-menu"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Channel options"
        >
            {isVoice && canJoin && (
                <Menu.MenuItem
                    id="vc-glance-channel-join"
                    label="Join Voice"
                    action={() => {
                        closeGlance();
                        VoiceActions.selectVoiceChannel(channelId);
                    }}
                />
            )}
            {!isVoice && (
                <Menu.MenuItem
                    id="vc-glance-channel-quickchat"
                    label="Quick Chat"
                    action={() => openChannelPopup(channelId)}
                />
            )}
            <Menu.MenuItem id="vc-glance-channel-open" label="Open Channel" action={() => jumpToChannel(channelId)} />
            <Menu.MenuSeparator />
            {index > 0 && <Menu.MenuItem id="vc-glance-channel-up" label="Move up" action={() => moveWatchedChannel(channelId, -1, siblingIds)} />}
            {index < siblingIds.length - 1 && <Menu.MenuItem id="vc-glance-channel-down" label="Move down" action={() => moveWatchedChannel(channelId, 1, siblingIds)} />}
            <Menu.MenuItem
                id="vc-glance-channel-unwatch"
                label="Unwatch Channel"
                action={() => toggleWatchedChannel(channelId)}
            />
        </Menu.Menu>
    );
}

function OccupantRow({ userId, guildId, voiceState, speaking, isNew }: {
    userId: string; guildId: string | undefined; voiceState: any; speaking: boolean; isNew: boolean;
}) {
    const user = useStateFromStores([UserStore], () => UserStore.getUser(userId), [userId]);
    const nick = useStateFromStores(
        [GuildMemberStore],
        () => guildId ? GuildMemberStore.getNick(guildId, userId) : null,
        [guildId, userId]
    );

    if (!user) return null;

    const muted = voiceState?.selfMute || voiceState?.mute;
    const deafened = voiceState?.selfDeaf || voiceState?.deaf;
    const streaming = !!voiceState?.selfStream;
    const camera = !!voiceState?.selfVideo;

    return (
        <div className={"vc-glance-occupant" + (isNew ? " vc-glance-occupant-joined" : "")}>
            <img
                className={"vc-glance-occupant-avatar" + (speaking ? " vc-glance-speaking" : "")}
                src={user.getAvatarURL(void 0, 32, false)}
                alt=""
                draggable={false}
            />
            <span className="vc-glance-occupant-name">{nick || user.globalName || user.username}</span>
            <span className="vc-glance-occupant-flags">
                {streaming && <span className="vc-glance-live-chip">LIVE</span>}
                {camera && <VideoIcon size={12} />}
                {muted && <MicIcon size={12} muted />}
                {deafened && <HeadphonesIcon size={12} deafened />}
            </span>
        </div>
    );
}

/** Real label for a group DM row - `channel.name || "voice"` would otherwise
 *  show the literal word "voice" for an unnamed group. */
function groupDMLabel(channel: any): string {
    if (channel.name) return channel.name;
    const names = (channel.recipients ?? [])
        .map((id: string) => {
            const user = UserStore.getUser(id);
            return user?.globalName || user?.username;
        })
        .filter(Boolean);
    return names.length > 0 ? names.join(", ") : "Group DM";
}

/** Header avatar for the "Group DMs" bucket: the bucket's first watched
 *  channel, via dmIdentity's own icon resolution. A group DM without a custom
 *  icon has nothing there - dmIdentity returns no avatar rather than trying to
 *  reproduce Discord's composite-of-recipients icon - so fall back to the
 *  first recipient's avatar instead of showing nothing at all. */
function dmBucketAvatarUrl(channelId: string | undefined): string | undefined {
    if (!channelId) return undefined;
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return undefined;

    const { avatarUrl } = dmIdentity(channel);
    if (avatarUrl) return avatarUrl;

    const firstRecipientId = channel.recipients?.[0];
    const user = firstRecipientId ? UserStore.getUser(firstRecipientId) : undefined;
    return user?.getAvatarURL(void 0, 40, false);
}

function VoiceChannelRow({ channelId, siblingIds, index, hideGuild }: { channelId: string; siblingIds: string[]; index: number; hideGuild?: boolean; }) {
    const [expanded, setExpanded] = React.useState(false);
    const channel = useStateFromStores([ChannelStore], () => ChannelStore.getChannel(channelId), [channelId]);
    const guild = useStateFromStores(
        [GuildStore],
        () => channel?.getGuildId() ? GuildStore.getGuild(channel.getGuildId()) : null,
        [channel?.getGuildId()]
    );
    const voiceStates = useStateFromStores(
        [VoiceStateStore],
        () => VoiceStateStore.getVoiceStatesForChannel(channelId),
        [channelId]
    );
    // Speaking data only exists for the channel we're connected to
    const connected = useStateFromStores(
        [SelectedChannelStore],
        () => SelectedChannelStore.getVoiceChannelId() === channelId,
        [channelId]
    );
    const speakers = useStateFromStores(
        [SpeakingStore],
        () => connected ? SpeakingStore.getSpeakers?.() ?? [] : [],
        [connected]
    );
    const { emptyVoiceChannelsDimmed } = settings.use(["emptyVoiceChannelsDimmed"]);

    const occupantIds = Object.keys(voiceStates);

    // Track fresh joiners so their avatars get a little entrance pulse
    const prevIdsRef = React.useRef<Set<string>>(new Set(occupantIds));
    const newIds = React.useMemo(
        () => new Set(occupantIds.filter(id => !prevIdsRef.current.has(id))),
        [occupantIds.join(",")]
    );
    React.useEffect(() => {
        prevIdsRef.current = new Set(occupantIds);
    }, [occupantIds.join(",")]);

    // Discord reports group DMs as vocal (they support calls), so they land in
    // the voice bucket. They are also real text channels, so give them both.
    const isGroupDM = channel?.type === 3;

    const clickTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => () => {
        if (clickTimer.current) clearTimeout(clickTimer.current);
    }, []);

    if (!channel) return null;

    const count = occupantIds.length;
    const canJoin = channel.getGuildId() == null || PermissionStore.can(PermissionsBits.CONNECT, channel);
    const shownIds = occupantIds.slice(0, MAX_INLINE_AVATARS);

    const join = () => {
        if (!canJoin) {
            glanceToast("You don't have permission to join that channel.", "failure");
            return;
        }
        closeGlance();
        try {
            VoiceActions.selectVoiceChannel(channelId);
        } catch (e) {
            logger.error("Failed to join voice channel", e);
        }
    };

    // A double click always fires a single click first, so opening the chat
    // popup immediately would pop it open on the way to starting a call.
    // Delay it briefly and let joinNow cancel it if a second click lands.
    const openChat = () => {
        if (clickTimer.current) clearTimeout(clickTimer.current);
        clickTimer.current = setTimeout(() => {
            clickTimer.current = null;
            openChannelPopup(channelId);
        }, 220);
    };

    const joinNow = () => {
        if (clickTimer.current) {
            clearTimeout(clickTimer.current);
            clickTimer.current = null;
        }
        join();
    };

    const openMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        ContextMenuApi.openContextMenu(e, () => (
            <ChannelMenu channelId={channelId} isVoice canJoin={canJoin} siblingIds={siblingIds} index={index} />
        ));
    };

    const rowLabel = isGroupDM ? groupDMLabel(channel) : (channel.name || "voice");
    const tooltipText = isGroupDM
        ? "Click to open chat, double-click to call"
        : (canJoin ? "Double-click to join" : "No permission to join");

    return (
        <div className={"vc-glance-voice" + (count === 0 && emptyVoiceChannelsDimmed ? " vc-glance-row-dimmed" : "")}>
            <Tooltip text={tooltipText}>
                {props => (
                    <div
                        {...props}
                        className={"vc-glance-row vc-glance-voice-row" + (count > 0 ? " vc-glance-row-live" : "")}
                        role="button"
                        tabIndex={0}
                        aria-expanded={expanded}
                        aria-label={`${isGroupDM ? rowLabel : channel.name}, ${count} in voice`}
                        onClick={isGroupDM ? openChat : () => setExpanded(v => !v)}
                        onDoubleClick={isGroupDM ? joinNow : join}
                        onKeyDown={e => {
                            // Keyboard stays on expand for every row: for a group DM
                            // the pointer now owns chat (click) and call (double
                            // click), so this is the only way left to see who is in
                            // the call.
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setExpanded(v => !v);
                            }
                        }}
                        onContextMenu={openMenu}
                    >
                        <ChevronIcon
                            className={"vc-glance-chevron" + (expanded ? " vc-glance-chevron-open" : "")}
                            size={14}
                        />
                        {isGroupDM
                            ? <ChatIcon className="vc-glance-channel-type-icon" size={18} />
                            : <SpeakerIcon className="vc-glance-channel-type-icon" size={18} />
                        }
                        <div className="vc-glance-row-text">
                            <span className="vc-glance-row-title">{rowLabel}</span>
                            {guild && !hideGuild && <span className="vc-glance-row-subtitle">{guild.name}</span>}
                        </div>
                        <div className="vc-glance-row-actions" onClick={e => e.stopPropagation()}>
                            {count > 0 && (
                                <span className="vc-glance-voice-occupancy">
                                    {/* Avatars only while collapsed - expanding already lists everyone
                                        by name below, so showing the same faces here too is redundant. */}
                                    {!expanded && (
                                        <span className="vc-glance-voice-avatars">
                                            {shownIds.map(id => {
                                                const user = UserStore.getUser(id);
                                                if (!user) return null;
                                                const flags = [
                                                    "vc-glance-voice-avatar",
                                                    speakers.includes(id) && "vc-glance-speaking",
                                                    voiceStates[id]?.selfStream && "vc-glance-streaming",
                                                    newIds.has(id) && "vc-glance-occupant-joined"
                                                ].filter(Boolean).join(" ");
                                                return (
                                                    <img
                                                        key={id}
                                                        className={flags}
                                                        src={user.getAvatarURL(void 0, 32, false)}
                                                        alt=""
                                                        draggable={false}
                                                    />
                                                );
                                            })}
                                        </span>
                                    )}
                                    <span className="vc-glance-voice-count">
                                        {count > MAX_INLINE_AVATARS ? `+${count - MAX_INLINE_AVATARS}` : count}
                                    </span>
                                </span>
                            )}
                            {canJoin && !connected && (
                                <Tooltip text="Join voice">
                                    {props => (
                                        <button
                                            {...props}
                                            className="vc-glance-icon-button vc-glance-join-button"
                                            onClick={join}
                                        >
                                            <SpeakerIcon size={16} />
                                        </button>
                                    )}
                                </Tooltip>
                            )}
                            <button className="vc-glance-icon-button" aria-label="Options" onClick={openMenu}>
                                <DotsIcon size={16} />
                            </button>
                        </div>
                    </div>
                )}
            </Tooltip>

            {expanded && (
                <div className="vc-glance-occupant-list">
                    {count === 0
                        ? <span className="vc-glance-hint">Nobody's in here right now.</span>
                        : occupantIds.map(id => (
                            <OccupantRow
                                key={id}
                                userId={id}
                                guildId={channel.getGuildId()}
                                voiceState={voiceStates[id]}
                                speaking={speakers.includes(id)}
                                isNew={newIds.has(id)}
                            />
                        ))
                    }
                </div>
            )}
        </div>
    );
}

function TextChannelRow({ channelId, siblingIds, index, hideGuild }: { channelId: string; siblingIds: string[]; index: number; hideGuild?: boolean; }) {
    const channel = useStateFromStores([ChannelStore], () => ChannelStore.getChannel(channelId), [channelId]);
    const guild = useStateFromStores(
        [GuildStore],
        () => channel?.getGuildId() ? GuildStore.getGuild(channel.getGuildId()) : null,
        [channel?.getGuildId()]
    );
    const hasUnread = useStateFromStores([ReadStateStore], () => ReadStateStore.hasUnread(channelId), [channelId]);
    const mentionCount = useStateFromStores([ReadStateStore], () => ReadStateStore.getMentionCount(channelId), [channelId]);

    const openMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        ContextMenuApi.openContextMenu(e, () => (
            <ChannelMenu channelId={channelId} isVoice={false} canJoin={false} siblingIds={siblingIds} index={index} />
        ));
    };

    if (!channel) {
        return (
            <div className="vc-glance-row vc-glance-row-offline">
                <HashIcon className="vc-glance-channel-type-icon" size={18} />
                <div className="vc-glance-row-text">
                    <span className="vc-glance-row-title">Unavailable channel</span>
                </div>
                <div className="vc-glance-row-actions">
                    <button className="vc-glance-icon-button" aria-label="Options" onClick={openMenu}>
                        <DotsIcon size={16} />
                    </button>
                </div>
            </div>
        );
    }

    const label = channel.name || (channel.isMultiUserDM() ? "Group DM" : "unnamed");
    const guildIconUrl = guild ? IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 64 }) : undefined;

    return (
        <div
            className={"vc-glance-row" + (hasUnread ? " vc-glance-row-unread" : "")}
            role="button"
            tabIndex={0}
            aria-label={`Open ${label} preview`}
            onClick={() => openChannelPopup(channelId)}
            onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openChannelPopup(channelId);
                }
            }}
            onContextMenu={openMenu}
        >
            {!hideGuild && (guildIconUrl
                ? <img className="vc-glance-guild-icon" src={guildIconUrl} alt="" draggable={false} />
                : (
                    <div className="vc-glance-guild-icon vc-glance-guild-icon-fallback">
                        {guild ? guildAcronym(guild.name) : "DM"}
                    </div>
                )
            )}
            <HashIcon className="vc-glance-channel-type-icon" size={18} />
            <div className="vc-glance-row-text">
                <span className="vc-glance-row-title">{label}</span>
                {guild && !hideGuild && <span className="vc-glance-row-subtitle">{guild.name}</span>}
            </div>
            <div className="vc-glance-row-actions" onClick={e => e.stopPropagation()}>
                {mentionCount > 0 && (
                    <span className="vc-glance-badge">{mentionCount > 99 ? "99+" : mentionCount}</span>
                )}
                {hasUnread && mentionCount === 0 && <span className="vc-glance-unread-dot" />}
                <button className="vc-glance-icon-button" aria-label="Options" onClick={openMenu}>
                    <DotsIcon size={16} />
                </button>
            </div>
        </div>
    );
}

const DM_KEY = "dm";

/** One server's watched channels - a collapsible section (text then voice).
 *  The header doubles as the drag handle: click toggles collapse, click-and-
 *  drag past the threshold reorders the whole section. */
function GuildSection({ guildKey, voiceIds, textIds, onHeaderPress, wasDragged }: {
    guildKey: string; voiceIds: string[]; textIds: string[];
    onHeaderPress?: (key: string, e: React.PointerEvent) => void;
    wasDragged?: () => boolean;
}) {
    const guild = useStateFromStores(
        [GuildStore],
        () => guildKey === DM_KEY ? null : GuildStore.getGuild(guildKey),
        [guildKey]
    );
    const collapsed = isGuildCollapsed(guildKey);

    // Roll the section's attention up onto its header, so a collapsed server
    // still shows what's waiting inside instead of making you dig for it
    const { mentions, hasUnread } = useStateFromStores([ReadStateStore], () => {
        let mentions = 0;
        let hasUnread = false;
        for (const id of textIds) {
            mentions += ReadStateStore.getMentionCount(id);
            if (!hasUnread && ReadStateStore.hasUnread(id)) hasUnread = true;
        }
        return { mentions, hasUnread };
    }, [textIds.join(",")]);

    const isDM = guildKey === DM_KEY;
    const name = isDM ? "Group DMs" : (guild?.name ?? "Unknown server");
    const iconUrl = guild ? IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 64 }) : undefined;
    const dmAvatarUrl = useStateFromStores(
        [ChannelStore, UserStore],
        () => isDM ? dmBucketAvatarUrl(voiceIds[0]) : undefined,
        [isDM, voiceIds[0]]
    );
    const headerIconUrl = iconUrl ?? dmAvatarUrl;
    const total = voiceIds.length + textIds.length;

    const toggle = () => {
        // A drag that just ended must not read as a collapse click
        if (wasDragged?.()) return;
        toggleGuildCollapsed(guildKey);
    };

    return (
        <div
            className={"vc-glance-guild-section" + (collapsed ? " vc-glance-guild-collapsed" : "")}
            data-glance-row={guildKey}
        >
            <div
                className="vc-glance-guild-header"
                role="button"
                tabIndex={0}
                aria-expanded={!collapsed}
                aria-label={`${name}, ${total} channel${total === 1 ? "" : "s"}`}
                onPointerDown={e => onHeaderPress?.(guildKey, e)}
                onClick={toggle}
                onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleGuildCollapsed(guildKey);
                    }
                }}
            >
                <ChevronIcon
                    className={"vc-glance-chevron" + (collapsed ? "" : " vc-glance-chevron-open")}
                    size={14}
                />
                {headerIconUrl
                    ? <img className="vc-glance-guild-header-icon" src={headerIconUrl} alt="" draggable={false} />
                    : (
                        <div className="vc-glance-guild-header-icon vc-glance-guild-icon-fallback">
                            {isDM ? "DM" : (guild ? guildAcronym(guild.name) : "?")}
                        </div>
                    )
                }
                <span className="vc-glance-guild-header-name">{name}</span>
                {mentions > 0
                    ? <span className="vc-glance-badge">{mentions > 99 ? "99+" : mentions}</span>
                    : hasUnread && <span className="vc-glance-unread-dot" />
                }
                <span className="vc-glance-guild-header-count">{total}</span>
            </div>

            {!collapsed && (
                <div className="vc-glance-guild-body">
                    {textIds.length > 0 && (
                        <div className="vc-glance-row-list">
                            {textIds.map((id, i) => (
                                <TextChannelRow key={id} channelId={id} siblingIds={textIds} index={i} hideGuild />
                            ))}
                        </div>
                    )}
                    {voiceIds.length > 0 && (
                        <div className="vc-glance-row-list">
                            {voiceIds.map((id, i) => (
                                <VoiceChannelRow key={id} channelId={id} siblingIds={voiceIds} index={i} hideGuild />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export function QuickAccessWidget() {
    const { watchedChannels } = useGlanceConfig();

    // Group watched channels by server, preserving the order servers first
    // appear in. Within a server, text channels come before voice, matching
    // Discord's own sidebar; channels that no longer resolve fall into the
    // text list so they can still be removed. DMs / group DMs bucket under a
    // shared "Group DMs" section.
    const order: string[] = [];
    const buckets = new Map<string, { voiceIds: string[]; textIds: string[]; }>();
    let anyVoice = false;
    for (const id of watchedChannels) {
        const channel = ChannelStore.getChannel(id);
        const key = channel?.getGuildId?.() ?? DM_KEY;
        let bucket = buckets.get(key);
        if (!bucket) {
            bucket = { voiceIds: [], textIds: [] };
            buckets.set(key, bucket);
            order.push(key);
        }
        if (channel?.isVocal()) {
            bucket.voiceIds.push(id);
            anyVoice = true;
        } else {
            bucket.textIds.push(id);
        }
    }

    // Server sections reorder by dragging their header. Committing rebuilds
    // watchedChannels grouped in the new key order (section order derives from
    // first appearance), so the arrangement persists across restarts without a
    // separate order field to keep in sync.
    const containerRef = React.useRef<HTMLDivElement>(null);
    const { drag, beginPress, wasDragged } = useRowDrag({
        ids: order,
        containerRef,
        mode: "list",
        onCommit: orderedKeys => {
            const next = orderedKeys.flatMap(key =>
                watchedChannels.filter(id => (ChannelStore.getChannel(id)?.getGuildId?.() ?? DM_KEY) === key)
            );
            setWatchedChannelsOrder(next);
        }
    });

    // Discord doesn't reliably emit VoiceStateStore changes for guilds you
    // aren't actively viewing, so store subscriptions alone leave voice
    // occupancy stale until some other action re-renders. Polling every 2s
    // while any voice channel is watched keeps it near-real-time.
    usePoll(2000, anyVoice);

    // Is there anything in here with something unread. That's the one question
    // worth answering while collapsed - not a count, not per-server totals,
    // just whether anything needs opening.
    //
    // Group DMs have to be pulled back out of the voice bucket. Discord reports
    // them as vocal, so the bucketing above files them with voice channels, but
    // they carry real conversations and their unread state is exactly what this
    // dot exists to surface.
    const unreadCandidates = order.flatMap(key => {
        const bucket = buckets.get(key)!;
        const groupDms = bucket.voiceIds.filter(id => ChannelStore.getChannel(id)?.type === 3);
        return [...bucket.textIds, ...groupDms];
    });
    const hasUnread = useStateFromStores(
        [ReadStateStore],
        () => unreadCandidates.some(id => ReadStateStore.hasUnread(id)),
        [unreadCandidates.join(",")]
    );

    const visibleKeys = drag ? order.filter(key => key !== drag.id) : order;
    const rendered: React.ReactNode[] = [];
    visibleKeys.forEach((key, i) => {
        if (drag && i === drag.overIndex) {
            rendered.push(<RowDropSlot key="vc-glance-guild-slot" drag={drag} />);
        }
        const bucket = buckets.get(key)!;
        rendered.push(
            <GuildSection
                key={key}
                guildKey={key}
                voiceIds={bucket.voiceIds}
                textIds={bucket.textIds}
                onHeaderPress={beginPress}
                wasDragged={wasDragged}
            />
        );
    });
    if (drag && drag.overIndex >= visibleKeys.length) {
        rendered.push(<RowDropSlot key="vc-glance-guild-slot" drag={drag} />);
    }

    const dragBucket = drag ? buckets.get(drag.id) : undefined;

    return (
        <WidgetCard id="quick-access" indicator={hasUnread}>
            {watchedChannels.length === 0
                ? (
                    <div className="vc-glance-empty">
                        Right-click a text or voice channel and choose{" "}
                        <strong>Watch on At a glance</strong> to see unreads and voice activity here.
                    </div>
                )
                : (
                    <>
                        <div className="vc-glance-guild-sections" ref={containerRef}>
                            {rendered}
                        </div>
                        {drag && dragBucket && (
                            <RowDragGhost drag={drag}>
                                <GuildSection
                                    guildKey={drag.id}
                                    voiceIds={dragBucket.voiceIds}
                                    textIds={dragBucket.textIds}
                                />
                            </RowDragGhost>
                        )}
                    </>
                )
            }
        </WidgetCard>
    );
}
