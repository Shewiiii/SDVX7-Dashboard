param([switch]$Setup, [switch]$Update)
$ErrorActionPreference = 'Stop'
$taskTracker = Split-Path -Parent $PSScriptRoot
$taskPython = Join-Path $taskTracker '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
    throw "Run the VF tracker's setup.bat first."
}
$taskEntry = if ($Setup -or $Update) { 'setup.py' } else { 'launcher.py' }
$taskArguments = @()
if ($Update) { $taskArguments += '--update' }
Push-Location $PSScriptRoot
try {
    & $taskPython (Join-Path $PSScriptRoot $taskEntry) @taskArguments
    $taskExit = $LASTEXITCODE
} finally { Pop-Location }
exit $taskExit
