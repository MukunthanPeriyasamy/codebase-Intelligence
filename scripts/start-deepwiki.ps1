$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$python = Join-Path $root '.local/deepwiki-tool/runtime/Scripts/python.exe'
if (-not (Test-Path $python)) { throw 'Run scripts/setup-deepwiki.ps1 first.' }
foreach ($port in @(3000,8001)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Port $port is in use. Stop the existing service first." }
}
$env:TIKTOKEN_CACHE_DIR = Join-Path $root '.local/deepwiki-tool/token-cache'
$env:SERVER_BASE_URL = 'http://127.0.0.1:8001'
$env:PYTHON_BACKEND_HOST = $env:SERVER_BASE_URL
$env:NODE_ENV = 'production'
$logs = Join-Path $root '.local/logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$backend = Start-Process -FilePath $python -ArgumentList '-m uvicorn api.main:app --host 127.0.0.1 --port 8001' -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput "$logs/api.log" -RedirectStandardError "$logs/api-error.log"
try {
    $ready = $false
    for ($attempt=0; $attempt -lt 60; $attempt++) {
        if ($backend.HasExited) { throw "Backend stopped. See $logs/api-error.log" }
        try { $null = Invoke-RestMethod 'http://127.0.0.1:8001/health' -TimeoutSec 2; $ready=$true; break } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $ready) { throw "Backend startup timed out. See $logs/api-error.log" }
    Write-Host 'DeepWiki: http://127.0.0.1:3000 - press Ctrl+C to stop.'
    $env:NODE_ENV = 'development'
    & npm.cmd run dev:ui
} finally {
    if (-not $backend.HasExited) { Stop-Process -Id $backend.Id -ErrorAction SilentlyContinue }
}
