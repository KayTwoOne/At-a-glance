/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { findByPropsLazy } from "@webpack";
import {
    Constants,
    GuildScheduledEventStore,
    GuildStore,
    IconUtils,
    moment,
    React,
    RestAPI,
    Tooltip,
    useStateFromStores
} from "@webpack/common";

import { finders } from "../../discordChecks";
import { guildAcronym } from "../../util";
import { closeGlance } from "../GlanceLayer";
import { useNow } from "../hooks";
import { BellIcon, SpeakerIcon } from "../icons";
import { WidgetCard } from "../WidgetCard";

const logger = new Logger("AtAGlance");

const VoiceActions = findByPropsLazy(...finders.voiceActions.props) as {
    selectVoiceChannel(channelId: string): void;
};

// GuildScheduledEventStatus: 1 scheduled, 2 active, 3 completed, 4 canceled
const STATUS_ACTIVE = 2;
const MAX_EVENTS = 12;

function startTimeOf(event: any): number {
    const raw = event?.scheduledStartTime ?? event?.scheduled_start_time;
    const parsed = typeof raw === "number" ? raw : Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function countdownLabel(startsAt: number, now: number): string {
    const diff = startsAt - now;
    if (diff <= 0) return "starting…";
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `in ${Math.max(1, minutes)}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `in ${hours}h ${minutes % 60}m`;
    const days = Math.floor(hours / 24);
    return `in ${days}d ${hours % 24}h`;
}

const SNOWFLAKE_RE = /^\d{17,21}$/;

/** RSVP through the same endpoint the native event UI uses; the gateway echo
 *  (GUILD_SCHEDULED_EVENT_USER_ADD/REMOVE) updates the store in realtime */
async function setInterested(event: any, interested: boolean) {
    // Defense-in-depth: only ever build the URL from validated snowflakes
    if (!SNOWFLAKE_RE.test(String(event.guildId)) || !SNOWFLAKE_RE.test(String(event.id))) return;
    try {
        const url = Constants.Endpoints.USER_GUILD_EVENT?.(event.guildId, event.id, null)
            ?? `/guilds/${event.guildId}/scheduled-events/${event.id}/users/@me`;
        if (interested) await RestAPI.put({ url });
        else await RestAPI.del({ url });
    } catch (e) {
        logger.error("Failed to update event RSVP", e);
    }
}

function EventRow({ event, now }: { event: any; now: number; }) {
    const startsAt = startTimeOf(event);
    const live = event.status === STATUS_ACTIVE || startsAt <= now;
    // "Saturday at 19:00" - the countdown alone gets vague past a day out
    const absolute = startsAt < Number.MAX_SAFE_INTEGER ? moment(startsAt).calendar() : "";

    const interested = useStateFromStores(
        [GuildScheduledEventStore],
        () => {
            try {
                return (GuildScheduledEventStore as any).isInterestedInEventRecurrence?.(event.id, null) ?? false;
            } catch {
                return false;
            }
        },
        [event.id]
    );

    const join = () => {
        if (!event.channelId) return;
        closeGlance();
        try {
            VoiceActions.selectVoiceChannel(event.channelId);
        } catch (e) {
            logger.error("Failed to join event channel", e);
        }
    };

    return (
        <div className={"vc-glance-row vc-glance-event-row" + (live ? " vc-glance-row-live" : "")}>
            <div className="vc-glance-row-text">
                <span className="vc-glance-row-title">{event.name || "Event"}</span>
                {absolute && <span className="vc-glance-row-subtitle">{absolute}</span>}
            </div>
            <div className="vc-glance-row-actions" onClick={e => e.stopPropagation()}>
                {live
                    ? (
                        <>
                            <span className="vc-glance-live-chip">LIVE</span>
                            {event.channelId && (
                                <Tooltip text="Join event">
                                    {props => (
                                        <button {...props} className="vc-glance-icon-button vc-glance-event-join" onClick={join}>
                                            <SpeakerIcon size={16} />
                                        </button>
                                    )}
                                </Tooltip>
                            )}
                        </>
                    )
                    : <span className="vc-glance-event-countdown">{countdownLabel(startsAt, now)}</span>
                }
                <Tooltip text={interested ? "Remove RSVP" : "Interested"}>
                    {props => (
                        <button
                            {...props}
                            className={"vc-glance-icon-button" + (interested ? " vc-glance-event-interested" : "")}
                            onClick={() => setInterested(event, !interested)}
                        >
                            <BellIcon size={16} filled={interested} />
                        </button>
                    )}
                </Tooltip>
            </div>
        </div>
    );
}

interface GuildEvents {
    guildId: string;
    guildName: string;
    iconUrl?: string;
    events: any[];
}

export function EventsWidget() {
    const now = useNow(30_000);

    // Rolled up per server, servers ordered by whose event comes up first.
    // Store updates arrive over the gateway (create/update/RSVP), so this
    // recomputes in realtime; the 30s tick keeps countdowns fresh
    const groups = useStateFromStores([GuildScheduledEventStore, GuildStore], () => {
        const out: GuildEvents[] = [];
        let total = 0;
        try {
            for (const guild of Object.values(GuildStore.getGuilds())) {
                const upcoming = (GuildScheduledEventStore.getGuildScheduledEventsForGuild(guild.id) ?? [])
                    .filter((event: any) => event.status !== 3 && event.status !== 4)
                    .sort((a: any, b: any) => startTimeOf(a) - startTimeOf(b));
                if (upcoming.length === 0) continue;
                out.push({
                    guildId: guild.id,
                    guildName: guild.name,
                    iconUrl: IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 64 }),
                    events: upcoming
                });
                total += upcoming.length;
            }
        } catch (e) {
            logger.error("Failed to collect scheduled events", e);
        }
        out.sort((a, b) => startTimeOf(a.events[0]) - startTimeOf(b.events[0]));
        // Cap the total shown, trimming the furthest-out events first
        while (total > MAX_EVENTS && out.length > 0) {
            const last = out[out.length - 1];
            last.events.pop();
            if (last.events.length === 0) out.pop();
            total--;
        }
        return out;
    }, []);

    return (
        <WidgetCard id="events">
            {groups.length === 0
                ? <div className="vc-glance-empty">No upcoming events in your servers.</div>
                : (
                    <div className="vc-glance-guild-sections">
                        {groups.map(group => (
                            <div key={group.guildId} className="vc-glance-guild-section">
                                <div className="vc-glance-guild-header vc-glance-guild-header-static">
                                    {group.iconUrl
                                        ? <img className="vc-glance-guild-header-icon" src={group.iconUrl} alt="" draggable={false} />
                                        : (
                                            <div className="vc-glance-guild-header-icon vc-glance-guild-icon-fallback">
                                                {guildAcronym(group.guildName)}
                                            </div>
                                        )
                                    }
                                    <span className="vc-glance-guild-header-name">{group.guildName}</span>
                                    <span className="vc-glance-guild-header-count">{group.events.length}</span>
                                </div>
                                <div className="vc-glance-guild-body">
                                    <div className="vc-glance-row-list">
                                        {group.events.map(event => (
                                            <EventRow key={event.id} event={event} now={now} />
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )
            }
        </WidgetCard>
    );
}
