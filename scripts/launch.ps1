param([switch]$Setup, [switch]$Update)
$ErrorActionPreference = 'Stop'
$taskDashboard = Split-Path -Parent $PSScriptRoot
$taskProxy = Split-Path -Parent $taskDashboard
$taskPython = Join-Path $taskProxy '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
    throw "Run the proxy's setup.bat first."
}
$taskEntry = if ($Setup -or $Update) { 'scripts.setup' } else { 'scripts.launcher' }
$taskArguments = @()
if ($Update) { $taskArguments += '--update' }
Push-Location $taskDashboard
try {
    & $taskPython -m $taskEntry @taskArguments
    $taskExit = $LASTEXITCODE
} finally { Pop-Location }
exit $taskExit
