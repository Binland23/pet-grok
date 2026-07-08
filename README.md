# Pet Grok

An always-on-top desktop pet for the **Grok Build** CLI. A pixel-art F1 / Max Verstappen **race engineer crab** that reacts in real time to agent lifecycle events (thinking → working → done).

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

(`start.command` is a thin alias that runs `RUN ME.command`.)

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
  → ~/.grok/hooks/pet.json  (curl command)
  → POST 127.0.0.1:7788/state  (plain-text body)
  → Electron main → IPC
  → Pet renderer animation
```

### Event → state map

| Grok hook event    | Pet state  | Animation                         |
|--------------------|------------|-----------------------------------|
| `SessionStart`     | `wake`     | Stretch awake → idle              |
| `UserPromptSubmit` | `thinking` | Head tilt, radio chatter          |
| `PreToolUse`       | `working`  | Claw hammering                    |
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

Hooks run a small Node helper (`pet-state.js`) that POSTs plain text to `127.0.0.1:7788/state`. Platform-specific install:

| OS | Command shape | Extra files |
|----|---------------|-------------|
| **macOS** | `"node" "…/pet-state.js" thinking` | `pet-state.js` |
| **Windows** | `"…\pet-run.cmd" thinking` | `pet-state.js` + `pet-run.cmd` |

`pet-run.cmd` avoids PowerShell’s `curl` alias and CreateProcess path-with-spaces issues. Paths with spaces (e.g. `C:\Users\First Last\…`) are quoted.

Example (macOS / Linux):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"/usr/local/bin/node\" \"/Users/you/.grok/hooks/pet-state.js\" thinking",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Example (Windows):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"C:\\Users\\you\\.grok\\hooks\\pet-run.cmd\" thinking",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

After installing, start (or reload hooks in) a Grok session. Use `/hooks` in the TUI to confirm `pet.json` is loaded. Global hooks under `~/.grok/hooks/` (Windows: `%USERPROFILE%\.grok\hooks\`) are always trusted.

## Tray menu

| Item | Action |
|------|--------|
| Show / Hide Pet | Toggle overlay visibility |
| Size (S / M / L) | 128 / 192 / 256 px window |
| Mute | Reserved for optional sounds |
| Install / Uninstall Grok Hooks | Manage `pet.json` only |
| Quit | Exit the app |

The **same menu** is available by **right-clicking the pet** on the desktop.

Other behavior:

- **Single-instance lock** — only one pet process
- **Draggable** — grab the crab; position is saved across restarts
- **Click-through** — transparent pixels pass clicks through; only the pet hit-region captures input
- **Idle timeout** — after 60s with no events, the pet sleeps; mouse over wakes it

## Custom themes

Themes live under `themes/<id>/`.

Default theme: `themes/race-crab/theme.json`

```json
{
  "id": "race-crab",
  "name": "Race Engineer Crab",
  "palette": {
    "shell": "#1e3a5f",
    "shellDark": "#0f2438",
    "accent": "#e10600",
    "highlight": "#ffd200",
    "eye": "#ffffff",
    "pupil": "#111111",
    "belly": "#c45c26",
    "claw": "#e10600",
    "radio": "#33ff66",
    "zzz": "#a8c0d8"
  },
  "celebrateMs": 2500,
  "wakeMs": 900,
  "idleTimeoutMs": 60000
}
```

### Adding a theme

1. Copy `themes/race-crab/` to `themes/my-theme/`.
2. Edit `theme.json` (`id`, `name`, `palette`, timings).
3. For real art later, replace the CSS/DOM sprites in `renderer/index.html` (or load sprite sheets from `themes/my-theme/` via data-URIs / file URLs). Keep state class names: `state-idle`, `state-thinking`, `state-working`, `state-done`, `state-alert`, `state-sleep`, `state-wake`.
4. Set `"themeId": "my-theme"` in the app prefs file (under Electron `userData`, e.g. `pet-prefs.json`), or change the default in `main/prefs.js`.

The pet view is a **single** `renderer/index.html` that loads theme sprites from `themes/<id>/sprites/` (transparent PNGs per state: idle, thinking, working, done, alert, sleep, wake). Drop in new art and update `theme.json` to swap looks.

## Project layout

```
├── package.json
├── README.md
├── RUN ME.command              # macOS daily launcher (double-click)
├── RUN ME ONCE FIRST.command   # macOS first-time install + start
├── start.command               # alias → RUN ME.command
├── RUN ME.bat                  # Windows daily launcher
├── RUN ME ONCE FIRST.bat       # Windows first-time install + start
├── main/
│   ├── main.js           # window, tray, single-instance, IPC
│   ├── platform.js       # OS helpers (AOT, tray, file URLs)
│   ├── state-server.js   # 127.0.0.1:7788
│   ├── hooks.js          # install/uninstall pet.json
│   ├── pet-state-hook.js # bundled helper copied into ~/.grok/hooks
│   └── prefs.js          # position, size, mute
├── preload/
│   └── preload.js
├── renderer/
│   └── index.html        # pet UI + animations
└── themes/
    └── race-crab/
        └── theme.json
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
