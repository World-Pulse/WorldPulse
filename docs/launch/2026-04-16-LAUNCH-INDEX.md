# Launch Week Reference Index — 2026-04-16

**T-minus 4 days to launch (Monday 2026-04-20).** Site is live, ~20K signals and climbing, core bugs resolved. This directory contains the full launch package produced on Apr 16 in one continuous work session.

---

## Read these first

0. **[2026-04-16-master-roadmap-apr17-20.md](./2026-04-16-master-roadmap-apr17-20.md)** — **the execution spine.** 4-day plan with Product / Growth / Automation lanes, end-of-day gate checks, 4-tier paid budget menu, scope-cut list.
1. **[2026-04-16-production-fixes.md](./2026-04-16-production-fixes.md)** — what shipped today (signal-detail fix, sanctions fallback, deploy-pipeline trap)
2. **[2026-04-16-code-review-prelaunch.md](./2026-04-16-code-review-prelaunch.md)** — pre-public sweep. **Contains one P0 action: rotate the live Stripe key in `.env.prod` today.**
3. **[2026-04-16-campaign-plan-apr16-20.md](./2026-04-16-campaign-plan-apr16-20.md)** — 5-day day-by-day launch runbook, Thursday through Monday

## Read these before Sunday

4. **[2026-04-16-competitive-seo-battlecard.md](./2026-04-16-competitive-seo-battlecard.md)** — positioning vs Factiverse, GDELT, WorldMonitor, + 12 SEO keyword clusters, + one-page battlecard
5. **[2026-04-16-brand-voice-guidelines.md](./2026-04-16-brand-voice-guidelines.md)** — voice in 3 adjectives, word bank, kill list, founder voice patterns
6. **[2026-04-16-design-critique.md](./2026-04-16-design-critique.md)** — 10 ship-quality items for Friday click-through, page-by-page review
7. **[2026-04-16-performance-baseline.md](./2026-04-16-performance-baseline.md)** — metrics starting point + launch-day + week-1 + month-1 targets

## Read these before launch morning

8. **[2026-04-16-user-research-plan.md](./2026-04-16-user-research-plan.md)** — launch-week intercept interviews + competitor UX teardown + synthesis framework

---

## Launch-week to-do checklist (aggregated)

### Today (Thursday Apr 16) — P0
- [ ] Rotate live Stripe key + webhook secret (see `2026-04-16-code-review-prelaunch.md`)
- [ ] Rotate `JWT_SECRET` in prod
- [ ] Confirm signal count > 22K by morning Friday
- [ ] Draft launch blog post, Show HN post, tweet thread, LinkedIn post

### Friday Apr 17 — P1
- [ ] Set `NEXT_PUBLIC_POSTHOG_KEY` in prod (baseline analytics)
- [ ] Run Lighthouse on `/`, `/knowledge-graph/explorer`, `/developers`
- [ ] 15-minute click-through using the design critique checklist
- [ ] Soft-circulate to 25 newsletters + 10 friendly devs
- [ ] Finalize demo video for graph explorer (60 sec, no voiceover)
- [ ] Screenshot suite exported at 2x
- [ ] Capture starting social/newsletter numbers for post-launch comparison

### Saturday Apr 18 — P1
- [ ] Press embargo emails to 10 journalists + 5 analysts
- [ ] Dry-run launch sequence with team
- [ ] Pre-schedule Monday social posts

### Sunday Apr 19 — dark day
- [ ] Add `SECURITY.md` and `CODE_OF_CONDUCT.md` at repo root
- [ ] Rotate Postgres + Redis + Meilisearch passwords
- [ ] Rest. Re-read README once. Fix one thing.

### Monday Apr 20 — launch day
- [ ] 9:00am ET repo public
- [ ] 9:30am ET blog post live
- [ ] 10:00am ET coordinated wave (HN, Twitter, LinkedIn, Discord, newsletter)
- [ ] Founder available 10:30am–1pm for reporter calls + HN replies
- [ ] 5pm ET end-of-day metrics + team debrief
- [ ] 8pm ET dark

---

## Targets summary

| Metric | Day 1 floor | Day 1 target | Day 1 stretch |
|---|---|---|---|
| Site sessions | 2,500 | 5,000 | 15,000 |
| GitHub stars | 150 | 400 | 1,500 |
| SDK installs | 20 | 60 | 200 |
| Signups | 50 | 150 | 400 |
| HN peak rank | Top 30 | Top 10 | Front page |
| Newsletter mentions | 2 | 3 | 6+ |

Full baseline + week-1 + month-1 targets in `2026-04-16-performance-baseline.md`.

---

## Positioning locked-in for the week

> WorldPulse is the open-source global intelligence network. Real-time signals from 700+ sources, multi-modal claim verification (text, audio, video), and an interactive knowledge graph — MIT-licensed, self-hostable, with a developer SDK.

**Voice:** Verified. Unafraid. Real. (Reuters meets GitHub.)

**Unique wedge:** open-source + knowledge graph + developer SDK, in one. No competitor has the intersection.

**What we own on launch day:** the Full Graph Explorer (unique UX), MIT license (vs WorldMonitor's AGPL), developer-first API (vs Factiverse's sales-gate), claim-level scoring (vs NewsGuard's source-level).

---

## Risk register (top 5)

1. **HN post buried by a bigger launch.** Mitigation: time to 10:30am ET, have variant ready.
2. **Site crashes under load.** Mitigation: cache primed Friday, extended TTLs, seed fallbacks, Sentry alerts by Apr 27.
3. **OpenSanctions rate-limits again.** Mitigation: seed fallback already live (14 entities guaranteed).
4. **Critical bug found in public code.** Mitigation: code review sweep today, 24h bug-bounty window.
5. **Negative HN comment storm.** Mitigation: founder responds personally, with data, not defensively.

---

## What to monitor after launch

- **Competitor moves:** Factiverse Gather updates, GDELT TV archive iterations, WorldMonitor release cadence, any new entrants.
- **Source drift:** if any of the 700+ feeds stops producing for > 6h, flag.
- **Rate-limit patterns:** OpenSanctions, any other upstream with aggressive throttling.
- **User-reported bugs:** tag and triage GitHub issues in the first 72h.
- **SEO ranks:** track the 12 keyword clusters weekly. Not daily — weekly.
- **Analytics signals:** funnel drop-offs, graph-explorer session depth, SDK installs vs signups.

---

## What NOT to do

- Don't rewrite product copy after Sunday. Lock it.
- Don't add new features before launch. All improvements are held for v1.1.
- Don't engage with bad-faith critics. One reply, then mute.
- Don't launch on Tuesday because Monday felt soft. Commit to the date.

---

**Prepared:** Apr 16 2026
**Authoritative source on any conflict:** the prod server state. These docs are advisory — the code + prod are the truth.
