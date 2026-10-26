#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  WorldPulse — end database queries whose program is gone (Oct 26, 2026)
#
#  A query keeps running in Postgres after the program that sent it has
#  stopped waiting, and even after its container has been replaced: the
#  database only notices when it has an answer to send. The scraper's queries
#  had no time limit until Oct 26 (apps/scraper/src/lib/postgres.ts), so every
#  deploy or crash could leave some running for hours. That afternoon the
#  server read a load of 54 on 2 CPUs with about 50 queries running at once.
#
#  Ends (pg_terminate_backend) two kinds of client connection:
#   - opened before the running container at its address started: its program
#     is gone (Docker often gives a recreated container the same address);
#   - from an address no running container has, running or in a transaction
#     for more than ORPHAN_MINUTES (20).
#  Never touched: connections the running containers opened, connections from
#  inside the database container (backups, the status file, maintenance: no
#  address) and autovacuum. Prints one line: how many were ended.
#  Run by server-deploy.sh after each deploy and by server-maintenance.sh daily.
# ─────────────────────────────────────────────────────────────────────────────
cd "$(dirname "$0")/.."
MIN=${ORPHAN_MINUTES:-20}
case "$MIN" in ''|*[!0-9]*) MIN=20 ;; esac

# Each running container's addresses on Docker's networks and when it started:
# "address started" lines
started=$(timeout 15 docker inspect -f '{{.State.StartedAt}}|{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' \
            $(docker ps -q 2>/dev/null) 2>/dev/null \
          | while IFS='|' read -r at addrs; do
              for a in $addrs; do echo "$a $at"; done
            done | grep -E '^[0-9]+(\.[0-9]+){3} [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' | sort -u)
if [ -z "$started" ]; then
  echo "db-orphans: no container addresses found, nothing ended"
  exit 0
fi
values=$(echo "$started" | while read -r a at; do printf "('%s', '%s'::timestamptz)," "$a" "$at"; done)
values=${values%,}

q="WITH live(addr, started) AS (VALUES $values)
   SELECT count(*) FROM (
     SELECT pg_terminate_backend(a.pid) AS ended
       FROM pg_stat_activity a
      WHERE a.datname = current_database()
        AND a.backend_type = 'client backend'
        AND a.client_addr IS NOT NULL
        AND a.pid <> pg_backend_pid()
        AND (
          EXISTS (SELECT 1 FROM live WHERE live.addr = host(a.client_addr)
                                       AND a.backend_start < live.started - interval '5 seconds')
          OR (NOT EXISTS (SELECT 1 FROM live WHERE live.addr = host(a.client_addr))
              AND a.state IN ('active', 'idle in transaction')
              AND coalesce(a.query_start, a.xact_start) < now() - interval '$MIN minutes'))) t
   WHERE ended"
n=$(timeout 30 docker exec wp_postgres sh -c \
      'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq -c "SET statement_timeout = 10000" -c "$1"' sh "$q" \
      2>/dev/null | tr -cd '0-9')
echo "db-orphans: ended ${n:-0} database connections left behind by programs that are gone"
