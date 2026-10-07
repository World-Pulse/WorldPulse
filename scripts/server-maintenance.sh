#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  WorldPulse — daily self-maintenance (runs ON the server)
#  Triggered every day by .github/workflows/maintenance.yml. Safe to rerun.
#    1. Keeps the disk from filling: empties oversized logs, clears leftovers
#    2. Renews the certificate if due and reloads nginx
#    3. Restarts any service that's missing or stopped
#    4. Publishes the status file the autopilot reads
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs
exec 9>/var/lock/worldpulse-deploy.lock
flock -w 1800 9 || { echo "A deploy has been running for 30 minutes — skipping maintenance this time."; exit 0; }

COMPOSE="docker compose -f docker-compose.prod.yml"
if [ ! -f .env ] && [ -f .env.prod ]; then COMPOSE="$COMPOSE --env-file .env.prod"; fi
log() { echo "[maintenance $(date '+%H:%M:%S')] $*"; }
free_gb() { df -BG --output=avail / | tail -1 | tr -dc '0-9'; }

# Keep /ops-status.json fresh: rewrite it every 5 minutes (idempotent)
OPS_CRON=/etc/cron.d/worldpulse-ops-status
OPS_LINE="*/5 * * * * root cd $(pwd) && bash scripts/ops-status.sh > /dev/null 2>&1"
if [ -d /etc/cron.d ] && [ "$(cat "$OPS_CRON" 2> /dev/null)" != "$OPS_LINE" ]; then
  printf '%s\n' "$OPS_LINE" > "$OPS_CRON" && chmod 644 "$OPS_CRON"
fi

log "Disk free before: $(free_gb)G"
find /var/lib/docker/containers -name '*-json.log' -size +500M -exec truncate -s 0 {} \; 2>/dev/null || true
docker rm -f wp_clickhouse >/dev/null 2>&1 || true
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -f --filter until=72h >/dev/null 2>&1 || true
journalctl --vacuum-size=200M >/dev/null 2>&1 || true
find logs -maxdepth 1 -name 'deploy_*.log' -mtime +30 -delete 2>/dev/null || true
log "Disk free after: $(free_gb)G"

docker exec wp_certbot certbot renew --quiet --webroot -w /var/www/certbot >/dev/null 2>&1 || log "certbot renew reported a problem"
docker exec wp_nginx nginx -s reload >/dev/null 2>&1 || true

# Start anything that should be running but isn't (builds a missing image if needed)
if [ "$(free_gb)" -ge 5 ]; then
  $COMPOSE up -d --no-recreate >/dev/null 2>&1 && log "All services up" || log "Some services failed to start"
else
  log "Skipped service check: only $(free_gb)G free"
fi

result=ok
[ "$(free_gb)" -ge 5 ] || result=low_disk
echo "$result $(date -Is)" > logs/maintenance.status
bash scripts/ops-status.sh || true
log "Done ($result)"
