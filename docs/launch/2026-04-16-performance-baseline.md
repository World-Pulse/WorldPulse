# Performance Baseline Report — WorldPulse

**Snapshot date:** 2026-04-16 (T-4 days to launch)
**Purpose:** Establish ground-truth metrics today so we can measure what the launch moves.

---

## Context

This is a **pre-launch baseline**, not a performance report. We have no live user traffic yet, no marketing spend, and no external backlinks. The purpose is to set a comparison line so that post-launch numbers are interpretable.

---

## What's instrumented

| Metric | Source | Status | Note |
|---|---|---|---|
| Page views | PostHog | **Wired, not enabled** | `NEXT_PUBLIC_POSTHOG_KEY` not set in prod. Fix before launch. |
| API request volume | Fastify logs + Grafana | Live | Aggregated in Grafana dashboard on :3100 |
| Signal ingest rate | Scraper logs + Redis `scraper:stability:*` | Live | ~90 sec cadence across 700+ feeds |
| DB query performance | Postgres `pg_stat_statements` | Live | Not actively monitored yet |
| Error rate (5xx) | Server logs | Live | No alerting, manual review |
| Uptime | Manual | Live | No third-party uptime monitor wired |
| Front-end Core Web Vitals | None | **Gap** | Need Lighthouse CI or PostHog web-vitals before launch |
| GitHub stars | GitHub API | Live | Repo not yet public; stars = 0 |
| npm SDK installs | npm API | Live | Package not yet published |

**Four launch-day instrumentation gaps, ordered by impact:**

1. PostHog key not set → no funnel or page-view data. **Fix Friday.**
2. Lighthouse CI or web-vitals beacon → no Core Web Vitals. **Fix Friday.**
3. Uptime monitoring (UptimeRobot, Pingdom, or Better Stack) → no outage alerts. **Fix Sunday.**
4. API error-rate alerting → manual log review only. **Acceptable for launch week.** Wire Sentry alerts by Apr 27.

---

## Baseline snapshot

### Content / ingest

| Metric | Value (Apr 16) | Source |
|---|---|---|
| Total signals in DB | ~20,000 | Apr 16 production fix report |
| RSS sources configured | 149 | `project_sources_apr15_expansion.md` |
| OSINT sources configured | 29 | `project_sources_apr15_expansion.md` |
| Total sources | 178 configured / "700+" referenced | Gap — see note below |
| Signal ingest cadence | ~90 sec | Scraper pipeline design |
| Signals added per 24h (est.) | ~2,000 | Apr 16 plan: "signal count north of 22K" by tomorrow |

**Note on the "700+ sources" messaging:** The source registry was expanded to 700+ via migrations. Prod config on Apr 15 shows 178 active. Clarify before launch: does "700+" mean "registered in the catalog" or "actively scraping"? External messaging needs to match ground truth. Recommended: use the active-scraping number + say the catalog reaches 700+ if relevant.

### Infrastructure

| Metric | Value | Source |
|---|---|---|
| Prod host | DigitalOcean, 142.93.71.102 | Memory |
| Architecture | Next.js (web) + Fastify (API) + Postgres + Redis + Kafka + Meilisearch | README |
| Containers healthy | web, api, scraper, postgres, redis, meilisearch | Apr 16 deploys |
| Scraper status | Running, ingesting continuously | Apr 16 fix report |
| Deploy pipeline | `deploy-bg.ps1` (now with `-Tail` gotcha documented) | Memory |
| Known build gotcha | `pnpm build \|\| true` in API Dockerfile masks ~100 TS errors | `project_api_typescript_debt.md` |

### Database

| Metric | Value | Note |
|---|---|---|
| Postgres version | 16 + PostGIS | From README / prod config |
| signals table row count | ~20,000 | Apr 16 |
| sources table row count | ~178 active | Matches scraper catalog |
| claims table | Present, populated by enrichment | Exact count not measured |
| knowledge_graph_entities table | Present | Exact count not measured |
| Schema drift | Resolved Apr 15 | `project_signals_schema_drift.md` |

### API

| Endpoint | Known state | Note |
|---|---|---|
| `GET /api/v1/signals` | 200 OK | Live feed query |
| `GET /api/v1/signals/:id` | 200 OK (as of Apr 16) | Fixed today — uuid/text cast |
| `GET /api/v1/sanctions/featured` | 200 OK (seed fallback live) | Upstream rate-limited |
| `GET /api/v1/knowledge-graph/*` | Presumed healthy | Not spot-checked today |
| `POST /api/v1/signals/:id/flag` | Available, optionalAuth + IP rate limit | |
| Global rate limit | 200 req/min, Cloudflare-aware | `apps/api/src/index.ts` |

### Front-end

| Page | Risk | Pre-launch check |
|---|---|---|
| `/` (landing) | Lowest — static-ish | Lighthouse Friday |
| `/knowledge-graph/explorer` | Highest — Canvas + heavy JS | Hand-test load time Friday |
| `/signals/:id` | Low (just fixed) | Smoke-test 5 IDs Friday |
| `/sanctions` | Low (seed fallback live) | Smoke-test Friday |
| Mobile | Unknown | Device test Friday |

### Social / community (pre-launch)

| Metric | Value | Note |
|---|---|---|
| GitHub stars | 0 (repo private) | Goes public Monday Apr 20 |
| npm downloads (SDK) | 0 (not published) | Publish launch-day |
| Twitter/X followers | ?? (need to check) | |
| Newsletter subscribers | ?? (need to check) | |
| Discord members | N/A | No Discord today — consider for post-launch |
| HN karma (founder) | ?? | |

**Action:** Before Friday, capture the exact starting numbers for Twitter followers, newsletter list, and founder HN karma. These are the "from 0" story at end-of-launch-week.

---

## Launch-day targets (reiterating from campaign plan)

| Metric | 24h floor | 24h target | 24h stretch |
|---|---|---|---|
| Site sessions | 2,500 | 5,000 | 15,000 |
| Unique visitors | 2,000 | 4,000 | 12,000 |
| API calls | 5,000 | 20,000 | 100,000 |
| SDK npm installs | 20 | 60 | 200 |
| Signups | 50 | 150 | 400 |
| GitHub stars (peak) | 150 | 400 | 1,500 |
| HN peak rank | Top 30 | Top 10 | Front page + 100 comments |
| 5xx error rate | < 1% | < 0.5% | < 0.1% |
| p95 API latency | < 800ms | < 500ms | < 300ms |
| Sanctions cache hit rate | > 90% | > 95% | ≥ 99% |

---

## Week-1 targets (by Apr 27)

| Metric | Target |
|---|---|
| GitHub stars | 500+ |
| SDK installs | 150+ |
| Signal count | 50,000+ |
| Unique visitors | 15,000+ |
| Interview transcripts captured | 10 |
| Newsletter mentions | 3+ |
| User-filed GitHub issues | 15–30 (healthy engagement, not a fire) |
| Blog posts published | 2 (launch + day-3 retro) |

---

## Month-1 targets (by May 20)

| Metric | Target |
|---|---|
| GitHub stars | 2,000+ |
| SDK installs | 1,000+ |
| Signal count | 200,000+ |
| Unique visitors | 75,000+ |
| Pro-tier signups | 10 (first paid conversions) |
| Press placements | 3+ |
| Open issues (healthy backlog) | 30–60 |
| PRs from external contributors | 5+ |

---

## Comparison context

These are ballpark industry numbers to put our launch-week targets in realistic context:

- A well-executed Show HN for a developer tool typically lands 200–800 stars in the first 24 hours.
- A "standard" Hacker News front-page post drives 10,000–50,000 site sessions across 48 hours.
- An npm package for a new developer SDK typically sees 10–50 installs on day 1 if the README is good.
- A single inclusion in TLDR Newsletter drives ~2,000–5,000 site sessions.
- Ground News (our consumer comparison): took ~3 years to reach 100K users. Not our target segment, but a reminder that consumer growth is slow.
- WorldMonitor (our open-source peer): 46K+ stars over several years. **We can't match their cumulative; we can aim for a strong launch-day star rate.**

---

## Risks to performance data

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| PostHog key missing at launch | Medium (known to-do) | High — blind launch | Set on Friday, verify on Sunday |
| Scraper dies during launch surge | Low | Medium — feed stops updating | Healthchecks + auto-restart in compose |
| OpenSanctions rate-limit flare | High (chronic) | Low — seed fallback | Already handled |
| Redis fills up | Low | Medium — cache misses | TTL discipline; monitor |
| API DB queries regress under load | Medium | High | Index review by Friday |
| Front-end bundle too big on mobile | Unknown | Medium | Lighthouse run Friday |

---

## Required actions before launch (summary)

1. **Set `NEXT_PUBLIC_POSTHOG_KEY` in prod.** Without this, we're blind on launch day.
2. **Run Lighthouse** on `/`, `/knowledge-graph/explorer`, `/developers` on Friday. Record scores.
3. **Wire a basic uptime monitor** (Better Stack, UptimeRobot, or similar) — 5-min polling on the landing page + API health endpoint.
4. **Capture current social starting numbers** (Twitter, newsletter, HN karma) as a launch-week story anchor.
5. **Verify and disclose** whether "700+ sources" is catalog count or active count. Use the accurate number externally.
6. **Spot-check** 10 signal detail pages and the graph explorer on mobile on Friday.
