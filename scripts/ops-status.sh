#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  WorldPulse — publish a small, non-secret server status file
#  Served at https://world-pulse.io/ops-status.json so the autopilot can see
#  server health without logging in. No logs, keys or user data go in here:
#  only counts, plus the scraper's most frequent error and warning messages
#  (digits and links blanked out) and its AI settings as yes/no (no keys).
# ─────────────────────────────────────────────────────────────────────────────
cd "$(dirname "$0")/.."
mkdir -p logs/public

# ── Disk guard (Oct 12, 2026) ───────────────────────────────────────────────
# The disk filled overnight: the database stopped, the API answered 500, and
# every deploy failed while fetching code, before its own clean-up could run.
# This runs every 5 minutes from cron: under 3 GB free it clears what is safe
# to clear: oversized Docker logs, old journal, all build cache and untagged
# images. Never volumes (the data), never tagged images (:previous is the
# rollback). Skipped while a deploy or maintenance holds the lock.
disk_guard() {
  local before after
  before=$(df -BM --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9')
  [ -n "$before" ] && [ "$before" -lt 3072 ] || return 0
  exec 8>/var/lock/worldpulse-deploy.lock || return 0
  if flock -n 8; then
    find /var/lib/docker/containers -name '*-json.log' -size +100M -exec truncate -s 0 {} \; 2>/dev/null || true
    journalctl --vacuum-size=200M >/dev/null 2>&1 || true
    timeout 300 docker builder prune -af >/dev/null 2>&1 || true
    timeout 300 docker image prune -f >/dev/null 2>&1 || true
    after=$(df -BM --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9')
    echo "$(date -Is) ${before:-?}M free -> ${after:-?}M" >> logs/disk-guard.log 2>/dev/null || true
  fi
  exec 8>&-
}
disk_guard

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
# Why the scraper's AI calls fail (plan 0f). Its AI settings as yes/no plus the
# model name and the path it calls, and the newest failure reduced to a fixed
# phrase and HTTP status. Never the raw error text, which can quote part of a key.
llm_stats() {
  local cfg key url model kind="none" path="" host last http reason="none"
  cfg=$(timeout 10 docker exec wp_scraper sh -c \
        'printf "%s\n%s\n%s\n" "${OPENAI_API_KEY:+yes}" "$LLM_API_URL" "$LLM_MODEL"' 2>/dev/null) || cfg=""
  key=$(sed -n 1p <<< "$cfg"); url=$(sed -n 2p <<< "$cfg")
  model=$(sed -n 3p <<< "$cfg" | tr -cd 'A-Za-z0-9._:/-' | cut -c1-60)
  if [ -n "$url" ]; then
    host=$(sed -E 's#^[A-Za-z]+://([^/@]*@)?([^/:?\#]+).*#\2#' <<< "$url" | tr 'A-Z' 'a-z')
    case "$host" in
      api.openai.com) kind=openai ;;
      localhost|127.*|10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|host.docker.internal|*.internal) kind=local ;;
      *) kind=other ;;
    esac
    # The path the scraper ends up calling (classify.ts adds /chat/completions)
    path=$(sed -E 's#^[A-Za-z]+://[^/]*##; s#[?\#].*##; s#/+$##' <<< "$url" | tr -cd 'A-Za-z0-9/._-' | cut -c1-60)
    path="$path/chat/completions"
  fi
  last=$(grep '"msg":"LLM classification failed' <<< "$1" | tail -n 1)
  if [ -n "$last" ]; then
    http=$(grep -o 'LLM API error: [0-9]\{3\}' <<< "$last" | head -n 1 | grep -o '[0-9]\{3\}$')
    if   grep -qiE 'incorrect api key|invalid_api_key|invalid.?api.?key|unauthori[sz]ed|authentication' <<< "$last"; then reason="key rejected"
    elif grep -qiE 'exceeded your current quota|insufficient_quota|billing|credit balance' <<< "$last"; then reason="out of credit"
    elif grep -qiE 'does not exist|model_not_found|no such model|model .{0,40}not found' <<< "$last"; then reason="model not available"
    elif grep -qiE 'invalid url|page not found' <<< "$last" || [ "$http" = 404 ]; then reason="wrong address"
    elif grep -qiE 'rate.?limit' <<< "$last" || [ "$http" = 429 ]; then reason="rate limited"
    elif grep -qiE 'timeout|timed out|aborted' <<< "$last"; then reason="timed out"
    elif grep -qiE 'ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|fetch failed|socket' <<< "$last"; then reason="cannot connect"
    elif grep -qiE 'JSON|Unexpected token|empty content' <<< "$last"; then reason="unreadable reply"
    else reason="other"; fi
  fi
  printf '{"openai_key":%s,"custom_url":"%s","calls":"%s","model":"%s","last_failure":"%s","http":%s}' \
    "$([ "$key" = yes ] && echo true || echo false)" "$kind" "$path" "$model" "$reason" "${http:-null}"
}
# Claude (Oct 11, 2026): the AI work moved in-house, under a monthly cap the
# apps count in Redis (apps/scraper/src/lib/claude.ts). Whether each app has a
# key (yes/no), whether the AI Digest is on, the cap, the spend today and this
# month in dollars, today's calls by job, the editor's last pass, and the
# cross-check of verified stories. No key or password is printed.
claude_stats() {
  local scr_key api_key pulse cap pw out
  scr_key=$(timeout 10 docker exec wp_scraper sh -c 'printf %s "${ANTHROPIC_API_KEY:+yes}"' 2>/dev/null) || scr_key=""
  api_key=$(timeout 10 docker exec wp_api sh -c 'printf %s "${ANTHROPIC_API_KEY:+yes}"' 2>/dev/null) || api_key=""
  pulse=$(timeout 10 docker exec wp_api sh -c 'printf %s "$PULSE_ENABLED"' 2>/dev/null | tr -cd 'a-z0-9') || pulse=""
  cap=$(timeout 10 docker exec wp_scraper sh -c 'printf %s "${AI_MONTHLY_CAP_USD:-20}"' 2>/dev/null | tr -cd '0-9.') || cap=""
  pw=$(timeout 10 docker exec wp_scraper sh -c 'printf %s "$REDIS_URL"' 2>/dev/null | sed -nE 's#^redis://:([^@]*)@.*#\1#p') || pw=""
  out=$(timeout 15 docker exec -e REDISCLI_AUTH="$pw" wp_redis sh -c '
      echo "day=$(redis-cli --raw GET "ai:claude:spend:$1")"
      echo "month=$(redis-cli --raw GET "ai:claude:spend:$2")"
      echo "calls=$(redis-cli --raw HGETALL "ai:claude:calls:$1" | paste -sd " " -)"
      echo "editor=$(redis-cli --raw GET ai:editor:last)"
      echo "verify=$(redis-cli --raw HGETALL "ai:verify:counts:$1" | paste -sd " " -)"
      redis-cli --raw LRANGE ai:verify:recent 0 4 | sed "s/^/doubt=/"' sh "$(date -u +%F)" "$(date -u +%Y-%m)" 2>/dev/null) || out=""
  SCR_KEY="$scr_key" API_KEY_SET="$api_key" PULSE="$pulse" CAP="$cap" OUT="$out" python3 - <<'PY' 2>/dev/null || printf 'null'
import json, os
vals = dict(line.split('=', 1) for line in os.environ.get('OUT', '').splitlines() if '=' in line)
def usd(v):
    try: return round(int(v) / 1e6, 4)
    except (TypeError, ValueError): return 0
words = vals.get('calls', '').split()
calls = {words[i]: int(words[i + 1]) for i in range(0, len(words) - 1, 2) if words[i + 1].isdigit()}
try: editor = json.loads(vals.get('editor') or 'null')
except ValueError: editor = None
# Ledger's cross-check of verified stories (pipeline/crosscheck.ts): today's
# verdicts, and the newest stories Claude doubted (public headlines only)
words = vals.get('verify', '').split()
verify = {words[i]: int(words[i + 1]) for i in range(0, len(words) - 1, 2) if words[i + 1].isdigit()}
doubts = []
for line in os.environ.get('OUT', '').splitlines():
    if line.startswith('doubt='):
        try: doubts.append(json.loads(line[6:]))
        except ValueError: pass
try: cap = float(os.environ.get('CAP') or 20)
except ValueError: cap = 20
print(json.dumps({
    'key_scraper': os.environ.get('SCR_KEY') == 'yes',
    'key_api': os.environ.get('API_KEY_SET') == 'yes',
    'ai_digest_on': os.environ.get('PULSE') in ('true', '1'),
    'cap_usd_month': cap,
    'spent_usd_today': usd(vals.get('day')),
    'spent_usd_month': usd(vals.get('month')),
    'calls_today': calls,
    'editor_last_pass': editor,
    'crosscheck_today': verify,
    'crosscheck_doubts': doubts,
}, separators=(',', ':')))
PY
}
# Where the disk goes: Docker's totals (images, containers, volumes, build
# cache) with what could be cleared, each data volume, and the log folders, in
# MB. Sizes only; nothing is read from inside the files. From 80% full, also
# the biggest folders and files up to four levels down (Oct 12: Docker's
# totals explained half of what was used; /usr/share held 33 GB), and the
# models Ollama keeps (it runs on the host for the scraper's embeddings).
disk_stats() {
  local sysdf vols logs used big="" ollama""
  sysdf=$(timeout 60 docker system df --format '{{.Type}}|{{.Size}}|{{.Reclaimable}}' 2>/dev/null) || sysdf=""
  vols=$(timeout 60 du -sm /var/lib/docker/volumes/*/_data 2>/dev/null) || vols=""
  logs=$(timeout 30 du -sm /var/log logs 2>/dev/null) || logs=""
  used=$(df --output=pcent / 2>/dev/null | tail -1 | tr -dc '0-9')
  if [ "${used:-0}" -ge 80 ]; then
    big=$(timeout 150 nice -n 19 du -xam --max-depth=4 / 2>/dev/null | sort -rn | head -n 30) || big=""
  fi
  ollama=$(python3 -c '
import sys, urllib.request
for host in ("127.0.0.1", "172.19.0.1"):
    try:
        print(urllib.request.urlopen("http://%s:11434/api/tags" % host, timeout=5).read().decode()); sys.exit(0)
    except Exception:
        pass' 2>/dev/null) || ollama=""
  SYSDF="$sysdf" VOLS="$vols" LOGS="$logs" BIG="$big" OLLAMA="$ollama" python3 - <<'PY' 2>/dev/null || printf 'null'
import json, os, re
UNITS = {'B': 1e-6, 'kB': 1e-3, 'KB': 1e-3, 'MB': 1, 'GB': 1e3, 'TB': 1e6}
def mb(text):
    m = re.match(r'\s*([\d.]+)\s*([kKMGT]?B)', text or '')
    return round(float(m.group(1)) * UNITS[m.group(2)]) if m else None
docker = {}
for line in os.environ.get('SYSDF', '').splitlines():
    parts = line.split('|')
    if len(parts) == 3:
        key = re.sub(r'[^a-z]+', '_', parts[0].strip().lower()).strip('_')
        docker[key] = {'mb': mb(parts[1]), 'clearable_mb': mb(parts[2])}
volumes = {}
for line in os.environ.get('VOLS', '').splitlines():
    m = re.match(r'(\d+)\s+/var/lib/docker/volumes/([^/]+)/_data$', line.strip())
    if m:
        volumes[re.sub(r'^worldpulse[-_]', '', m.group(2))[:40]] = int(m.group(1))
logs = {}
for line in os.environ.get('LOGS', '').splitlines():
    m = re.match(r'(\d+)\s+(\S+)$', line.strip())
    if m:
        logs['system' if m.group(2) == '/var/log' else 'worldpulse'] = int(m.group(1))
folders = {}
for line in os.environ.get('BIG', '').splitlines():
    m = re.match(r'(\d+)\s+(/[^\s]*)$', line.strip())
    if m and m.group(2) != '/' and len(folders) < 16:
        folders[m.group(2)[:80]] = int(m.group(1))
models = {}
try:
    for mdl in (json.loads(os.environ.get('OLLAMA') or '{}').get('models') or [])[:20]:
        models[str(mdl.get('name', '?'))[:60]] = round((mdl.get('size') or 0) / 1e6)
except (ValueError, AttributeError):
    models = {}
print(json.dumps({'docker': docker, 'volumes_mb': dict(sorted(volumes.items(), key=lambda kv: -kv[1])[:12]),
                  'logs_mb': logs, 'folders_mb': folders, 'ollama_models_mb': models}, separators=(',', ':')))
PY
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
        'newest_signal', max(created_at),
        'outlets', (SELECT count(DISTINCT lower(substring(u from '^https?://(?:www[.])?([^/:?#]+)')))
                      FROM signals s2, unnest(s2.original_urls) AS u
                     WHERE s2.created_at > now() - interval '24 hours'))
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
  printf '"scraper_30m":{"errors":%d,"warnings":%d,"signals_created":%d,"top_errors":[%s],"top_warnings":[%s]},' \
    "${errs:-0}" "${warns:-0}" "${created:-0}" "$top" "$topw"
  printf '"llm":%s,' "$(llm_stats "$scr")"
  printf '"claude":%s,' "$(claude_stats)"
  printf '"disk":%s,' "$(disk_stats)"
  # Readers of world-pulse.io today and where they came from (plan G1): counts
  # only, from nginx's log; scripts/readers.py says how (no addresses kept)
  printf '"readers":%s}' "$(timeout 90 python3 scripts/readers.py logs/readers-state.json 2>/dev/null || printf 'null')"
}
# Why the last deploy wasn't clean, from the deploy script's own log lines only
# (its warnings, or the reason it rolled back or failed); empty when it was clean
deploy_note() {
  case "$(cat logs/deploy.status 2>/dev/null)" in
    success_with_warnings) grep -o 'Deployed [^,]*, but:.*' logs/deploy-latest.log 2>/dev/null | tail -n 1 \
                             | sed 's/^Deployed [^,]*, but: *//' ;;
    rolled_back|failed)    grep '^\[deploy ' logs/deploy-latest.log 2>/dev/null | tail -n 1 | sed 's/^\[deploy [0-9:]*\] //' ;;
  esac | tr -d '"\\' | tr -d '\000-\037' | cut -c1-240
}
pipe_cache=logs/pipeline-stats.json
# Refresh every 30 minutes, or straight away when the cache predates a new field
if [ ! -s "$pipe_cache" ] || [ -n "$(find "$pipe_cache" -mmin +29 2>/dev/null)" ] \
   || ! grep -q '"ollama_models_mb"' "$pipe_cache" 2>/dev/null; then
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
  printf '"last_deploy_note":"%s",' "$(deploy_note)"
  printf '"last_maintenance":"%s",' "$(cat logs/maintenance.status 2>/dev/null || echo none)"
  printf '"disk_used_pct":%s,' "$(df --output=pcent / | tail -1 | tr -dc '0-9')"
  printf '"disk_free_gb":%s,' "$(df -BG --output=avail / | tail -1 | tr -dc '0-9')"
  printf '"disk_free_mb":%s,' "$(df -BM --output=avail / | tail -1 | tr -dc '0-9')"
  printf '"disk_guard_last":"%s",' "$(tail -n 1 logs/disk-guard.log 2>/dev/null | tr -cd 'A-Za-z0-9 :+>.?-' | cut -c1-80)"
  printf '"cert_days_left":%s,' "$days"
  printf '"containers":{%s},' "$containers"
  printf '"pipeline":%s}\n' "$pipeline"
} > logs/public/status.json.tmp && mv logs/public/status.json.tmp logs/public/status.json
