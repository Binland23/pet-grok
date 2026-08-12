# Pet Grok — Performance & Security Audit To-Do

Audit date: 2026-07-09 · Branch: `audit/perf-security` · Scope: full codebase (main process, preload, renderer, hook installer, state server, launchers, assets, CI)

Legend: 🔴 High · 🟡 Medium · 🟢 Low / hardening

---

## 1. Security ✅ DONE (2026-07-09)

Implemented on branch `state_toggle`. All S1–S11 addressed; `npm test` 74/74 pass; `npm audit` 0 vulnerabilities.

### ✅ S1. Electron upgraded to 43.1.0
- **Done:** `package.json` / lockfile → `electron@^43.1.0` (was 33.4.11). High-severity advisory chain cleared.
- **Smoke-test still recommended manually:** transparent/frameless window, tray, `setIgnoreMouseEvents(forward)`, `setVisibleOnAllWorkspaces`.

### ✅ S2. State server rejects browser `Origin`
- **Done:** `main/state-server.js` returns 403 when `Origin` header is present (hooks/curl never send one).

### ✅ S3. POST body capped at 4 KB
- **Done:** `MAX_BODY_BYTES = 4096`; oversized bodies get 413 and are drained without buffering.

### ✅ S4. `themeId` validated via `normalizeThemeId`
- **Done:** `applySettingsPatch` uses `themes.normalizeThemeId()`; `sanitizeThemeId` rejects path separators / `..`.

### ✅ S5. `themeAssetAbs` path containment
- **Done:** resolve + `pathUnderBase` check; segment filter drops `.` / `..`; theme id sanitized.

### ✅ S6. CSP: no `'unsafe-inline'` scripts
- **Done:** inline scripts extracted to `renderer/pet.js` + `renderer/dashboard.js`; CSP `script-src 'self'` only (`style-src` still allows inline for existing CSS).

### ✅ S7. `sandbox: true` on both windows
- **Done:** pet + dashboard `webPreferences.sandbox = true`.

### ✅ S8. IPC sender checks
- **Done:** `isSenderWindow(event, win)` gates every `pet:*` and `dashboard:*` handler.

### ✅ S9. POSIX single-quote shell quoting
- **Done:** `quoteForShell` + `pet-run.sh` `NODE_BIN=` use `'...'` / `'\''` escaping.

### ✅ S10. AppleScript via argv
- **Done:** `activateMacApp` / Terminal / iTerm use `osascript -e 'on run argv'` + argv; `sanitizeTty` / `sanitizeAppName`.

### ✅ S11. Respect user hook uninstall
- **Done:** `prefs.hooksUserDisabled`; install/uninstall (tray + dashboard) set it; `ensureHooksOnLaunch` skips reinstall when true. Dead `maybeAutoInstallHooks` removed.

---

## 2. Performance ✅ DONE (2026-07-10)

Implemented on branch `state_toggle`. All P1–P9 are addressed; `npm test` passes 82/82, `npm audit --omit=dev` reports 0 vulnerabilities, and the package dry-run contains no source videos, `_video_work`, or legacy spritesheets.

- **P1/P2:** animation manifests stay lightweight; only the active state's frames decode on demand, old pack references are released before switches, and one `pet:asset-base` IPC call replaces per-frame path lookups.
- **P3:** disk debug logs are opt-in via `PET_GROK_DEBUG_LOGS`, use serialized async writes, and retain at most 256 KB.
- **P4:** OS move persistence is debounced 500 ms; drag moves do not save and drag end writes once.
- **P5:** installed-theme lists and `theme.json` metadata are cached with explicit invalidation.
- **P6:** rendering is dirty-aware, timer-paced to actual motion (1.5–30 fps), and paused while hidden.
- **P7:** 21 tracked MP4 sources and all unused duplicate spritesheets were removed; local source media now lives under ignored `media-src/`, and packaging exclusions cover development media/work files.
- **P8:** installed hooks prefer system curl and retain the Node helper as a tested fallback.
- **P9:** dashboard pet/tray grids build only when their option data changes and otherwise update selection in place.

### 🔴 P1. All animation frames for every state are eagerly loaded — ~216 decoded images (~55 MB RAM) per theme
- **Where:** `renderer/index.html:284-358` (`loadAnimations`), assets under `renderer/assets/<theme>/frames/`
- **What:** The fluid pack decodes every frame of every state up-front (race-crab: 216 × 256×256 PNGs ≈ 13 MB on disk, ~55 MB decoded RGBA). Theme/mode switches re-load the whole set. There are unused `spritesheet.png`/`spritesheet.json` files per theme suggesting a sheet pipeline that was never wired up.
- **Fix options (in order of payoff):**
  1. Lazy-load per state: load `idle` first, start rendering, load the rest in the background.
  2. Use the existing spritesheets (1 decoded image per theme, draw with source-rect `drawImage`) or convert frames to WebP (typically 3–5× smaller).
  3. Release the previous theme's frames before loading the new one (currently swapped after load — fine — but both packs are briefly resident).

### 🔴 P2. One IPC round-trip + multiple `fs.existsSync` calls per frame during pack load
- **Where:** `renderer/index.html:265-271` (`resolveAssetSrc` → `api.assetPath`), `main/main.js:762-765`, `main/themes.js:100-116`
- **What:** Loading a pack awaits `pet:asset-path` once per frame (~216 sequential-ish IPC calls), and each call does up to 4 `fs.existsSync` probes in the main process. That's ~900 sync stat calls on the main process during startup and every theme/mode switch.
- **Fix:** Resolve the theme's base directory once (`pet:asset-base` returning one `file://` prefix), then build frame URLs in the renderer with string concat. One IPC call instead of 216.

### 🟡 P3. Synchronous disk writes on the hot state path
- **Where:** `main/main.js:156-162` (`appendPushLog` via `fs.appendFileSync`) called from `pushState` (twice per push) and `forceShowPet`; `main/pet-state-hook.js:20-37` (`dbg`, `appendFileSync` per hook invocation)
- **What:** Every hook event (fires on *every* Grok tool use) does blocking file appends on the Electron main process. Both logs are also unbounded — currently 177 KB (`push-state.log`) and 957 KB (`pet-state.debug.log`) on this machine and growing forever.
- **Fix:** Make logging opt-in behind an env var / pref, switch to async appends, and rotate/truncate (e.g. keep last 256 KB). Same for the hook script's debug log.

### 🟡 P4. `prefs.save` (sync `writeFileSync`) fires on every `moved` event — including per-mousemove during drags
- **Where:** `main/main.js:315-322` (`moved` handler), `main/main.js:871-878` (`pet:drag-move` calls `setBounds` per mousemove)
- **What:** Each renderer mousemove during a drag triggers `setBounds`, which emits window move events, which run `prefs.save` → sync JSON write. Dozens of blocking disk writes per second while dragging the pet; `pet:drag-end` already saves the final position.
- **Fix:** Drop the `moved` handler's save (or debounce it ~500 ms). `drag-end` already persists; keep `moved` only for OS-initiated moves with a debounce.

### 🟡 P5. Theme metadata re-read from disk on every state push / menu build / idle timer reset
- **Where:** `main/themes.js:13-52` (`listThemes` — readdir + JSON parse + up to 3 `existsSync` per theme), `main/main.js:74-85` (`loadTheme` — sync read + parse), callers: `resetIdleTimer` (main.js:97-104), `buildAppMenu`, `listTrayIconOptions` (calls `listThemes()` twice), `buildDashboardSnapshot` (runs on every `pushState` while the dashboard is open), `rebuildTray`
- **What:** Hook events arrive frequently; each one that resets the idle timer re-reads `theme.json`, and each dashboard broadcast re-scans the themes directory. All sync I/O on the main process.
- **Fix:** Cache `listThemes()` and `loadTheme()` results; invalidate on theme change (or watch the themes dir). This is a ~10-line memoization.

### 🟡 P6. Renderer draws at full display refresh rate even when nothing changes
- **Where:** `renderer/index.html:568-674` (`draw` + unconditional `requestAnimationFrame`)
- **What:** The rAF loop clears and redraws the canvas (shadow ellipse + `drawImage`) every vsync (60–120 fps) even when the pet is asleep at 1.5 fps, holding a static frame, or the window is hidden. On battery-powered machines this is constant GPU/CPU wake-up for an always-on-top overlay.
- **Fix:** Skip the redraw when frame index, bob offset, and pulse are unchanged (dirty flag); pause the loop entirely when `document.hidden` / the window is hidden (listen to `visibilitychange`), and for `sleep` consider dropping to a `setTimeout`-paced tick at pack fps.

### 🟡 P7. 16 MB of `.mp4` sources and 4.2 MB of unused spritesheets tracked in git
- **Where:** `renderer/assets/*/videos/*.mp4` (21 files, 16 MB — only consumed by `scripts/video_to_smooth_frames.py`, never at runtime), `renderer/assets/*/spritesheet.png|json` (4.2 MB, referenced by no code)
- **What:** Repo/clone bloat and they'd ship inside any packaged app. `_video_work/` (7 MB) is correctly git-ignored but still sits inside `renderer/assets`, so naïve packaging globs would include it.
- **Fix:** Move video sources out of `renderer/` (e.g. top-level `media-src/`, git-ignored or LFS), delete the unused spritesheets or wire them up per P1, and exclude `_video_work` from any future packaging config.

### 🟢 P8. Every Grok hook event spawns a full Node process
- **Where:** `main/hooks.js:128-154` (`stateCommand`), `main/pet-state-hook.js`
- **What:** Each tool-use event pays Node cold-start (~50–100 ms) just to POST ~10 bytes to localhost. It's `async: true` so it doesn't block the agent, but on busy sessions it's constant process churn.
- **Fix:** Consider the existing `curl` mode as default on platforms where curl ships (macOS, Windows 10+), keeping the Node script as fallback. (Kept 🟢 because it's off the critical path.)

### 🟢 P9. Dashboard rebuilds its entire DOM on every snapshot broadcast
- **Where:** `renderer/dashboard.html:941-947` (`renderAll` → `innerHTML` re-render of pets/tray grids), triggered by `dashboard:snapshot` on every state push
- **What:** While the dashboard is open, each hook event re-renders every card and re-attaches all listeners (pets/tray grids re-created via `innerHTML`; only the state grid has an update-in-place path).
- **Fix:** Give `renderPets`/`renderTrayIcons` the same build-once/update-in-place treatment as `renderStateGrid`, or skip re-render when the relevant snapshot slice is unchanged.

---

## 3. Correctness / housekeeping noticed along the way

- ✅ **`maybeAutoInstallHooks` dead code** — removed; launch path is `ensureHooksOnLaunch` (respects `hooksUserDisabled`).
- 🟢 **`pathToFileUrl` in the dashboard is unused** (`renderer/dashboard.html:693-698`) — and its manual `'file://' + path` construction would be wrong on Windows anyway; main already ships proper URLs via `platform.pathToAssetUrl`. Delete it.
- 🟢 **`isLoopback` uses `endsWith('127.0.0.1')`** (`main/state-server.js:57-65`) — matches unintended strings in principle; prefer an exact allow-list (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`).
- 🟢 **`pet:drag-start` ignores the coordinates the preload sends** (`preload/preload.js:48-53` sends `{screenX, screenY}`; `main/main.js:860` reads none) — harmless, but trim the API or use the payload.
- 🟢 **CI runs only macOS + Windows** (`.github/workflows/ci.yml`) — `ubuntu-latest` is the cheapest runner and `platform.js` has Linux branches; add it to the matrix.
- 🟢 **`.DS_Store` is tracked at repo root** — add to `.gitignore` and remove from the index.

---

## Suggested execution order

1. ~~**S1** Electron upgrade~~ ✅
2. ~~**S2 + S3** state-server Origin check + body cap~~ ✅
3. ~~**S4/S5** themeId validation + path containment~~ ✅
4. **P3 + P4 + P5** main-process sync-I/O cleanup (log gating, debounced saves, theme cache) — one PR.
5. **P1 + P2** asset loading rework (base-URL IPC, lazy/per-state loading) — biggest perf win, needs manual visual verification.
6. **P6** renderer draw-loop gating.
7. ~~**S6/S7/S8** CSP extraction, sandbox, sender checks~~ ✅ (with S9–S11)
8. **P7** repo asset hygiene + remaining 🟢 items.
