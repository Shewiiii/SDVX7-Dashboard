@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" -Update
pause
