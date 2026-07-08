#!/bin/bash
# Pet Grok — macOS first-time setup (same role as RUN ME ONCE FIRST.bat on Windows)

cd "$(dirname "$0")" || exit 1

# --- PATH for double-click / Terminal.app ---
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

clear 2>/dev/null || true

echo "========================================"
echo " Pet Grok — first-time install + start"
echo "========================================"
echo ""
echo "Working directory: $(pwd)"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not on PATH."
  echo "Install Node 18+ from https://nodejs.org or: brew install node"
  echo ""
  read -r -p "Press Enter to close..." _
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is not on PATH."
  echo ""
  read -r -p "Press Enter to close..." _
  exit 1
fi

echo "Node: $(command -v node) ($(node -v 2>/dev/null || echo '?'))"
echo "npm:  $(command -v npm)"
echo ""

echo "[1/3] npm install ..."
if ! npm install; then
  echo ""
  echo "ERROR: npm install failed."
  read -r -p "Press Enter to close..." _
  exit 1
fi

echo ""
echo "[2/3] Installing Grok hooks to ~/.grok/hooks/pet.json ..."
if ! node -e "const h=require('./main/hooks'); console.log('hooks:', h.installHooks());"; then
  echo "WARNING: hook install failed."
fi

echo ""
echo "[3/3] Starting Pet Grok ..."
echo "Close this window or press Ctrl+C to stop the pet."
echo ""

npm start
status=$?

echo ""
echo "Pet Grok exited (code $status)."
read -r -p "Press Enter to close..." _
exit "$status"
