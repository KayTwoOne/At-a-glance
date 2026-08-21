/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Activity, SpotifyActivity, SpotifyTrack } from "@vencord/discord-types";
import { PresenceStore, React, SpotifyStore, UserStore, useStateFromStores } from "@webpack/common";

import { getEmptyBehaviour } from "../../data";
import { MusicIcon } from "../icons";
import { WidgetCard } from "../WidgetCard";

const SPOTIFY_TRACK_ID_RE = /^[a-zA-Z0-9]{22}$/;

// Discord's activity type enum has LISTENING = 2. PinnedFriends.tsx's
// describeActivity reads the same raw number rather than importing the enum -
// matching that here rather than introducing a second convention.
const LISTENING_ACTIVITY_TYPE = 2;

// Album art and platform badges only ever come from Spotify's CDN or Discord's
// own asset hosts. This is a security control - arbitrary hosts stay out of an
// <img src> - not a style choice, so it stays a strict allowlist rather than
// "any https".
const ART_HOST_RE = /^https:\/\/(i\.scdn\.co|[\w.-]+\.spotifycdn\.com|cdn\.discordapp\.com|media\.discordapp\.net)\//;

function sanitizeArtUrl(url: string | null | undefined): string | null {
    return typeof url === "string" && ART_HOST_RE.test(url) ? url : null;
}

/**
 * Discord's own resolution rules for a Rich Presence assets.*_image value: a
 * "spotify:" prefix points at Spotify's CDN, an "mp:external/" prefix points
 * at Discord's media proxy, and anything else is an app asset served from the
 * activity's own application id.
 */
function resolveActivityAsset(applicationId: string | undefined, value: string | undefined): string | null {
    if (!value) return null;
    if (value.startsWith("spotify:")) return `https://i.scdn.co/image/${value.slice("spotify:".length)}`;
    if (value.startsWith("mp:external/")) return `https://media.discordapp.net/external/${value.slice("mp:external/".length)}`;
    if (!applicationId) return null;
    return `https://cdn.discordapp.com/app-assets/${applicationId}/${value}.png`;
}

/** One shape for the widget to render, regardless of which source produced it */
interface NowPlaying {
    /** The service's own name - "Spotify", "TIDAL", "YouTube Music", whatever the RPC client sent */
    platform: string;
    title: string;
    subtitle: string;
    /** Resolved and allowlisted - never render an unchecked URL */
    art: string | null;
    /** The service's own small icon, same allowlist as art. Null falls back to MusicIcon */
    badge: string | null;
    progress: { start: number; end: number; } | null;
    /** Only Spotify can build a link that reliably opens something - other sources are read-only */
    openUrl: string | null;
}

function fromSpotifyTrack(track: SpotifyTrack, activity: SpotifyActivity | null): NowPlaying {
    const artists = track.artists.map(a => a.name).join(", ");
    const start = activity?.timestamps?.start;
    const end = activity?.timestamps?.end;

    return {
        platform: "Spotify",
        title: track.name,
        subtitle: artists || "Spotify",
        art: sanitizeArtUrl(track.album.image?.url),
        // SpotifyActivity carries no small_image of its own - the "Open in
        // Spotify" button already marks the source, nothing to fall back to.
        badge: null,
        progress: start && end && end > start ? { start, end } : null,
        openUrl: SPOTIFY_TRACK_ID_RE.test(track.id) ? `https://open.spotify.com/track/${track.id}` : null
    };
}

function fromActivity(activity: Activity): NowPlaying {
    const start = activity.timestamps?.start;
    const end = activity.timestamps?.end;

    return {
        platform: activity.name,
        title: activity.details || activity.name,
        subtitle: activity.state || activity.name,
        art: sanitizeArtUrl(resolveActivityAsset(activity.application_id, activity.assets?.large_image)),
        badge: sanitizeArtUrl(resolveActivityAsset(activity.application_id, activity.assets?.small_image)),
        progress: start && end && end > start ? { start, end } : null,
        // A generic RPC activity is read-only - there is no API that hands
        // back a URL guaranteed to open the right app, so there is no control
        // to show rather than a button that would do nothing.
        openUrl: null
    };
}

function useNowPlaying(): NowPlaying | null {
    const track = useStateFromStores([SpotifyStore], () => SpotifyStore.getTrack());
    const spotifyActivity = useStateFromStores([SpotifyStore], () => SpotifyStore.getActivity());
    const listeningActivity = useStateFromStores([PresenceStore], () => {
        const meId = UserStore.getCurrentUser()?.id;
        if (!meId) return null;
        return PresenceStore.getActivities(meId).find(a => a.type === LISTENING_ACTIVITY_TYPE) ?? null;
    });

    // SpotifyStore stays the preferred source - first-party, richer data. Only
    // once it has nothing does a generic listening activity get a look in.
    if (track) return fromSpotifyTrack(track, spotifyActivity);
    if (listeningActivity) return fromActivity(listeningActivity);
    return null;
}

export function SpotifyCard({ nowPlaying }: { nowPlaying: NowPlaying | null; }) {
    // Ticks once a second purely to advance the progress bar while playing
    const [, tick] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => {
        if (!nowPlaying?.progress) return;
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [nowPlaying?.progress?.start, nowPlaying?.progress?.end]);

    if (!nowPlaying) {
        return (
            <div className="vc-glance-spotify-idle">
                <MusicIcon size={18} />
                <span className="vc-glance-hint">Nothing playing</span>
            </div>
        );
    }

    const { platform, title, subtitle, art, badge, progress, openUrl } = nowPlaying;

    const openTrack = () => {
        if (openUrl) window.open(openUrl, "_blank", "noopener,noreferrer");
    };

    const sourceIcon = badge
        ? <img className="vc-glance-spotify-source-icon" src={badge} alt="" draggable={false} />
        : <MusicIcon size={16} />;

    return (
        <>
            <div className="vc-glance-spotify-now">
                {art
                    ? <img className="vc-glance-spotify-art" src={art} alt="" draggable={false} />
                    : <div className="vc-glance-spotify-art vc-glance-spotify-art-fallback"><MusicIcon size={20} /></div>
                }
                <div className="vc-glance-row-text">
                    <span className="vc-glance-row-title">{title}</span>
                    <span className="vc-glance-row-subtitle">{subtitle}</span>
                </div>
                {openUrl
                    // Only Spotify has a working control here - a generic
                    // source gets a static badge instead of a dead button.
                    ? (
                        <button
                            className="vc-glance-icon-button"
                            aria-label={`Open in ${platform}`}
                            title={`Open in ${platform}`}
                            onClick={openTrack}
                        >
                            {sourceIcon}
                        </button>
                    )
                    // Decorative only - the platform name is already real text
                    // in the card header and the row title/subtitle above, so
                    // this doesn't need its own screen-reader announcement.
                    : (
                        <div className="vc-glance-spotify-source" title={platform} aria-hidden="true">
                            {sourceIcon}
                        </div>
                    )
                }
            </div>
            {progress && (
                <>
                    <div className="vc-glance-spotify-progress">
                        <div
                            className="vc-glance-spotify-progress-fill"
                            style={{ width: `${(Math.min(1, Math.max(0, (Date.now() - progress.start) / (progress.end - progress.start))) * 100).toFixed(1)}%` }}
                        />
                    </div>
                    <div className="vc-glance-spotify-times">
                        <span>{formatTrackTime(Math.min(Date.now() - progress.start, progress.end - progress.start))}</span>
                        <span>{formatTrackTime(progress.end - progress.start)}</span>
                    </div>
                </>
            )}
        </>
    );
}

function formatTrackTime(ms: number) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function SpotifyWidget() {
    const nowPlaying = useNowPlaying();
    const behaviour = getEmptyBehaviour("spotify");

    // Idle on both sources and the user wants it gone: render no card at all
    // rather than a permanently dead panel with its own header.
    if (!nowPlaying && behaviour === "hide") return null;

    return (
        <WidgetCard id="spotify" label={nowPlaying?.platform} empty={!nowPlaying}>
            <SpotifyCard nowPlaying={nowPlaying} />
        </WidgetCard>
    );
}
