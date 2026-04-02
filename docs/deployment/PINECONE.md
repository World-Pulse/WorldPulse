# Pinecone Vector Search — Deployment Guide

WorldPulse uses Pinecone to power semantic signal search and similar-signal recommendations. All Pinecone calls are **optional and non-blocking** — the system degrades gracefully to keyword search (Meilisearch) when env vars are absent or calls fail.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PINECONE_API_KEY` | Yes (to enable) | — | API key from console.pinecone.io |
| `PINECONE_HOST` | Yes (to enable) | — | Index host URL, e.g. `https://worldpulse-signals-xxxx.svc.pinecone.io` |
| `PINECONE_INDEX` | No | `worldpulse-signals` | Index name (informational — host URL takes precedence for routing) |
| `OPENAI_API_KEY` | Yes (to embed) | — | Used for `text-embedding-3-small` embeddings |

Set these in `.env` (local) and your deployment secrets (prod). If `PINECONE_API_KEY` or `PINECONE_HOST` is unset, all Pinecone operations are silent no-ops.

---

## Pinecone Index Setup

Create the index once via the Pinecone console or CLI:

```bash
# Console: https://app.pinecone.io → "Create Index"
# Settings:
#   Name:       worldpulse-signals
#   Dimensions: 1536
#   Metric:     cosine
#   Pod type:   p1.x1  (starter — upgradeable)
```

After creation, copy the **Host** URL (not the index name) into `PINECONE_HOST`.

### Index metadata schema

Each vector is stored with these metadata fields:

| Field | Type | Example |
|---|---|---|
| `title` | string | `"7.2 earthquake strikes northern Japan"` |
| `category` | string | `"disaster"` |
| `severity` | string | `"critical"` |
| `reliability_score` | number | `0.87` |
| `published_at` | string (ISO 8601) | `"2026-03-30T14:22:00.000Z"` |
| `index` | string | `"worldpulse-signals"` |

---

## Embedding Pipeline

```
Scraper poller
  └─ insertAndCorrelate()            apps/scraper/src/pipeline/insert-signal.ts
       ├─ 1. DB insert (signals)
       ├─ 2. Cross-source correlation
       ├─ 3. Redis publish (live map)
       └─ 4. [non-blocking] Pinecone upsert
            ├─ generateEmbedding(title + summary)   → OpenAI text-embedding-3-small
            │    └─ Redis cache 24h  (embed:{sha256})
            └─ upsertSignalVector(id, embedding, metadata) → Pinecone /vectors/upsert
```

Step 4 is fully fire-and-forget: errors are swallowed and **never propagate** to the caller. A Pinecone outage cannot fail signal ingestion.

The scraper's Pinecone client lives at `apps/scraper/src/lib/pinecone.ts`. The API's copy (used for search queries) is at `apps/api/src/lib/pinecone.ts`. Both are identical except for the Redis import path.

---

## API Endpoints

### Semantic Search

```
GET /api/v1/search/semantic?q=<query>&limit=<n>
```

| Param | Default | Description |
|---|---|---|
| `q` | required | Natural-language search query |
| `limit` | `20` | Max results (1–100) |

**Behaviour:**
1. Embeds `q` via OpenAI → vector
2. Queries Pinecone `topK=limit`
3. Fetches full signal rows from PostgreSQL by returned IDs
4. **Fallback:** if Pinecone is unconfigured or returns 0 results, falls back to Meilisearch keyword search

### Similar Signals

```
GET /api/v1/signals/:id/similar
```

Returns up to 10 signals semantically similar to the given signal ID.

**Behaviour:**
1. Fetches the signal's stored embedding from Pinecone (or re-generates via OpenAI)
2. Queries Pinecone for nearest neighbours, excluding the source signal
3. Result cached in Redis for **10 minutes** (`similar:{id}`)

---

## Backfill Existing Signals

To embed all historical signals that predate Pinecone integration:

```bash
npx tsx apps/api/src/scripts/backfill-search.ts
```

The script processes signals in batches, respects OpenAI rate limits, and is safe to re-run (already-embedded signals are skipped via Redis cache).

---

## Cost Estimates

| Item | Calculation | Cost |
|---|---|---|
| One-time backfill | 12,500 signals × ~200 tokens avg × $0.02/1M tokens | **~$0.05** |
| Storage | 12,500 vectors × 1536 dims on p1.x1 | included in pod cost |
| Ongoing ingestion | ~100 signals/day × 200 tokens × $0.02/1M | **~$0.0004/day** |
| p1.x1 pod | Pinecone starter | **$0.096/hr** (or free tier) |

Total embedding API cost is negligible. The primary cost is the Pinecone pod if you leave the free tier.

---

## Graceful Degradation

| Condition | Behaviour |
|---|---|
| `PINECONE_API_KEY` unset | All Pinecone calls are no-ops; `isPineconeEnabled()` returns `false` |
| `OPENAI_API_KEY` unset | `generateEmbedding()` returns `null`; upsert is skipped |
| OpenAI API error | Returns `null`; upsert skipped; ingestion unaffected |
| Pinecone upsert error | Swallowed silently; ingestion unaffected |
| Semantic search returns 0 results | Falls back to Meilisearch keyword search |
| Redis cache unavailable | Embedding is re-generated from OpenAI on each call |

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Semantic search returns no results | `PINECONE_HOST` not set or wrong | Check env var; host must be the full `https://…svc.pinecone.io` URL |
| `401 Unauthorized` from Pinecone | Invalid `PINECONE_API_KEY` | Rotate key in Pinecone console → update secret |
| `404` on `/vectors/upsert` | Wrong host or index not created | Verify index exists; re-copy host URL from console |
| Embeddings never cached | Redis not reachable | Check Redis connection; cache miss is non-fatal |
| Backfill exits immediately | All signals already in cache | Run with `REDIS_URL=` unset to force re-embed, or flush `embed:*` keys |
| `dimension mismatch` from Pinecone | Index created with wrong dimensions | Delete and recreate index with `dimensions: 1536` |
| High OpenAI latency on ingestion | No Redis cache hit | Normal on first embed; subsequent calls for identical text are instant |
| Similar signals endpoint returns `[]` | Signal not yet embedded | Wait for async upsert or run backfill; check `PINECONE_API_KEY` is set |
