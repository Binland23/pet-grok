# Pet Grok v1.1.0

**Release date:** 2026-07-08  
**Baseline:** v1.0 (`Pet_Grok_V1.0`)

Desktop companion for the Grok Build CLI. v1.1 turns a single race-crab prototype into a multi-pet, hook-reliable, more playful always-on-top overlay.

---

## Highlights

- **Five selectable pets** with full animation sets  
- **Reliable Grok TUI hooks** (fixed so they actually show up and fire)  
- **Settings dashboard** for pets, size, visibility, mute, and hooks  
- **Click the pet** to focus your Grok terminal + **WEEEE**  
- **Idle bounce**, **celebration SFX**, and **laptop-typing working** art  

---

## New pets

Pick any pet from **Dashboard → Pet** or **tray / right-click → Pet**.

| Id | Name | Notes |
|----|------|--------|
| `race-crab` | Race Engineer Crab | Original default (v1.0) |
| `cloud-pup` | Cloud Pup | Fluffy cloud puppy |
| `bubble-axolotl` | Bubble Axolotl | Pastel pink axolotl + bubbles |
| `matcha-frog` | Matcha Frog | Leaf-hat tea-shop frog |
| `snorlax-buddy` | Snorlax Buddy | Teal doze-buddy, cream belly (Snorlax-inspired) |

Each pet includes: **idle**, **thinking**, **working**, **done**, **alert**, **sleep**, **wake**, and **click**.

**Working** is now always **vigorous laptop typing** (continuous loop) for every theme.

Drop future themes under `themes/<id>/` + `renderer/assets/<id>/` — the dashboard lists them automatically.

---

## Grok TUI integration

### Hooks that actually load

v1.0-era localhost **HTTP** hooks never fired: Grok’s HTTP runner **SSRF-blocks** `127.0.0.1`. Relative `./pet-run.sh` commands also often failed to appear in `/hooks`.

**v1.1 default install** matches Clawd-style hooks:

- `type: "command"`
- Absolute `node` + absolute `~/.grok/hooks/pet-state.js <state>`
- `async: true`, `matcher: ""`

After install/refresh: open **`/hooks`**, press **`r`**, and you should see Pet Grok under **Global** next to any Claude/Clawd hooks.

### Lifecycle map (unchanged states, better reliability)

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
2. `npm install` if needed, then start Pet Grok (`npm start` or double-click launcher).
3. Dashboard → **Refresh hooks** (or Install hooks).
4. In Grok TUI: **`/hooks` → `r`** to reload.
5. Pick a pet from the dashboard.

**Persistence:** Sleep/lid close usually keeps the process; **full reboot does not** auto-start the pet (not a Login Item). Hide ≠ quit: hide keeps the process; SessionStart can unhide it.

---

## Commits since v1.0 (summary)

| Area | What landed |
|------|-------------|
| Multi-pet | Cloud Pup, Bubble Axolotl, Matcha Frog, Snorlax Buddy + race-crab working refresh |
| Hooks | Command-mode absolute paths; SSRF-safe; SessionStart show |
| Dashboard | Pet picker, size, mute, hooks, status |
| Interaction | Click focus Grok + WEEEE; idle bounce; SFX; laptop working |
| Docs / tests | README, theme tests, hook tests |

---

## Known limits

- Pet must be **running** for hooks to animate it (fail-open if not).  
- Custom `/pet` slash command is **not** included (skill/launcher possible later).  
- No auto-start at login yet.

---

**Happy coding — pick a buddy and let it type.**
