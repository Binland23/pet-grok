@echo off
title PET GROK — THE FIRST RITUAL
cd /d "%~dp0"

rem --- Pet Grok theme: black console, red/gold ANSI (Win10+ supports VT in cmd) ---
color 0C
for /f %%E in ('echo prompt $E^| cmd') do set "ESC=%%E"
set "R=%ESC%[1;91m"
set "G=%ESC%[1;93m"
set "W=%ESC%[1;97m"
set "D=%ESC%[0;90m"
set "P=%ESC%[1;95m"
set "C=%ESC%[1;96m"
set "F=%ESC%[1;92m"
set "X=%ESC%[0m"

echo(
echo %R%   _____  ______ _______    _____ _____   ____  _  __%X%
echo %R%  ^|  __ \^|  ____^|__   __^|  / ____^|  __ \ / __ \^| ^|/ /%X%
echo %R%  ^| ^|__) ^| ^|__     ^| ^|    ^| ^|  __^| ^|__) ^| ^|  ^| ^| ' / %X%
echo %R%  ^|  ___/^|  __^|    ^| ^|    ^| ^| ^|_ ^|  _  /^| ^|  ^| ^|  ^<  %X%
echo %R%  ^| ^|    ^| ^|____   ^| ^|    ^| ^|__^| ^| ^| \ \^| ^|__^| ^| . \ %X%
echo %R%  ^|_^|    ^|______^|  ^|_^|     \_____^|_^|  \_\\____/^|_^|\_\%X%
echo(
echo %G%  ================================================%X%
echo %G%    T H E   F I R S T   R I T U A L   B E G I N S%X%
echo %G%  ================================================%X%
echo(
echo %P%^>o) ___ (o^< %X%  %C%  ,-.__,-.  %X%  %F%   _/~\_    %X%  %R%   ,-@@-.   %X%
echo %P% ( ^^ u ^^ )  %X%  %C% ( *    * ) %X%  %F% ( o   o )  %X%  %R%  ( o  o )  %X%
echo %P%  ) ... (   %X%  %C% (   ..   ) %X%  %F% (  ~w~  )  %X%  %R% v(  __  )v %X%
echo %P% (_,,~,,_)  %X%  %C%  `~~~~~~'  %X%  %F% /(     )\  %X%  %R%   ^^^^  ^^^^   %X%
echo %P%  AXOLOTL   %X%  %C% CLOUD PUP  %X%  %F%MATCHA FROG %X%  %R%HERMIT CRAB %X%
echo(
echo %D%  Lair: %CD%%X%
echo(

where node >nul 2>&1
if errorlevel 1 (
  echo %R%  !! THE RITUAL CANNOT PROCEED !!%X%
  echo %W%  Node.js is not on PATH. Install Node 18+ from https://nodejs.org%X%
  echo(
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo %R%  !! THE RITUAL CANNOT PROCEED !!%X%
  echo %W%  npm is not on PATH.%X%
  echo(
  pause
  exit /b 1
)

echo %G%  [I of III] Gathering the components  %D%(npm install)%X%
call npm install
if errorlevel 1 (
  echo(
  echo %R%  !! THE RITUAL HAS FAILED: npm install did not survive. !!%X%
  pause
  exit /b 1
)

echo(
echo %G%  [II of III] Binding Grok hooks  %D%(%%USERPROFILE%%\.grok\hooks\pet.json)%X%
call node -e "const h=require('./main/hooks'); console.log('hooks:', h.installHooks());"
if errorlevel 1 (
  echo %R%  WARNING: the binding failed.%X%
)

echo(
echo %G%  [III of III] SUMMONING PET GROK ...%X%
echo %D%  Close this window or press Ctrl+C to banish the pet.%X%
echo(
call npm start

echo(
echo %R%  ... PET GROK HAS RETURNED TO THE VOID ...%X%
pause
