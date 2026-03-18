#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  WorldPulse — Let's Encrypt SSL certificate issuance
#
#  Issues two certificates:
#    1. world-pulse.io   covering: world-pulse.io, www.world-pulse.io, api.world-pulse.io
#    2. world-pulse.app  covering: world-pulse.app, www.world-pulse.app
#
#  Called automatically by deploy.sh on first run.
#  Can also be run standalone:
#    ./nginx/certbot.sh your@email.com
#
#  Renewal is handled automatically by the certbot container (every 12h).
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

EMAIL="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${CYAN}[certbot]${NC} $*"; }
ok()   { echo -e "${GREEN}[certbot] ✓${NC} $*"; }
warn() { echo -e "${YELLOW}[certbot] ⚠${NC}  $*"; }
fail() { echo -e "${RED}[certbot] ✗${NC} $*"; exit 1; }

# ── Validate ──────────────────────────────────────────────────────────────────
[[ -z "$EMAIL" ]] && fail "Usage: $0 <your@email.com>"
command -v docker >/dev/null 2>&1 || fail "Docker is not installed."

# ── Shared certbot volumes (same as docker-compose.prod.yml) ─────────────────
# Named volumes used by the compose stack — we reference them by path on the host.
# Docker stores named volumes at /var/lib/docker/volumes/<project>_<vol>/_data
# We pass them as bind mounts to the one-off certbot container.
CERTBOT_WWW="${PROJECT_DIR}/.certbot/www"
CERTBOT_CONF="${PROJECT_DIR}/.certbot/conf"
mkdir -p "$CERTBOT_WWW" "$CERTBOT_CONF"

log "────────────────────────────────────────────"
log "  WorldPulse SSL — issuing certificates"
log "  world-pulse.io  (+ www + api)"
log "  world-pulse.app (+ www)"
log "  Email: $EMAIL"
log "────────────────────────────────────────────"

# ── Step 1: Bootstrap nginx to serve ACME challenge over HTTP ─────────────────
log "Starting bootstrap nginx for ACME challenge..."

# Write a minimal HTTP-only nginx config
BOOTSTRAP_CONF=$(mktemp /tmp/wp-nginx-bootstrap-XXXXXX.conf)
cat > "$BOOTSTRAP_CONF" << 'NGINX_EOF'
events { worker_connections 64; }
http {
    server {
        listen 80;
        server_name _;
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
            try_files $uri =404;
        }
        location / {
            return 200 'WorldPulse ACME bootstrap';
            add_header Content-Type text/plain;
        }
    }
}
NGINX_EOF

# Stop any existing nginx on port 80
docker rm -f wp_nginx_bootstrap 2>/dev/null || true
# Also stop the compose nginx if running
docker stop wp_nginx 2>/dev/null || true

docker run -d \
  --name wp_nginx_bootstrap \
  -p 80:80 \
  -v "${CERTBOT_WWW}:/var/www/certbot" \
  -v "${BOOTSTRAP_CONF}:/etc/nginx/nginx.conf:ro" \
  nginx:1.27-alpine

log "Waiting for bootstrap nginx..."
for i in $(seq 1 15); do
  if curl -sf --max-time 2 http://localhost/ > /dev/null 2>&1; then
    ok "Bootstrap nginx is up."
    break
  fi
  [[ $i -eq 15 ]] && {
    docker logs wp_nginx_bootstrap 2>&1 | tail -20
    fail "Bootstrap nginx failed to start. Is port 80 free?"
  }
  sleep 1
done

# ── Helper: issue or skip if cert already valid ───────────────────────────────
issue_cert() {
  local primary="$1"; shift
  local domains=("$@")

  local cert_path="${CERTBOT_CONF}/live/${primary}/fullchain.pem"

  # Skip if cert exists and is valid for > 30 days
  if [[ -f "$cert_path" ]]; then
    local expiry
    expiry=$(openssl x509 -noout -enddate -in "$cert_path" 2>/dev/null | cut -d= -f2 || echo "")
    if [[ -n "$expiry" ]]; then
      local expiry_epoch; expiry_epoch=$(date -d "$expiry" +%s 2>/dev/null || date -j -f "%b %d %T %Y %Z" "$expiry" +%s 2>/dev/null || echo 0)
      local now_epoch;    now_epoch=$(date +%s)
      local days_left=$(( (expiry_epoch - now_epoch) / 86400 ))
      if [[ $days_left -gt 30 ]]; then
        ok "Cert for ${primary} already valid (${days_left}d remaining) — skipping."
        return 0
      fi
      warn "Cert for ${primary} expires in ${days_left}d — renewing."
    fi
  fi

  log "Issuing cert for: ${domains[*]}"

  # Build -d flags
  local d_flags=()
  for domain in "${domains[@]}"; do
    d_flags+=(-d "$domain")
  done

  docker run --rm \
    -v "${CERTBOT_WWW}:/var/www/certbot" \
    -v "${CERTBOT_CONF}:/etc/letsencrypt" \
    certbot/certbot certonly \
      --webroot \
      --webroot-path=/var/www/certbot \
      --email "$EMAIL" \
      --agree-tos \
      --no-eff-email \
      --non-interactive \
      --keep-until-expiring \
      "${d_flags[@]}"

  [[ -f "${CERTBOT_CONF}/live/${primary}/fullchain.pem" ]] || fail "Cert issuance failed for ${primary}."
  ok "Certificate issued for ${primary}."
}

# ── Step 2: Issue both certificates ──────────────────────────────────────────
issue_cert "world-pulse.io"  "world-pulse.io"  "www.world-pulse.io"  "api.world-pulse.io"
issue_cert "world-pulse.app" "world-pulse.app" "www.world-pulse.app"

# ── Step 3: Stop bootstrap nginx ─────────────────────────────────────────────
docker rm -f wp_nginx_bootstrap 2>/dev/null || true
rm -f "$BOOTSTRAP_CONF"

# ── Step 4: Verify both certs ────────────────────────────────────────────────
for domain in "world-pulse.io" "world-pulse.app"; do
  cert="${CERTBOT_CONF}/live/${domain}/fullchain.pem"
  key="${CERTBOT_CONF}/live/${domain}/privkey.pem"
  [[ -f "$cert" && -f "$key" ]] || fail "Missing cert files for ${domain} at ${cert}"
  expiry=$(openssl x509 -noout -enddate -in "$cert" | cut -d= -f2)
  ok "${domain}  →  expires ${expiry}"
done

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✓  Both certificates issued successfully        ${NC}"
echo ""
echo "  world-pulse.io  → ${CERTBOT_CONF}/live/world-pulse.io/"
echo "  world-pulse.app → ${CERTBOT_CONF}/live/world-pulse.app/"
echo ""
echo "  Auto-renewal runs every 12h inside the certbot container."
echo -e "${GREEN}══════════════════════════════════════════════════${NC}"
