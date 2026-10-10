#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  WorldPulse — publish a small, non-secret server status file
#  Served at https://world-pulse.io/ops-status.json so the autopilot can see
#  server health without logging in. No logs, keys or user data go in here:
#  only counts, plus the scraper's most frequent error and warning messages
#  (digits and links blanked out).
# ─────────────────────────────────────────────────────────────────────────────
cd "$(dirname "$0")/.."
mkdir -p logs/public
days=-1
end=$(openssl x509 -enddate -noout -in .certbot/conf/live/world-pulse.io/fullchain.pem 2>/dev/null | cut -d= -f2)
[ -n "$end" ] && days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
containers=$(docker ps -a --format '{{.Names}}={{.State}}' 2>/dev/null | grep '^wp_' | sort \
  | awk -F= '{printf "%s\"%s\":\"%s\"", (NR>1?",":""), $1, $2}')

# ── Signal pipeline: counts only (no titles, logs or user data) ─────────────
# Why: since Apr 26 almost no signal reaches "verified". These numbers show
# where the pipeline stops without anyone logging in. The database is asked at
# most every 30 minutes (cached in logs/, which nginx doesn't serve).
# The five most frequent "msg" values among the log lines on stdin, as JSON
top_msgs() {
  sed -n 's/.*"msg":"\([^"]\{1,70\}\)".*/\1/p' \
    | sed -E 's#https?://[^ ]+#<url>#g; s/[0-9]+/#/g; s/[\\]//g' | sort | uniq -c | sort -rn | head -n 5 \
    | awk '{c=$1; $1=""; sub(/^ /,""); printf "%s{\"msg\":\"%s\",\"count\":%d}", (NR>1?",":""), $0, c}'
}
pipeline_stats() {
  local q1 q2 db scr errs warns created top topw
  q1="SELECT json_build_object(
        'created',      count(*),
        'verified',     count(*) FILTER (WHERE status = 'verified'),
        'pending',      count(*) FILTER (WHERE status = 'pending'),
        'disputed',     count(*) FILTER (WHERE status = 'disputed'),
        'multi_source', count(*) FILTER (WHERE source_count >= 2),
        'reliability_over_085', count(*) FILTER (WHERE reliability_score > 0.85),
        'avg_reliability', round(avg(reliability_score)::numeric, 3),
        'newest_signal', max(created_at))
      FROM signals WHERE created_at > now() - interval '24 hours'"
  q2="SELECT json_build_object(
        'verified_any_age', count(*) FILTER (WHERE verified_at > now() - interval '24 hours'),
        'newest_verified',  max(verified_at))
      FROM signals WHERE status = 'verified'"
  db=$(timeout 25 docker exec wp_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq -c "$1" -c "$2"' sh "$q1" "$q2" 2>/dev/null \
       | tr -d '\r' | grep '^{' | paste -sd ',' -) || db=""
  # Scraper log lines from the last 30 minutes, counted by level; the most
  # frequent error and warning messages, digits blanked out (our own log text only)
  scr=$(timeout 25 docker logs --since 30m wp_scraper 2>&1 | tail -n 50000) || scr=""
  errs=$(grep -c '"level":[56]0' <<< "$scr") || true
  warns=$(grep -c '"level":40' <<< "$scr") || true
  created=$(grep -c '"msg":"Signal created"' <<< "$scr") || true
  top=$(grep '"level":[56]0' <<< "$scr" | top_msgs)
  topw=$(grep '"level":40' <<< "$scr" | top_msgs)
  printf '{"window":"24h","checked":"%s",' "$(date -Is)"
  printf '"db":%s,' "$( [ -n "$db" ] && printf '[%s]' "$db" || printf 'null')"
  printf '"scraper_30m":{"errors":%d,"warnings":%d,"signals_created":%d,"top_errors":[%s],"top_warnings":[%s]}}' \
    "${errs:-0}" "${warns:-0}" "${created:-0}" "$top" "$topw"
}
pipe_cache=logs/pipeline-stats.json
if [ ! -s "$pipe_cache" ] || [ -n "$(find "$pipe_cache" -mmin +29 2>/dev/null)" ]; then
  pipeline_stats > "$pipe_cache.tmp" 2>/dev/null \
    && python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$pipe_cache.tmp" 2>/dev/null \
    && mv "$pipe_cache.tmp" "$pipe_cache"
  rm -f "$pipe_cache.tmp"
fi
pipeline=$(cat "$pipe_cache" 2>/dev/null || true)
[ -n "$pipeline" ] || pipeline=null
{
  printf '{"updated":"%s",' "$(date -Is)"
  printf '"commit":"%s",' "$(git rev-parse --short=7 HEAD 2>/dev/null || echo unknown)"
  printf '"last_deploy":"%s",' "$(cat logs/deploy.status 2>/dev/null || echo none)"
  printf '"last_maintenance":"%s",' "$(cat logs/maintenance.status 2>/dev/null || echo none)"
  printf '"disk_used_pct":%s,' "$(df --output=pcent / | tail -1 | tr -dc '0-9')"
  printf '"disk_free_gb":%s,' "$(df -BG --output=avail / | tail -1 | tr -dc '0-9')"
  printf '"cert_days_left":%s,' "$days"
  printf '"containers":{%s},' "$containers"
  printf '"pipeline":%s}\n' "$pipeline"
} > logs/public/status.json.tmp && mv logs/public/status.json.tmp logs/public/status.json
