param(
    [ValidateSet('3.12', '3.14')][string]$Python = '3.12',
    [string]$PythonExecutable,
    [string]$ToolDirectory = (Join-Path $env:LOCALAPPDATA 'CodebaseIntelligence/repowise-tool')
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolRoot = [System.IO.Path]::GetFullPath($ToolDirectory)
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'Install uv first, then rerun this setup: https://docs.astral.sh/uv/getting-started/installation/' }
New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
$runtime = Join-Path $toolRoot 'runtime/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $runtime)) {
    if ($PythonExecutable) { & uv venv --python $PythonExecutable (Join-Path $toolRoot 'runtime') }
    else { & uv venv --managed-python --python $Python (Join-Path $toolRoot 'runtime') }
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the separate RepoWise environment.' }
}
$version = & $runtime -I -c 'import sys; print(sys.version.split()[0].rsplit(chr(46),1)[0])'
if ($version -ne $Python) { throw 'Existing tool uses another Python version. Choose a fresh ToolDirectory.' }
$prefix = & $runtime -I -c 'import sys; print(sys.prefix)'
if ([System.IO.Path]::GetFullPath($prefix) -ne (Join-Path $toolRoot 'runtime')) { throw 'Python did not activate the isolated tool environment. Setup stopped before installing packages.' }
& uv pip install --python $runtime --no-deps -r (Join-Path $projectRoot 'tools/repowise-mcp/requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not install pinned tool dependencies.' }
$pin = (Get-Content -LiteralPath (Join-Path $projectRoot 'validation/phase1-pins.json') -Raw | ConvertFrom-Json).repowise
$archive = Join-Path $toolRoot 'repowise.zip'
if (-not (Test-Path -LiteralPath $archive)) {
    $cached = Join-Path $projectRoot '.research/repowise.zip'
    if (Test-Path -LiteralPath $cached) { Copy-Item -LiteralPath $cached -Destination $archive }
    else { Invoke-WebRequest -Uri ('https://codeload.github.com/repowise-dev/repowise/zip/' + $pin.commit) -OutFile $archive -TimeoutSec 120 }
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.archive_sha256) { throw 'RepoWise archive checksum mismatch.' }
& uv pip install --python $runtime --no-deps $archive
if ($LASTEXITCODE -ne 0) { throw 'Could not install pinned RepoWise.' }
foreach ($file in @('server.py', 'analyzer.py')) { Copy-Item -LiteralPath (Join-Path $projectRoot ('tools/repowise-mcp/' + $file)) -Destination (Join-Path $toolRoot $file) -Force }
foreach ($file in @('evidence.py', 'retrieval.py', 'vector_store.py')) { Copy-Item -LiteralPath (Join-Path $projectRoot ('worker/' + $file)) -Destination (Join-Path $toolRoot $file) -Force }
$settingsRoot = Join-Path $env:LOCALAPPDATA 'CodebaseIntelligence'
New-Item -ItemType Directory -Force -Path $settingsRoot | Out-Null
@{ directory = $toolRoot } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $settingsRoot 'repowise-tool.json') -Encoding utf8
Write-Host ('RepoWise MCP tool installed separately at ' + $toolRoot)
Write-Host 'In the application, open Settings > RepoWise tool > Check RepoWise setup. Repeat setup on each computer.'
Write-Host 'The application discovers this installation automatically on this computer.'
