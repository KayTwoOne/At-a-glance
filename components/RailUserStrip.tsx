/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openUserProfile } from "@utils/discord";
import { findByPropsLazy } from "@webpack";
import {
    AccessibilityStore,
    MediaEngineStore,
    PresenceStore,
    React,
    SettingsRouter,
    Tooltip,
    UserStore,
    useStateFromStores
} from "@webpack/common";

import { finders } from "../discordChecks";
import { GearIcon, HeadphonesIcon, MicIcon } from "./icons";

const AudioActions = findByPropsLazy(...finders.audioActions.props) as {
    toggleSelfMute(): void;
    toggleSelfDeaf(): void;
};

// Nameplate collectibles live on the Discord asset CDN; the asset field is a
// path fragment like "nameplates/nameplates/<name>/". Only clean path
// fragments are ever interpolated (hardening), and every layer has a
// fallback: animated -> static -> plain themed panel.
const NAMEPLATE_ASSET_RE = /^[\w/-]+\/$/;
const COLLECTIBLES_CDN = "https://cdn.discordapp.com/assets/collectibles/";

function useNameplateAsset(me: any): string | null {
    return React.useMemo(() => {
        const nameplate = me?.collectibles?.nameplate ?? me?.nameplate;
        const asset = nameplate?.asset;
        return typeof asset === "string" && NAMEPLATE_ASSET_RE.test(asset) ? asset : null;
    }, [me?.collectibles?.nameplate, me?.nameplate]);
}

function ControlButtons({ isMuted, isDeafened }: { isMuted: boolean; isDeafened: boolean; }) {
    return (
        <>
            <Tooltip text={isMuted ? "Unmute" : "Mute"}>
                {props => (
                    <button
                        {...props}
                        className={"vc-glance-rail-button" + (isMuted ? " vc-glance-rail-button-danger" : "")}
                        onClick={() => AudioActions.toggleSelfMute()}
                    >
                        <MicIcon size={18} muted={isMuted} />
                    </button>
                )}
            </Tooltip>

            <Tooltip text={isDeafened ? "Undeafen" : "Deafen"}>
                {props => (
                    <button
                        {...props}
                        className={"vc-glance-rail-button" + (isDeafened ? " vc-glance-rail-button-danger" : "")}
                        onClick={() => AudioActions.toggleSelfDeaf()}
                    >
                        <HeadphonesIcon size={18} deafened={isDeafened} />
                    </button>
                )}
            </Tooltip>

            <Tooltip text="User Settings">
                {props => (
                    <button
                        {...props}
                        className="vc-glance-rail-button"
                        onClick={() => SettingsRouter.openUserSettings()}
                    >
                        <GearIcon size={18} />
                    </button>
                )}
            </Tooltip>
        </>
    );
}

/**
 * The user panel while At a glance is open. A fixed-size vertical card under the
 * server-icon rail: avatar (with status) on top, then mute / deafen / settings.
 * The user's Nitro nameplate decoration is wrapped around the whole card as its
 * background (cover-fit, never stretched), with a scrim for legibility. No
 * resizing - a set size that blends into the sidebar.
 */
export function RailUserStrip() {
    const me = useStateFromStores([UserStore], () => UserStore.getCurrentUser()) as any;
    const status = useStateFromStores(
        [PresenceStore],
        () => me ? PresenceStore.getStatus(me.id) : "offline",
        [me?.id]
    );
    const isMuted = useStateFromStores([MediaEngineStore], () => MediaEngineStore.isSelfMute());
    const isDeafened = useStateFromStores([MediaEngineStore], () => MediaEngineStore.isSelfDeaf());

    const asset = useNameplateAsset(me);
    const [mediaBroken, setMediaBroken] = React.useState(false);
    const reduceMotion = AccessibilityStore.useReducedMotion;

    if (!me) return null;

    const showNameplate = asset != null && !mediaBroken;

    return (
        <div className="vc-glance-rail-strip">
            <div className={"vc-glance-rail-panel" + (showNameplate ? " vc-glance-rail-panel-plated" : "")}>
                {showNameplate && asset && (
                    <div className="vc-glance-rail-plate" aria-hidden>
                        <img
                            className="vc-glance-rail-plate-media"
                            src={`${COLLECTIBLES_CDN}${asset}static.png`}
                            alt=""
                            draggable={false}
                            onError={() => setMediaBroken(true)}
                        />
                        {!reduceMotion && (
                            <video
                                className="vc-glance-rail-plate-media"
                                src={`${COLLECTIBLES_CDN}${asset}asset.webm`}
                                autoPlay
                                loop
                                muted
                                playsInline
                                onError={e => e.currentTarget.remove()}
                            />
                        )}
                        <div className="vc-glance-rail-plate-scrim" />
                    </div>
                )}

                <div className="vc-glance-rail-panel-content">
                    <Tooltip text={me.globalName || me.username}>
                        {props => (
                            <button {...props} className="vc-glance-rail-avatar-button" onClick={() => openUserProfile(me.id)}>
                                <div className="vc-glance-avatar-wrap vc-glance-rail-avatar">
                                    <img className="vc-glance-avatar" src={me.getAvatarURL(void 0, 80, false)} alt="" draggable={false} />
                                    <span className={`vc-glance-status vc-glance-status-${status ?? "online"}`} />
                                </div>
                            </button>
                        )}
                    </Tooltip>
                    <div className="vc-glance-rail-controls">
                        <ControlButtons isMuted={isMuted} isDeafened={isDeafened} />
                    </div>
                </div>
            </div>
        </div>
    );
}
