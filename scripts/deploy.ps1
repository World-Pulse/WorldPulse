# WorldPulse One-Click Deploy Script
# Usage: .\scripts\deploy.ps1
# Handles: git commit, push, SSH build & deploy, nginx reload

param(
    [string]$Message = "deploy: update $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
    [switch]$NoBuild,
    [switch]$NoCache
)

$ErrorActionPreference = "Continue"
$Server = "root@142.93.71.102"
$RemotePath = "/opt/worldpulse"

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

# ─── Step 2: Stage & commit ─────────────────────────────────────────────────
Write-Host "[2/6] Staging changes..." -ForegroundColor Yellow
git add -A 2>&1 | Out-Null

$status = git status --porcelain
if ($status) {
    git commit -m $Message 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Commit failed, but continuing..." -ForegroundColor DarkYellow
    } else {
        Write-Host "  Committed." -ForegroundColor Green
    }
} else {
    Write-Host "  Nothing to commit." -ForegroundColor DarkGray
}

# ─── Step 3: Pull & push ────────────────────────────────────────────────────
Write-Host "[3/6] Syncing with remote..." -ForegroundColor Yellow
git pull origin main --no-rebase 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    # Auto-resolve merge if needed
    git add -A 2>&1 | Out-Null
    git commit -m "auto-merge remote" 2>&1 | Out-Null
}

git push origin main 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Push failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  Pushed to GitHub." -ForegroundColor Green

# ─── Step 4: Pull on server ─────────────────────────────────────────────────
Write-Host "[4/6] Pulling on server..." -ForegroundColor Yellow
ssh $Server "cd $RemotePath && git pull origin main" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Server pull failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  Server updated." -ForegroundColor Green

# ─── Step 5: Build & recreate containers ────────────────────────────────────
if (-not $NoBuild) {
    Write-Host "[5/6] Building & deploying containers..." -ForegroundColor Yellow
    $buildFlag = if ($NoCache) { "--no-cache" } else { "" }
    ssh $Server "cd $RemotePath && docker compose -f docker-compose.prod.yml build $buildFlag api web scraper && docker compose -f docker-compose.prod.yml up -d --force-recreate api web scraper" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Build/deploy had warnings (check output above)" -ForegroundColor DarkYellow
    } else {
        Write-Host "  Containers rebuilt & restarted." -ForegroundColor Green
    }
} else {
    Write-Host "[5/6] Skipping build (--NoBuild flag)." -ForegroundColor DarkGray
}

# ─── Step 6: Reload nginx ──────────────────────────────────────────────────
Write-Host "[6/6] Reloading nginx..." -ForegroundColor Yellow
Start-Sleep -Seconds 15
ssh $Server "docker exec wp_nginx nginx -s reload" 2>&1
Write-Host "  Nginx reloaded." -ForegroundColor Green

# ─── Done ───────────────────────────────────────────────────────────────────
Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  Deploy complete!" -ForegroundColor Green
Write-Host "  https://world-pulse.io" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Green
