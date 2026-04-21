# deploy-bg.ps1 — background deploy that survives SSH disconnect
#
# PROBLEM: The standard deploy-fast.ps1 runs `docker compose ... up -d --build`
# foreground inside an SSH session. If the session drops (which happens when
# the server is resource-starved during heavy builds), the build dies.
#
# SOLUTION: This script detaches the build from the SSH session using
# `nohup setsid` and redirects output to a log file on the server.
# SSH can disconnect freely; the build keeps running.
#
# Usage:
#   .\scripts\deploy-bg.ps1                   # sync + background rebuild all
#   .\scripts\deploy-bg.ps1 -Service api      # sync + background rebuild api
#   .\scripts\deploy-bg.ps1 -Service web      # sync + background rebuild web
#   .\scripts\deploy-bg.ps1 -Tail             # just tail the current build log
#   .\scripts\deploy-bg.ps1 -Status           # check last build status
#
# After kick-off, tail progress from another terminal with:
#   ssh root@142.93.71.102 "tail -f /var/log/worldpulse-deploy.log"

param(
    [string]$Service = "",
    [switch]$NoSync,
    [switch]$Tail,
    [switch]$Status
)

$ErrorActionPreference = "Stop"
$Server = "root@142.93.71.102"
$RemotePath = "/opt/worldpulse"
$LocalPath = (Get-Location).Path
$LogFile = "/var/log/worldpulse-deploy.log"

# SSH options that aggressively keep the connection alive
$SshOpts = @(
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=10",
    "-o", "TCPKeepAlive=yes"
)

# --- Status / tail shortcuts ---
if ($Status) {
    Write-Host "==> Build status" -ForegroundColor Cyan
    $statusCmd = "tail -30 $LogFile 2>/dev/null; echo '---'; echo 'Running builds:'; ps aux | grep -E 'docker compose|pnpm build|next build' | grep -v grep; echo '---'; echo 'Containers:'; cd $RemotePath; docker compose -f docker-compose.prod.yml ps"
    & ssh @SshOpts $Server $statusCmd
    exit $LASTEXITCODE
}

if ($Tail) {
    Write-Host "==> Tailing $LogFile (Ctrl+C to exit)" -ForegroundColor Cyan
    & ssh @SshOpts $Server "tail -f $LogFile"
    exit $LASTEXITCODE
}

Write-Host "==> Background deploy starting" -ForegroundColor Cyan
Write-Host "    From: $LocalPath"
Write-Host "    To:   $Server`:$RemotePath"
Write-Host ""

# --- 1. Sync source (unless -NoSync) ---
if (-not $NoSync) {
    $tarCmd = Get-Command tar -ErrorAction SilentlyContinue
    if (-not $tarCmd) {
        Write-Host "ERROR: tar not found in PATH." -ForegroundColor Red
        exit 1
    }

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
        "--exclude=./.env.development",
        "--exclude=./.env.prod",
        "--exclude=./.env.production",
        "--exclude=./.env.staging"
    )

    & tar -czf $tarFile $excludes -C $LocalPath .
    if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: tar failed" -ForegroundColor Red; exit 1 }

    $size = [math]::Round((Get-Item $tarFile).Length / 1MB, 2)
    Write-Host "    Tarball: $size MB"
    Write-Host "    Uploading..."

    & scp @SshOpts $tarFile "$Server`:/tmp/worldpulse-deploy.tar.gz"
    if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: scp failed" -ForegroundColor Red; exit 1 }

    Write-Host "    Extracting..."
    $extractCmd = "cd $RemotePath && tar -xzf /tmp/worldpulse-deploy.tar.gz 2>/dev/null && rm /tmp/worldpulse-deploy.tar.gz"
    & ssh @SshOpts $Server $extractCmd
    if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: extract failed" -ForegroundColor Red; exit 1 }

    Remove-Item $tarFile -Force
    Write-Host "==> Sync complete" -ForegroundColor Green
    Write-Host ""
}

# --- 2. Build up remote bash script as a single-quoted here-string ---
# Using single quotes (@'...'@) prevents PowerShell from interpolating $(...)
# or $var inside the script. All bash dollar signs stay literal.

$bashScript = @'
set -e
cd __REMOTE_PATH__

# Kill any previous stuck build
if [ -f /var/run/worldpulse-build.pid ]; then
    OLD_PID=$(cat /var/run/worldpulse-build.pid 2>/dev/null)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo "[deploy-bg] Killing previous build PID $OLD_PID"
        kill -TERM "$OLD_PID" 2>/dev/null || true
        sleep 2
        kill -KILL "$OLD_PID" 2>/dev/null || true
    fi
fi

echo "=========================================="
echo "[deploy-bg] Start __TIMESTAMP__"
echo "[deploy-bg] Service: __SERVICE_LABEL__"
echo "[deploy-bg] Command: __BUILD_CMD__"
echo "=========================================="
echo "[deploy-bg] Memory:"
free -h
echo "[deploy-bg] Load:"
uptime
echo "[deploy-bg] Disk:"
df -h /opt /var/lib/docker 2>/dev/null | head -5
echo "=========================================="

# Launch build detached. setsid makes it session leader, nohup ignores HUP,
# & puts it in background, output appended to log file.
setsid nohup bash -c "__BUILD_CMD__" >> __LOG_FILE__ 2>&1 &
BUILD_PID=$!
echo $BUILD_PID > /var/run/worldpulse-build.pid
disown 2>/dev/null || true

echo "[deploy-bg] Build launched in background. PID=$BUILD_PID"
echo "[deploy-bg] Log: __LOG_FILE__"
'@

# Compose the docker-compose build command
if ($Service) {
    $buildCmd = "docker compose -f docker-compose.prod.yml up -d --build $Service"
    $serviceLabel = $Service
} else {
    $buildCmd = "docker compose -f docker-compose.prod.yml up -d --build"
    $serviceLabel = "ALL"
}

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# Substitute placeholders in the bash script
$remoteScript = $bashScript `
    -replace '__REMOTE_PATH__', $RemotePath `
    -replace '__TIMESTAMP__', $timestamp `
    -replace '__SERVICE_LABEL__', $serviceLabel `
    -replace '__BUILD_CMD__', $buildCmd `
    -replace '__LOG_FILE__', $LogFile

Write-Host "==> Launching background build on server..." -ForegroundColor Cyan
Write-Host "    Service: $serviceLabel"
Write-Host "    Log: $LogFile"
Write-Host ""

# Touch log then send script over stdin via ssh bash -s
$prep = "touch $LogFile"
& ssh @SshOpts $Server $prep | Out-Null

$remoteScript | & ssh @SshOpts $Server "bash -s"
$rc = $LASTEXITCODE

if ($rc -ne 0) {
    Write-Host "ERROR: failed to launch background build (exit $rc)" -ForegroundColor Red
    exit $rc
}

Write-Host ""
Write-Host "==> Build launched. SSH can now disconnect safely." -ForegroundColor Green
Write-Host ""
Write-Host "Monitor build progress:" -ForegroundColor Yellow
Write-Host "  .\scripts\deploy-bg.ps1 -Tail          # tail log live"
Write-Host "  .\scripts\deploy-bg.ps1 -Status        # quick status snapshot"
Write-Host "  ssh $Server 'tail -f $LogFile'"
Write-Host ""
Write-Host "Check when done:" -ForegroundColor Yellow
Write-Host "  curl https://api.world-pulse.io/api/v1/public/signals"
Write-Host "  curl https://world-pulse.io/map"
