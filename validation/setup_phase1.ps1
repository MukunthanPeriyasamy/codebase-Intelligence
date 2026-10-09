param([string]$Python = '3.12')
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
    if (-not (Test-Path -LiteralPath '.research/venv/Scripts/python.exe')) {
        & uv --cache-dir .research/uv-cache venv --python $Python .research/venv
        if ($LASTEXITCODE -ne 0) { throw 'Could not create validation environment.' }
    }
    & uv --cache-dir .research/uv-cache pip install --python .research/venv/Scripts/python.exe -r validation/phase1-requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Could not install pinned validation dependencies.' }
    $backendPath = Join-Path '.research' ('repowise-' + $pins.repowise.commit)
    & uv --cache-dir .research/uv-cache pip install --python .research/venv/Scripts/python.exe --no-deps $backendPath
    if ($LASTEXITCODE -ne 0) { throw 'Could not install pinned RepoWise source.' }
} finally {
    Pop-Location
}
