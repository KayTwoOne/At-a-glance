/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import type { Channel } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { ChannelRouter, ChannelStore, GuildStore, IconUtils, React, UserStore } from "@webpack/common";

import { finders } from "../../discordChecks";
import { type ChannelFacts, savedAuthor, savedLocation } from "../../savedLabels";
import { type Chip, messageChips, previewText, type SavedEntry } from "../../savedRows";
import { guildAcronym } from "../../util";
import { closeGlance } from "../GlanceLayer";
import { glanceToast } from "../toast";

// The row both Saved Messages and Reminders draw for a message Discord holds,
// and the few things that go with it. It lives here so the two widgets share one
// row instead of keeping two that drift apart.

const logger = new Logger("AtAGlance");

// Discord's own jump - scrolls to the message and flash-highlights it
const MessageJumpActions = findByPropsLazy(...finders.messageJumpActions.props) as {
    jumpToMessage(options: { channelId: string; messageId: string; flash?: boolean; }): void;
};

/** Row click: leave At a glance, land IN the channel, on the message, highlighted.
 *  Navigating first makes the jump reliable even when the message is far back in
 *  an unloaded channel - jumpToMessage alone can no-op in that case. */
export function jumpToSavedMessage(target: { channelId: string; messageId: string; }) {
    closeGlance();
    try {
        ChannelRouter.transitionToChannel(target.channelId);
        setTimeout(() => {
            try {
                MessageJumpActions.jumpToMessage({
                    channelId: target.channelId,
                    messageId: target.messageId,
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
export function BookmarkIconThumb({ guildId, authorId }: { guildId?: string; authorId?: string; }) {
    if (guildId) {
        const guild = GuildStore.getGuild(guildId);
        const iconUrl = guild ? IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 48 }) : undefined;
        return iconUrl
            ? <img className="vc-glance-bookmark-thumb vc-glance-bookmark-thumb-guild" src={iconUrl} alt="" draggable={false} />
            : (
                <div className="vc-glance-bookmark-thumb vc-glance-bookmark-thumb-guild vc-glance-bookmark-thumb-fallback">
                    {guild ? guildAcronym(guild.name) : "#"}
                </div>
            );
    }

    const user = authorId ? UserStore.getUser(authorId) : null;
    return user
        ? <img className="vc-glance-bookmark-thumb" src={user.getAvatarURL(void 0, 48, false)} alt="" draggable={false} />
        : <div className="vc-glance-bookmark-thumb vc-glance-bookmark-thumb-fallback">@</div>;
}

function channelFacts(channel: Channel | undefined, guildId: string | undefined): ChannelFacts | null {
    if (!channel) return null;
    if (channel.isDM?.()) return { kind: "dm" };
    if (channel.isMultiUserDM?.()) return { kind: "group", name: channel.name };

    const id = channel.getGuildId?.() ?? guildId;
    return { kind: "guild", name: channel.name, guildName: id ? GuildStore.getGuild(id)?.name : undefined };
}

// Stroked glyphs in the mockup's drawing: a paperclip, a link, an embedded card
function ChipIcon({ kind }: { kind: Chip["kind"]; }) {
    return (
        <svg
            className="vc-glance-bookmark-chip-icon"
            width={11}
            height={11}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
        >
            {kind === "file" && <path d="M10.5 5.2 6.3 9.4a1.2 1.2 0 0 0 1.7 1.7l4.6-4.6a2.4 2.4 0 0 0-3.4-3.4L4.5 7.8a3.6 3.6 0 0 0 5.1 5.1l3.4-3.4" />}
            {kind === "links" && (
                <>
                    <path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.1-2.1a2.6 2.6 0 0 0-3.7-3.7l-.8.8" />
                    <path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.4 8.9a2.6 2.6 0 0 0 3.7 3.7l.8-.8" />
                </>
            )}
            {kind === "embed" && (
                <>
                    <rect x="2.5" y="3" width="11" height="10" rx="1.6" />
                    <path d="M5 6.5h6M5 9.5h3.5" />
                </>
            )}
        </svg>
    );
}

/** The pencil: a note on a bookmark, and the mark of a text reminder */
export function NotePencilIcon({ size = 12 }: { size?: number; }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
        >
            <path d="M10.8 2.8l2.4 2.4-7.6 7.6-3 .6.6-3z" />
        </svg>
    );
}

interface SavedMessageRowProps {
    entry: SavedEntry;
    /** The last thing on the meta line: when it was saved on a bookmark, when it is due on a reminder */
    meta?: React.ReactNode;
    /** The row's buttons. Their clicks never reach the row, so they do not jump */
    actions: React.ReactNode;
    /** The row dims while a change to it is under way */
    dimmed?: boolean;
}

/**
 * One message Discord holds: server icon or avatar, author, place, preview of
 * the text, small tags for attachments and links, and the person's own note.
 * The row jumps to the message on click or Enter; the caller supplies the
 * buttons and the meta that differ between a bookmark and a reminder.
 */
export function SavedMessageRow({ entry, meta, actions, dimmed = false }: SavedMessageRowProps) {
    const { saveData } = entry;

    const channel = ChannelStore.getChannel(saveData.channelId);
    const user = saveData.authorId ? UserStore.getUser(saveData.authorId) : null;
    const author = savedAuthor(user, saveData.authorSummary);
    const location = savedLocation(channelFacts(channel, saveData.guildId), saveData.channelSummary);
    const chips = messageChips(entry.message);
    const note = typeof saveData.notes === "string" ? saveData.notes.trim() : "";

    const jump = () => jumpToSavedMessage(saveData);

    return (
        <div
            className={"vc-glance-row vc-glance-bookmark-row vc-glance-bookmark-row-native" + (dimmed ? " vc-glance-row-dimmed" : "")}
            role="button"
            tabIndex={0}
            aria-label={`Jump to saved message from ${author}`}
            onClick={jump}
            onKeyDown={e => {
                // A key pressed on one of the row's own buttons belongs to that button
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    jump();
                }
            }}
        >
            <BookmarkIconThumb guildId={saveData.guildId ?? channel?.getGuildId?.() ?? undefined} authorId={saveData.authorId} />
            <div className="vc-glance-row-text">
                <span className="vc-glance-mention-meta">
                    <span className="vc-glance-mention-author">{author}</span>
                    <span className="vc-glance-mention-location">{location}</span>
                    {meta}
                </span>
                <span className="vc-glance-mention-content">{previewText(entry)}</span>
                {chips.length > 0 && (
                    <span className="vc-glance-bookmark-chips">
                        {chips.map((chip, i) => (
                            <span key={`${chip.kind}-${i}`} className="vc-glance-bookmark-chip">
                                <ChipIcon kind={chip.kind} />
                                <span>{chip.label}</span>
                            </span>
                        ))}
                    </span>
                )}
                {note && (
                    <span className="vc-glance-bookmark-note" title={note}>
                        <NotePencilIcon />
                        <span>Your note: {note}</span>
                    </span>
                )}
            </div>
            <div className="vc-glance-row-actions" onClick={e => e.stopPropagation()}>
                {actions}
            </div>
        </div>
    );
}

// How long a row waits, after Discord accepts a change, for the gateway to echo
// it and update or take the row away before its buttons come back
const WRITE_ECHO_WAIT = 10_000;

/**
 * A change to Discord made from a row. The row does not change on the click;
 * it waits for Discord's echo (the store updates, the row re-renders or goes).
 * While the change is under way `pending` is true, so the buttons can disable.
 * If Discord refuses, `pending` clears and a toast says so. If it accepts but
 * no echo has come after 10 s, `pending` clears quietly so a button cannot stay
 * stuck. Call `settle` when the echo is seen to clear it at once.
 *
 * The echo can beat the reply to the request. A `settle` that lands first ends
 * that write for good: when the reply comes, no 10 s wait is started for a
 * change that has already shown up. Each wait is cleared before another is set,
 * and when the row goes.
 *
 * `write` must reject on failure (the bridge's writes all do, after logging
 * once), so nothing here logs.
 */
export function usePendingWrite() {
    const [pending, setPending] = React.useState(false);
    const alive = React.useRef(true);
    const echoTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    // Bumped by every run and every settle, so a reply can tell whether anything
    // has happened to its write while it was away
    const generation = React.useRef(0);

    const clearWait = () => {
        if (echoTimer.current !== null) {
            clearTimeout(echoTimer.current);
            echoTimer.current = null;
        }
    };

    React.useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
            clearWait();
        };
    }, []);

    const run = async (write: () => Promise<void>, failure: string) => {
        if (pending) return;
        setPending(true);
        const mine = ++generation.current;
        try {
            await write();
            if (alive.current && generation.current === mine) {
                clearWait();
                echoTimer.current = setTimeout(() => {
                    echoTimer.current = null;
                    setPending(false);
                }, WRITE_ECHO_WAIT);
            }
        } catch {
            clearWait();
            if (alive.current) setPending(false);
            glanceToast(failure, "failure");
        }
    };

    const settle = () => {
        generation.current++;
        clearWait();
        if (alive.current) setPending(false);
    };

    return { pending, run, settle };
}
