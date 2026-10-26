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
#  This ends (pg_terminate_backend) the client queries that have been running
#  for more than ORPHAN_MINUTES (20) from an address that no running container
#  has any more. Queries from running containers, from inside the database
#  container (backups, the status file, maintenance: no address) and
#  autovacuum are never touched. Prints one line: how many were ended.
#  Run by server-deploy.sh after each deploy and by server-maintenance.sh daily.
# ─────────────────────────────────────────────────────────────────────────────
cd "$(dirname "$0")/.."
MIN=${ORPHAN_MINUTES:-20}
case "$MIN" in ''|*[!0-9]*) MIN=20 ;; esac

# Every address a running container has on Docker's networks
addrs=$(timeout 15 docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' \
          $(docker ps -q 2>/dev/null) 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' | sort -u)
if [ -z "$addrs" ]; then
  echo "db-orphans: no container addresses found, nothing ended"
  exit 0
fi
list=$(printf "'%s'," $addrs); list=${list%,}

q="SELECT count(*) FROM (
     SELECT pg_terminate_backend(pid) AS ended
       FROM pg_stat_activity
      WHERE datname = current_database()
        AND backend_type = 'client backend'
        AND state IN ('active', 'idle in transaction')
        AND client_addr IS NOT NULL
        AND host(client_addr) NOT IN ($list)
        AND coalesce(query_start, xact_start) < now() - interval '$MIN minutes'
        AND pid <> pg_backend_pid()) t
   WHERE ended"
n=$(timeout 30 docker exec wp_postgres sh -c \
      'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq -c "SET statement_timeout = 10000" -c "$1"' sh "$q" \
      2>/dev/null | tr -cd '0-9')
echo "db-orphans: ended ${n:-0} queries left running over ${MIN} minutes by programs that are gone"
