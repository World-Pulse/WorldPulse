# -----------------------------------------------------------------------------
#  WorldPulse - sync this PC with GitHub right now, and keep the automatic
#  sync healthy. Run it by double-clicking "Sync WorldPulse now.cmd" in the
#  worldpulse folder.
#   1. Sets up the "WorldPulse auto-push" scheduled task again: every 30
#      minutes, also on battery, catching up after sleep, and a stuck run is
#      stopped after 15 minutes instead of blocking every later run.
#   2. Syncs now, in this window (if GitHub asks you to sign in, do it once).
#   3. Says whether GitHub has everything from this PC.
# -----------------------------------------------------------------------------
$ErrorActionPreference = 'Continue'
$repo     = Split-Path -Parent $PSScriptRoot
$autoPush = Join-Path $PSScriptRoot 'auto-push.ps1'
$log      = Join-Path $env:LOCALAPPDATA 'worldpulse-auto-push.log'
$name     = 'WorldPulse auto-push'
Set-Location $repo

Write-Host ''
Write-Host 'WorldPulse: syncing this PC with GitHub' -ForegroundColor Cyan
Write-Host ''

# 1. The automatic sync
try {
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  $action   = New-ScheduledTaskAction -Execute 'powershell.exe' `
                -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$autoPush`""
  $trigger  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
                -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 3650)
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
                -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force -ErrorAction Stop | Out-Null
  Write-Host '[ok] Automatic sync: every 30 minutes, on battery too.' -ForegroundColor Green
} catch {
  Write-Host "[!] Couldn't set up the automatic sync: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 2. Sync now
Write-Host ''
Write-Host 'Syncing now. If a GitHub sign-in window opens, sign in...'
& $autoPush -Interactive

# 3. Did everything reach GitHub?
& git fetch v2 --quiet 2>$null
$waiting = @()
foreach ($b in @('main', 'autopilot-state')) {
  $n = (& git rev-list --count "v2/$b..$b" 2>$null | Out-String).Trim()
  if ($n -match '^\d+$' -and [int]$n -gt 0) { $waiting += "$b ($n commit(s))" }
}
Write-Host ''
if ($waiting.Count -eq 0) {
  Write-Host '[ok] GitHub has everything from this PC. The cloud autopilot uses it from its next shift.' -ForegroundColor Green
} else {
  Write-Host "[!] Not on GitHub yet: $($waiting -join ', ')" -ForegroundColor Yellow
  Write-Host "    Last lines of the sync log ($log):"
  if (Test-Path $log) { Get-Content $log -Tail 12 | ForEach-Object { Write-Host "    $_" } }
}
