# Pet Grok

An always-on-top desktop pet for the **Grok Build** CLI. Cute kawaii pets that react in real time to agent lifecycle events (thinking → working → done).

Shipped themes: **Hermit Crab**, **Cloud Pup**, **Bubble Axolotl**, and **Matcha Frog** — pick from the dashboard.

Inspired by clawd-on-desk and Codex Pets.

## Requirements

- Node.js 18+
- npm
- **macOS** or **Windows** (first-class; same codebase)
- Grok Build CLI (`grok`) for live reactions
- System `node` on `PATH` (hooks call Node, not the Electron binary)

## Quick start

### macOS (recommended)

1. **Install Node.js 18+** if needed  
   - [nodejs.org](https://nodejs.org/) or Homebrew: `brew install node`
2. **Download / clone** this repo and open the folder in Finder.
3. **First time only** — double-click **`RUN ME ONCE FIRST.command`**  
   - If macOS blocks it: right-click → **Open** → **Open**  
   - If Terminal says permission denied:  
     `chmod +x "RUN ME ONCE FIRST.command" "RUN ME.command"`  
   - This runs `npm install` and starts Pet Grok.
4. **Every later launch** — double-click **`RUN ME.command`**  
   - The Terminal window minimizes automatically so it stays out of the way (click its Dock icon to show it again / stop the pet with Ctrl+C).
5. Confirm a pet is on the desktop and a **menu bar** icon is present (no Dock icon).
6. In a Grok TUI session: run **`/hooks`**, press **`r`** to reload hooks, and submit a prompt that uses tools — the pet should go **thinking → working → done**.

**Terminal (macOS):**

```bash
cd /path/to/pet-grok
npm install   # first time only
npm start
```

### Windows

| | First time | Every later launch |
|---|------------|--------------------|
| **Windows** | `RUN ME ONCE FIRST.bat` | `RUN ME.bat` |

Or `npm install` then `npm start` in the project folder.

### What first launch does

1. Opens a transparent, always-on-top pet overlay  
2. Starts a local state server on `http://127.0.0.1:7788`  
3. Auto-installs Grok hooks to `~/.grok/hooks/pet.json` if missing  
4. Shows a system tray / menu bar icon  

## How it works

```
Grok lifecycle event
  → ~/.grok/hooks/pet.json  (type: command, absolute node + pet-state.js <state>)
  → POST http://127.0.0.1:7788/state  (plain text)
  → Electron main onState → IPC
  → Pet renderer animation
```

### Event → state map

| Grok hook event    | Pet state  | Animation                         |
|--------------------|------------|-----------------------------------|
| `SessionStart`     | `wake`     | Stretch awake → idle; **unhide** if pet was running but hidden |
| `UserPromptSubmit` | `thinking` | Thoughtful pose                   |
| `PreToolUse`       | `working`  | Laptop typing (vigorous)          |
| `Stop`             | `done`     | Celebrate briefly → idle          |
| `Notification`     | `idle`     | Turn-complete ping → idle; approval / error → brief alert then idle |
| `SessionEnd`       | `sleep`    | Zzz                               |
| *(60s silence)*    | `sleep`    | Idle timeout                      |
| *(hover while asleep)* | `idle` | Wakes on mouse over pet       |

### Manual state testing

With the app running (use `curl.exe` on Windows):

```bash
curl -s -X POST 127.0.0.1:7788/state -d thinking
curl -s -X POST 127.0.0.1:7788/state -d working
curl -s -X POST 127.0.0.1:7788/state -d done
curl -s -X POST 127.0.0.1:7788/state -d alert
curl -s -X POST 127.0.0.1:7788/state -d sleep
curl -s -X POST 127.0.0.1:7788/state -d wake
curl -s -X POST 127.0.0.1:7788/state -d click   # WEEEE bounce (also accepts: weee)
curl -s -X POST 127.0.0.1:7788/show
```

> Dashboard **manual lock** is separate from curl: picking a pose in the dashboard holds it (and ignores hooks) until you press **Auto**. Curl/`POST /state` alone still uses normal auto transitions (wake/done settle to idle).

`POST /show` (and SessionStart → `wake`) re-shows a **running but hidden** pet. They do **not** launch Pet Grok if it is not already running.

`GET http://127.0.0.1:7788/health` → JSON `{ "ok": true, "lastState": "...", "pid": ... }`

You should see the liquid-glass **status bubble** under the pet flash to **thinking** / **working** / **done**, and the sprite sheet animation change. With hooks refreshed, tool events also show a short plain-language activity line (e.g. `Running npm test`, `Editing pet.js`) that holds for several seconds so you can read it. Toggle the bubble from the dashboard (**Show status**), the tray / pet menu, or the hover chevron.

**Activity detail** (tool + target) requires an up-to-date `pet-state.js` under `~/.grok/hooks/` — use **Refresh hooks** after upgrading Pet Grok.

**If states never change:** quit every Pet Grok / Electron instance (only one can own port `7788`), then `npm start` again. Zombie processes make hooks update a dead server.

The server binds **only** to `127.0.0.1` and rejects non-loopback clients.

## Grok hook install

Hooks live in `~/.grok/hooks/*.json`. Grok merges every `*.json` in that directory. This app only ever creates or deletes **`pet.json`** — it never clobbers other hook files.

### From the tray menu

- **Install Grok Hooks** — writes `~/.grok/hooks/pet.json`
- **Uninstall Grok Hooks** — deletes only that file

### From the CLI (without Electron)

```bash
npm run install-hooks
npm run uninstall-hooks
```

### Generated `~/.grok/hooks/pet.json`

Hooks use Grok’s **`type: "command"`** runner (macOS and Windows), with **absolute** `node` + `pet-state.js` paths (same shape as Clawd-on-Desk hooks that Grok loads from `~/.claude/settings.json`). Each event POSTs plain text to `http://127.0.0.1:7788/state`.

**Why not `type: "http"` to localhost?** Grok’s HTTP hook runner **SSRF-blocks** private/loopback IPs.

**Why absolute paths?** Relative `./pet-run.sh` often fails to show up or spawn reliably; Clawd-style absolute commands appear under `/hooks` as Global.

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"/opt/homebrew/bin/node\" \"/Users/you/.grok/hooks/pet-state.js\" thinking",
            "async": true,
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Installed under `~/.grok/hooks/`: `pet.json`, `pet-state.js`, `pet-run.sh` / `pet-run.cmd` (helpers).

After install or refresh: open **`/hooks`** in the TUI and press **`r`** to reload. You should see Pet Grok commands under **Global** alongside any Claude/Clawd hooks.

After installing, start (or reload hooks in) a Grok session — press **`r`** in the `/hooks` modal if the session was already open. Use `/hooks` in the TUI to confirm `pet.json` is loaded. Global hooks under `~/.grok/hooks/` (Windows: `%USERPROFILE%\.grok\hooks\`) are always trusted.

**Requires the pet process running** so `127.0.0.1:7788` is bound. If the pet is quit, hooks fail open and the overlay stays idle.

## Tray menu

| Item | Action |
|------|--------|
| **Open Dashboard…** | Settings window (pets, size, hooks, live status) |
| Show / Hide Pet | Toggle overlay visibility |
| Pet | Switch theme (Hermit Crab / Cloud Pup / Bubble Axolotl / Matcha Frog) |
| Tray icon | Grok logo / match pet / fixed pet |
| Size (S / M / L) | 128 / 192 / 256 px window |
| Mute | Toggle WEEEE + done celebration SFX |
| Show status | Toggle liquid-glass activity bubble under the pet |
| Install / Uninstall Grok Hooks | Manage `pet.json` only |
| Quit | Exit the app |

The **same menu** is available by **right-clicking the pet** on the desktop.

### Dashboard

Open from the tray or pet context menu (**Open Dashboard…**). From there you can:

- See live server / hook / pet state
- **Manually toggle pet state** (Auto, idle, wake, thinking, working, done, alert, sleep, **WEEEE**) — picking a pose locks it (one-shots hold/loop instead of snapping back); press **Auto** to drop the lock, return to **idle**, and resume hook-driven behavior
- Change size, visibility, mute, and **Show status** (liquid-glass activity bubble under the pet)
- Switch between **Fluid animation** (24fps smooth Imagine packs) and **Static sprites** (classic low-fps pose cycles, ~2–10 fps)
- Install or refresh Grok hooks
- Choose a **pet** (Hermit Crab, Cloud Pup, Bubble Axolotl, Matcha Frog — drop more under `themes/<id>/` and they appear automatically)
- Choose the **tray icon** (Grok logo by default, match active pet, or any pet idle) — updates live


Other behavior:

- **Single-instance lock** — only one pet process
- **Draggable** — grab the pet; position is saved across restarts
- **Click-through** — transparent pixels pass clicks through; only the pet hit-region captures input
- **Click to focus Grok** — left-click the pet (without dragging) to focus the terminal tab running the active Grok session (`~/.grok/active_sessions.json`); plays a short **WEEEE** bounce animation
- **Hover chevron** — mouse over the pet to reveal a small glass arrow; click to show/hide the status bubble (same pref as Dashboard → Show status)
- **Idle timeout** — after 60s with no events, the pet sleeps; mouse over wakes it

## Custom themes

Themes live under `themes/<id>/` with matching runtime frames in `renderer/assets/<id>/`.

Shipped:

| Id | Name |
|----|------|
| `race-crab` | Hermit Crab (default) |
| `cloud-pup` | Cloud Pup |
| `bubble-axolotl` | Bubble Axolotl |
| `matcha-frog` | Matcha Frog |

Pick pets from the **Dashboard → Pet** cards or the tray **Pet** menu.

```json
{
  "id": "cloud-pup",
  "name": "Cloud Pup",
  "description": "Fluffy cloud puppy…",
  "sprites": {
    "idle": "sprites/idle.png",
    "thinking": "sprites/thinking.png",
    "working": "sprites/working.png",
    "done": "sprites/done.png",
    "alert": "sprites/alert.png",
    "sleep": "sprites/sleep.png",
    "wake": "sprites/wake.png"
  },
  "celebrateMs": 2500,
  "wakeMs": 900,
  "idleTimeoutMs": 60000
}
```

### Adding a theme

1. Create `themes/<id>/theme.json` and `themes/<id>/sprites/` (hero PNGs per state).
2. Put animation frames + `animations.json` under `renderer/assets/<id>/` (see existing pets).
3. Optional helper: `python3 scripts/process_theme_poses.py <id> <src-pose-dir>` turns pose JPGs into transparent frames.
4. Restart the app — the dashboard lists any folder under `themes/`.

States: `idle`, `thinking`, `working`, `done`, `alert`, `sleep`, `wake` (plus optional `click`).

### Animation modes

| Mode | Pack | Typical fps |
|------|------|-------------|
| **Fluid** | `animations.json` + `frames/` | 24 (Imagine video extracts) |
| **Static sprites** | `animations-static.json` + `frames-static/` | ~2–10 (classic pose cycles; working ~8–9) |

Dashboard → **Animation style** switches between them. Manual state locks use whichever mode is selected (both loop).

### Smooth 24fps animations (Imagine video)

The newer pets ship **24fps** fluid packs extracted from Imagine `image_to_video` clips, plus the restored **classic static** packs for the Static sprites toggle. Matcha Frog’s hand-authored frames serve both modes.

Pipeline:

1. Composite theme sprites onto a solid black background (video-friendly).
2. Generate a 6s clip per state with Imagine video (fixed camera, subtle motion).
3. Place local source videos at `media-src/<id>/<state>.mp4`. This folder is ignored so source media is never shipped with the app.
4. Extract transparent 256×256 frames:

```bash
python3 scripts/video_to_smooth_frames.py <theme-id>
# or all themes that have local media-src videos
python3 scripts/video_to_smooth_frames.py --all
```

If a state cannot be video-generated (rate limit / moderation), upsample the old keyframes:

```bash
python3 scripts/interpolate_smooth_frames.py <theme-id> <state>
```

## Project layout

```
├── package.json
├── README.md
├── RUN ME.command              # macOS daily launcher (double-click)
├── RUN ME ONCE FIRST.command   # macOS first-time install + start
├── RUN ME.bat                  # Windows daily launcher
├── RUN ME ONCE FIRST.bat       # Windows first-time install + start
├── main/
│   ├── main.js           # pet window, dashboard, tray, IPC
│   ├── platform.js       # OS helpers (AOT, tray, file URLs)
│   ├── themes.js         # list/load pet themes
│   ├── state-server.js   # 127.0.0.1:7788
│   ├── hooks.js          # install/uninstall pet.json
│   ├── pet-state-hook.js # bundled helper copied into ~/.grok/hooks
│   └── prefs.js          # position, size, mute, themeId
├── preload/
│   ├── preload.js
│   └── dashboard-preload.js
├── renderer/
│   ├── index.html        # pet UI + animations
│   ├── dashboard.html    # settings dashboard
│   └── assets/
│       ├── race-crab/
│       ├── cloud-pup/
│       ├── bubble-axolotl/
│       └── matcha-frog/
├── scripts/
│   └── process_theme_poses.py
└── themes/
    ├── race-crab/
    ├── cloud-pup/
    ├── bubble-axolotl/
    └── matcha-frog/
```

## Platform notes

| Topic | macOS | Windows |
|-------|-------|---------|
| Overlay | Always-on-top, all Spaces, hide Dock | Always-on-top, skip taskbar; not over exclusive fullscreen games |
| Tray | Menu bar icon; right-click menu | Notification area; left-click opens menu |
| Hooks dir | `~/.grok/hooks/` | `%USERPROFILE%\.grok\hooks\` |
| Manual curl | `curl -s -X POST …` | Use `curl.exe` (not PowerShell’s `curl` alias) |
| Launcher | `RUN ME.command` or `npm start` | `RUN ME.bat` or `npm start` |
| App identity | Dock hidden | `AppUserModelId` `com.petgrok.app` |

Click-through (transparent pixels) and drag work on both OSes. Window size is re-applied on drag to avoid DPI size growth on Windows.

## End-to-end check with Grok

1. `npm start` (hooks auto-install).
2. Confirm hooks file: `cat ~/.grok/hooks/pet.json` (Windows: type the same path under `%USERPROFILE%`).
3. In a project: `grok`
4. Submit a prompt that uses tools.
5. Watch the pet: **thinking** → **working** → **done** (celebrate) → **idle**.

## License

MIT
