/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { moment, React, Tooltip, UserStore } from "@webpack/common";

import { getConfig, GlanceBookmark, isBookmarked, removeBookmark, useGlanceConfig } from "../../data";
import { type BookmarksFooter, bookmarksFooter, failureTitle, moveProgress, savedAgo } from "../../savedLabels";
import { guardAccount, type MoveGate, moveToDiscord, sameAccount } from "../../savedMove";
import { createMigrationQueue, entryKey, type MigrationState, type SavedEntry } from "../../savedRows";
import { openChannelPopup } from "../ChannelPopup";
import { ChatIcon, CloseIcon, ExternalIcon } from "../icons";
import {
    ensureBookmarksLoaded,
    loadMoreBookmarks,
    nativeSavesAvailable,
    removeSaved,
    SavedMessagesStore,
    saveLocalToDiscord,
    useNativeBookmarks
} from "../nativeSaves";
import { WidgetCard } from "../WidgetCard";
import { BookmarkIconThumb, jumpToSavedMessage, SavedMessageRow, usePendingWrite } from "./SavedMessageRow";

const logger = new Logger("AtAGlance");

/* ---- The local list (what At a glance saved itself) ---- */

interface BookmarkRowProps {
    bookmark: GlanceBookmark;
    /** The row sits under Discord's bookmarks, so its remove button says it only clears this list */
    underDiscord?: boolean;
    /** A move is under way, so nothing may be removed from under it */
    locked?: boolean;
}

function BookmarkRow({ bookmark, underDiscord = false, locked = false }: BookmarkRowProps) {
    const removeLabel = underDiscord ? "Remove from this list" : "Remove bookmark";

    return (
        <div
            className="vc-glance-row vc-glance-bookmark-row"
            role="button"
            tabIndex={0}
            aria-label={`Jump to saved message from ${bookmark.authorName}`}
            onClick={() => jumpToSavedMessage(bookmark)}
            onKeyDown={e => {
                // A key pressed on one of the row's own buttons belongs to that button
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    jumpToSavedMessage(bookmark);
                }
            }}
        >
            <BookmarkIconThumb guildId={bookmark.guildId} authorId={bookmark.authorId} />
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
                <Tooltip text={removeLabel}>
                    {props => (
                        <button
                            {...props}
                            className="vc-glance-icon-button"
                            aria-label={removeLabel}
                            disabled={locked}
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

/** Discord's bookmarks are not available: the widget is the local list, as it always was */
function LocalBookmarksWidget() {
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

/* ---- Discord's bookmarks ---- */

function SavedRow({ entry }: { entry: SavedEntry; }) {
    const { saveData } = entry;
    const { pending: removing, run } = usePendingWrite();
    const when = savedAgo(saveData.savedAt, Date.now());

    // The row leaves on Discord's echo of the removal, not on the click. A
    // failure is logged by removeSaved; the row only has to say so and come back.
    const remove = () => run(() => removeSaved(entry), "Couldn't remove the bookmark.");

    return (
        <SavedMessageRow
            entry={entry}
            dimmed={removing}
            meta={when && <span className="vc-glance-msg-time vc-glance-bookmark-when">{when}</span>}
            actions={(
                <>
                    <Tooltip text="Jump to message">
                        {props => (
                            <button
                                {...props}
                                className="vc-glance-icon-button"
                                aria-label="Jump to message"
                                onClick={() => jumpToSavedMessage(saveData)}
                            >
                                <ExternalIcon size={14} />
                            </button>
                        )}
                    </Tooltip>
                    <Tooltip text="Quick chat">
                        {props => (
                            <button
                                {...props}
                                className="vc-glance-icon-button"
                                aria-label="Quick chat"
                                onClick={() => openChannelPopup(saveData.channelId)}
                            >
                                <ChatIcon size={15} />
                            </button>
                        )}
                    </Tooltip>
                    <Tooltip text={removing ? "Removing" : "Remove bookmark"}>
                        {props => (
                            <button
                                {...props}
                                className="vc-glance-icon-button"
                                aria-label={removing ? "Removing" : "Remove bookmark"}
                                disabled={removing}
                                onClick={remove}
                            >
                                <CloseIcon size={14} />
                            </button>
                        )}
                    </Tooltip>
                </>
            )}
        />
    );
}

/* ---- Moving the old local saves across ---- */

interface MoveStatus {
    /** The account the move was started on. The status is forgotten once another account is signed in */
    account: string | null;
    /** "checking" while Discord's bookmarks load; "loading" and "unreachable" when it would not let a move start */
    gate: "idle" | "checking" | "loading" | "unreachable";
    /** The queue's latest state: null before a run, and again once its result is dismissed */
    queue: MigrationState | null;
}

const IDLE_MOVE: MoveStatus = { account: null, gate: "idle", queue: null };

// Lives at module level so a move carries on, and its result is still there,
// if At a glance is closed and opened again while it runs
let moveStatus: MoveStatus = IDLE_MOVE;
const moveListeners = new Set<() => void>();

const currentUserId = () => UserStore.getCurrentUser()?.id ?? null;

// The account the running (or last) move was started on. The queue's steps
// check it, and it is only ever set when a run starts, so clearing the status
// on an account switch cannot loosen a run that is still winding down.
let runAccount: string | null = null;

// A move belongs to the account it began on. Everything reads the status
// through here, so one account's result is never shown or acted on under another.
function currentMoveStatus(): MoveStatus {
    if (moveStatus.account !== null && !sameAccount(moveStatus.account, currentUserId())) moveStatus = IDLE_MOVE;
    return moveStatus;
}

function setMoveStatus(next: MoveStatus) {
    moveStatus = next;
    for (const listener of [...moveListeners]) listener();
}

function useMoveStatus(): MoveStatus {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const status = currentMoveStatus();
    const rendered = React.useRef(status);
    rendered.current = status;

    React.useEffect(() => {
        moveListeners.add(forceUpdate);
        // A change between this render and the subscription would otherwise be missed
        if (currentMoveStatus() !== rendered.current) forceUpdate();
        return () => void moveListeners.delete(forceUpdate);
    }, []);

    return status;
}

// A save is removed from the local list only once Discord has it. If the
// removal changed nothing (the plugin's data is not writable), the save counts
// as not moved rather than moved, and moving again finds Discord already holds
// it and tries the removal once more.
function removeLocalCopy(messageId: string) {
    removeBookmark(messageId);
    if (isBookmarked(messageId)) throw new Error("The old copy could not be removed");
}

// Each step refuses to run on an account other than the one the move began on
const guarded = guardAccount(() => runAccount, currentUserId, {
    save: saveLocalToDiscord,
    removeLocal: removeLocalCopy
});

// Three seconds between saves: an unhurried pace, like someone bookmarking by hand,
// so a long list never reaches Discord as a burst. 100 old saves take five minutes.
const MOVE_GAP_MS = 3000;

const migration = createMigrationQueue({
    save: guarded.save,
    removeLocal: guarded.removeLocal,
    wait: ms => new Promise<void>(resolve => setTimeout(resolve, ms)),
    onChange: queue => {
        // A run that began on another account has nowhere left to report
        if (!sameAccount(runAccount, currentUserId())) return;
        setMoveStatus({ ...currentMoveStatus(), queue });
    }
}, MOVE_GAP_MS);

// The queue's own state, not the status: after an account switch the status is
// forgotten while the old run is still winding down, and a new one must not start on top
const moveBusy = () => currentMoveStatus().gate === "checking" || migration.state().running;

function onMoveGate(gate: MoveGate, account: string | null) {
    const before = gate === "checking" ? IDLE_MOVE : currentMoveStatus();
    // "open" hands over to the queue, whose own state says the rest
    setMoveStatus({
        account,
        gate: gate === "open" ? "idle" : gate,
        queue: gate === "checking" ? null : before.queue
    });
}

function startMove() {
    const account = currentUserId();
    moveToDiscord({
        busy: moveBusy,
        ensureLoaded: ensureBookmarksLoaded,
        // All three are read here, after the bookmarks have loaded, never earlier
        fetchState: () => SavedMessagesStore.getBookmarksFetchState(),
        hasFetched: () => SavedMessagesStore.hasFetchedBookmarks(),
        isStale: () => SavedMessagesStore.getIsStale(),
        // The old list is the account's it was clicked on; if that has changed, there is none
        items: () => sameAccount(account, currentUserId()) ? getConfig().bookmarks : [],
        run: items => {
            runAccount = account;
            return migration.run(items);
        },
        onGate: gate => onMoveGate(gate, account)
    }).catch(error => logger.error("Moving old saves to Discord failed", error));
}

// Stroked like the mockup's folder: where the old saves were kept
function FolderIcon() {
    return (
        <svg
            className="vc-glance-legacy-icon"
            width={14}
            height={14}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
        >
            <path d="M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z" />
        </svg>
    );
}

/** The dashed row offering to move the old saves, and the old rows beneath it */
function LegacySaves({ footer }: { footer: BookmarksFooter; }) {
    const { bookmarks } = useGlanceConfig();
    const { gate, queue } = useMoveStatus();

    // A finished result is shown until the widget goes away, then forgotten
    React.useEffect(() => () => {
        if (!moveBusy()) setMoveStatus(IDLE_MOVE);
    }, []);

    const checking = gate === "checking";
    const running = queue?.running === true;
    const finished = queue !== null && !queue.running && queue.total > 0;
    if (bookmarks.length === 0 && !finished && !checking && !running) return null;

    let message: React.ReactNode;
    if (checking) message = "Checking with Discord";
    else if (queue && (running || finished)) message = moveProgress(queue);
    else if (gate === "unreachable") message = "Couldn't reach Discord. Try again.";
    else if (gate === "loading") message = "Still loading your bookmarks. Try again in a moment.";
    else {
        message = (
            <>
                <strong>{bookmarks.length === 1 ? "1 message" : `${bookmarks.length} messages`}</strong> you saved in At a glance before
            </>
        );
    }

    // After a run that left some behind, the button is the way to go again
    const retry = finished && (queue?.failed.length ?? 0) > 0;
    const button = checking || running
        ? "Moving"
        : retry ? "Try again" : "Move to Discord";

    // Nothing is sent until Discord's own bookmarks are on screen, and nothing
    // is changed under a run that is going
    const locked = checking || running;
    const waiting = footer === "loading" || footer === "failed";

    return (
        <>
            <div className="vc-glance-legacy">
                <FolderIcon />
                <span className="vc-glance-legacy-text" role="status" title={queue ? failureTitle(queue) : undefined}>{message}</span>
                {(bookmarks.length > 0 || locked) && (
                    <button
                        className="vc-glance-button vc-glance-button-brand vc-glance-legacy-go"
                        disabled={locked || waiting}
                        onClick={startMove}
                    >
                        {button}
                    </button>
                )}
            </div>
            {bookmarks.length > 0 && (
                <>
                    <div className="vc-glance-bookmark-subhead">Saved here before</div>
                    <div className="vc-glance-row-list">
                        {bookmarks.map(bookmark => (
                            <BookmarkRow key={bookmark.messageId} bookmark={bookmark} underDiscord locked={locked} />
                        ))}
                    </div>
                </>
            )}
        </>
    );
}

/** Discord's own bookmarks, live, with a way to move the old local saves across */
function NativeBookmarksWidget() {
    const { entries, count, fetchState, hasFetched } = useNativeBookmarks();
    const [pending, setPending] = React.useState(true);
    const [retrying, setRetrying] = React.useState(false);
    const mounted = React.useRef(true);

    React.useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    // Discord refreshes the lists itself after a connection, but not always
    // before this opens. The call never rejects, so the first look always ends.
    React.useEffect(() => {
        let current = true;
        const done = () => { if (current) setPending(false); };
        ensureBookmarksLoaded().then(done, done);
        return () => { current = false; };
    }, []);

    // A first load that failed asks for the first page again; a failed Load more
    // asks for the next page. Discord's loader skips what it does not need. The
    // footer says Loading until the request has come back.
    const tryAgain = () => {
        setRetrying(true);
        (hasFetched ? loadMoreBookmarks() : ensureBookmarksLoaded())
            .catch(() => { /* both log their own failures */ })
            .finally(() => { if (mounted.current) setRetrying(false); });
    };

    const footer = retrying
        ? "loading"
        : bookmarksFooter({ fetchState, hasFetched, pending, shown: entries.length });

    const summary = count > 0 ? `from Discord · ${count} saved` : "from Discord";

    return (
        <WidgetCard id="bookmarks" summary={summary}>
            {entries.length > 0 && (
                <div className="vc-glance-row-list">
                    {entries.map(entry => <SavedRow key={entryKey(entry)} entry={entry} />)}
                </div>
            )}

            {footer === "more" && (
                <button
                    className="vc-glance-row vc-glance-bookmark-more"
                    onClick={() => void loadMoreBookmarks()}
                >
                    Load 25 more
                </button>
            )}
            {footer === "loading" && <div className="vc-glance-bookmark-status" role="status">Loading</div>}
            {footer === "failed" && (
                <div className="vc-glance-bookmark-status">
                    <span>Couldn't load your bookmarks</span>
                    <button className="vc-glance-link-button" onClick={tryAgain}>Try again</button>
                </div>
            )}
            {footer === "empty" && (
                <div className="vc-glance-empty">
                    No bookmarks yet. Right-click a message and choose <strong>Bookmark Message</strong>.
                </div>
            )}

            <LegacySaves footer={footer} />
        </WidgetCard>
    );
}

export function BookmarksWidget() {
    // Two components rather than one with a conditional hook: the native one
    // subscribes to Discord's store and may only render when it exists
    return nativeSavesAvailable() ? <NativeBookmarksWidget /> : <LocalBookmarksWidget />;
}
