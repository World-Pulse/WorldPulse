#!/bin/bash
# Deploy Cortex Subsystems — Event Threads, Embeddings, Pattern Detection
# Run this from your local machine (not the sandbox)

set -e

echo "=== Step 1: Commit & Push ==="
cd "C:\Users\devon\OneDrive\Desktop\worldpulse" 2>/dev/null || cd ~/Desktop/worldpulse 2>/dev/null || cd /opt/worldpulse 2>/dev/null
git add \
  apps/scraper/src/pipeline/event-threads.ts \
  apps/scraper/src/pipeline/embeddings.ts \
  apps/scraper/src/pipeline/pattern-detection.ts \
  apps/scraper/src/index.ts \
  apps/scraper/src/pipeline/insert-signal.ts \
  apps/api/src/db/migrations/034_cortex_subsystems.sql \
  apps/api/src/routes/analytics.ts \
  cortex-hud.html

git commit -m "feat(cortex): add event threads, embeddings, pattern detection subsystems

- Event threads: groups signals into narrative threads (5min cycle)
- Embeddings: OpenAI text-embedding-3-small + TF-IDF fallback (on-insert + 30min batch)
- Pattern detection: causal chains, geographic hotspots, cross-cluster bridges (2hr cycle)
- Migration 034: event_threads tables + signals.embedding vector(1536) + HNSW index
- API: /analytics/event-threads endpoint
- HUD: event threads panel + pattern intelligence panel
- insert-signal.ts: embedSignal() on-insert hook"

git push

echo ""
echo "=== Step 2: Deploy to Production ==="
ssh root@142.93.71.102 << 'REMOTE'
set -e
cd /opt/worldpulse

echo "--- Pulling latest ---"
git checkout -- docker-compose.yml
git pull

echo "--- Running migration 034 ---"
docker exec wp_postgres psql -U wp_user -d worldpulse_db -f - < apps/api/src/db/migrations/034_cortex_subsystems.sql

echo "--- Rebuilding API + Scraper ---"
docker compose --env-file .env.prod up -d --build api
docker compose --env-file .env.prod up -d --build scraper

echo "--- Reloading nginx ---"
docker exec wp_nginx nginx -s reload

echo "--- Waiting 15s for containers to start ---"
sleep 15

echo "--- Health check ---"
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'wp_api|wp_scraper|wp_postgres'
curl -s http://localhost:3001/health | head -c 200
echo ""

echo "--- Verifying migration ---"
docker exec wp_postgres psql -U wp_user -d worldpulse_db -c "\dt event_threads"
docker exec wp_postgres psql -U wp_user -d worldpulse_db -c "SELECT column_name FROM information_schema.columns WHERE table_name='signals' AND column_name='embedding'"

echo ""
echo "=== Deploy complete ==="
REMOTE
