# At a glance - Setup Guide

This guide is written to be followed even if you have never built a plugin before.
Take it one step at a time and don't skip the "you should see" checkpoints.

At a glance is a **userplugin** for the Vencord client mod. That means it gets compiled
into the client itself: you build it from source once, and the plugin is baked into that
build. You do **not** download an `.exe` or drag a file into Discord.

> **Using Equicord?** It's a fork of Vencord and works exactly the same - this plugin
> runs on it unchanged. Wherever this guide says "Vencord", clone
> `https://github.com/Equicord/Equicord` instead and everything else is identical.

**Jump to what you need:**

- [Before you start](#before-you-start) - the three tools to install first
- [Part 1: Install At a glance](#part-1-install-at-a-glance) - the main plugin
- [Part 2 (optional): Add the Orion widget](#part-2-optional-add-the-orion-quest-widget) - read the warning first
- [Updating later](#updating-later)
- [Troubleshooting](#troubleshooting)

> **The one golden rule:** every `pnpm` command must be run **from inside the Vencord
> folder**. If you see an error like `ERR_PNPM_NO_PKG_MANIFEST / No package.json found`,
> you are in the wrong folder. Run `cd` into your Vencord folder and try again.

---

## Before you start

Install these three things once. If you already have them, skip ahead.

| Tool | What it's for | Get it |
| --- | --- | --- |
| **Git** | downloads the code | <https://git-scm.com/downloads> |
| **Node.js** (v18 or newer, LTS is fine) | builds the code | <https://nodejs.org> |
| **pnpm** | the build tool Vencord uses | after Node is installed, open a terminal and run `npm i -g pnpm` |

You also need the normal **Discord desktop app** (Stable) installed.

To check they're ready, open a terminal (on Windows: **PowerShell**) and run:

```powershell
git --version
node --version
pnpm --version
```

Each should print a version number. If any says "not recognized", install that tool
and reopen the terminal.

---

## Part 1: Install At a glance

### Step 1 - Download Vencord's source

Pick a folder to keep things in (your Documents folder is fine), then:

```powershell
git clone https://github.com/Vendicated/Vencord
cd Vencord
pnpm install --frozen-lockfile
```

**You should see:** a new `Vencord` folder, and `pnpm install` finishing with no red
errors. From now on, stay inside this `Vencord` folder in your terminal.

> Already build Vencord from source and just want to add this plugin? Skip to
> [Step 2](#step-2--add-the-plugin-folder), then run `pnpm build` instead of
> `pnpm inject`. Your existing setup and other plugins are left untouched.

### Step 2 - Add the plugin folder

Userplugins live in a folder called `src/userplugins`. Every folder you put in there
gets built automatically - there is no list to edit.

```powershell
git clone https://github.com/KayTwoOne/at-a-glance src/userplugins/atAGlance
```

(If you have the files as a folder instead of a repo, just copy that folder into
`src/userplugins` and rename it `atAGlance`. The folder name doesn't matter; the files
inside do.)

**You should see** this layout:

```
Vencord/
|- src/
|  |- plugins/            <- Vencord's built-in plugins (don't touch)
|  |- userplugins/        <- your plugins; every folder here is built
|     |- atAGlance/       <- this plugin
|        |- index.tsx     <- the entry point
|        |- styles.css
|        |- ...
|- dist/                  <- the build Discord loads (created by the next step)
```

### Step 3 - Build it and put it into Discord

**Fully quit Discord first.** Not just closing the window - right-click the Discord
icon near your clock (system tray) and choose **Quit Discord**. Then:

```powershell
pnpm build
pnpm inject
```

- `pnpm build` compiles everything. **You should see** it end with `Done`.
- `pnpm inject` asks which Discord to patch. Choose **Discord** (Stable) with the arrow
  keys and Enter. If it offers to install **OpenAsar, say no** (it can clash with the
  patch on some setups).

### Step 4 - Turn the plugin on

1. Open Discord.
2. Go to **Settings** (the gear) -> scroll down to **Vencord** -> **Plugins**.
3. Find **AtAGlance** and switch it on.
4. **Fully quit and reopen Discord one more time.** (The weather card needs a permission
   that only applies after a real restart, not a reload.)

**Done.** You'll see an **At a glance** tab just above your Friends button. Click it.

---

## Part 2 (optional): Add the Orion quest widget

> ### Read this warning first
>
> **Orion (OrionQuests) automates your own Discord account to auto-complete Quests.**
> Automating your account is **against Discord's Terms of Service**, and Discord
> actively enforces against quest automation. Using it **can get your account limited
> or banned**. This is **your decision and your risk**.
>
> - Orion is a **separate plugin**. It is **not** part of At a glance and is **not**
>   included or enabled by default.
> - The **Orion widget** inside At a glance is just a remote control. It does nothing
>   and shows a "not loaded" message unless you choose to install the OrionQuests plugin
>   as well.
> - If you're not sure, **don't install it.** Everything else in At a glance works
>   without it.

If you understand and accept that, here's how to plug it in.

### Step 1 - Add the OrionQuests plugin folder

Exactly like adding At a glance - drop its folder next to it in `src/userplugins`, from
**inside your Vencord folder**:

```powershell
# make sure you're in the Vencord folder first!
# cd "C:\path\to\Vencord"

# copy your OrionQuests folder in (use YOUR path to it).
# the \* copies the CONTENTS so you don't get a doubled sub-folder:
New-Item -ItemType Directory -Force "src\userplugins\orionQuests" | Out-Null
Copy-Item -Recurse -Force "C:\path\to\OrionQuests\*" "src\userplugins\orionQuests\"
```

**You should see** an `index.tsx` directly inside `src/userplugins/orionQuests` (not
inside another sub-folder). If you accidentally get
`src/userplugins/orionQuests/orionQuests/...`, delete the inner extra folder.

### Step 2 - Rebuild and restart

```powershell
pnpm build
```

Then **fully quit and reopen Discord** (Orion also uses that restart-only permission).
Enable **OrionQuests** under **Settings -> Vencord -> Plugins**.

### Step 3 - Show the widget

In At a glance, click **Add Widget** (top right) and tick **Orion**. It's hidden by
default, so this is the only way it appears.

You'll get a small panel with a status light (Idle / Running / Stopped), **Start**,
**Stop**, and **Status** buttons, and a live progress list. That's the widget driving
the OrionQuests engine.

> If the widget says **"OrionQuests isn't loaded"**, the plugin isn't installed or isn't
> enabled - repeat Steps 1-2. If it mentions a **version mismatch**, update At a glance
> and OrionQuests so they're both current.

---

## Updating later

| What you changed | What to run (from the Vencord folder) |
| --- | --- |
| Got a new version of this plugin | `git -C src/userplugins/atAGlance pull` then `pnpm build`, then reload Discord (`Ctrl+R`) |
| Updating Vencord itself | `git pull` then `pnpm build` (your userplugins are left alone) |
| Edited plugin code yourself | `pnpm build`, then `Ctrl+R` in Discord |

A **full restart** (tray -> Quit) instead of a `Ctrl+R` reload is only needed when a
plugin's `native.ts` changed - which for these two means the first install, and Orion.

> **Don't** run the official Vencord installer/updater over this build afterwards. It
> replaces your source build with a stock one and your userplugins disappear. If that
> ever happens, nothing is lost: run `pnpm build` and `pnpm inject` again from your
> Vencord folder.
>
> **Tip:** keep each userplugin (this one, OrionQuests, anything of your own) in its own
> git repo. `src/userplugins` is ignored by Vencord, so a fresh Vencord download starts
> empty - a repo per plugin means restoring each is a single `git clone`.

---

## Troubleshooting

- **`ERR_PNPM_NO_PKG_MANIFEST / No package.json found`** -> you ran `pnpm` from the wrong
  folder. `cd` into your `Vencord` folder first (the golden rule at the top).
- **The At a glance tab doesn't appear** -> open Settings -> Vencord and look for a
  failed patch. The tab hooks the same spot as the built-in PinDMs plugin; if a Discord
  update moved it, the rest of the plugin (the right-click pin, watch and save actions,
  reminders) still works and the tab returns once updated.
- **Clicking the tab shows "At a glance could not open - Discord's layout has changed"**
  -> the patch that places the dashboard in Discord's own layout no longer matches
  after a Discord update. Look for a failed patch the same way; the dashboard returns
  once the plugin is updated.
- **Discord's own user panel (your avatar and the mute and deafen buttons) stays visible
  at the bottom left while the dashboard is open** -> the small patch that marks that
  panel so it can be hidden no longer matches. Nothing else is affected, and it is fixed
  by the same update.
- **"Your dashboard couldn't be loaded"** -> At a glance couldn't read your saved data.
  Nothing has been changed or lost, and it keeps retrying by itself (after 2 seconds,
  then 10, then 30, then every 30 seconds). **Try again** retries straight away. Until
  your data has loaded, changes are refused rather than saved over it.
- **Weather card can't load** -> you skipped the extra full restart after the first
  build. Quit from the tray and reopen.
- **Discord looks totally normal (stock) after `pnpm inject`** -> Discord wasn't fully
  quit during injection, or the official updater overwrote the patch. Quit from the tray
  and run `pnpm inject` again.
- **Everything in Vencord broke after adding a plugin** -> run the safety check below; it
  names the file that failed:
  ```powershell
  node src/userplugins/atAGlance/tools/verify-bundle.js dist/renderer.js
  ```
  `RESULT: renderer.js evaluated WITHOUT throwing` means the build is safe to load.

---

## Known limitations

- The quick-chat popup embeds Discord's own channel text area. If a Discord update
  restructures that internal, the popup falls back to a minimal composer (text plus
  emoji/GIF pickers) until it's updated; **Go to channel** is always the escape hatch.
- Popup messages render outside Discord's full message-list context, so the native
  hover toolbar is limited. The plugin adds its own instead: right-click for
  Reply / Edit / Copy, double-click to reply (or edit your own).
- `@mention` suggestions in a server channel can only offer members Discord has already
  loaded locally; someone you've never interacted with may not appear until Discord
  loads them.
