/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ContextMenuApi, Menu, moment, React, Tooltip } from "@webpack/common";

import {
    addReminder,
    GlanceReminder,
    removeReminder,
    snoozeReminder as snoozeLocalReminder,
    triggeredReminderCount,
    useGlanceConfig
} from "../../data";
import {
    attentionTotal,
    nativeDueMs,
    nativeReminderItems,
    parseDurationMs,
    REMINDER_FILTERS,
    reminderCounts,
    reminderEmptyCopy,
    type ReminderFilter,
    selectReminders,
    showReminderFilter,
    snoozeLengthMs
} from "../../reminderView";
import { dueChip, entryKey, mergeReminders, type SavedEntry } from "../../savedRows";
import { Dropdown } from "../Dropdown";
import { useNow } from "../hooks";
import { CheckIcon, CloseIcon } from "../icons";
import { nativeSavesAvailable, removeSaved, SavedMessagesStore, snoozeReminder, useNativeReminders } from "../nativeSaves";
import { openPrompt } from "../PromptModal";
import { glanceToast } from "../toast";
import { WidgetCard } from "../WidgetCard";
import { NotePencilIcon, SavedMessageRow, usePendingWrite } from "./SavedMessageRow";

const DUE_PRESETS: Array<{ label: string; value: string; }> = [
    { label: "No timer", value: "none" },
    { label: "In 5 minutes", value: "300000" },
    { label: "In 15 minutes", value: "900000" },
    { label: "In 30 minutes", value: "1800000" },
    { label: "In 1 hour", value: "3600000" },
    { label: "In 3 hours", value: "10800000" },
    { label: "Tomorrow 09:00", value: "tomorrow9" },
    { label: "Custom duration…", value: "custom" }
];

function resolveDue(preset: string, customValue: string): number | null {
    if (preset === "none") return null;
    if (preset === "tomorrow9") {
        const date = new Date();
        date.setDate(date.getDate() + 1);
        date.setHours(9, 0, 0, 0);
        return date.getTime();
    }
    if (preset === "custom") {
        const ms = parseDurationMs(customValue);
        return ms !== null ? Date.now() + ms : null;
    }
    const ms = Number(preset);
    return Number.isFinite(ms) ? Date.now() + ms : null;
}

/** Relative time that never throws even if moment is unavailable */
function safeFromNow(ts: number): string {
    try {
        return moment(ts).fromNow();
    } catch {
        const diffMin = Math.round((ts - Date.now()) / 60000);
        if (diffMin === 0) return "now";
        return diffMin > 0 ? `in ${diffMin}m` : `${-diffMin}m ago`;
    }
}

/* ---- The add form: text notes, with or without a timer ---- */

function useReminderForm() {
    const [text, setText] = React.useState("");
    const [preset, setPreset] = React.useState("none");
    const [customValue, setCustomValue] = React.useState("");

    const customInvalid = preset === "custom" && parseDurationMs(customValue) === null;

    const submit = () => {
        const trimmed = text.trim();
        if (!trimmed || customInvalid) return;
        addReminder(trimmed, resolveDue(preset, customValue));
        setText("");
    };

    return { text, setText, preset, setPreset, customValue, setCustomValue, customInvalid, submit };
}

type ReminderFormState = ReturnType<typeof useReminderForm>;

function ReminderForm({ text, setText, preset, setPreset, customValue, setCustomValue, customInvalid, submit }: ReminderFormState) {
    return (
        <div className="vc-glance-reminder-form">
            <input
                className="vc-glance-input"
                type="text"
                maxLength={200}
                placeholder="Remind me to…"
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") submit(); }}
            />
            <div className="vc-glance-reminder-form-row">
                <Dropdown
                    className="vc-glance-reminder-select"
                    options={DUE_PRESETS}
                    value={preset}
                    onChange={setPreset}
                    ariaLabel="Reminder timer"
                />
                {preset === "custom" && (
                    <input
                        className={"vc-glance-input vc-glance-reminder-custom" + (customInvalid && customValue ? " vc-glance-input-error" : "")}
                        type="text"
                        inputMode="numeric"
                        placeholder="HH:MM:SS"
                        maxLength={11}
                        value={customValue}
                        onChange={e => setCustomValue(e.target.value.replace(/[^\d:]/g, ""))}
                        onKeyDown={e => { if (e.key === "Enter") submit(); }}
                        aria-label="Custom duration, hours minutes seconds"
                    />
                )}
                <button
                    className="vc-glance-button vc-glance-button-brand"
                    disabled={text.trim().length === 0 || customInvalid}
                    onClick={submit}
                >
                    Add
                </button>
            </div>
            {preset === "custom" && (
                <span className="vc-glance-hint">
                    Countdown from now - e.g. <strong>00:15:00</strong> (15 min), <strong>1:30:00</strong> (1½ h), <strong>90:00</strong> (90 min).
                </span>
            )}
        </div>
    );
}

/* ---- The person's own text reminders ---- */

/** When a reminder is due: red once overdue, the accent when it is close, quiet when far off */
function DueChip({ dueAt, now }: { dueAt: number; now: number; }) {
    const chip = dueChip(dueAt, now);
    return <span className={"vc-glance-due vc-glance-due-" + chip.tone}>{chip.label}</span>;
}

/**
 * `merged` is true when the row sits among Discord's reminders: it then says it
 * is the person's own note, and shows the same due label the others do. Without
 * Discord's reminders it is the row it has always been.
 */
function ReminderRow({ reminder, now, merged }: { reminder: GlanceReminder; now: number; merged: boolean; }) {
    const triggered = reminder.dueAt !== null && reminder.dueAt <= now;
    // The tint is the old row's way of saying "fired". Among Discord's reminders
    // the red OVERDUE label says it, as it does on theirs, so the row stays plain.
    const tinted = triggered && !merged;

    return (
        <div className={"vc-glance-row vc-glance-reminder-row" + (merged ? " vc-glance-reminder-note-row" : "") + (tinted ? " vc-glance-reminder-triggered" : "")}>
            {merged && (
                <div className="vc-glance-bookmark-thumb vc-glance-bookmark-thumb-fallback vc-glance-reminder-note-icon">
                    <NotePencilIcon size={14} />
                </div>
            )}
            <div className="vc-glance-row-text">
                <span className="vc-glance-row-title">{reminder.text}</span>
                <span className="vc-glance-row-subtitle">
                    {merged
                        ? "Your note · At a glance only"
                        : reminder.dueAt === null
                            ? "No timer"
                            : triggered
                                ? `Due ${safeFromNow(reminder.dueAt)}`
                                : `Fires ${safeFromNow(reminder.dueAt)}`}
                </span>
            </div>
            {merged && reminder.dueAt !== null && <DueChip dueAt={reminder.dueAt} now={now} />}
            <div className="vc-glance-row-actions">
                {triggered && (
                    <Tooltip text="Snooze 15 minutes">
                        {props => (
                            <button
                                {...props}
                                className="vc-glance-link-button"
                                onClick={() => snoozeLocalReminder(reminder.id, 15 * 60 * 1000)}
                            >
                                Snooze
                            </button>
                        )}
                    </Tooltip>
                )}
                <Tooltip text="Done">
                    {props => (
                        <button
                            {...props}
                            className="vc-glance-icon-button vc-glance-reminder-done"
                            onClick={() => removeReminder(reminder.id)}
                        >
                            <CheckIcon size={15} />
                        </button>
                    )}
                </Tooltip>
                <Tooltip text="Delete">
                    {props => (
                        <button
                            {...props}
                            className="vc-glance-icon-button"
                            onClick={() => removeReminder(reminder.id)}
                        >
                            <CloseIcon size={14} />
                        </button>
                    )}
                </Tooltip>
            </div>
        </div>
    );
}

/** Discord's own reminders are not available: the widget is the list of text notes, as it always was */
function LocalRemindersWidget({ form }: { form: ReminderFormState; }) {
    const { reminders } = useGlanceConfig();
    // Tick fast enough that "fires in 1m" flipping to triggered feels immediate
    const now = useNow(15_000);

    const triggered = triggeredReminderCount(now);

    const sorted = [...reminders].sort((a, b) => {
        const aDue = a.dueAt ?? Number.MAX_SAFE_INTEGER;
        const bDue = b.dueAt ?? Number.MAX_SAFE_INTEGER;
        return aDue - bDue;
    });

    return (
        <WidgetCard id="reminders" attention={triggered}>
            <div className="vc-glance-stack">
                <ReminderForm {...form} />

                {sorted.length === 0
                    ? <div className="vc-glance-empty">Nothing to remember (yet). Add one above - timed reminders light this card up when they fire.</div>
                    : (
                        <div className="vc-glance-row-list">
                            {sorted.map(reminder => (
                                <ReminderRow key={reminder.id} reminder={reminder} now={now} merged={false} />
                            ))}
                        </div>
                    )
                }
            </div>
        </WidgetCard>
    );
}

/* ---- Discord's message reminders ---- */

// The add form's choices, less "No timer": a reminder that is already there
// has to be put off to some time, and no time would turn it into a bookmark
const SNOOZE_CHOICES = DUE_PRESETS.filter(choice => choice.value !== "none");

// Stroked in the mockup's drawing: a clock face with its cap
function SnoozeIcon() {
    return (
        <svg
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
            <circle cx="8" cy="9" r="4.6" />
            <path d="M8 6.8V9l1.4 1M6.4 2.5h3.2" />
        </svg>
    );
}

function askSnoozeLength(then: (ms: number) => void) {
    openPrompt({
        title: "Snooze for how long?",
        placeholder: "HH:MM:SS, e.g. 00:15:00, 1:30:00 or 90:00",
        maxLength: 11,
        onSubmit: value => {
            // A minute at least: "30" would otherwise snooze for half a minute
            const ms = snoozeLengthMs(value);
            if (ms === null) glanceToast("That isn't a length of time. Try 00:15:00 for 15 minutes.", "failure");
            else then(ms);
        }
    });
}

// Whether Discord still holds this message as a reminder. Read when the write
// is about to go, not when the row drew: a snooze saves the message again, so
// one sent after the reminder has gone (marked done on another device while the
// menu or the prompt was open) would bring it back. A store that cannot answer
// counts as "no", and nothing is sent.
function stillAReminder(entry: SavedEntry): boolean {
    try {
        return SavedMessagesStore.isMessageReminder(entry.saveData.channelId, entry.saveData.messageId) === true;
    } catch {
        return false;
    }
}

function SnoozeMenu({ snooze }: { snooze: (ms: number) => void; }) {
    const pick = (value: string) => {
        if (value === "custom") {
            askSnoozeLength(snooze);
            return;
        }
        const due = resolveDue(value, "");
        if (due !== null) snooze(due - Date.now());
    };

    return (
        <Menu.Menu
            navId="vc-glance-snooze-menu"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Snooze for"
        >
            {SNOOZE_CHOICES.map(choice => (
                <Menu.MenuItem
                    key={choice.value}
                    id={`vc-glance-snooze-${choice.value}`}
                    label={choice.label}
                    action={() => pick(choice.value)}
                />
            ))}
        </Menu.Menu>
    );
}

function NativeReminderRow({ entry, now }: { entry: SavedEntry; now: number; }) {
    const dueMs = nativeDueMs(entry.saveData.dueAt);
    const { pending, run, settle } = usePendingWrite();
    const [acting, setActing] = React.useState<"done" | "snooze" | null>(null);

    // A snoozed reminder gets a new due time when Discord's echo arrives
    React.useEffect(() => {
        settle();
    }, [dueMs]);

    // Nothing changes on the click: the row goes (Done) or moves and takes its
    // new label (Snooze) when Discord's echo arrives. A failure is logged by the
    // bridge; the row only has to say so and come back.
    const markDone = () => {
        setActing("done");
        void run(() => removeSaved(entry), "Couldn't mark the reminder done.");
    };
    const snoozeFor = (ms: number) => {
        if (!stillAReminder(entry)) return;
        setActing("snooze");
        void run(() => snoozeReminder(entry, ms), "Couldn't snooze the reminder.");
    };

    const doneLabel = pending && acting === "done" ? "Marking done" : "Done";
    const snoozeLabel = pending && acting === "snooze" ? "Snoozing" : "Snooze";

    return (
        <SavedMessageRow
            entry={entry}
            dimmed={pending}
            meta={<DueChip dueAt={dueMs ?? Number.NaN} now={now} />}
            actions={(
                <>
                    <Tooltip text={doneLabel}>
                        {props => (
                            <button
                                {...props}
                                className="vc-glance-icon-button vc-glance-reminder-done"
                                aria-label={doneLabel}
                                disabled={pending}
                                onClick={markDone}
                            >
                                <CheckIcon size={15} />
                            </button>
                        )}
                    </Tooltip>
                    <Tooltip text={snoozeLabel}>
                        {props => (
                            <button
                                {...props}
                                className="vc-glance-icon-button"
                                aria-label={snoozeLabel}
                                aria-haspopup="menu"
                                disabled={pending}
                                onClick={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    ContextMenuApi.openContextMenu(e, () => <SnoozeMenu snooze={snoozeFor} />);
                                }}
                            >
                                <SnoozeIcon />
                            </button>
                        )}
                    </Tooltip>
                </>
            )}
        />
    );
}

/** All / Messages / Notes. Session only: it is not saved, and starts at All each time */
function ReminderFilterBar({ value, onChange }: { value: ReminderFilter; onChange: (filter: ReminderFilter) => void; }) {
    return (
        <div className="vc-glance-segmented vc-glance-reminder-filter" role="group" aria-label="Show reminders">
            {REMINDER_FILTERS.map(filter => (
                <button
                    key={filter.value}
                    className={"vc-glance-segment" + (value === filter.value ? " vc-glance-segment-active" : "")}
                    aria-pressed={value === filter.value}
                    onClick={() => onChange(filter.value)}
                >
                    {filter.label}
                </button>
            ))}
        </div>
    );
}

// Built when the widget draws, never at module scope: JSX made while the
// plugin loads would run before Discord's React is there to make it
function emptyCopy(filter: ReminderFilter): React.ReactNode {
    const { before, strong, after } = reminderEmptyCopy(filter);
    return (
        <>
            {before}
            {strong && <strong>{strong}</strong>}
            {after}
        </>
    );
}

/** Discord's message reminders beside the person's own text notes, earliest first */
function NativeRemindersWidget({ form }: { form: ReminderFormState; }) {
    const { reminders } = useGlanceConfig();
    const { entries, overdueCount } = useNativeReminders();
    // The clock only makes the widget draw again every 15 s. The time itself is
    // read at each draw, so a change in Discord's store (a snooze, a reminder
    // that has come due) updates the labels at once rather than at the next tick.
    useNow(15_000);
    const now = Date.now();
    const [filter, setFilter] = React.useState<ReminderFilter>("all");

    // Rebuilt every render: the plugin's own list is changed in place, so
    // nothing here can tell by identity that it moved. Discord's array is only
    // read, never sorted or changed.
    const merged = mergeReminders(
        nativeReminderItems(entries),
        reminders.map(reminder => ({ dueAt: reminder.dueAt, item: reminder }))
    );
    const counts = reminderCounts(merged);
    const shown = selectReminders(merged, filter);

    const attention = attentionTotal(triggeredReminderCount(now), overdueCount);

    return (
        <WidgetCard
            id="reminders"
            attention={attention}
            summary={attention > 0 ? `${attention} overdue` : undefined}
        >
            <div className="vc-glance-stack">
                <ReminderForm {...form} />

                {showReminderFilter(counts, filter) && <ReminderFilterBar value={filter} onChange={setFilter} />}

                {shown.length === 0
                    ? <div className="vc-glance-empty">{emptyCopy(filter)}</div>
                    : (
                        <div className="vc-glance-row-list">
                            {shown.map(row => row.kind === "native"
                                ? <NativeReminderRow key={"n-" + entryKey(row.item)} entry={row.item} now={now} />
                                : <ReminderRow key={"l-" + row.item.id} reminder={row.item} now={now} merged />
                            )}
                        </div>
                    )
                }
            </div>
        </WidgetCard>
    );
}

export function RemindersWidget() {
    // Held here, above the choice, so what was typed in the add form survives
    // the widget changing from one body to the other
    const form = useReminderForm();

    // Two components rather than one with a conditional hook: the native one
    // subscribes to Discord's store and may only render when it exists
    return nativeSavesAvailable() ? <NativeRemindersWidget form={form} /> : <LocalRemindersWidget form={form} />;
}
