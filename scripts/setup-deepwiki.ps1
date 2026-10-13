param(
    [string]$ToolDirectory = (Join-Path $env:LOCALAPPDATA 'CodebaseIntelligence/deepwiki-tool'),
    [string]$PythonExecutable,
    [string]$SourceDirectory,
    [switch]$NoRegister
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolRoot = [IO.Path]::GetFullPath($ToolDirectory)
$pin = Get-Content -LiteralPath (Join-Path $projectRoot 'tools/deepwiki/pin.json') -Raw | ConvertFrom-Json
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'Install uv, then rerun setup.' }
New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
$env:UV_CACHE_DIR = Join-Path $toolRoot 'package-cache'
$runtime = Join-Path $toolRoot 'runtime/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $runtime)) {
    if ($PythonExecutable) { & uv venv --python $PythonExecutable (Join-Path $toolRoot 'runtime') }
    else { & uv venv --managed-python --python 3.12 (Join-Path $toolRoot 'runtime') }
    if ($LASTEXITCODE -ne 0) { throw 'DeepWiki runtime creation failed.' }
}
$prefix = & $runtime -I -c 'import sys; print(sys.prefix)'
if ([IO.Path]::GetFullPath($prefix) -ne (Join-Path $toolRoot 'runtime')) { throw 'Runtime isolation check failed.' }
$version = & $runtime -I -c 'import sys; print(str(sys.version_info.major)+chr(46)+str(sys.version_info.minor))'
if ($version -ne '3.12') { throw 'This pinned DeepWiki runtime requires its separate Python 3.12 environment. Your system Python is unchanged.' }
if (-not $SourceDirectory) {
    $SourceDirectory = Join-Path $toolRoot 'source'
    if (-not (Test-Path -LiteralPath $SourceDirectory)) {
        & git clone --no-checkout $pin.repository $SourceDirectory
        if ($LASTEXITCODE -ne 0) { throw 'DeepWiki source download failed.' }
    }
    & git -C $SourceDirectory checkout --detach $pin.commit
    if ($LASTEXITCODE -ne 0) { throw 'Could not select pinned DeepWiki source.' }
}
$revision = & git -C $SourceDirectory rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $revision -ne $pin.commit) { throw 'DeepWiki source does not match the pinned revision.' }
$changes = & git -C $SourceDirectory status --porcelain --untracked-files=no
if ($LASTEXITCODE -ne 0 -or $changes) { throw 'DeepWiki source has local modifications. Use a clean pinned checkout.' }
& uv pip install --python $runtime --no-deps -r (Join-Path $projectRoot 'tools/deepwiki/requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'DeepWiki dependency installation failed.' }
$env:TIKTOKEN_CACHE_DIR = Join-Path $toolRoot 'token-cache'
& $runtime -I -c 'import sys,tiktoken; tiktoken.get_encoding(sys.argv[1])' cl100k_base
if ($LASTEXITCODE -ne 0) { throw 'Tokenizer cache setup failed. Check network access and rerun setup.' }
New-Item -ItemType Directory -Force -Path (Join-Path $toolRoot 'upstream') | Out-Null
Copy-Item -LiteralPath (Join-Path $SourceDirectory 'api') -Destination (Join-Path $toolRoot 'upstream') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $SourceDirectory 'LICENSE') -Destination (Join-Path $toolRoot 'UPSTREAM-LICENSE') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'tools/deepwiki/pipeline.py') -Destination (Join-Path $toolRoot 'pipeline.py') -Force
foreach ($file in @('evidence.py', 'vector_store.py')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot ('worker/' + $file)) -Destination (Join-Path $toolRoot $file) -Force
}
$health = '{"operation":"health"}' | & $runtime -I -u (Join-Path $toolRoot 'pipeline.py')
if ($LASTEXITCODE -ne 0) { throw 'DeepWiki import/health check failed.' }
$parsed = $health | ConvertFrom-Json
if (-not $parsed.ok -or $parsed.data.upstream -ne $pin.commit) { throw 'DeepWiki health identity mismatch.' }
if (-not $NoRegister) {
    $settingsRoot = Join-Path $env:LOCALAPPDATA 'CodebaseIntelligence'
    New-Item -ItemType Directory -Force -Path $settingsRoot | Out-Null
    $manifest = Join-Path $settingsRoot 'deepwiki-tool.json'
    @{ directory = $toolRoot } | ConvertTo-Json | Set-Content -LiteralPath ($manifest + '.tmp') -Encoding utf8
    Move-Item -LiteralPath ($manifest + '.tmp') -Destination $manifest -Force
}
Write-Host ('DeepWiki pipeline ready at ' + $toolRoot)
Write-Host 'Restart the application. Build/resume the code index once; the old index is preserved separately.'
