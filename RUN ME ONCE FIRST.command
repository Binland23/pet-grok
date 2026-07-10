#!/bin/bash
# Pet Grok — macOS first-time setup (same role as RUN ME ONCE FIRST.bat on Windows)

cd "$(dirname "$0")" || exit 1

# Minimize *this* Terminal window (Finder double-click always opens one).
# Match by tty and/or window title — "front window" is wrong once Electron focuses.
# Retries: tab tty binding and title can lag; Electron may also steal focus mid-start.
_pet_minimize_launch_window() {
  case "$(uname -s 2>/dev/null)" in Darwin) ;; *) return 0 ;; esac

  # Distinct title so AppleScript can find us even if tty lookup fails.
  printf '\033]0;Pet Grok Launcher\007' 2>/dev/null || true

  local tty_raw tty_name ascript_file
  tty_raw=$(tty 2>/dev/null || true)
  tty_name=""
  case "$tty_raw" in
    /dev/*) tty_name=${tty_raw#/dev/} ;;
  esac

  # Persist script for retries (osascript -e is single-line only).
  ascript_file=$(mktemp -t pet-grok-minimize 2>/dev/null || echo "/tmp/pet-grok-minimize-$$.scpt.txt")
  cat >"$ascript_file" <<APPLESCRIPT
tell application "Terminal"
  repeat with w in windows
    set shouldMini to false
    try
      set wname to name of w as text
      if wname contains "Pet Grok Launcher" then set shouldMini to true
      if wname contains "RUN ME.command" then set shouldMini to true
      if wname contains "RUN ME ONCE FIRST" then set shouldMini to true
    end try
    try
      repeat with t in tabs of w
        try
          set tdev to tty of t as text
          if "${tty_name}" is not "" then
            if tdev contains "${tty_name}" then set shouldMini to true
          end if
          if "${tty_raw}" is not "" then
            if tdev contains "${tty_raw}" then set shouldMini to true
          end if
        end try
      end repeat
    end try
    if shouldMini then
      try
        repeat with t in tabs of w
          try
            set background color of t to {2827, 4626, 8224}
            set normal text color of t to {59624, 61166, 63222}
            set cursor color of t to {57825, 1542, 0}
            set bold text color of t to {65535, 53970, 0}
          end try
        end repeat
      end try
      try
        set miniaturized of w to true
      end try
    end if
  end repeat
end tell
APPLESCRIPT

  # Immediate attempt before npm/electron, then re-assert after focus changes.
  osascript "$ascript_file" 2>/dev/null || true
  (
    for delay in 0.2 0.5 1.0 2.0 4.0; do
      sleep "$delay" 2>/dev/null || true
      osascript "$ascript_file" 2>/dev/null || true
    done
    rm -f "$ascript_file" 2>/dev/null || true
  ) &
  disown 2>/dev/null || true
}
_pet_minimize_launch_window

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

# --- Pet Grok theme: app-red banner, gold accents (matches renderer palette) ---
R=$'\033[1;91m'
G=$'\033[1;93m'
W=$'\033[1;97m'
D=$'\033[0;90m'
P=$'\033[1;95m'
C=$'\033[1;96m'
F=$'\033[1;92m'
X=$'\033[0m'

echo ""
printf '%s\n' \
  "${R}   _____  ______ _______    _____ _____   ____  _  __${X}" \
  "${R}  |  __ \\|  ____|__   __|  / ____|  __ \\ / __ \\| |/ /${X}" \
  "${R}  | |__) | |__     | |    | |  __| |__) | |  | | ' / ${X}" \
  "${R}  |  ___/|  __|    | |    | | |_ |  _  /| |  | |  <  ${X}" \
  "${R}  | |    | |____   | |    | |__| | | \\ \\| |__| | . \\ ${X}" \
  "${R}  |_|    |______|  |_|     \\_____|_|  \\_\\\\____/|_|\\_\\${X}"
echo ""
echo "${G}  ================================================${X}"
echo "${G}    T H E   F I R S T   R I T U A L   B E G I N S${X}"
echo "${G}  ================================================${X}"
echo ""
echo "${P}>o) ___ (o< ${X}  ${C}  ,-.__,-.  ${X}  ${F}   _/~\\_    ${X}  ${R}   ,-@@-.   ${X}"
echo "${P} ( ^ u ^ )  ${X}  ${C} ( *    * ) ${X}  ${F} ( o   o )  ${X}  ${R}  ( o  o )  ${X}"
echo "${P}  ) ... (   ${X}  ${C} (   ..   ) ${X}  ${F} (  ~w~  )  ${X}  ${R} v(  __  )v ${X}"
echo "${P} (_,,~,,_)  ${X}  ${C}  \`~~~~~~'  ${X}  ${F} /(     )\\  ${X}  ${R}   ^^  ^^   ${X}"
echo "${P}  AXOLOTL   ${X}  ${C} CLOUD PUP  ${X}  ${F}MATCHA FROG ${X}  ${R}HERMIT CRAB ${X}"
echo ""
echo "${D}  Lair: $(pwd)${X}"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "${R}  !! THE RITUAL CANNOT PROCEED !!${X}"
  echo "${W}  Node.js is not on PATH.${X}"
  echo "${W}  Install Node 18+ from https://nodejs.org or: brew install node${X}"
  echo ""
  read -r -p "Press Enter to close..." _
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "${R}  !! THE RITUAL CANNOT PROCEED !!${X}"
  echo "${W}  npm is not on PATH.${X}"
  echo ""
  read -r -p "Press Enter to close..." _
  exit 1
fi

echo "${D}  Node: $(command -v node) ($(node -v 2>/dev/null || echo '?'))${X}"
echo "${D}  npm:  $(command -v npm)${X}"
echo ""

echo "${G}  [I of III] Gathering the components  ${D}(npm install)${X}"
if ! npm install; then
  echo ""
  echo "${R}  !! THE RITUAL HAS FAILED: npm install did not survive. !!${X}"
  read -r -p "Press Enter to close..." _
  exit 1
fi

echo ""
echo "${G}  [II of III] Binding Grok hooks  ${D}(~/.grok/hooks/pet.json)${X}"
if ! node -e "const h=require('./main/hooks'); console.log('hooks:', h.installHooks());"; then
  echo "${R}  WARNING: the binding failed.${X}"
fi

echo ""
echo "${G}  [III of III] SUMMONING PET GROK ...${X}"
echo "${D}  Close this window or press Ctrl+C to banish the pet.${X}"
echo ""

npm start
status=$?

echo ""
echo "${R}  ... PET GROK HAS RETURNED TO THE VOID (code $status) ...${X}"
read -r -p "Press Enter to close..." _
exit "$status"
