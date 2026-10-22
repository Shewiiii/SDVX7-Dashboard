@echo off
cd /d "%~dp0"
if not exist "..\.venv\Scripts\python.exe" (
    echo Run the tracker setup.bat first.
    pause
    exit /b 1
)
"..\.venv\Scripts\python.exe" -u -m scripts.audio_setup
pause
