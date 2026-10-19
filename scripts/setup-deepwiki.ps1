# The backend lock and native parser wheels are validated on Python 3.12.
param([string]$Python = '3.12')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$env:UV_CACHE_DIR = Join-Path $root '.local/uv-cache'
$runtime = Join-Path $root '.local/deepwiki-tool/runtime'
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'Install uv first: https://docs.astral.sh/uv/getting-started/installation/' }
$runtimePython = Join-Path $runtime 'Scripts/python.exe'
if (Test-Path -LiteralPath $runtime) {
    $runtimeVersion = ''
    if (Test-Path -LiteralPath $runtimePython) {
        $runtimeVersion = & $runtimePython -c 'import sys; print(str(sys.version_info.major) + chr(46) + str(sys.version_info.minor))'
        if ($LASTEXITCODE -ne 0) { $runtimeVersion = '' }
    }
    if (($runtimeVersion -join '').Trim() -ne '3.12') {
        # Preserve incompatible or incomplete environments. Never delete user data.
        $runtimeParent = [IO.Path]::GetFullPath((Join-Path $root '.local/deepwiki-tool'))
        $sourcePath = [IO.Path]::GetFullPath($runtime)
        $backupPath = Join-Path $runtimeParent ('runtime-backup-' + [guid]::NewGuid().ToString('N'))
        if ([IO.Path]::GetDirectoryName($sourcePath) -ne $runtimeParent -or
            [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($backupPath)) -ne $runtimeParent) {
            throw 'Runtime backup path is outside the intended runtime directory.'
        }
        Write-Host "Backend requires Python 3.12. Preserving incompatible runtime at $backupPath"
        Move-Item -LiteralPath $sourcePath -Destination $backupPath
    }
}
if (-not (Test-Path -LiteralPath $runtimePython)) {
    & uv venv --python $Python $runtime
    if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed. Pass -Python with a Python 3.12 executable path.' }
}
$runtimeVersion = & $runtimePython -c 'import sys; print(str(sys.version_info.major) + chr(46) + str(sys.version_info.minor))'
if ($LASTEXITCODE -ne 0 -or ($runtimeVersion -join '').Trim() -ne '3.12') {
    throw 'Backend requires Python 3.12. Rerun setup with -Python 3.12; Python 3.14 is not supported by requirements.lock.'
}
& uv pip install --python "$runtime/Scripts/python.exe" -r requirements.lock
if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed.' }
$env:TIKTOKEN_CACHE_DIR = Join-Path $root '.local/deepwiki-tool/token-cache'
& "$runtime/Scripts/python.exe" -c 'import sys,tiktoken; tiktoken.get_encoding(sys.argv[1])' cl100k_base
if ($LASTEXITCODE -ne 0) { throw 'Tokenizer preparation failed.' }
& npm.cmd ci --cache .local/npm-cache
if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
Write-Host 'Setup complete. Start Ollama, pull qwen3:8b and nomic-embed-text, then run npm start.'
