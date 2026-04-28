# User Research Plan + Competitor UX Teardown

**Date:** 2026-04-16
**Audience for this doc:** Founder, PM, design lead
**Cadence:** Launch-week research is opportunistic (catch users while interest is peak). Structured research starts Week 2 (Apr 27+).

---

## Why research now

We have zero direct user conversations. We have hypotheses from competitor teardowns and our own developer instincts — but no signal from real users. Launch week is the best chance we'll have for six months to talk to actual target users while they're engaged.

The goal of launch-week research is **not** comprehensive insight. It's **signal capture** — enough conversation to correct the biggest assumption errors in the next 30 days of product decisions.

---

## Research questions (priority order)

1. **Activation:** What does a new user do in the first 5 minutes? Where do they bounce? (Analytics + session recording)
2. **Value prop clarity:** In the user's own words, what is WorldPulse for? Match vs. mismatch against our positioning.
3. **Graph explorer fit:** Is the Full Graph Explorer a "wow" moment or a "what am I looking at" moment? For which users?
4. **Developer pathway:** From landing → docs → SDK install → first API call, where do developers drop? How long does it take?
5. **Comparison set:** Who else did they evaluate? What made them stay / leave WorldPulse?
6. **Workflow fit:** For journalists/analysts, what existing tool would WorldPulse replace or augment? Not what we want to replace — what they'd actually swap.

---

## Research methods (launch week)

### 1. Instrumentation (Monday, Day 1)
**Goal:** Baseline analytics — who, where from, what they do.

- **PostHog** — wire up `NEXT_PUBLIC_POSTHOG_KEY` in prod before launch. Events: `page_view`, `cta_click_{name}`, `graph_explorer_interact`, `api_key_created`, `signup`, `sdk_install` (client-side ping from docs code sample).
- **Session replay** — enable PostHog session recordings for 10% of sessions. Review 20–30 sessions on Tuesday morning.
- **Heatmap** — PostHog heatmap on `/` and `/knowledge-graph/explorer`. Review Thursday.

**Owner:** engineering lead. **Time:** 2 hours Friday.

### 2. Intercept interviews (Tuesday-Thursday of launch week)
**Goal:** 10 conversations with real users in the first 72 hours.

- **Method:** PostHog in-app survey triggered after 3rd page view. Offer a 20-minute Zoom + $50 Amazon card for "help us improve."
- **Script (4 questions, 20 minutes):**
  1. "How did you find WorldPulse?"
  2. "In your own words, what does WorldPulse do?"
  3. "Walk me through what you tried to do in the first 5 minutes."
  4. "What's the closest alternative you've used? Why would / wouldn't you switch?"
- **Target mix:** 4 developers, 3 journalists/analysts, 3 self-hosting/open-source folks.

**Owner:** founder + one other. **Time:** 10 × 20 min + 2h debrief = ~6h over 3 days.

### 3. Hacker News + GitHub issue mining (daily through launch week)
**Goal:** Free qualitative signal from public feedback.

- **Source:** Every HN comment on the Show HN post + every GitHub issue opened in the first 72 hours.
- **Method:** One person tags each piece of feedback into: positioning confusion, feature gap, bug, praise, pricing confusion, setup friction.
- **Output:** A 20-line tag doc by Thursday; themes surfaced Friday.

**Owner:** PM / community lead. **Time:** 30 min/day.

### 4. Structured interviews (Week 2, starting Apr 27)
**Goal:** 6 deep (45-min) interviews with paying-likely users.

- **Recruiting:** Target users who hit specific thresholds (signed up + created API key + made > 10 API calls, or viewed > 5 graph-explorer sessions, or self-hosted).
- **Script:** Jobs-to-be-done framing. "Tell me about the last time you needed to verify a claim / understand a news event / build a news-facing product."
- **Owner:** PM. **Time:** 6 × 45 min + 6h synthesis.

### 5. Analytics review (Week 3)
**Goal:** Quantify what Tuesday-Thursday interviews suggested.

- PostHog funnel: landing → graph explorer → 1 interaction → return visit.
- PostHog funnel: landing → docs → copy code → signup → API key → first call.
- Drop-off rates at each step. Cohort by referrer source.

**Owner:** PM. **Time:** 4h.

---

## Recruiting criteria (launch week)

| User type | Criteria | Target # |
|---|---|---|
| Developer | Visited `/developers` + viewed `/api` docs | 4 |
| Journalist/analyst | Viewed > 3 intel pages + signed up | 3 |
| OSS/self-host | Viewed `/docs/self-hosting` + starred GitHub repo | 3 |

Priority: **quality of conversation > exact quota**. If you land three great OSS conversations, take it.

---

## Synthesis framework

For each interview, capture:

- **Quote** — the most vivid sentence (for later use).
- **Task** — what they tried to do.
- **Outcome** — what happened (succeeded / confused / failed).
- **Compared to** — the tool/process they were comparing against.
- **Surprise** — one thing that surprised them (positively or negatively).
- **Would-pay signal** — any mention of budget, team, buying behavior.

After 10 interviews, pull themes with the standard 2-column method (observation → implication). Target: 8–12 themes, ranked by frequency.

---

## Competitor UX teardown

For each top-3 competitor, here's what to steal, what to avoid, and the concrete WorldPulse action.

### Factiverse — `factiverse.ai`

**What they do well**
- Clear product hierarchy: "Check a claim" is the primary CTA on the homepage. You know in 5 seconds what the product is for.
- Live demo widget on the landing page — you can paste a claim right into the hero and see a verdict. Extremely effective.
- Newsroom-specific case studies above the fold.

**What they do poorly**
- No self-service path for developers — every CTA leads to "Contact sales."
- Documentation is behind a wall; you can't see API shape without a demo booking.
- The live demo is also the only demo — no way to explore multiple claims without an account.

**WorldPulse action**
- **Steal:** Put a claim-verification demo widget on the landing page. "Paste a claim, see a reliability score." Make it the primary proof point.
- **Avoid:** Don't gate the docs. Our developer-first advantage is negated if we copy their sales-gate.
- **Beat:** "Free self-service API key" vs "Contact sales" is a real moat. Say it on every page.

### GDELT Project — `gdeltproject.org`

**What they do well**
- Immense data credibility. The homepage is dense with real statistics, live counters, and language coverage maps. It reads academic and earned.
- Every visualization links to a paper or a dataset. Transparent by default.

**What they do poorly**
- UI is dated. Information architecture is hostile — multiple overlapping navigation systems, no clear first action.
- The "try it now" path is essentially a Google Cloud Marketplace listing — nothing a journalist can open a browser and use.
- Strong on data, weak on interpretation. You get an event graph with no narrative.

**WorldPulse action**
- **Steal:** Live counters on the homepage (signal count, source count, claim count, recent updates). Bake credibility into the first 5 seconds.
- **Avoid:** Don't force users into a SQL-oriented workflow. Our graph explorer is the anti-GDELT experience.
- **Beat:** "Interactive exploration in the browser, no BigQuery required." Our single biggest UX advantage over GDELT.

### WorldMonitor — `github.com/koala73/worldmonitor`

**What they do well**
- The 3D globe on the dashboard is visceral. It makes the product feel alive in a way text feeds don't.
- 45 data layers — they give the user a lot of knobs. Power-user-friendly.
- Self-hostable with a clear README. Minimal friction to try.

**What they do poorly**
- AGPL-3.0 license alienates commercial builders. Licensing warning is halfway down the README.
- The 45 layers become overwhelming without guided discovery — everything is available, nothing is emphasized.
- No developer API / SDK. You get a dashboard or nothing.

**WorldPulse action**
- **Steal:** Add motion / aliveness to our landing hero. The graph explorer can do this — animate the force simulation during the hero reveal.
- **Avoid:** Don't launch with 28 intel verticals on equal footing. Pick 5 for the nav; surface the rest on demand.
- **Beat:** MIT license + npm SDK, loudly, as the two-word differentiator vs WorldMonitor.

### Ground News — `ground.news`

**What they do well**
- Polished consumer UX. Bias ratings feel like familiar seals of approval.
- "Blindspot" feature (what your bubble isn't seeing) is memorable and shareable.
- Aggressive email capture on every page.

**What they do poorly**
- No API. No developer story. No self-host. Closed by default.
- Feels like a news app, not a platform. Fundamentally different market position.

**WorldPulse action**
- **Steal:** The "memorable, shareable single feature" playbook. Our version: a "Your claim timeline" — paste a claim, see every signal about it on a timeline. If that's too hard, substitute "your entity dashboard."
- **Avoid:** Ground News's aggressive email capture pattern turns off developers. Our CTA should be "star on GitHub" before "give us your email."
- **Beat:** We have the API Ground News doesn't have. Don't try to out-consumer them.

---

## Anti-patterns we should not replicate

Looking across the space, these are common pitfalls we're currently *not* in — stay out of them:

1. **Vanity live counter without substance.** "2,841,237 articles indexed!" with no search box next to it is noise. Only count things if the user can immediately act on them.
2. **28 intel verticals with equal weight.** Users get decision paralysis. Pick 5, hide 23, let power users discover.
3. **Sales-gated documentation.** Every time a developer has to "Contact sales" to see an API response, we've lost them to Postman.
4. **Wall of features on the landing page.** Competitors list 40 bullet points. Our page should list 5 things we do *better than anyone*.
5. **Bias labels without methodology.** Ground News and AllSides get away with this because of their brand; we don't have that brand yet. Explain the score.

---

## Launch-week deliverable

By Friday April 24, we should have:

- 10 intercept interviews completed, tagged, synthesized
- 3 themes ranked by frequency
- 5 concrete product changes prioritized from the themes (not "we'll consider X" — the exact change and owner)
- A PostHog funnel report: landing → first action → return visit
- Top 10 HN / GitHub comments tagged into our insight framework
- A one-pager summarizing all of the above for the next all-hands

**Output location:** `docs/launch/2026-04-24-launch-week-research-readout.md`

---

## Research ethics + operations

- Offer compensation ($50) to interview participants. No surprise gift-card-after-the-fact — state upfront.
- Never record without consent. Always offer the transcript after.
- Don't promise features in interviews. "Thanks for sharing" is enough.
- PII: store interview notes without emails in the shared doc; keep emails in a separate CRM/airtable.
- Delete recordings after synthesis (within 30 days).
