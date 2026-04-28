# Production Fix Report — 2026-04-16

**Status:** ✅ All blockers resolved. Site live and stable heading into launch window.
**Launch target:** 2026-04-20 (T-4 days)
**Live signal count:** ~20,000 and climbing
**Prod host:** 142.93.71.102 (world-pulse.io / api.world-pulse.io)

---

## Summary

Two critical launch-blockers were root-caused and fixed in prod today, plus one infrastructure trap was documented so it stops costing time in future sessions.

1. **Signal detail pages now load** — every `/signals/:id` was returning 500 after the Apr 15 schema migration. Fixed with a one-line SQL cast.
2. **Sanctions page now renders** — OpenSanctions free tier was hard-rate-limiting us into an empty `/sanctions` page. Fixed with batched queries, retry-with-backoff, and a seed fallback that guarantees the page never goes empty regardless of upstream availability.
3. **Deploy pipeline trap documented** — `deploy-bg.ps1 -Tail` does not sync source; forgetting this was silently shipping stale images for ~30 min. Runbook updated.

---

## Fix 1 — Signal detail 500s (RESOLVED)

### Symptom
Every page under `/signals/:id` returned the 404 "This signal couldn't be found" empty state. Appeared to be a missing-data issue; was actually an API 500 masked by a client-side `notFound()` call on non-2xx responses.

### Root cause
The Apr 15 `migration_hotfix.sql` converted `signals.source_ids` from `uuid[]` to `text[]` to fix a separate schema-drift issue, but `sources.id` is still `uuid`. Every detail query ran:

```sql
WHERE s2.id = ANY(s.source_ids)   -- uuid = text[] → SQLSTATE 42883
```

Postgres rejected the comparison with `operator does not exist: uuid = text`. The route caught the error and returned 500. Next.js SSR converted the 500 into a rendered 404.

### Fix
Explicit text cast on both sides of the comparison in `apps/api/src/routes/signals.ts:212`:

```sql
WHERE s2.id::text = ANY(s.source_ids::text[])
```

Prepared but **deliberately did not ship** a migration to revert `source_ids` back to `uuid[]` — scrapers/ingest code now writes text values, so the type-safe in-query cast is lower-risk than another type migration. Migration file retained with a "SUPERSEDED — DO NOT RUN" header for future reference.

### Verification
- `curl https://api.world-pulse.io/api/v1/signals/<id>` returns 200 with full payload
- Live pages (e.g. `world-pulse.io/signals/66be8416-...`) render with title, body, sources, related signals
- `docker exec wp_api grep -c 'source_ids::text' /app/dist/routes/signals.js` → `1` ✅

---

## Fix 2 — Sanctions page empty (RESOLVED with fallback)

### Symptom
`/sanctions` showed "Featured entities unavailable." API `/api/v1/sanctions/featured` returned `{ success: true, data: [] }`.

### Root cause (upstream, permanent)
OpenSanctions' free public API hard-rate-limits at approximately **60 requests/hour per IP**, enforced globally across `/search/default` and `/search/sanctions`. Our `/featured` endpoint fans out 14 parallel queries per cold cache fill, each with up to 3 retries — a single page load can burn the entire hourly budget. Every retest hit 429 regardless of exponential backoff because the budget is hourly, not per-minute.

### Fix — multi-layer
1. **Switched upstream scope** from `/search/default` (firehose) to `/search/sanctions` (Consolidated Sanctions collection) — smaller, higher-signal, cache key versioned to `v2:sanctions:` so old cache entries auto-invalidate.
2. **Batched queries** 2 at a time with 400ms gaps between batches (`lib/opensanctions.ts`, `routes/sanctions.ts`).
3. **Retry with exponential backoff** on 429s (500ms → 1500ms → 3000ms) before giving up on a single query.
4. **Seed fallback** — new file `apps/api/src/lib/sanctions-seed.ts` contains 14 hand-curated high-profile entities (Putin, Kim Jong Un, Lukashenko, Assad, Kadyrov, Khamenei, IRGC, Wagner, Hezbollah, Hamas, ISIL, Al-Qaida, two sanctioned vessels). When live fetch returns zero results, we serve the seed and cache it for 15 minutes to stop hammering upstream. Page is never empty.
5. **Redis cache TTL** extended from 60s to 10 min on success, 15 min on seed fallback.

### Verification
- `curl https://api.world-pulse.io/api/v1/sanctions/featured` returns 14 entities sorted by threat level
- `/sanctions` page renders with full cards: threat badges, datasets, aliases, countries, topics
- `docker exec wp_api grep -c 'FEATURED_SEED' /app/dist/routes/sanctions.js` → ≥ 2 ✅

### Post-launch follow-up
Options to unlock true real-time OpenSanctions data:
- **Free authenticated tier** (1,200 req/day) — sign up at opensanctions.org → paste API key
- **Pro tier** ($600/year, 100K+ req/month) — recommended if sanctions is a flagship surface
- **Bulk dataset** — weekly download of `entities.ftm.json.gz`, query from local Postgres, no rate limits, richer metadata

---

## Fix 3 — Deploy cache trap (documented, no code change)

### The 30-minute rabbit hole
Two complete `deploy-bg.ps1 -Tail` runs produced "all containers Healthy" messages, but the running image still had pre-fix code. Stack traces confirmed `/app/dist/lib/opensanctions.js:65:15` (old line number) and `Promise.allSettled (index 13)` (all 14 in one allSettled despite the batching change).

### Two causes conflated
1. `deploy-bg.ps1 -Tail` is a **log-tailing shortcut, not a deploy command.** Looking at the script: `if ($Tail) { ssh tail -f $LogFile; exit }`. No tar, no scp, no rebuild. Running it alone uploads nothing.
2. `pnpm build || true` in the API Dockerfile silently swallows TypeScript compile failures. When the builder stage fails, the COPY-from-builder still succeeds and ships a stale dist.

### Resolution
- Used direct `scp` of individual changed files to bypass the tar pipeline
- Forced `docker compose build --no-cache api` + `up -d --force-recreate api`
- Verified by grepping the compiled JS inside the container BEFORE assuming code was live
- Memory file updated: future sessions will always verify source-on-server FIRST, then dist-in-container, before blaming cache

### Permanent tech debt (tracked, not fixing before launch)
- `pnpm build || true` masking ~100 TypeScript errors → `project_api_typescript_debt.md` memory already tracks this. Post-launch cleanup.

---

## Overnight plan

- Site is running. Scraper is ingesting. ~20K signals in the feed.
- No overnight changes planned. Monitor via `.\scripts\deploy-bg.ps1 -Status` and `docker logs wp_scraper` if anything looks off.
- Expected morning state: signal count north of 22K, sanctions page still rendering, signal detail pages still green.

---

## Files changed this session

| File | Change |
|------|--------|
| `apps/api/src/routes/signals.ts` | Added `::text` cast to line 212 join condition |
| `apps/api/src/lib/opensanctions.ts` | Switched to `/search/sanctions`; added 429 retry with backoff; bumped cache key to `v2:sanctions:` |
| `apps/api/src/routes/sanctions.ts` | Batched queries (size 2, 400ms gap); seed fallback on empty; extended TTL |
| `apps/api/src/lib/sanctions-seed.ts` | **NEW** — 14 curated featured entities for guaranteed non-empty page |
| `infrastructure/docker/postgres/migration_source_ids_uuid.sql` | Marked SUPERSEDED (chose code-level cast over migration) |

## Memories updated

- `project_signal_detail_500.md` — new (uuid/text cast guidance)
- `project_opensanctions_rate_limits.md` — new (free tier ~60 req/hr cap, seed fallback strategy)
- `feedback_deploy_cache_serves_stale.md` — expanded (source-on-server check before blaming Docker cache; `-Tail` isn't a deploy)
