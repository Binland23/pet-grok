# Pet Grok

An always-on-top desktop pet for the **Grok Build** CLI. A pixel-art F1 / Max Verstappen **race engineer crab** that reacts in real time to agent lifecycle events (thinking → working → done).

Inspired by clawd-on-desk and Codex Pets.

## Requirements

- Node.js 18+
- npm
- **macOS** (primary target) or Linux. Windows is best-effort only.
- Grok Build CLI (`grok`) for live reactions
- `curl` on `PATH` (used by hooks)

## Quick start

**Windows (double-click):**

1. First time only: **`RUN ME ONCE FIRST.bat`** — installs dependencies and starts the pet  
2. Later: **`RUN ME.bat`** — starts the pet  

**Terminal:**

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

On **macOS/Linux** (primary target) commands use `curl`. On **Windows** the installer writes `curl.exe` so PowerShell’s `curl` alias does not break hooks.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST 127.0.0.1:7788/state -d wake",
            "timeout": 5
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST 127.0.0.1:7788/state -d thinking",
            "timeout": 5
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST 127.0.0.1:7788/state -d working",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST 127.0.0.1:7788/state -d done",
            "timeout": 5
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST 127.0.0.1:7788/state -d alert",
            "timeout": 5
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST 127.0.0.1:7788/state -d sleep",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

After installing, start (or reload hooks in) a Grok session. Use `/hooks` in the TUI to confirm `pet.json` is loaded. Global hooks under `~/.grok/hooks/` are always trusted.

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
├── main/
│   ├── main.js           # window, tray, single-instance, IPC
│   ├── state-server.js   # 127.0.0.1:7788
│   ├── hooks.js          # install/uninstall pet.json
│   └── prefs.js          # position, size, mute
├── preload/
│   └── preload.js
├── renderer/
│   └── index.html        # pet UI + animations
└── themes/
    └── race-crab/
        └── theme.json
```

## End-to-end check with Grok

1. `npm start` (hooks auto-install).
2. Confirm hooks file: `cat ~/.grok/hooks/pet.json`
3. In a project: `grok`
4. Submit a prompt that uses tools.
5. Watch the pet: **thinking** → **working** → **done** (celebrate) → **idle**.

## License

MIT
