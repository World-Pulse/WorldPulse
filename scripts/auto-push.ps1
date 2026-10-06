# ─────────────────────────────────────────────────────────────────────────────
#  WorldPulse — auto-push (runs on Devon's Windows PC via Task Scheduler)
#
#  Pushes any new commits on main to GitHub, which then deploys them
#  automatically (.github/workflows/deploy.yml). Does nothing when there is
#  nothing new, so it's safe to run any time.
#
#  Turn on (one time, in PowerShell):
#    schtasks /Create /F /SC MINUTE /MO 30 /TN "WorldPulse auto-push" /TR "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\Users\devon\OneDrive\Desktop\worldpulse\scripts\auto-push.ps1"
#  Turn off:
#    schtasks /Delete /TN "WorldPulse auto-push" /F
#  Log:
#    %LOCALAPPDATA%\worldpulse-auto-push.log
# ─────────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$log  = Join-Path $env:LOCALAPPDATA 'worldpulse-auto-push.log'
Set-Location $repo

function Write-Log([string]$msg) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Out-File -FilePath $log -Append -Encoding utf8
}

# Only push main, and only when there are new commits
$branch = (git rev-parse --abbrev-ref HEAD | Out-String).Trim()
if ($branch -ne 'main') { Write-Log "skipped: on branch '$branch'"; exit 0 }

git fetch v2 main --quiet 2>$null
$ahead = [int]((git rev-list --count v2/main..main | Out-String).Trim())
if ($ahead -eq 0) { exit 0 }

Write-Log "pushing $ahead new commit(s)"
git push v2 main 2>&1 | ForEach-Object { Write-Log "  v2: $_" }
git push origin main 2>&1 | ForEach-Object { Write-Log "  origin: $_" }
