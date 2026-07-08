# Pet Grok

An always-on-top desktop pet for the **Grok Build** CLI. Cute kawaii pets that react in real time to agent lifecycle events (thinking → working → done).

Shipped themes: **Race Engineer Crab**, **Cloud Pup**, **Bubble Axolotl**, and **Matcha Frog** — pick from the dashboard.

Inspired by clawd-on-desk and Codex Pets.

## Requirements

- Node.js 18+
- npm
- **macOS** or **Windows** (first-class; same codebase)
- Grok Build CLI (`grok`) for live reactions
- System `node` on `PATH` (hooks call Node, not the Electron binary)

## Quick start

**Double-click shortcuts** (same idea on both OSes):

| | First time | Every later launch |
|---|------------|--------------------|
| **Windows** | `RUN ME ONCE FIRST.bat` | `RUN ME.bat` |
| **macOS** | `RUN ME ONCE FIRST.command` | `RUN ME.command` |

On macOS, if Gatekeeper blocks the file: right-click → **Open** → Open.  
If Terminal says “permission denied”:  
`chmod +x "RUN ME.command" "RUN ME ONCE FIRST.command"`

**Terminal (either OS):**

```bash
npm install
npm start
```

On first launch the app:

1. Opens a transparent, always-on-top pet overlay
2. Starts a local state server on `http://127.0.0.1:7788`
3. Auto-installs Grok hooks to `~/.grok/hooks/pet.json` if missing
4. Shows a system tray / menubar icon (no dock icon on macOS)

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
| `SessionStart`     | `wake`     | Stretch awake → idle              |
| `UserPromptSubmit` | `thinking` | Head tilt, radio chatter          |
| `PreToolUse`       | `working`  | Laptop typing (vigorous)          |
| `Stop`             | `done`     | Celebrate briefly → idle          |
| `Notification`     | `alert`    | Shake / red radio                 |
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
```

`GET http://127.0.0.1:7788/health` → JSON `{ "ok": true, "lastState": "...", "pid": ... }`

You should see the status pill under the pet flash to **thinking** / **working** / **done**, and the sprite sheet animation change.

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

**Requires the pet process running** so `127.0.0.1:7788` is bound. If the pet is quit, hooks fail open and the crab stays idle.

## Tray menu

| Item | Action |
|------|--------|
| **Open Dashboard…** | Settings window (pets, size, hooks, live status) |
| Show / Hide Pet | Toggle overlay visibility |
| Pet | Switch theme (Race Crab / Cloud Pup / Bubble Axolotl / Matcha Frog) |
| Size (S / M / L) | 128 / 192 / 256 px window |
| Mute | Toggle WEEEE + done celebration SFX |
| Install / Uninstall Grok Hooks | Manage `pet.json` only |
| Quit | Exit the app |

The **same menu** is available by **right-clicking the pet** on the desktop.

### Dashboard

Open from the tray or pet context menu (**Open Dashboard…**). From there you can:

- See live server / hook / pet state
- Change size, visibility, mute
- Install or refresh Grok hooks
- Choose a **pet** (Race Crab, Cloud Pup, Bubble Axolotl, Matcha Frog — drop more under `themes/<id>/` and they appear automatically)


Other behavior:

- **Single-instance lock** — only one pet process
- **Draggable** — grab the crab; position is saved across restarts
- **Click-through** — transparent pixels pass clicks through; only the pet hit-region captures input
- **Click to focus Grok** — left-click the pet (without dragging) to focus the terminal tab running the active Grok session (`~/.grok/active_sessions.json`); plays a short **click** bounce animation
- **Idle timeout** — after 60s with no events, the pet sleeps; mouse over wakes it

## Custom themes

Themes live under `themes/<id>/` with matching runtime frames in `renderer/assets/<id>/`.

Shipped:

| Id | Name |
|----|------|
| `race-crab` | Race Engineer Crab (default) |
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
