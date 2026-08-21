/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { findByPropsLazy } from "@webpack";
import { ChannelRouter, GuildStore, IconUtils, moment, React, Tooltip, UserStore } from "@webpack/common";

import { GlanceBookmark, removeBookmark, useGlanceConfig } from "../../data";
import { guildAcronym } from "../../util";
import { openChannelPopup } from "../ChannelPopup";
import { closeGlance } from "../GlanceLayer";
import { ChatIcon, CloseIcon } from "../icons";
import { WidgetCard } from "../WidgetCard";

const logger = new Logger("AtAGlance");

// Discord's own jump - scrolls to the message and flash-highlights it
const MessageJumpActions = findByPropsLazy("fetchMessages", "jumpToMessage") as {
    jumpToMessage(options: { channelId: string; messageId: string; flash?: boolean; }): void;
};

/** Row click: leave At a glance, land IN the channel, on the message, highlighted.
 *  Navigating first makes the jump reliable even when the message is far back in
 *  an unloaded channel - jumpToMessage alone can no-op in that case. */
function jumpToBookmark(bookmark: GlanceBookmark) {
    closeGlance();
    try {
        ChannelRouter.transitionToChannel(bookmark.channelId);
        setTimeout(() => {
            try {
                MessageJumpActions.jumpToMessage({
                    channelId: bookmark.channelId,
                    messageId: bookmark.messageId,
                    flash: true
                });
            } catch (e) {
                logger.error("Failed to jump to bookmark", e);
            }
        }, 150);
    } catch (e) {
        logger.error("Failed to open bookmark channel", e);
    }
}

/** Server icon for guild messages, author avatar for DMs, graceful fallbacks */
function BookmarkIconThumb({ bookmark }: { bookmark: GlanceBookmark; }) {
    if (bookmark.guildId) {
        const guild = GuildStore.getGuild(bookmark.guildId);
        const iconUrl = guild ? IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 48 }) : undefined;
        return iconUrl
            ? <img className="vc-glance-bookmark-thumb vc-glance-bookmark-thumb-guild" src={iconUrl} alt="" draggable={false} />
            : (
                <div className="vc-glance-bookmark-thumb vc-glance-bookmark-thumb-guild vc-glance-bookmark-thumb-fallback">
                    {guild ? guildAcronym(guild.name) : "#"}
                </div>
            );
    }

    const user = bookmark.authorId ? UserStore.getUser(bookmark.authorId) : null;
    return user
        ? <img className="vc-glance-bookmark-thumb" src={user.getAvatarURL(void 0, 48, false)} alt="" draggable={false} />
        : <div className="vc-glance-bookmark-thumb vc-glance-bookmark-thumb-fallback">@</div>;
}

function BookmarkRow({ bookmark }: { bookmark: GlanceBookmark; }) {
    return (
        <div
            className="vc-glance-row vc-glance-bookmark-row"
            role="button"
            tabIndex={0}
            aria-label={`Jump to saved message from ${bookmark.authorName}`}
            onClick={() => jumpToBookmark(bookmark)}
            onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    jumpToBookmark(bookmark);
                }
            }}
        >
            <BookmarkIconThumb bookmark={bookmark} />
            <div className="vc-glance-row-text">
                <span className="vc-glance-mention-meta">
                    <span className="vc-glance-mention-author">{bookmark.authorName || "Unknown"}</span>
                    <span className="vc-glance-mention-location">{bookmark.location}</span>
                    {bookmark.savedAt > 0 && (
                        <span className="vc-glance-msg-time">{moment(bookmark.savedAt).fromNow()}</span>
                    )}
                </span>
                <span className="vc-glance-mention-content">
                    {bookmark.snippet || <i>(no text content)</i>}
                </span>
            </div>
            <div className="vc-glance-row-actions" onClick={e => e.stopPropagation()}>
                <Tooltip text="Quick chat">
                    {props => (
                        <button
                            {...props}
                            className="vc-glance-icon-button"
                            onClick={() => openChannelPopup(bookmark.channelId)}
                        >
                            <ChatIcon size={15} />
                        </button>
                    )}
                </Tooltip>
                <Tooltip text="Remove bookmark">
                    {props => (
                        <button
                            {...props}
                            className="vc-glance-icon-button"
                            onClick={() => removeBookmark(bookmark.messageId)}
                        >
                            <CloseIcon size={14} />
                        </button>
                    )}
                </Tooltip>
            </div>
        </div>
    );
}

export function BookmarksWidget() {
    const { bookmarks } = useGlanceConfig();

    // No "0 saved" when there is nothing: the empty state already says that,
    // and a zero in the header just repeats it in a colder way.
    const summary = bookmarks.length > 0
        ? `${bookmarks.length} saved`
        : undefined;

    return (
        <WidgetCard id="bookmarks" summary={summary}>
            {bookmarks.length === 0
                ? (
                    <div className="vc-glance-empty">
                        Right-click any message and choose <strong>Save to At a glance</strong> -
                        it lands here so you can hop back whenever you need to.
                    </div>
                )
                : (
                    <div className="vc-glance-row-list">
                        {bookmarks.map(bookmark => (
                            <BookmarkRow key={bookmark.messageId} bookmark={bookmark} />
                        ))}
                    </div>
                )
            }
        </WidgetCard>
    );
}
