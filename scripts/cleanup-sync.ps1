$ErrorActionPreference = 'Stop'
$taskWorkers = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'"
foreach ($taskWorker in $taskWorkers) {
    if ($taskWorker.ExecutablePath -ne $env:SDVX_WORKER_PYTHON) { continue }
    if (-not $taskWorker.CommandLine) { continue }
    $taskCommand = $taskWorker.CommandLine.TrimEnd('"')
    # Recognize old file-based workers as well as the current module entry point.
    if (-not ($taskCommand.EndsWith($env:SDVX_WORKER_SCRIPT) -or $taskCommand.EndsWith(' -m scripts.sync'))) { continue }
    $taskParent = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskWorker.ParentProcessId)"
    if ($taskParent -and $taskParent.CreationDate -le $taskWorker.CreationDate) { continue }
    & taskkill /PID $taskWorker.ProcessId /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop the leftover dashboard worker.' }
    Write-Output 'Stopped a leftover dashboard sync worker.'
}
