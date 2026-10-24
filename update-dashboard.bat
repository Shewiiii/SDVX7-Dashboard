@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1" -Update
set "DASHBOARD_EXIT=%errorlevel%"
pause
exit /b %DASHBOARD_EXIT%
