param([switch]$Setup, [switch]$Update, [switch]$Audio, [switch]$Optional)
$ErrorActionPreference = 'Stop'
$taskDashboard = Split-Path -Parent $PSScriptRoot
$taskGame = Split-Path -Parent $taskDashboard
$taskProxy = Join-Path $taskGame 'SDVX7-Proxy-main'
$taskPython = Join-Path $taskProxy '.venv/Scripts/python.exe'
$taskPrefix = @()
$taskArguments = @()
if ($Setup -or $Update) {
    $taskEntry = 'scripts.bootstrap'
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $taskPython = (Get-Command py).Source
        $taskPrefix = @('-3')
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        $taskPython = (Get-Command python).Source
    } elseif (-not (Test-Path -LiteralPath $taskPython)) {
        throw 'Install Python 3.10 or newer, then rerun setup-dashboard.bat.'
    }
    if ($Update) { $taskArguments += '--update' }
} else {
    if (-not (Test-Path -LiteralPath $taskPython)) {
        throw 'Run setup-dashboard.bat first to install the sibling proxy.'
    }
    $taskEntry = if ($Optional) { 'scripts.optional_setup' } elseif ($Audio) { 'scripts.audio_setup' } else { 'scripts.launcher' }
}
Push-Location $taskDashboard
try {
    & $taskPython @taskPrefix -m $taskEntry @taskArguments
    $taskExit = $LASTEXITCODE
} finally { Pop-Location }
exit $taskExit
