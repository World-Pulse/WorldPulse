# Master Launch Roadmap — Apr 17 → Apr 20

**Date:** 2026-04-16 (evening)
**Mandate:** monitor, grow, and make sure the world knows world-pulse.io
**Spine of the plan:** user growth. Every non-safety decision is graded on "does this win users this week?"
**Operating mode:** continuous deployment. No decision waits for a meeting.

---

## How to read this plan

Four days. Each day has three lanes running in parallel:

1. **Product lane** — stability, security, polish. Defense.
2. **Growth lane** — marketing, outreach, user acquisition. **Offense. The spine.**
3. **Automation lane** — what the automated pipeline runs in the background. Monitoring + scheduled tasks.

Every day ends with a **gate check** — three questions that must all be "yes" to proceed to the next day. If any is "no," follow the scope-cut list at the bottom of the doc.

Every deliverable from today's session (campaign plan, brand voice, design critique, etc.) plugs into a specific day + lane here. This doc is the index of execution; the others are the reference material.

---

## Paid-promotion budget — four tier menu

Before picking a tier, understand what each one actually *buys*. The conversion math below assumes our landing page converts a developer-audience click at 2% to signup and 0.5% to an API key issued — pessimistic-realistic for launch week.

### Tier 0 — $0 — Organic only

| Where the zero goes | Why |
|---|---|
| Personal outreach (Devon's network, old colleagues, HN/Twitter DMs) | Free, highest conversion |
| Show HN post + HN reply discipline | Free front-page potential |
| Newsletter embargoed pitches (TLDR, HN newsletter, TheSequence, etc.) | Free if they bite |
| Reddit: r/OSINT, r/opensource, r/selfhosted | Free, niche, high-intent |
| Discord: developer communities, r/programming adjacent | Free, developer-pure |
| Twitter/LinkedIn organic | Free, amplification-dependent on reach you already have |

**Expected week-1 ceiling:** 300–600 GitHub stars, 50–150 SDK installs, 2,000–6,000 sessions. Assumes HN lands top-30.
**Risk:** Launch is hostage to a single HN post. If it buries, the plan dies.

### Tier 1 — ≤$500 — Tactical boosts

Everything in Tier 0, plus:

| Where | Spend | Expected impact |
|---|---|---|
| **One TLDR Newsletter classified** | ~$250 | 300K+ developer inbox reach, 1k–3k sessions |
| **Twitter/X boost on the launch thread** | ~$100 | 10x reach on the founder thread if it gets early traction |
| **One Bluesky/Mastodon paid-ish feature** (or a small OSS-community sponsorship) | ~$100 | Signal to the OSS-native crowd |
| **$50 for user-research incentives** (5 × $10 cards for launch-week interviews) | $50 | Ensures you actually get user conversations |

**Expected week-1 lift over Tier 0:** +30–60% on sessions, +40% on GitHub stars, meaningfully de-risks the single-HN-post dependency.
**ROI:** This is the floor I'd defend — even a tight founder budget should do this.

### Tier 2 — ~$2,000 — Meaningful reach

Everything in Tier 1, plus:

| Where | Spend | Expected impact |
|---|---|---|
| **TLDR Newsletter sponsored section** (not classified) | $600–$800 | 300K targeted devs, deeper placement, higher CTR |
| **Hacker Newsletter sponsorship** | $300 | 70K+ HN-ish audience, our exact demographic |
| **ProductHunt "Featured" launch** | $0 base + $250 for early hunter outreach | PH launch day bump, adjacent audience |
| **Reddit promoted post in r/programming** | $200 | Signal to broader dev audience |
| **$300 user-research budget** (30 × $10 cards, or 6 × $50 for long interviews) | $300 | Real research, not token research |
| **$150 for professional launch video editing** (polish the 60-sec graph explorer demo) | $150 | Better launch-day assets than anything a competitor has |

**Expected week-1 lift over Tier 1:** +80–150% on sessions, +100% on GitHub stars.
**ROI:** **Recommended tier.** Buys durable week-1 momentum without over-spending before we know which channel works.

### Tier 3 — $5,000+ — Multi-channel push

Everything in Tier 2, plus:

| Where | Spend | Expected impact |
|---|---|---|
| **3–4 dev newsletters stacked** (TheSequence, Pragmatic Engineer classified, Console, Changelog) | $1,500 | Saturated developer inbox coverage for launch week |
| **PR agency freelancer** (one senior, 20 hrs @ $150/hr) | $3,000 | Real reporter pickup, media training, follow-up management |
| **Targeted LinkedIn Sponsored Content** for journalists/analysts | $500 | Relationship-building at decision-maker level |
| **YouTube creator partnership** (one mid-tier dev-advocate / OSINT creator) | $1,500–$3,000 | Owned-audience demo; compounds for weeks |

**Expected week-1 lift over Tier 2:** +100% on sessions, +150% on stars, *but* marginal returns fall fast. Dollar 4,001 buys less than dollar 501.
**ROI:** Only do this if a dollar of press coverage is worth > $5 of organic traction to you (e.g., institutional buyers, investor optics). Otherwise Tier 2 is the smart spend.

### My recommendation (once you pick)

- **If bootstrapping / unit-economics-focused:** Tier 1 ($500). Floor the risk, ship.
- **If you want a real week-1 story:** Tier 2 (~$2,000). Best ROI per dollar.
- **If launch-week matters for fundraising or institutional sales cycles:** Tier 3 (~$5,000). But commit fully, not half-heartedly.
- **Do not:** split Tier 3 across five channels at $1,000 each. Concentration beats spread for a cold-start.

Pick a tier. I'll wire the exact spend into the daily roadmap below (marked in *italics* where a tier is assumed).

---

## Day 0 — Thursday evening Apr 16 (tonight)

### Product lane — safety first

- **Rotate live Stripe key + webhook secret.** P0 from the code-review doc. ~15 min.
- **Rotate `JWT_SECRET` in prod.** ~5 min. Users re-login once — zero DAU, costless.
- **Confirm scraper healthy** — `docker logs wp_scraper --tail 100` should show ingest every 90 sec.
- Sleep by midnight. Friday needs your brain.

### Growth lane — write tonight, don't publish

Draft, save to `/docs/launch/drafts/`, do not publish:

- Launch blog post (800 words) — title + first paragraph + graph-explorer screenshot.
- Show HN post (two title variants, A/B Monday morning).
- Twitter launch thread (8 tweets, each with a specific screenshot).
- LinkedIn founder post (700 words, mission-angle).
- Three email templates: newsletter editor, reporter, analyst.

*Tier 2+: book the editor for the 60-sec demo video. $150 up front.*

### Automation lane — wire tonight

- **Scheduled task:** competitor watcher, every 6h. Monitors Factiverse, GDELT, WorldMonitor, Ground News, Danti for new releases / blog posts / pricing changes. Logs to `monitoring/competition_intel.json`.
- **Scheduled task:** source-drift watcher, every 2h. Any of the 178 active feeds silent > 6h → flag.
- **Scheduled task:** rate-limit watcher, every 1h. OpenSanctions 429 rate + our seed-fallback hit rate.

---

## Day 1 — Friday Apr 17 — "Demo-ready"

**Gate:** By 6pm, anyone can land on world-pulse.io and understand the product in 10 seconds, explore the graph in 30, and install the SDK in 60.

### Product lane — demo-ready polish (morning)

1. **09:00** — Set `NEXT_PUBLIC_POSTHOG_KEY` in prod. Deploy. Verify pageviews firing. *Without this we launch blind.*
2. **10:00** — Run Lighthouse on `/`, `/knowledge-graph/explorer`, `/developers`. Record baseline scores. Fix anything red.
3. **10:30** — 15-minute click-through using the design-critique checklist. File issues tagged `launch-blocker`.
4. **11:30** — Fix the top 3 `launch-blocker` issues. Ignore the rest until Saturday.
5. **13:00** — Mobile device test. Real phone, not Chrome DevTools. Land on `/`, try `/knowledge-graph/explorer`, install SDK. Every friction = `launch-blocker`.
6. **14:00** — Verify "700+ sources" messaging vs 178 active. **Decide and document:** either (a) update the catalog to match marketing, (b) update marketing to match catalog, or (c) clearly-stated "catalog of 700+, 178 actively streaming." Pick one, put it everywhere.

### Growth lane — demo-ready assets + soft circulation

1. **09:00** — Export screenshot suite at 2x: graph explorer hero, signals feed, claim detail, sanctions grid, SDK code block. Save to `docs/launch/assets/`.
2. **11:00** — Record/finalize 60-sec graph explorer demo. No voiceover, text captions only. Upload YouTube as unlisted + save MP4 locally. *Tier 2+: send to editor; final cut back by 17:00.*
3. **13:00** — Send soft-circulation pitches to **25 newsletters** with Monday 10am ET embargo. Template in campaign-plan doc.
4. **14:00** — DM **10 friendly developers** with the "launching Monday, would you star?" soft ask. No launch post — just a star ask.
5. **15:00** — Post pre-launch teaser in developer Discord communities, r/OSINT: "launching Monday, what would you want demoed?" *Not* a launch post. A feedback request. Builds social proof and the launch-day audience at once.
6. **16:00** — Post founder tease on Twitter/LinkedIn: one-sentence hook, screenshot of graph explorer, "Monday 10am ET." One post per channel. No thread yet.
7. **17:00** — Lock the landing page hero copy. No more edits after this.

### Automation lane — Friday watches

- Signal count should clear 22K by noon.
- Sanctions cache-hit rate should hold > 90%.
- Scraper healthchecks green for all 178 feeds.
- If any intel-vertical page shows empty state in the click-through, log it as a seed-fallback candidate.

### End-of-day gate (Friday 18:00)

1. Can a stranger land on `/` and understand the product in 10 seconds? (yes / no)
2. Does the graph explorer load < 4 sec on mobile with no visible JS errors? (yes / no)
3. Is the PostHog funnel `/` → `/knowledge-graph/explorer` → `/developers` showing events? (yes / no)

If any = no → **scope-cut list (bottom of doc).** Do not progress without all three green.

---

## Day 2 — Saturday Apr 18 — "Press + polish"

**Gate:** By 18:00, embargo is out to press, the full social calendar is queued, and the product has had one more polish pass.

### Product lane — the one-more-pass

1. **10:00** — Second design critique walk-through. Tag Friday's leftovers + any new friction. Fix top 3.
2. **12:00** — Add `SECURITY.md` + `CODE_OF_CONDUCT.md` to repo root. P1 from code review. ~20 min each.
3. **14:00** — Rotate Postgres + Redis + Meilisearch passwords. Update `.env.prod`. Redeploy. Verify everything reconnects. (Lower risk but still hygienic before repo goes public.)
4. **16:00** — Cache prime. Hit top 20 endpoints + graph explorer views. We do not want a cold-start thundering herd Monday.
5. **17:00** — Spot-check 10 signal detail pages + 14 sanctions entities + 5 graph explorer queries on mobile.

### Growth lane — the press wave + social queue

1. **10:00** — Press embargo emails go to **10 journalists + 5 analysts**. Monday 10am ET embargo. Three-paragraph pitch + one-pager + battlecard + 60-sec demo video link + engineer-available calendar link.
2. **12:00** — Queue all Monday social posts in a scheduler (Buffer, Hypefury, or manual Apple Notes calendar). Tweet thread, LinkedIn post, Discord announcements, Reddit submissions. Dry-run every URL.
3. **14:00** — Write the "What we learned on launch day" skeleton post for Wednesday. Empty placeholders for numbers — fill in Monday evening.
4. **15:00** — *Tier 1+: schedule the TLDR Newsletter classified for Monday's issue.*
5. **15:30** — *Tier 2+: schedule TLDR sponsored section + Hacker Newsletter sponsorship + ProductHunt coordination. Confirm all pub dates are Apr 20 or Apr 21.*
6. **16:00** — Team dry-run of launch sequence. Read through the hour-by-hour. Identify any single-point-of-failure (one person for everything is a SPOF — write an emergency "if Devon drops off the call" protocol).
7. **17:00** — Record a 60-sec "thank you" video for Tuesday social — banks content for post-launch momentum.

### Automation lane — Saturday watches

- Ingest rate should hold across the weekend.
- Competitor watcher: any surprise competitor launches in the last 48h?
- First-call-of-launch-day alerting rehearsal: simulate an API 5xx spike; verify we'd see it.

### End-of-day gate (Saturday 18:00)

1. Are all 15 press targets emailed with the Monday embargo? (yes / no)
2. Is the Monday social schedule queued and proofread? (yes / no)
3. Has anyone on the team said "this feels polished enough to demo publicly"? (yes / no)

---

## Day 3 — Sunday Apr 19 — "Dark day"

**Gate:** By 18:00, nothing has shipped. You are rested. One quiet final pass has happened.

### Product lane — don't touch

- No deploys. No new features. Nothing.
- One person on-call for an emergency prod issue only.
- If something needs fixing, it was already broken on Saturday — fix it quietly, don't advertise it.

### Growth lane — one pass, then rest

1. **09:00** — Personally re-read the landing page, the README, the Show HN post. Fix one thing that feels off. One. Not ten.
2. **11:00** — Set up a `#launch-day` Slack/Discord/Notion channel. Assign explicit roles:
   - **Comms lead** — HN + Twitter replies
   - **Engineering lead** — production monitoring
   - **Community lead** — GitHub issues + Discord
   - **Founder** — reporter calls + high-signal responses
   - (If solo: you wear all four hats; roadmap scope-cut applies. See bottom.)
3. **13:00** — Final check: all Monday content is queued, all embargo emails have replies or at least read-receipts where available.
4. **14:00 onward** — **Dark.** No posts, no slack, no product tweaks. Take a walk. Sleep early.

### Automation lane — Sunday watches

- Health checks every 15 min instead of hourly.
- Automatic rollback alarm: any health check fails twice consecutively → page you.
- Pre-stage a "friendly comment" bank — 10 starter comments you can deploy if HN goes dry (e.g., "great to see open-source entering this space," "excited to try the SDK"). Not fake reviews — genuine notes from real friends who've been briefed.

### End-of-day gate (Sunday 18:00)

1. Did nothing break today? (yes / no)
2. Are you rested? (yes / no) — this is a real question, not a formality
3. Is the Monday morning checklist printed (on paper or on a second screen)? (yes / no)

---

## Day 4 — Monday Apr 20 — "Launch"

Hour-by-hour. Deviate from this only for bugs that break the launch.

| Time (ET) | Action | Owner |
|---|---|---|
| **07:00** | Wake up. Coffee. Do not read HN yet. | Founder |
| **08:00** | Final pre-flight: all endpoints green, scraper ingesting, signal count > 22K, landing page hero copy correct, graph explorer loads < 3s. | Engineering lead |
| **08:30** | Verify all queued posts are drafted. Make sure URLs resolve. | Comms lead |
| **09:00** | **Repo goes public.** Push final README commit. Tag v1.0.0. Create GitHub Release. | Founder |
| **09:15** | First star from the founder account. Add GitHub Topics: `open-source`, `fact-checking`, `knowledge-graph`, `nextjs`, `claude`, `osint`, `news-api`, `typescript`, `self-hosted`. | Founder |
| **09:30** | Publish launch blog post at `/blog/introducing-worldpulse`. Update landing page hero to link to it. | Comms lead |
| **10:00** | **Coordinated wave:** Show HN, Twitter thread, LinkedIn post, Discord announcements, Reddit submissions. Embargo lifts for 25 newsletters. | All |
| **10:05** | *Tier 1+: confirm TLDR classified appeared in today's issue.* | Comms lead |
| **10:10** | First HN reply to the first substantive comment. Be generous with context. | Founder |
| **10:30** | Founder available for pre-scheduled reporter calls. | Founder |
| **11:00** | Mid-morning check: HN rank, stars, sessions. Adjust: if HN > top 10, push the Twitter thread again. If < top 30, don't panic — the day is long. | Comms lead |
| **12:00** | Lunch. 30 min. Hydrate. | All |
| **13:00** | Afternoon push: European/Asian developer communities. Post in #javascript, #open-source, etc. | Comms lead |
| **13:30** | Reply to every substantive HN comment within 10 min of arrival. Do not engage trolls. One reply, mute. | Founder |
| **14:00** | Triage GitHub issues. Tag, respond, fix anything < 15 min. | Engineering lead |
| **15:00** | *Tier 2+: confirm ProductHunt launch is live; coordinate with hunter; amplify.* | Comms lead |
| **16:00** | Second wind — post a "here's what's working, here's what surprised us" tweet from the founder. Real numbers. | Founder |
| **17:00** | **End-of-day metrics capture:** record GitHub stars, HN peak rank, site sessions, API calls, SDK installs, newsletter mentions, tweet impressions. | All |
| **17:30** | 30-min team debrief. What worked. What broke. What to push tomorrow. | All |
| **18:00** | Fill in numbers in the "What we learned on launch day" follow-up post. Schedule for Wednesday. | Comms lead |
| **19:00** | Dinner. | All |
| **20:00** | **Dark.** Reply only to critical issues. Let the night cycle carry the momentum. | All |

---

## Persistent automations (configure by Friday)

These keep running after launch. The automated pipeline is the thing that makes the world hear about WorldPulse *tomorrow, and the day after, and the day after*.

### Monitoring (every N hours)

| Task | Frequency | Action on fire |
|---|---|---|
| Source drift (any feed silent > 6h) | every 2h | Flag in `monitoring/blockers.md` |
| OpenSanctions 429 rate + seed hit rate | every 1h | If 429 > 80%, escalate to auth-key acquisition |
| API 5xx error rate | every 15 min | Page if > 1% over 5 min rolling |
| Signal count momentum (delta vs rolling avg) | every 1h | Flag if ingest stalls |
| Scraper container health | every 10 min | Auto-restart up to 3x, then page |

### Growth monitoring

| Task | Frequency | Purpose |
|---|---|---|
| GitHub stars / forks / issues | every 15 min launch day; hourly after | Dashboard for team |
| npm SDK install count | every 1h | Track dev adoption |
| HN rank (if Show HN live) | every 15 min launch day | Trigger amplification if climbing |
| Twitter mentions of "worldpulse" | every 30 min launch day; hourly after | Reply surface |
| Reddit mentions | every 1h | Reply surface |
| PostHog funnel snapshot | daily | Conversion drop-off detection |

### Competitive intelligence

| Task | Frequency | Purpose |
|---|---|---|
| Factiverse blog + Twitter + pricing page | every 6h | Catch Gather updates, new features |
| GDELT project news + TV archive releases | every 12h | Catch Gemini 3.x indexing changes |
| WorldMonitor GitHub releases + README | every 12h | Catch version bumps, feature parity plays |
| Ground News product changes | every 24h | Lower-priority; different market |
| Danti / Crucix / Logically press releases | every 24h | Background watch |
| Any mention of "WorldPulse" on HN, Reddit, Twitter | every 15 min launch day | Real-time engagement |

### Content-production scheduling

| Task | Cadence | Purpose |
|---|---|---|
| Weekly blog post | every Monday, drafted and reviewed by founder | Maintain SEO momentum on the 12 target keyword clusters |
| Weekly Twitter thread | every Thursday | Product update + metric flex |
| Weekly LinkedIn post | every Tuesday | Institutional audience |
| Monthly metrics-review post | first Monday of month | Accountability + compounding narrative |
| "This week in the knowledge graph" post | every Friday | Flywheel: graph → story → new users → graph |

### Self-improvement (the monitoring system's core loop)

| Task | Cadence | Purpose |
|---|---|---|
| Review competitor improvements, propose matching features | weekly | Never drift backward on parity |
| Review source-expansion opportunities (700 → 1000+) | weekly | Extend the lead |
| Review test coverage on critical paths | weekly | Catch regressions before users do |
| Propose pipeline improvements | monthly | Continuous improvement is the point |

---

## End-of-day gate checks (recap)

| Day | Gate 1 | Gate 2 | Gate 3 |
|---|---|---|---|
| **Fri 4/17** | Stranger understands product in 10s | Graph explorer loads < 4s on mobile, no JS errors | PostHog events firing end-to-end |
| **Sat 4/18** | 15 press targets emailed | Monday social queued & proofread | Product feels demo-ready |
| **Sun 4/19** | Nothing broke today | You are rested | Monday checklist printed |
| **Mon 4/20** | Launched on time (10:00 ET) | 5xx error rate < 0.5% | Metrics captured by 18:00 |

A failed gate is not a catastrophe — it's a signal to scope-cut. Use the list below.

---

## Scope-cut list (in order)

If time runs out, drop things from the bottom first:

1. Second launch-day "here's what surprised us" tweet
2. ProductHunt submission (if Tier 2+) — post a day late if needed
3. Team dry-run on Saturday (solo operators: read the runbook twice alone instead)
4. Password rotations for Postgres/Redis/Meilisearch (keep Stripe + JWT rotations — those are P0)
5. Second design critique walk-through on Saturday
6. "Dark day" Sunday (if Saturday fell behind, work Sunday — but pay it back in Week 2)
7. Newsletter sponsorships (cancel and refund if possible — organic can still carry)
8. Press outreach to the 15 journalists (founder network DMs can replace)
9. Mobile device test on Friday

Do **not** cut:
- Stripe + JWT rotation
- PostHog analytics key set in prod
- Show HN post on Monday 10am ET
- The graph explorer as the hero
- Any safety / security item in the code-review P0 list

---

## What ships in which doc (index of the index)

| Deliverable from today | Lives in | Feeds which day |
|---|---|---|
| Production fix report | `2026-04-16-production-fixes.md` | Already shipped; context for everything else |
| Code review sweep | `2026-04-16-code-review-prelaunch.md` | Day 0 tonight + Day 2 Saturday |
| Campaign plan (5-day, detailed) | `2026-04-16-campaign-plan-apr16-20.md` | Day 1–4; this roadmap is the compressed spine |
| Competitive + SEO battlecard | `2026-04-16-competitive-seo-battlecard.md` | Content ammo for Day 1–4 posts + press |
| Brand voice guidelines | `2026-04-16-brand-voice-guidelines.md` | Review checklist for every piece of content before publish |
| Design critique | `2026-04-16-design-critique.md` | Day 1 + Day 2 walk-through checklist |
| User research plan | `2026-04-16-user-research-plan.md` | Starts launch week; runs through May 4 |
| Performance baseline | `2026-04-16-performance-baseline.md` | Day 1 instrumentation + launch-day target sheet |
| Launch index | `2026-04-16-LAUNCH-INDEX.md` | Entry point to all of the above |
| **This roadmap** | `2026-04-16-master-roadmap-apr17-20.md` | **The execution spine. Run this day-by-day.** |

---

## The one thing that matters

If everything else fails and only one thing works, make it this:

**Monday, April 20, 10:00 ET — a well-crafted Show HN post goes up. The founder sits at the keyboard for the next 4 hours and replies substantively to every comment. No sales pitch. No defensiveness. Just the thing the founder built, explained by the person who built it.**

That alone, with nothing else on this page, wins a respectable launch. Everything else in this roadmap is leverage on top of that.

Now pick a budget tier, and I'll wire the exact spend + scheduled tasks into the calendar.
