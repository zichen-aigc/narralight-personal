param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot '..\config.json'),
    [string]$H3Root = (Join-Path $env:USERPROFILE 'Narralight-H3')
)

$ErrorActionPreference = 'Stop'
$workerRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$configFull = [IO.Path]::GetFullPath($ConfigPath)
$comfyRoot = Join-Path $H3Root 'app\ComfyUI_windows_portable'
$modelsRoot = Join-Path $H3Root 'models'
$inputRoot = Join-Path $H3Root 'input'
$outputRoot = Join-Path $H3Root 'outputs'
$tempRoot = Join-Path $H3Root 'temp'
$userRoot = Join-Path $H3Root 'user'
$logRoot = Join-Path $H3Root 'logs'
$listeners = @(Get-NetTCPConnection -LocalPort 8188 -State Listen -ErrorAction SilentlyContinue)
$unsafe = @($listeners | Where-Object { $_.LocalAddress -ne '127.0.0.1' })
if ($unsafe.Count -gt 0) {
    throw 'Port 8188 is listening on a non-loopback address. Refusing to start the worker.'
}

if ($listeners.Count -eq 0) {
    $python = Join-Path $comfyRoot 'python_embeded\python.exe'
    $main = Join-Path $comfyRoot 'ComfyUI\main.py'
    if (-not (Test-Path -LiteralPath $python -PathType Leaf) -or -not (Test-Path -LiteralPath $main -PathType Leaf)) {
        throw 'ComfyUI portable runtime was not found.'
    }
    if (-not (Test-Path -LiteralPath $modelsRoot -PathType Container)) {
        throw 'H3 model directory was not found.'
    }
    foreach ($directory in @($inputRoot, $outputRoot, $tempRoot, $userRoot, $logRoot)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    $arguments = @(
        '-s',
        $main,
        '--windows-standalone-build',
        '--listen', '127.0.0.1',
        '--port', '8188',
        '--disable-auto-launch',
        '--lowvram',
        '--offline',
        '--disable-all-custom-nodes',
        '--preview-method', 'none',
        '--models-directory', $modelsRoot,
        '--input-directory', $inputRoot,
        '--output-directory', $outputRoot,
        '--temp-directory', $tempRoot,
        '--user-directory', $userRoot
    )
    # Start-Process joins arguments into a command line; quote paths containing spaces.
    $quotedArguments = $arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }
    Start-Process -FilePath $python -ArgumentList $quotedArguments -WorkingDirectory $comfyRoot -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logRoot 'comfy.stdout.log') `
        -RedirectStandardError (Join-Path $logRoot 'comfy.stderr.log') | Out-Null
}

$ready = $false
for ($attempt = 0; $attempt -lt 120; $attempt++) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8188/system_stats' -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            $ready = $true
            break
        }
    }
    catch {
    }
    Start-Sleep -Seconds 1
}
if (-not $ready) {
    throw 'ComfyUI did not become ready on 127.0.0.1:8188.'
}

$listener = @(Get-NetTCPConnection -LocalPort 8188 -State Listen -ErrorAction Stop)
if (@($listener | Where-Object { $_.LocalAddress -ne '127.0.0.1' }).Count -gt 0) {
    throw 'ComfyUI escaped the required loopback-only boundary.'
}

Push-Location $workerRoot
try {
    & node (Join-Path $workerRoot 'src\cli.mjs') run --config $configFull
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
