$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskTracker = Split-Path -Parent $taskRoot
$taskPython = Join-Path $taskTracker '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) { $taskPython = (Get-Command python).Source }
$taskLocal = Join-Path $taskRoot '.local'
New-Item -ItemType Directory -Path $taskLocal -Force | Out-Null
$taskSyncProcess = $null
try {
    if (Test-Path -LiteralPath (Join-Path $taskLocal 'sync-config.json')) {
        $taskSyncProcess = Start-Process -FilePath $taskPython -ArgumentList @('-u', ('"' + (Join-Path $taskRoot 'sync.py') + '"')) -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskLocal 'sync.log') -RedirectStandardError (Join-Path $taskLocal 'sync-errors.log')
        Write-Host 'Personal cloud sync started.'
    } else {
        Write-Host 'Cloud sync is not connected yet. Run configure.py after deploying.'
    }
    Push-Location $taskTracker
    try { & $taskPython -m tracker.launcher } finally { Pop-Location }
} finally {
    if ($null -ne $taskSyncProcess -and -not $taskSyncProcess.HasExited) {
        # One last acknowledged pass flushes the final captured results before exit.
        Stop-Process -Id $taskSyncProcess.Id -ErrorAction SilentlyContinue
        $null = $taskSyncProcess.WaitForExit(5000)
        & $taskPython (Join-Path $taskRoot 'sync.py') --once
    }
}
