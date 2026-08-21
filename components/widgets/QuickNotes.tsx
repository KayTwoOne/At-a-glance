/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, Tooltip } from "@webpack/common";

import { getConfig, setNotes } from "../../data";
import { WidgetCard } from "../WidgetCard";

/* Quick Notes understands a little plain-text structure - enough for lists and
   todos without becoming a markdown editor:
     - [ ] task   -> checkbox, clickable in view mode
     - item       -> bullet
     ---          -> divider
   Everything is stored as the raw text, so notes stay portable and greppable. */

const CHECKBOX_LINE = /^(\s*)- \[([ xX])\] ?(.*)$/;
const BULLET_LINE = /^(\s*)- (.*)$/;

function NoteLine({ line, index, onToggle }: { line: string; index: number; onToggle: (index: number) => void; }) {
    const checkbox = CHECKBOX_LINE.exec(line);
    if (checkbox) {
        const done = checkbox[2] !== " ";
        return (
            <label className={"vc-glance-note-check" + (done ? " vc-glance-note-done" : "")}>
                <input type="checkbox" checked={done} onChange={() => onToggle(index)} />
                <span>{checkbox[3]}</span>
            </label>
        );
    }
    if (/^\s*---+\s*$/.test(line)) return <hr className="vc-glance-note-divider" />;
    const bullet = BULLET_LINE.exec(line);
    if (bullet) return <div className="vc-glance-note-bullet">{bullet[2]}</div>;
    if (line.trim() === "") return <div className="vc-glance-note-gap" />;
    return <div className="vc-glance-note-text">{line}</div>;
}

export function NotesCard() {
    // setNotes deliberately doesn't emit (typing shouldn't rerender the world),
    // so this card manages its own refresh and reads the config directly.
    const [, refresh] = React.useReducer(x => x + 1, 0);
    const [editing, setEditing] = React.useState(() => getConfig().notes.trim().length === 0);
    const inputRef = React.useRef<HTMLTextAreaElement>(null);
    const { notes } = getConfig();

    /** Prefixes the line under the cursor (or inserts a block) in the editor */
    const insertAtLine = (prefix: string, block = false) => {
        const el = inputRef.current;
        if (!el) return;
        const pos = el.selectionStart ?? el.value.length;
        if (block) {
            const insertion = (pos > 0 && el.value[pos - 1] !== "\n" ? "\n" : "") + prefix + "\n";
            el.value = el.value.slice(0, pos) + insertion + el.value.slice(pos);
            el.setSelectionRange(pos + insertion.length, pos + insertion.length);
        } else {
            const lineStart = el.value.lastIndexOf("\n", pos - 1) + 1;
            el.value = el.value.slice(0, lineStart) + prefix + el.value.slice(lineStart);
            el.setSelectionRange(pos + prefix.length, pos + prefix.length);
        }
        el.focus();
        setNotes(el.value);
    };

    const toggleCheckbox = (lineIndex: number) => {
        const lines = getConfig().notes.split("\n");
        const match = CHECKBOX_LINE.exec(lines[lineIndex] ?? "");
        if (!match) return;
        const flipped = match[2] === " " ? "x" : " ";
        lines[lineIndex] = `${match[1]}- [${flipped}] ${match[3]}`;
        setNotes(lines.join("\n"));
        refresh();
    };

    return (
        <>
            <div className="vc-glance-notes-head">
                <div className="vc-glance-notes-tools">
                    {editing && (
                        <>
                            <Tooltip text="Bullet">
                                {props => (
                                    <button {...props} className="vc-glance-note-tool" onClick={() => insertAtLine("- ")}>•</button>
                                )}
                            </Tooltip>
                            <Tooltip text="Checkbox">
                                {props => (
                                    <button {...props} className="vc-glance-note-tool" onClick={() => insertAtLine("- [ ] ")}>☑</button>
                                )}
                            </Tooltip>
                            <Tooltip text="Divider">
                                {props => (
                                    <button {...props} className="vc-glance-note-tool" onClick={() => insertAtLine("---", true)}>-</button>
                                )}
                            </Tooltip>
                        </>
                    )}
                    <Tooltip text={editing ? "Done" : "Edit"}>
                        {props => (
                            <button
                                {...props}
                                className="vc-glance-note-tool vc-glance-note-mode"
                                onClick={() => { setEditing(e => !e); refresh(); }}
                            >
                                {editing ? "✓" : "✎"}
                            </button>
                        )}
                    </Tooltip>
                </div>
            </div>

            {editing
                ? (
                    <textarea
                        ref={inputRef}
                        className="vc-glance-notes"
                        defaultValue={notes}
                        maxLength={20000}
                        placeholder={"Quick notes…\n- bullets\n- [ ] todos\n--- dividers"}
                        spellCheck={false}
                        onChange={e => setNotes(e.target.value)}
                    />
                )
                : (
                    <div
                        className="vc-glance-notes-view"
                        role="button"
                        tabIndex={0}
                        onDoubleClick={() => setEditing(true)}
                    >
                        {notes.trim().length === 0
                            ? <span className="vc-glance-hint">Nothing noted - hit ✎ to write.</span>
                            : notes.split("\n").map((line, i) => (
                                <NoteLine key={i} line={line} index={i} onToggle={toggleCheckbox} />
                            ))
                        }
                    </div>
                )
            }
        </>
    );
}

export function QuickNotesWidget() {
    return (
        <WidgetCard id="quick-notes">
            <NotesCard />
        </WidgetCard>
    );
}
