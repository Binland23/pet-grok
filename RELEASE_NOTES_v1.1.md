# Pet Grok v1.1.0

**Release date:** 2026-07-08  
**Baseline:** v1.0 (`Pet_Grok_V1.0`)

Desktop companion for the Grok Build CLI. v1.1 turns a single-pet prototype into a multi-pet, hook-reliable, more playful always-on-top overlay.

---

## macOS quick start

1. **Install Node.js 18+** if you don’t already have it  
   - [nodejs.org](https://nodejs.org/) LTS, or Homebrew:  
     `brew install node`
2. **Get the project** — clone or download this repo and open the folder in Finder.
3. **First launch only** — double-click **`RUN ME ONCE FIRST.command`**  
   - If Gatekeeper blocks it: **right-click → Open → Open**  
   - If Terminal says “permission denied”:  
     ```bash
     chmod +x "RUN ME ONCE FIRST.command" "RUN ME.command"
     ```
   - This runs `npm install` and starts Pet Grok.
4. **Later launches** — double-click **`RUN ME.command`** (or `npm start` in Terminal).
5. You should see:
   - A pet on the desktop (always-on-top, transparent)
   - A **menu bar** icon (no Dock icon)
6. **Connect to Grok**
   - Start a Grok Build session (`grok`) in any project.
   - Run **`/hooks`**, press **`r`** to reload hooks from disk.
   - Submit a prompt that uses tools — the pet should animate **thinking → working → done**.
7. **Pick a pet** — menu bar icon or right-click the pet → **Open Dashboard…** → **Pet**, or tray **Pet** submenu.

**Terminal alternative:**

```bash
cd /path/to/pet-grok
npm install   # first time
npm start
```

**Troubleshooting (macOS):**

| Issue | Fix |
|-------|-----|
| Pet doesn’t react to Grok | Pet must be running; Dashboard → **Refresh hooks**; TUI `/hooks` → **`r`** |
| Port / state stuck | Quit all Pet Grok / Electron instances, then launch again |
| Hidden pet after last session | Start a new Grok session (SessionStart **unhides** a running pet) or Dashboard → show pet |

---

## Highlights

- **Five selectable pets** with full animation sets  
- **Reliable Grok TUI hooks** (fixed so they actually show up and fire)  
- **Settings dashboard** for pets, size, visibility, mute, and hooks  
- **Click the pet** to focus your Grok terminal + **WEEEE**  
- **Idle bounce**, **celebration SFX**, and **laptop-typing working** art  

---

## Pets

Pick any pet from **Dashboard → Pet** or **tray / right-click → Pet**.

| Id | Name | Notes |
|----|------|--------|
| `race-crab` | Hermit Crab | Default (v1.0 art, renamed for branding) |
| `cloud-pup` | Cloud Pup | Fluffy cloud puppy |
| `bubble-axolotl` | Bubble Axolotl | Pastel pink axolotl + bubbles |
| `matcha-frog` | Matcha Frog | Leaf-hat tea-shop frog |
| `snorlax-buddy` | Snorlax Buddy | Teal doze-buddy, cream belly (Snorlax-inspired) |

Each pet includes: **idle**, **thinking**, **working**, **done**, **alert**, **sleep**, **wake**, and **click**.

**Working** is always **vigorous laptop typing** (continuous loop) for every theme.

Drop future themes under `themes/<id>/` + `renderer/assets/<id>/` — the dashboard lists them automatically.

---

## Grok TUI integration

### Hooks that actually load

Earlier localhost **HTTP** hooks never fired: Grok’s HTTP runner **SSRF-blocks** `127.0.0.1`. Relative `./pet-run.sh` commands also often failed to appear in `/hooks`.

**v1.1 default install** matches proven Clawd-style hooks:

- `type: "command"`
- Absolute `node` + absolute `~/.grok/hooks/pet-state.js <state>`
- `async: true`, `matcher: ""`

After install/refresh: open **`/hooks`**, press **`r`**, and you should see Pet Grok under **Global** next to any Claude/Clawd hooks.

### Lifecycle map

| Grok event | Pet state |
|------------|-----------|
| SessionStart | `wake` (+ **unhide** if running but hidden) |
| UserPromptSubmit | `thinking` |
| PreToolUse / PostToolUse | `working` |
| Stop | `done` |
| Notification / tool failure | `alert` |
| SessionEnd | `sleep` |
| ~60s quiet | `sleep` |

### SessionStart unhide

If Pet Grok is **already running** but **hidden**, starting a Grok session posts `wake` and **shows** the overlay again (`POST /show` supported too). Does **not** auto-launch a new process if the pet is quit.

---

## UX & polish

- **Settings dashboard** — tray or pet context menu → **Open Dashboard…** (size S/M/L, show/hide, mute, hooks install/refresh, live status, pet picker)
- **Click → focus Grok** — left-click (without drag) focuses the active Grok terminal tab and plays **WEEEE** bounce + whoop SFX  
- **Idle bounce** — subtle continuous bob while idle (sleep stays still)  
- **Sound effects** (respects Mute): WEEEE whoop on click; fanfare on **done**  
- **Tray pet menu** — switch themes without opening the dashboard  

---

## Platform & tooling

- First-class **macOS + Windows** launchers (`RUN ME*.command` / `RUN ME*.bat`)
- Theme pose processor: `scripts/process_theme_poses.py`
- Expanded unit tests for themes, hooks, click assets, and `/show`

---

## Install / upgrade notes

1. Pull `main` (or install this release).
2. **macOS:** double-click `RUN ME ONCE FIRST.command` (first time) or `RUN ME.command` (later); or `npm install` + `npm start`.
3. Dashboard → **Refresh hooks** (or Install hooks).
4. In Grok TUI: **`/hooks` → `r`** to reload.
5. Pick a pet from the dashboard.

**Persistence:** Sleep/lid close usually keeps the process; **full reboot does not** auto-start the pet (not a Login Item). Hide ≠ quit: hide keeps the process; SessionStart can unhide it.

---

## Commits since v1.0 (summary)

| Area | What landed |
|------|-------------|
| Multi-pet | Cloud Pup, Bubble Axolotl, Matcha Frog, Snorlax Buddy + Hermit Crab working refresh |
| Hooks | Command-mode absolute paths; SSRF-safe; SessionStart show |
| Dashboard | Pet picker, size, mute, hooks, status |
| Interaction | Click focus Grok + WEEEE; idle bounce; SFX; laptop working |
| Docs / tests | README, macOS quick start, theme tests, hook tests |

---

## Known limits

- Pet must be **running** for hooks to animate it (fail-open if not).  
- Custom `/pet` slash command is **not** included (skill/launcher possible later).  
- No auto-start at login yet.

---

**Happy coding — pick a buddy and let it type.**
