param([switch]$UpdateOnly)
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
$taskPython = Join-Path (Split-Path -Parent $PSScriptRoot) '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) { $taskPython = (Get-Command python).Source }
function Invoke-DashboardVercel {
    & npx --yes vercel@63.1.2 @args
    if ($LASTEXITCODE -ne 0) { throw 'Vercel command did not complete. Resume after resolving the message above.' }
}
try {
    if (-not $UpdateOnly) {
        & npx --yes vercel@63.1.2 whoami
        if ($LASTEXITCODE -ne 0) { Invoke-DashboardVercel login }
        if (-not (Test-Path -LiteralPath '.vercel/project.json')) {
            Invoke-DashboardVercel link --yes --project shewi-sdvx-record
        }
        Write-Host 'Add the Neon FREE plan. Keep Vercel on Hobby. No GitHub repository is needed.'
        Invoke-DashboardVercel integration add neon --name shewi-sdvx-record --plan free_v3 -m region=fra1 -m auth=false --no-env-pull -e production -e preview
        & node scripts/connect.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Upload secret could not be configured.' }
    }
    Invoke-DashboardVercel deploy --prod --yes
    if (-not $UpdateOnly) {
        $taskDashboardUrl = Read-Host 'Paste the stable production URL shown above (https://...vercel.app)'
        & node scripts/connect.mjs $taskDashboardUrl --local-only
        if ($LASTEXITCODE -ne 0) { throw 'Dashboard URL was not configured.' }
        Write-Host 'If the site is public, disable production Deployment Protection in Vercel settings.'
        & $taskPython sync.py --once
        if ($LASTEXITCODE -ne 0) { throw 'First sync did not complete. Check Deployment Protection and the database connection, then run python sync.py --once.' }
        Write-Host 'Ready. Use Start-tracker-with-dashboard.bat for future sessions.'
    }
} finally { Pop-Location }
