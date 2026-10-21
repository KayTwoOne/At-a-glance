# Changelog

## 3.1.0 - 2026-10-20

The dashboard now sits inside Discord's own layout instead of on top of it,
saving can no longer overwrite your data, and every control follows your Accent
colour.

### Safer saving
- **A failed or overlapping load can no longer overwrite what you saved.**
  Nothing is written until this account's data has loaded, and it is only ever
  written back to that account.
- **A failed read now says so.** Instead of an empty dashboard that looks like
  lost data, you get "Your dashboard couldn't be loaded" with a **Try again**
  button. It also retries on its own after 2 seconds, then 10, then 30, and
  every 30 seconds after that for as long as it keeps failing.
- Switching accounts saves the old account's pending edit to that account
  first, and a reconnect no longer re-reads over edits you have just made.
- Changes made before your data has loaded are refused, with one toast, rather
  than being lost when the data arrives.
- Disabling the plugin stops the retries and saves any pending edit.

### Inside Discord's own layout
- **The dashboard is now a cell of Discord's own grid, not an overlay on top
  of it.** Discord's layout places it: right of the server rail, under the
  title bar, beside the theme editor.
- **Discord's theme editor narrows it automatically**, and Discord's notice bar
  (reconnecting, updates) stays visible above it. Nothing watches the page for
  either any more.
- The always-on page watcher and all the measuring code are gone, so it uses
  less CPU while it's open.
- The **theme editor debug** setting is removed, because there is nothing left
  to debug.
- Discord's user panel is hidden by a marker the plugin puts on it, instead of
  by a guessed class name.

### One accent
- **Buttons, progress bars, selected tabs, toggles, badges, links, dropdown
  highlights and field outlines all follow your Accent colour.** Before, buttons
  were stuck on Discord's blurple whatever you picked.
- **Every accent colour is contrast-checked** and adjusted until it passes
  WCAG (3:1 for controls, 4.5:1 for text) wherever that is possible. Where no
  colour can pass, the closest one to passing is used. Labels on accent buttons
  pick white or near-black, whichever reads.
- A fresh install's buttons are cyan (the default Accent) with dark text,
  because white on that cyan is only 2.6:1.

### Readable on light backgrounds
- Dark or light text is now chosen by measured contrast against every end of a
  gradient, not by an average-brightness cut-off that could leave light text on
  a pale end.

### One continuous stage
- The colour tint is now one wash across the whole page, and each card shows its
  own slice of it, instead of the gradient restarting in every card. Cards still
  lift on hover without breaking that.

### Discord's own bookmarks and reminders
- **Saved Messages and Reminders now read Discord's own lists.** Whatever you
  bookmark, or set a reminder on, in Discord shows up here, tidied, and follows
  you across your devices. Discord hands bookmarks over 25 at a time, so **Load
  25 more** asks for the next page when you want it.
- **Reminders puts Discord's message reminders beside your own notes,** earliest
  first, so anything overdue is on top. Each one says when it is due (OVERDUE 25
  MIN, IN 2 H, TOMORROW 09:00) and has **Done** and **Snooze**, with the same
  timer choices as the add form. Once you have both kinds, a small **All /
  Messages / Notes** switch appears above the list, and it starts at All each
  time you open the dashboard.
- **Overdue Discord reminders count on the card and on the tab's badge,** next
  to your own. Discord already notifies you when one is due, so At a glance does
  not send a second notification for them.
- **"Save to At a glance" is gone from the message menu.** Discord's **Bookmark
  Message** and **Create Reminder** do the same job, and sync. If Discord's
  lists can't be found after an update, the old menu item and the old lists come
  back, so nothing is lost.
- **Your old saves stay until you move them.** They sit under "Saved here
  before", and **Move to Discord** bookmarks them in Discord one at a time, three
  seconds apart, taking each local copy away only once Discord has it.
- **Your text reminders stay.** Discord can't hold a reminder without a
  message, so notes like "Water the plants" remain At a glance's own, marked
  "Your note · At a glance only".

### Fixed
- **Toasts work on current Equicord again.** Its toast API changed. They still
  work on Vencord.

### Smaller things
- **Click anywhere on a widget's title bar** to collapse or expand it, not just
  on its name.

### Behind the scenes
- Every Discord lookup At a glance makes now comes from one list, which is
  checked against Discord's live code before each release.
- One lookup, the chat message renderer, was matching two of Discord's modules.
  It is pinned to the right one now.

## 3.0.0 - 2026-08-21

The dashboard's layout goes from a fixed two-column split to a free one where any
widget can live in any column - the reason this release earns the first version
number rather than the second.

### Free layout
- **A third column appears when there's room** (three across at wide windows, two
  at medium, one at narrow) and folds back down without losing anything - a
  layout built at three columns just re-flows, it never gets rewritten.
- **Drag a widget into any column**, not just up and down within its own. A
  widget's column is now saved per account rather than fixed by what kind of
  widget it is, so the arrangement is entirely yours to build.
- The **Social** and **Tools & Utilities** column headings are gone - once a
  widget can land in either column, a heading promising one kind of content
  stopped being true.
- Widgets **adapt to whichever column they're sitting in**: pinned friend tiles
  drop to one per row and the forecast strip trims a day or two once a column
  gets narrow, reacting to the column's own width rather than the window's.
- **Edit mode.** Drag grips are hidden until you press **Edit Layout**, so the
  dashboard doesn't look draggable all the time. While editing, a **Reset
  layout** / **Restore defaults** menu sits next to Done - both leave your pins,
  notes, bookmarks, reminders and weather location untouched.

### Privacy blur
- **One button blurs the names on screen.** An eye in the top bar blurs pinned
  friend tiles, the server names in Quick Access and your weather location, so
  the dashboard can go on a screen share or into a screenshot without handing
  over who you talk to and roughly where you are.
- It stays **fully usable while it's on**. Rows still click, focus and open, so
  it's cover for onlookers rather than a mode that takes the dashboard away
  from the person actually using it.
- Deliberately **not remembered between sessions**, and it clears itself when
  the dashboard closes. The reason to turn it on is something happening right
  now, not a preference to carry forward.
- It is a visual filter, not a redaction: the text is still in the page
  underneath. It hides things from a camera or a viewer, not from anyone
  reading the DOM.

### A visual system
- Rebuilt the plugin's styling on **semantic design tokens** instead of reading
  Discord's own CSS variables directly, so materials and colours share one
  source of truth instead of drifting per surface.
- **Contrast pass**: Weather's now/forecast rows and Orion's task rows sit on
  the same row surface every other list item already uses, which is what was
  dragging their secondary text under AA. Disabled buttons now read as clearly
  off instead of a faded version of "on."
- Every icon button now has a consistent **32px** interaction target, and
  **focus rings** appear on controls that had almost none before.
- **Acrylic and Glass materials now reach every widget.** They used to stop at
  list rows, leaving Weather's cards and Orion's task rows solid regardless of
  the material you picked. Acrylic now tints those too; Glass deliberately
  leaves them on the solid row surface, since a translucent wash was dropping
  their secondary text below AA contrast.
- A round of light-theme fixes: dropdown menu text was rendering black on every
  option but the selected one, the popup composer stayed bright against a dark
  popup on a light base theme, and the seam between the dashboard panel and
  Discord's own rail is now a gradual handoff instead of a hard line near the
  bottom.

### Widget headers
- Every widget header now shows an **icon**, and where there's something worth
  saying, a short **summary line** that stays visible even while the widget is
  collapsed - Saved Messages shows its count, Pinned Friends shows how many are
  pinned and how many are active, and so on.
- A quiet **unread dot** appears on a collapsed header when a widget holds
  something unread and isn't already showing a badge count, including group
  DMs, which Discord internally files as "voice" and had been left out.
- Pinned Friends caps its grid at ten tiles with a **Show more** toggle beyond
  that, so pinning deep into your friends list no longer grows the card without
  bound.

### Customize panel, docked
- **Customize is now a docked side panel instead of a modal**, open alongside
  the dashboard, so every change previews against the real thing rather than a
  modal floating over a frozen backdrop.
- Every appearance control now has real structure for assistive tech: section
  headings, grouped segmented controls, and sliders that speak their value
  (with units) instead of leaving it visual-only. Closed two target-size gaps
  in the panel's own controls along the way.

### Stepping aside for Discord's own theme editor
- When Discord's own "Customise your theme" panel docks alongside the
  dashboard, the dashboard now narrows to make room instead of running
  underneath it. Discord exposes nothing to key off directly, so this works by
  watching the page's geometry, and this release hardened that detection
  through several passes so it holds up across zoom levels, window resizes and
  reopening the dashboard with the editor already open.

### Quick Tools
- **Timer and stopwatch survive a restart.** Closing Discord no longer loses a
  running countdown or stopwatch; both pick back up from wall-clock time on
  reload. A timer that finished while Discord was closed still fires its toast
  and chime once you're back, but only within an hour of expiring - past that
  it's dropped quietly instead of going off as stale noise.
- Stopwatch gains a **Lap** button (up to twenty, cleared on Reset). Laps
  themselves don't survive a restart, only the running or paused state does.
- The timer's minutes/seconds fields split into three narrower **hours,
  minutes, seconds** fields.
- **World clock zones now live in the Clock tab** - add and remove zones
  without leaving Quick Tools. Zone input is checked against the real IANA zone
  list plus a small UTC/GMT allowlist, so an ambiguous abbreviation like BST can
  no longer resolve to the wrong zone, and any zone already saved that no
  longer resolves is dropped automatically.

### Now Playing
- The **Spotify** widget is now **Now Playing** and follows any music platform
  Discord can see a listening activity for, not only Spotify. Spotify stays the
  preferred source when it's available, since it carries richer data (album art,
  a working "open in Spotify" link) than a generic Rich Presence activity does.

### Weather
- Your own **refresh interval** (five minutes minimum, to stay polite to
  Open-Meteo) and a **last updated** line, so a forecast that hasn't refreshed
  yet doesn't look like a live one.

### Quick chat popup
- **Quick reactions are drawn from your own emoji**, favourites first, instead
  of six fixed unicode reactions, and are reachable from the message menu as
  well as the hover row.
- **Clicking a reply jumps to the message it answers** - scrolling to it and
  highlighting it if it's already loaded in the popup, or opening the real
  channel and jumping to it if not.
- A real **performance fix** for sluggish scrolling: message rows are now
  memoised so one incoming message no longer re-renders every row on screen,
  and the backdrop no longer blurs the whole viewport on every frame.

### Quick Access
- **Text channels now list above voice channels** per server, matching
  Discord's own sidebar order.
- The DM bucket is renamed **Group DMs** - now that right-clicking a friend
  pins them separately, group DMs are the only thing left there - and gets a
  real avatar instead of a text "DM" chip.
- Occupant avatars on a voice row now show only while it's collapsed; expanding
  the row already lists everyone by name, so the avatars were redundant there.

### Fixed
- **"Collapse when empty" now actually collapses a widget**, instead of the
  placeholder it shipped as in 2.9.0. It's currently wired up for Now Playing
  only; every widget still gets the "When empty" menu, but Now Playing is the
  one that acts on Collapse today.
- The collapse a widget applies automatically for being empty no longer
  overwrites your own manual collapse choice - toggling it back open now works
  instead of getting stuck collapsed.
- Hiding an empty widget no longer leaves a phantom gap in its column.
- The "When empty" context menu now reflects the choice you just made instead
  of showing a stale selection, and no longer shares its selection state across
  different widgets.

## 2.9.0 - 2026-08-03

### Widget modularization
- The three-widget **Integrations & Notes** card split into three independent widgets:
  **Weather**, **Spotify**, and **Quick Notes** - each collapsible, hideable, and
  draggable into any position.

### Quick Tools: one tool at a time
- **Quick Tools now shows one tool per tab** (Clock, Timer, Stopwatch, Timestamp,
  Calculator), remembering your selection across sessions. The **Timer and
  Stopwatch tabs display a dot** while running, so a background timer is never
  silently hidden.

### Per-widget "When empty" preference
- All widgets now show a **"When empty"** option in their right-click menu with three choices:
  **Keep visible** (always show), **Collapse when empty** (not yet rendering; the
  collapse mechanism arrives in a later release), and **Hide when empty**. Spotify
  defaults to hiding itself when nothing is playing.

### Infrastructure
- The widget registry is now an import-free module so its migration logic can be
  verified outside the build.

## 2.8.0 - 2026-07-20

### Appearance, dialed back
- Removed the **Frosted** and **Flat** materials, the **Match Discord theme** toggle
  and the film grain option added in 2.7.0. Materials are back to three: Classic,
  Acrylic, Glass.
- All six presets (Magenta, Nord, Dracula, Catppuccin Mocha, Rosé Pine, Mono)
  retuned to subtle Acrylic/Glass looks. Presets deliberately leave your
  background alone now - that's yours to choose.
- New installs default to a solid `#171717` background (Discord's own dark
  surface) instead of following the client theme.

### Quick Access
- **Pinned group DMs work like DMs again.** Discord reports them as
  voice-capable, so they'd become voice-only rows. A single click now opens
  the chat popup, a double-click starts or joins the call, and Enter/Space
  still expands the row to see who's in the call.

### Greeting
- The hero summary line is now clickable: it opens a small **notification
  panel** listing your mentions and unread DMs, with a dismiss on each row and
  a **"Mark all read"** - so clearing them still works even with the Inbox
  widget hidden.

## 2.7.0 - 2026-07-20

### Appearance
- Two new materials: **Frosted** (heavy glass) and **Flat** (opaque, high-contrast, accessible - drops the surface tint so text stays AA-legible at any colour/intensity).
- Optional **film grain** overlay that removes gradient banding.
- **Theme presets**: Magenta, Nord, Dracula, Catppuccin Mocha, Rosé Pine, Mono - one click each.
- **Match Discord theme**: derive the primary/accent from your live Discord/Nitro theme; the colour pickers dim while it's on.

### Accessibility
- Full `prefers-reduced-motion` pass, including the body-portaled dropdown and popup animations; the Flat material is a fully accessible, blur-free option.

## 2.6.3 - 2026-07-15

### Fixed
- **The timestamp "Copy" button now works.** The Quick Tools timestamp builder
  (and the message Copy action in the chat popup) used a fragile clipboard lookup
  that failed in the desktop app for everyone. Both now use the client's own
  clipboard helper - `DiscordNative` on desktop, the web clipboard in the browser
  build - so copying is reliable everywhere.

### Changed
- Plugin author is now shown as the handle **dotkay** rather than a personal name.
- Added plugin **tags** (Utility, Friends, Organisation, Chat) so it surfaces in
  Vencord's plugin search.

### Security re-audit
- Full line-by-line security, performance and Discord-ToS re-audit (first since
  v0.8.0). **No critical, high, or medium findings** - no token access, no
  injection sinks, one opt-in allowlisted host (Open-Meteo), balanced
  listeners/timers, and zero automated API activity. Write-up in
  [SECURITY.md](SECURITY.md).
- Fixed two trivial lifecycle nits found in the pass: a pending Quick Tools timer
  and the reminder scheduler's one-shot startup timeout could each fire once
  after the plugin was disabled. Both are now cleared in `stop()`.

## 2.6.2 - 2026-07-14

### Added
- **The Quick Tools timer now plays a soft chime when it reaches zero** - a
  short, gentle three-note ding (Web Audio, nothing jarring) alongside the
  existing toast. It fires even if the Quick Tools card is collapsed or the page
  is closed, because completion is now driven by a background timer rather than
  the on-screen countdown. New setting **"Play a soft chime when the Quick Tools
  timer reaches zero"** (on by default) to turn it off.

## 2.6.1 - 2026-07-14

### Fixed
- **Quick Tools no longer reset when the widget is collapsed.** Collapsing the
  card unmounts its body, which was wiping the stopwatch, timer and calculator
  back to zero. Each tool's state now lives outside the component, so a running
  stopwatch or timer keeps counting (it's tracked by absolute time, so it stays
  accurate even while hidden) and the calculator and timestamp builder keep their
  values across collapse, closing the page, and reopening. True set-and-forget.

## 2.6.0 - 2026-07-14

### Release polish + hardened Orion bridge

- **Hardened the Orion bridge for true plug-and-play.** The cross-plugin
  connection is now handled by a dedicated client (`orionBridge.ts`) that treats
  the `window` bridge as fully untrusted: it validates the object's shape and
  **version**, sanitizes every dashboard row, and wraps all cross-plugin calls so
  a malformed or throwing engine can never crash the widget or the page. The
  widget now distinguishes "not installed" from a "version mismatch" and says so.
  On the engine side the published object is frozen and only ever removed if it's
  still ours.
- **New GitHub banner** and a README refresh, with a clear **Orion risk
  disclaimer** (account-automation warning) front and centre.
- **Idiot-proof [SETUP.md](SETUP.md)** rewritten for first-time builders, with a
  separate, warning-led walkthrough for adding OrionQuests on top.

## 2.5.0 - 2026-07-14

### Orion widget (optional)

- New **Orion** widget: a compact remote control for the separate OrionQuests
  plugin. A live status pill (Idle / Running / Stopped), **Start**, **Stop** and
  **Status** buttons, and a per-quest progress list that updates in real time.
- **Off by default.** It only appears once you enable it under **Add Widget**,
  and it stays inert - showing a short "enable OrionQuests" prompt - unless that
  plugin is also installed and enabled. At a glance never depends on it to build
  or run.
- Widgets can now ship hidden by default; existing layouts are migrated so a new
  default-hidden widget starts hidden rather than popping into view.

## 2.4.0 - 2026-07-14

Release polish. No behaviour changes.

- README rewritten for GitHub: badges, highlights, a tighter widget table, and a
  quickstart that links out to the full guide.
- SETUP.md restructured around two paths: fresh install, and adding the plugin to
  an existing source build alongside your own userplugins (including restoring a
  plugin after a fresh Vencord checkout). Known limitations moved here.
- Repo-wide typography and copy pass; commit history tidied.

## 2.3.2 - 2026-07-13

### @mentions scoped to the conversation
- **Fixed: the popup's @mention suggester offered people who aren't in the
  chat.** It was seeding candidates from your whole friends list as a fallback
  pool. Suggestions now come strictly from the conversation itself - a 1:1 DM
  offers its two participants, a group DM its recipients, and a server channel
  that server's members. Nobody outside the chat is mentionable from it.

## 2.3.1 - 2026-07-13

### Popup follows new messages properly
- **Fixed: new messages no longer require manual scrolling.** The auto-scroll
  was keyed on the message *count*, but Discord's store windows its cache -
  once ~50 messages are held, each arrival drops the oldest and the count never
  changes, so the scroll never fired. It now keys on the newest message's ID.
- **Native-style behaviour**: at the bottom, new messages pull the view down
  (with a second pass once images/embeds get their real height). Scrolled up
  reading history? You stay put - a **"n new messages - jump to latest"** bar
  docks to the bottom of the chat instead, exactly like the real client.
  Clicking it (or scrolling to the bottom yourself) clears it. Your **own**
  sends always jump down.

## 2.3.0 - 2026-07-13

### Server headers show what's waiting
- Each Quick Access **server section header** now carries its own indicator: a
  red **mention badge** (with count) when any watched text channel inside has
  mentions, or a subtle **unread dot** for plain unreads - visible while the
  section is collapsed, so you never dig through channels to find the ping.

### Release housekeeping
- **[SETUP.md](SETUP.md)**: full from-scratch install guide, including running
  At a glance **alongside your own userplugins** (every folder in
  `src/userplugins/` is bundled automatically - restoring a plugin after a
  fresh Vencord checkout is just putting its folder back and rebuilding),
  updating, and troubleshooting. README install section slimmed to a quick
  version that links it.
- Dead code purged: leftover pre-Modal prompt/customize chrome CSS, the old
  flat Quick Access section styles, two unused icons, and an internal-only
  export. A class-usage audit now comes up empty.

## 2.2.0 - 2026-07-13

### Theme-adaptive contrast
- The plugin now **measures** whether the running theme is light or dark (from
  the resolved text colour, so Nitro gradient themes count too - re-checked
  live when the theme changes) and adapts. On light themes the cards switch
  from Discord's black-alpha surfaces (the muddy grey slabs in the mint/citrus/
  candy screenshots) to **white glass**, and every hard-coded white-ink hover,
  border and field flips to dark ink - rows, inputs, dropdowns, inbox tabs,
  the popup banner, drag slots, all of it. Dark themes look exactly as before.

### User area - full-bleed, fading nameplate
- The rounded card at the bottom-left is gone. The **nameplate now wraps the
  entire bottom-left user area**, flush to the edges - and **fades out starting
  ~5px from its top**, dissolving upward into the sidebar so it reads as part
  of the theme instead of a box on top of it.
- The strip itself is now **transparent** (the theme's own sidebar shows
  through), and Discord's native user panel + game-activity chip are hidden
  outright while At a glance is open, so nothing ever bleeds through behind it.
- Control icons adapt too: dark ink on light themes with no nameplate; light
  ink whenever nameplate art (with its scrim) is behind them.

## 2.1.3 - 2026-07-12

### @role mentions in the suggester
- `@query` now also matches **roles** you're allowed to mention: roles the
  server marks mentionable, or every role when you hold **Mention Everyone** in
  that channel - the same rule the native autocomplete applies. Role rows show
  the role's colour dot and name (in its colour); picking one inserts a real
  `<@&id>` ping. Members list first, then roles, prefix matches on top.
  `@everyone`/`@here` are deliberately not suggested.

## 2.1.2 - 2026-07-12

### @mention suggestions in the quick-chat popup
- Typing `@name` now pops the same style of suggester as `:emoji` - matching
  **members** appear with their avatar, display name and `@username`; ↑/↓ to
  move, Enter/Tab (or click) to insert a real `<@id>` mention, Esc to dismiss.
  Candidates come from the channel's own recipients, the guild's loaded members
  and your friends, prefix-matches ranked first (Discord's own autocomplete is
  bound to the full channel view and doesn't fire for our standalone composer).

## 2.1.1 - 2026-07-12

### Inbox DM previews show the real latest message
- The DM preview used `channel.lastMessageId`, which lags for channels you
  aren't viewing - so it surfaced a **stale cached** message instead of the new
  one. It now reads the authoritative latest id from `ReadStateStore` and pulls
  the newest message for the shown DMs (once each, bounded to what's on screen)
  so the preview is actually the last message. If it can't be fetched, it falls
  back to an honest **"New message"** rather than an old one.

## 2.1.0 - 2026-07-12

### Inbox → command centre (Mentions + Direct Messages)
- Renamed **"Inbox - Recent Mentions"** to **"Inbox"** and gave it **tabs**:
  **Mentions** (Discord's recent-mentions inbox, as before) and **Direct
  Messages** (every unread DM/group DM, pinned friend or not - avatar, name,
  message preview, unread badge; click opens the quick-chat popup, ✓ marks
  read). Each tab shows its own unread count; "Mark all as read" acts on the
  tab you're viewing.

### Greeting header counts DMs
- The greeting summary now includes **unread Direct Messages** (from anyone,
  pinned or not) alongside mentions, unread channels and due reminders - so the
  "what's waiting" line actually reflects your DMs.

### Fixes
- **Timestamp builder alignment**: its date field and style dropdown overhung
  the card's right edge (missing `border-box`); they now sit flush with the
  preview row, one aligned column.
- **Behaves more like a page**: clicking Discord's home / Direct-Messages button
  while At a glance is open now dismisses it and returns you to Friends, and the
  rail user strip sits above the native user panel / game-activity chip so they
  no longer poke through the corner. (At a glance remains an overlay over the
  `@me` home rather than a separate route - see notes.)

## 2.0.6 - 2026-07-11

### Burst spacing: uniform, true 3px
- The header row's message root kept its own cozy bottom padding, making the
  first gap in a burst ~2px wider than the rest. The root box is now flattened
  on every row, so the 3px line gap is the single source of truth - identical
  between all lines of a burst, ~25% tighter overall.

## 2.0.5 - 2026-07-11

### Burst spacing, the box that was actually guilty
- v2.0.4 collapsed the wrong box: the visible ~16px gap came from **our own row
  wrapper**, which borrows Discord's search-result "message" class - and that
  class pads every row vertically. Row wrappers no longer carry vertical
  padding; line rhythm is now owned entirely by the plugin (3px between burst
  lines, 17px between groups), so bursts finally stack like wrapped lines.

## 2.0.4 - 2026-07-11

### Burst messages compact to line breaks
- With headers/avatars hidden, continuation messages still sat far apart: each
  standalone message row keeps reserving its full cozy-row box (min-height and
  padding for the avatar + header it *thinks* it renders). Continuation rows now
  collapse that box, so a same-author burst stacks like plain wrapped lines -
  one header, then each message a line break apart, matching the native client.

## 2.0.3 - 2026-07-11

### Grouping fixed for real; emoji suggestions built in
- **Message grouping**: verified in Discord's own message chunk that the
  standalone message component renders its header **unconditionally** (the
  `groupId` prop is ignored), and that the header is a design-system Heading
  whose h1-h6 level comes from React context - which is why hiding `h3` (or a
  mangled `header_` class) did nothing. Continuation rows now hide the header at
  **any heading level**; bursts finally pack like the native client.
- **`:emoji` suggestions are now our own popup.** Discord's built-in
  autocomplete state machine never activates for this standalone composer, so
  the popup is implemented in the plugin: type `:na` and matching emoji appear
  above the input - same frecency-ranked `EmojiStore` search the native popup
  uses, keyboard steering (↑/↓, Enter/Tab to insert, Esc to dismiss), custom
  and unicode emoji both supported.

## 2.0.2 - 2026-07-11

### Native-style message grouping (actually) + emoji suggestions
- **Grouping now collapses same-author bursts properly.** The rule that hides
  the repeated name/timestamp header targeted a `[class*="header"]` class that
  Discord had renamed - avatars vanished, headers didn't. The header is now
  matched structurally (the row's `<h3>`, stable across Discord's class-hash
  renames). Group spacing tightened to Discord's own ~17px between groups, zero
  within a burst, and the extra per-row gap is gone.
- **`:emoji` suggestions**: the composer's autocomplete overrides
  (`alwaysUseLayer`/`small`) were modal-era flags routing suggestions into a
  layer that no longer exists - they rendered nothing. The composer now uses
  the sidebar's own autocomplete config, which renders suggestions inline above
  the input (exactly like Discord's thread sidebar).

## 2.0.1 - 2026-07-11

### The real picker fix (and emoji suggestions with it)
- Since the popup left Discord's modal system (v1.4.0) it has rendered in the
  plugin's **own React root** - which has none of Discord's context providers.
  The expression picker and the `:emoji` autocomplete both render through
  Discord's layer system, which silently renders **nothing** without those
  providers. That's why both worked in the modal era and vanished after.
- The popup host now renders **inside Discord's tree** (from the sidebar tab,
  which Discord always renders) and portals its DOM to `document.body` - React
  portals keep context, so the **GIF/emoji/sticker picker** and the
  **`:name` emoji suggestion popup** get their providers back, while the
  backdrop keeps its deterministic viewport centring.
- Timestamp builder: the preview now renders as a proper field, aligned with
  the inputs above it, instead of floating bare text.

## 2.0.0 - 2026-07-11

First public release. A large cleanup + feature pass on top of 1.8.0.

### Fixed
- **GIF / emoji / sticker picker opens again in the popup.** The picker renders
  into an absolutely-positioned layer anchored to the nearest positioned
  ancestor; with none in the popup it anchored to the full-screen backdrop and
  opened *above the viewport*. The composer footer is now that anchor.
- **Saved-message rows reliably jump to the message.** Clicking a bookmark now
  navigates to the channel first, then flash-highlights the message -
  `jumpToMessage` alone could silently no-op on old messages in unloaded
  channels. (The speech-bubble still opens quick chat instead.)

### New
- **Timestamp builder** (Quick Tools): pick a date/time and a style, copy a
  `<t:…>` code that renders in every reader's own timezone - with live preview.
- **Formatting toolbar** on the popup composer: bold / italic / strikethrough /
  code / spoiler, applied to your selection.
- **Quick Notes structure**: `- ` bullets, `- [ ]` checkboxes and `---` dividers,
  with a toolbar to insert them and a rendered view where checkboxes are
  clickable. Notes stay plain text underneath.
- **Events rolled up per server** with icons, counts and absolute start times
  ("Saturday at 19:00") alongside the countdowns.
- **Unread "NEW" divider** in the popup at your last-read point, and the popup
  now **remembers your scroll position** per channel (won't yank you down while
  reading history; still follows new messages when you're at the bottom).
- **Pinned Friends empty state** when everyone's offline (instead of a blank card).

### Cleanup
- Menu layouts aligned across friends/channels (navigate → edit → order →
  remove); channel "Remove" is now "Unwatch Channel".
- Shared hooks/util consolidated (`useNow`, `usePoll`, `guildAcronym`); message
  rendering split out of the popup into its own module; stylesheet sections
  renamed from release-number strata to what they actually contain; dead rules
  dropped.
- The bundle-verification harness ships in `tools/verify-bundle.js` - it
  catches the "one bad top-level line kills all of Vencord" class of bug in
  seconds after any build.

## 1.8.0 - 2026-07-10

### Drag & drop reordering - friends and servers
- **Pinned Friends** and **Quick Access server sections** now reorder by
  click-and-drag - same ghost + dashed-slot animation as widget dragging, at row
  scale. `Esc` cancels a drag; kebab Move up/down still works.
- A **6px movement threshold** keeps plain clicks working exactly as before
  (click a friend = quick chat, click a server header = collapse/expand) and a
  press on any button inside a row never starts a drag. Row drags can't be
  misread as dragging the whole widget (that still only starts from the card
  header grip).
- The 2-per-row friends grid is preserved during drags (the dashed slot occupies
  the landing cell), works with hidden offline friends (their positions are
  kept), and both orders **persist across sessions and restarts** - friends via
  the pinned list, servers by regrouping the watched-channel order.
- Server sections stay collapsible; channel rows inside a section deliberately
  don't drag (server-level ordering only, as designed).

## 1.7.0 - 2026-07-10

### Customization - independent greeting-name colour
- New **Name colour** option in Customization: **Match accent** (default - the
  greeting name keeps following the Primary → Accent gradient) or **Custom** -
  pick any colour, completely unbound from the background/accent theme, so your
  name can't blend into the page any more. Persisted like every other
  customization; Reset to defaults returns it to Match accent.

## 1.6.1 - 2026-07-10

### Pinned Friends - two-column layout
- Replaced the packed pill layout with a **2-per-row grid**: each friend keeps
  the original row shape (avatar + info left, action buttons at the right edge)
  at half width, so twice as many friends fit in the same vertical space without
  the cramped packing. Names/activities ellipsize inside their column.

## 1.6.0 - 2026-07-10

### Channel popup - composer reworked for reliability
- **Text no longer vanishes while typing.** Every incoming message re-rendered
  the popup, which could reset the live chat input mid-type (the ~50/50
  disappearing text). The composer element is now memoised, so message activity
  can't touch what you're typing.
- **Reply actually replies now.** The popup uses Discord's real chat input, but
  *we* own the send - so a pending reply's reference is explicitly attached
  (`getSendMessageOptionsForReply`) and cleared after, instead of relying on the
  embedded container to do it (which it didn't). The "Replying to X" bar is real
  and the sent message is a real reply.
- **Edit** stays our own reliable inline editor (saves via `editMessage`).
- The popup's composer is the controlled chat input rather than Discord's full
  container. Trade-off: the emoji/GIF/sticker pickers and message send are
  handled directly (no modal guard fighting them); inline upload *previews* are
  less rich than the full channel, but **Go to channel** remains for heavy
  composing.

### Pinned Friends - compact tiled bubbles
- Pinned friends are now **content-sized rounded pills that wrap**, instead of
  full-width rows with a big empty gap between the name and the buttons. Same
  style, same avatar/status/actions - just packed together so far more friends
  fit in the same space. Reordering (kebab → Move up/down) is unchanged.

## 1.5.0 - 2026-07-10

### Channel popup - native-feel polish
- **Themed scrollbar.** The chat now uses Discord's own thin themed scrollbar
  (`--scrollbar-thin-thumb`) instead of the jarring white OS bar - same as the
  rest of At a glance.
- **Message grouping.** Consecutive messages from the same author within ~5
  minutes now collapse into one block (avatar + name/timestamp shown once),
  matching Discord's native grouping, so bursts read cleanly.
- **Reply - now real, with an indicator.** Reply sets Discord's pending reply
  (the channel's real composer sends with the reference) *and* shows a
  **"Replying to X"** bar above the input, driven by `PendingReplyStore` - click
  ✕ to cancel. No longer just an appearance action.
- **Edit - now real, with an indicator.** Editing your own message opens a
  controlled inline editor (accent-bordered, "Editing message" badge; Enter
  saves via Discord's `editMessage`, Esc cancels). The native inline editor
  needs the full message-list context the popup can't provide, so this is our
  own reliable editor rather than a jank passthrough.

## 1.4.0 - 2026-07-10

### Channel popup - rebuilt so it's actually centred (and the pickers behave)
The popup was a Discord *modal*, and Discord's modal layer on this build is
wrapped in a CSS transform. That silently trapped every attempt to position it
(`position: fixed` resolves against the transformed ancestor, not the screen),
which is why it kept landing off to one side no matter what I set. It also meant
a real modal was open, whose outside-click guard kept dismissing the GIF/emoji
picker on mouse-move.

Fix: the popup is no longer a Discord modal. It now renders **inside At a
glance's own layer** - which has no transform - as a flex-centred card, exactly
like the Ctrl-K command palette (which always centred correctly). Result:
- **Dead-centre of the viewport**, deterministically. No modal layout to fight.
- **Wider, comfortable 852px** (was ~610px).
- **Pickers no longer fight a modal** - moving the mouse with the GIF/emoji/
  sticker panel open should no longer dismiss it.
- Click the dimmed backdrop or press **Esc** to close. Reply/edit, grouping,
  attachments and the primary/accent-tinted input bar all carry over.

## 1.3.2 - 2026-07-10

### Channel popup - actually centred now, 710px wide
- This build of Discord neither centres the modal reliably nor honours a CSS
  width override on its box (the box has no stable role/class to target). So the
  popup now **owns its own position**: it finds the real modal box (the child of
  Discord's modal layer) and pins it **dead-centre of the viewport** at a fixed
  **710px** width. Height is left as-is. No more floating off to one side, no
  more depending on Discord's layout for centring.

## 1.3.1 - 2026-07-10

### Channel popup - sizing done the native way (finally stable)
- Stopped fighting the dynamic-size modal (which kept ballooning to full-width)
  and the JS width-hacking around it. The popup is now a **fixed-size modal
  (`size="lg"`)** - Discord's own modal layer **centres it** for us, the way it
  worked a few versions ago. A single scoped CSS rule pins the exact width
  (`min(960px, 92vw)`); no DOM walking, no resize handles, no drift.
- The input-bar theming (primary/accent) now resolves via `:root`-published
  `--vcg-*` colours, so it works regardless of the modal's portal - the earlier
  DOM-walk was also silently missing, which is why the input wasn't tinting.

## 1.3.0 - 2026-07-10

### Channel popup
- **Slimmer, fixed window size.** The popup is now pinned to a comfortable
  centred width (`min(1000px, 90vw)`) - the whole modal (header, messages,
  composer) shares one width instead of the messages sitting in a narrow column
  inside a full-width shell.
- **Messages are grouped** the way Discord groups them: consecutive messages
  from the same author within ~7 minutes collapse into one block (avatar/name
  shown once), so more fits on screen and reads cleaner.
- **Reply & edit** from the popup: **right-click** a message for Reply / Edit
  (your own) / Copy Text, or **double-click** it (reply to others, edit your
  own). These dispatch Discord's own reply/edit actions, so the composer picks
  up the pending reply and your own messages open the inline editor.
- **Input bar follows your colours.** The composer is retinted from your chosen
  primary/accent theme (via Discord's own `--channeltextarea-background`),
  scoped to the popup only, instead of the flat default grey.
- **GIF/emoji/sticker pickers** are handed the popup's modal key + outer-click
  guard so a pointer move over the modal no longer dismisses an open picker.

### Quick Access
- **Collapse watched channels per server.** Watched channels are now grouped
  under a collapsible header for each server (voice then text), with a DM
  bucket for private channels. Collapsed servers persist across sessions. The
  redundant per-row server name/icon is hidden inside a section.

## 1.2.0 - 2026-07-10

### User panel - nameplate wrapped around a fixed strip
- The bottom-left user panel is rebuilt as a **fixed-size vertical card** under the
  server-icon rail: avatar (with status ring) on top, then mute / deafen / settings.
  **Resizing is gone entirely** - no pull-bar, no horizontal drag, just a set size
  that blends into the sidebar.
- Your Nitro **nameplate** now wraps the *whole* card as its background
  (`object-fit: cover`, so it's never stretched or squashed) with a legibility
  scrim on top. Animated nameplates play (respecting reduced-motion), falling back
  static → plain themed panel.

### Channel popup - slimmer, fixed, fully functional
- Fixed **set size** (`min(760px, 92vw)`) - no more mashing to the edge, crushed
  layout, or off-screen resize drags. Resizing removed.
- **Full chat functionality**: replies, reactions, message editing, GIFs/emoji from
  your own Discord favourites, and **image/file attachments** now work in-popup -
  the popup embeds Discord's real channel text area, with a graceful fallback to the
  minimal composer if that internal changes. `subscribeToComponentDispatch` is on so
  inline edit and reaction UI update live.

### Fixed
- **Widget positions now persist.** Dragging & dropping a widget no longer snapped
  every *other* widget back to its default slot - the order sanitizer was rebuilding
  the default order on every save/load; it now preserves your arrangement across
  moves, sessions and restarts.
- **DM sidebar can't be resized through the overlay anymore.** Discord's sidebar
  resize handle (z-index 101) was poking through At a glance; the overlay now sits
  above it (z-index 150), so that grab no longer clips through.

## 1.1.2 - 2026-07-10

### Channel popup - resize reworked
- Popups are now a **dynamic-size** modal whose width WE own via an inner sizer
  div, instead of fighting Discord's (mangled) modal size classes. This fixes
  the popup mashing to the screen edge, the invisible/misplaced resize zones,
  and the drag flinging things off-screen.
- **Visible resize edges**: a clear grabber bar on each side, brightens on hover;
  drag to resize, double-click to reset. Width persists. Default is a comfy
  920px (was an over-wide 1150).

### User panel
- **Removed horizontal resizing** - only the vertical nameplate pull remains.
- **No more merged/double panel**: the strip is opaque again (so it covers
  Discord's own user panel behind it) but uses `background-attachment: fixed`
  so a client-theme gradient lines up with the server rail - blending instead
  of contrasting.
- Nameplate reveal is capped modestly so expanding it won't mush up over the
  server-rail icons.

> Note: at non-default Discord zoom the fixed user strip can still crowd the
> server-rail icons; if it does on your setup, let me know your zoom level.

## 1.1.1 - 2026-07-10

### Fixed
- **User panel blends into the sidebar**: the strip is now transparent, so
  Discord's own themed server rail shows through instead of a hard dark block
  contrasting the server icons above it.
- **Nameplate decoration** (not the full-profile banner): the expandable area
  now shows your Nitro **nameplate decoration**, visible by default and
  drag-to-reveal-more via the faint handle above your avatar; it fades softly
  into the transparent strip.
- **Channel popups actually resize now**: width is set directly on the modal
  (targeted by its stable `role="dialog"`) instead of a mangled size-class
  selector, so the banner grip and the new draggable left/right edges work.
- **Popups stick to the newest message** instead of rocketing to the top: a
  bottom anchor is scrolled into view on open and as messages stream in.
- **Inbox "Mark all as read" now persists**: it deletes each mention from
  Discord's inbox server-side (same call the per-row ✕ uses), so they don't
  re-appear on the next fetch.

## 1.1.0 - 2026-07-10

### Background override (for custom-theme users)
- New **Background** control in Customization: **Match theme** (default, follows
  your Discord/Nitro theme), **Solid** (pick a colour), or **Gradient**
  (Primary → Accent at your chosen Direction). Solid/Gradient paint an *opaque*
  page background **and** make the widget cards opaque, so a busy client theme
  can no longer bleed through and wash everything out.
- **Surface opacity** slider (override modes) to tune how solid the cards are.
- **Contrast guardrail**: if an override background is light, text/icon colours
  automatically flip to dark for legibility (the channel popup keeps its safe
  dark base so native messages stay readable).
- Colour-intensity tint still layers on top, and the aurora hides itself over an
  override background to avoid noise.

## 1.0.0 - 2026-07-09 - Stable release

First stable public release. Verified against Discord **Stable**, security-audited
(`SECURITY.md`), and hardened against cross-session issues.

- **Themed scrollbars**: the timer dropdown (and every scrollable area in the plugin)
  now uses Discord's own thin scrollbar styling instead of the OS default.
- **Final pass**: re-audited all sinks (no injection, no token exposure, one allowlisted
  network host); confirmed every timer/listener is cleaned up (no leaks across
  enable/disable or reload); confirmed config sanitization covers every field so old
  saves migrate cleanly; re-verified all Discord finds against a fresh Stable bundle.

Feature set (accumulated 0.5.0 → 1.0.0): overlay "At a glance" tab; Pinned Friends with
quick actions + incoming-call answering; Quick Access voice/text with live occupancy;
native resizable chat popups; Inbox mentions; Saved Messages; Upcoming Events + RSVP;
Quick Tools; Integrations (weather + forecast, Spotify, notes); Reminders with presets +
`HH:MM:SS` and background notifications; command palette; greeting hero; resizable
nameplate/profile-banner user panel; full material/colour customization.

## 0.8.6 - 2026-07-09

### Fixed
- **Reminder timer dropdown wouldn't open** (menu never appeared, caret stuck
  open). Root cause: the widget entrance animation leaves a `translateY(0)`
  transform on the widget slot, which makes it a containing block for
  `position: fixed`, pushing the fixed menu off-screen. The menu is now
  **portaled to `<body>`** so it escapes every ancestor transform/overflow and
  positions against the viewport correctly. Outside-click detection updated to
  account for the portaled menu.

## 0.8.5 - 2026-07-09

### Channel popup: drag the edges
- The popup can now be resized by grabbing its **left or right edge** and
  dragging (in addition to the banner grip). Symmetric, clamped, and the width
  still persists across sessions.

### User panel: profile banner
- The bottom-left user panel now shows your **set profile banner art**. Drag the
  faint line above your avatar **upward to reveal/expand it** (down to collapse;
  double-click to toggle). Height persists. Falls back to an accent wash when no
  banner is set; a bottom scrim keeps the avatar/name legible.

### Reminders
- Hardened the reminder rows so a timed reminder can never fail to render
  (relative-time formatting now degrades gracefully instead of throwing).
  Combined with the earlier dropdown fix, the timer presets + custom `HH:MM:SS`
  all populate and select correctly - rebuild and fully reload to pick this up.

## 0.8.0 - 2026-07-09

Hardening + polish pass; verified for Discord **Stable**. See `SECURITY.md`.

### Security
- Full audit - no vulnerabilities, no token exposure, no unnecessary requests
  (documented in `SECURITY.md`). Two defense-in-depth tightenings applied:
  Spotify album art restricted to Spotify's CDN; event-RSVP URLs now snowflake-
  guarded before construction.

### Cross-branch verification
- Every webpack find, patch, store, action, endpoint and CSS anchor verified
  against a fresh Discord Stable bundle. The native message renderer and chat
  input use finds byte-identical to Vencord's maintained `messageLinkEmbeds`,
  and both have graceful fallbacks - safe to run on Stable.

### Fixed
- **Reminders** now offer the full preset list again (5/15/30 min, 1 h, 3 h,
  tomorrow 09:00) **plus a custom `HH:MM:SS` countdown** (e.g. `1:30:00`,
  `90:00`), replacing the awkward date-time picker.
- **Voice channels update in near-real-time**: a 2-second poll refreshes
  occupancy/speaking while any voice channel is watched, since Discord doesn't
  reliably emit voice-state changes for guilds you aren't viewing.

### Changed
- **Saved Messages** reformatted to match the widget: a mini author avatar for
  DMs and the **server icon** for guild messages, with acronym fallbacks.
- **Channel popups are resizable** - drag the ↔ grip in the popup banner to set
  your width; it **persists across sessions** (double-click the grip to reset).

## 0.7.2 - 2026-07-09

### Changed
- Command palette hotkey now defaults to **Shift + Space** and is
  **rebindable** (plugin settings → Command Palette Hotkey; accepts combos like
  `ctrl+k`, `ctrl+shift+p`). The old Ctrl+K default collided with Discord's own
  quick switcher.
- The palette hotkey is now caught in the **capture phase** and stops
  propagation, so it fires *before* - and suppresses - Discord's matching
  shortcut. Plain combos (no Ctrl/Alt/Cmd) still yield to text inputs, so
  Shift+Space types a normal space when you're typing.
- The greeting hero's search hint reflects your configured binding.
- Refactored hotkey parsing/matching into one shared module (pin + palette).

## 0.7.1 - 2026-07-09

### Fixed
- The reminder timer dropdown clipped underneath the widgets below it. The menu
  now renders `position: fixed` off the trigger's rect (repositioning on
  scroll/resize) so it floats above everything regardless of card overflow or
  stacking context.

## 0.7.0 - 2026-07-09

Creative pass - bug fix plus a batch of features aimed at making At a glance
feel like a genuine home screen.

### Fixed
- **Reminder timer picker** no longer renders as an unreadable light-themed
  native `<select>`. Replaced with a fully themed, keyboard-navigable dropdown
  component (reusable across the plugin).

### New
- **Command palette (Ctrl/Cmd + K)**: a spotlight launcher over the view.
  Fuzzy-search and jump to any pinned friend (opens quick-chat), watched
  channel (join voice / open text popup), or saved message, plus quick actions
  like opening customization. Arrow keys + Enter, Esc to close.
- **Greeting hero**: a landing band atop the workspace - time-aware greeting
  with your name in an accent gradient, a live clock + date, a dynamic summary
  of what needs attention ("3 mentions · 1 reminder due"), and a Search button.
  Backed by a slow **aurora** that drifts in your chosen accent colours.
- **Background reminder notifications**: timed reminders now fire a real
  desktop/Discord notification when they come due even if the view is closed;
  clicking it opens At a glance. Fired-state persists so it never double-alerts;
  snoozing re-arms it.
- **Weather forecast**: the weather card now shows a 4-day outlook (emoji +
  hi/lo), from the same allowlisted Open-Meteo endpoint, unit-aware.

### Polish
- Widgets and the hero **fade + rise in with a staggered entrance** when the
  view opens (reduced-motion honoured).
- Assorted spacing, dropdown, and scroll-container refinements.

## 0.6.5 - 2026-07-09

### New widgets
- **Saved Messages (Bookmarks)**: right-click any message → *Save to At a glance*.
  Rows carry a plain-text snapshot (author, location, snippet) so they render
  instantly forever; click jumps to the message with Discord's native flash
  highlight, or open the channel in quick-chat. Capped at 100, IDs validated.
- **Upcoming Events**: scheduled events across all servers, soonest first, with
  live countdowns (30s tick), LIVE chip + one-click join when an event starts,
  and an RSVP bell wired to Discord's own endpoint - gateway echoes keep
  interest state and the list realtime.
- **Reminders**: free-text reminders with optional timers (presets, tomorrow
  9:00, or custom date/time). When one fires: the card glows with a subtle
  shine sweep and a red count badge (visible even collapsed), and the count
  joins the sidebar tab badge so you see it from anywhere in Discord.
  Snooze (15m), done, delete. Capped and sanitized like everything else.

### Pinned friends: incoming calls
- When a pinned friend rings you, their row highlights (green-tinted, white
  name), a green phone icon jiggles, and inline **Answer / Reject** buttons
  appear - answer joins the call, reject stops the ring via Discord's own
  call actions. Ringing rows show even if offline friends are hidden.

### Channel popup fixes
- **~44% wider** (602 → 1150px cap): the previous size token was invalid and
  the override targeted the wrong property; now uses the modal's real "large"
  size plus a scoped width rule.
- **GIF/emoji/sticker pickers actually open now**: Discord's picker buttons
  guard against clicks "from outside a modal while a modal is open" - the
  input needed its host modal's key (`parentModalKey`). Diagnosed from the
  minified guard, fixed by plumbing the key through.
- **Emoji suggestion popup** while typing `:emote` - enabled via Discord's own
  floating-layer autocomplete flags with the size-capped (`small`) variant so
  it never floods the popup.

## 0.6.0 - 2026-07-09

### Inbox - Recent Mentions (new Social widget)
- Wires Discord's real Inbox internals into a widget: `RecentMentionsStore`
  updates in realtime as mentions arrive; rows show author, location
  (#channel · server / DM), relative time and a two-line markdown snippet.
- Click a mention to open that channel in the quick-chat popup; per-row ✕
  dismisses the mention server-side exactly like the native inbox.
- **Mark all as read**: acks every mentioned channel (real read-state, badges
  clear everywhere) and empties the list.

### Nameplate user panel (bottom-left)
- The rail user strip is now **resizable**: drag its right edge (64-400px,
  double-click to reset). Past ~110px it flips from the compact vertical stack
  into a full user panel.
- In panel mode, your **Nitro nameplate** collectible renders behind your
  avatar and name - animated (webm) with static fallback, plain themed panel
  when no nameplate is equipped or assets fail; reduced-motion shows static art.
- Mute/deafen/settings become a horizontal row under the plate.

## 0.5.5 - 2026-07-09

### Channel popup: real Discord chat
- **Native chat input**: the popup now embeds Discord's actual message editor
  (the same component Discord uses in its own modals) in the fully-featured
  sidebar configuration - emoji, GIF and sticker picker buttons with the user's
  owned/favourited/recent content, mention & emoji autocomplete, all wired to
  the channel. GIF/sticker picks send directly; attachments and slash commands
  stay disabled by design ("Go to channel" covers those).
- **Native message rendering**: messages render through Discord's own message
  component (the MessageLinkEmbeds technique) - real markdown, embeds, image
  galleries, reactions and edited tags. Both native pieces have automatic
  fallbacks to the previous plain renderer/composer if Discord internals shift.
- **35% wider** (800px → 1080px, capped at 92vw), same height, done by scoping
  Discord's own `--modal-width-large` variable to our modal via `:has()`.

### Quick chat everywhere
- Clicking a pinned friend now opens their DM **in the popup** (created
  silently if it doesn't exist) - reply without leaving the view. The full DM
  is one click away (new external-link button / "Open Full DM" menu item).

### Voice: more alive
- **Speaking rings** on occupant avatars (green, live) for the channel you're
  connected to.
- **LIVE chip** for streaming users, camera icon for video, in expanded rows;
  streaming users get a red ring on inline avatars.
- **Join pulse**: newly-joined users pop in with a small entrance animation
  (reduced-motion respected).
- **Hover join button** on voice rows - double-click still works.

### Signals & polish
- The sidebar tab now shows an **aggregated mention badge** (red) or unread dot
  (white) across all pinned friends and watched channels.
- Zone accent dots: blurple for Social, green for Tools & Utilities.
- Cards get a subtle hover lift; Spotify card shows elapsed/total track time.

## 0.5.0 - 2026-07-08 (initial release)

First versioned release of **At a glance**, a Vencord userplugin. Clone/copy this folder
into `src/userplugins/` of a Vencord source checkout and build (`pnpm build`).

### Layout & integration
- Sidebar tab above the Friends button, styled and behaving like native rows
  (hover/selected states, native metrics).
- Overlay view that respects Discord's chrome: server rail stays visible and interactive,
  OS titlebar and window dragging untouched, native toolbar blanked (not covered) while
  open. Runtime chrome measurement, no hardcoded offsets.
- Native-style top bar; the "At a glance" title is the click target to exit. Esc, rail
  navigation, and logout also dismiss.
- Compact vertical user strip (avatar, mute, deafen, settings) under the server rail
  while open, with live mute/deafen state.
- Optional open-on-startup setting.

### Widgets (Social / Tools & Utilities zones)
- **Pinned Friends** - presence, live activity line, DM mention badges; quick-actions
  menu wired to Discord internals: Profile, Message, Start Call, Add Note, Change Friend
  Nickname, Ignore, Block, Unpin. Friend nicknames respected.
- **Quick Access Channels** - separate voice/text lists. Voice: occupant avatars,
  expandable occupant list with mute/deafen flags, double-click to join (permission
  checked). Text: native unread whitening + mention badges.
- **Text channel popup** - native Discord modal: live message history (Discord's own
  fetch + markdown parser), minimal composer in the native chat-input slot, viewing
  acks the channel, sticky "Go to channel" banner.
- **Quick Tools** - clock (local + configurable IANA timezones), stopwatch, countdown
  timer, eval-free calculator.
- **Integrations & Notes** - Open-Meteo weather with location search (only network
  integration; allowlisted endpoints, opt-in), read-only Spotify now-playing from
  Discord's local store, quick notes.
- **Client Performance** - renderer JS-heap + UI latency (honest metrics only).

### Customization
- Widgets: collapsible, hideable (Add Widget menu), drag-to-rearrange with dashed
  drop-slot ghost (Esc cancels; reduced-motion respected).
- Customization modal: Classic/Acrylic/Glass materials, primary + accent colours,
  intensity slider (capped rendering so 100% stays tasteful), 0-360° shine direction.
- Quick-pin hotkey, default Ctrl+Middle-click (suppresses Discord's default middle-click
  behaviour); keyboard combos supported.

### Security posture
- Persisted config: validated snowflake IDs, length-capped notes, clamped appearance
  values, allowlisted widget ids - all rebuilt field-by-field from untrusted storage.
- No eval/innerHTML; React-rendered text only; ErrorBoundaries throughout;
  per-account config isolation; CSP allowlist limited to two Open-Meteo hosts.
