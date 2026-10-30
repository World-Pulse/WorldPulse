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
#    5. Test the nginx config, apply nginx/certbot changes, reload nginx, and
#       clear the pages nginx kept from the old build
#    6. Anything unhealthy → automatic rollback to the previous images
#    7. Check the public site + certificates, clean up old images
#    8. Start the daily map video's recorder when it isn't running (background)
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
# Keep /ops-status.json fresh: rewrite it every 5 minutes (idempotent)
OPS_CRON=/etc/cron.d/worldpulse-ops-status
OPS_LINE="*/5 * * * * root cd $(pwd) && bash scripts/ops-status.sh > /dev/null 2>&1"
if [ -d /etc/cron.d ] && [ "$(cat "$OPS_CRON" 2> /dev/null)" != "$OPS_LINE" ]; then
  printf '%s\n' "$OPS_LINE" > "$OPS_CRON" && chmod 644 "$OPS_CRON"
fi
# The database's nightly copy, checked (scripts/db-backup.sh; plan LR8, Oct 23, 2026): 09:10 UTC, 5:10 AM New York in summer time
DB_CRON=/etc/cron.d/worldpulse-db-backup
DB_LINE="10 9 * * * root cd $(pwd) && bash scripts/db-backup.sh > logs/db-backup.log 2>&1"
if [ -d /etc/cron.d ] && [ "$(cat "$DB_CRON" 2> /dev/null)" != "$DB_LINE" ]; then
  printf '%s\n' "$DB_LINE" > "$DB_CRON" && chmod 644 "$DB_CRON"
fi
log "Deploying ${SHA}"
# Which repository this copy follows (owner/name only; anything before an "@" is left out)
log "Code from $(git remote get-url origin 2>/dev/null | sed -E 's#^[a-z]+://([^@/]*@)?##; s#^git@##; s#[.]git$##; s#^[^/:]*[/:]##' | tr -cd 'A-Za-z0-9._/-' | cut -c1-80)"

# ── 0. The engine (the hosted build only) ───────────────────────────────────
# main is the open-source edition (mirrored publicly). The hosted build adds
# the engine's files from this repository's private branch "engine" before
# building; the next deploy's reset to main takes them away again. A copy
# without that branch (a self-hosted one) builds the open-source edition.
git ls-remote --exit-code --heads origin engine >/dev/null 2>&1; engine_rc=$?
if [ "$engine_rc" -eq 0 ]; then
  git fetch --quiet origin +refs/heads/engine:refs/remotes/origin/engine \
    || finish failed "Couldn't fetch the engine — the live site was not touched."
  git checkout refs/remotes/origin/engine -- . \
    || finish failed "Couldn't add the engine's files — the live site was not touched."
  log "Engine $(git rev-parse --short=7 refs/remotes/origin/engine) added"
elif [ "$engine_rc" -eq 2 ]; then
  log "No engine branch: building the open-source edition"
else
  finish failed "Couldn't reach the repository to fetch the engine — the live site was not touched."
fi

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
$COMPOSE up -d --no-recreate postgres redis zookeeper
# Kafka and Meilisearch are recreated when their blocks in docker-compose.prod.yml
# change (Oct 29, 2026: their memory caps, and Kafka's light health check; until
# then each kept whatever it was first made with). Their data is on volumes
# (kafka_data, meili_data); ZooKeeper, which holds Kafka's topics and cluster id,
# is never recreated here, nor the database or Redis. Unchanged, this leaves them
# running. The API and scraper are recreated just below, and nginx reloaded after.
$COMPOSE up -d --no-deps meilisearch kafka
wait_healthy wp_kafka 150 || log "Kafka isn't answering yet; the API and scraper keep retrying until it does"

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
  # nginx.conf is mounted as a single file, and a single-file mount keeps the
  # file the container was made with: git replaces the file on each update, so
  # a reload went on reading the old one (Oct 20, 2026: the /embed rule from
  # Oct 18 had never reached the live nginx). Recreate nginx when the file it
  # reads differs from the checkout's (it was tested just above).
  if ! docker exec wp_nginx cat /etc/nginx/nginx.conf 2>/dev/null | cmp -s - "$PWD/nginx/nginx.conf"; then
    $COMPOSE up -d --no-deps --force-recreate nginx
    log "nginx recreated: it was still reading an older nginx.conf"
  fi
  sleep 3
  docker exec wp_nginx nginx -s reload >/dev/null 2>&1 || true
  log "nginx config OK and reloaded"
else
  WARNINGS="$WARNINGS; nginx config test failed, so the old nginx was kept running"
  log "WARNING: nginx config test failed — kept the old nginx running"
fi

# ── 5b. Pages nginx kept were made by the old build ─────────────────────────
# They name the old build's scripts, which are gone, and nginx serves an expired
# page once more while it fetches a new one (page_cache: 60 s, stale while
# updating): the first visitor to each page after a deploy got a page that
# couldn't load its scripts (Oct 30, 2026: the daily video's recorder filmed
# bare text three times just after deploys, and a script it asked for answered
# 404). Clear them; the next visitor's page is made by the new build.
if timeout 20 docker exec wp_nginx sh -c 'find /var/cache/nginx/pages -type f -delete' 2>/dev/null; then
  log "Pages nginx kept from the old build cleared"
else
  log "Pages nginx kept could not be cleared"
fi

# ── 6. Public checks through nginx, with real certificate validation ────────
# Up to 5 tries, 3 s apart: a recreated nginx can take a few seconds to listen
# (Oct 20, 2026: the deploy that first recreated it reported "https://world-pulse.io/
# returned 000" while the site answered a minute later).
check() {  # check <host> <path>
  local code tries=0
  while :; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
      --resolve "$1:443:127.0.0.1" "https://$1$2" || true)
    tries=$((tries + 1))
    if [ "$code" = "200" ] || [ "$tries" -ge 5 ]; then break; fi
    sleep 3
  done
  if [ "$code" = "200" ]; then
    log "OK   https://$1$2"
  else
    log "BAD  https://$1$2 → ${code:-no response}"
    WARNINGS="$WARNINGS; https://$1$2 returned ${code:-no response}"
  fi
}
check world-pulse.io /
check api.world-pulse.io /health

# Warm what a first visitor opens (Oct 23, 2026, before the Monday launch): a
# new web process and API start cold, and right after the 9:47 AM deploy on
# Oct 23 a story page took 8 s and two of the home page's API answers failed
# (500) while their caches refilled. Ask once for the main pages, the day's
# top stories and the API answers the home page and map load, through nginx,
# which also keeps the pages (page_cache, nginx/conf.d/worldpulse.conf).
warm() { curl -s -o /dev/null --max-time 30 --resolve "$1:443:127.0.0.1" "https://$1$2" || true; }
for p in / /week /under-reported /map /how-we-count /developers; do warm world-pulse.io "$p"; done
for p in "/api/v1/feed/global?group=story" "/api/v1/stories?hours=12&limit=5" "/api/v1/stories?hours=24&limit=20" \
         "/api/v1/signals/count" "/api/v1/signals/headlines" "/api/v1/analytics/threat-index?window=6h" \
         "/api/v1/analytics/escalation-index" "/api/v1/analytics/markets" \
         "/api/v1/analytics/trending-entities?window=24h&limit=12&type=all" \
         "/api/v1/knowledge-graph/trending?limit=10&window_hours=24&lean=1" "/api/v1/digest/config" \
         "/api/v1/signals/map/hotspots?hours=24&min_categories=2&limit=25" "/api/v1/signals/map/points?hours=24&limit=3000&lean=1"; do
  warm api.world-pulse.io "$p"
done
top=$(curl -s --max-time 30 --resolve "api.world-pulse.io:443:127.0.0.1" "https://api.world-pulse.io/api/v1/stories?hours=24&limit=8" \
  | grep -o '"leadId":"[0-9a-f-]\{36\}"' | cut -d'"' -f4)
for id in $top; do warm world-pulse.io "/signals/$id"; done
log "Warmed the main pages, $(echo "$top" | grep -c .) top story pages and the home page's API answers"

# End the database queries the replaced containers left running (scripts/db-orphans.sh,
# Oct 26, 2026: a query keeps running after its container is gone, and that
# afternoon about 50 ran at once, the oldest for over 3 hours)
log "$(bash scripts/db-orphans.sh 2>&1 | tail -n 1)"

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
# Keep at most 8 GB of build cache, least recently used first. Keeping all of
# the last 72 hours filled the disk after ~80 deploys in a day (Oct 11-12).
# --max-used-space is Docker 28+, --keep-storage older; else the old rule.
docker builder prune -af --max-used-space 8gb >/dev/null 2>&1 \
  || docker builder prune -af --keep-storage 8gb >/dev/null 2>&1 \
  || docker builder prune -f --filter until=72h >/dev/null 2>&1 || true
log "Disk free after deploy: $(free_gb)G"

# ── 8. The daily map video's recorder (plan G9) ─────────────────────────────
# "The world in 60 seconds" (Devon, Oct 21, 2026: "Yes, once a night"; Oct 30:
# "automate everything you can"): the recorder (compose profile "recorder",
# infrastructure/recorder) starts itself instead of waiting for a command typed
# in the console. When it isn't running, it is built and started in the
# background, outside this deploy's lock, so the deploy doesn't wait for its
# first build (Playwright's image, about 5 minutes); later deploys find it
# running and leave it alone, unless its own files (record.mjs, the Dockerfile) changed since it was built:
# then it is built again and replaced (logs/recorder-source.sum). Not when the disk or memory is short.
rec_sum=$(cat infrastructure/recorder/Dockerfile infrastructure/recorder/record.mjs 2>/dev/null | sha256sum | cut -c1-16)
if ! timeout 10 docker ps --format '{{.Names}}' 2>/dev/null | grep -qx wp_recorder \
   || [ "$(cat logs/recorder-source.sum 2>/dev/null)" != "$rec_sum" ]; then
  avail_mb=$(awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo 2>/dev/null)
  if [ "$(free_gb)" -ge 15 ] && [ "${avail_mb:-0}" -ge 900 ]; then
    nohup setsid bash -c "$COMPOSE --profile recorder up -d --build recorder && echo $rec_sum > logs/recorder-source.sum" \
      > logs/recorder-start.log 2>&1 < /dev/null 9>&- &
    log "Building and starting the daily map video's recorder in the background (logs/recorder-start.log)"
  else
    log "The daily map video's recorder not started: $(free_gb)G of disk free, ${avail_mb:-?} MB of memory available"
  fi
fi

if [ -n "$WARNINGS" ]; then
  finish success_with_warnings "Deployed ${SHA}, but:${WARNINGS#;}"
fi
finish success "Deployed ${SHA} — all checks passed."
