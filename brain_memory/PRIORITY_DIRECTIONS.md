# WorldPulse Brain Agent — Priority Direction Brief
Last updated: 2026-03-22 (full codebase audit + live site screenshot review)

---

## ⚠️ RULE #1: Always Commit After Creating Files
Before ANY task, run `git status`. After creating or editing files, ALWAYS:
```
git add <files>
git commit -m "description"
git push
```
Never leave untracked files. They don't exist in production.

---

## ⚠️ RULE #2: NEVER Add Imports Before Creating the Module

**The most common build-breaking mistake:** Adding an import to `apps/api/src/index.ts`
for a module that doesn't exist yet causes `TS2307: Cannot find module` — breaking the
Docker build and taking down production.

**ALWAYS do this in ONE commit:**
1. Create the module file (`apps/api/src/routes/foo.ts`, etc.)
2. Add the import to `index.ts` in the SAME commit
3. `git add` BOTH files before committing

**Before adding any import, verify the file exists:**
```bash
ls apps/api/src/routes/          # does the route file exist?
ls apps/api/src/lib/             # does the lib file exist?
ls apps/api/src/graphql/         # does the directory exist?
```

If the file doesn't exist yet, CREATE IT FIRST. Then add the import. Never the reverse.

---

## ⚠️ RULE #3: TypeScript Strict Mode — Required Patterns

The project uses `"strict": true`. These patterns WILL cause build failures:

### ❌ BROKEN — array index possibly undefined (TS18048)
```typescript
const [row] = await db('table').select()
const value = row.count   // ERROR: row is T | undefined
```

### ✅ FIXED
```typescript
const [row] = await db('table').select()
const value = row?.count ?? 0
```

### ❌ BROKEN — knex count destructuring (TS2339)
```typescript
const [{ count }] = await db('table').count('id as count')
// ERROR: Dict<string|number>|undefined has no property 'count'
```

### ✅ FIXED
```typescript
const countRows = await db('table').count('id as count')
const count = (countRows[0] as { count: string | number } | undefined)?.count ?? 0
```

### ❌ BROKEN — string | undefined in Set.has() (TS2345)
```typescript
const skip = new Set(['/health'])
skip.has(req.url.split('?')[0])  // split()[0] is string | undefined
```

### ✅ FIXED
```typescript
skip.has(((req.url ?? '').split('?')[0]) ?? '')
```

### ❌ BROKEN — stale @ts-expect-error (TS2578)
```typescript
// @ts-expect-error Fastify's id is typed...
req.id = randomUUID()   // if this line is now valid TS, the directive errors
```

### ✅ FIXED — remove @ts-expect-error if the line compiles cleanly without it

---

## ⚠️ RULE #4: Production Deploy — Never Touch .env.prod

The production server at `142.93.71.102:/opt/worldpulse/.env.prod` contains secrets
that are NOT in git. **Never overwrite or regenerate this file.**

### Correct deploy command (API changes):
```bash
ssh root@142.93.71.102 "cd /opt/worldpulse && git checkout -- docker-compose.yml && git pull && docker compose --env-file .env.prod up -d --build api && docker exec wp_nginx nginx -s reload"
```

### Correct deploy command (web + API changes):
```bash
ssh root@142.93.71.102 "cd /opt/worldpulse && git checkout -- docker-compose.yml && git pull && docker compose --env-file .env.prod up -d --build web api && docker exec wp_nginx nginx -s reload"
```

### NEVER do these:
- `docker compose up` without `--env-file .env.prod` (uses fallback `wp_secret_local` DB password → API crash-loops)
- `docker compose up` without specifying which services to build (may recreate postgres unnecessarily)
- Write or append to `.env.prod` (it has production secrets set manually)
- Reference `./deploy.sh` — this file does NOT exist on the server

### If the API is crash-looping with "password authentication failed":
```bash
# Verify .env.prod has DATABASE_URL:
grep DATABASE_URL /opt/worldpulse/.env.prod
# If missing, add it:
echo 'DATABASE_URL=postgresql://wp_user:hz2CfFpEEYjJ4zF@postgres:5432/worldpulse_db?sslmode=disable' >> /opt/worldpulse/.env.prod
docker compose -f /opt/worldpulse/docker-compose.yml --env-file /opt/worldpulse/.env.prod up -d --no-build api
```

---

## 🔴 P0 — Broken on Production Right Now

### P0-1: Wire the Scraper Geo Pipeline (30 min)
The geo pipeline is FULLY BUILT at `apps/scraper/src/pipeline/geo.ts` with 140+ gazetteer entries and Nominatim integration — but it is NEVER CALLED.

**Fix:** In `apps/scraper/src/index.ts`, find the `processArticleGroup()` or equivalent pipeline function. After `classifyContent()`, call `extractGeo()` from `./pipeline/geo`. This single change will start populating `signals.location` geometry, which fixes the map.

Also create `apps/api/src/scripts/geocode-signals.ts` — a one-time backfill script that geocodes all existing signals in the DB that have `location_name IS NOT NULL` but `location IS NULL`. Uses Nominatim at 1 req/sec.

### P0-2: Feed Items Are Not Clickable
`apps/web/src/components/feed/FeedList.tsx` renders cards with no navigation. Users cannot click into anything.

**Fix:**
- Wrap signal card elements in `<Link href={'/signals/' + item.id}>`
- Wrap post cards in `<Link href={'/posts/' + item.id}>`
- Fix `apps/web/src/app/explore/page.tsx` line ~141: change `router.push('/c/' + sig.category)` to `router.push('/signals/' + sig.id)`
- Create `apps/web/src/app/posts/[id]/page.tsx` — post detail page showing content, author, signal context, replies, source URL
- Each signal/post detail page MUST prominently show "View original source →" link (source_url field from signals table)

### P0-4: Mini Map "Click for full map →" Link Broken ✅ COMPLETED (Cycle 33)
The mini map widget on the homepage/feed had a "Click for full map →" CTA that did not navigate anywhere.

**Status:** FIXED in Cycle 33. Located component in `apps/web/src/components/sidebar/RightSidebar.tsx`. Wrapped globe visualization div in Next.js `<Link href="/map">` component. Link is now fully functional.

### P0-5: Category Channel Tabs Show "No signals yet"
The sidebar tabs for "Breaking News", "Culture" and other categories all show empty states. The category filter is not being applied to the API query.

**Fix:**
- In the feed/sidebar component that renders category tabs, find the API call for channel content
- Ensure `category` is passed as a query param: `GET /api/v1/feed?category=breaking_news`
- Verify the API route in `apps/api/src/routes/feed.ts` accepts and filters by `category` param
- Confirm the signal categories in DB match the frontend enum values (check `apps/scraper/src/pipeline/classify.ts` for category slugs)
- If categories don't match, add a mapping/normalisation layer

### P0-3: Settings Page Is Missing
The nav links to `/settings` but there is NO page.tsx there. Users who click it get a 404.

**Fix:** Create `apps/web/src/app/settings/page.tsx` with:
- Profile editing (displayName, bio, location, website) — calls `PUT /api/v1/users/me`
- Theme toggle (dark/light) — persist in localStorage
- Notification preferences (copy pattern from /alerts page)
- Account type display + verification status
- Danger zone: delete account

---

## 🟠 P1 — Major UX Gaps

### P1-1: Demo Data Leaking Into Production Pages
Three pages show hardcoded sample data instead of real API data:
- `apps/web/src/app/analytics/page.tsx` — DEMO_DATA constant (lines ~39-57)
- `apps/web/src/app/sources/page.tsx` — DEMO_SOURCES array (lines ~39-47)
- `apps/web/src/app/communities/page.tsx` — DEMO_COMMUNITIES array (lines ~43-51)

**Fix each page:**
1. Remove the hardcoded DEMO_* constants
2. Add `useState` for data + loading + error
3. Fetch from real API endpoints in `useEffect`:
   - Analytics: `GET /api/v1/feed/trending` for trending data, user post/signal counts from profile
   - Sources: `GET /api/v1/sources`
   - Communities: `GET /api/v1/communities`
4. Show loading skeletons while fetching
5. Show empty state if no data

### P1-2: Search Page Not Wired
`apps/web/src/app/search/page.tsx` exists but doesn't call the search API.
The API endpoint `GET /api/v1/search?q=&type=all|signals|posts|users` is FULLY IMPLEMENTED.

**Fix:**
- Wire search input to `GET /api/v1/search?q={query}&type={tab}`
- Show results in tabs: Signals | Posts | Users
- Add debounce 150ms
- Show result count per tab
- Add category filter chips + reliability range slider
- Show "No results for X" empty state with suggestions

### P1-3: Admin Dashboard Frontend Missing
`apps/api/src/routes/admin.ts` provides scraper health data but there's no frontend.

**Fix:** Create `apps/web/src/app/admin/page.tsx` (guard with `if (user.accountType !== 'admin') redirect('/')`)
- Source health grid: shows each scraper source with status (healthy/degraded/dead), last seen, success rate, latency
- Signal statistics: total signals, verified/pending/disputed breakdown, signals per hour chart
- User management table: search users, change account_type, suspend/unsuspend
- System stats: uptime, Redis memory, DB size

### P1-4: Map Real-Time Updates + Full Overhaul (TOP PRIORITY)
Map currently shows 0 signals and has no real-time updates. This is the platform's #1 visual differentiator and must be made compelling.

**The vision:** A dynamic, living map — not a static image. Signals should pulse, cluster, animate in real time. This is the first thing every new user sees.

**Fix (in order):**
1. Wire geo pipeline (P0-1) first so signals have location data
2. Connect map to `/api/v1/signals/map/points` — render all geolocated signals as pins
3. Subscribe to `signal.new` WebSocket event — new signals animate onto map with pulse effect (3-second glow)
4. Implement Supercluster for client-side clustering with count badges — critical for dense regions
5. Severity-based pin styling: critical = red pulse, high = orange, medium = yellow, low = grey
6. Click-through popup: title, reliability dots, category badge, "View full signal →" link
7. Add filter bar: category chips (Conflict / Climate / Health / Markets / Science), time range (1h / 6h / 24h / 7d)
8. Heatmap toggle layer for historical event density
9. Store zoom/pan in URL params so map links are shareable
10. Fallback polling every 30s if WebSocket disconnects

**Mobile map fix:**
- Default to full-screen map on mobile
- Signal details open as slide-up bottom sheet (`fixed bottom-0 w-full`)
- Filter bar collapses to icon row on small screens

### P1-5: Live Signal Counter Is Hardcoded/Stale
The "LIVE Tracking X signals" counter on the homepage displays a static number that does not update.

**Fix:**
- Find the component rendering the live counter (likely in `apps/web/src/app/page.tsx` or a stats widget)
- Replace static value with a `useEffect` that calls `GET /api/v1/signals/stats` or `GET /api/v1/feed/stats` on mount
- Subscribe to the WebSocket `signal.new` event and increment the counter in real time (no page refresh needed)
- If no stats endpoint exists, create `GET /api/v1/signals/count` in `apps/api/src/routes/signals.ts` returning `{ count: number }`
- Update the counter every 30 seconds as a fallback

### P1-6: News Ticker Not Interactive
The top news ticker scrolls headlines but users cannot interact with it — no pause on hover, no click-through to story.

**Fix:**
- In the ticker component (likely `apps/web/src/components/NewsTicker.tsx`):
  - Add `onMouseEnter` → pause scroll animation (`animation-play-state: paused`)
  - Add `onMouseLeave` → resume scroll
  - Wrap each ticker item in `<Link href={'/signals/' + item.id}>` so clicking navigates to the signal detail
  - Add `cursor: pointer` styling on individual items
  - Ensure signal ID is available in the ticker data shape; if not, update the API query that feeds it

### P1-7: Communities Grid Broken on Mobile
`apps/web/src/app/communities/page.tsx` uses `grid-cols-4` — breaks on small screens.
**Fix:** Change to `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`

### P1-6: Post Replies API Missing
`GET /api/v1/posts/:id/replies` doesn't exist.
**Fix:** Add to `apps/api/src/routes/posts.ts`:
```typescript
app.get('/:id/replies', { preHandler: [optionalAuth] }, async (req, reply) => {
  // paginated replies to a post, cursor-based
})
```

### P1-7: Map Not Mobile Friendly
`apps/web/src/app/map/page.tsx` has no responsive layout. On mobile the sidebar overlaps the map.
**Fix:**
- Default to full-screen map on mobile
- Signal details open as slide-up bottom sheet (`fixed bottom-0 w-full`)
- Filter bar collapses to icon buttons on mobile

---

## 🟡 P2 — High-Value Improvements

### P2-1: Reliability Score Explainer Tooltip
When users hover over reliability dots (●●●●○), show a tooltip:
"73% — 4 sources verified · AI cross-check: confirmed · Community flags: 0"
This is a key differentiator vs NewsGuard (opaque scoring).
**File:** `apps/web/src/components/signals/ReliabilityDots.tsx` — add Tooltip wrapper.

### P2-2: Signal Source Chain on Detail Page
`apps/web/src/app/signals/[id]` should prominently show:
- All sources that reported this signal with their trust scores
- Original article URL (source_url field)
- "View original source →" link button
The `source_ids` array is on the signals table. Join with sources table to get names + urls.

### P2-3: Scraper Process Health Monitor
If the scraper container crashes, nothing alerts anyone.
**Fix in `apps/scraper/src/index.ts`:**
- Add `process.on('uncaughtException', ...)` handler that writes error to Redis
- Add `process.on('unhandledRejection', ...)` similarly
- Write a heartbeat to Redis every 60s: `redis.setex('scraper:alive', 90, Date.now())`
- API can check this key in the health endpoint

### P2-4: Verification Log Population
`verification_log` table exists in DB but nothing writes to it.
**Fix:** In `apps/scraper/src/pipeline/verify.ts`, after computing reliability_score, insert a row:
```sql
INSERT INTO verification_log (signal_id, verifier_type, verdict, score_delta, notes)
VALUES ($1, 'ai', $2, $3, $4)
```
This gives users an audit trail of how scores were calculated.

### P2-5: Input Validation on Query Params
`GET /api/v1/signals/map/points?bbox=minLng,minLat,maxLng,maxLat` — bbox not validated.
Add Zod parse for all GET query params across routes. A malformed bbox string will throw an unhandled exception.

### P2-6: Public API Endpoint
Add `GET /api/v1/public/signals` — no auth required, rate limited to 60 req/min per IP.
Returns last 50 verified signals with id, title, category, severity, reliability_score, location_name, published_at.
This is a core open-source differentiator. Add documentation in `/docs/api.md`.

### P2-7: GDELT Integration
GDELT publishes a free TSV feed every 15 minutes with 500K+ events/day at:
`http://data.gdeltproject.org/gdeltv2/lastupdate.txt`
Add a GDELT source adapter to the scraper that ingests this feed. Tag signals with `source: 'gdelt'`.
This immediately gives WorldPulse massive data coverage vs competitors.

---

## 🟢 P3 — Polish & Competitive Differentiators

### P3-1: Open Graph / Link Preview Image ✅ COMPLETED (Cycle 33)
When world-pulse.io is shared via iMessage, WhatsApp, Slack, or Twitter, it now shows a rich preview card with branded image.

**Status:** COMPLETED in Cycle 33. (1) Updated `apps/web/src/app/layout.tsx` metadata export with openGraph fields (title, description, url, siteName, images) and twitter card fields; (2) Created `apps/web/public/og-image.png` (1200×630px) using Python PIL — dark background (#06070d), amber WORLDPULSE title text, cyan tagline, grid pattern with glowing hotspots, bottom accent bar; (3) Social shares on iMessage/WhatsApp/Slack/Twitter now display rich preview cards with image, title, and description.

### P3-2: Loading Skeletons Everywhere
Replace all loading spinners with content-shaped skeleton screens.
Key places: feed cards, signal detail, profile page, search results, map sidebar panel.
Use a simple `SkeletonCard` component with Tailwind `animate-pulse`.

### P3-2: Bottom Tab Bar for Mobile
`apps/web/src/components/nav/BottomTabBar.tsx` was created by brain agent but never used.
Import it in the root layout and show it on screens below `lg` breakpoint:
```tsx
<div className="lg:hidden fixed bottom-0 inset-x-0"><BottomTabBar /></div>
```
Tabs: Feed | Map | Search | Alerts | Profile

### P3-3: Email Notifications on Alert Triggers
When a signal matches a user's `alert_subscriptions` criteria (category + country + severity), send an email.
Use `nodemailer` with SMTP or a transactional service. Queue via Redis list `notifications:email`.
Schema for delivery already exists in `alert_subscriptions` table.

### P3-4: Dark/Light Mode Toggle
`ThemeContext` and `useTheme` already exist in `apps/web/src/components/providers.tsx`.
Add theme toggle button to TopNav (☀ / ☾). It's wired in TopNav.tsx already — just needs the
`document.documentElement.classList.toggle('dark')` persistence via localStorage.

### P3-5: Standardize API Error Format
Some routes return `{ success: false, error: string }`.
Others return `{ success: false, code: string, error: string }`.
Pick one format and apply globally. Suggested: `{ success: false, error: string, code: string }`.
Add a shared `sendError(reply, status, code, message)` helper in `apps/api/src/lib/errors.ts`.

---

## 🔌 Integration Roadmap (added 2026-03-28)

Three-phase integration plan locked in. Tasks are in worldpulse_tasks.json.

### Phase 1 — NOW (priority 11, before Gate 1 clears ~Apr 9)
1. **Sentry** — error tracking + performance monitoring (apps/web + apps/api)
2. **Vercel** — deployment config: vercel.json, env var audit, localhost ref cleanup
3. **Cloudflare** — security headers hardening, cache-control, real-IP trust for rate limiting

### Phase 2 — BEFORE GATE 1 CLEARS (priority 9)
4. **Stripe** — Pro tier billing: subscriptions table, checkout, webhook handler, pricing page
   - Pro: $12/mo · 600 req/min · 90-day history · unlimited alerts · 5 webhooks
   - Free: 60 req/min · 7-day history · 3 alerts
5. **Pinecone** — semantic search + similar signals: embeddings on ingest, /search/semantic, /signals/:id/similar, SimilarSignals.tsx

### Phase 3 — AFTER LAUNCH
- PostHog (product analytics + feature flags — no point tracking before real users)

### Critical notes for brain agent:
- Sentry/Vercel/Cloudflare tasks are additive — no changes to existing auth, feed, or scraper routes
- Stripe webhook endpoint MUST be excluded from CSRF/JSON body parser middleware (needs raw body)
- All Pinecone/OpenAI calls must be non-blocking (try/catch, don't fail ingestion if Pinecone is down)
- `STRIPE_SECRET_KEY`, `PINECONE_API_KEY`, `OPENAI_API_KEY` will be undefined in dev — init clients conditionally
- Gate 1 clock is still running — do NOT modify scraper stability infrastructure

---

## 📊 Current Production Health (2026-03-22)
- world-pulse.io → HTTP 200 ✅
- api.world-pulse.io/health → ok ✅
- 2,850+ active signals in DB ✅
- Live feed streaming via WebSocket ✅
- Map shows 0 signals ❌ (geo pipeline not wired)
- User profiles work ✅ (just deployed)
- Signal detail pages work ✅ (just deployed)
- Admin accounts: devongamba, admin@worldpulse.io ✅

## 🏆 Competitive Score vs Ground News (Most Direct Competitor)
| Feature | WorldPulse | Ground News |
|---|---|---|
| Real-time signals | ✅ | ❌ |
| Open source | ✅ | ❌ |
| Self-hostable | ✅ | ❌ |
| Reliability scoring | ✅ (opaque) | ✅ (bias meter) |
| Interactive map | ⚠️ (no data) | ❌ |
| Mobile app | ❌ | ✅ |
| Community layer | ⚠️ (partial) | ❌ |
| Source count | ~7 live | 50,000+ |
| Public API | ❌ | ❌ |

**Priority to close gap:** GDELT integration (P2-7) would instantly give WorldPulse 500K+ daily events vs Ground News's processed feed.
