# Security review - At a glance

Re-audited at **v2.6.3 (2026-07-15)**; first audited at v0.8.0. Scope: the whole
plugin (`src/userplugins/atAGlance/`), line by line, covering security, privacy,
performance/memory, and Discord ToS risk.

**Updated for v3.1.0 (2026-10-20), not re-audited.** 3.1.0 replaced the overlay
with a dashboard rendered inside Discord's own layout, and rebuilt how config is
loaded and saved. The sections below on patches, listeners, timers, the
dashboard's root and stored data were rewritten to match that code, and the
listener count was taken again. Everything else, and the findings in the summary,
is as audited at v2.6.3.

## Summary

**No critical, high, or medium findings.** The plugin cannot leak your Discord
token, makes no unnecessary network requests, has no code-injection surface, and
runs no automated API activity that could put an account at risk. Every mutating
action goes through Discord's own authenticated APIs - the plugin never sees,
stores, or transmits credentials.

Two trivial lifecycle nits found in this pass were fixed on the spot (a pending
Quick Tools timer and the reminder scheduler's one-shot startup timeout could
each fire once after the plugin was disabled). Both are now cleared in `stop()`.

## Token / credential exposure - none

- **No token access.** Grep of the entire plugin for `token`, `localStorage`,
  `document.cookie`, `authorization`, `getToken`, `.headers` finds only false
  positives (design "tokens", keyboard "token"). The plugin never reads the
  Discord token or any auth material.
- **All mutations via Discord's own APIs.** Notes, friend nicknames, block/
  ignore, event RSVPs, calls, message sends, acks, and voice joins all go
  through Discord's own `RestAPI` / action creators, which attach auth
  internally in the host. The plugin only ever passes snowflake IDs and text.

## Network surface - one integration, opt-in, allowlisted

- **The only outbound host family is Open-Meteo** (weather), and only after you
  explicitly pick a location. Requests are pinned to two hard-coded HTTPS
  endpoints (enforced by a wrapper that throws on any other URL), sent with
  `credentials: "omit"` and `referrerPolicy: "no-referrer"`, time-limited, and
  responses are schema-validated. CSP allowlist (`native.ts`) is limited to the
  two Open-Meteo hosts.
- **No other fetch/XHR/WebSocket/beacon** anywhere in the plugin.

## Media/URL sinks - all allowlisted to trusted hosts

- Message attachment images render only when `content_type` is `image/*` **and**
  the URL is on `cdn.discordapp.com` / `media.discordapp.net`.
- Nameplate art: the asset path is validated (`^[\w/-]+\/$`) and interpolated
  into a fixed `cdn.discordapp.com/assets/collectibles/` prefix - cannot break
  out to another host or inject query params.
- Spotify album art: restricted to Spotify's CDN (`i.scdn.co` / `*.spotifycdn.com`).
- Avatars and guild icons come from Discord's own URL builders.
- The single `window.open` (Spotify track) validates the 22-char track ID and
  uses `noopener,noreferrer`.

## Injection - none

- No `eval`, `new Function`, `innerHTML`/`outerHTML`, `insertAdjacentHTML`,
  `document.write`, or `dangerouslySetInnerHTML`.
- All user/remote text renders through React text nodes (auto-escaped) or
  Discord's own message parser/component.
- No dynamic `RegExp` built from user input (no ReDoS).

## Stored data - minimal, validated, isolated

- Persisted config (IndexedDB via Vencord `DataStore`) holds only: snowflake IDs
  (regex-validated), plain-text notes/reminders/snippets (length-capped),
  a weather location (name + clamped lat/lon), appearance values (hex + clamped
  numbers), and layout state (widget order / collapsed / hidden, collapsed guild
  sections).
- **No token, message-history, or PII is ever persisted.** Bookmarks store a
  plain-text snapshot + IDs; names/avatars are always resolved live.
- Loaded config is treated as untrusted and rebuilt field-by-field through an
  allowlist sanitizer (unknown keys dropped, lists deduped and hard-capped).
  No untrusted object is ever spread or merged → no prototype-pollution vector.
- Config is keyed per-account. Nothing is written until that account's saved
  data has loaded, and only ever to that account: a failed or overlapping load
  can't replace what is stored, a failed read is shown as one (and retried after
  2 s, 10 s and 30 s, then every 30 s) instead of falling back to an empty
  config, and switching accounts saves the old account's pending edit to the old
  account first.

## Performance & memory - no leaks

- **Listeners balanced.** Every `addEventListener` has a matching
  `removeEventListener` (19/19 call sites at 3.1.0). Window-level listeners are
  added either in the plugin's `start()` (removed in `stop()`) or in a React
  effect (removed in its cleanup). The dashboard layer's own are two `keydown`
  listeners and a capture-phase `click` listener, plus a Flux `CHANNEL_SELECT`
  subscription, all torn down when it unmounts. The layer has no window
  `resize` listener and no page watcher any more: Discord's layout sizes it.
- **Timers cleared.** Every `setInterval` lives in an effect with
  `clearInterval` cleanup, except the reminder ticker, which is a guarded
  singleton (`if (intervalId) return`) cleared in `stop()`. As of the v2.6.3 audit
  the Quick Tools countdown timeout and the scheduler's startup timeout are also
  cleared on `stop()`, and since 3.1.0 so are a pending config load retry (any
  unsaved edit is written at the same moment) and the 20 second fallback timer
  of an open-on-startup that is still waiting for Discord's layout, so nothing
  survives a disable.
- **One `MutationObserver`**, on the `class` attribute of `<html>`, so the
  dashboard can re-measure Discord's theme and the surface its cards sit on. It
  is shared by everything that needs the measurement: created for the first,
  and `disconnect()`ed after the last, along with the two hidden probe elements.
- **No separate React root.** The dashboard is rendered by an `AppView` patch
  inside Discord's own React tree, as one cell of its app grid, so there is no
  `createRoot` to mount or unmount and no container element to remove. Closing
  it makes the host render nothing, which unmounts the dashboard and runs the
  listener cleanup above. Disabling the plugin closes an open dashboard and
  clears the `data-vc-glance-open` attribute that hides Discord's user panel.
- **Webpack lookups are all `*Lazy`** - resolved once on first access and cached
  by Vencord's proxy, never searched on a loop.
- **Hot paths.** Clocks/stopwatch/forecast tick on local timers only (re-renders,
  never network); message rows in the popup are memo-friendly and grouped to
  match Discord, and the mention-member scan is capped (`MEMBER_SCAN_CAP`).

## Discord ToS / ban risk - none from this plugin

- **No automation.** No `setInterval`/`setTimeout` in the plugin makes a single
  Discord API call. There are no auto-reactions, auto-status, auto-messages,
  message scraping loops, or background polling of Discord endpoints. Every
  mutating action (send, ack, block, nickname, note, call, RSVP, voice join) is
  strictly user-initiated and routed through Discord's own action creators.
- **No Nitro bypass / server-detectable spoofing.** The plugin displays your own
  nameplate/avatar from Discord's data; it does not fake entitlements or
  manufacture client state the server would reject.
- **Optional Orion widget is separate and inert by default.** The bundled widget
  is only a remote control for the *separate*, opt-in **OrionQuests** plugin
  (Discord Quest automation, which carries its own account risk - see the README
  disclaimer). At a glance never imports it; the widget talks to it through a
  feature-detected `window` bridge and shows a prompt when it isn't installed.
  The bridge object is treated as fully untrusted: shape- and version-checked,
  dashboard rows sanitized, every cross-plugin call wrapped so a hostile or
  broken global cannot crash the widget or the page.

## Failure containment

- The sidebar tab, the dashboard host, every widget, the popup message/composer,
  and the rail strip are wrapped in `ErrorBoundary`s (the injected tab and host
  with `{ noop: true }`, so a throw there renders nothing rather than crashing
  Discord's sidebar or its content area). The
  native message renderer and native chat input each fall back to a plain
  implementation if Discord internals change, so a Discord update degrades to
  reduced features rather than a broken client.
- **Patch fragility is bounded.** The plugin adds exactly three webpack
  patches, each its own entry in `discordChecks.ts` and each a single insertion
  rather than a rewrite:
  - `find: '.FRIENDS},"friends"'`, the DM-sidebar anchor shared with upstream
    PinDMs, adds the tab.
  - `find: '"AppView"'` renders the dashboard host as one more child of
    Discord's content grid.
  - `find: '"--custom-app-panels-height"'` adds the `data-vc-glance-panels`
    marker to Discord's user panel, which the stylesheet uses to hide it while
    the dashboard is open.

  If a Discord update moves one, Vencord reports that patch as failed and only
  its own part goes. Without the first, the tab doesn't appear. Without the
  second, opening the dashboard shows a toast saying Discord's layout has
  changed instead of leaving a blank page. Without the third, Discord's own user
  panel stays visible. The rest of the plugin (context-menu actions, scheduler)
  keeps working in every case.
- **One list of what's asked of Discord.** The patches, every lookup, and the
  grid line names the stylesheet places the host on are all in `discordChecks.ts`,
  which is checked against Discord's current client code before each release.
  The code-string / CSS-class lookups all sit inside `ErrorBoundary`-wrapped
  widgets or the popup's fallback path.
- Verified with `tools/verify-bundle.js`: the bundle evaluates without touching
  any lazy proxy at module scope, so a missing module can never throw during load
  and take down all of Vencord.
