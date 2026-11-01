@echo off
setlocal
cd /d "%~dp0"
set "SCOUT_NODE=%~dp0.local\tools\node-x64\node-v22.14.0-win-x64\node.exe"
if not exist "%SCOUT_NODE%" set "SCOUT_NODE=node"
set "PATH=%~dp0.local\tools\node-x64\node-v22.14.0-win-x64;%PATH%"
"%SCOUT_NODE%" "%~dp0scripts\start-pipeline.mjs"
set "SCOUT_EXIT=%errorlevel%"
if not "%SCOUT_EXIT%"=="0" pause
exit /b %SCOUT_EXIT%
