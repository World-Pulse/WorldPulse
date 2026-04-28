# deploy-fast.ps1 — tar-over-ssh fast deploy (no git push required)
#
# Usage:
#   .\scripts\deploy-fast.ps1                  # sync + rebuild all services
#   .\scripts\deploy-fast.ps1 -Service web     # rebuild only web
#   .\scripts\deploy-fast.ps1 -NoBuild         # sync only, no rebuild
#   .\scripts\deploy-fast.ps1 -Restart         # sync + restart without rebuild
#
# Requires: tar + ssh (both built into Windows 10/11; tar also in MSYS2)
# Server:   root@142.93.71.102:/opt/worldpulse

param(
    [string]$Service = "",
    [switch]$NoBuild,
    [switch]$Restart
)

$ErrorActionPreference = "Stop"
$Server = "root@142.93.71.102"
$RemotePath = "/opt/worldpulse"
$LocalPath = (Get-Location).Path

Write-Host "==> Fast deploy starting" -ForegroundColor Cyan
Write-Host "    From: $LocalPath"
Write-Host "    To:   $Server`:$RemotePath"
Write-Host ""

# 1. Verify tar exists
$tarCmd = Get-Command tar -ErrorAction SilentlyContinue
if (-not $tarCmd) {
    Write-Host "ERROR: tar not found in PATH." -ForegroundColor Red
    Write-Host "Install Windows 10/11 built-in tar or use MSYS2 tar." -ForegroundColor Yellow
    exit 1
}

# 2. Pack source into a tarball, stream it over ssh, extract on server.
#    The --exclude flags prune everything we don't need across the wire.
Write-Host "==> Packing + streaming source to server..." -ForegroundColor Cyan
$tarFile = Join-Path $env:TEMP "worldpulse-deploy.tar.gz"
if (Test-Path $tarFile) { Remove-Item $tarFile -Force }

$excludes = @(
    "--exclude=./node_modules",
    "--exclude=./.git",
    "--exclude=./.next",
    "--exclude=./apps/*/node_modules",
    "--exclude=./apps/*/.next",
    "--exclude=./apps/*/dist",
    "--exclude=./apps/*/build",
    "--exclude=./packages/*/node_modules",
    "--exclude=./packages/*/dist",
    "--exclude=./.turbo",
    "--exclude=./coverage",
    "--exclude=*.log",
    "--exclude=./.env.local",
    "--exclude=./.env.development"
)

& tar -czf $tarFile $excludes -C $LocalPath .
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: tar packing failed" -ForegroundColor Red
    exit 1
}
$size = [math]::Round((Get-Item $tarFile).Length / 1MB, 2)
Write-Host "    Tarball: $size MB"

# Upload tarball via scp, then extract on the server
Write-Host "    Uploading tarball..."
& scp $tarFile "$Server`:/tmp/worldpulse-deploy.tar.gz"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: scp upload failed" -ForegroundColor Red
    Remove-Item $tarFile -Force -ErrorAction SilentlyContinue
    exit 1
}
Write-Host "    Extracting on server..."
& ssh $Server "cd $RemotePath && tar -xzf /tmp/worldpulse-deploy.tar.gz && rm /tmp/worldpulse-deploy.tar.gz"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: server-side extract failed" -ForegroundColor Red
    Remove-Item $tarFile -Force -ErrorAction SilentlyContinue
    exit 1
}
Remove-Item $tarFile -Force
Write-Host "==> Sync complete" -ForegroundColor Green
Write-Host ""

# 3. Rebuild on server
if ($NoBuild) {
    Write-Host "==> Skipping rebuild (-NoBuild)" -ForegroundColor Yellow
    exit 0
}

if ($Restart) {
    Write-Host "==> Restarting containers (no rebuild)..." -ForegroundColor Cyan
    & ssh $Server "cd $RemotePath && docker compose -f docker-compose.prod.yml restart $Service"
    exit $LASTEXITCODE
}

if ($Service) {
    Write-Host "==> Rebuilding service: $Service" -ForegroundColor Cyan
    & ssh $Server "cd $RemotePath && docker compose -f docker-compose.prod.yml up -d --build $Service"
} else {
    Write-Host "==> Rebuilding all services (rolling)..." -ForegroundColor Cyan
    & ssh $Server "cd $RemotePath && docker compose -f docker-compose.prod.yml up -d --build"
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "==> Deploy complete." -ForegroundColor Green
    Write-Host "    Site:  https://world-pulse.io" -ForegroundColor Green
} else {
    Write-Host "ERROR: build/restart failed" -ForegroundColor Red
    exit $LASTEXITCODE
}
