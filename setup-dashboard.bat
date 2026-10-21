@echo off
setlocal
if not "%~1"=="" exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1" -Setup
set "DASHBOARD_EXIT=%errorlevel%"
if not "%DASHBOARD_EXIT%"=="0" echo Setup did not finish. Run it again to resume.
pause
exit /b %DASHBOARD_EXIT%
