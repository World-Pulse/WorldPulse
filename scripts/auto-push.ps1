# ─────────────────────────────────────────────────────────────────────────────
#  WorldPulse — sync with GitHub (runs on Devon's Windows PC via Task Scheduler)
#
#  Every 30 minutes:
#   • fetches what the cloud autopilot pushed and fast-forwards this copy of main
#   • pushes any new local commits to the private repo (which deploys them)
#   • publishes local-only branches (autopilot-state, wip/*) to the private repo
#     — never to the public mirror
#   • keeps the public mirror's main in step with the private repo
#  Never force-pushes and never deletes anything. If unsaved edits are in the
#  way it leaves your files alone and tries again next time.
#
#  Turn on, repair, or sync right now: double-click "Sync WorldPulse now.cmd"
#  in the worldpulse folder (it runs scripts/sync-now.ps1).
#  Turn off:
#    schtasks /Delete /TN "WorldPulse auto-push" /F
#  Log:
#    %LOCALAPPDATA%\worldpulse-auto-push.log
#  Last result (read by the HQ sync): .git\worldpulse-sync-status
# ─────────────────────────────────────────────────────────────────────────────
param([switch]$Interactive)
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$log  = Join-Path $env:LOCALAPPDATA 'worldpulse-auto-push.log'
Set-Location $repo
if (-not $Interactive) {
  # Scheduled runs have no window to sign in with: fail fast and log it,
  # never wait on a hidden prompt (that would block every later run)
  $env:GIT_TERMINAL_PROMPT = '0'
  $env:GCM_INTERACTIVE = 'never'
}
$script:pushFailed = $false

function Write-Log([string]$msg) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Out-File -FilePath $log -Append -Encoding utf8
  if ($Interactive) { Write-Host "  $msg" }
}
# One line the HQ sync can read: when this last ran and how it went
function Set-SyncStatus([string]$state) {
  $line = "$(Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz') $state"
  try { [IO.File]::WriteAllText((Join-Path $repo '.git\worldpulse-sync-status'), $line + "`n") } catch { }
}
# Run git, return its output as one trimmed string (errors hidden)
function Get-Git { (& git @args 2>$null | Out-String).Trim() }
# Run git with the given argument list, copy its output into the log
function Invoke-GitLogged([string]$label, [string[]]$gitArgs) {
  & git @gitArgs 2>&1 | ForEach-Object { Write-Log "  ${label}: $_" }
  $ok = ($LASTEXITCODE -eq 0)
  if (-not $ok -and $gitArgs[0] -eq 'push') { $script:pushFailed = $true }
  return $ok
}
function Test-Ancestor([string]$older, [string]$newer) {
  & git merge-base --is-ancestor $older $newer 2>$null
  return ($LASTEXITCODE -eq 0)
}

# ── 0. Stay out of the way of anything else using git ───────────────────────
$lock = Join-Path $repo '.git\index.lock'
if (Test-Path $lock) {
  $age = (Get-Date) - (Get-Item $lock).LastWriteTime
  if ($age.TotalMinutes -lt 60) { Write-Log 'skipped: git is busy (index.lock)'; Set-SyncStatus 'busy'; exit 0 }
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
  Write-Log 'removed a stale .git\index.lock (over an hour old)'
}
foreach ($marker in @('rebase-merge', 'rebase-apply', 'MERGE_HEAD')) {
  if (Test-Path (Join-Path $repo ".git\$marker")) { Write-Log "skipped: a git $marker is in progress"; Set-SyncStatus "busy-$marker"; exit 0 }
}

# ── 1. Get the latest from the private repo ─────────────────────────────────
& git fetch v2 --prune --quiet 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Log 'fetch from the private repo failed (offline, or GitHub needs you to sign in again)'
  Set-SyncStatus 'fetch-failed'
  exit 0
}
$current = Get-Git rev-parse --abbrev-ref HEAD

# ── 2. Side branches: publish new ones, follow the cloud, push local edits ──
# Branches published once are remembered, so one deleted on GitHub isn't re-created
$published = Join-Path $repo '.git\worldpulse-published-branches'
$known = @()
if (Test-Path $published) { $known = @(Get-Content $published) }
$branches = @('autopilot-state') + @(& git for-each-ref --format='%(refname:short)' 'refs/heads/wip/' 2>$null)
foreach ($b in $branches) {
  if (-not $b -or $b -eq $current) { continue }
  $l = Get-Git rev-parse --verify --quiet "refs/heads/$b"
  if (-not $l) { continue }
  $r = Get-Git rev-parse --verify --quiet "refs/remotes/v2/$b"
  if (-not $r) {
    if ($known -contains $b) { continue }    # deleted on GitHub on purpose
    Write-Log "publishing branch $b to the private repo"
    if (Invoke-GitLogged 'v2' @('push', 'v2', "refs/heads/${b}:refs/heads/$b")) { Add-Content -Path $published -Value $b }
    continue
  }
  if ($known -notcontains $b) { Add-Content -Path $published -Value $b; $known += $b }
  if ($l -eq $r) {
    continue
  } elseif (Test-Ancestor $l $r) {
    & git update-ref "refs/heads/$b" $r $l 2>$null      # catch up with the cloud
  } elseif (Test-Ancestor $r $l) {
    Write-Log "pushing local changes on $b"
    $null = Invoke-GitLogged 'v2' @('push', 'v2', "refs/heads/${b}:refs/heads/$b")
  } else {
    # Changed here and on GitHub at the same time: keep the local commits on a
    # side branch (nothing is lost) and follow GitHub again
    $aside = "$b-unsynced-$(Get-Date -Format 'yyyyMMdd-HHmm')"
    & git branch $aside $l 2>$null
    & git update-ref "refs/heads/$b" $r $l 2>$null
    Write-Log "branch $b changed both here and on GitHub; local commits kept on '$aside', now following GitHub"
  }
}

# ── 3. main: follow the cloud, then push local commits ──────────────────────
if ($current -ne 'main') { Write-Log "main not synced: this copy is on branch '$current'"; Set-SyncStatus "not-on-main $current"; exit 0 }
if (-not (Get-Git rev-parse --verify --quiet refs/remotes/v2/main)) { Set-SyncStatus 'ok'; exit 0 }

$behind = [int](Get-Git rev-list --count main..v2/main)
$ahead  = [int](Get-Git rev-list --count v2/main..main)
if ($behind -gt 0 -and $ahead -eq 0) {
  if (Invoke-GitLogged 'update' @('merge', '--ff-only', '--quiet', 'v2/main')) {
    Write-Log "updated main with $behind new commit(s) from GitHub"
  } else {
    Write-Log 'could not update main: unsaved edits are in the way; will retry'
  }
} elseif ($behind -gt 0 -and $ahead -gt 0) {
  $dirty = Get-Git status --porcelain --untracked-files=no
  if ($dirty) {
    Write-Log 'main has new commits here and on GitHub, but unsaved edits are in the way; will retry'
  } elseif (Invoke-GitLogged 'rebase' @('rebase', '--quiet', 'v2/main')) {
    Write-Log "put $ahead local commit(s) on top of $behind new commit(s) from GitHub"
  } else {
    & git rebase --abort 2>$null
    Write-Log 'local commits clash with commits on GitHub; left as is (needs a look)'
  }
}

$ahead = [int](Get-Git rev-list --count v2/main..main)
if ($ahead -gt 0 -and (Test-Ancestor 'v2/main' 'main')) {
  Write-Log "pushing $ahead new commit(s)"
  $null = Invoke-GitLogged 'v2' @('push', 'v2', 'main')
}

# ── 4. Public mirror follows the private repo's main (fast-forward only) ────
& git fetch origin main --quiet 2>$null
$pv = Get-Git rev-parse --verify --quiet refs/remotes/v2/main
$po = Get-Git rev-parse --verify --quiet refs/remotes/origin/main
if ($pv -and $po -and $pv -ne $po) {
  if (Test-Ancestor $po $pv) {
    $null = Invoke-GitLogged 'origin' @('push', 'origin', 'refs/remotes/v2/main:refs/heads/main')
  } else {
    Write-Log 'public mirror has commits the private repo lacks; not updating it (needs a look)'
  }
}

if ($script:pushFailed) { Set-SyncStatus 'push-failed' } else { Set-SyncStatus 'ok' }
