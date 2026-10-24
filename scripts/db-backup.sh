#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
#  WorldPulse — the database's nightly copy, checked (runs ON the server)
#
#  Plan LR8 (item 8 of the pre-launch list Devon approved on Oct 23, 2026).
#  Until then no script anywhere copied the database (4.5 GB on Oct 23).
#  A daily cron at 09:10 UTC (5:10 AM New York in summer time, 4:10 AM in
#  winter), installed by scripts/server-deploy.sh and
#  scripts/server-maintenance.sh; safe to run by hand:
#      cd /opt/worldpulse && bash scripts/db-backup.sh [--restore-test]
#
#    1. when the disk has room: pg_dump of the whole database (custom
#       format, compressed) into backups/db-<UTC date>.dump, through a
#       .part file
#    2. checks the copy: pg_restore can read its table of contents; a copy
#       under half the size of the previous one is kept, and said
#    3. keeps the newest 3 copies
#    4. on Sundays, or with --restore-test: loads the newest copy's tables
#       and rows into a throwaway Postgres container (the same image, no
#       network, at most one CPU and 768 MB, removed with its storage when
#       done) and compares the counts with the live database: the proof a
#       copy can be brought back. Indexes aren't rebuilt in the test (a real
#       restore rebuilds them from the same copy).
#    5. writes logs/backup-status.json, which /ops-status.json shows
#
#  The copies stay on this server. A copy off it comes from DigitalOcean's
#  backups of the whole server (Devon switches them on), which include
#  backups/.
# ──────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups logs
exec 8>/var/lock/worldpulse-db-backup.lock
flock -n 8 || { echo "A database copy is already being made — exiting."; exit 0; }

STATUS=logs/backup-status.json
KEEP=3
MARGIN_MB=8192   # the disk keeps at least this much free beyond what a copy or a test needs
# How long the copy may take, and how long it may wait for a table it has to
# lock. The first nightly copy (Oct 24, 2026) was stopped by a one-hour limit
# with nothing said: 4.5 GB, mostly embeddings that hardly compress, at gzip
# level 6 on a server busy with the scraper. It now compresses at level 1 (a
# few times faster, a slightly bigger file) and may take 3 hours (done by
# 8:10 AM New York); a table it can't lock within 15 minutes stops it with the
# table's name, instead of a silent wait.
DUMP_LIMIT=${DB_DUMP_LIMIT:-10800}
LOCK_WAIT_MS=900000
log() { echo "[db-backup $(date '+%H:%M:%S')] $*"; }
free_mb() { df -Pm "$1" 2>/dev/null | awk 'NR == 2 { print $4 }'; }
psql_live() {  # psql_live <query>: one value from the live database
  timeout 120 docker exec wp_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq -c "$1"' sh "$1" 2>/dev/null | tr -d '[:space:]'
}
# write_status <ok> <note>: the day's result for /ops-status.json (no secrets: names, sizes, counts, times)
write_status() {
  OK="$1" NOTE="$2" FILE="${file:-}" SIZE="${size_mb:-}" SECS="${dump_secs:-}" SIGNALS="${live_signals:-}" \
  KEPT="$(ls -1 backups/db-*.dump 2>/dev/null | xargs -r -n1 basename | tr '\n' ' ')" \
  RT_FILE="$restore_json" STATUS="$STATUS" python3 - <<'PY'
import json, os, time
def num(v):
    try: return float(v) if '.' in v else int(v)
    except (TypeError, ValueError): return None
prev = {}
try: prev = json.load(open(os.environ['STATUS']))
except Exception: pass
out = {
    'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'ok': os.environ['OK'] == 'true',
    'note': os.environ['NOTE'][:240],
    'file': os.environ['FILE'] or None,
    'size_mb': num(os.environ['SIZE']),
    'dump_seconds': num(os.environ['SECS']),
    'live_signals': num(os.environ['SIGNALS']),
    'kept': os.environ['KEPT'].split(),
    'off_server': 'DigitalOcean backups of the whole server, if switched on (they include backups/)',
}
rt = None
try: rt = json.load(open(os.environ['RT_FILE'])) if os.environ['RT_FILE'] else None
except Exception: rt = None
out['restore_test'] = rt or prev.get('restore_test')   # the last test's result until the next one
tmp = os.environ['STATUS'] + '.tmp'
json.dump(out, open(tmp, 'w'), separators=(',', ':'))
os.replace(tmp, os.environ['STATUS'])
PY
}

restore_json=""
day=$(date -u +%Y-%m-%d)
file="backups/db-$day.dump"
if ! docker inspect -f '{{.State.Running}}' wp_postgres 2>/dev/null | grep -q true; then
  write_status false "the database container isn't running: no copy made"
  log "wp_postgres isn't running — no copy made"; exit 1
fi
live_signals=$(psql_live "SELECT count(*) FROM signals")
# A time limit only cuts docker's link to pg_dump: the dump in the container runs
# on, holding its snapshot of the database, until its session is ended. One an
# earlier run left behind is ended first (this run holds the lock, so it isn't ours).
stop_dumps() { psql_live "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE application_name = 'pg_dump' AND pid <> pg_backend_pid()"; }
left=$(stop_dumps)
[ -n "$left" ] && [ "$left" != "0" ] && log "Ended $left pg_dump session(s) an earlier run left running"

# ── 1. The copy ───────────────────────────────────────────────────────────────
prev=$(ls -1t backups/db-*.dump 2>/dev/null | grep -v "^$file$" | head -n 1)
prev_mb=0
[ -n "$prev" ] && prev_mb=$(( $(stat -c %s "$prev") / 1048576 ))
need_mb=$(( 2 * prev_mb + MARGIN_MB ))
have_mb=$(free_mb backups)
if [ -z "$have_mb" ] || [ "$have_mb" -lt "$need_mb" ]; then
  write_status false "not enough disk for a copy: ${have_mb:-?} MB free, it needs about $need_mb; the older copies are kept"
  log "Not enough disk (${have_mb:-?} MB free, need $need_mb) — no copy made"; exit 1
fi
t0=$(date +%s)
log "Copying the database to $file"
timeout "$DUMP_LIMIT" docker exec wp_postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z 1 --lock-wait-timeout="$1"' sh "$LOCK_WAIT_MS" > "$file.part" 2> logs/db-backup-err.log
rc=$?
if [ "$rc" -ne 0 ]; then
  # How far it got says what went wrong: a few MB is a wait, gigabytes a slow copy
  part_mb=$(( $(stat -c %s "$file.part" 2>/dev/null || echo 0) / 1048576 ))
  rm -f "$file.part"
  if [ "$rc" -eq 124 ]; then
    stopped=$(stop_dumps)
    write_status false "pg_dump didn't finish within $(( DUMP_LIMIT / 60 )) minutes ($part_mb MB written; ${stopped:-?} session(s) in the database ended); the older copies are kept"
  else
    write_status false "pg_dump failed (exit $rc, $part_mb MB written): $(tail -n 1 logs/db-backup-err.log | tr -d '"\\' | cut -c1-160)"
  fi
  log "pg_dump failed (exit $rc, $part_mb MB written)"; exit 1
fi
dump_secs=$(( $(date +%s) - t0 ))
size_b=$(stat -c %s "$file.part")
size_mb=$(( size_b / 1048576 ))

# ── 2. Check it ───────────────────────────────────────────────────────────────
if ! docker exec -i wp_postgres pg_restore --list < "$file.part" > /dev/null 2>> logs/db-backup-err.log; then
  rm -f "$file.part"
  write_status false "the new copy can't be read (pg_restore --list failed); the older copies are kept"
  log "The new copy can't be read — kept the older ones"; exit 1
fi
if [ -n "$prev" ] && [ "$size_b" -lt $(( $(stat -c %s "$prev") / 2 )) ]; then
  # Kept, but said: a copy half the size of the last one means something is missing
  note_small="; it is under half the size of $(basename "$prev")"
fi
mv "$file.part" "$file"
log "Copy made: ${size_mb} MB in ${dump_secs} s"

# ── 3. Keep the newest copies ─────────────────────────────────────────────────
ls -1t backups/db-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do rm -f -- "$old"; done

# ── 4. The restore test ───────────────────────────────────────────────────────
if [ "${1:-}" = "--restore-test" ] || [ "$(date -u +%u)" = "7" ]; then
  restore_json=logs/backup-restore-test.json
  rt0=$(date +%s)
  name=wp_restore_test
  restored_signals="" restored_tables="" live_tables="" rt_note=""
  db_mb=$(psql_live "SELECT pg_database_size(current_database()) / 1048576")
  root=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null); root=${root:-/var/lib/docker}
  rt_need=$(( ${db_mb:-0} + size_mb + MARGIN_MB ))
  rt_have=$(free_mb "$root")
  if [ -z "$db_mb" ] || [ -z "$rt_have" ] || [ "$rt_have" -lt "$rt_need" ]; then
    rt_note="skipped: ${rt_have:-?} MB free where Docker keeps its data, the test needs about $rt_need"
  else
    img=$(docker inspect -f '{{.Config.Image}}' wp_postgres 2>/dev/null); img=${img:-worldpulse-postgres:latest}
    docker stop "$name" > /dev/null 2>&1 || true
    pw=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
    # --rm: the container and its storage go when it stops; no network: nothing can reach it.
    # One CPU at a quarter of the usual weight and 768 MB, so the live site comes first;
    # no fsync and no WAL to speak of: nothing in it needs to survive a crash.
    started=yes
    run_err=$(docker run -d --rm --name "$name" --network none --cpus 1 --cpu-shares 256 --memory 768m --memory-swap 768m \
      -e POSTGRES_PASSWORD="$pw" "$img" \
      -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c wal_level=minimal -c max_wal_senders=0 \
      -c shared_buffers=64MB -c maintenance_work_mem=64MB 2>&1 > /dev/null) || started=no
    trap 'docker stop wp_restore_test > /dev/null 2>&1 || true' EXIT
    # The image first starts a temporary server for its setup, then the real
    # one: keep asking for the empty database until the real server makes it
    made=no
    for _ in $(seq 1 60); do
      [ "$started" = yes ] || break
      sleep 3
      docker exec "$name" createdb -U postgres -T template0 restore_check > /dev/null 2>&1 && { made=yes; break; }
    done
    if [ "$started" = no ]; then
      rt_note="the throwaway database couldn't start: $(printf '%s' "$run_err" | tail -n 1 | tr -d '"\\' | cut -c1-120)"
    elif [ "$made" = yes ] && docker cp "$file" "$name:/tmp/copy.dump" > /dev/null 2>&1; then
      # The tables and their rows (pre-data and data); the indexes (post-data) aren't timed here
      timeout 5400 docker exec "$name" pg_restore -U postgres -d restore_check --no-owner --no-privileges \
        --section=pre-data --section=data /tmp/copy.dump > /dev/null 2> logs/db-restore-err.log
      rc=$?
      q() { docker exec "$name" psql -U postgres -d restore_check -tAq -c "$1" 2>/dev/null | tr -d '[:space:]'; }
      restored_signals=$(q "SELECT count(*) FROM signals")
      restored_tables=$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")
      errors=$(grep -ci "error" logs/db-restore-err.log 2>/dev/null); errors=${errors:-0}
      rt_note="tables and rows loaded (indexes not rebuilt in the test); pg_restore exit $rc, $errors error lines"
    else
      rt_note="the throwaway database didn't answer within 3 minutes"
    fi
    docker stop "$name" > /dev/null 2>&1 || true
    trap - EXIT
    live_tables=$(psql_live "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")
  fi
  RT_SECS=$(( $(date +%s) - rt0 )) LIVE_S="$live_signals" REST_S="$restored_signals" LIVE_T="$live_tables" REST_T="$restored_tables" \
  NOTE="$rt_note" FILE="$file" OUT="$restore_json" python3 - <<'PY'
import json, os, time
def n(v):
    try: return int(v)
    except (TypeError, ValueError): return None
ls, rs, lt, rt = (n(os.environ[k]) for k in ('LIVE_S', 'REST_S', 'LIVE_T', 'REST_T'))
# The copy is from a minute or so after the live count: new reports may have
# arrived and old ones been cleared meanwhile, so the two only need to be close
ok = bool(rs and ls and lt and rt) and abs(rs - ls) <= max(ls * 0.02, 100) and rt == lt
json.dump({'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'ok': ok, 'file': os.path.basename(os.environ['FILE']),
           'seconds': n(os.environ['RT_SECS']), 'signals': {'live': ls, 'restored': rs}, 'tables': {'live': lt, 'restored': rt},
           'note': os.environ['NOTE'][:200]}, open(os.environ['OUT'], 'w'), separators=(',', ':'))
PY
  log "Restore test: $(cat "$restore_json")"
fi

write_status true "copy made and readable${note_small:-}"
log "Done"
