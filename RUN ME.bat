@echo off
if /i not "%~1"=="--minimized" (
  start "" /min "%~f0" --minimized
  exit /b
)

title PET GROK — THE SUMMONING
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
echo %G%       Y O U R   C O M P A N I O N   S T I R S%X%
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

if not exist "node_modules\electron\" (
  echo %R%  !! THE SUMMONING CANNOT PROCEED !!%X%
  echo %W%  Electron is not installed yet.%X%
  echo %W%  Perform the ritual: run "RUN ME ONCE FIRST.bat" first.%X%
  echo(
  pause
  exit /b 1
)

echo %G%  ^>^>^> Binding Grok hooks  %D%(~/.grok/hooks/pet.json)%X%
call node -e "const h=require('./main/hooks'); console.log('hooks:', h.installHooks());"
if errorlevel 1 (
  echo %R%  WARNING: the binding failed — pet may not react to Grok TUI.%X%
)

echo(
echo %G%  ^>^>^> SUMMONING PET GROK  %D%(127.0.0.1:7788)%X%
echo %D%  Close this window or press Ctrl+C to banish the pet.%X%
echo(
call npm start

echo(
echo %R%  ... PET GROK HAS RETURNED TO THE VOID ...%X%
pause
