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
      echo "second=$(redis-cli --raw HGETALL "ai:second:counts:$1" | paste -sd " " -)"
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
# The second read of high and critical reports few outlets carry (plan 11,
# pipeline/second-read.ts): today's verdicts (read, agree, lower, higher, not_event, unread)
words = vals.get('second', '').split()
second = {words[i]: int(words[i + 1]) for i in range(0, len(words) - 1, 2) if words[i + 1].isdigit()}
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
    'second_read_today': second,
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
        printf "feed=%s\t%s\t%s\t%s\n" "$id" "$(redis-cli --raw GET "$k")" "$(redis-cli --raw EXISTS "news-rss:pause:$id")" \
          "$(redis-cli --raw GET "news-rss:why:$id")"
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
        fid, fails, paused, why = (line[5:].split('\t') + [''] * 4)[:4]
        if num(fails) >= 1:
            # why: the scraper's fixed phrase for the newest failure (news-rss.ts feedFailureWhy, Oct 17, 2026)
            why = re.sub(r'[^a-z0-9 ()]', '', why.strip().lower())[:40] or None
            feeds.append({'id': fid[:60], 'fails': num(fails), 'paused': paused.strip() == '1', 'why': why})
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
# In-house text fingerprints (apps/scraper/src/pipeline/fingerprints.ts): how
# many of the last 24 hours' reports have one, how far back the archive is
# done, and the backfill's last run as the scraper recorded it (counts and a
# short error only)
# GDELT's file list as the second-outlet reader last read it (plan N3, Oct 24,
# 2026): files read per UTC hour over 24 hours, and the last cycle's time and its
# missing or failed files, from the public API (counts and file names only)
gdelt_stats() {
  timeout 35 curl -s --max-time 30 --resolve "api.world-pulse.io:443:127.0.0.1" -A "WorldPulse-Status/1.0" \
       "https://api.world-pulse.io/api/v1/public/second-outlets" 2>/dev/null \
    | python3 -c '
import json, sys
d = json.load(sys.stdin)
d = d.get("data", d) if isinstance(d, dict) else {}
p = d.get("pulse") or {}
c = d.get("last_cycle") or {}
print(json.dumps({"last_24h": p.get("last_24h") or {},
                  "last_cycle": {k: c.get(k) for k in ("at", "newest", "missing", "failed")}}, separators=(",", ":")))' 2>/dev/null \
    || printf 'null'
}
fingerprint_stats() {
  local q db pw run
  q="SELECT json_build_object(
        'last_24h', (SELECT count(*) FROM signal_fingerprints WHERE created_at > now() - interval '24 hours'),
        'total',    (SELECT count(*) FROM signal_fingerprints),
        'oldest',   (SELECT min(created_at) FROM signal_fingerprints))"
  db=$(timeout 20 docker exec wp_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq -c "$1"' sh "$q" 2>/dev/null \
       | tr -d '\r' | grep '^{' | head -n 1) || db=""
  pw=$(redis_pw)
  run=$(timeout 10 docker exec -e REDISCLI_AUTH="$pw" wp_redis redis-cli --raw GET fingerprints:stats 2>/dev/null | head -c 4000) || run=""
  python3 - "$db" "$run" <<'PY' 2>/dev/null || printf 'null'
import json, sys
def load(s):
    try:
        return json.loads(s) if s.strip() else None
    except Exception:
        return None
db, run = load(sys.argv[1]), load(sys.argv[2])
out = dict(db or {})
if run:
    ms = run.get('model_status') or {}
    out['last_run'] = {k: run.get(k) for k in ('at', 'recent', 'older', 'history_done', 'ms')}
    out['model_ready'] = bool(ms.get('ready'))
    err = run.get('error') or ms.get('error')
    out['error'] = str(err)[:120] if err else None
print(json.dumps(out, separators=(',', ':')))
PY
}
# One database query in its own psql call, with its own time limit in seconds,
# which the database keeps too (statement_timeout): the JSON line it printed,
# else null. Oct 21, 2026: the four queries shared one psql call and 25
# seconds; from 16:00 UTC only the first one's answer came back, and when the
# client was stopped the query ran on in the database
db_json() {
  local out
  out=$(timeout $(( $1 + 5 )) docker exec wp_postgres sh -c \
        'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq -c "SET statement_timeout = $1" -c "$2"' \
        sh "$(( $1 * 1000 ))" "$2" 2>/dev/null | tr -d '\r' | grep '^{' | head -n 1) || out=""
  printf '%s' "${out:-null}"
}
# The scraper's log lines from the last 30 minutes ($scr), counted by level
scraper_stats() {
  local errs warns created top topw
  errs=$(grep -c '"level":[56]0' <<< "$scr") || true
  warns=$(grep -c '"level":40' <<< "$scr") || true
  created=$(grep -c '"msg":"Signal created"' <<< "$scr") || true
  top=$(grep '"level":[56]0' <<< "$scr" | top_msgs)
  topw=$(grep '"level":40' <<< "$scr" | top_msgs)
  printf '{"errors":%d,"warnings":%d,"signals_created":%d,"top_errors":[%s],"top_warnings":[%s]}' \
    "${errs:-0}" "${warns:-0}" "${created:-0}" "$top" "$topw"
}
# Requests the API turned away as too many (429), today and yesterday (UTC),
# by route (plan D3, Oct 21, 2026: the API counts each one in Redis,
# api:429:<day>, a hash of "<METHOD> <route>" → count, and "total";
# apps/api/src/lib/refusals.ts). nginx's own refusals never reach the API and
# aren't in it. Counts only: no addresses.
api_limit_stats() {
  local pw out
  pw=$(redis_pw) || pw=""
  out=$(timeout 10 docker exec -e REDISCLI_AUTH="$pw" wp_redis sh -c '
      echo "today=$(redis-cli --raw HGETALL "api:429:$1" | paste -sd "\t" -)"
      echo "yesterday=$(redis-cli --raw HGETALL "api:429:$2" | paste -sd "\t" -)"' \
      sh "$(date -u +%F)" "$(date -u -d yesterday +%F)" 2>/dev/null) || out=""
  OUT="$out" python3 - <<'PY' 2>/dev/null || printf 'null'
import json, os
vals = dict(line.split('=', 1) for line in os.environ.get('OUT', '').splitlines() if '=' in line)
def day(text):
    words = text.split('\t') if text else []
    counts = {}
    for field, n in zip(words[0::2], words[1::2]):
        try: counts[field] = int(n)
        except ValueError: pass
    total = counts.pop('total', sum(counts.values()))
    routes = dict(sorted(counts.items(), key=lambda kv: -kv[1])[:10])
    return {'total': total, 'routes': routes}
print(json.dumps({'today': day(vals.get('today', '')), 'yesterday': day(vals.get('yesterday', ''))}, separators=(',', ':')))
PY
}
# Run one part of the pipeline block into $parts/<name>.json and note how long
# it took, in ms
part() {
  local name=$1 t0
  shift
  t0=$(date +%s%3N)
  "$@" > "$parts/$name.json" 2>/dev/null
  echo "$name $(( $(date +%s%3N) - t0 ))" >> "$parts/took"
}
pipeline_stats() {
  local q1 q2 q3 q4 q5 scr parts checked t0
  checked=$(date -Is)
  parts=$(mktemp -d) || return 1
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
  # Verified stories a day (HQ's headline number, Devon Oct 17): a story counts
  # once, on the UTC day its first report reached verified, however many outlets
  # carry it; the last 14 days and the last 24 hours
  q3="WITH s AS (
          SELECT min(coalesce(verified_at, created_at)) AS first_at
            FROM signals WHERE status = 'verified'
           GROUP BY coalesce(story_id, id))
      SELECT json_build_object(
        'stories_verified_24h', (SELECT count(*) FROM s WHERE first_at > now() - interval '24 hours'),
        'stories_verified_days', (
          SELECT json_agg(json_build_object('day', d, 'stories', n) ORDER BY d)
            FROM (SELECT to_char(first_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*) AS n
                    FROM s
                   WHERE first_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '13 days') AT TIME ZONE 'UTC'
                   GROUP BY 1) t))"
  # Reports 3 or more readers flagged in the last 30 days (plan C5, Oct 21,
  # 2026): how long Devon's review list on /admin is. A count, no titles
  q4="SELECT json_build_object('flagged_for_review', (
        SELECT count(*) FROM (SELECT signal_id FROM signal_flags
                               WHERE created_at > now() - interval '30 days'
                               GROUP BY signal_id HAVING count(*) >= 3) t))"
  # Posts and communities 3 or more readers reported in the last 30 days (plan
  # C6, Oct 21, 2026): how long the second review list on /admin is. A count
  q5="SELECT json_build_object('reported_for_review', (
        SELECT count(*) FROM (SELECT target_type, target_id FROM content_reports
                               WHERE created_at > now() - interval '30 days'
                               GROUP BY target_type, target_id HAVING count(*) >= 3) t))"
  # db is these five answers in this order, each null when it failed or ran out
  # of time (scripts/autopilot_hq.py reads the first two)
  part db1 db_json 45 "$q1"
  part db2 db_json 20 "$q2"
  part db3 db_json 30 "$q3"
  part db4 db_json 10 "$q4"
  part db5 db_json 10 "$q5"
  # Data health (plan N3, Oct 24, 2026): reports in the last 6 hours against the
  # same 6 hours a week ago (scripts/data_health.py reads it against the clock)
  q6="SELECT json_build_object(
        'last_6h',     count(*) FILTER (WHERE created_at > now() - interval '6 hours'),
        'week_ago_6h', count(*) FILTER (WHERE created_at <= now() - interval '168 hours'))
      FROM signals WHERE created_at > now() - interval '174 hours'
        AND (created_at > now() - interval '6 hours' OR created_at <= now() - interval '168 hours')"
  part report_rate db_json 20 "$q6"
  # Members (plan LR9; Devon, Oct 29, 10:47 PM: yes, counts only): people with
  # an account (signed up with an email; not WorldPulse's own bot, AI or admin
  # accounts), email briefing subscribers (confirmed from their inbox, and the
  # ones still to confirm) and Pro members (paying or on trial). Counts, never
  # a name or an address; it goes under readers as "members"
  q7="SELECT json_build_object(
        'accounts',    count(*),
        'accounts_7d', count(*) FILTER (WHERE created_at > now() - interval '7 days'),
        'subscribers', (SELECT count(*) FROM digest_subscriptions WHERE is_active AND confirmed_at IS NOT NULL),
        'subscribers_7d', (SELECT count(*) FROM digest_subscriptions WHERE is_active AND confirmed_at > now() - interval '7 days'),
        'subscribers_unconfirmed', (SELECT count(*) FROM digest_subscriptions WHERE is_active AND confirmed_at IS NULL),
        'pro', (SELECT count(*) FROM subscriptions WHERE plan = 'pro' AND status IN ('active', 'trialing')))
      FROM users WHERE email IS NOT NULL AND account_type NOT IN ('ai', 'bot', 'admin')"
  part members db_json 10 "$q7"
  # ... and GDELT's file list as the second-outlet reader last read it: files per
  # hour for 24 hours and the last cycle's missing and failed files (counts only)
  part gdelt gdelt_stats
  # Scraper log lines from the last 30 minutes, counted by level; the most
  # frequent error and warning messages, digits blanked out (our own log text only)
  t0=$(date +%s%3N)
  scr=$(timeout 25 docker logs --since 30m wp_scraper 2>&1 | tail -n 50000) || scr=""
  echo "scraper_logs $(( $(date +%s%3N) - t0 ))" >> "$parts/took"
  part scraper_30m scraper_stats
  part llm llm_stats "$scr"
  part fingerprints fingerprint_stats
  part claude claude_stats
  part sources source_stats
  part api_limits api_limit_stats
  part disk disk_stats
  # Readers of world-pulse.io today and where they came from (plan G1): counts
  # only, from nginx's log; scripts/readers.py says how (no addresses kept)
  part readers timeout 90 python3 scripts/readers.py logs/readers-state.json
  # Put together in Python (Oct 21, 2026): a part that printed nothing or
  # something that isn't JSON is null, and is named in "failed", instead of
  # making the whole block unreadable (which kept the last one, unchanged, for
  # 40 minutes); took_ms says how long each part took
  python3 - "$parts" "$checked" <<'PY'
import json, os, sys
parts, checked = sys.argv[1], sys.argv[2]
failed = []
def part(name):
    try:
        with open(os.path.join(parts, name + '.json'), encoding='utf-8') as fh:
            value = json.loads(fh.read())
    except (OSError, ValueError):
        value = None
    if value is None:
        failed.append(name)
    return value
out = {'window': '24h', 'checked': checked}
out['db'] = [v if isinstance(v, dict) else None for v in (part('db%d' % i) for i in range(1, 6))]
for name in ('scraper_30m', 'llm', 'fingerprints', 'claude', 'sources', 'api_limits', 'disk', 'readers', 'report_rate', 'gdelt'):
    out[name] = part(name)
# Members: in the pipeline block, and with the readers too (the HQ copies the readers block
# whole); null when the query failed
out['members'] = part('members')
if isinstance(out.get('readers'), dict):
    out['readers']['members'] = out['members']
took = {}
try:
    with open(os.path.join(parts, 'took')) as fh:
        for line in fh:
            name, ms = line.split()
            took[name] = int(ms)
except (OSError, ValueError):
    pass
out['took_ms'] = took
out['failed'] = failed
print(json.dumps(out, separators=(',', ':')))
PY
  rm -f "$parts"/*.json "$parts/took"
  rmdir "$parts" 2>/dev/null || true
}
# The server's load (Oct 26, 2026): in the afternoon the database was slow (the
# 30-minute counts took 22-33 s, /health 6 s, two pages crossed the 5-second
# limit) and nothing in this file said why. Load averages, memory, each
# container's CPU and memory, and the database's connections by state with the
# age of its longest running query and transaction, and for the three longest
# queries where they come from and what they wait on: numbers and names only,
# no query text (this file is public). Every 5 minutes; a part that fails is null.
server_load() {
  local stats act act2 ips
  stats=$(timeout 20 docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}' 2>/dev/null | grep '^wp_') || stats=""
  act=$(timeout 15 docker exec wp_postgres sh -c \
        'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq -c "SET statement_timeout = 5000" -c "$1"' sh \
        "SELECT json_build_object(
           'by_state', (SELECT json_object_agg(st, n) FROM (SELECT coalesce(state, 'none') AS st, count(*) AS n
                          FROM pg_stat_activity WHERE datname = current_database() GROUP BY 1) t),
           'waiting_on_locks', (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'),
           'longest_active_s', (SELECT coalesce(round(extract(epoch FROM max(now() - query_start)))::int, 0)
                                  FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' AND pid <> pg_backend_pid()),
           'longest_open_transaction_s', (SELECT coalesce(round(extract(epoch FROM max(now() - xact_start)))::int, 0)
                                  FROM pg_stat_activity WHERE datname = current_database() AND xact_start IS NOT NULL AND pid <> pg_backend_pid()))" \
        2>/dev/null | tr -d '\r' | grep '^{' | head -n 1) || act=""
  # The three longest running queries, in their own query so a failure here keeps the counts above
  # (jsonb: json_agg puts a line break between items, and only the first line is read)
  act2=$(timeout 15 docker exec wp_postgres sh -c \
        'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq -c "SET statement_timeout = 5000" -c "$1"' sh \
        "SELECT jsonb_build_object('longest', (SELECT jsonb_agg(t) FROM (
              SELECT backend_type AS kind, host(client_addr) AS ip,
                     coalesce(wait_event_type || ':' || wait_event, 'cpu') AS waiting_on,
                     round(extract(epoch FROM now() - query_start))::int AS running_s,
                     upper(split_part(btrim(regexp_replace(query, '\s+', ' ', 'g')), ' ', 1)) AS verb,
                     (SELECT string_agg(DISTINCT lower((r.m)[1]), ',')
                        FROM regexp_matches(query, '(?:from|join|into|update|vacuum(?: analyze)?|analyze)\s+(?:only\s+)?\"?(?:public\.)?\"?([a-z_][a-z0-9_]*)', 'gi') AS r(m)) AS tables
                FROM pg_stat_activity
               WHERE datname = current_database() AND state = 'active' AND pid <> pg_backend_pid()
               ORDER BY query_start ASC LIMIT 3) t))" \
        2>/dev/null | tr -d '\r' | grep '^{' | head -n 1) || act2=""
  # Which container each of those connections comes from (its address on Docker's network)
  ips=$(timeout 10 docker inspect -f '{{.Name}}|{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' $(docker ps -q 2>/dev/null) 2>/dev/null) || ips=""
  # Each container's full id, to find its memory group (its swap, below)
  ids=$(timeout 10 docker ps --no-trunc --format '{{.Names}}|{{.ID}}' 2>/dev/null) || ids=""
  STATS="$stats" ACT="$act" ACT2="$act2" IPS="$ips" IDS="$ids" python3 - <<'PY'
import json, os
def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None
out = {}
try:
    l1, l5, l15 = open('/proc/loadavg').read().split()[:3]
    out['load'] = {'1m': num(l1), '5m': num(l5), '15m': num(l15)}
except OSError:
    out['load'] = None
out['cpus'] = os.cpu_count()
try:
    mi = {}
    for line in open('/proc/meminfo'):
        k, v = line.split(':', 1)
        mi[k] = int(v.split()[0])   # kB
    out['memory_mb'] = {'total': mi['MemTotal'] // 1024, 'available': mi['MemAvailable'] // 1024,
                        'swap_used': (mi.get('SwapTotal', 0) - mi.get('SwapFree', 0)) // 1024}
except (OSError, KeyError, ValueError):
    out['memory_mb'] = None
cont = {}
for line in os.environ.get('STATS', '').splitlines():
    parts = line.split('|')
    if len(parts) == 3:
        cont[parts[0]] = {'cpu_pct': num(parts[1].strip().rstrip('%')), 'mem': parts[2].split('/')[0].strip()}
# Swap (Oct 29, 2026): docker stats leaves it out. On Oct 28 the 4 GB swap was
# full and 130 MB of memory free, while the containers' figures above added up
# to 2.3 GB: what the server had pushed out to disk, and whose it was, showed
# nowhere. Each container's from its memory group (cgroup v2, or v1), in MB;
# then the processes holding the most, with the container each runs in ("host"
# for the server's own). Process names only, never their command lines.
import re
CG = os.environ.get('CGROUP_ROOT') or '/sys/fs/cgroup'
PROC = os.environ.get('PROC_ROOT') or '/proc'
def read_int(path):
    try:
        return int(open(path).read().split()[0])
    except (OSError, ValueError, IndexError):
        return None
def swap_bytes(cid):
    for d in (f'{CG}/system.slice/docker-{cid}.scope', f'{CG}/docker/{cid}'):
        if os.path.isfile(d + '/memory.swap.current'):
            return read_int(d + '/memory.swap.current')
    for d in (f'{CG}/memory/docker/{cid}', f'{CG}/memory/system.slice/docker-{cid}.scope'):
        both, ram = read_int(d + '/memory.memsw.usage_in_bytes'), read_int(d + '/memory.usage_in_bytes')
        if both is not None and ram is not None:
            return max(0, both - ram)
    return None
ids = {}
for line in os.environ.get('IDS', '').splitlines():
    name, _, cid = line.partition('|')
    if re.fullmatch(r'[0-9a-f]{64}', cid.strip()):
        ids[cid.strip()] = name.strip()
for cid, name in ids.items():
    sw = swap_bytes(cid)
    if sw is not None and name in cont:
        cont[name]['swap_mb'] = sw // 1048576
holders = []
try:
    pids = [p for p in os.listdir(PROC) if p.isdigit()]
except OSError:
    pids = []
for pid in pids:
    try:
        status = open(f'{PROC}/{pid}/status').read()
    except OSError:
        continue
    pname = re.search(r'^Name:\s*(.*)$', status, re.M)
    vm = re.search(r'^VmSwap:\s*(\d+)\s*kB', status, re.M)
    if not vm or int(vm.group(1)) < 1024:
        continue
    where = 'host'
    try:
        m = re.search(r'docker-([0-9a-f]{64})\.scope|/docker/([0-9a-f]{64})', open(f'{PROC}/{pid}/cgroup').read())
        if m:
            where = ids.get(m.group(1) or m.group(2), 'another container')
    except OSError:
        pass
    holders.append((int(vm.group(1)), (pname.group(1).strip() if pname else '?')[:32], where))
holders.sort(reverse=True)
out['swap_top'] = [{'process': n, 'in': w, 'swap_mb': kb // 1024} for kb, n, w in holders[:8]] or None
out['containers'] = cont or None
try:
    out['database'] = json.loads(os.environ.get('ACT') or 'null')
except ValueError:
    out['database'] = None
# The longest running queries: what kind (a client or autovacuum), from which
# container, what they wait on, how long, the statement's first word and the
# tables it names. Never its text or values; the network address is dropped
by_ip = {}
for line in os.environ.get('IPS', '').splitlines():
    name, _, addrs = line.partition('|')
    for a in addrs.split():
        by_ip[a] = name.lstrip('/')
db = out.get('database')
try:
    longest = (json.loads(os.environ.get('ACT2') or 'null') or {}).get('longest')
except (ValueError, AttributeError):
    longest = None
if isinstance(db, dict):
    db['longest'] = longest if isinstance(longest, list) else None
if isinstance(db, dict) and isinstance(db.get('longest'), list):
    for q in db['longest']:
        if isinstance(q, dict):
            ip = q.pop('ip', None)
            q['from'] = by_ip.get(ip, 'another address') if ip else 'inside the database'
print(json.dumps(out, separators=(',', ':')))
PY
}
# The scraper's own memory (Oct 29, 2026): it grows after each restart (about
# 900 MB two hours after the 9:06 AM one; on Oct 28 it ran 18 hours and the
# server's memory and swap filled). From its heartbeat (scraper:process, every
# 30 s) and its 5-minute samples (scraper:memory:history, apps/scraper/src/lib/
# process-health.ts): when it started, its heap (used, total, limit), what it
# holds outside the heap, and, over the samples since that start, how fast
# each grows in MB an hour. Numbers only.
scraper_process() {
  local pw out
  pw=$(redis_pw) || pw=""
  out=$(timeout 15 docker exec -e REDISCLI_AUTH="$pw" wp_redis sh -c '
      redis-cli --raw HGETALL scraper:process | sed "s/^/h=/"
      redis-cli --raw LRANGE scraper:memory:history 0 47 | sed "s/^/m=/"' 2>/dev/null) || out=""
  OUT="$out" python3 - <<'PY' 2>/dev/null || printf 'null'
import json, os, datetime as dt
h, samples = [], []
for line in os.environ.get('OUT', '').splitlines():
    kind, _, val = line.partition('=')
    if kind == 'h': h.append(val)
    elif kind == 'm':
        try: samples.append(json.loads(val))
        except ValueError: pass
proc = dict(zip(h[0::2], h[1::2]))
if not proc:
    print('null'); raise SystemExit
def num(v):
    try: return int(float(v))
    except (TypeError, ValueError): return None
def when(s):
    try: return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except ValueError: return None
started = proc.get('started_at')
out = {'started_at': started, 'last_heartbeat': proc.get('last_heartbeat')}
t0 = when(started)
if t0: out['uptime_h'] = round((dt.datetime.now(dt.timezone.utc) - t0).total_seconds() / 3600, 1)
for k in ('rss_mb', 'heap_used_mb', 'heap_total_mb', 'external_mb', 'array_buffers_mb', 'heap_limit_mb'):
    out[k] = num(proc.get(k))
mine = sorted((s for s in samples if s.get('started') == started and when(s.get('at'))), key=lambda s: s['at'])
if len(mine) >= 2:
    a, b = mine[0], mine[-1]
    hours = (when(b['at']) - when(a['at'])).total_seconds() / 3600
    if hours >= 0.5:
        out['growth_mb_per_h'] = {k.replace('_mb', ''): round((b.get(k, 0) - a.get(k, 0)) / hours)
                                  for k in ('heap_used_mb', 'heap_total_mb', 'external_mb', 'rss_mb')}
        out['growth_over_h'] = round(hours, 1)
print(json.dumps(out, separators=(',', ':')))
PY
}
# Password-guessing bots shut out of SSH (scripts/ssh-guard.sh, plan LR11, Oct
# 30, 2026): whether fail2ban's sshd jail is on, the failed sign-ins it has
# counted and the addresses shut out now and since it started. Counts only,
# never an address. null before the guard is set up.
ssh_guard() {
  local out setup
  setup=$(python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1])), separators=(",", ":")))' logs/ssh-guard.status 2>/dev/null) || setup=null
  if ! command -v fail2ban-client > /dev/null 2>&1; then
    [ "$setup" = null ] && { printf 'null'; return; }
    printf '{"on":false,"setup":%s}' "$setup"; return
  fi
  out=$(timeout 10 fail2ban-client status sshd 2>/dev/null) || { printf '{"on":false,"setup":%s}' "$setup"; return; }
  n() { printf '%s\n' "$out" | sed -n "s/.*$1:[[:space:]]*\([0-9][0-9]*\).*/\1/p" | head -n 1; }
  printf '{"on":true,"failed_now":%s,"failed_total":%s,"shut_out_now":%s,"shut_out_total":%s,"setup":%s}' \
    "$(n 'Currently failed')" "$(n 'Total failed')" "$(n 'Currently banned')" "$(n 'Total banned')" "$setup" \
    | sed 's/:,/:null,/g'
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
# Refresh every 30 minutes, or straight away when the cache predates a new field.
# One refresh at a time, each in its own file (Oct 21, 2026): while a deploy
# builds, a refresh can outlast the 5 minutes to the next run, and two runs
# writing the same file left neither readable
if [ ! -s "$pipe_cache" ] || [ -n "$(find "$pipe_cache" -mmin +29 2>/dev/null)" ] \
   || ! grep -q '"members":' "$pipe_cache" 2>/dev/null; then
  (
    flock -n 9 || exit 0
    tmp="$pipe_cache.$$.tmp"
    pipeline_stats > "$tmp" 2>/dev/null \
      && python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$tmp" 2>/dev/null \
      && mv "$tmp" "$pipe_cache"
    rm -f "$tmp"
  ) 9> logs/pipeline-stats.lock
fi
pipeline=$(cat "$pipe_cache" 2>/dev/null || true)
[ -n "$pipeline" ] || pipeline=null
sproc=$(scraper_process 2>/dev/null | grep -E '^(\{|null)' | head -n 1)
# (only when it reads as JSON: a broken block never breaks the file)
sguard=$(ssh_guard 2>/dev/null | head -n 1)
printf '%s' "$sguard" | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null || sguard=null
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
  # The database's last copy and restore test (scripts/db-backup.sh, plan LR8); null before the first
  printf '"backup":%s,' "$(python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1])), separators=(",", ":")))' logs/backup-status.json 2>/dev/null || echo null)"
  printf '"containers":{%s},' "$containers"
  printf '"server":%s,' "$(server_load 2>/dev/null | grep '^{' || echo null)"
  printf '"scraper_process":%s,' "${sproc:-null}"
  printf '"ssh_guard":%s,' "${sguard:-null}"
  printf '"pipeline":%s}\n' "$pipeline"
} > "logs/public/status.json.$$.tmp" \
  && { python3 scripts/data_health.py "logs/public/status.json.$$.tmp" 2> logs/data-health.err || true; } \
  && mv "logs/public/status.json.$$.tmp" logs/public/status.json
# (data_health: plan N3. It adds "data_health" to the file, ok / warn / alarm per
# check with one plain line; if it fails, the file goes out without it.)
