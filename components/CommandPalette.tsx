/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openUserProfile } from "@utils/discord";
import { findByPropsLazy } from "@webpack";
import {
    ChannelStore,
    GuildStore,
    React,
    RelationshipStore,
    UserStore
} from "@webpack/common";

import { getConfig } from "../data";
import { finders } from "../discordChecks";
import { openChannelPopup } from "./ChannelPopup";
import { openCustomizePanel } from "./CustomizePanel";
import { closeGlance } from "./GlanceLayer";
import { BookmarkIcon, ChatIcon, HashIcon, PaletteIcon, SpeakerIcon } from "./icons";

const VoiceActions = findByPropsLazy(...finders.voiceActions.props) as {
    selectVoiceChannel(channelId: string): void;
};
const MessageJumpActions = findByPropsLazy(...finders.messageJumpActions.props) as {
    jumpToMessage(options: { channelId: string; messageId: string; flash?: boolean; }): void;
};

interface Command {
    id: string;
    title: string;
    subtitle: string;
    keywords: string;
    icon: React.ComponentType<{ size?: number; }>;
    run: () => void;
}

function buildCommands(): Command[] {
    const config = getConfig();
    const commands: Command[] = [];

    // Pinned friends
    for (const userId of config.pinnedUsers) {
        const user = UserStore.getUser(userId);
        if (!user) continue;
        const nickname = RelationshipStore.getNickname(userId);
        const name = nickname || user.globalName || user.username;
        commands.push({
            id: `friend-${userId}`,
            title: name,
            subtitle: "Pinned friend · open chat",
            keywords: `${name} ${user.username} friend dm message`.toLowerCase(),
            icon: ChatIcon,
            run: () => {
                const dmId = ChannelStore.getDMFromUserId(userId);
                if (dmId) openChannelPopup(dmId);
                else openUserProfile(userId);
            }
        });
    }

    // Watched channels
    for (const channelId of config.watchedChannels) {
        const channel = ChannelStore.getChannel(channelId);
        if (!channel) continue;
        const isVoice = channel.isVocal?.();
        const guildName = channel.getGuildId?.() ? GuildStore.getGuild(channel.getGuildId())?.name : undefined;
        commands.push({
            id: `channel-${channelId}`,
            title: channel.name || "channel",
            subtitle: `${isVoice ? "Voice" : "Text"} channel${guildName ? ` · ${guildName}` : ""}`,
            keywords: `${channel.name} ${guildName ?? ""} channel ${isVoice ? "voice join" : "text"}`.toLowerCase(),
            icon: isVoice ? SpeakerIcon : HashIcon,
            run: () => {
                if (isVoice) {
                    closeGlance();
                    VoiceActions.selectVoiceChannel(channelId);
                } else {
                    openChannelPopup(channelId);
                }
            }
        });
    }

    // Bookmarks
    for (const bookmark of config.bookmarks) {
        commands.push({
            id: `bookmark-${bookmark.messageId}`,
            title: bookmark.snippet || "Saved message",
            subtitle: `Saved · ${bookmark.authorName} in ${bookmark.location}`,
            keywords: `${bookmark.snippet} ${bookmark.authorName} ${bookmark.location} bookmark saved`.toLowerCase(),
            icon: BookmarkIcon,
            run: () => {
                closeGlance();
                MessageJumpActions.jumpToMessage({
                    channelId: bookmark.channelId,
                    messageId: bookmark.messageId,
                    flash: true
                });
            }
        });
    }

    // Actions
    commands.push({
        id: "action-customize",
        title: "Customize appearance",
        subtitle: "Materials, colours, intensity, direction",
        keywords: "customize appearance theme material colour color acrylic glass",
        icon: PaletteIcon,
        run: openCustomizePanel
    });

    return commands;
}

function score(command: Command, query: string): number {
    if (!query) return 1;
    const title = command.title.toLowerCase();
    if (title === query) return 1000;
    if (title.startsWith(query)) return 500;
    if (title.includes(query)) return 300;
    if (command.keywords.includes(query)) return 100;
    // token-wise fallback
    return query.split(/\s+/).every(t => command.keywords.includes(t)) ? 50 : 0;
}

export function CommandPalette({ onClose }: { onClose: () => void; }) {
    const [query, setQuery] = React.useState("");
    const [activeIndex, setActiveIndex] = React.useState(0);
    const inputRef = React.useRef<HTMLInputElement>(null);

    const allCommands = React.useMemo(buildCommands, []);
    const results = React.useMemo(() => {
        const q = query.trim().toLowerCase();
        return allCommands
            .map(command => ({ command, s: score(command, q) }))
            .filter(r => r.s > 0)
            .sort((a, b) => b.s - a.s)
            .slice(0, 8)
            .map(r => r.command);
    }, [allCommands, query]);

    React.useEffect(() => setActiveIndex(0), [query]);
    React.useEffect(() => inputRef.current?.focus(), []);

    const run = (command: Command | undefined) => {
        if (!command) return;
        onClose();
        // Defer so the palette unmounts before the action opens anything
        setTimeout(() => command.run(), 0);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        switch (e.key) {
            case "Escape":
                e.preventDefault();
                e.stopPropagation();
                onClose();
                break;
            case "ArrowDown":
                e.preventDefault();
                setActiveIndex(i => Math.min(results.length - 1, i + 1));
                break;
            case "ArrowUp":
                e.preventDefault();
                setActiveIndex(i => Math.max(0, i - 1));
                break;
            case "Enter":
                e.preventDefault();
                run(results[activeIndex]);
                break;
        }
    };

    return (
        <div className="vc-glance-palette-backdrop" onClick={onClose}>
            <div className="vc-glance-palette" onClick={e => e.stopPropagation()} onKeyDown={onKeyDown}>
                <div className="vc-glance-palette-search">
                    <input
                        ref={inputRef}
                        className="vc-glance-palette-input"
                        type="text"
                        placeholder="Jump to a friend, channel, bookmark, or action…"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                    />
                    <kbd className="vc-glance-palette-kbd">Esc</kbd>
                </div>
                <div className="vc-glance-palette-results">
                    {results.length === 0
                        ? <div className="vc-glance-palette-empty">No matches</div>
                        : results.map((command, i) => {
                            const Icon = command.icon;
                            return (
                                <button
                                    key={command.id}
                                    className={"vc-glance-palette-item" + (i === activeIndex ? " vc-glance-palette-item-active" : "")}
                                    onClick={() => run(command)}
                                    onMouseEnter={() => setActiveIndex(i)}
                                >
                                    <span className="vc-glance-palette-item-icon"><Icon size={16} /></span>
                                    <span className="vc-glance-palette-item-text">
                                        <span className="vc-glance-palette-item-title">{command.title}</span>
                                        <span className="vc-glance-palette-item-subtitle">{command.subtitle}</span>
                                    </span>
                                </button>
                            );
                        })
                    }
                </div>
            </div>
        </div>
    );
}
