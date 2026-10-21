/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    tabLabel: {
        type: OptionType.STRING,
        description: "Label shown on the sidebar tab and page title",
        default: "At a glance"
    },
    openOnStartup: {
        type: OptionType.BOOLEAN,
        description: "Open At a glance automatically when Discord starts",
        default: false
    },
    pinHotkey: {
        type: OptionType.STRING,
        description: "Hotkey to pin/unpin a channel or DM partner. Use 'middleclick' for mouse (e.g. ctrl+middleclick) or a key combo (e.g. ctrl+shift+p). Leave empty to disable.",
        default: "ctrl+middleclick"
    },
    commandPaletteHotkey: {
        type: OptionType.STRING,
        description: "Hotkey to open the command palette while At a glance is open (e.g. shift+space, ctrl+k). Leave empty to disable.",
        default: "shift+space"
    },
    showOfflinePinnedUsers: {
        type: OptionType.BOOLEAN,
        description: "Show pinned friends who are currently offline",
        default: true
    },
    emptyVoiceChannelsDimmed: {
        type: OptionType.BOOLEAN,
        description: "Dim watched voice channels while nobody is in them",
        default: true
    },
    extraTimezones: {
        type: OptionType.STRING,
        description: "Extra clocks for Quick Tools: comma-separated IANA timezones (e.g. UTC, Europe/Berlin). Easier to manage from the Clock tab itself.",
        default: "UTC"
    },
    timerSound: {
        type: OptionType.BOOLEAN,
        description: "Play a soft chime when the Quick Tools timer reaches zero",
        default: true
    },
    temperatureUnit: {
        type: OptionType.SELECT,
        description: "Temperature unit for the weather card",
        options: [
            { label: "Celsius", value: "c", default: true },
            { label: "Fahrenheit", value: "f" }
        ]
    },
    weatherRefreshMinutes: {
        type: OptionType.NUMBER,
        description: "How often to refresh weather data, in minutes (minimum 5, to keep Open-Meteo usage polite)",
        default: 10
    }
});
