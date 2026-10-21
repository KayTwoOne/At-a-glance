/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { insertTextIntoChatInputBox, sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { findComponentByCodeLazy, findLazy } from "@webpack";
import {
    ChannelRouter,
    ChannelStore,
    EmojiStore,
    FluxDispatcher,
    GuildMemberStore,
    GuildRoleStore,
    GuildStore,
    MessageStore,
    PendingReplyStore,
    PermissionsBits,
    PermissionStore,
    React,
    ReadStateStore,
    UserStore,
    useStateFromStores
} from "@webpack/common";

import { finders } from "../discordChecks";
import { useAppearance } from "./appearance";
import { closeGlance } from "./GlanceLayer";
import { ExternalIcon, SendIcon } from "./icons";
import { MsgActions, NativeMessageList, PlainMessageList, ReplyBar } from "./PopupMessages";
import { MessageFetchActions } from "./widgets/Mentions";

const logger = new Logger("AtAGlance");

/* ========== Discord internals (each with a graceful fallback) ========== */

// Discord's REAL chat input (slate editor). The same component Discord embeds
// in its own modals (profile replies, voice channel status), rendered here in
// controlled mode with the fully-featured SIDEBAR config: emoji, GIF and
// sticker pickers, mention/emoji autocomplete - all wired to the channel.
const ChannelTextArea = findComponentByCodeLazy(...finders.channelTextArea.strings);
// Listed in discordChecks.ts as unchecked: it matches by shape, not text.
const ChatInputTypes = findLazy(m => m?.SIDEBAR?.analyticsName === "sidebar" && m.NORMAL) as Record<string, any>;

/** Slate rich value for plain text - trivial structure, built locally */
function toRichValue(text: string) {
    return text === ""
        ? [{ type: "line", children: [{ text: "" }] }]
        : text.split("\n").map(line => ({ type: "line", children: [{ text: line }] }));
}

const MAX_MESSAGE_LENGTH = 2000;

/* ===== Popup open-state =====
 * The popup is rendered by our own host (GlanceTab portals it to
 * document.body), NOT through Discord's modal system. The body has no CSS
 * transform, so a plain flex-centred backdrop lands the popup dead-centre of
 * the viewport (Discord's modal layer is transform-wrapped, which is what kept
 * trapping position:fixed and flinging the popup to one side). It also means
 * no Discord modal is open, so the emoji/GIF/sticker pickers stop fighting a
 * modal's outside-click guard. A tiny module-level store drives it, since it's
 * opened imperatively from widgets and the command palette. */
let currentPopupChannelId: string | null = null;
const popupListeners = new Set<() => void>();

// Session-scoped scroll positions per channel; MAX_SAFE_INTEGER = "was at the
// bottom" (assigning it clamps to the real bottom on restore, however much the
// channel has grown since)
const popupScrollMemory = new Map<string, number>();

export function openChannelPopup(channelId: string) {
    currentPopupChannelId = channelId;
    popupListeners.forEach(l => l());
}

export function closeChannelPopup() {
    if (currentPopupChannelId === null) return;
    currentPopupChannelId = null;
    popupListeners.forEach(l => l());
}

/** Used by GlanceLayer's Escape handler to yield while the popup is open */
export function isChannelPopupOpen() {
    return currentPopupChannelId !== null;
}

/** Live current popup channel id (null when closed) - GlanceLayer renders on it */
export function useChannelPopupChannelId(): string | null {
    const [, force] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => {
        popupListeners.add(force);
        return () => void popupListeners.delete(force);
    }, []);
    return currentPopupChannelId;
}

/** Same mechanism Discord's own UI uses to mark a channel read */
function ackChannel(channelId: string) {
    try {
        const messageId = ReadStateStore.lastMessageId(channelId);
        if (!messageId) return;
        FluxDispatcher.dispatch({
            type: "BULK_ACK",
            context: "APP",
            channels: [{ channelId, messageId, readStateType: 0 }]
        });
    } catch (e) {
        logger.error("Failed to ack channel", e);
    }
}

/* ========== composers ========== */

/** Fallback: the previous plain composer, used if Discord internals change */
function SimpleComposer({ channelId, canSend, label }: { channelId: string; canSend: boolean; label: string; }) {
    const [draft, setDraft] = React.useState("");
    const [sending, setSending] = React.useState(false);

    const submit = async () => {
        const content = draft.trim().slice(0, MAX_MESSAGE_LENGTH);
        if (!content || sending || !canSend) return;
        setSending(true);
        try {
            await sendMessage(channelId, { content });
            setDraft("");
        } catch (e) {
            logger.error("Failed to send message", e);
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="vc-glance-popup-composer">
            <textarea
                className="vc-glance-composer-input"
                rows={1}
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder={canSend ? `Message ${label}` : "You can't send messages in this channel"}
                disabled={!canSend || sending}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submit();
                    }
                }}
            />
            <button
                className="vc-glance-icon-button vc-glance-composer-send"
                aria-label="Send message"
                disabled={!canSend || sending || draft.trim().length === 0}
                onClick={submit}
            >
                <SendIcon size={18} />
            </button>
        </div>
    );
}

/* ===== our own :emoji suggester =====
 * Discord's built-in autocomplete never activates for this standalone,
 * controlled composer (its state machine is wired to the full channel view),
 * so the suggestion popup is ours: watch the draft for a trailing :query, ask
 * EmojiStore (same frecency-ranked search the native popup uses), and splice
 * the pick back into the controlled value. */

const EMOJI_QUERY_RE = /(?:^|\s):([a-zA-Z0-9_+]{2,})$/;
const EMOJI_INTENTION_CHAT = 3;
const MAX_EMOJI_SUGGESTIONS = 8;

function searchEmojis(channel: any, query: string): any[] {
    try {
        const results = EmojiStore.searchWithoutFetchingLatest({
            channel,
            query,
            count: MAX_EMOJI_SUGGESTIONS,
            intention: EMOJI_INTENTION_CHAT as any
        });
        return (results?.unlocked ?? []).slice(0, MAX_EMOJI_SUGGESTIONS);
    } catch (e) {
        logger.error("Emoji search failed", e);
        return [];
    }
}

/** What actually lands in the message: unicode surrogates, or custom-emoji markdown */
function emojiMarkdown(emoji: any): string {
    if (emoji.id) return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
    return emoji.surrogates ?? `:${emoji.name}:`;
}

/* Same idea for @mentions: a trailing @query pulls up members AND roles. We
   can't reuse Discord's autocomplete state machine (it's bound to the full
   channel view), so we gather the obvious candidates - the channel's own
   recipients, the guild's loaded members, your friends, and the guild's roles
   you're allowed to mention - and rank prefix matches first, mirroring what
   the native popup surfaces. */
const MENTION_QUERY_RE = /(?:^|\s)@([^\s@]{1,32})$/;
const MAX_MENTION_SUGGESTIONS = 8;
// Cap the guild-member scan so a big loaded roster can't lag each keystroke
const MEMBER_SCAN_CAP = 800;

type MentionSuggestion =
    | { type: "member"; user: any; nick: string | null; starts: boolean; }
    | { type: "role"; role: any; starts: boolean; };

function searchMentionables(channel: any, query: string): MentionSuggestion[] {
    const q = query.toLowerCase();
    const guildId = channel.getGuildId?.() || null;
    const seen = new Set<string>();
    const members: MentionSuggestion[] = [];
    const roles: MentionSuggestion[] = [];

    const consider = (userId: string | undefined) => {
        if (!userId || seen.has(userId)) return;
        seen.add(userId);
        const user = UserStore.getUser(userId);
        if (!user) return;
        const nick = guildId ? GuildMemberStore.getNick(guildId, userId) : null;
        const name = (user.globalName ?? "").toLowerCase();
        const username = (user.username ?? "").toLowerCase();
        const nickLower = (nick ?? "").toLowerCase();
        if (!name.includes(q) && !username.includes(q) && !nickLower.includes(q)) return;
        members.push({ type: "member", user, nick, starts: name.startsWith(q) || username.startsWith(q) || nickLower.startsWith(q) });
    };

    try {
        // Scope candidates to who is ACTUALLY in this chat: DM/group DM = its
        // recipients (plus yourself - the native popup offers both sides),
        // guild channel = the guild's members. Nothing else; a friend who isn't
        // in the conversation must not be mentionable from it.
        if (guildId) {
            const ids = GuildMemberStore.getMemberIds(guildId);
            for (let i = 0; i < ids.length && seen.size < MEMBER_SCAN_CAP; i++) consider(ids[i]);
        } else {
            for (const id of (channel.recipients ?? [])) consider(id);
            consider(UserStore.getCurrentUser()?.id);
        }

        // Roles: the ones marked mentionable by the server, or ALL of them when
        // you hold Mention Everyone in this channel - the same rule the native
        // autocomplete applies. @everyone (the role whose id === guildId) stays
        // out; that's a different beast from a role ping.
        if (guildId) {
            const canMentionAll = PermissionStore.can(PermissionsBits.MENTION_EVERYONE, channel);
            for (const role of GuildRoleStore.getSortedRoles(guildId)) {
                if (role.id === guildId) continue;
                if (!role.mentionable && !canMentionAll) continue;
                const name = (role.name ?? "").toLowerCase();
                if (!name.includes(q)) continue;
                roles.push({ type: "role", role, starts: name.startsWith(q) });
            }
        }
    } catch (e) {
        logger.error("Mention search failed", e);
    }

    // Prefix matches first within each group; members ahead of roles, like Discord
    members.sort((a, b) => Number(b.starts) - Number(a.starts));
    roles.sort((a, b) => Number(b.starts) - Number(a.starts));
    return [...members, ...roles].slice(0, MAX_MENTION_SUGGESTIONS);
}

type Suggest =
    | { kind: "emoji"; query: string; items: any[]; }
    | { kind: "mention"; query: string; items: MentionSuggestion[]; };

/** The floating suggestion popup above the composer - emoji or @member rows */
function SuggestPopup({ suggest, activeIndex, guildId, onPick, onHover }: {
    suggest: Suggest; activeIndex: number; guildId: string | undefined;
    onPick: (item: any) => void; onHover: (index: number) => void;
}) {
    const rowClass = (i: number) =>
        "vc-glance-emoji-suggest-row" + (i === activeIndex ? " vc-glance-emoji-suggest-active" : "");

    return (
        <div className="vc-glance-emoji-suggest" onMouseDown={e => e.preventDefault()}>
            <div className="vc-glance-emoji-suggest-title">
                {suggest.kind === "emoji"
                    ? <>Emoji matching <strong>:{suggest.query}</strong></>
                    : <>Members matching <strong>@{suggest.query}</strong></>}
            </div>

            {suggest.kind === "emoji"
                ? suggest.items.map((emoji, i) => (
                    <button
                        key={emoji.id ?? emoji.uniqueName ?? emoji.name}
                        className={rowClass(i)}
                        onClick={() => onPick(emoji)}
                        onMouseEnter={() => onHover(i)}
                    >
                        {emoji.id
                            ? <img className="vc-glance-emoji-suggest-icon" src={`https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=32`} alt="" draggable={false} />
                            : <span className="vc-glance-emoji-suggest-icon">{emoji.surrogates}</span>
                        }
                        <span className="vc-glance-emoji-suggest-name">:{emoji.name}:</span>
                    </button>
                ))
                : suggest.items.map((item, i) => (
                    <button
                        key={item.type === "member" ? item.user.id : item.role.id}
                        className={rowClass(i)}
                        onClick={() => onPick(item)}
                        onMouseEnter={() => onHover(i)}
                    >
                        {item.type === "member"
                            ? (
                                <>
                                    <img
                                        className="vc-glance-emoji-suggest-icon vc-glance-suggest-avatar"
                                        src={item.user.getAvatarURL(guildId, 32, false)}
                                        alt=""
                                        draggable={false}
                                    />
                                    <span className="vc-glance-emoji-suggest-name">{item.nick || item.user.globalName || item.user.username}</span>
                                    <span className="vc-glance-suggest-sub">@{item.user.username}</span>
                                </>
                            )
                            : (
                                <>
                                    <span
                                        className="vc-glance-emoji-suggest-icon vc-glance-suggest-role-dot"
                                        style={{ background: item.role.colorString || "var(--text-muted, #949ba4)" }}
                                    />
                                    <span
                                        className="vc-glance-emoji-suggest-name"
                                        style={item.role.colorString ? { color: item.role.colorString } : undefined}
                                    >
                                        @{item.role.name}
                                    </span>
                                    <span className="vc-glance-suggest-sub">Role</span>
                                </>
                            )
                        }
                    </button>
                ))
            }
        </div>
    );
}

/**
 * Primary composer: Discord's real chat input (slate editor), controlled by us.
 * It renders the emoji/GIF/sticker + attach buttons and opens their pickers
 * itself; we own onSubmit, so we can attach a pending reply's reference (the
 * one thing the embedded full container wouldn't reliably do in the popup) and
 * clear the reply after sending.
 */
function NativeComposer({ channel, canSend, label }: { channel: any; canSend: boolean; label: string; }) {
    const [text, setText] = React.useState("");
    const [rich, setRich] = React.useState(() => toRichValue(""));

    // :emoji / @mention suggestions for the current draft (null = popup closed)
    const [suggest, setSuggest] = React.useState<Suggest | null>(null);
    const [activeIndex, setActiveIndex] = React.useState(0);
    const textRef = React.useRef("");
    const suggestRef = React.useRef(suggest);
    suggestRef.current = suggest;
    const activeRef = React.useRef(activeIndex);
    activeRef.current = activeIndex;

    const updateSuggestions = React.useCallback((value: string) => {
        const emoji = EMOJI_QUERY_RE.exec(value);
        if (emoji) {
            const items = searchEmojis(channel, emoji[1]);
            setSuggest(items.length > 0 ? { kind: "emoji", query: emoji[1], items } : null);
            setActiveIndex(0);
            return;
        }
        const mention = MENTION_QUERY_RE.exec(value);
        if (mention) {
            const items = searchMentionables(channel, mention[1]);
            setSuggest(items.length > 0 ? { kind: "mention", query: mention[1], items } : null);
            setActiveIndex(0);
            return;
        }
        setSuggest(null);
    }, [channel]);

    const applyValue = React.useCallback((value: string) => {
        textRef.current = value;
        setText(value);
        setRich(toRichValue(value));
    }, []);

    // Replaces the trailing :query / @query (and its leading char) with the pick
    const pickSuggestion = React.useCallback((item: any) => {
        const { current } = suggestRef;
        if (!current) return;
        const value = textRef.current;
        const insertion = current.kind === "emoji"
            ? emojiMarkdown(item)
            : item.type === "role" ? `<@&${item.role.id}>` : `<@${item.user.id}>`;
        const next = value.slice(0, value.length - current.query.length - 1) + insertion + " ";
        applyValue(next);
        setSuggest(null);
    }, [applyValue]);

    // Keyboard steering while the popup is open - capture phase so the slate
    // editor doesn't also act on Enter/arrows; Escape closes only the popup
    React.useEffect(() => {
        if (!suggest) return;
        function onKey(e: KeyboardEvent) {
            const { current } = suggestRef;
            if (!current) return;
            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    e.stopPropagation();
                    setActiveIndex(i => (i + 1) % current.items.length);
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    e.stopPropagation();
                    setActiveIndex(i => (i - 1 + current.items.length) % current.items.length);
                    break;
                case "Enter":
                case "Tab":
                    e.preventDefault();
                    e.stopPropagation();
                    pickSuggestion(current.items[activeRef.current]);
                    break;
                case "Escape":
                    e.preventDefault();
                    e.stopPropagation();
                    setSuggest(null);
                    break;
            }
        }
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [suggest != null, pickSuggestion]);

    const inputType = React.useMemo(() => ({
        ...ChatInputTypes.SIDEBAR,
        commands: { enabled: false },
        drafts: { ...ChatInputTypes.SIDEBAR.drafts },
        disableAutoFocus: false
    }), []);

    return (
        <div className="vc-glance-native-composer">
            <ChannelTextArea
                channel={channel}
                type={inputType}
                textValue={text}
                richValue={rich}
                disabled={!canSend}
                placeholder={canSend ? `Message ${label}` : "You can't send messages in this channel"}
                onChange={(_e: unknown, newText: string, newRich: unknown) => {
                    textRef.current = newText;
                    setText(newText);
                    setRich(newRich as any);
                    updateSuggestions(newText);
                }}
                onSubmit={async ({ value }: { value: string; }) => {
                    const content = (value ?? "").trim().slice(0, MAX_MESSAGE_LENGTH);
                    if (!content) return { shouldClear: false, shouldRefocus: true };
                    try {
                        // Attach a pending reply so this actually sends AS a reply,
                        // then clear it (both are what Discord's own send does)
                        const reply = PendingReplyStore.getPendingReply(channel.id);
                        const options = reply ? MsgActions.getSendMessageOptionsForReply?.(reply) : undefined;
                        await sendMessage(channel.id, { content }, void 0, options ?? {});
                        if (reply) FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId: channel.id });
                        applyValue("");
                        setSuggest(null);
                        return { shouldClear: true, shouldRefocus: true };
                    } catch (e) {
                        logger.error("Failed to send message", e);
                        return { shouldClear: false, shouldRefocus: true };
                    }
                }}
            />

            {suggest && (
                <SuggestPopup
                    suggest={suggest}
                    activeIndex={activeIndex}
                    guildId={channel.getGuildId?.()}
                    onPick={pickSuggestion}
                    onHover={setActiveIndex}
                />
            )}
        </div>
    );
}

/* ========== formatting toolbar ========== */

/* Markdown the composer understands, one keystroke away. Buttons use
   onMouseDown+preventDefault so the editor keeps focus AND its selection; the
   insert then replaces the selection (or drops in an empty pair to fill in). */
const COMPOSER_FORMATS: Array<{ label: string; title: string; wrap: string; }> = [
    { label: "B", title: "Bold", wrap: "**" },
    { label: "I", title: "Italic", wrap: "*" },
    { label: "S", title: "Strikethrough", wrap: "~~" },
    { label: "<>", title: "Code", wrap: "`" },
    { label: "||", title: "Spoiler", wrap: "||" }
];

function FormatToolbar() {
    const apply = (wrap: string) => {
        const selection = window.getSelection()?.toString() ?? "";
        insertTextIntoChatInputBox(`${wrap}${selection}${wrap}`);
    };
    return (
        <div className="vc-glance-fmt-bar" onMouseDown={e => e.preventDefault()}>
            {COMPOSER_FORMATS.map(format => (
                <button
                    key={format.title}
                    className="vc-glance-fmt-btn"
                    title={format.title}
                    aria-label={format.title}
                    onClick={() => apply(format.wrap)}
                >
                    {format.label}
                </button>
            ))}
        </div>
    );
}

/* ========== the popup ========== */

/** The message list for a channel, tolerant of either fork's type shape.
 *  Vencord types ChannelMessages with toArray(); Equicord types it with the
 *  backing _array. The runtime object carries both, so this reads whichever is
 *  present and yields an empty list if neither is, rather than throwing. */
function readChannelMessages(store: unknown): any[] {
    const source = store as { toArray?: () => any[]; _array?: any[]; } | null | undefined;
    if (typeof source?.toArray === "function") return source.toArray();
    if (Array.isArray(source?._array)) return source!._array;
    return [];
}

function channelLabel(channel: any): string {
    if (channel.isDM?.()) {
        const recipient = UserStore.getUser(channel.getRecipientId?.());
        return `@${recipient?.globalName || recipient?.username || "dm"}`;
    }
    if (channel.isMultiUserDM?.()) return channel.name || "Group DM";
    return `#${channel.name || "channel"}`;
}

/**
 * The channel popup - a fixed-width card centred on the viewport, in a
 * flex-centred fixed backdrop that GlanceTab portals to document.body, clear
 * of any transformed ancestor. Click the backdrop or press Escape to close.
 */
export function ChannelPopupOverlay({ channelId, onClose }: { channelId: string; onClose: () => void; }) {
    const channel = useStateFromStores([ChannelStore], () => ChannelStore.getChannel(channelId), [channelId]);
    const guildName = useStateFromStores(
        [GuildStore],
        () => channel?.getGuildId() ? GuildStore.getGuild(channel.getGuildId())?.name : undefined,
        [channel?.getGuildId()]
    );
    const messages = useStateFromStores(
        [MessageStore],
        // Vencord's discord-types declares toArray() on ChannelMessages;
        // Equicord's declares the backing _array instead. The real object has
        // both, so read whichever is there rather than binding the plugin to
        // one fork's type definitions.
        () => readChannelMessages(MessageStore.getMessages(channelId)),
        [channelId]
    );
    const lastMessageId = useStateFromStores(
        [ReadStateStore],
        () => ReadStateStore.lastMessageId(channelId),
        [channelId]
    );

    const canSend = channel != null && (
        channel.getGuildId() == null || PermissionStore.can(PermissionsBits.SEND_MESSAGES, channel)
    );

    // Which of our own messages is being edited (our controlled editor)
    const [editingId, setEditingId] = React.useState<string | null>(null);
    React.useEffect(() => setEditingId(null), [channelId]);
    // Stable identity, or every memoised message row invalidates on each render
    const stopEditing = React.useCallback(() => setEditingId(null), []);

    // Where the "NEW" divider goes - captured on open, BEFORE the ack below
    // wipes the unread state (the host keys us by channelId, so this initializer
    // runs fresh for every channel opened)
    const [firstUnreadId] = React.useState<string | null>(() => {
        try {
            return (ReadStateStore as any).getOldestUnreadMessageId?.(channelId) ?? null;
        } catch {
            return null;
        }
    });

    const scrollerRef = React.useRef<HTMLDivElement>(null);

    // Load recent history through Discord's own fetch action
    React.useEffect(() => {
        try {
            MessageFetchActions.fetchMessages({ channelId, limit: 50 });
        } catch (e) {
            logger.error("Failed to fetch messages", e);
        }
    }, [channelId]);

    // Viewing the popup counts as reading the channel, like a real channel view
    React.useEffect(() => {
        if (lastMessageId) ackChannel(channelId);
    }, [channelId, lastMessageId]);

    // Follow the newest message, but only while the reader is already at the
    // bottom - scrolling up to read history must not get yanked back down;
    // instead an "n new messages" bar collects what arrived below (cleared the
    // moment you reach the bottom again, or by clicking it). Your OWN sends
    // always jump down, like the real client. Reopening a channel restores
    // where you left off (session-scoped).
    const bottomRef = React.useRef<HTMLDivElement>(null);
    const atBottomRef = React.useRef(true);
    const [newBelow, setNewBelow] = React.useState(0);
    const scrollToBottom = React.useCallback(() => {
        bottomRef.current?.scrollIntoView({ block: "end" });
    }, []);
    const onScroll = React.useCallback(() => {
        const el = scrollerRef.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        atBottomRef.current = atBottom;
        if (atBottom) setNewBelow(0);
    }, []);

    // Keyed on the newest message ID, NOT the array length: the store windows
    // its cache (oldest drops out as new arrive), so length stops changing once
    // the window is full - the original "doesn't scroll down" bug.
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    const lastSeenIdRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (!lastMessage || lastMessage.id === lastSeenIdRef.current) return;
        const isInitialLoad = lastSeenIdRef.current === null;
        lastSeenIdRef.current = lastMessage.id;
        if (isInitialLoad) return; // open-time positioning is handled below

        const isOwn = lastMessage.author?.id === UserStore.getCurrentUser()?.id;
        if (atBottomRef.current || isOwn) {
            scrollToBottom();
            // Second pass after images/embeds get their real height
            const timer = setTimeout(scrollToBottom, 150);
            setNewBelow(0);
            return () => clearTimeout(timer);
        }
        setNewBelow(n => n + 1);
    }, [lastMessage?.id]);
    React.useEffect(() => {
        const saved = popupScrollMemory.get(channelId);
        const restore = () => {
            const el = scrollerRef.current;
            if (saved != null && el) {
                el.scrollTop = saved;
                onScroll();
            } else {
                scrollToBottom();
            }
        };
        // Re-run a few times to win against Discord's async message streaming
        const timers = [0, 60, 200, 500].map(ms => setTimeout(restore, ms));
        return () => {
            timers.forEach(clearTimeout);
            const el = scrollerRef.current;
            if (el) popupScrollMemory.set(channelId, atBottomRef.current ? Number.MAX_SAFE_INTEGER : el.scrollTop);
        };
    }, [channelId]);

    // Reply-reference click (item: clicking a reply jumps to the message it
    // answers). Read through a ref rather than closing over `messages`
    // directly - onReplyClick is handed to the memoised message rows, and a
    // dependency on the message array would mint a new function (and bust the
    // memo) on every incoming message.
    const messagesRef = React.useRef(messages);
    messagesRef.current = messages;
    const highlightTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    React.useEffect(() => () => {
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    }, []);

    const onReplyClick = React.useCallback((refChannelId: string, refMessageId: string) => {
        try {
            const loadedHere = messagesRef.current.some(m => m.id === refMessageId);
            const el = loadedHere
                ? scrollerRef.current?.querySelector<HTMLElement>(`#vc-glance-msgrow-${refMessageId}`)
                : null;
            if (el) {
                el.scrollIntoView({ block: "center", behavior: "smooth" });
                el.classList.remove("vc-glance-msg-highlight");
                void el.offsetWidth; // restart the animation if the same row is hit twice
                el.classList.add("vc-glance-msg-highlight");
                if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
                highlightTimerRef.current = setTimeout(() => {
                    el.classList.remove("vc-glance-msg-highlight");
                    highlightTimerRef.current = null;
                }, 1200);
                return;
            }
        } catch (e) {
            logger.error("Failed to scroll to replied message in popup", e);
        }

        // Not loaded in this popup - leave it and let the real client fetch and
        // jump, same order Bookmarks.tsx uses (navigate first: jumpToMessage
        // alone can no-op on a message the client hasn't loaded yet).
        try {
            onClose();
            closeGlance();
            ChannelRouter.transitionToChannel(refChannelId);
            setTimeout(() => {
                try {
                    MessageFetchActions.jumpToMessage({ channelId: refChannelId, messageId: refMessageId, flash: true });
                } catch (e) {
                    logger.error("Failed to jump to replied message", e);
                }
            }, 150);
        } catch (e) {
            logger.error("Failed to open channel for replied message", e);
        }
    }, [onClose]);

    // Escape closes the popup (bubble phase, so the composer can cancel a
    // reply/edit first via preventDefault). GlanceLayer's own Escape yields
    // while the popup is open (isChannelPopupOpen guard).
    React.useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape" && !e.defaultPrevented) {
                e.stopPropagation();
                onClose();
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const goToChannel = () => {
        onClose();
        closeGlance();
        ChannelRouter.transitionToChannel(channelId);
    };

    const label = channel ? channelLabel(channel) : "channel";

    // The popup is portaled to document.body (not a descendant of
    // .vc-glance-layer), so the user's --vcg-* theme colours are applied here
    // directly for the input-bar tint to resolve - and the light-theme class
    // must be carried here too.
    const { style: appearanceStyle, onLightTheme } = useAppearance();

    // Memoise the composer ELEMENT so incoming messages (which re-render the
    // popup constantly) don't re-render/reset the live chat input mid-type - the
    // cause of text randomly vanishing. Same element reference across message
    // re-renders → React bails out of that subtree. (Can't use React.memo at
    // module scope: it touches the React lazy-proxy before webpack is ready.)
    const composer = React.useMemo(() => channel && (
        <ErrorBoundary
            fallback={() => <SimpleComposer channelId={channelId} canSend={canSend} label={label} />}
            onError={e => logger.error("Native composer failed, using fallback", e)}
        >
            <NativeComposer channel={channel} canSend={canSend} label={label} />
        </ErrorBoundary>
    ), [channel, channelId, canSend, label]);

    return (
        <div
            className={"vc-glance-popup-backdrop" + (onLightTheme ? " vc-glance-on-light" : "")}
            style={appearanceStyle}
            onClick={onClose}
        >
            <div className="vc-glance-popup" onClick={e => e.stopPropagation()}>
                <header className="vc-glance-popup-titlebar">
                    <div className="vc-glance-popup-titles">
                        <span className="vc-glance-popup-title">{label}</span>
                        {guildName && <span className="vc-glance-popup-subtitle">{guildName}</span>}
                    </div>
                    <button className="vc-glance-icon-button vc-glance-popup-close" aria-label="Close" onClick={onClose}>✕</button>
                </header>

                {!channel
                    ? <div className="vc-glance-empty">This channel is no longer accessible.</div>
                    : (
                        <>
                            <div className="vc-glance-popup-scrollwrap">
                                <div className="vc-glance-popup-scroll" ref={scrollerRef} onScroll={onScroll}>
                                    {/* Thin banner: the escape hatch to the full channel */}
                                    <div className="vc-glance-popup-banner">
                                        <span className="vc-glance-hint">Quick chat - full channel view for threads &amp; more</span>
                                        <button className="vc-glance-goto" onClick={goToChannel}>
                                            <ExternalIcon size={14} />
                                            Go to channel
                                        </button>
                                    </div>

                                    {messages.length === 0
                                        ? <div className="vc-glance-hint vc-glance-popup-loading">Loading messages…</div>
                                        : (
                                            <ErrorBoundary
                                                fallback={() => <PlainMessageList messages={messages} />}
                                                onError={e => logger.error("Native message renderer failed, using fallback", e)}
                                            >
                                                <NativeMessageList
                                                    messages={messages}
                                                    channel={channel}
                                                    editingId={editingId}
                                                    firstUnreadId={firstUnreadId}
                                                    onEdit={setEditingId}
                                                    onStopEdit={stopEditing}
                                                    onReplyClick={onReplyClick}
                                                />
                                            </ErrorBoundary>
                                        )
                                    }
                                    {/* Bottom anchor: scrolled into view to stick to newest */}
                                    <div ref={bottomRef} className="vc-glance-popup-bottom" />
                                </div>

                                {newBelow > 0 && (
                                    <button
                                        className="vc-glance-newbar"
                                        onClick={() => {
                                            scrollToBottom();
                                            setNewBelow(0);
                                        }}
                                    >
                                        {newBelow} new {newBelow === 1 ? "message" : "messages"} - jump to latest
                                    </button>
                                )}
                            </div>

                            <div className="vc-glance-popup-footer">
                                <ReplyBar channelId={channelId} />
                                <FormatToolbar />
                                {composer}
                            </div>
                        </>
                    )
                }
            </div>
        </div>
    );
}

/** Host: renders the popup when a channel is open (GlanceTab portals it to the body).
 *  Keyed by channel so per-channel state (unread marker, editor) resets cleanly. */
export function ChannelPopupHost() {
    const channelId = useChannelPopupChannelId();
    if (channelId === null) return null;
    return (
        <ErrorBoundary noop>
            <ChannelPopupOverlay key={channelId} channelId={channelId} onClose={closeChannelPopup} />
        </ErrorBoundary>
    );
}
