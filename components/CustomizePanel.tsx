/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "@webpack/common";

import {
    DEFAULT_APPEARANCE,
    GLANCE_BG_MODES,
    GLANCE_MATERIALS,
    GlanceBackgroundMode,
    GlanceMaterial,
    setAppearance,
    useGlanceConfig
} from "../data";
import { GLANCE_PRESETS } from "../presets";
import { ArrowIcon, CloseIcon } from "./icons";
import { glanceToast } from "./toast";

const MATERIAL_LABELS: Record<GlanceMaterial, string> = {
    classic: "Classic",
    acrylic: "Acrylic",
    glass: "Glass"
};

const BG_MODE_LABELS: Record<GlanceBackgroundMode, string> = {
    theme: "Match theme",
    solid: "Solid",
    gradient: "Gradient"
};

/* ========== open state ==========
   Same module-level pattern as layerOpen/editMode in GlanceLayer.tsx, and for
   the same reason: this is a shell for the dashboard, not a preference, so it
   always starts closed and never touches storage. */

let panelOpen = false;
const panelOpenListeners = new Set<() => void>();

function setPanelOpen(open: boolean) {
    if (panelOpen === open) return;
    panelOpen = open;
    for (const listener of [...panelOpenListeners]) {
        try {
            listener();
        } catch { }
    }
}

function useCustomizePanelOpen() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => {
        panelOpenListeners.add(forceUpdate);
        return () => void panelOpenListeners.delete(forceUpdate);
    }, []);
    return panelOpen;
}

/** Opens the docked customization panel; every control commits immediately (live preview) */
export function openCustomizePanel() {
    setPanelOpen(true);
}

/** Closes the panel without touching anything it was previewing. Also called
 *  from GlanceLayer whenever the dashboard itself closes, the same way
 *  closeGlance() resets editMode - nobody wants to reopen the dashboard with
 *  the panel already docked. */
export function closeCustomizePanel() {
    setPanelOpen(false);
}

/** Mounted only while open, so its config subscription and the focus effect
 *  below don't run for the lifetime of the dashboard - the same efficiency
 *  the old modal got for free by only existing while openModalLazy had it
 *  mounted. */
function CustomizePanelBody() {
    const { appearance } = useGlanceConfig();
    const closeButtonRef = React.useRef<HTMLButtonElement>(null);

    React.useEffect(() => {
        // Focus moves in on open, and back to whatever opened us on close -
        // the trigger is captured here rather than passed in, since this panel
        // (unlike the modal it replaced) has no caller-supplied close handler
        // to thread it through.
        const trigger = document.activeElement as HTMLElement | null;
        closeButtonRef.current?.focus();

        // Capture phase + stopPropagation, the same trick GlanceLayer's own
        // palette hotkey uses: consumes Escape before the layer's bubble-phase
        // handler can see it, so closing the panel doesn't also close the
        // whole dashboard underneath it.
        function onKeyDown(e: KeyboardEvent) {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            closeCustomizePanel();
        }
        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            // Deliberately not a focus trap: the whole point of docking this
            // panel is to let the dashboard stay interactive while it's open,
            // so Tab is free to leave it in either direction. The trigger can
            // be gone by the time we get here (dashboard closed from under us,
            // widget removed), hence the guard.
            trigger?.focus?.();
        };
    }, []);

    return (
        <aside className="vc-glance-customize-panel" aria-labelledby="vc-glance-customize-heading">
            <header className="vc-glance-customize-panel-header">
                <div className="vc-glance-customize-panel-heading">
                    <h2 id="vc-glance-customize-heading" className="vc-glance-customize-panel-title">Customization</h2>
                    <span className="vc-glance-customize-panel-subtitle">Changes preview live on the dashboard</span>
                </div>
                <button
                    ref={closeButtonRef}
                    className="vc-glance-icon-button"
                    aria-label="Close customization panel"
                    onClick={closeCustomizePanel}
                >
                    <CloseIcon size={16} />
                </button>
            </header>

            <div className="vc-glance-scroll">
                <div className="vc-glance-customize-body">
                    <div className="vc-glance-customize-section">
                        <h3 id="vc-glance-customize-presets-heading" className="vc-glance-customize-label">Presets</h3>
                        <div className="vc-glance-preset-row" role="group" aria-labelledby="vc-glance-customize-presets-heading">
                            {GLANCE_PRESETS.map(preset => (
                                <button
                                    key={preset.id}
                                    className="vc-glance-preset-chip"
                                    title={preset.label}
                                    onClick={() => {
                                        setAppearance(preset.apply);
                                        glanceToast(`Applied ${preset.label}`, "success");
                                    }}
                                >
                                    <span
                                        className="vc-glance-preset-swatch"
                                        style={{ background: `linear-gradient(135deg, ${preset.swatch[0]}, ${preset.swatch[1]})` }}
                                    />
                                    <span className="vc-glance-preset-name">{preset.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="vc-glance-customize-section">
                        <h3 id="vc-glance-customize-bg-heading" className="vc-glance-customize-label">Background</h3>
                        <div className="vc-glance-segmented" role="group" aria-labelledby="vc-glance-customize-bg-heading">
                            {GLANCE_BG_MODES.map(mode => (
                                <button
                                    key={mode}
                                    className={"vc-glance-segment" + (appearance.backgroundMode === mode ? " vc-glance-segment-active" : "")}
                                    onClick={() => setAppearance({ backgroundMode: mode })}
                                >
                                    {BG_MODE_LABELS[mode]}
                                </button>
                            ))}
                        </div>
                        {appearance.backgroundMode === "theme"
                            ? <span className="vc-glance-hint">Follows your Discord/Nitro theme. Switch to Solid or Gradient to override a busy theme.</span>
                            : appearance.backgroundMode === "solid"
                                ? (
                                    <div className="vc-glance-color-row vc-glance-bg-color-row">
                                        <input
                                            type="color"
                                            className="vc-glance-color-input"
                                            value={appearance.backgroundColor}
                                            onChange={e => setAppearance({ backgroundColor: e.target.value })}
                                            aria-label="Background colour"
                                        />
                                        <span className="vc-glance-color-hex">{appearance.backgroundColor}</span>
                                        <span className="vc-glance-hint">Overrides your theme with this colour.</span>
                                    </div>
                                )
                                : <span className="vc-glance-hint">Uses your Primary → Accent colours and Direction below as an opaque gradient.</span>
                        }
                    </div>

                    {appearance.backgroundMode !== "theme" && (
                        <div className="vc-glance-customize-section">
                            <div className="vc-glance-customize-slider-head">
                                <h3 id="vc-glance-customize-opacity-heading" className="vc-glance-customize-label">Surface opacity</h3>
                                <span className="vc-glance-customize-value">{appearance.surfaceOpacity}%</span>
                            </div>
                            <input
                                type="range"
                                className="vc-glance-slider"
                                min={40} max={100} step={1}
                                value={appearance.surfaceOpacity}
                                onChange={e => setAppearance({ surfaceOpacity: Number(e.target.value) })}
                                aria-label="Surface opacity"
                                aria-valuetext={`${appearance.surfaceOpacity}%`}
                            />
                        </div>
                    )}

                    <div className="vc-glance-customize-section">
                        <h3 id="vc-glance-customize-material-heading" className="vc-glance-customize-label">Material</h3>
                        <div className="vc-glance-segmented" role="group" aria-labelledby="vc-glance-customize-material-heading">
                            {GLANCE_MATERIALS.map(material => (
                                <button
                                    key={material}
                                    className={"vc-glance-segment" + (appearance.material === material ? " vc-glance-segment-active" : "")}
                                    onClick={() => setAppearance({ material })}
                                >
                                    {MATERIAL_LABELS[material]}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="vc-glance-customize-section">
                        <div className="vc-glance-customize-colors">
                            <div className="vc-glance-customize-color">
                                <h3 className="vc-glance-customize-label">Primary</h3>
                                <div className="vc-glance-color-row">
                                    <input
                                        type="color"
                                        className="vc-glance-color-input"
                                        value={appearance.primary}
                                        onChange={e => setAppearance({ primary: e.target.value })}
                                        aria-label="Primary colour"
                                    />
                                    <span className="vc-glance-color-hex">{appearance.primary}</span>
                                </div>
                            </div>
                            <div className="vc-glance-customize-color">
                                <h3 className="vc-glance-customize-label">Accent</h3>
                                <div className="vc-glance-color-row">
                                    <input
                                        type="color"
                                        className="vc-glance-color-input"
                                        value={appearance.accent}
                                        onChange={e => setAppearance({ accent: e.target.value })}
                                        aria-label="Accent colour"
                                    />
                                    <span className="vc-glance-color-hex">{appearance.accent}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="vc-glance-customize-section">
                        <h3 id="vc-glance-customize-namecolor-heading" className="vc-glance-customize-label">Name colour</h3>
                        <div className="vc-glance-segmented" role="group" aria-labelledby="vc-glance-customize-namecolor-heading">
                            <button
                                className={"vc-glance-segment" + (appearance.nameColor === null ? " vc-glance-segment-active" : "")}
                                onClick={() => setAppearance({ nameColor: null })}
                            >
                                Match accent
                            </button>
                            <button
                                className={"vc-glance-segment" + (appearance.nameColor !== null ? " vc-glance-segment-active" : "")}
                                onClick={() => setAppearance({ nameColor: appearance.nameColor ?? "#ffffff" })}
                            >
                                Custom
                            </button>
                        </div>
                        {appearance.nameColor !== null
                            ? (
                                <div className="vc-glance-color-row">
                                    <input
                                        type="color"
                                        className="vc-glance-color-input"
                                        value={appearance.nameColor}
                                        onChange={e => setAppearance({ nameColor: e.target.value })}
                                        aria-label="Greeting name colour"
                                    />
                                    <span className="vc-glance-color-hex">{appearance.nameColor}</span>
                                    <span className="vc-glance-hint">Your name in the greeting uses this colour.</span>
                                </div>
                            )
                            : <span className="vc-glance-hint">Your name in the greeting follows the Primary → Accent gradient.</span>
                        }
                    </div>

                    <div className="vc-glance-customize-section">
                        <div className="vc-glance-customize-slider-head">
                            <h3 className="vc-glance-customize-label">Colour intensity</h3>
                            <span className="vc-glance-customize-value">{appearance.intensity}%</span>
                        </div>
                        <input
                            type="range"
                            className="vc-glance-slider"
                            min={0} max={100} step={1}
                            value={appearance.intensity}
                            onChange={e => setAppearance({ intensity: Number(e.target.value) })}
                            aria-label="Colour intensity"
                            aria-valuetext={`${appearance.intensity}%`}
                        />
                    </div>

                    <div className="vc-glance-customize-section">
                        <div className="vc-glance-customize-slider-head">
                            <h3 className="vc-glance-customize-label">Direction</h3>
                            <span className="vc-glance-customize-value">
                                <span
                                    className="vc-glance-angle-arrow"
                                    style={{ transform: `rotate(${appearance.angle}deg)` }}
                                    aria-hidden
                                >
                                    <ArrowIcon size={13} direction="up" />
                                </span>
                                {appearance.angle}°
                            </span>
                        </div>
                        <input
                            type="range"
                            className="vc-glance-slider"
                            min={0} max={360} step={1}
                            value={appearance.angle}
                            onChange={e => setAppearance({ angle: Number(e.target.value) })}
                            aria-label="Shine direction"
                            aria-valuetext={`${appearance.angle} degrees`}
                        />
                    </div>
                </div>
            </div>

            <footer className="vc-glance-customize-panel-footer">
                <button
                    className="vc-glance-button vc-glance-button-secondary"
                    onClick={() => setAppearance({ ...DEFAULT_APPEARANCE })}
                >
                    Reset to defaults
                </button>
                <button
                    className="vc-glance-button vc-glance-button-brand"
                    onClick={closeCustomizePanel}
                >
                    Done
                </button>
            </footer>
        </aside>
    );
}

/** Docked customization shell - renders nothing while closed so the config
 *  subscription and focus effect above don't run for the lifetime of the
 *  dashboard, only while the panel actually exists. */
export function CustomizePanel() {
    const open = useCustomizePanelOpen();
    return open ? <CustomizePanelBody /> : null;
}
