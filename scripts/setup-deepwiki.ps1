param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$env:UV_CACHE_DIR = Join-Path $root '.local/uv-cache'
$runtime = Join-Path $root '.local/deepwiki-tool/runtime'
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'Install uv first: https://docs.astral.sh/uv/getting-started/installation/' }
if (-not (Test-Path "$runtime/Scripts/python.exe")) {
    & uv venv --python $Python $runtime
    if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed. Pass -Python with a Python 3.12 executable path.' }
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
