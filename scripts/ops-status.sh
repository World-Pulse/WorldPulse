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
# The Redis password, from the scraper's REDIS_URL (passed to redis-cli in its
# environment, never printed)
redis_pw() {
  timeout 10 docker exec wp_scraper sh -c 'printf %s "$REDIS_URL"' 2>/dev/null | sed -nE 's#^redis://:([^@]*)@.*#\1#p'
}
# Claude (Oct 11, 2026): the AI work moved in-house, under a monthly cap the
# apps count in Redis (apps/scraper/src/lib/claude.ts). Whether each app has a
# key (yes/no), whether the AI Digest is on, the cap, the spend today and this
# month in dollars, today's calls by job, the editor's last pass, and the
# cross-check of verified stories. No key or password is printed.
# Oct 14, 2026: and whether Claude is answering (ai:claude:health): when a call
# last worked, the newest failure as a fixed phrase (the API spend limit
# stopped every call for six hours that night, unseen here), and while calls
# keep failing, since when and how many.
claude_stats() {
  local scr_key api_key pulse cap pw out
  scr_key=$(timeout 10 docker exec wp_scraper sh -c 'printf %s "${ANTHROPIC_API_KEY:+yes}"' 2>/dev/null) || scr_key=""
  api_key=$(timeout 10 docker exec wp_api sh -c 'printf %s "${ANTHROPIC_API_KEY:+yes}"' 2>/dev/null) || api_key=""
  pulse=$(timeout 10 docker exec wp_api sh -c 'printf %s "$PULSE_ENABLED"' 2>/dev/null | tr -cd 'a-z0-9') || pulse=""
  cap=$(timeout 10 docker exec wp_scraper sh -c 'printf %s "${AI_MONTHLY_CAP_USD:-20}"' 2>/dev/null | tr -cd '0-9.') || cap=""
  pw=$(redis_pw) || pw=""
  out=$(timeout 15 docker exec -e REDISCLI_AUTH="$pw" wp_redis sh -c '
      echo "day=$(redis-cli --raw GET "ai:claude:spend:$1")"
      echo "month=$(redis-cli --raw GET "ai:claude:spend:$2")"
      echo "calls=$(redis-cli --raw HGETALL "ai:claude:calls:$1" | paste -sd " " -)"
      echo "health=$(redis-cli --raw HGETALL ai:claude:health | paste -s -)"
      echo "editor=$(redis-cli --raw GET ai:editor:last)"
      echo "verify=$(redis-cli --raw HGETALL "ai:verify:counts:$1" | paste -sd " " -)"
      redis-cli --raw LRANGE ai:verify:recent 0 4 | sed "s/^/doubt=/"
      redis-cli --raw LRANGE ai:verify:different 0 29 | sed "s/^/different=/"
      echo "social=$(redis-cli --raw GET social:status)"' sh "$(date -u +%F)" "$(date -u +%Y-%m)" 2>/dev/null) || out=""
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
doubts, different = [], []
for line in os.environ.get('OUT', '').splitlines():
    for prefix, into in (('doubt=', doubts), ('different=', different)):
        if line.startswith(prefix):
            try: into.append(json.loads(line[len(prefix):]))
            except ValueError: pass
try: social = json.loads(vals.get('social') or 'null')
except ValueError: social = None
try: cap = float(os.environ.get('CAP') or 20)
except ValueError: cap = 20
# Whether Claude is answering: field, value, field, value … separated by tabs
words = vals.get('health', '').split('\t')
health = dict(zip(words[0::2], words[1::2])) if len(words) > 1 else {}
try: last_error = json.loads(health.get('error') or 'null')
except ValueError: last_error = None
if isinstance(last_error, dict):
    last_error = {'at': health.get('error_at'), **{k: last_error.get(k) for k in ('app', 'purpose', 'model', 'status', 'reason')}}
else:
    last_error = None
try: failing_calls = int(health.get('failing_calls') or 0)
except ValueError: failing_calls = 0
print(json.dumps({
    'key_scraper': os.environ.get('SCR_KEY') == 'yes',
    'key_api': os.environ.get('API_KEY_SET') == 'yes',
    'ai_digest_on': os.environ.get('PULSE') in ('true', '1'),
    'cap_usd_month': cap,
    'spent_usd_today': usd(vals.get('day')),
    'spent_usd_month': usd(vals.get('month')),
    'calls_today': calls,
    # When a call last worked; the newest failure (app, job, model, HTTP status,
    # why); and, while calls keep failing, since when and how many (else null, 0)
    'last_ok': health.get('ok_at'),
    'last_error': last_error,
    'failing_since': health.get('failing_since'),
    'failing_calls': failing_calls,
    'editor_last_pass': editor,
    'crosscheck_today': verify,
    'crosscheck_doubts': doubts,
    # The newest "different event" verdicts (30), read before they may hold a story at pending
    'crosscheck_different': different,
    # Automatic Telegram and Bluesky posts (plan G10): last post, posts today, last error per channel
    'social': social,
}, separators=(',', ':')))
PY
}
# Sources failing now, by name (plan 0m, Oct 14, 2026). A source whose every
# poll failed looked alive; the watchdog stopped vouching for those (9017fe9),
# and this names them: each source whose newest polls failed (the circuit
# breaker's count of failures in a row, scraper:cb:<id>), whether it is paused
# and until when, when it last worked (scraper:health:<id>), and why its newest
# failure happened as a fixed phrase (from the dead-letter list, scraper:dlq).
# Listed: paused now, or failed in the last 48 hours (last_failed_at); older
# counts belong to sources no longer polled and are only counted ("stale").
# Also the news poller's feeds (news-rss.ts keeps its own count of failed
# polls in a row, news-rss:fail:<id>, and pauses a feed after 3).
# Sources switched off in the database (sources.active, Oct 14: 9 dead feeds)
# are never polled again: they are left out of "tracked" and the failing list
# and only counted ("switched_off").
# Names, counts and times only: no addresses, no error text.
source_stats() {
  local pw out off
  pw=$(redis_pw) || pw=""
  off=$(timeout 15 docker exec wp_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq -c "$1"' sh \
        "SELECT id FROM sources WHERE NOT active" 2>/dev/null | tr -cd '0-9a-f\n-') || off=""
  out=$(timeout 40 docker exec -e REDISCLI_AUTH="$pw" wp_redis sh -c '
      echo "tracked=$(redis-cli --raw SCARD scraper:health:index)"
      redis-cli --raw SMEMBERS scraper:health:index | head -n 2000 | sed "s/^/member=/"
      redis-cli --raw --scan --pattern "scraper:cb:*" | head -n 400 | while read -r k; do
        id=${k#scraper:cb:}
        printf "cb=%s\t%s\t%s\n" "$id" "$(redis-cli --raw HMGET "$k" failures open_until open_count last_failed_at | paste -s -)" \
          "$(redis-cli --raw HMGET "scraper:health:$id" source_name source_slug last_seen | paste -s -)"
      done
      redis-cli --raw --scan --pattern "news-rss:fail:*" | head -n 400 | while read -r k; do
        id=${k#news-rss:fail:}
        printf "feed=%s\t%s\t%s\n" "$id" "$(redis-cli --raw GET "$k")" "$(redis-cli --raw EXISTS "news-rss:pause:$id")"
      done
      redis-cli --raw LRANGE scraper:dlq 0 299 | sed "s/^/dlq=/"' 2>/dev/null) || out=""
  OUT="$out" OFF="$off" python3 - <<'PY' 2>/dev/null || printf 'null'
import calendar, json, os, re, time
lines = os.environ.get('OUT', '').splitlines()
off = set(os.environ.get('OFF', '').split())
now_ms = time.time() * 1000
def num(v):
    try: return int(v)
    except (TypeError, ValueError): return 0
def iso(ms):
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(ms / 1000)) if ms > 0 else None
# Why a fetch failed, as a fixed phrase (never the error's own text)
def why(err):
    if not err: return None
    m = re.search(r'(?:HTTP|status(?: code)?|returned|response)\D{0,3}([1-5]\d\d)\b', err, re.I)
    if m: return 'rate limited' if m.group(1) == '429' else 'HTTP ' + m.group(1)
    if re.search(r'timeout|timed out|abort', err, re.I): return 'timed out'
    if re.search(r'certificate|CERT_|SSL|TLS', err): return 'certificate problem'
    if re.search(r'ENOTFOUND|EAI_AGAIN', err): return 'address not found'
    if re.search(r'ECONNREFUSED|ECONNRESET|EHOSTUNREACH|socket|fetch failed|network', err, re.I): return 'cannot connect'
    if re.search(r'rate.?limit|too many', err, re.I): return 'rate limited'
    if re.search(r'parse|XML|JSON|Unexpected|Non-whitespace|Unclosed|Attribute|not a feed|Invalid', err, re.I): return 'unreadable answer'
    return 'other'
newest = {}
for line in lines:
    if line.startswith('dlq='):
        try: d = json.loads(line[4:])
        except ValueError: continue
        sid = str(d.get('sourceId') or '')
        if sid and sid not in newest: newest[sid] = d
def ms_of(text):
    # an ISO time in UTC ("2026-10-14T13:55:00.123Z") as epoch ms; 0 if none
    try: return calendar.timegm(time.strptime(text[:19], '%Y-%m-%dT%H:%M:%S')) * 1000
    except (TypeError, ValueError): return 0
tracked, failing, stale, feeds, members = 0, [], 0, [], set()
for line in lines:
    if line.startswith('tracked='):
        tracked = num(line[8:])
    elif line.startswith('member='):
        members.add(line[7:])
    elif line.startswith('cb='):
        sid, failures, open_until, open_count, failed_at, name, slug, last_seen = (line[3:].split('\t') + [''] * 8)[:8]
        if num(failures) < 1 or sid in off: continue
        until = num(open_until)
        if until <= now_ms and now_ms - ms_of(failed_at) > 48 * 3600 * 1000:
            stale += 1
            continue
        d = newest.get(sid) or {}
        failing.append({
            'name': (name or str(d.get('sourceName') or '') or sid)[:80],
            'slug': (slug or sid)[:60],
            'failures': num(failures),
            'paused_until': iso(until) if until > now_ms else None,
            'times_paused': num(open_count),
            'last_failed': failed_at[:24] or None,
            'last_worked': last_seen or None,
            'why': why(str(d.get('error') or '')),
        })
    elif line.startswith('feed='):
        fid, fails, paused = (line[5:].split('\t') + [''] * 3)[:3]
        if num(fails) >= 1:
            feeds.append({'id': fid[:60], 'fails': num(fails), 'paused': paused.strip() == '1'})
failing.sort(key=lambda s: (-s['failures'], s['name'].lower()))
feeds.sort(key=lambda f: (-f['fails'], f['id']))
if members:
    tracked = len(members - off)
print(json.dumps({'tracked': tracked, 'failing': len(failing),
                  'paused': sum(1 for s in failing if s['paused_until']),
                  'stale': stale, 'switched_off': len(off), 'list': failing[:40],
                  'news_feeds': {'failing': len(feeds), 'paused': sum(1 for f in feeds if f['paused']),
                                 'list': feeds[:40]}}, separators=(',', ':')))
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
  printf '"sources":%s,' "$(source_stats)"
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
   || ! grep -q '"switched_off":' "$pipe_cache" 2>/dev/null; then
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
