$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
& node scripts/run-services.cjs
exit $LASTEXITCODE
