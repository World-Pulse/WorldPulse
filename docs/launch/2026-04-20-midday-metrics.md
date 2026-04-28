# WorldPulse — Launch Day Midday Metrics

**Captured:** 2026-04-20, ~12:00 local (T+3h from 09:00 launch wave)
**Reporter:** brain-agent (wp-launch-midday-metrics scheduled task)
**Path note:** Task spec pointed at `/sessions/epic-beautiful-hopper/...`; current session is `dreamy-practical-archimedes`, so the report was written here.

---

## TL;DR

**Overall assessment: BELOW TARGET — with one P0 incident in progress.**

Infrastructure is mostly up and the ingest pipeline is healthy (62,615 signals, +18.9K since Apr 18 evening), but the **public signals endpoint that powers the homepage live feed is returning HTTP 500 due to a `source_url` column schema drift.** Any visitor landing on world-pulse.io right now sees "Loading live headlines…" / "Connecting to signal feed…" placeholders rather than the product. Community traction metrics (GitHub stars, HN presence) are effectively zero three hours in. The 11:50 UTC commit ("Remove breaking alert banner") suggests Devon is actively firefighting frontend issues, which is consistent with what the probes show.

Top priority: **get `/api/v1/public/signals` returning 200 before any more traffic hits the landing page.**

---

## 1. Signal Pipeline — HEALTHY

Source: `GET https://api.world-pulse.io/api/v1/signals/count` (HTTP 200)

| Metric | Value |
|---|---|
| Total signals | **62,615** |
| Last 24h | 8,673 |
| Last hour | 430 |
| Critical | 3,649 |
| High | 10,946 |
| Medium | 10,813 |
| Low | 31,849 |

**Trajectory:** Apr 18 evening snapshot (memory) was 43,684 → +18,931 signals in ~36 hours (~526/hr). Pace is strong; 430/hr right now is lower than the 36h average, so worth keeping an eye on the scraper over the afternoon but not yet a concern.

---

## 2. Site & API Status — MIXED (P0 open)

| Endpoint | HTTP | Median latency | Notes |
|---|---|---|---|
| `https://world-pulse.io` | **200** | 708ms | Shell loads; live-feed sections show "Loading…" placeholders |
| `api.world-pulse.io/health` | **200** | ~300ms | Infra up |
| `api.world-pulse.io/api/v1/health` | **200** | ~700ms | App up |
| `api.world-pulse.io/api/v1/signals?limit=1` | 200 | **~300ms (5-sample median)** | Internal endpoint — working |
| `api.world-pulse.io/api/v1/signals/count` | 200 | 426ms | Working |
| `api.world-pulse.io/api/v1/sources` | 200 | 404ms | Working |
| `api.world-pulse.io/api/v1/public/signals?limit=1` | **500** ❌ | 298–486ms | **Schema drift — see §3** |

### 🔴 P0: Public signals endpoint schema drift

Error (reproduced 3/3 retries):

```
statusCode: 500
code: 42703 (postgres "undefined column")
message: select "id","title","category","severity","reliability_score",
         "location_name", created_at as published_at, "source_url"
         from "signals" where "status" = $1
         order by "created_at" desc limit $2
         — column "source_url" does not exist
```

This is the same failure mode as the Apr 15 schema-drift incident
(`project_signals_schema_drift.md`). The internal `/api/v1/signals`
returns `originalUrls[]` rather than a single `source_url`, so the public
endpoint's SELECT list is out of sync with the live schema.

**Impact:** the homepage "live headlines" feed, global threat index
details, and any embed widget that hits the public endpoint will render
as loading spinners or empty states. The site LOOKS broken to anyone
landing from HN, press, or social.

**Fix (likely one of):**
1. Short-term hot-patch the public route to alias: `(original_urls)[1] AS source_url` or drop `source_url` from the SELECT and return `original_urls` instead.
2. Add back a `source_url` generated/view column aliased to `original_urls[1]`.
3. Redeploy the API image if a fixed version was shipped but container wasn't recreated (cf. `feedback_restart_vs_recreate.md` — `restart` doesn't pick up code changes either; need `up -d --force-recreate`).

---

## 3. API Response Time — HEALTHY (where working)

Five-sample run against `/api/v1/signals?limit=1`:

```
0.293s  0.299s  0.302s  0.303s  0.298s   → median 299ms, σ ≈ 4ms
```

Tight distribution, well under any p95 SLO one would set for a public
JSON endpoint. The broken `/public/signals` fails in ~300–490ms (fails
fast — no connection pool starvation).

---

## 4. GitHub — FAR BELOW TARGET

Source: `https://api.github.com/repos/World-Pulse/WorldPulse` (unauth)

| Metric | Value | Day-1 target | % of target |
|---|---|---|---|
| Stars | **2** | 400 | 0.5% |
| Forks | 0 | — | — |
| Watchers | 1 | — | — |
| Open issues | 0 | — | — |
| Network forks | 0 | — | — |
| Repo size | 3,415 KB | — | — |
| Visibility | public | — | — |

**Latest commit (main):** `07c88ae3` at 2026-04-20 11:50:06 UTC —
*"Remove breaking alert banner - rendering glitch on launch"*. Pushed
~10 minutes before this snapshot. Devon is in the repo actively
shipping fixes.

**Observation:** a repo that went public at 03:16 UTC on Mar 18 and has
2 stars at noon on launch day is not getting any discovery traffic. The
plausible explanations are (a) the launch wave (HN, social, email) has
not actually gone out yet, (b) it went out but the broken live feed is
suppressing conversions, or (c) distribution channels picked it up but
didn't land. §5 and the on-site bug in §2 point at (a) and/or (b).

---

## 5. Hacker News — NOT PRESENT

- Front page (`news.ycombinator.com/front`): no mention of WorldPulse or `world-pulse.io`.
- HN Algolia search (`hn.algolia.com/api/v1/search?query=world-pulse.io`): **0 hits**, ever.

The "HN Top 10" Day 1 target is not achievable without a submission
first existing. As of T+3h there is no Show HN, no story, no comment
thread.

---

## 6. Day 1 Targets — Scorecard

| Target | Actual @ T+3h | Status |
|---|---|---|
| Sessions: 5,000 | **Unmeasurable** — PostHog not installed (memory: `project_integrations.md`, post-launch) | ⚪ unknown |
| GitHub stars: 400 | **2** (0.5%) | 🔴 far below |
| Signups: 150 | **Unmeasurable** — no analytics connector wired | ⚪ unknown |
| HN Top 10 | **Not submitted** (0 HN hits) | 🔴 missed |

The two measurable community metrics are missing by orders of magnitude.
The two unmeasurable metrics can't be assessed — which is itself a
finding: on launch day we have no visibility into sessions or signups,
which makes any "how did launch go" conversation pure inference. Pre-
launch the PostHog gap was classified as acceptable; at T+3h with HN
invisible and stars at 2, the lack of analytics is now blocking
decision-making.

---

## 7. Recommended Actions — prioritized

1. **[P0, <30 min] Fix `/api/v1/public/signals` schema drift.** The homepage live feed is broken. This is the single largest leak in the funnel right now: even if the launch wave goes out in the next hour, every click-through hits a site that shows "Loading…" forever. Hot-patch the SELECT to use `original_urls` (or alias it back to `source_url`), rebuild the API image, and `docker compose up -d --force-recreate api` on prod. Verify with a real curl to the public endpoint before calling it done.

2. **[P0, <60 min] Confirm whether the launch wave actually went out.** Two stars + zero HN hits at T+3h is consistent with "the wave hasn't fired yet" as much as with "the wave fired but flopped". Check: email send receipts, social post timestamps, press outreach replies. If the wave hasn't gone out, holding it until §1 is fixed is the correct call.

3. **[P1, today] Submit a Show HN** once the homepage renders real content. Title convention: `Show HN: WorldPulse – open-source global intelligence network`. Posting to an audience while the live feed is blank would waste the one-shot submission.

4. **[P1, today] Wire minimum analytics.** Even without full PostHog, a 10-line GA4 snippet or a `/api/v1/public/health-metrics` beacon counting unique visits would turn the "sessions" and "signups" targets from ⚪ to measurable. This gap blocks every afternoon-and-later decision.

5. **[P2, today] Add a public `/api/v1/public/signals/count` alias** so the homepage can show "62,615 signals from 300+ sources" as a static-friendly stat. That's the one proof-of-life number we can put on the page that doesn't depend on the broken live feed.

6. **[P2, ongoing] Monitor the scraper.** Last-hour rate (430) is below the 36h average (~526/hr). Not a fire, but if wp_scraper is the single-point-of-failure the memory says it is (`project_scraper_pipeline.md`), a stall on launch day would compound the feed-is-empty problem.

---

## 8. Raw evidence (for follow-ups)

- Error body from `/api/v1/public/signals`: see §2 code block — column 42703 `source_url` does not exist.
- `/api/v1/signals/count` body: `{total:62615, last24h:8673, lastHour:430, bySeverity:{critical:3649, high:10946, medium:10813, low:31849}}`.
- GitHub API pushed_at: `2026-04-20T11:50:08Z`; last commit message: *"Remove breaking alert banner - rendering glitch on launch"*.
- Site hero: title "WorldPulse — Global Intelligence Network", "Global Threat Index: ELEVATED" card present; all feed sections in loading states.
- HN Algolia `nbHits` for `world-pulse.io`: 0.

---

*Next scheduled snapshot: EOD (18:00) — by then we need the public endpoint green, the wave confirmed out, and at minimum a GA4 ping wired.*
