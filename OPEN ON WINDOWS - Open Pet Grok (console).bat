@echo off
rem ============================================================
rem  Pet Grok — Windows console backup
rem  Prefer: OPEN ON WINDOWS - Open Pet Grok.lnk (has the icon)
rem  Mac users: OPEN ON MAC - Open Pet Grok.command or Desktop Pet Grok.app
rem  Port 7788 · service: pet-grok
rem  Always: open Electron app + minimize console when possible
rem ============================================================
setlocal
set PORT=7788
set SERVICE_ID=pet-grok
cd /d "%~dp0app" 2>nul
if errorlevel 1 (
  echo Could not find the app folder next to this launcher.
  pause
  exit /b 1
)

rem If already our service, re-show pet and exit
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 'http://127.0.0.1:%PORT%/api/health'; if ($r.Content -match 'service' -and $r.Content -match '%SERVICE_ID%') { Invoke-WebRequest -UseBasicParsing -Method POST -TimeoutSec 1 'http://127.0.0.1:%PORT%/show' | Out-Null; exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 exit /b 0

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not on PATH. Install Node 18+ from https://nodejs.org
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm is not on PATH. Reinstall Node.js from https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\electron\" (
  echo Installing dependencies (first launch)...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

rem Bind hooks (best-effort)
call node -e "try{require('./main/hooks').installHooks()}catch(e){}" >nul 2>&1

rem Re-launch minimized so the console stays out of the way while Electron runs
if /i not "%~1"=="--minimized" (
  start "" /min "%~f0" --minimized
  exit /b 0
)

title Pet Grok
call npm start
exit /b %ERRORLEVEL%
