param(
    [string]$TaskName = 'Narralight Personal H3 Worker',
    [string]$H3Root = (Join-Path $env:USERPROFILE 'Narralight-H3'),
    [string]$ConfigPath = (Join-Path $PSScriptRoot '..\config.json')
)

$ErrorActionPreference = 'Stop'
$startScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Start-H3Worker.ps1'))
$configFull = [IO.Path]::GetFullPath($ConfigPath)
if (-not (Test-Path -LiteralPath $configFull -PathType Leaf)) {
    throw 'Worker config does not exist.'
}

$arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -ConfigPath `"$configFull`" -H3Root `"$H3Root`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Narralight local MiniMax H3 worker; runs under the paired DPAPI user.' | Out-Null
Write-Output "Installed scheduled task: $TaskName"
