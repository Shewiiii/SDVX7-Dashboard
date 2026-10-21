@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1"
set "TRACKER_EXIT=%errorlevel%"
if not "%TRACKER_EXIT%"=="0" pause
exit /b %TRACKER_EXIT%
