#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  WorldPulse — publish a small, non-secret server status file
#  Served at https://world-pulse.io/ops-status.json so the autopilot can see
#  server health without logging in. No logs, keys or user data go in here.
# ─────────────────────────────────────────────────────────────────────────────
cd "$(dirname "$0")/.."
mkdir -p logs/public
days=-1
end=$(openssl x509 -enddate -noout -in .certbot/conf/live/world-pulse.io/fullchain.pem 2>/dev/null | cut -d= -f2)
[ -n "$end" ] && days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
containers=$(docker ps -a --format '{{.Names}}={{.State}}' 2>/dev/null | grep '^wp_' | sort \
  | awk -F= '{printf "%s\"%s\":\"%s\"", (NR>1?",":""), $1, $2}')
{
  printf '{"updated":"%s",' "$(date -Is)"
  printf '"commit":"%s",' "$(git rev-parse --short=7 HEAD 2>/dev/null || echo unknown)"
  printf '"last_deploy":"%s",' "$(cat logs/deploy.status 2>/dev/null || echo none)"
  printf '"last_maintenance":"%s",' "$(cat logs/maintenance.status 2>/dev/null || echo none)"
  printf '"disk_used_pct":%s,' "$(df --output=pcent / | tail -1 | tr -dc '0-9')"
  printf '"disk_free_gb":%s,' "$(df -BG --output=avail / | tail -1 | tr -dc '0-9')"
  printf '"cert_days_left":%s,' "$days"
  printf '"containers":{%s}}\n' "$containers"
} > logs/public/status.json.tmp && mv logs/public/status.json.tmp logs/public/status.json
