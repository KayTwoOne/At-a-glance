/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Message rendering for the channel popup: Discord's native message rows with
 * our grouping, reply/edit affordances and the NEW divider, plus a dependency-
 * free plain renderer as the fallback if Discord's internals shift.
 */

import { getUserSettingLazy } from "@api/UserSettings";
import { copyToClipboard } from "@utils/clipboard";
import { Logger } from "@utils/Logger";
import { findByPropsLazy, findComponentByCodeLazy, findCssClassesLazy } from "@webpack";
import {
    ContextMenuApi,
    EmojiStore,
    FluxDispatcher,
    Menu,
    moment,
    Parser,
    PendingReplyStore,
    PermissionsBits,
    PermissionStore,
    React,
    RestAPI,
    showToast,
    Toasts,
    UserStore,
    useStateFromStores
} from "@webpack/common";

const logger = new Logger("AtAGlance");

// Native message renderer - same component MessageLinkEmbeds uses. Gives real
// markdown, embeds, attachments, reactions and edited tags for free.
const ChannelMessage = findComponentByCodeLazy("childrenExecutedCommand:", ".hideAccessories");
const SearchResultClasses = findCssClassesLazy("message", "searchResult");
const MessageDisplayCompact = getUserSettingLazy("textAndImages", "messageDisplayCompact")!;

// Discord's own clipboard helper (works in the desktop sandbox where the raw
// navigator.clipboard can be restricted)

// Discord's message action creators - editMessage saves an edit server-side;
// getSendMessageOptionsForReply turns a pending reply into the send options
// (message_reference + allowed_mentions) so our own send attaches the reply.
export const MsgActions = findByPropsLazy("editMessage", "sendMessage") as {
    editMessage(channelId: string, messageId: string, edit: { content: string; }): Promise<unknown>;
    getSendMessageOptionsForReply?(reply: any): any;
};

// Discord groups consecutive same-author messages sent within ~5 minutes into
// one visual block (avatar/name shown once). We compute the same grouping and
// mark continuation rows so the CSS collapses the repeated avatar + header.
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Start a reply - the same action Discord's reply button uses. The composer
 *  (the channel's real chat input) sends with the reference; our own reply bar
 *  reflects it (both read PendingReplyStore). */
function startReply(channel: any, message: any) {
    try {
        const meId = UserStore.getCurrentUser()?.id;
        FluxDispatcher.dispatch({
            type: "CREATE_PENDING_REPLY",
            channel,
            message,
            shouldMention: true,
            showMentionToggle: channel.guild_id != null && message.author?.id !== meId
        });
    } catch (e) {
        logger.error("Failed to start reply", e);
    }
}

function cancelReply(channelId: string) {
    try {
        FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId });
    } catch (e) {
        logger.error("Failed to cancel reply", e);
    }
}

function copyText(text: string) {
    // DiscordNative clipboard on desktop, web clipboard in the browser build
    copyToClipboard(text).catch(e => logger.error("Failed to copy", e));
}

/* ========== reactions ==========
 * There's no confirmed, stable action-creator for reactions anywhere in this
 * codebase (or Vencord's shared webpack/common mappings) to match against, so
 * rather than guess a findByPropsLazy("addReaction") module's exact argument
 * shape, this follows the technique two other plugins in this tree already
 * ship with (equicordplugins/husk, equicordplugins/scheduledMessages): a
 * plain REST call to the same endpoint the client itself hits. Toggling is a
 * PUT/DELETE against .../reactions/<emoji>/@me either way; the only question
 * is which verb, decided by whether the message already carries your own
 * reaction with that emoji. */
type QuickReactionEmoji = { id: string | undefined; name: string; animated: boolean; };

function quickReactionEmoji(surrogate: string): QuickReactionEmoji {
    return { id: undefined, name: surrogate, animated: false };
}

// Used only if the store can't offer anything real (fresh account, store not
// ready, lookup failure) - the row must never end up empty.
const FALLBACK_REACTIONS: QuickReactionEmoji[] =
    ["👍", "❤️", "😂", "😮", "😢", "🙏"].map(quickReactionEmoji);

/* ========== sourcing the row from the user's own emoji ==========
 * Discord's own quick-reaction row is favourites first, then whatever you
 * reach for most - so this pulls the same frecency-ranked pool ChannelPopup's
 * :emoji: autocomplete already draws from (EmojiStore.searchWithoutFetchingLatest),
 * then promotes anything the user has favourited to the front. */

// discord-types ships EmojiIntention as a compile-time-only const enum (no
// runtime module to import), so the value is hardcoded here the same way
// ChannelPopup.tsx hardcodes CHAT (3) for its own search call.
const EMOJI_INTENTION_REACTION = 0;

// A wider pool than we display, so favourites have candidates to be promoted
// from even when frecency alone wouldn't rank them in the final row.
const QUICK_REACTION_POOL = 24;
// A context menu row, not a picker - six to nine reads as quick, not busy.
const QUICK_REACTION_COUNT = 8;

/** Search results carry unicode emoji as { name: "thumbsup", surrogates: "👍" }
 *  and custom emoji as { id, name, animated }. reactToMessage's URL builder
 *  needs `name` to already BE the printable character for the unicode case
 *  (there's no id to key off), so this is where that gets straightened out -
 *  get it backwards and unicode quick-reactions silently react with the
 *  wrong thing. */
function toQuickReactionEmoji(emoji: any): QuickReactionEmoji | null {
    if (emoji.id) return { id: emoji.id, name: emoji.name, animated: !!emoji.animated };
    if (!emoji.surrogates) return null;
    return { id: undefined, name: emoji.surrogates, animated: false };
}

function quickReactionPool(channel: any): QuickReactionEmoji[] {
    try {
        const results = EmojiStore.searchWithoutFetchingLatest({
            channel,
            query: "",
            count: QUICK_REACTION_POOL,
            intention: EMOJI_INTENTION_REACTION as any
        });
        const unlocked: any[] = results?.unlocked ?? [];
        if (unlocked.length === 0) return [];

        // A missing/throwing favourites lookup should only cost us the
        // favourites boost, not the whole pool we already have in hand.
        let emojiContext: any = null;
        try {
            emojiContext = EmojiStore.getDisambiguatedEmojiContext(channel.getGuildId?.() ?? null);
        } catch {
            emojiContext = null;
        }
        const isFavorite = (emoji: any) => {
            if (!emojiContext) return false;
            try {
                return !!emojiContext.isFavoriteEmojiWithoutFetchingLatest?.(emoji);
            } catch {
                return false;
            }
        };

        const ranked = [...unlocked].sort((a, b) => Number(isFavorite(b)) - Number(isFavorite(a)));

        const picked: QuickReactionEmoji[] = [];
        for (const emoji of ranked) {
            const converted = toQuickReactionEmoji(emoji);
            if (converted) picked.push(converted);
            if (picked.length >= QUICK_REACTION_COUNT) break;
        }
        return picked;
    } catch (e) {
        logger.error("Failed to load quick reaction emoji", e);
        return [];
    }
}

function getQuickReactions(channel: any): QuickReactionEmoji[] {
    const fromStore = quickReactionPool(channel);
    return fromStore.length > 0 ? fromStore : FALLBACK_REACTIONS;
}

async function reactToMessage(channel: any, message: any, emoji: { id?: string; name: string; animated?: boolean; }) {
    try {
        const alreadyReacted = typeof message.userHasReactedWithEmoji === "function"
            && message.userHasReactedWithEmoji(emoji);
        const emojiPath = emoji.id ? `${emoji.name}:${emoji.id}` : encodeURIComponent(emoji.name);
        const url = `/channels/${channel.id}/messages/${message.id}/reactions/${emojiPath}/@me`;
        if (alreadyReacted) {
            await RestAPI.del({ url });
        } else {
            await RestAPI.put({ url });
        }
    } catch (e) {
        logger.error("Failed to react to message", e);
        showToast("Couldn't add that reaction.", Toasts.Type.FAILURE);
    }
}

function MessageMenu({ channel, message, isOwn, onEdit }: { channel: any; message: any; isOwn: boolean; onEdit: () => void; }) {
    const hasText = typeof message.content === "string" && message.content.length > 0;
    // Same rule the composer uses elsewhere in the popup: no guild means a DM,
    // which carries no permission restrictions at all.
    const canReact = channel.getGuildId() == null || PermissionStore.can(PermissionsBits.ADD_REACTIONS, channel);
    // Only worth asking the store when the row can actually be used.
    const quickReactions = canReact ? getQuickReactions(channel) : FALLBACK_REACTIONS;

    return (
        <Menu.Menu navId="vc-glance-message-menu" onClose={ContextMenuApi.closeContextMenu} aria-label="Message options">
            {canReact && (
                <Menu.MenuControlItem
                    id="vc-glance-msg-react"
                    label="React"
                    control={(props, ref) => (
                        <div className="vc-glance-quick-reactions" ref={ref} {...props}>
                            {quickReactions.map(emoji => {
                                const active = typeof message.userHasReactedWithEmoji === "function"
                                    && message.userHasReactedWithEmoji(emoji);
                                // Unicode: name IS the printable character. Custom: a
                                // real emoji name, so the screen reader gets that
                                // instead of nothing ("image").
                                const accessibleName = emoji.id ? `:${emoji.name}:` : emoji.name;
                                return (
                                    <button
                                        key={emoji.id ?? emoji.name}
                                        type="button"
                                        className={"vc-glance-quick-reaction-btn" + (active ? " vc-glance-quick-reaction-active" : "")}
                                        aria-label={`React with ${accessibleName}`}
                                        aria-pressed={active}
                                        onClick={() => {
                                            reactToMessage(channel, message, emoji);
                                            ContextMenuApi.closeContextMenu();
                                        }}
                                    >
                                        {emoji.id
                                            ? (
                                                <img
                                                    className="vc-glance-quick-reaction-icon"
                                                    src={`https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=32`}
                                                    alt=""
                                                    draggable={false}
                                                />
                                            )
                                            : emoji.name}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                />
            )}
            <Menu.MenuItem id="vc-glance-msg-reply" label="Reply" action={() => startReply(channel, message)} />
            {isOwn && hasText && <Menu.MenuItem id="vc-glance-msg-edit" label="Edit Message" action={onEdit} />}
            {hasText && <Menu.MenuItem id="vc-glance-msg-copy" label="Copy Text" action={() => copyText(message.content)} />}
        </Menu.Menu>
    );
}

/** Our own inline editor - the native inline editor needs the full message-list
 *  context the popup doesn't provide, so we render a controlled box and save via
 *  Discord's editMessage action. Reliable, with a clear "editing" indicator. */
function MessageEditor({ channel, message, onDone }: { channel: any; message: any; onDone: () => void; }) {
    const [value, setValue] = React.useState<string>(message.content ?? "");
    const [saving, setSaving] = React.useState(false);
    const ref = React.useRef<HTMLTextAreaElement>(null);

    React.useEffect(() => {
        const el = ref.current;
        if (el) {
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
        }
    }, []);

    const save = async () => {
        if (saving) return;
        const content = value.trim();
        if (content === (message.content ?? "").trim()) { onDone(); return; }
        if (content.length === 0) { onDone(); return; }
        setSaving(true);
        try {
            await MsgActions.editMessage(channel.id, message.id, { content });
            onDone();
        } catch (e) {
            logger.error("Failed to edit message", e);
            setSaving(false);
        }
    };

    return (
        <div className="vc-glance-msg-edit">
            <div className="vc-glance-msg-edit-badge">Editing message</div>
            <textarea
                ref={ref}
                className="vc-glance-composer-input vc-glance-msg-edit-input"
                rows={1}
                value={value}
                disabled={saving}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => {
                    if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        onDone();
                    } else if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        save();
                    }
                }}
            />
            <div className="vc-glance-msg-edit-hint">
                escape to <button className="vc-glance-linkbtn" onClick={onDone}>cancel</button>
                {" • "}enter to <button className="vc-glance-linkbtn" onClick={save}>save</button>
            </div>
        </div>
    );
}

/**
 * Best-effort detection of a click on the reply-quote line Discord draws
 * above a reply. We don't control that markup (it's Discord's real
 * ChannelMessage), and its class names are hashed and change between
 * versions, so this leans on things that are much less likely to move:
 *  - "message-content-<id>" is a stable, unhashed element id Discord gives
 *    the message's own body (also relied on by Vencord's QuickReply plugin),
 *  - Discord marks its own non-native clickables with role="button",
 *  - the reply line always sits above that content in the DOM,
 *  - and it is a compact single-line row, unlike the full group-start avatar
 *    (also a role="button" ahead of the content id) which is much taller.
 * All four have to agree before anything happens. This was never verified
 * against a live client (no running Discord in this environment) - if
 * Discord's markup shifts enough to break it, the click just does nothing.
 */
function isReplyReferenceClick(wrapper: HTMLElement, target: HTMLElement, messageId: string): boolean {
    try {
        const button = target.closest('[role="button"]') as HTMLElement | null;
        if (!button || !wrapper.contains(button)) return false;

        const content = wrapper.querySelector<HTMLElement>(`#message-content-${messageId}`);
        if (content) {
            if (content === button || content.contains(button) || button.contains(content)) return false;
            const order = content.compareDocumentPosition(button);
            if (!(order & Node.DOCUMENT_POSITION_PRECEDING)) return false;
        }

        const rect = button.getBoundingClientRect();
        return rect.height > 0 && rect.height <= 28;
    } catch {
        return false;
    }
}

/** One native message row. Right-click for the menu, double-click to reply (or
 *  edit your own). Continuation rows get a class the CSS uses to hide the
 *  repeated avatar/name so same-author bursts read as one block. */
/**
 * One rendered message. Memoised because the row hosts Discord's real
 * ChannelMessage component, which is expensive, and the popup re-renders on
 * every MessageStore emission. Without this, one incoming message re-rendered
 * every message on screen, which is what made scrolling feel like it was
 * running at half framerate.
 *
 * onEdit/onReplyClick take the id rather than being pre-bound per row, so the
 * parent can pass one stable function instead of minting a new closure per
 * message. A new closure every render would defeat the memo entirely.
 */
function MessageRowBase({ message, channel, groupId, compact, isOwn, isContinuation, isEditing, onEdit, onStopEdit, onReplyClick }: {
    message: any; channel: any; groupId: string; compact: boolean; isOwn: boolean;
    isContinuation: boolean; isEditing: boolean; onEdit: (id: string) => void; onStopEdit: () => void;
    onReplyClick: (channelId: string, messageId: string) => void;
}) {
    const rowId = `vc-glance-msgrow-${message.id}`;

    if (isEditing) {
        return (
            <div id={rowId} className="vc-glance-native-msg vc-glance-msg-editing">
                <MessageEditor channel={channel} message={message} onDone={onStopEdit} />
            </div>
        );
    }

    const startEdit = () => onEdit(message.id);

    const openMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        ContextMenuApi.openContextMenu(e, () => (
            <MessageMenu channel={channel} message={message} isOwn={isOwn} onEdit={startEdit} />
        ));
    };

    const canEditOwn = isOwn && typeof message.content === "string" && message.content.length > 0;

    // Reply lines only exist on messages that have one - gating on that first
    // keeps this from ever running (and mis-hitting the group-start avatar's
    // own role="button") on the vast majority of rows that aren't replies.
    const onWrapperClick = !message.messageReference ? undefined : (e: React.MouseEvent<HTMLDivElement>) => {
        if (isReplyReferenceClick(e.currentTarget, e.target as HTMLElement, message.id)) {
            onReplyClick(message.messageReference.channel_id, message.messageReference.message_id);
        }
    };

    return (
        <div
            id={rowId}
            className={"vc-glance-native-msg " + (SearchResultClasses.message ?? "")
                + (isContinuation ? " vc-glance-msg-cont" : " vc-glance-msg-start")}
            onClick={onWrapperClick}
            onContextMenu={openMenu}
            onDoubleClick={() => (canEditOwn ? startEdit() : startReply(channel, message))}
        >
            <ChannelMessage
                id={`vc-glance-msg-${message.id}`}
                message={message}
                channel={channel}
                groupId={groupId}
                subscribeToComponentDispatch={true}
                compact={compact}
            />
        </div>
    );
}

/**
 * React here is a lazy webpack proxy. Calling React.memo at module scope runs
 * during bundle evaluation, before Discord's webpack exists, and throws in a
 * way that takes down every plugin at once. Building it on first use keeps the
 * memo without touching the proxy too early.
 */
let memoisedRow: React.ComponentType<React.ComponentProps<typeof MessageRowBase>> | null = null;
function getMessageRow() {
    memoisedRow ??= React.memo(MessageRowBase);
    return memoisedRow;
}

export function NativeMessageList({ messages, channel, editingId, firstUnreadId, onEdit, onStopEdit, onReplyClick }: {
    messages: any[]; channel: any; editingId: string | null; firstUnreadId: string | null;
    onEdit: (id: string) => void; onStopEdit: () => void;
    onReplyClick: (channelId: string, messageId: string) => void;
}) {
    const compact = MessageDisplayCompact.useSetting();
    const myId = UserStore.getCurrentUser()?.id;
    const Row = getMessageRow();

    // Walk the list assigning group ids: a new group starts on author change, a
    // >5min gap, a reply, or a non-standard (system) message.
    let groupId = "";
    let lastAuthorId: string | null = null;
    let lastTs = 0;

    const rows: React.ReactNode[] = [];
    for (const message of messages) {
        const ts = new Date(message.timestamp).getTime();
        const isPlainMessage = message.type === 0 || message.type === 19;
        const startsGroup =
            message.author?.id !== lastAuthorId
            || ts - lastTs > GROUP_WINDOW_MS
            || message.messageReference != null
            || !isPlainMessage;
        if (startsGroup) groupId = message.id;
        lastAuthorId = message.author?.id ?? null;
        lastTs = ts;

        // Same marker the real client draws at your last-read point
        if (message.id === firstUnreadId) {
            rows.push(
                <div key="vc-glance-new" className="vc-glance-new-divider" aria-label="New messages">
                    <span>NEW</span>
                </div>
            );
        }

        rows.push(
            <Row
                key={message.id}
                message={message}
                channel={channel}
                groupId={groupId}
                compact={compact}
                isOwn={message.author?.id === myId}
                isContinuation={!startsGroup && message.id !== firstUnreadId}
                isEditing={editingId === message.id}
                onEdit={onEdit}
                onStopEdit={onStopEdit}
                onReplyClick={onReplyClick}
            />
        );
    }
    return <>{rows}</>;
}

/** "Replying to X" bar shown above the composer, driven by PendingReplyStore so
 *  it stays in sync with Discord (created by our Reply action, cleared on send). */
export function ReplyBar({ channelId }: { channelId: string; }) {
    const reply = useStateFromStores([PendingReplyStore], () => PendingReplyStore.getPendingReply(channelId), [channelId]);
    if (!reply?.message) return null;
    const { author } = reply.message;
    const name = author?.globalName || author?.username || "message";
    return (
        <div className="vc-glance-reply-bar">
            <span className="vc-glance-reply-bar-text">Replying to <strong>{name}</strong></span>
            <button
                className="vc-glance-icon-button vc-glance-reply-bar-cancel"
                aria-label="Cancel reply"
                onClick={() => cancelReply(channelId)}
            >
                ✕
            </button>
        </div>
    );
}

/* ========== fallback (plain) message rendering ========== */

function formatTimestamp(timestamp: unknown) {
    try {
        return moment(timestamp as string).calendar();
    } catch {
        return "";
    }
}

const IMAGE_HOSTS = ["https://cdn.discordapp.com/", "https://media.discordapp.net/"];

function MessageAttachments({ attachments }: { attachments: any[]; }) {
    if (!Array.isArray(attachments) || attachments.length === 0) return null;

    return (
        <div className="vc-glance-msg-attachments">
            {attachments.slice(0, 4).map((attachment, i) => {
                const url: unknown = attachment?.proxy_url ?? attachment?.url;
                const isImage = typeof attachment?.content_type === "string"
                    && attachment.content_type.startsWith("image/")
                    && typeof url === "string"
                    && IMAGE_HOSTS.some(host => url.startsWith(host));

                return isImage
                    ? <img key={i} className="vc-glance-msg-image" src={url as string} alt="" />
                    : <span key={i} className="vc-glance-msg-file">📎 {String(attachment?.filename ?? "attachment")}</span>;
            })}
        </div>
    );
}

function PlainMessageItem({ message, showHeader }: { message: any; showHeader: boolean; }) {
    const { author } = message;
    const name = author?.globalName || author?.username || "Unknown";

    return (
        <div className={"vc-glance-msg" + (showHeader ? " vc-glance-msg-grouped" : "")}>
            {showHeader && (
                <div className="vc-glance-msg-header">
                    <img
                        className="vc-glance-msg-avatar"
                        src={author?.getAvatarURL?.(void 0, 40, false)}
                        alt=""
                        draggable={false}
                    />
                    <span className="vc-glance-msg-author">{name}</span>
                    <span className="vc-glance-msg-time">{formatTimestamp(message.timestamp)}</span>
                </div>
            )}
            <div className="vc-glance-msg-content">
                {message.content
                    ? Parser.parse(message.content, true, { channelId: message.channel_id })
                    : null}
                <MessageAttachments attachments={message.attachments} />
            </div>
        </div>
    );
}

export function PlainMessageList({ messages }: { messages: any[]; }) {
    let lastAuthorId: string | null = null;
    let lastTimestamp = 0;

    return (
        <>
            {messages.map((message: any) => {
                const ts = new Date(message.timestamp).getTime();
                const showHeader = message.author?.id !== lastAuthorId || ts - lastTimestamp > GROUP_WINDOW_MS;
                lastAuthorId = message.author?.id ?? null;
                lastTimestamp = ts;
                return <PlainMessageItem key={message.id} message={message} showHeader={showHeader} />;
            })}
        </>
    );
}
