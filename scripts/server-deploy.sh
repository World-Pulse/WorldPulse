#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  WorldPulse — server-side deploy (runs ON the production server)
#
#  Runs automatically after every push to main (.github/workflows/deploy.yml).
#  To run by hand on the server:
#      cd /opt/worldpulse && git pull && bash scripts/server-deploy.sh
#
#  Steps:
#    1. Make sure there's enough disk space (clears Docker leftovers if not)
#    2. Keep the running images as :previous so we can roll back
#    3. Build new images one at a time (the server is small)
#    4. Swap in api → wait until healthy → swap in scraper + web
#    5. Test the nginx config, apply nginx/certbot changes, reload nginx
#    6. Anything unhealthy → automatic rollback to the previous images
#    7. Check the public site + certificates, clean up old images
#
#  Result is written to logs/deploy.status:
#    running | success | success_with_warnings | rolled_back | failed
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

cd "$(dirname "$0")/.."
mkdir -p logs

# One deploy at a time
exec 9>/var/lock/worldpulse-deploy.lock
flock -n 9 || { echo "Another deploy is already running — exiting."; exit 1; }

STATUS_FILE="logs/deploy.status"
SHA="${1:-$(git rev-parse --short=7 HEAD 2>/dev/null || echo unknown)}"
WARNINGS=""

COMPOSE="docker compose -f docker-compose.prod.yml"
if [ ! -f .env ] && [ -f .env.prod ]; then
  COMPOSE="$COMPOSE --env-file .env.prod"
fi

log()    { echo "[deploy $(date '+%H:%M:%S')] $*"; }
finish() {  # finish <status> <message>
  echo "$1" > "$STATUS_FILE"
  log "$2"
  bash scripts/ops-status.sh >/dev/null 2>&1 || true
  echo "DEPLOY_RESULT=$1"
  [ "$1" = "success" ] && exit 0 || exit 1
}
free_gb() { df -BG --output=avail / | tail -1 | tr -dc '0-9'; }

echo running > "$STATUS_FILE"
bash scripts/ops-status.sh > /dev/null 2>&1 || true   # show "running" on /ops-status.json right away
log "Deploying ${SHA}"

# ── 1. Disk space guard ──────────────────────────────────────────────────────
if [ "$(free_gb)" -lt 10 ]; then
  log "Low disk ($(free_gb)G free) — emptying oversized logs, clearing Docker leftovers"
  find /var/lib/docker/containers -name '*-json.log' -size +500M -exec truncate -s 0 {} \; 2>/dev/null || true
  docker rm -f wp_clickhouse >/dev/null 2>&1 || true   # unused leftover from early development
  journalctl --vacuum-size=200M >/dev/null 2>&1 || true
  docker builder prune -af --filter until=24h >/dev/null 2>&1 || true
  docker image prune -af --filter until=72h >/dev/null 2>&1 || true
fi
[ "$(free_gb)" -ge 5 ] || finish failed "Only $(free_gb)G of disk free — not enough to build safely. Nothing was changed."

# ── 2. Keep current images for rollback ─────────────────────────────────────
for svc in api web scraper; do
  if docker image inspect "worldpulse-${svc}:latest" >/dev/null 2>&1; then
    docker tag "worldpulse-${svc}:latest" "worldpulse-${svc}:previous"
  fi
done

restore_tags() {
  local s
  for s in api web scraper; do
    if docker image inspect "worldpulse-${s}:previous" >/dev/null 2>&1; then
      docker tag "worldpulse-${s}:previous" "worldpulse-${s}:latest"
    fi
  done
}

# ── 3. Build, one service at a time (parallel builds starve this server) ────
for svc in api scraper web; do
  log "Building ${svc}..."
  if ! $COMPOSE build --build-arg BUILD_TIME="$(date +%s)" --build-arg GIT_SHA="$SHA" "$svc"; then
    restore_tags
    finish failed "Build of ${svc} failed — the live site was not touched."
  fi
done

# ── 4. Swap in new containers ───────────────────────────────────────────────
wait_healthy() {  # wait_healthy <container> <timeout_seconds>
  local c="$1" timeout="$2" waited=0 state="unknown"
  while [ "$waited" -lt "$timeout" ]; do
    state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c" 2>/dev/null || echo missing)
    [ "$state" = "healthy" ] && { log "${c} is healthy"; return 0; }
    sleep 5
    waited=$((waited + 5))
  done
  log "${c} not healthy after ${timeout}s (state: ${state}). Last log lines:"
  docker logs "$c" --tail 30 2>&1 | sed 's/^/    /'
  return 1
}

rollback() {
  log "Rolling back to the previous images..."
  restore_tags
  $COMPOSE up -d --no-deps --force-recreate api scraper web
  wait_healthy wp_api 180 || true
  docker exec wp_nginx nginx -s reload >/dev/null 2>&1 || true
  finish rolled_back "$1 — rolled back to the previous version."
}

# nginx caches container IPs, so reload it after each swap (avoids 502s)
reload_nginx() { docker exec wp_nginx nginx -s reload >/dev/null 2>&1 || true; }

# Make sure the supporting services exist and run (recreates any that went missing)
$COMPOSE up -d --no-recreate postgres redis meilisearch zookeeper kafka

$COMPOSE up -d --no-deps --force-recreate api
wait_healthy wp_api 180 || rollback "API failed its health check"
reload_nginx

$COMPOSE up -d --no-deps --force-recreate scraper web
wait_healthy wp_web 240 || rollback "Web app failed its health check"
reload_nginx

scraper_state=$(docker inspect -f '{{.State.Status}}' wp_scraper 2>/dev/null || echo missing)
[ "$scraper_state" = "running" ] || rollback "Scraper is ${scraper_state}"

# ── 5. nginx + certbot: test config first, then apply and reload ────────────
NET=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' wp_api 2>/dev/null)
if docker run --rm --network "$NET" \
     -v "$PWD/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
     -v "$PWD/nginx/conf.d:/etc/nginx/conf.d:ro" \
     -v "$PWD/.certbot/conf:/etc/letsencrypt:ro" \
     nginx:1.27-alpine nginx -t >/dev/null 2>&1; then
  $COMPOSE up -d --no-deps nginx certbot
  sleep 3
  docker exec wp_nginx nginx -s reload >/dev/null 2>&1 || true
  log "nginx config OK and reloaded"
else
  WARNINGS="$WARNINGS; nginx config test failed, so the old nginx was kept running"
  log "WARNING: nginx config test failed — kept the old nginx running"
fi

# ── 6. Public checks through nginx, with real certificate validation ────────
check() {  # check <host> <path>
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
    --resolve "$1:443:127.0.0.1" "https://$1$2" || true)
  if [ "$code" = "200" ]; then
    log "OK   https://$1$2"
  else
    log "BAD  https://$1$2 → ${code:-no response}"
    WARNINGS="$WARNINGS; https://$1$2 returned ${code:-no response}"
  fi
}
check world-pulse.io /
check api.world-pulse.io /health

for domain in world-pulse.io world-pulse.app; do
  end=$(openssl x509 -enddate -noout -in ".certbot/conf/live/${domain}/fullchain.pem" 2>/dev/null | cut -d= -f2)
  if [ -z "$end" ]; then
    WARNINGS="$WARNINGS; no certificate found for ${domain}"
    continue
  fi
  days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
  log "Certificate ${domain}: ${days} days left"
  [ "$days" -ge 14 ] || WARNINGS="$WARNINGS; certificate for ${domain} expires in ${days} days"
done

# ── 7. Clean up so the disk doesn't fill up again ───────────────────────────
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -f --filter until=72h >/dev/null 2>&1 || true
log "Disk free after deploy: $(free_gb)G"

if [ -n "$WARNINGS" ]; then
  finish success_with_warnings "Deployed ${SHA}, but:${WARNINGS#;}"
fi
finish success "Deployed ${SHA} — all checks passed."
