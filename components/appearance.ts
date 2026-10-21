/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "@webpack/common";

import { deriveAccentTokens, pickTextTone } from "../accent";
import { mixHex, parseCssColour, relativeLuminance } from "../colour";
import { useGlanceConfig } from "../data";

interface DiscordTheme {
    /** Discord's base theme is light (measured from --text-default) */
    light: boolean;
    /** The surface cards sit on in "theme" mode, as opaque #rrggbb */
    surface: string;
}

// One measurement shared by every hook instance: one pair of probes, one
// attribute observer, created for the first subscriber and removed after
// the last.
let themeState: DiscordTheme = { light: false, surface: "#26262b" };
const themeListeners = new Set<() => void>();
let stopThemeWatch: (() => void) | null = null;

/**
 * Discord's theme, measured rather than guessed: hidden probes resolve
 * --text-default (it always flips with the base theme, Nitro gradients
 * included) and --background-base-low (the colour cards sit on). A
 * translucent surface is composited over black or white to match the theme.
 * Re-measures when Discord swaps theme classes on <html>.
 */
function startThemeWatch() {
    const text = document.createElement("span");
    text.style.color = "var(--text-default, var(--text-normal, #fff))";
    text.style.display = "none";
    const surface = document.createElement("span");
    surface.style.backgroundColor = "var(--background-base-low, var(--background-primary, #26262b))";
    surface.style.display = "none";
    document.body.append(text, surface);

    const measure = () => {
        try {
            const ink = parseCssColour(getComputedStyle(text).color);
            const light = ink ? relativeLuminance(ink.hex) < 0.5 : false;
            const base = parseCssColour(getComputedStyle(surface).backgroundColor);
            const opaque = base
                ? (base.alpha >= 1 ? base.hex : mixHex(light ? "#ffffff" : "#000000", base.hex, base.alpha))
                : (light ? "#ffffff" : "#26262b");
            if (themeState.light === light && themeState.surface === opaque) return;
            themeState = { light, surface: opaque };
            for (const listener of [...themeListeners]) listener();
        } catch { }
    };

    const observer = new MutationObserver(measure);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    stopThemeWatch = () => {
        observer.disconnect();
        text.remove();
        surface.remove();
    };
    measure();
}

function useDiscordTheme(): DiscordTheme {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => {
        themeListeners.add(forceUpdate);
        if (!stopThemeWatch) startThemeWatch();
        return () => {
            themeListeners.delete(forceUpdate);
            if (themeListeners.size === 0) {
                stopThemeWatch?.();
                stopThemeWatch = null;
            }
        };
    }, []);
    return themeState;
}

/** True when Discord's base theme is light. */
export function useOnLightTheme(): boolean {
    return useDiscordTheme().light;
}

/**
 * Live material/background classes + CSS custom properties for any At a glance
 * surface (main layer, channel popup, prompt/customize modals).
 *
 * The intensity slider is 0-100 in the UI but capped in rendering - 100% maps
 * to a 45% tint so a maxed slider stays usable instead of a solid colour wall.
 *
 * Background modes: "theme" follows Discord's client/Nitro theme (translucent);
 * "solid"/"gradient" paint an OPAQUE background that overrides the theme, and
 * add a `vc-glance-bg-override` class so cards become opaque too (otherwise the
 * theme would still bleed through them). When an override background is light,
 * `vc-glance-bg-light` flips text/icon colours to dark for legibility.
 *
 * Accent is the one highlight colour. Its contrast-checked forms (fills and
 * their labels, links, the greeting name) are set inline as --vcg-accent-ui,
 * --vcg-on-accent, --vcg-accent-text and --vcg-name-from/-to, measured against
 * the surfaces the cards actually paint.
 */
export function useAppearance(): { materialClass: string; style: React.CSSProperties; onLightTheme: boolean; } {
    const { appearance } = useGlanceConfig();
    const override = appearance.backgroundMode !== "theme";

    const theme = useDiscordTheme();
    // Where page-level text (the top bar) sits: the override background's stops
    const stops = appearance.backgroundMode === "solid"
        ? [appearance.backgroundColor]
        : appearance.backgroundMode === "gradient"
            ? [appearance.primary, appearance.accent]
            : [theme.surface];
    const light = override && pickTextTone(stops) === "dark";

    // Where cards sit, as styles.css paints them. In both override modes the
    // card base is --vcg-card mixed into --vcg-bg (the solid colour setting,
    // even in gradient mode) at the surface opacity; in theme mode it is
    // Discord's surface. The tint layer then lays primary over one end and
    // accent over the other, at the same strengths useAppearance sets below,
    // so both tinted ends are surfaces. Keep this in step with styles.css
    // (.vc-glance-bg-solid / -gradient / -light --vcg-card, and the override
    // card rule).
    const card = light
        ? mixHex("#f2f3f5", "#000000", 0.06)
        : appearance.backgroundMode === "solid"
            ? mixHex(appearance.backgroundColor, "#ffffff", 0.06)
            : "#202127";
    const base = override
        ? mixHex(appearance.backgroundColor, card, appearance.surfaceOpacity / 100)
        : theme.surface;
    const tint = appearance.intensity * 0.45 / 100;
    const tintSoft = appearance.intensity * 0.28 / 100;
    const surfaces = [mixHex(base, appearance.primary, tint), mixHex(base, appearance.accent, tintSoft)];
    const tokens = deriveAccentTokens({
        accent: appearance.accent,
        primary: appearance.primary,
        nameColor: appearance.nameColor,
        surfaces
    });

    const classes = [
        `vc-glance-material-${appearance.material}`,
        `vc-glance-bg-${appearance.backgroundMode}`,
        override ? "vc-glance-bg-override" : "",
        light ? "vc-glance-bg-light" : "",
        appearance.nameColor ? "vc-glance-custom-name" : ""
    ].filter(Boolean).join(" ");

    const style: React.CSSProperties = {
        "--vcg-primary": appearance.primary,
        "--vcg-accent": appearance.accent,
        "--vcg-tint": `${(appearance.intensity * 0.45).toFixed(1)}%`,
        "--vcg-tint-soft": `${(appearance.intensity * 0.28).toFixed(1)}%`,
        "--vcg-angle": `${appearance.angle}deg`,
        "--vcg-bg": appearance.backgroundColor,
        "--vcg-surface-opacity": `${appearance.surfaceOpacity}%`,
        "--vcg-accent-ui": tokens.accentUi,
        "--vcg-on-accent": tokens.onAccent,
        "--vcg-accent-text": tokens.accentText,
        "--vcg-name-from": tokens.nameFrom,
        "--vcg-name-to": tokens.nameTo
    } as React.CSSProperties;
    if (appearance.nameColor) (style as any)["--vcg-name"] = appearance.nameColor;

    return { materialClass: ` ${classes}`, style, onLightTheme: theme.light };
}
