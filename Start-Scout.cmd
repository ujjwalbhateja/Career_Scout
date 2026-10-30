@echo off
setlocal
cd /d "%~dp0"
set "SCOUT_NODE=%~dp0.local\tools\node-x64\node-v22.14.0-win-x64\node.exe"
set "SCOUT_NPM=%~dp0.local\tools\npm-runtime\package\bin\npm-cli.js"
if not exist "%SCOUT_NODE%" goto system_node
if not exist "%SCOUT_NPM%" goto system_node
set "PATH=%~dp0.local\tools\node-x64\node-v22.14.0-win-x64;%PATH%"
"%SCOUT_NODE%" "%SCOUT_NPM%" run dev
exit /b %errorlevel%
:system_node
call npm.cmd run dev
exit /b %errorlevel%
