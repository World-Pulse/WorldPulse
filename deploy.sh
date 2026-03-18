#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  WorldPulse — Production Deploy Script
#  Server: 142.93.71.102
#  Domains: world-pulse.io  |  world-pulse.app
#
#  FIRST DEPLOY — run once on the server:
#    git clone <repo> /opt/worldpulse && cd /opt/worldpulse
#    cp .env.prod.example .env.prod && nano .env.prod   # fill in secrets
#    ./deploy.sh
#
#  SUBSEQUENT DEPLOYS:
#    ./deploy.sh              # pull + rebuild + migrate + rolling restart
#    ./deploy.sh --no-build   # restart only (skip image rebuild)
#    ./deploy.sh --rollback   # roll back to previous images
#    ./deploy.sh --logs       # tail logs after deploy
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────────
log()   { echo -e "${CYAN}$(date '+%H:%M:%S')${NC}  $*"; }
ok()    { echo -e "${GREEN}$(date '+%H:%M:%S')  ✓${NC}  $*"; }
warn()  { echo -e "${YELLOW}$(date '+%H:%M:%S')  ⚠${NC}  $*"; }
fail()  { echo -e "${RED}$(date '+%H:%M:%S')  ✗${NC}  $*"; exit 1; }
header(){ echo -e "\n${BOLD}${CYAN}── $* ${NC}"; }

# ── Parse flags ───────────────────────────────────────────────────────────────
NO_BUILD=false
ROLLBACK=false
TAIL_LOGS=false

for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=true  ;;
    --rollback) ROLLBACK=true  ;;
    --logs)     TAIL_LOGS=true ;;
    -h|--help)
      sed -n '4,14p' "$0" | sed 's/#  //'
      exit 0
      ;;
  esac
done

# ── Paths & config ────────────────────────────────────────────────────────────
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p logs
LOGFILE="logs/deploy_${TIMESTAMP}.log"

# Tee all output to logfile
exec > >(tee -a "$LOGFILE") 2>&1

echo ""
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${CYAN}  WorldPulse Deploy  —  $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"

# ─────────────────────────────────────────────────────────────────────────────
#  STEP 0 — pre-flight
# ─────────────────────────────────────────────────────────────────────────────
header "Pre-flight checks"

# Docker
if ! command -v docker &>/dev/null; then
  warn "Docker not found. Installing (Ubuntu/Debian)..."
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg lsb-release
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
  ok "Docker installed."
fi

docker compose version &>/dev/null || fail "Docker Compose V2 not found. Ensure docker-compose-plugin is installed."
ok "Docker $(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1) + Compose V2"

# env file
[[ -f ".env.prod" ]] || fail ".env.prod not found.\n  cp .env.prod.example .env.prod\n  # then fill in all CHANGE_ME values"

# Check for unfilled placeholders
if grep -q "CHANGE_ME" .env.prod 2>/dev/null; then
  fail ".env.prod still contains CHANGE_ME placeholders. Fill them in before deploying."
fi

ok "Pre-flight checks passed."

# ─────────────────────────────────────────────────────────────────────────────
#  ROLLBACK
# ─────────────────────────────────────────────────────────────────────────────
if $ROLLBACK; then
  header "Rolling back"
  $COMPOSE down --timeout 30
  rolled=0
  for svc in api web scraper; do
    if docker image inspect "worldpulse-${svc}:previous" &>/dev/null; then
      docker tag "worldpulse-${svc}:previous" "worldpulse-${svc}:latest"
      ok "Restored worldpulse-${svc}:previous → latest"
      ((rolled++)) || true
    else
      warn "No previous image for worldpulse-${svc} — skipping."
    fi
  done
  [[ $rolled -eq 0 ]] && fail "No previous images found. Cannot roll back."
  $COMPOSE up -d
  ok "Rollback complete."
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
#  STEP 1 — pull latest code
# ─────────────────────────────────────────────────────────────────────────────
header "Pulling latest code"

if git rev-parse --git-dir &>/dev/null; then
  CURRENT=$(git rev-parse --short HEAD)
  git fetch origin --quiet
  REMOTE=$(git rev-parse --short origin/main 2>/dev/null || git rev-parse --short origin/master 2>/dev/null || echo "unknown")
  if [[ "$CURRENT" == "$REMOTE" ]]; then
    ok "Already up to date (${CURRENT})."
  else
    git pull --ff-only origin "$(git rev-parse --abbrev-ref HEAD)" \
      || fail "git pull failed. Resolve conflicts manually."
    NEW=$(git rev-parse --short HEAD)
    ok "Updated ${CURRENT} → ${NEW}"
  fi
else
  warn "Not a git repo — skipping pull."
fi

# ─────────────────────────────────────────────────────────────────────────────
#  STEP 2 — SSL certificates
# ─────────────────────────────────────────────────────────────────────────────
header "SSL certificates"

IO_CERT=".certbot/conf/live/world-pulse.io/fullchain.pem"
APP_CERT=".certbot/conf/live/world-pulse.app/fullchain.pem"

certs_valid() {
  for cert in "$IO_CERT" "$APP_CERT"; do
    [[ -f "$cert" ]] || return 1
    # Fail if expiring within 7 days
    expiry_epoch=$(openssl x509 -noout -enddate -in "$cert" 2>/dev/null \
      | cut -d= -f2 \
      | xargs -I{} date -d "{}" +%s 2>/dev/null || echo 0)
    now_epoch=$(date +%s)
    [[ $(( expiry_epoch - now_epoch )) -gt 604800 ]] || return 1
  done
  return 0
}

if certs_valid; then
  # Print expiry dates
  for domain in "world-pulse.io" "world-pulse.app"; do
    cert=".certbot/conf/live/${domain}/fullchain.pem"
    expiry=$(openssl x509 -noout -enddate -in "$cert" | cut -d= -f2)
    ok "${domain}  cert valid — expires ${expiry}"
  done
else
  # Need email for certbot
  CERTBOT_EMAIL=""
  # Try to get from .env.prod
  CERTBOT_EMAIL=$(grep -E '^CERTBOT_EMAIL=' .env.prod 2>/dev/null | cut -d= -f2 || true)
  if [[ -z "$CERTBOT_EMAIL" ]]; then
    CERTBOT_EMAIL=$(grep -E '^SMTP_USER=' .env.prod 2>/dev/null | cut -d= -f2 || true)
  fi
  if [[ -z "$CERTBOT_EMAIL" ]]; then
    read -rp "  Enter your email for Let's Encrypt certificates: " CERTBOT_EMAIL
  fi
  [[ -z "$CERTBOT_EMAIL" ]] && fail "Email required for SSL certificate issuance."

  log "Issuing SSL certificates for world-pulse.io and world-pulse.app..."
  chmod +x nginx/certbot.sh
  nginx/certbot.sh "$CERTBOT_EMAIL"
fi

# ─────────────────────────────────────────────────────────────────────────────
#  STEP 3 — tag current images for rollback
# ─────────────────────────────────────────────────────────────────────────────
header "Tagging current images for rollback"

for svc in api web scraper; do
  if docker image inspect "worldpulse-${svc}:latest" &>/dev/null; then
    docker tag "worldpulse-${svc}:latest" "worldpulse-${svc}:previous"
    log "  Tagged worldpulse-${svc}:latest → :previous"
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
#  STEP 4 — build images
# ─────────────────────────────────────────────────────────────────────────────
header "Building Docker images"

if $NO_BUILD; then
  warn "Skipping build (--no-build)."
else
  log "Building api, web, scraper..."
  $COMPOSE build \
    --build-arg BUILD_TIME="$TIMESTAMP" \
    --build-arg GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)" \
    api web scraper
  ok "Images built."
fi

# ─────────────────────────────────────────────────────────────────────────────
#  STEP 5 — start infrastructure services
# ─────────────────────────────────────────────────────────────────────────────
header "Starting infrastructure"

$COMPOSE up -d --no-recreate db redis meilisearch kafka zookeeper

log "Waiting for PostgreSQL..."
DB_USER=$(grep -E '^DB_USER=' .env.prod | cut -d= -f2)
DB_NAME=$(grep -E '^DB_NAME=' .env.prod | cut -d= -f2)

for i in $(seq 1 40); do
  if $COMPOSE exec -T db pg_isready -U "$DB_USER" -d "$DB_NAME" &>/dev/null; then
    ok "PostgreSQL ready."
    break
  fi
  [[ $i -eq 40 ]] && fail "PostgreSQL did not become healthy after 40s."
  sleep 1
done

log "Waiting for Redis..."
REDIS_PASSWORD=$(grep -E '^REDIS_PASSWORD=' .env.prod | cut -d= -f2)
for i in $(seq 1 20); do
  if $COMPOSE exec -T redis redis-cli -a "$REDIS_PASSWORD" ping 2>/dev/null | grep -q PONG; then
    ok "Redis ready."
    break
  fi
  [[ $i -eq 20 ]] && fail "Redis did not become healthy after 20s."
  sleep 1
done

# ─────────────────────────────────────────────────────────────────────────────
#  STEP 6 — database migrations
# ─────────────────────────────────────────────────────────────────────────────
header "Running migrations"

$COMPOSE run --rm \
  -e NODE_ENV=production \
  api \
  node dist/db/migrate.js \
  || fail "Migrations failed. Deploy aborted — previous containers still running."

ok "Migrations complete."

# ─────────────────────────────────────────────────────────────────────────────
#  STEP 7 — rolling restart of application services
# ─────────────────────────────────────────────────────────────────────────────
header "Deploying application"

$COMPOSE up -d --force-recreate api

log "Waiting for API to be healthy..."
for i in $(seq 1 30); do
  STATUS=$($COMPOSE ps --format json api 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Health','') if isinstance(d,dict) else d[0].get('Health',''))" \
    2>/dev/null || echo "")
  if [[ "$STATUS" == "healthy" ]]; then
    ok "API is healthy."
    break
  fi
  # Also accept a direct HTTP 200 from /health
  if curl -sf --max-time 3 http://localhost:3001/health &>/dev/null; then
    ok "API is responding."
    break
  fi
  [[ $i -eq 30 ]] && { warn "API did not report healthy — check: docker logs wp_api"; }
  sleep 2
done

$COMPOSE up -d --force-recreate scraper web
ok "Scraper and web deployed."

# ─────────────────────────────────────────────────────────────────────────────
#  STEP 8 — nginx + certbot + monitoring
# ─────────────────────────────────────────────────────────────────────────────
header "Starting nginx + monitoring"

$COMPOSE up -d --no-recreate certbot prometheus grafana

# Give nginx a fresh start (picks up any cert changes)
if $COMPOSE ps --format json nginx 2>/dev/null | grep -q '"running"'; then
  docker exec wp_nginx nginx -s reload 2>/dev/null && ok "Nginx config reloaded." || true
else
  $COMPOSE up -d nginx
  sleep 3
fi

ok "nginx, certbot, prometheus, grafana running."

# ─────────────────────────────────────────────────────────────────────────────
#  STEP 9 — post-deploy health checks
# ─────────────────────────────────────────────────────────────────────────────
header "Health checks"

sleep 8   # allow containers to fully init

check_url() {
  local label="$1" url="$2" expected="${3:-200}"
  local code
  code=$(curl -sk --max-time 10 -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  if [[ "$code" == "$expected" ]]; then
    ok "${label}  →  HTTP ${code}"
  else
    warn "${label}  →  HTTP ${code} (expected ${expected})"
  fi
}

# API health JSON
API_STATUS=$(curl -sk --max-time 8 https://api.world-pulse.io/health 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null \
  || echo "unreachable")
if [[ "$API_STATUS" == "ok" ]]; then
  ok "api.world-pulse.io/health  →  $API_STATUS"
else
  warn "api.world-pulse.io/health  →  $API_STATUS"
fi

check_url "world-pulse.io"         "https://world-pulse.io"         "200"
check_url "world-pulse.app"        "https://world-pulse.app"        "301"   # redirects to .io
check_url "www.world-pulse.io"     "https://www.world-pulse.io"     "301"   # redirects to apex

# ─────────────────────────────────────────────────────────────────────────────
#  STEP 10 — clean up
# ─────────────────────────────────────────────────────────────────────────────
header "Cleanup"

docker image prune -f --filter "until=24h" | grep -v "^Total" || true
ok "Old images pruned."

# ─────────────────────────────────────────────────────────────────────────────
#  Done
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  ✓  Deploy complete  —  $(date '+%H:%M:%S')${NC}"
echo ""
echo   "  https://world-pulse.io"
echo   "  https://world-pulse.app  (→ redirects to .io)"
echo   "  https://api.world-pulse.io/health"
echo ""
echo   "  Log saved to: ${LOGFILE}"
echo ""
echo   "  Useful commands:"
echo   "    docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api"
echo   "    ./deploy.sh --rollback"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"

if $TAIL_LOGS; then
  echo ""
  log "Tailing logs (Ctrl+C to exit)..."
  $COMPOSE logs -f api web scraper
fi
