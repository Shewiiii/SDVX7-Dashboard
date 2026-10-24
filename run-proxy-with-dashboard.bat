@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1"
set "PROXY_EXIT=%errorlevel%"
if not "%PROXY_EXIT%"=="0" pause
exit /b %PROXY_EXIT%
