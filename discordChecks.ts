/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Everything At a glance asks of Discord's code, as plain data. The plugin
// takes its patches and every lazy finder's arguments from here, and the same
// file is checked offline against Discord's current client before each
// release, so what is checked is exactly what ships. Pure: no imports.

export const pluginName = "AtAGlance";

export const patches = [
    // Inserts the At a glance tab as the first static row of the DM sidebar
    // list, right above the Friends button. Same module PinDMs anchors on,
    // so upstream keeps the find string alive.
    {
        find: '.FRIENDS},"friends"',
        replacement: {
            match: /(?<=listScrollerRef:\i,children:\[)/,
            replace: "$self.renderGlanceTab(),"
        }
    },
    // Renders the dashboard host as one more cell of Discord's app grid
    // (.vc-glance-host). Discord's layout then places it: beside the theme
    // editor, under the notice bar, right of the guild rail. ChannelTabs
    // anchors on the same module. The leading upsell child is optional so
    // its removal would not break the match.
    {
        find: '"AppView"',
        replacement: {
            match: /(?<=children:\[)(?=(?:\(0,\i\.jsx\)\(\i,\{\}\),)?\(0,\i\.jsx\)\(\i,\{isSidebarOpen:)/,
            replace: "$self.renderGlanceHost(),"
        }
    },
    // Marks Discord's user panel so CSS can hide it while the dashboard is
    // open (RailUserStrip replaces it) without a hashed class selector. Its
    // own entry, so a failure here costs only the hiding.
    {
        find: '"--custom-app-panels-height"',
        replacement: {
            match: /(?<="--custom-app-panels-height".{0,300}?\("section",\{)/,
            replace: '"data-vc-glance-panels":"",'
        }
    }
];

export const finders = {
    channelTextArea: { kind: "code", strings: ["renderApplicationCommandIcon:", '"submit-failure"'] },
    // childrenRepliedMessage: keeps this to the real ChannelMessage. Without it
    // a second module (a message preview) also matched, the same kind of
    // ambiguity that crashed Limelight's palette.
    channelMessage: { kind: "code", strings: ["childrenExecutedCommand:", ".hideAccessories", "childrenRepliedMessage:"] },
    // The chunk the user-settings modal needs; modals.ts loads it before opening ours.
    userSettingsModalChunk: { kind: "code", strings: ['type:"USER_SETTINGS_MODAL_OPEN"'] },
    searchResultClasses: { kind: "cssClasses", names: ["message", "searchResult"] },
    sidebarRowClasses: { kind: "cssClasses", names: ["channel", "linkButton", "linkButtonIcon", "link"] },
    voiceActions: { kind: "props", props: ["selectVoiceChannel", "selectChannel"] },
    messageJumpActions: { kind: "props", props: ["fetchMessages", "jumpToMessage"] },
    mentionActions: { kind: "props", props: ["fetchRecentMentions", "deleteRecentMention"] },
    messageActions: { kind: "props", props: ["editMessage", "sendMessage"] },
    audioActions: { kind: "props", props: ["toggleSelfMute", "toggleSelfDeaf"] },
    relationshipActions: { kind: "props", props: ["updateRelationship", "blockUser"] },
    callActions: { kind: "props", props: ["ring", "stopRinging"] },
    recentMentionsStore: { kind: "store", name: "RecentMentionsStore" },
    noteStore: { kind: "store", name: "NoteStore" },
    speakingStore: { kind: "store", name: "SpeakingStore" },
    // Discord's bookmarks and message reminders (Inbox > Bookmarks / Reminders)
    savedMessagesStore: { kind: "store", name: "SavedMessagesStore" },
    // The save / delete / refresh / fetch actions. PUT_SAVED_MESSAGE alone also
    // appears in Discord's route table, so the module is pinned by two strings.
    savedMessageActions: { kind: "code", strings: ["PUT_SAVED_MESSAGE", "type:\"BOOKMARKS_FETCH\""] },
    chatInputTypes: { kind: "unchecked", reason: "found by shape (ChannelPopup.tsx): SIDEBAR.analyticsName === \"sidebar\" beside a NORMAL entry" },
    userSettingsCompactDisplay: { kind: "unchecked", reason: "a protobuf settings path (textAndImages.messageDisplayCompact) read through getUserSettingLazy, not Discord code text" }
} as const;

// The host sits on these grid lines (styles.css, .vc-glance-host). If Discord
// renames them, this fails before a release instead of the dashboard landing
// in the wrong place.
export const cssChecks: { name: string; fragments: string[]; }[] = [
    { name: "app grid columns name guildsEnd and end", fragments: ["grid-template-columns:", "[guildsEnd]", "[channelsEnd]", "[end]"] },
    { name: "app grid rows name titleBarEnd and noticeEnd", fragments: ["grid-template-rows:", "[titleBarEnd]", "[noticeEnd]", "[end]"] },
    { name: "content area is a subgrid on both axes", fragments: ["grid-column:start/end", "grid-row:titleBarEnd/end", "grid-template-columns:subgrid", "grid-template-rows:subgrid"] }
];
