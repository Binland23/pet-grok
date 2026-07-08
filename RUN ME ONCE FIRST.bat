@echo off
title Pet Grok — first-time setup
cd /d "%~dp0"

echo ========================================
echo  Pet Grok — first-time install + start
echo ========================================
echo.
echo Working directory: %CD%
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not on PATH. Install Node 18+ from https://nodejs.org
  echo.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm is not on PATH.
  echo.
  pause
  exit /b 1
)

echo [1/3] npm install ...
call npm install
if errorlevel 1 (
  echo.
  echo ERROR: npm install failed.
  pause
  exit /b 1
)

echo.
echo [2/3] Installing Grok hooks to %%USERPROFILE%%\.grok\hooks\pet.json ...
call node -e "const h=require('./main/hooks'); console.log('hooks:', h.installHooks());"
if errorlevel 1 (
  echo WARNING: hook install failed.
)

echo.
echo [3/3] Starting Pet Grok ...
echo Close this window or press Ctrl+C to stop the pet.
echo.
call npm start

echo.
echo Pet Grok exited.
pause
