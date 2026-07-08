@echo off
title Pet Grok
cd /d "%~dp0"

echo ========================================
echo  Pet Grok — starting
echo ========================================
echo.
echo Working directory: %CD%
echo.

if not exist "node_modules\electron\" (
  echo Electron is not installed yet.
  echo Run "RUN ME ONCE FIRST.bat" first.
  echo.
  pause
  exit /b 1
)

echo Refreshing Grok hooks ^(~/.grok/hooks/pet.json^) ...
call node -e "const h=require('./main/hooks'); console.log('hooks:', h.installHooks());"
if errorlevel 1 (
  echo WARNING: could not install hooks — pet may not react to Grok TUI.
)

echo.
echo Starting Pet Grok on 127.0.0.1:7788 ...
echo Close this window or press Ctrl+C to stop the pet.
echo.
call npm start

echo.
echo Pet Grok exited.
pause
