# add-swap.ps1 — add 4GB swap file to the production server
#
# PROBLEM: Server has 3.8GB RAM and ZERO swap. When web build peaks memory,
# Linux OOM-kills random processes including the build itself. This is why
# builds have been dying silently.
#
# SOLUTION: Add a 4GB swap file. Disk has 38GB free so this is safe.
#
# Run once before attempting the web build.

$ErrorActionPreference = "Stop"
$Server = "root@142.93.71.102"
$SshOpts = @("-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=10")

$bashScript = @'
set -e
echo "==> Current memory state"
free -h
echo ""

if [ -f /swapfile ]; then
    echo "==> /swapfile already exists, checking if active..."
    if swapon --show | grep -q /swapfile; then
        echo "[add-swap] Swap already active. Nothing to do."
        swapon --show
        free -h
        exit 0
    fi
    echo "[add-swap] Swap file exists but not active, activating..."
else
    echo "==> Creating 4GB swap file at /swapfile..."
    fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096 status=progress
    chmod 600 /swapfile
    mkswap /swapfile
fi

echo "==> Activating swap..."
swapon /swapfile

# Make persistent across reboots
if ! grep -q "/swapfile" /etc/fstab; then
    echo "/swapfile none swap sw 0 0" >> /etc/fstab
    echo "[add-swap] Added to /etc/fstab"
fi

# Tune swappiness for workstation-ish pattern (less aggressive swap)
echo 10 > /proc/sys/vm/swappiness || true
if ! grep -q "vm.swappiness" /etc/sysctl.conf; then
    echo "vm.swappiness=10" >> /etc/sysctl.conf
fi

echo ""
echo "==> Done. New memory state:"
free -h
echo ""
swapon --show
'@

Write-Host "==> Adding 4GB swap to $Server" -ForegroundColor Cyan
Write-Host ""

$bashScript | & ssh @SshOpts $Server "bash -s"
$rc = $LASTEXITCODE

if ($rc -eq 0) {
    Write-Host ""
    Write-Host "==> Swap added successfully." -ForegroundColor Green
    Write-Host "    Web build should no longer OOM."
} else {
    Write-Host ""
    Write-Host "ERROR: swap add failed (exit $rc)" -ForegroundColor Red
    exit $rc
}
