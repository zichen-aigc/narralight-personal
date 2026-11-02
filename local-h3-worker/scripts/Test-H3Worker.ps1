param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot '..\config.json')
)

$ErrorActionPreference = 'Stop'
$workerRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$configFull = [IO.Path]::GetFullPath($ConfigPath)
Push-Location $workerRoot
try {
    & node (Join-Path $workerRoot 'src\cli.mjs') doctor --config $configFull
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
