/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RenderModalProps } from "@vencord/discord-types";
import { extractAndLoadChunksLazy } from "@webpack";
import { openModalLazy, React } from "@webpack/common";

import { finders } from "../discordChecks";

// Discord's Modal component lives in a lazy chunk; load it before rendering
// (same trick upstream's PinDMs uses for its category modal)
const requireModalChunk = extractAndLoadChunksLazy([...finders.userSettingsModalChunk.strings]);

/** Opens one of our modals through Discord's real modal system */
export function openGlanceModal(render: (props: RenderModalProps) => React.ReactNode) {
    return openModalLazy(async () => {
        await requireModalChunk();
        return props => render(props);
    });
}

// The dashboard's Escape handler must yield while any of our modals is open,
// otherwise Escape would close the modal AND the whole view at once
let openModalCount = 0;

export function useGlanceModalGuard() {
    React.useEffect(() => {
        openModalCount++;
        return () => {
            openModalCount--;
        };
    }, []);
}
