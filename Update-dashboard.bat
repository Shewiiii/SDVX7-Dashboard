@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Deploy-dashboard.ps1" -UpdateOnly
pause
