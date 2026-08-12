#!/bin/bash
# ============================================================
#  Pet Grok — macOS launcher
#  Mac users: prefer Desktop "Pet Grok.app", or double-click THIS file.
#  Windows users: use "OPEN ON WINDOWS - Open Pet Grok.lnk"
#  Port 7788 · service identity: pet-grok
#  Always: open the Electron pet window + minimize Terminal.
# ============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="${ROOT}/app"
PORT=7788
SERVICE_ID="pet-grok"
HEALTH="http://127.0.0.1:${PORT}/api/health"
SHOW_URL="http://127.0.0.1:${PORT}/show"
LOG="${APP}/.server.log"

minimize_terminal() {
  osascript >/dev/null 2>&1 <<'APPLESCRIPT' || true
tell application "Terminal"
  try
    set miniaturized of every window to true
  end try
end tell
try
  tell application "System Events"
    set visible of process "Terminal" to false
  end tell
end try
APPLESCRIPT
}

is_ours() {
  local body
  body="$(/usr/bin/curl -sf --connect-timeout 0.3 --max-time 0.6 \
    "$HEALTH" 2>/dev/null || true)"
  [[ "$body" == *'"service"'* && "$body" == *"${SERVICE_ID}"* ]]
}

show_existing() {
  /usr/bin/curl -sf --connect-timeout 0.3 --max-time 0.6 \
    -X POST "$SHOW_URL" >/dev/null 2>&1 || true
}

free_port_if_foreign() {
  if is_ours; then return 0; fi
  local pids
  pids="$(lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then return 0; fi
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 0.2
  pids="$(lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
    sleep 0.15
  fi
}

# Distinct title so we can re-minimize after Electron steals focus
printf '\033]0;Pet Grok Launcher\007' 2>/dev/null || true
minimize_terminal

# --- PATH for double-click / Terminal.app (not an interactive login shell) ---
if [ -x /usr/libexec/path_helper ]; then
  eval "$(/usr/libexec/path_helper -s)" 2>/dev/null || true
fi
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin${PATH:+:$PATH}"

if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || true
elif [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)" 2>/dev/null || true
fi

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$HOME/.nvm/nvm.sh" 2>/dev/null || true
fi
if [ -x "$HOME/.local/share/fnm/fnm" ]; then
  eval "$("$HOME/.local/share/fnm/fnm" env)" 2>/dev/null || true
elif command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)" 2>/dev/null || true
fi
if [ -x "$HOME/.volta/bin/volta" ]; then
  export PATH="$HOME/.volta/bin:$PATH"
fi
if [ -s "$HOME/.asdf/asdf.sh" ]; then
  # shellcheck source=/dev/null
  . "$HOME/.asdf/asdf.sh" 2>/dev/null || true
fi

# Already running as Pet Grok — re-show pet, never open a second instance
if is_ours; then
  show_existing
  minimize_terminal
  exit 0
fi

if [ ! -d "$APP" ] || [ ! -f "$APP/package.json" ]; then
  osascript -e 'display alert "Pet Grok" message "Could not find the app folder next to this launcher. Keep OPEN ON MAC - Open Pet Grok.command next to the app folder." as critical' 2>/dev/null || true
  exit 1
fi

cd "$APP" || exit 1
minimize_terminal

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "Pet Grok" message "Node.js is not on PATH. Install Node 18+ from https://nodejs.org or: brew install node" as critical' 2>/dev/null || true
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  osascript -e 'display alert "Pet Grok" message "npm is not on PATH. Reinstall Node.js from https://nodejs.org" as critical' 2>/dev/null || true
  exit 1
fi

# First launch: install deps (can redraw Terminal — minimize before/after)
if [ ! -d "node_modules/electron" ]; then
  minimize_terminal
  npm install >/dev/null 2>&1 || {
    osascript -e 'display alert "Pet Grok" message "npm install failed. Open Terminal in the app folder and run: npm install" as critical' 2>/dev/null || true
    exit 1
  }
  minimize_terminal
fi

# Bind Grok hooks (best-effort)
node -e "try{const h=require('./main/hooks');h.installHooks();}catch(e){}" >/dev/null 2>&1 || true
minimize_terminal

free_port_if_foreign

# Start Electron — opens the native Pet Grok window (not a browser URL)
npm start >/dev/null 2>&1 &
SERVER_PID=$!

# Wait until service identity is up, then minimize again
for _ in $(seq 1 100); do
  if is_ours; then
    break
  fi
  sleep 0.1
done

sleep 0.4
minimize_terminal
(sleep 0.8; minimize_terminal) &
(sleep 2.0; minimize_terminal) &
(sleep 4.0; minimize_terminal) &

# Keep launcher alive while Electron runs (minimizing must not kill the app)
wait "$SERVER_PID" 2>/dev/null || true
exit 0
