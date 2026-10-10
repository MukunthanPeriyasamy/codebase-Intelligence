param([ValidateSet('3.12', '3.14')][string]$Python = '3.12', [string]$Environment = '.research/venv')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    New-Item -ItemType Directory -Force -Path '.research' | Out-Null
    $pins = Get-Content -LiteralPath 'validation/phase1-pins.json' -Raw | ConvertFrom-Json
    foreach ($entry in $pins.PSObject.Properties) {
        $name = $entry.Name
        $pin = $entry.Value
        $archivePath = Join-Path '.research' ($name + '.zip')
        if (-not (Test-Path -LiteralPath $archivePath)) {
            Invoke-WebRequest -Uri ('https://codeload.github.com/' + $pin.owner + '/' + $name + '/zip/' + $pin.commit) -OutFile $archivePath
        }
        if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.archive_sha256) {
            throw ('Archive checksum mismatch: ' + $name)
        }
        $sourcePath = Join-Path '.research' ($name + '-' + $pin.commit)
        if (-not (Test-Path -LiteralPath $sourcePath)) {
            Expand-Archive -LiteralPath $archivePath -DestinationPath '.research'
        }
        @{name=$name; owner=$pin.owner; ref=$pin.version; commit=$pin.commit} |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path '.research' ($name + '-pin.json')) -Encoding utf8
    }
    $environmentPython = Join-Path $Environment 'Scripts/python.exe'
    if (-not (Test-Path -LiteralPath $environmentPython)) {
        & uv --cache-dir .research/uv-cache venv --python $Python $Environment
        if ($LASTEXITCODE -ne 0) { throw 'Could not create validation environment.' }
    }
    $actualVersion = & $environmentPython -c 'import sys; print("%d.%d" % sys.version_info[:2])'
    if ($LASTEXITCODE -ne 0 -or $actualVersion -ne $Python) { throw 'Existing environment uses a different Python version. Choose another -Environment directory.' }
    & uv --cache-dir .research/uv-cache pip install --python $environmentPython -r validation/phase1-requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Could not install pinned validation dependencies.' }
    $backendPath = Join-Path '.research' ('repowise-' + $pins.repowise.commit)
    & uv --cache-dir .research/uv-cache pip install --python $environmentPython --no-deps $backendPath
    if ($LASTEXITCODE -ne 0) { throw 'Could not install pinned RepoWise source.' }
} finally {
    Pop-Location
}
