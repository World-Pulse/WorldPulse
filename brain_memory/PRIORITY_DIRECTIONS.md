# WorldPulse Brain Agent — Priority Direction Brief
Last updated: 2026-03-22

## ⚠️ CRITICAL: Git Commit Discipline
The brain agent must ALWAYS commit AND push every file it creates or modifies.
Files that are never committed cannot be deployed. Before running any task:
1. Run `git status` to find untracked/modified files
2. After creating files, ALWAYS run `git add <files> && git commit && git push`
3. Never leave untracked files — they are invisible to production

## 🔴 P0 — Currently Broken on Production (Fix Immediately)

### P0-1: Map Shows 0 Signals
**Root cause:** Signals in DB have NULL location geometry — the scraper stores signals but doesn't geocode them.
**Fix needed:**
- Add a geocoding step in the scraper pipeline: when a signal has a `location_name` or `country_code`, call a geocoding API (Nominatim/OpenStreetMap is free) to get lat/lng and store as PostGIS POINT
- Add a backfill script `apps/api/src/scripts/geocode-signals.ts` that geocodes all existing signals with non-null `location_name`
- The map API endpoint at `/api/v1/signals/map/points` already works correctly — it just needs data with `location IS NOT NULL`
- Run the backfill script after deploying

### P0-2: "14 New Signals" Notification is Hardcoded
**Root cause:** `apps/web/src/app/page.tsx` line 33 has `useState(14)` — FIXED, now `useState(0)`
**Also needed:** Wire the WebSocket `signal.new` / `post.new` events to increment newCount. The `useFeed` hook in `apps/web/src/hooks/useFeed.ts` already handles this but isn't used in page.tsx. Import and use `useFeed` hook in the main page instead of manual state.

### P0-3: Commit All Untracked Files
The following critical files exist locally but are NOT in git and therefore NOT deployed:
- `apps/web/src/app/users/` (entire directory — user profile pages — shows 404 on production)
- `apps/web/src/app/signals/` (signal detail pages)
- `apps/web/src/app/onboarding/` (onboarding flow)
- `apps/web/src/components/EmptyState.tsx`
- `apps/web/src/components/ReputationChart.tsx`
- `apps/web/src/components/nav/BottomTabBar.tsx`
- `apps/web/src/components/signals/` (entire directory)
- `apps/web/src/lib/` (entire directory)
- `apps/api/src/routes/admin.ts` (admin panel API)
- `apps/api/src/scripts/` (utility scripts)
- `apps/scraper/src/health.ts`
- `apps/scraper/src/lib/circuit-breaker.ts`
- `apps/scraper/src/lib/dlq.ts`
- `apps/scraper/src/lib/rate-limiter.ts`
- `apps/scraper/src/lib/retry.ts`
**Action:** `git add` all of the above, commit, push immediately.

## 🟠 P1 — Major UX Issues

### P1-1: Posts Are Not Clickable
`apps/web/src/components/feed/FeedList.tsx` renders signal/post cards but they have no `<Link>` to a detail page.
**Fix:**
- Wrap signal cards in `<Link href={'/signals/' + item.id}>` (the signals/[id] page exists locally but untracked)
- Wrap post cards in `<Link href={'/posts/' + item.id}>` and CREATE `apps/web/src/app/posts/[id]/page.tsx`
- The post detail page should show: full content, author, signal it's attached to, replies, source URL if available

### P1-2: Source Link on Posts
When viewing a signal or post that originated from a scraped source, users should see a "View source" link that opens the original article. The `source_url` field exists on the signals table. Add it to the API response for `/api/v1/signals/:id` and display it prominently on the signal detail page.

### P1-3: Live Feed WebSocket Connection
The live feed should show truly real-time new signals via WebSocket. Current implementation in `useFeed.ts` exists but may not be connected to the main page. Verify and connect the WebSocket subscription so "X new signals" accurately reflects real-time arrivals.

## 🟡 P2 — High-Value Improvements

### P2-1: Signal Geocoding Pipeline
Add automatic geocoding to the scraper:
- When a signal is created with `location_name`, call Nominatim: `https://nominatim.openstreetmap.org/search?q={location_name}&format=json&limit=1`
- Store result as PostGIS POINT: `ST_SetSRID(ST_MakePoint({lng}, {lat}), 4326)`
- Rate limit to 1 req/sec (Nominatim ToS)
- Cache geocoded results in Redis with TTL 7 days to avoid duplicate calls

### P2-2: Post Detail Page
Create `apps/web/src/app/posts/[id]/page.tsx` with:
- Post content, author profile link, timestamp
- Signal context panel (if post is linked to a signal)
- Replies thread
- Source link if available
- Like/boost/reply actions

### P2-3: Admin Dashboard
The admin route `apps/api/src/routes/admin.ts` exists but needs a frontend at `/admin`.
Build `apps/web/src/app/admin/page.tsx` showing:
- Scraper health (sources: healthy/degraded/dead)
- Recent signals with verification status
- User management (change account_type, suspend/unsuspend)
- System stats (signal count, user count, uptime)

### P2-4: Feed Quality — Dedup & Clustering
The feed currently shows individual scraped articles. Improve by:
- Grouping related signals (same event, different sources) into a single clustered feed card showing source count
- Add "X sources covering this story" to signal cards
- This is the core "cross-source verification" differentiator vs competitors

## 🟢 P3 — Competitive Differentiators to Build

### P3-1: AI Reliability Score Explainer
When users hover over reliability dots (●●●●○), show a tooltip explaining: "X sources verified · AI cross-check: confirmed · Community flags: 0". This makes WorldPulse's scoring transparent and trustworthy — a key differentiator vs competitors like NewsGuard.

### P3-2: Public API
Add `GET /api/v1/public/signals` (no auth, rate-limited) with documentation. WorldPulse being open-source AND having a public API is a strong competitive differentiator vs Reuters Connect (expensive) and AP Wire (paywalled).

### P3-3: Email Notifications
When a signal user follows reaches a new severity level, send an email alert. Use the existing infrastructure.

## 📋 Deployment Reminder
After every code change:
1. `git add <changed files>`
2. `git commit -m "description"`
3. `git push`
4. On server: `cd /opt/worldpulse && git pull && ./deploy.sh`

The server is at 142.93.71.102. Deploy script handles build + health checks automatically.
