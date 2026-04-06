# WorldPulse One-Click Deploy Script
# Usage: .\scripts\deploy.ps1
#   -Message "commit msg"   Custom commit message
#   -NoCache                Force full rebuild (slow but clean)
#   -SkipBuild              Just restart containers, no rebuild
#   -Only api|web|scraper   Deploy only one service

param(
    [string]$Message = "deploy: update $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
    [switch]$NoCache,
    [switch]$SkipBuild,
    [string]$Only
)

$ErrorActionPreference = "Continue"
$Server = "root@142.93.71.102"
$RemotePath = "/opt/worldpulse"
$SshKey = "$HOME\.ssh\worldpulse_deploy"

# Use SSH key if it exists, otherwise fall back to password auth
$SshArgs = @()
if (Test-Path $SshKey) {
    $SshArgs = @("-i", $SshKey, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes")
    Write-Host "  Using SSH key: $SshKey" -ForegroundColor DarkGray
} else {
    Write-Host "  No SSH key found — using password auth" -ForegroundColor DarkYellow
    Write-Host "  Run: ssh-keygen -t ed25519 -f $SshKey" -ForegroundColor DarkYellow
}

function Remote($cmd) {
    $result = & ssh @SshArgs $Server $cmd 2>&1
    $result | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    return $LASTEXITCODE -eq 0
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  WorldPulse Deploy" -ForegroundColor Cyan
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor DarkCyan
Write-Host "========================================`n" -ForegroundColor Cyan

# ─── Step 1: Clean git lock files ───────────────────────────────────────────
Write-Host "[1/6] Cleaning git locks..." -ForegroundColor Yellow
Remove-Item ".git\refs\heads\main.lock" -ErrorAction SilentlyContinue
Remove-Item ".git\index.lock" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force ".git\rebase-merge" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force ".git\rebase-apply" -ErrorAction SilentlyContinue
Remove-Item ".git\MERGE_HEAD" -ErrorAction SilentlyContinue

# ─── Step 2: Stage & commit ─────────────────────────────────────────────────
Write-Host "[2/6] Staging changes..." -ForegroundColor Yellow
git add -A 2>&1 | Out-Null

$status = git status --porcelain 2>&1
if ($status) {
    git commit -m $Message 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Committed." -ForegroundColor Green
    } else {
        Write-Host "  Commit failed (may be nothing to commit)." -ForegroundColor DarkYellow
    }
} else {
    Write-Host "  Nothing to commit." -ForegroundColor DarkGray
}

# ─── Step 3: Pull & push (merge strategy to avoid rebase issues) ────────────
Write-Host "[3/6] Syncing with remote..." -ForegroundColor Yellow
$env:GIT_EDITOR = "true"  # Prevent vim from opening on merge

git pull origin main --no-rebase --no-edit 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    git add -A 2>&1 | Out-Null
    git commit -m "auto-merge remote" --no-edit 2>&1 | Out-Null
}

git push origin main 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Push failed! Check git status." -ForegroundColor Red
    exit 1
}
Write-Host "  Pushed to GitHub." -ForegroundColor Green

# ─── Step 4: Pull on server ─────────────────────────────────────────────────
Write-Host "[4/6] Pulling on server..." -ForegroundColor Yellow
$pulled = Remote "cd $RemotePath && git fetch origin main && git reset --hard origin/main"
if ($pulled) {
    Write-Host "  Server updated." -ForegroundColor Green
} else {
    Write-Host "  Server pull may have failed — check output." -ForegroundColor DarkYellow
}

# ─── Step 5: Build & recreate containers ────────────────────────────────────
$services = if ($Only) { $Only } else { "api web scraper" }

if (-not $SkipBuild) {
    Write-Host "[5/6] Building $services..." -ForegroundColor Yellow
    $buildFlag = if ($NoCache) { "--no-cache" } else { "" }
    Remote "cd $RemotePath && docker compose -f docker-compose.prod.yml build $buildFlag $services"

    # Rolling restart: one at a time to reduce downtime
    Write-Host "  Restarting services..." -ForegroundColor Yellow
    foreach ($svc in $services.Split(" ")) {
        Remote "cd $RemotePath && docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate $svc"
        Start-Sleep -Seconds 8
    }
    Write-Host "  Containers rebuilt & restarted." -ForegroundColor Green
} else {
    Write-Host "[5/6] Skipping build (--SkipBuild)." -ForegroundColor DarkGray
    Remote "cd $RemotePath && docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate $services"
}

# ─── Step 6: Reload nginx ──────────────────────────────────────────────────
Write-Host "[6/6] Reloading nginx..." -ForegroundColor Yellow
Start-Sleep -Seconds 10
Remote "docker exec wp_nginx nginx -s reload"
Write-Host "  Nginx reloaded." -ForegroundColor Green

# ─── Health check ──────────────────────────────────────────────────────────
Write-Host "`nRunning health check..." -ForegroundColor Yellow
Remote "curl -s -o /dev/null -w 'HTTP %{http_code}' https://world-pulse.io/"

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  Deploy complete!" -ForegroundColor Green
Write-Host "  https://world-pulse.io" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Green
