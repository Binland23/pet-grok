#!/bin/bash
# Pet Grok.app — Desktop launcher (service: pet-grok, port: 7788)
# Opens the Electron desktop pet (not a browser). No Terminal window.
# Dedicated port + service identity so other local apps cannot hijack this launcher.
set -uo pipefail

PROJECT="__PROJECT__"
APP="$PROJECT/app"
PORT=7788
SERVICE_ID="pet-grok"
HEALTH="http://127.0.0.1:${PORT}/api/health"
SHOW_URL="http://127.0.0.1:${PORT}/show"
LOG="$APP/.server.log"
PIDFILE="$APP/.server.pid"
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"

alert() {
  /usr/bin/osascript -e "display alert \"Pet Grok\" message \"$1\" as critical" >/dev/null 2>&1 || true
}

is_ours() {
  local body
  body="$(/usr/bin/curl -sf --connect-timeout 0.3 --max-time 0.6 \
    "$HEALTH" 2>/dev/null || true)"
  [[ "$body" == *'"service"'* && "$body" == *"${SERVICE_ID}"* ]]
}

# If already running, re-show the pet overlay and exit (do not start a second instance).
show_existing() {
  /usr/bin/curl -sf --connect-timeout 0.3 --max-time 0.6 \
    -X POST "$SHOW_URL" >/dev/null 2>&1 || true
}

# Bootstrap PATH the same way double-click Terminal launchers do
bootstrap_node_path() {
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

if is_ours; then
  show_existing
  exit 0
fi

if [[ ! -d "$APP" || ! -f "$APP/package.json" ]]; then
  alert "Could not find Pet Grok at: $PROJECT — re-run: python3 scripts/install-desktop-app.py"
  exit 1
fi

bootstrap_node_path
cd "$APP" || exit 1

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  alert "Node.js / npm not on PATH. Install Node 18+ from https://nodejs.org or: brew install node"
  exit 1
fi

if [[ ! -d "node_modules/electron" ]]; then
  npm install >>"$LOG" 2>&1 || {
    alert "npm install failed. Check $LOG or run npm install in the app folder."
    exit 1
  }
fi

# Bind Grok hooks (best-effort)
node -e "try{require('./main/hooks').installHooks()}catch(e){}" >>"$LOG" 2>&1 || true

free_port_if_foreign

# Start Electron in background; LSUIElement app has no Terminal
nohup npm start >>"$LOG" 2>&1 &
echo $! >"$PIDFILE"

for _ in $(seq 1 100); do
  if is_ours; then
    exit 0
  fi
  if [[ -f "$PIDFILE" ]]; then
    pid="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
  fi
  sleep 0.1
done

alert "Pet Grok failed to start. Check $LOG"
exit 1
