# At a glance

A configurable overview tab that sits above the Friends button in Discord, for
people who open Discord and immediately have to go looking for what changed.

## Why it exists

Discord tells you that something happened, but not what. A red badge on a server
icon means somebody said something somewhere. Finding out who, where, and whether
it matters costs several clicks, and by the time you have checked four servers you
have forgotten what you opened Discord to do.

Everything the plugin does follows from that one problem. It is not a launcher, a
theme, or a productivity suite bolted onto a chat client. It is one screen that
answers "what needs me right now" without navigating anywhere.

The utility widgets exist for the same reason. A timer, a calculator and a
timestamp generator are all things people already alt-tab away from Discord to
find, and every alt-tab is a chance to lose the thread of a conversation.

## What it does

**Social.** Pinned Friends with live presence and activity. Quick Access Channels
for the handful of channels you actually read, grouped by server with unread and
mention counts. Inbox for mentions and unread DMs, with dismissal that works
whether or not the widget is on screen. Saved Messages, reading Discord's own
bookmarks. Upcoming Events.

**Integrations.** Weather from Open-Meteo, the only external host the plugin is
allowed to contact. Now Playing, following any music platform Discord can see a
listening activity for, not just Spotify. Quick Notes with checkboxes, autosaved.

**Utilities.** Clock, countdown timer with an audible chime, stopwatch, Discord
timestamp generator, calculator. Reminders, timed or untimed, beside Discord's own message
reminders. Client performance.

**Navigation.** A command palette on Shift+Space that searches friends, channels
and actions. A quick chat popup that opens a conversation in place, so you can
read and reply without leaving the dashboard.

**Orion.** An optional remote control for OrionQuests, a separate plugin. Off by
default and inert unless that plugin is installed. It is not bundled and it is
not part of the public release.

## Layout

Up to three columns, appearing as the window gets wide enough and folding back
down as it narrows. Where a widget sits is saved per account, not fixed by what
kind of widget it is - any widget can be dragged into any column, in any order.
There is no Social or Tools region on screen anymore; the groupings above
describe what a widget is for, not where it lives, and a widget sizes its own
contents off the column it actually landed in rather than the window.

Rearranging happens in an explicit edit mode rather than all the time. Drag
grips stay hidden until you ask for them, so the dashboard doesn't look
draggable when you're just reading it. Edit mode also carries a reset that puts
widget order and columns back to default without touching pins, notes,
bookmarks, reminders or your weather location.

## Sharing your screen

The dashboard's whole job is to gather the names that matter to you onto one
screen, which makes it exactly the wrong thing to have open on a stream or in a
support call. One button in the top bar blurs the surfaces that identify people
and place: pinned friend tiles, the server names in Quick Access, and the
weather location.

It stays interactive while it's on. The person using the dashboard already
knows who these people are, and shouldn't lose the use of the thing in order to
hide it from someone else. It isn't remembered between sessions either, because
the reason to turn it on is something happening right now, and a dashboard that
opened blurred a week later would just look broken.

It is a visual filter, not a redaction. The text is still in the page
underneath, so it covers a camera or a viewer and not a reader of the DOM. The
honest version of that is worth stating rather than implying a guarantee the
feature doesn't make.

## What it is trying to look like

Native. The plugin should read as a Discord feature that shipped, not an
extension someone glued on. It uses Discord's semantic colour variables, its
button hierarchy, its modal behaviour and its spacing conventions, and it fails
back to sensible values when a custom theme removes something it expected.

Within that constraint it has its own character. Three materials (classic,
acrylic, glass), a primary and accent colour, an adjustable tint intensity and
gradient angle, and a background you set yourself. The default is a solid
`#171717`, chosen because it matches Discord's own dark surface and disappears
into it. The stylesheet itself is built on semantic design tokens rather than
reading Discord's CSS variables directly, so a material and a colour have one
source of truth instead of drifting per surface.

Customize opens as a panel docked beside the dashboard rather than a modal
floating over it, so a change previews against the real thing while you're
still making it, and every control there applies live rather than on commit.

The rules the appearance work follows:

- The user picks their own background colour. Presets never touch it.
- Presets stay subtle. A preset that overpowers the content has failed.
- Nothing is communicated by colour alone.
- Reduced motion is respected everywhere, including body-portaled surfaces like
  the command palette and dropdown menus, which a naive `.layer *` rule misses.
- Contrast is measured, not eyeballed. A material that cannot clear WCAG AA gets
  removed rather than tuned.
- Interaction targets hold a consistent minimum size, and anything focusable
  gets a visible focus ring.

That last contrast rule is why frosted and flat were deleted in v2.8.0 rather
than fixed, and why a later pass moved Weather and Orion's row text onto the
same solid row surface everything else already used, once it measured under
AA on a translucent wash.

## How it is built

A Vencord userplugin with three small webpack patches, deliberately. Each one
inserts something into Discord's code rather than rewriting any of it. One adds
the tab above Friends. One renders the dashboard as another cell of Discord's own
app grid, inside Discord's own React tree, so Discord's layout does the placing:
right of the server rail, under the title bar and any notice bar, and narrowed by
the theme editor when that docks. The plugin does not measure Discord's title bar
or rails, or watch the page, to find its place. The third puts a
`data-vc-glance-panels` marker on Discord's user panel, so the dashboard can hide
that panel by the marker instead of by a hashed class name.

Each patch is its own entry, so when Discord changes one of them the loss stays
small. A patch that rewrites the main content area takes the whole client down
with it, which is the reason none of these do. If the first breaks, the tab
disappears. If the second breaks, opening the dashboard says it couldn't open
instead of leaving a blank page. If the third breaks, Discord's own user panel
stays visible. Nothing else goes with them.

Configuration lives in IndexedDB through Vencord's DataStore and is rebuilt by
allowlist on every load. Stored data is never spread into a config object, so a
corrupted or tampered record cannot inject keys. Schema changes ship with
migrations that preserve layout position rather than appending new widgets to the
bottom of somebody's dashboard.

Nothing is written until the current account's data has loaded, and only ever to
that account. A failed read shows as a failed read, with a Try again button and
automatic retries, rather than as an empty dashboard that the next click would
save over the real one. That load and save logic lives in an import-free module
so it can be tested with fake storage and fake timers.

Verification is a set of gates: TypeScript, eslint, unit tests under
`node --test` (the load and save logic, the contrast maths, the accent tokens and
the toast call), a production build, and a script that evaluates the built bundle
outside Discord to catch top-level webpack access, which is the failure mode that
silently kills every plugin at once. Migration logic also lives in an import-free
module so a separate script can assert it under node. Everything the plugin asks
of Discord's own code - its patches, its lookups and the layout line names its
CSS sits on - is one list, `discordChecks.ts`, which is checked against Discord's
current client before each release.

## Compatibility

Built and verified against both Vencord and Equicord. Every alias it imports
exists in both, and both builds scan `userplugins` identically. Each release is
type-checked, linted, built and bundle-checked on both forks before it ships,
because the two do diverge: Equicord's lint is stricter, and their
`discord-types` packages disagree on parts of the message store's shape.

## Versioning

`vMAJOR.PRIDE.FIX`. The middle number moves for a feature worth being proud of,
the last for routine fixes.
