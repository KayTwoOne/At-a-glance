/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PlayIcon, StopIcon } from "../icons";
import { OrionTask, useOrion } from "../orionBridge";
import { glanceToast } from "../toast";
import { WidgetCard } from "../WidgetCard";

/** COMPLETED/CLAIMED read as done, QUEUE/RUNNING as active, anything else neutral */
function statusTone(status: string): string {
    const s = status.toUpperCase();
    if (s === "COMPLETED" || s === "CLAIMED") return "vc-glance-orion-task-done";
    if (s === "RUNNING" || s === "QUEUE") return "vc-glance-orion-task-active";
    return "";
}

function isActive(status: string): boolean {
    const s = status.toUpperCase();
    return s !== "COMPLETED" && s !== "CLAIMED";
}

function TaskRow({ task }: { task: OrionTask; }) {
    const pct = task.max > 0 ? Math.min(100, (task.cur / task.max) * 100) : 0;
    return (
        <div className={"vc-glance-orion-task " + statusTone(task.status)}>
            <div className="vc-glance-orion-task-head">
                <span className="vc-glance-orion-task-name" title={task.name}>{task.name}</span>
                <span className="vc-glance-orion-task-status">{task.status || "…"}</span>
            </div>
            <div className="vc-glance-orion-track">
                <div className="vc-glance-orion-fill" style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

export function OrionWidget() {
    const orion = useOrion();

    // Not installed / disabled - a calm prompt, never an error.
    if (orion.status === "absent") {
        return (
            <WidgetCard id="orion">
                <div className="vc-glance-empty">
                    OrionQuests isn't loaded. Install and enable the <strong>OrionQuests</strong> plugin
                    (see the setup guide), then control it from here.
                </div>
            </WidgetCard>
        );
    }

    // Present but speaks a contract this build doesn't - tell the user plainly.
    if (orion.status === "incompatible") {
        return (
            <WidgetCard id="orion">
                <div className="vc-glance-empty">
                    A different version of OrionQuests is loaded than this widget expects. Update both
                    to matching versions to control it from here.
                </div>
            </WidgetCard>
        );
    }

    const { running, tasks } = orion;
    const activeCount = tasks.filter(t => isActive(t.status)).length;

    const stateLabel = running ? "Running" : tasks.length > 0 ? "Stopped" : "Idle";
    const stateClass = running
        ? "vc-glance-orion-state-running"
        : tasks.length > 0
            ? "vc-glance-orion-state-stopped"
            : "vc-glance-orion-state-idle";

    const start = async () => {
        if (!(await orion.start())) glanceToast("Orion couldn't start.", "failure");
    };

    const stop = () => {
        if (!orion.stop()) glanceToast("Orion couldn't stop.", "failure");
    };

    const status = () => {
        const summary = orion.summary();
        glanceToast(summary ?? "Orion status is unavailable.", summary ? "message" : "failure");
    };

    return (
        <WidgetCard id="orion" attention={running ? activeCount : 0}>
            <div className="vc-glance-stack">
                <div className="vc-glance-orion-status">
                    <span className={"vc-glance-orion-pill " + stateClass}>
                        <span className="vc-glance-orion-dot" />
                        {stateLabel}
                    </span>
                    <span className="vc-glance-hint">
                        {tasks.length > 0
                            ? `${activeCount} active · ${tasks.length} tracked`
                            : "No active quests"}
                    </span>
                </div>

                <div className="vc-glance-orion-controls">
                    <button
                        className="vc-glance-button vc-glance-button-brand"
                        onClick={start}
                        disabled={running}
                    >
                        <PlayIcon size={14} />
                        Start
                    </button>
                    <button
                        className="vc-glance-button vc-glance-button-danger"
                        onClick={stop}
                        disabled={!running}
                    >
                        <StopIcon size={14} />
                        Stop
                    </button>
                    <button className="vc-glance-button vc-glance-orion-button-status" onClick={status}>
                        Status
                    </button>
                </div>

                {tasks.length > 0 && (
                    <div className="vc-glance-orion-tasks">
                        {tasks.map(task => <TaskRow key={task.id} task={task} />)}
                    </div>
                )}
            </div>
        </WidgetCard>
    );
}
