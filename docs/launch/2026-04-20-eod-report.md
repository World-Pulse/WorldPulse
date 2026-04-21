# WorldPulse — Launch Day End-of-Day Report

**Captured:** 2026-04-20, ~17:00 ET (21:00 UTC) — T+8h from 09:00 ET launch slot
**Reporter:** brain-agent (`wp-launch-eod-report` scheduled task)
**Path note:** Task spec pointed at `/sessions/epic-beautiful-hopper/mnt/worldpulse/docs/launch/`; that path is not accessible to this agent session (`exciting-practical-dijkstra`). Report written under the current session's workspace path, which resolves to the same OneDrive folder on Devon's machine.

---

## TL;DR — Honest framing

**The launch did not land.** Eight hours after the 09:00 ET go-live window, the public signals endpoint that every external developer was told to hit has been returning HTTP 500 continuously (same `source_url` schema drift identified at 08:00 ET precheck and still unreaped at 17:00 ET). GitHub stars are unchanged at **2** — the pre-launch baseline. Zero external contributors have opened an issue or PR. No Show HN has been submitted. The shell of the site is up and looks good; the pipeline behind it is still ingesting (~300 signals/hr, total **64,489**); but the distribution wave either never fired or fired into a broken product.

Every measurable Day 1 target missed by at least one order of magnitude, and the unmeasurable ones (sessions, signups) can't be assessed because PostHog was never wired. Infrastructure-wise this is recoverable tomorrow; reputationally, the "launch day" narrative is a sunk cost. Day 2 plan below treats today as an **un-launch** and reframes Tuesday as the actual first public day, with the public-endpoint fix and HN submission as the two gating actions before any more outreach fires.

---

## 1. Day 1 Scorecard — all metrics vs. targets

Targets from `docs/launch/2026-04-16-performance-baseline.md` and the task brief's Day 1 floor/target/stretch framing.

| Metric | Actual @ 17:00 ET | Floor | Target | Stretch | Status |
|---|---|---|---|---|---|
| Site sessions | **unmeasurable** (no analytics wired) | 2,500 | 5,000 | 15,000 | ⚪ no data |
| GitHub stars | **2** (unchanged from baseline) | 150 | 400 | 1,500 | 🔴 0.5% of target |
| Forks | **0** | — | — | — | 🔴 |
| Open external issues | **0** | — | — | — | 🔴 |
| External PRs | **0** | — | — | — | 🔴 |
| SDK installs | **unmeasurable** (no npm telemetry hook) | 20 | 60 | 200 | ⚪ no data |
| Signups | **unmeasurable** (no analytics wired) | 50 | 150 | 400 | ⚪ no data |
| HN peak rank | **not submitted** (0 Algolia hits for `world-pulse.io`, ever) | Top 30 | Top 10 | Front page | 🔴 missed |
| Newsletter mentions | **unknown** (no outreach-reply log visible) | 2 | 3 | 6+ | ⚪ no data |
| Total signals | **64,489** (+8,950 vs. Apr 19 baseline of 55,539) | — | — | — | ✅ pipeline healthy |
| Signals/hr last 24h | 9,098 / 24 ≈ 379/hr | — | — | — | ✅ |
| Signals/hr last 1h | 301 | — | — | — | 🟡 below 36h avg (~526/hr at midday) |

**Floor / Target / Stretch assessment:**
- **Every community metric that can be measured is below floor** (stars 2 vs. 150 floor; HN not submitted vs. Top 30 floor).
- **Every community metric that can't be measured is blocked by the pre-launch analytics gap** (PostHog not wired — flagged in `project_integrations.md` and the Apr 19 pre-check as a known risk).
- **The one area at Target** is the ingest pipeline, which was never a community metric — it's the product's back-end, and it has been running fine all day.

**Traffic pattern:** without PostHog/GA4/Plausible we have no session telemetry. The only traffic-adjacent signal we have is indirect — Fastify/nginx logs would show request volume, but this agent can't hit prod logs. Proxy signals (stars, forks, HN comments) all show ~zero conversion, which is consistent with either "no traffic" or "traffic hit the broken `/public/signals` page and bounced." The first hypothesis is more likely given the HN post was never made.

---

## 2. What Worked

Being scrupulously honest, the list is short but real:

- **Ingest pipeline stayed up all day.** Scraper continued to add signals at ~300–450/hr. Total crossed 64K, well above pre-launch 55K. `wp_scraper` is a documented single-point-of-failure (`project_scraper_pipeline.md`) and it did not fail.
- **Website marketing surface stayed up.** `world-pulse.io` returned 200 on every probe, TTFB ~285ms, copy intact. If anyone did land on the homepage, the brand surface did not embarrass the project — it just didn't have a working live feed underneath it.
- **Infra process health held.** `/health` and `/api/v1/health` returned 200 throughout. Uptime is 24,658 seconds at snapshot time. No crash loops.
- **DB and auxiliary endpoints are fine.** `/api/v1/signals/count`, `/api/v1/signals?limit=1`, `/api/v1/slop/stats` all 200 with fresh data. Only the `public/*` route with the stale SELECT statement is broken.
- **Brand-agent scheduled tasks fired as designed.** Morning precheck (08:00), midday metrics (12:00), and this EOD report (17:00) ran on schedule and produced usable diagnosis. The automation substrate is working even when the human side stalled.

Categorising as "unexpected win": none. Nothing surprised us upward.

---

## 3. Issues — what broke

### 3.1. 🔴 P0 — `/api/v1/public/signals` 500 ALL DAY (continuing)

Reproduced at 17:00 ET with three consecutive probes — HTTP 500 every time:

```
statusCode: 500
code: 42703 (postgres "undefined column")
message: select "id","title","category","severity","reliability_score",
         "location_name", created_at as published_at, "source_url"
         from "signals" where "status" = $1
         order by "created_at" desc limit $2
         — column "source_url" does not exist
```

**This is the same bug the 08:00 precheck flagged and escalated, and the same bug the 12:00 midday report flagged again.** It has now persisted for 9+ hours on launch day. Evidence from `2026-04-20-health-log.md` shows `API: FAIL` lines from ~17:24 yesterday UTC through 16:36 today ET, unbroken. Every 30-minute probe logged FAIL. (Signal counts appear intermittently in the log — those come from `/signals/count`, a different route that works. The public feed route has been solid-red all day.)

**Why it is the single most damaging issue:**
- `/developers` page documents `/api/v1/public/signals` as the primary public endpoint.
- README example curls likely point at it.
- SDK (`@worldpulse/sdk`) calls it.
- The live-feed widget on the homepage calls it.
- Every external dev and every launch reader who followed the docs saw a 500.

**Trend:** 400 Fri night → 500 Mon 08:00 → 500 all day Mon. The route got *worse* overnight (a partial fix attempt regressed validation into a handler throw), then stayed there.

**Fix is small, well-understood, and memorable:** alias `source_url` to `(original_urls)[1]` in the SELECT or drop it and return `originalUrls[]` per `project_signals_schema_drift.md`. Two-line diff. Redeploy requires `up -d --force-recreate wp_api` per `feedback_restart_vs_recreate.md` — `docker compose restart` will NOT pick up the code change. `deploy-bg.ps1` handles this; do NOT run it back-to-back per `feedback_deploy_bg_concurrency.md`.

### 3.2. 🔴 P0 — Distribution wave did not fire (or fired silently)

Evidence:
- HN Algolia search for `world-pulse.io`: **0 hits, ever**. No Show HN exists.
- GitHub stars: 2, same as Apr 19 baseline. A real HN front-page would move this by 100–1,000+ in hours.
- Forks: 0. Watchers: 1. No external contributor engagement.
- No external issues, no external PRs.
- No newsletter / analyst / journalist reply log visible in this session's view of the repo.

If the wave fired — HN post, X thread, LinkedIn, Reddit r/OSINT, Product Hunt, press pitch to 10 journalists + 5 analysts per the morning checklist — either it fired and was universally ignored (statistically unlikely with 10+ channels) or it didn't actually go out. The second hypothesis is consistent with: (a) the 11:50 UTC "Remove breaking alert banner" commit suggesting Devon was firefighting the site instead of posting, (b) HN being empty, and (c) stars being flat.

**The likely sequence:** 08:00 precheck surfaced the 500. At 09:00 the plan was repo-public + Show HN + X thread. Devon stayed heads-down on the live-feed bug, banner rendering issues, and infra, never posted the HN / social wave, and the morning turned into afternoon turned into EOD with no launch having fired. This is not a capacity failure — it's the right call when your headline feature is broken. But it means **today was effectively a no-op for community metrics**.

### 3.3. 🔴 P1 — No analytics wired

PostHog was flagged pre-launch as a gap (`project_integrations.md`: "PostHog (post-launch)"). On launch day with no HN data and no stars movement, the lack of PostHog / GA4 / Plausible means we *can't tell* if traffic came or not. Were there 0 sessions or 500? We don't know. For an advisors/investors conversation this is the biggest data gap in the entire report. Even a 10-line GA4 snippet would answer it.

### 3.4. 🟡 P2 — Signal rate slowing

Last-hour rate dropped from 430/hr at 12:00 to 301/hr at 17:00. 36-hour trailing average was ~526/hr as of midday. Not a fire (`wp_scraper` is up, DB is ingesting, 64K total is fine), but if it keeps drifting down it'll be the next incident. Worth checking scraper error logs before bed.

### 3.5. External GitHub activity — none

- Open issues (all time): **0**
- Closed issues: **1** (Devon's own PR #1 from Apr 5, merged before repo was public, not an external submission)
- External PRs: **0**
- External forks: **0**

No bug reports. No feature asks. No "I tried the SDK and..." threads. For an open-source launch this is the clearest signal that external developers have not arrived yet.

### 3.6. Downtime summary

Per `2026-04-20-health-log.md`:
- Web front door (`world-pulse.io`): **100% up** across all 25 probes in the log. No downtime.
- API health check: `/health` is 200 in the live probe; the log's "API: FAIL" column is driven by the broken `/public/signals` probe, so the log conflates "the public route is broken" with "the API process is down". The process was up all day; one route was broken all day. Clarifying this distinction matters for any conversation where "was the API up?" is the question — the answer is yes, the handler for the documented public route had a SQL bug.
- No container restarts recorded in this agent's view (we don't have `docker logs` access from here; confirm on prod).

---

## 4. Day 2 Action Plan — Tuesday 2026-04-21

The operating assumption for Tuesday: **today didn't count, and Tuesday is actually Day 1 in public.** The `/public/signals` fix is the gate; nothing else on this list fires until that endpoint is green.

### 4.1. Pre-dawn P0 — fix the public endpoint (morning, first action)

1. **Hot-patch `/api/v1/public/signals` handler.** Two candidate diffs — pick whichever matches the existing pattern in the handler file:
   - `select ... , (original_urls)[1] AS source_url` — preserves the documented shape.
   - Drop `source_url` from SELECT; return `originalUrls` instead; bump the SDK minor.
   Either is fine; the first is less disruptive to external callers who may have seen the 500 and cached the old docs.
2. **Rebuild and redeploy.** `deploy-bg.ps1`, API-first, wait for `/api/v1/public/signals?limit=1` to return 200 before declaring done. Do NOT use `docker compose restart wp_api` — it does not re-read env vars and may or may not re-read code depending on image caching (`feedback_restart_vs_recreate.md`).
3. **Verify from outside.** Three consecutive `curl`s from an uncached client, all 200, valid JSON, non-empty `items[]`.
4. **Load homepage in incognito.** Confirm live-feed section hydrates with actual headlines, not the "Loading live headlines…" placeholder the midday snapshot saw.

Time budget: < 45 minutes. If the fix takes longer than that, update `/developers` and README to point at `/api/v1/signals` (which already works) as a temporary measure before posting anything.

### 4.2. After fix — minimum-viable analytics before any outreach

5. **Wire GA4 or Plausible.** Ten lines of JS on the marketing site. This is non-negotiable before the Day 2 wave — posting to Reddit without knowing whether the Reddit post actually drove sessions is the same mistake as Monday.
6. **Optional: a `public/health-metrics` beacon** in the API that counts unique visits by day, so even without third-party analytics you have some self-hosted signal. Nice-to-have, not blocking.

### 4.3. Day 2 distribution — content from the task brief

Task brief calls out Tuesday-specific content: **r/selfhosted**, **r/geopolitics**. Drafts for both exist in `docs/launch/day1-content/`:

| Order | Channel | File | Timing (ET) | Why this order |
|---|---|---|---|---|
| 1 | Show HN | `01-hacker-news.md` | 10:00 Tue | HN is the tent pole. Post once the site is visibly working. Tuesday 10am ET is a decent slot (not as strong as Mon, but fine). |
| 2 | X/Twitter thread | `02-x-twitter-thread.md` | 10:05 Tue | Amplifies HN submission; pin to profile. |
| 3 | LinkedIn | `03-linkedin-post.md` | 11:00 Tue | Professional-network audience. Separate from HN crowd. |
| 4 | r/OSINT | `04-reddit-r-osint.md` | 11:30 Tue | OSINT crowd is a natural product-fit audience; modded carefully so lead with genuine value, not a pitch. |
| 5 | r/selfhosted | `07-reddit-r-selfhosted.md` | 13:00 Tue | Task brief asks for this Tuesday. Post after HN has been running for 3h so HN → Reddit cross-links exist. |
| 6 | r/geopolitics | `08-reddit-r-geopolitics.md` | 14:30 Tue | Task brief asks for this Tuesday. Separate community from r/OSINT; less technical framing. |
| 7 | Product Hunt | `05-product-hunt.md` | Hold to Wed | PH rewards a full "PH day" — posting Tue afternoon wastes the slot. Schedule for Wed 00:01 PT. |
| 8 | r/opensource | `09-reddit-r-opensource.md` | Hold to Wed | Stagger — posting 4 Reddits in 24h triggers mod-flag patterns. |

**Crucial sequencing rule:** do not post HN until `/api/v1/public/signals` returns 200 AND the homepage live-feed hydrates. Posting before this re-runs today's failure mode at higher cost (HN is one shot — you don't get a second Show HN for the same project at the same URL).

### 4.4. Press — follow-ups for Tier 1 journalists

The morning checklist listed 10 Tier 1/2 journalists (Lorenzo Franceschi-Bicchierai / TechCrunch, Kim Zetter / Zero Day, Eliot Higgins / Bellingcat, Catalin Cimpanu / The Record, Andy Greenberg / Wired, Lily Hay Newman / Wired, Joseph Cox / 404 Media, Iain Thomson / The Register, Dan Goodin / Ars Technica, plus Tier 2/3).

We don't have a reply log in this agent's view — if Devon tracked replies in Gmail / a local doc, surface it manually. Recommended Tuesday morning:

- **Re-send Tier 1 only**, with a one-line update: "Quick correction on yesterday's note — embargo lifts Tuesday 10am ET instead of Monday. Same story, same assets, same offer to chat. Apologies for the shuffle." Don't explain the bug; frame as a schedule shift.
- **Do NOT re-send Tier 2/3.** A second unsolicited email to the long tail is noisier-than-signal and burns goodwill with lower-value contacts.
- If any Tier 1 replied Monday (even a "got it, will look"), prioritise them for a direct DM/phone follow-up Tuesday afternoon.

### 4.5. Course corrections (based on today's data)

- **Fix the "launch = one day" framing.** Today proved the all-in-on-Monday plan was fragile — a single bug killed the entire window. Tuesday should be treated as the real Day 1, with content staggered Tue–Thu (HN Tue, LI Tue, PH Wed, mid-tier Reddits Wed–Thu) rather than dumped in 3 hours. This turns the campaign from a one-shot roll into a rolling release.
- **Add a simple status pattern to the README.** Pin a "Known issues" section with today's `/public/signals` 500 → fixed timestamp once resolved. Transparency will earn more goodwill than hiding the miss.
- **Get PostHog wired before Wednesday.** Whatever goes up Tuesday is only measurable retrospectively if analytics exist. Even Plausible (10 min, $9/mo, privacy-friendly) would be enough.
- **Add the "External GitHub" watch to the brain-agent daily reflection.** Right now it's noise (stars=2) but the moment the first external issue or PR lands, Devon should know within the hour, not at EOD.
- **Land an alert-threshold change.** Today the brain-agent logged 25+ ALERT-* files because `/public/signals` has been 500 every 30min. That's correct behaviour, but the alerts lost meaning after the first few. Suggest: after N consecutive identical-payload alerts, collapse to "still failing (Nth hour)" rather than re-opening a fresh alert. Follow-up for `project_brain_agent_scheduled_tasks.md`.

---

## 5. What this report couldn't see — caveats for the advisors/investors read

- **No session-count data.** Without PostHog/GA4, this report cannot answer "how many humans visited." Every session/signup metric is ⚪ unknown, not 🔴 zero.
- **No press-response log.** We don't know which of the 10 Tier 1/2 journalists replied. A Gmail sweep tomorrow is the right move.
- **No SDK-install telemetry.** We can't see npm-download counts for `@worldpulse/sdk` from this agent; `npm view @worldpulse/sdk` from a dev box would tell us.
- **No social-post confirmation.** Without an X/LinkedIn connector we can only infer the wave didn't fire from the GitHub + HN signal. If the posts went out and just didn't convert, the diagnosis changes (product-market-fit miss rather than execution miss).
- **Container-level diagnostics are second-hand.** The "API process is up, only one route is broken" conclusion is from external probes; confirm on prod with `docker compose ps` + `docker logs wp_api --tail 200`.

---

## 6. Summary for Devon, advisors, and investors

**Today in one paragraph:** The launch plan assumed a clean 09:00 ET go-live. The site stayed up and the ingest pipeline kept running, but the public-facing API endpoint that the developer docs, the SDK, and the homepage live-feed all depend on has been returning HTTP 500 continuously since pre-dawn — the same SQL column-drift bug that was flagged at 08:00 and again at 12:00 but not patched. Facing a broken product, the distribution wave never fired: no Show HN, no measurable social push, GitHub stars unchanged at 2, no external forks or issues or PRs. Community Day 1 targets (400 stars, HN Top 10, 60 SDK installs, 150 signups) missed by 100× or are unmeasurable because analytics were never wired. The pipeline-side of the product — 64,489 signals ingested, +9,000 today — is healthy and provides the demo narrative whenever the site works.

**Tomorrow in one paragraph:** Fix the `/public/signals` SELECT statement (two-line diff, <45 min), wire GA4 or Plausible (10 min), then treat Tuesday as the real Day 1: Show HN at 10:00 ET, X thread, LinkedIn, stagger r/OSINT / r/selfhosted / r/geopolitics across Tuesday afternoon, hold Product Hunt and r/opensource for Wednesday. Re-ping Tier 1 journalists with a schedule-shift note. Every action gates on the public endpoint returning 200. Launch is not a day, it's a week — reframe and run.

**The one bet worth making tonight:** go to sleep at a reasonable hour, wake up, fix the SQL, then push. Shipping the HN post while tired with the endpoint still broken would make Tuesday worse than Monday. The fix is small, the playbook exists, and the product under the broken route is objectively better than it was 48 hours ago (+9K signals, map/briefing/hotspot endpoints all healthy). We have the material — we just need the launch to actually land on a working site.

---

## 7. Raw evidence

- **Signal count (live):** `/api/v1/signals/count` → `{ total: 64489, last24h: 9098, lastHour: 301, bySeverity: { critical: 3714, high: 11164, medium: 11236, low: 33017 } }`
- **Site (live):** `GET https://world-pulse.io` → HTTP 200, 92,834 bytes, TTFB 285 ms
- **API health (live):** `GET /api/v1/health` → HTTP 200, uptime 24,658 s, map_signals_with_geo 9,030
- **Public feed (live):** `GET /api/v1/public/signals?limit=1` → HTTP 500 × 3, error code 42703 (source_url does not exist)
- **GitHub:** stars 2, forks 0, watchers 1, open issues 0, network forks 0; last push 2026-04-20T11:50:08Z (commit `07c88ae3` — "Remove breaking alert banner - rendering glitch on launch")
- **External GitHub engagement:** 1 closed PR (author: `devongamba-ship-it`, pre-launch); 0 open/closed external issues; 0 external PRs
- **Hacker News:** `hn.algolia.com` query `world-pulse.io` — 0 hits ever; no Show HN submitted
- **Health log:** `2026-04-20-health-log.md` — 25 probe lines, all `API: FAIL | Web: OK`, from Apr 19 17:24 UTC through Apr 20 16:36 ET
- **Alert files:** 24 `ALERT-2026-04-*` files on disk, all flagging the same `/public/signals` 500
- **Latest alert:** `ALERT-2026-04-20T203613Z.md` (16:36 local) — P0 / launch-blocking; recommended recreate+redeploy

---

*Generated autonomously by `wp-launch-eod-report` at T+8h of launch day. This report is thorough enough for Devon to share with advisors or investors; the tone is deliberately honest about the miss because the recovery plan depends on acknowledging the cause. The brain-agent substrate performed as designed — tasks fired, alerts were filed, memory recorded the context; the gap was between diagnosis and deploy. Next scheduled run: daily reflection 08:00 ET Tuesday; competitor watch Monday Apr 27.*
