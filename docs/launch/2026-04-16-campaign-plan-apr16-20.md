# 5-Day Launch Campaign Plan — Apr 16 to Apr 20, 2026

**Launch date:** Monday, April 20, 2026
**Status on Apr 16:** Site live, ~20K signals ingested, core bugs resolved, no production blockers
**Campaign audience:** Developers (primary), journalists + researchers (secondary), OSS community (amplification)

---

## Campaign goals

1. **Day-one GitHub traction** — 500+ stars in launch week. Repo goes public Monday morning.
2. **Developer waitlist / SDK signups** — 200+ email captures before launch day.
3. **Three earned placements** — HN front page, one major newsletter (TLDR / Hacker Newsletter / TheSequence), one reporter/analyst quote.
4. **5,000 site sessions on launch day** from a standing start (~0 today).
5. **Establish the narrative** — "open-source + knowledge graph + developer SDK" lands in the first wave of coverage so competitor positioning is set, not responsive.

---

## Positioning for the week

**One-sentence pitch:** "WorldPulse is the open-source global intelligence network — real-time signals from 700+ sources, multi-modal claim verification, and an interactive knowledge graph, MIT-licensed and self-hostable."

**Elevator variants (use by channel):**
- *Developer:* "Think GDELT + Factiverse + a knowledge graph, with an npm SDK and a REST API, MIT-licensed."
- *Journalist:* "Reliability scores on every claim from 700+ sources, with the full graph of who said what visible and verifiable."
- *Open-source crowd:* "The fact-checking infrastructure the internet deserves: no paywall, no black box, no sales cycle."

Keep these three variants in the campaign kit — never improvise new ones this week.

---

## Pre-launch runway (Thu Apr 16 → Sun Apr 19)

### Thursday, April 16 — "Stabilize + prep"

**Engineering**
- Confirm signal count clears 22K overnight. Verify signals page, sanctions page, detail pages green at 8am Friday.
- Rotate the live Stripe key flagged in the code review sweep (see `2026-04-16-code-review-prelaunch.md`). Do this *today* — not next week.
- Add `SECURITY.md` and `CODE_OF_CONDUCT.md` at repo root.

**Content (write today, publish later)**
- Draft launch blog post: "Introducing WorldPulse." 800 words. Lead with the knowledge graph screenshot.
- Draft Show HN post. Headline variant A: "Show HN: WorldPulse – open-source real-time news intelligence with a knowledge graph." Variant B: "Show HN: WorldPulse – 700+ source fact-checking API, MIT-licensed." Keep both, A/B on launch morning.
- Draft three tweets/threads (main account, founder account, engineering account).
- Draft one LinkedIn post (founder voice).

**Outreach prep**
- Identify 25 target newsletters (TLDR, Hacker Newsletter, TheSequence, Pragmatic Engineer, Stratechery reader circle, Bellingcat, CJR, Nieman Lab, Poynter, Newsletterest, etc.).
- Draft a single outreach email template. Three paragraphs: what, why it's different, what you can do with it today. Link to docs, SDK, graph explorer.
- Identify 10 journalists (OSINT, news-tech, open-source beat) + 5 analysts. Pull their most recent relevant pieces; note the angle each cares about.

### Friday, April 17 — "Soft-circulate + ready the launch kit"

**Soft circulation**
- Send outreach email to the 25 newsletters with Monday 10am ET embargo. Include the battlecard and one-pager.
- DM 10 friendly developers/researchers with a soft ask: "Launching Monday, would you star or share if it's good?" Never ask for a post — ask for a star.
- Post in developer Discord communities, r/OSINT, r/opensource announcing date + asking for beta feedback. *Not* a launch post — a "we're about to launch, what would you want to see demo'd" post.

**Content finalization**
- Lock the Show HN post. Rehearse answers to predictable questions: "how's this different from GDELT / NewsAPI / Ground News?", "what does it cost to run?", "how do I self-host it?", "what LLM do you use and why?".
- Finalize the demo video for the graph explorer. 60 seconds max. No voiceover — text captions only. Upload to YouTube as unlisted.
- Screenshot suite: graph explorer (hero), signals feed, sanctions page, claim detail, signals detail. Export at 2x for social.

**Technical**
- Prime cache by hitting the top 20 endpoints and graph explorer views. We do not want a cold-start thundering-herd on Monday.
- Double-check `/api/v1/sanctions/featured` returns non-empty (seed fallback is the safety net, but verify live fetch with an OpenSanctions auth key if available).
- Enable `POSTHOG_KEY` for production if not already set. We need analytics on Day 1.

### Saturday, April 18 — "Dry run + press embargo"

**Press embargo emails** to the 10 journalists + 5 analysts. Monday 10am ET embargo. Three-paragraph pitch, same as newsletters. Include: the battlecard, one-pager, demo video link, engineer-available times.

**Dry run:** Run through the launch sequence as a team.
- 9am ET: repo goes public
- 9:30am ET: launch post goes live on the blog
- 10am ET: Show HN, tweet thread, LinkedIn post, Discord announcements, newsletter embargo lifts
- 10:30am ET: founder available for reporter calls
- 12pm ET: first check on HN ranking, GitHub stars, site traffic

**Backup content:** Write a follow-up post for Wednesday — "What we learned on launch day" — as a skeleton now, fill the numbers in real-time.

### Sunday, April 19 — "Dark day"

Nothing ships. The team rests. One person on-call for an unexpected prod issue. Use the quiet to:

- Personally re-read the Show HN post, the README, and the landing page. Fix any one thing that feels off.
- Pre-schedule the Monday social posts in a queue (Buffer/Hootsuite or manual).
- Set up a #launch-day Slack channel with clear roles (comms lead, engineering lead, community monitoring).

---

## Launch day — Monday, April 20

### Hour-by-hour

**8:00am ET — Final pre-flight**
- Verify all endpoints green, scraper running, signal count > 22K.
- Verify landing page hero has the correct copy. Verify graph explorer loads < 3s.
- Coffee.

**9:00am ET — Repo goes public**
- Make the GitHub repo public. Push the final README update. Tag v1.0.0. Create GitHub Release.
- First star is the founder's own account at 9:01am — not ideal but common.

**9:30am ET — Blog post live**
- Publish `/blog/introducing-worldpulse` on the site. Hero image is the graph explorer.
- Link from the landing page hero.

**10:00am ET — Coordinated launch wave**
- Show HN posts (Variant A).
- Tweet thread (8 tweets, screenshot-heavy, founder account).
- LinkedIn post (founder).
- Discord announcements (developer communities, r/OSINT).
- Newsletter embargo lifts — confirm inclusion with any that committed.

**10:30am–1:00pm ET — Reporter calls + HN monitoring**
- Founder available for pre-scheduled calls.
- One person watches HN front page. Reply to every substantive question within 10 min. Don't reply to trolls.
- One person watches GitHub issues + discussions. Triage within 30 min.
- One person watches site health (Sentry, API 5xx rate, graph explorer load time).

**1:00pm ET — Check-in**
- HN rank? GitHub stars? Site sessions? Newsletter pickup? Any incidents?
- If HN rank is top 10 → double down on Twitter/LinkedIn engagement.
- If HN rank is sub-30 → don't panic, but review the post. Consider a follow-up post at 4pm ET.

**3:00pm ET — International push**
- Post in European/Asian developer communities where the US morning wave didn't land.
- Post in Bellingcat Discord with advance permission.

**5:00pm ET — End-of-day numbers**
- Record: GitHub stars, HN rank at peak + close, site sessions, API calls, SDK installs, newsletter mentions, tweet impressions.
- Team debrief (30 min). What worked, what broke, what to push tomorrow.

**8:00pm ET — Dark**
- Stop posting. Let the night cycle carry the momentum. Reply to critical issues only.

---

## Channel-by-channel plan

### GitHub
- Repo public 9am ET Monday.
- Pin the issues: "v1.1 roadmap," "good first issues," "integrations wanted."
- Ensure the README has a clear "Quick Start" with three commands max.
- Add GitHub Topics: `open-source`, `fact-checking`, `knowledge-graph`, `nextjs`, `claude`, `osint`, `news-api`, `typescript`, `self-hosted`.
- Submit to `awesome-*` lists: awesome-osint, awesome-selfhosted, awesome-nextjs, awesome-open-source.

### Hacker News
- Show HN post 10am ET Monday. Title tested in #launch-day channel on Saturday.
- Do not "please upvote." Reply substantively to every first-24-hour comment. Be generous with context.
- If frontpage: founder answers for 4 hours straight. No exceptions.

### Twitter/X
- Launch thread: 8 tweets, each with a specific screenshot. Thread lead: the knowledge graph. Tweet 2: fact-checking. Tweet 3: developer SDK example. Tweet 4: 700+ sources. Tweet 5: MIT licensed. Tweet 6: self-hosting. Tweet 7: roadmap. Tweet 8: link + GitHub.
- Follow-up tweets throughout the day with specific screenshots + data (don't reuse the thread).
- Engage with every reply from a verified/named account in the first 4 hours.

### LinkedIn
- Founder long-form post (700–1000 words). Focus on the mission angle: why open-source fact-checking matters now. Link to the blog post.
- Engineering team members share with their own framing (don't copy-paste the founder post).

### Discord / Reddit
- Developer Discord communities: technical angle. Specific, with a "things we'd do differently" section.
- r/OSINT: framing is "tool for OSINT practitioners." Link to graph explorer + sanctions page.
- r/opensource, r/selfhosted: framing is "self-hostable alternative to paid news APIs."
- r/programming: only if there's a technical blog post of sufficient depth. Otherwise skip.

### Newsletters
- 25 newsletter pitches sent Friday, embargoed to Monday 10am ET.
- Target list in `/docs/launch/newsletter-targets.md` (to be written Friday).

### Press
- 10 journalists, 5 analysts. Three-paragraph pitch + one-pager + battlecard + demo video.
- Don't expect launch-day coverage from most. Expect follow-up within 2 weeks if one of them picks up.

---

## Risk register

| Risk | Probability | Mitigation |
|---|---|---|
| HN post buried by a bigger launch | Medium | Time launch before 10:30am ET; have a follow-up Show HN version ready |
| Site crashes under load | Low-Medium | Cache primed Friday; Redis TTLs extended; seed fallbacks; Sentry alerting |
| OpenSanctions rate-limits again | Confirmed-high | Seed fallback already deployed (see `2026-04-16-production-fixes.md`) |
| Critical bug found in public code | Medium | Code review sweep today (see `2026-04-16-code-review-prelaunch.md`); 24h bug bounty window |
| Competitor responds with a faster product | Low-Medium | Our moat is the KG + MIT + SDK — hard to replicate quickly. Counter-narrative ready. |
| Negative HN comment storm (licensing / ethics / scope) | Medium | Founder responds personally, with data. Never defensive. |

---

## Success metrics (launch week)

| Metric | Floor | Target | Stretch |
|---|---|---|---|
| GitHub stars (week 1) | 300 | 500 | 1,500 |
| SDK installs (npm) | 50 | 150 | 500 |
| Site sessions (launch day) | 2,500 | 5,000 | 15,000 |
| Email captures (waitlist / newsletter) | 100 | 200 | 600 |
| Newsletter mentions | 2 | 3 | 6+ |
| HN peak rank | Top 30 | Top 10 | Front page + 100 comments |
| Earned press placements (week 1) | 0 | 1 | 3 |
| Developer community mentions (Discord/Reddit organic) | 5 | 15 | 40 |

---

## Post-launch (Apr 21 → May 4)

- **Wednesday Apr 22:** "What we learned on launch day" follow-up post.
- **Friday Apr 24:** Graph explorer deep-dive (pre-drafted).
- **Monday Apr 27:** SDK tutorial + video.
- **Week of Apr 28:** First partnership outreach (Bellingcat, ProPublica, ICIJ).
- **Monday May 4:** Two-week retrospective. Revise campaign for the next 30-day push.

---

## What NOT to do this week

- Don't rewrite the product copy. Locked on Sunday.
- Don't add new features. All improvements are held for a v1.1 cycle.
- Don't engage with bad-faith critics. One reply, then mute.
- Don't spam Twitter with 12 launch tweets. 8 in the thread, 3 follow-ups max.
- Don't launch on Tuesday because Monday felt soft. Commit to the date.
