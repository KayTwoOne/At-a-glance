/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openUserProfile } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { Activity } from "@vencord/discord-types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import {
    Alerts,
    CallStore,
    ChannelActionCreators,
    ChannelRouter,
    ChannelStore,
    Constants,
    ContextMenuApi,
    Menu,
    PresenceStore,
    React,
    ReadStateStore,
    RelationshipStore,
    RestAPI,
    Tooltip,
    UserStore,
    UserUtils,
    useStateFromStores
} from "@webpack/common";

import { movePinnedUser, setPinnedOrder, togglePinnedUser, useGlanceConfig } from "../../data";
import { settings } from "../../settings";
import { openChannelPopup } from "../ChannelPopup";
import { closeGlance } from "../GlanceLayer";
import { ArrowIcon, ChatIcon, DotsIcon, ExternalIcon, PhoneIcon } from "../icons";
import { openPrompt } from "../PromptModal";
import { RowDragGhost, RowDropSlot, useRowDrag } from "../rowDrag";
import { WidgetCard } from "../WidgetCard";

const logger = new Logger("AtAGlance");

// Discord's relationship action creators: blockUser, ignoreUser,
// updateRelationship (friend nickname PATCH), etc.
const RelationshipActions = findByPropsLazy("updateRelationship", "blockUser") as {
    blockUser(userId: string, context: { location: string; }): void;
    ignoreUser(userId: string, location?: string): Promise<unknown>;
    unignoreUser(userId: string, location?: string): Promise<unknown>;
    updateRelationship(userId: string, nickname: string | null): Promise<unknown>;
};

const NoteStore = findStoreLazy("NoteStore") as { getNote(userId: string): any; };

// Answering = joining the ringing DM call's channel; declining = the same
// stop-ringing action Discord's own call UI dispatches
const VoiceActions = findByPropsLazy("selectVoiceChannel", "selectChannel") as {
    selectVoiceChannel(channelId: string): void;
};
const CallActions = findByPropsLazy("ring", "stopRinging") as {
    stopRinging(channelId: string, recipients?: string[]): void;
};

// Tiles are 36px avatar + 8px vertical padding each way = 52px, two per grid
// row with a 6px gap. Ten tiles is five rows, which keeps the widget tall
// enough to stay the anchor of the social column while still capping growth
// for someone who has pinned dozens. Lower than this and a normal pin list
// hides friends the user could previously see at a glance, which is the one
// thing this widget must never do.
const MAX_VISIBLE_TILES = 10;

const STATUS_LABELS: Record<string, string> = {
    online: "Online",
    idle: "Idle",
    dnd: "Do Not Disturb",
    offline: "Offline",
    invisible: "Offline"
};

function describeActivity(activities: Activity[], status: string): string {
    const activity = activities.find(a => a.type !== 4) ?? activities[0];
    if (!activity) return STATUS_LABELS[status] ?? "Offline";

    switch (activity.type) {
        case 0: return `Playing ${activity.name}`;
        case 1: return `Streaming ${activity.name}`;
        case 2: {
            if (activity.name === "Spotify" && activity.details) {
                const artists = activity.state?.replaceAll(";", ",");
                return `♪ ${activity.details}${artists ? ` • ${artists}` : ""}`;
            }
            return `Listening to ${activity.name}`;
        }
        case 3: return `Watching ${activity.name}`;
        case 5: return `Competing in ${activity.name}`;
        case 4: return activity.state || (STATUS_LABELS[status] ?? "Online");
        default: return STATUS_LABELS[status] ?? "Offline";
    }
}

async function openDm(userId: string) {
    closeGlance();
    try {
        const dmChannelId = ChannelStore.getDMFromUserId(userId);
        if (dmChannelId) {
            ChannelRouter.transitionToChannel(dmChannelId);
        } else {
            await ChannelActionCreators.openPrivateChannel({ recipientIds: [userId] });
        }
    } catch (e) {
        logger.error("Failed to open DM", e);
    }
}

/**
 * Quick chat: the DM opens in the channel popup, right on top of the view -
 * no navigation, full chat input. The DM channel is created silently if it
 * doesn't exist yet (Discord's own action, without navigating).
 */
async function openDmPopup(userId: string) {
    try {
        let dmChannelId = ChannelStore.getDMFromUserId(userId);
        dmChannelId ??= await ChannelActionCreators.openPrivateChannel({
            recipientIds: [userId],
            navigateToChannel: false
        }) as string | undefined;
        if (dmChannelId) openChannelPopup(dmChannelId);
    } catch (e) {
        logger.error("Failed to open DM popup", e);
    }
}

async function startCall(userId: string) {
    closeGlance();
    try {
        // Discord's own "open DM and ring" path - the same thing the native
        // user context menu "Call" item does
        await ChannelActionCreators.openPrivateChannel({ recipientIds: [userId], joinCall: true });
    } catch (e) {
        logger.error("Failed to start call", e);
    }
}

function editNote(userId: string, displayName: string) {
    let existing = "";
    try {
        const raw = NoteStore.getNote(userId);
        existing = typeof raw === "string" ? raw : raw?.note ?? "";
    } catch { }

    openPrompt({
        title: `Note for ${displayName}`,
        placeholder: "Click to add a note",
        initialValue: existing,
        maxLength: 256,
        multiline: true,
        onSubmit: note => {
            RestAPI.put({
                url: Constants.Endpoints.NOTE(userId),
                body: { note }
            }).catch(e => logger.error("Failed to save note", e));
        }
    });
}

function editNickname(userId: string, displayName: string) {
    openPrompt({
        title: `Friend nickname for ${displayName}`,
        placeholder: "Nickname (leave empty to remove)",
        initialValue: RelationshipStore.getNickname(userId) ?? "",
        maxLength: 32,
        onSubmit: nickname => {
            RelationshipActions.updateRelationship(userId, nickname || null)
                ?.catch?.((e: unknown) => logger.error("Failed to update nickname", e));
        }
    });
}

function confirmBlock(userId: string, displayName: string) {
    Alerts.show({
        title: `Block ${displayName}?`,
        body: "Blocking this user will also remove them from your friends list.",
        confirmText: "Block",
        cancelText: "Cancel",
        onConfirm: () => RelationshipActions.blockUser(userId, { location: "ContextMenu" })
    });
}

function FriendMenu({ userId, displayName, isFirst, isLast }: {
    userId: string; displayName: string; isFirst: boolean; isLast: boolean;
}) {
    const ignored = RelationshipStore.isIgnored(userId);

    return (
        <Menu.Menu
            navId="vc-glance-friend-menu"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Friend quick actions"
        >
            <Menu.MenuItem id="vc-glance-friend-profile" label="Profile" action={() => openUserProfile(userId)} />
            <Menu.MenuItem id="vc-glance-friend-quickchat" label="Quick Chat" action={() => openDmPopup(userId)} />
            <Menu.MenuItem id="vc-glance-friend-message" label="Open Full DM" action={() => openDm(userId)} />
            <Menu.MenuItem id="vc-glance-friend-call" label="Start Call" action={() => startCall(userId)} />
            <Menu.MenuSeparator />
            <Menu.MenuItem id="vc-glance-friend-note" label="Add Note" action={() => editNote(userId, displayName)} />
            <Menu.MenuItem id="vc-glance-friend-nick" label="Change Friend Nickname" action={() => editNickname(userId, displayName)} />
            <Menu.MenuSeparator />
            {!isFirst && <Menu.MenuItem id="vc-glance-friend-up" label="Move up" action={() => movePinnedUser(userId, -1)} />}
            {!isLast && <Menu.MenuItem id="vc-glance-friend-down" label="Move down" action={() => movePinnedUser(userId, 1)} />}
            <Menu.MenuItem id="vc-glance-friend-unpin" label="Unpin Friend" action={() => togglePinnedUser(userId)} />
            <Menu.MenuSeparator />
            <Menu.MenuItem
                id="vc-glance-friend-ignore"
                label={ignored ? "Unignore" : "Ignore"}
                color="danger"
                action={() => (ignored
                    ? RelationshipActions.unignoreUser(userId, "ContextMenu")
                    : RelationshipActions.ignoreUser(userId, "ContextMenu")
                )?.catch?.((e: unknown) => logger.error("Failed to toggle ignore", e))}
            />
            <Menu.MenuItem
                id="vc-glance-friend-block"
                label="Block"
                color="danger"
                action={() => confirmBlock(userId, displayName)}
            />
        </Menu.Menu>
    );
}

function FriendRow({ userId, isFirst, isLast }: { userId: string; isFirst: boolean; isLast: boolean; }) {
    const user = useStateFromStores([UserStore], () => UserStore.getUser(userId), [userId]);
    const status = useStateFromStores([PresenceStore], () => PresenceStore.getStatus(userId), [userId]);
    const activities = useStateFromStores([PresenceStore], () => PresenceStore.getActivities(userId), [userId]);
    const nickname = useStateFromStores([RelationshipStore], () => RelationshipStore.getNickname(userId), [userId]);
    const mentionCount = useStateFromStores([ReadStateStore], () => {
        const dmChannelId = ChannelStore.getDMFromUserId(userId);
        return dmChannelId ? ReadStateStore.getMentionCount(dmChannelId) : 0;
    }, [userId]);
    // A DM call where WE are in the ringing list = this friend is calling us
    const ringingDmId = useStateFromStores([CallStore, ChannelStore], () => {
        const dmChannelId = ChannelStore.getDMFromUserId(userId);
        if (!dmChannelId) return null;
        const meId = UserStore.getCurrentUser()?.id;
        const call = CallStore.getCall(dmChannelId) as any;
        return meId && call?.ringing?.includes?.(meId) ? dmChannelId : null;
    }, [userId]);

    // Users not cached yet (e.g. right after a restart) are fetched once
    // through Discord's own user fetch action
    React.useEffect(() => {
        if (!user) UserUtils.getUser(userId).catch(() => { });
    }, [userId, user]);

    // Offline visibility is decided by the widget (so hidden friends don't
    // leave empty grid cells and drag indexing stays consistent)
    const isOffline = !status || status === "offline" || status === "invisible";

    const displayName = nickname || (user ? (user.globalName || user.username) : "Loading…");
    const subtitle = ringingDmId ? "Incoming call…" : describeActivity(activities ?? [], status ?? "offline");

    const answerCall = () => {
        closeGlance();
        try {
            VoiceActions.selectVoiceChannel(ringingDmId!);
        } catch (e) {
            logger.error("Failed to answer call", e);
        }
    };

    const rejectCall = () => {
        try {
            CallActions.stopRinging(ringingDmId!);
        } catch (e) {
            logger.error("Failed to decline call", e);
        }
    };

    const openMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        ContextMenuApi.openContextMenu(e, () => (
            <FriendMenu userId={userId} displayName={displayName} isFirst={isFirst} isLast={isLast} />
        ));
    };

    return (
        <div
            className={
                "vc-glance-row vc-glance-friend-tile"
                + (isOffline && !ringingDmId ? " vc-glance-row-offline" : "")
                + (ringingDmId ? " vc-glance-row-ringing" : "")
            }
            role="button"
            tabIndex={0}
            aria-label={ringingDmId ? `${displayName} is calling` : `Quick chat with ${displayName}`}
            onClick={() => openDmPopup(userId)}
            onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openDmPopup(userId);
                }
            }}
            onContextMenu={openMenu}
        >
            <div className="vc-glance-avatar-wrap">
                {user
                    ? <img className="vc-glance-avatar" src={user.getAvatarURL(void 0, 80, false)} alt="" draggable={false} />
                    : <div className="vc-glance-avatar vc-glance-avatar-placeholder" />
                }
                <span className={`vc-glance-status vc-glance-status-${status ?? "offline"}`} />
            </div>

            <div className="vc-glance-row-text">
                <span className="vc-glance-row-title">
                    {ringingDmId && <PhoneIcon className="vc-glance-ring-icon" size={14} />}
                    {displayName}
                </span>
                <span className="vc-glance-row-subtitle">{subtitle}</span>
            </div>

            <div className="vc-glance-row-actions" onClick={e => e.stopPropagation()}>
                {ringingDmId
                    ? (
                        <>
                            <Tooltip text="Answer">
                                {props => (
                                    <button {...props} className="vc-glance-call-button vc-glance-call-answer" onClick={answerCall}>
                                        <PhoneIcon size={15} />
                                    </button>
                                )}
                            </Tooltip>
                            <Tooltip text="Reject">
                                {props => (
                                    <button {...props} className="vc-glance-call-button vc-glance-call-reject" onClick={rejectCall}>
                                        <PhoneIcon size={15} slash />
                                    </button>
                                )}
                            </Tooltip>
                        </>
                    )
                    : (
                        <>
                            {mentionCount > 0 && (
                                <span className="vc-glance-badge">{mentionCount > 99 ? "99+" : mentionCount}</span>
                            )}
                            <Tooltip text="Quick chat">
                                {props => (
                                    <button {...props} className="vc-glance-icon-button" onClick={() => openDmPopup(userId)}>
                                        <ChatIcon size={16} />
                                    </button>
                                )}
                            </Tooltip>
                            <Tooltip text="Open full DM">
                                {props => (
                                    <button {...props} className="vc-glance-icon-button" onClick={() => openDm(userId)}>
                                        <ExternalIcon size={15} />
                                    </button>
                                )}
                            </Tooltip>
                            <Tooltip text="Quick actions">
                                {props => (
                                    <button {...props} className="vc-glance-icon-button" onClick={openMenu}>
                                        <DotsIcon size={16} />
                                    </button>
                                )}
                            </Tooltip>
                        </>
                    )
                }
            </div>
        </div>
    );
}

export function PinnedFriendsWidget() {
    const { pinnedUsers } = useGlanceConfig();
    const { showOfflinePinnedUsers } = settings.use(["showOfflinePinnedUsers"]);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const [expanded, setExpanded] = React.useState(false);
    const { drag, beginPress, wasDragged } = useRowDrag({
        ids: pinnedUsers,
        containerRef,
        mode: "grid",
        onCommit: setPinnedOrder
    });

    // Same "present and not offline" definition the visibility filter below
    // uses, so the header count never disagrees with the rows under it.
    const activeCount = useStateFromStores([PresenceStore], () => {
        let count = 0;
        for (const id of pinnedUsers) {
            const s = PresenceStore.getStatus(id);
            if (s && s !== "offline" && s !== "invisible") count++;
        }
        return count;
    }, [pinnedUsers.join(",")]);

    const summary = pinnedUsers.length > 0
        ? `${pinnedUsers.length} pinned, ${activeCount} active`
        : undefined;

    // Which pins actually render (offline ones can be hidden - but a ringing
    // friend always shows). Decided here, not in FriendRow, so hidden friends
    // don't leave empty grid cells and drag order maps cleanly.
    const visibleIds = useStateFromStores([PresenceStore, CallStore, ChannelStore, UserStore], () => {
        if (showOfflinePinnedUsers) return pinnedUsers;
        const meId = UserStore.getCurrentUser()?.id;
        return pinnedUsers.filter(id => {
            const s = PresenceStore.getStatus(id);
            if (s && s !== "offline" && s !== "invisible") return true;
            const dmChannelId = ChannelStore.getDMFromUserId(id);
            const call = dmChannelId ? CallStore.getCall(dmChannelId) as any : null;
            return !!(meId && call?.ringing?.includes?.(meId));
        });
    }, [pinnedUsers.join(","), showOfflinePinnedUsers]);

    // While dragging, the grabbed tile leaves the grid (a dashed slot marks the
    // landing cell) and follows the cursor as a ghost - widget drag, tile-sized
    const visible = drag ? visibleIds.filter(id => id !== drag.id) : visibleIds;
    // Show-more caps what's rendered, not what's tracked - the count above and
    // the drag order both still reason about the full `visible` list.
    const canShowMore = visible.length > MAX_VISIBLE_TILES;
    const shown = expanded ? visible : visible.slice(0, MAX_VISIBLE_TILES);
    const rendered: React.ReactNode[] = [];
    let slotPlaced = false;
    let renderedIndex = 0;
    for (const id of shown) {
        if (drag && renderedIndex === drag.overIndex) {
            rendered.push(<RowDropSlot key="vc-glance-friend-slot" drag={drag} />);
            slotPlaced = true;
        }
        rendered.push(
            <div
                key={id}
                data-glance-row={id}
                className="vc-glance-friend-cell"
                onPointerDown={e => beginPress(id, e)}
                onClickCapture={e => {
                    if (wasDragged()) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                }}
            >
                <FriendRow
                    userId={id}
                    isFirst={pinnedUsers.indexOf(id) === 0}
                    isLast={pinnedUsers.indexOf(id) === pinnedUsers.length - 1}
                />
            </div>
        );
        renderedIndex++;
    }
    if (drag && !slotPlaced) rendered.push(<RowDropSlot key="vc-glance-friend-slot" drag={drag} />);

    return (
        <WidgetCard id="pinned-friends" summary={summary}>
            {pinnedUsers.length === 0
                ? (
                    <div className="vc-glance-empty">
                        Right-click a user anywhere in Discord and choose{" "}
                        <strong>Pin to At a glance</strong> to add them here.
                    </div>
                )
                : visibleIds.length === 0
                    ? (
                        <div className="vc-glance-empty">
                            Everyone you've pinned is offline right now - they'll pop back
                            when they return, or enable <strong>Show offline friends</strong> in
                            the plugin settings to keep them visible.
                        </div>
                    )
                    : (
                        <>
                            <div className="vc-glance-friends-tiles" ref={containerRef}>
                            {rendered}
                        </div>
                            {canShowMore && (
                                <button
                                    type="button"
                                    className="vc-glance-show-more"
                                    aria-expanded={expanded}
                                    onClick={() => setExpanded(v => !v)}
                                >
                                    {expanded ? "Show less" : `Show ${visible.length - MAX_VISIBLE_TILES} more`}
                                    <ArrowIcon direction={expanded ? "up" : "down"} size={12} />
                                </button>
                            )}
                            {drag && (
                                <RowDragGhost drag={drag}>
                                    <FriendRow userId={drag.id} isFirst isLast />
                                </RowDragGhost>
                            )}
                        </>
                    )
            }
        </WidgetCard>
    );
}
