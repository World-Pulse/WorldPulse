# Reddit r/opensource Post — WorldPulse

**Subreddit:** r/opensource (~350K members)
**Post on:** Monday Apr 20, 2026 at 17:00 ET (evening wave)
**Flair:** Select "Show r/opensource" or similar

---

## Title

I open-sourced my global intelligence platform under MIT — monitors 300+ sources, 184 nations, with a developer API

---

## Body

After a year of development, I'm releasing WorldPulse as open-source software under the MIT license. It's a global intelligence platform that monitors 300+ verified sources in real-time — and I wanted to share why I chose to open-source it and what the experience has been like.

**Why open-source an intelligence platform?**

Most tools in this space are proprietary. Factiverse, NewsGuard, Logically, Danti — they all gate their data behind enterprise sales cycles. Even the open alternatives have licensing limitations (WorldMonitor is AGPL-3.0, which blocks most commercial use).

I believe intelligence tools should be transparent. When a platform tells you a source is "reliable" or a claim is "verified," you should be able to audit how that determination was made. Open source is the only way to make that promise credibly.

MIT specifically because I want developers and organizations to build on top of WorldPulse without worrying about copyleft obligations. If a newsroom wants to embed our verification widget, they shouldn't need a legal review.

**What the project looks like**

- **Stack:** Next.js 15, Fastify, PostgreSQL + PostGIS, Redis, MapLibre GL, TypeScript throughout
- **Sources:** 300+ verified feeds — AP, Reuters, USGS, NOAA, ACLED, OpenSanctions, GDELT, and more
- **Pipeline:** 5-stage enrichment — extraction, classification, geolocation, cross-source correlation, reliability scoring
- **Frontend:** Interactive world map, real-time feed, 9 specialized intelligence dashboards
- **API:** REST + WebSocket. Free tier (60 req/min, no key required). Pro tier for higher limits.
- **Self-hosting:** `docker compose up` on any machine with 4GB RAM

The monorepo is structured as apps/ (web, api, scraper) and packages/ (shared types, UI components, config). TypeScript strict mode throughout.

**Where contributions would help most**

I've labeled issues for new contributors. The areas where community help would have the most impact:

1. **Source adapters.** The scraper has 30+ adapters for different source types (RSS, API, web scrape). Each adapter is a self-contained module. If you know a public data feed we're not ingesting, writing an adapter is a great first contribution — usually 50-100 lines of TypeScript.

2. **Localization.** The UI is English-only right now. The signal pipeline handles 100+ languages (via GDELT's translingual processing), but the interface needs i18n.

3. **Testing.** The API and scraper have test coverage on critical paths but the frontend is under-tested. React Testing Library or Playwright contributions welcome.

4. **Documentation.** The self-hosting guide needs more deployment examples (Kubernetes, Terraform, NixOS). API docs need more code samples.

5. **Performance.** The knowledge graph queries can be slow on large datasets. Anyone with PostgreSQL optimization experience could make a real difference.

**What I've learned open-sourcing this**

Shipping an open-source project is fundamentally different from shipping a product. Some things I didn't expect:

- README quality matters 10x more than you think. It's your landing page, your documentation, and your pitch combined.
- Issue templates save hours. Structured bug reports with reproduction steps are the difference between fixable and unfixable.
- The MIT vs AGPL decision matters for adoption. I watched WorldMonitor (a similar project, AGPL-licensed) get passed over by companies who loved the product but couldn't accept copyleft.
- Having a `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md` from day one signals that you're serious about community.

**Links**

- Live: world-pulse.io
- GitHub: github.com/World-Pulse/WorldPulse
- Contributing guide: github.com/World-Pulse/WorldPulse/blob/main/CONTRIBUTING.md
- Good first issues: github.com/World-Pulse/WorldPulse/issues?q=label%3A%22good+first+issue%22

Feedback on the codebase, architecture decisions, or project structure is very welcome. Happy to answer questions.

---

## Posting Notes

- r/opensource cares about: license choice, project governance, contribution process, community health
- Lead with WHY it's open-source, not what it does. The audience assumes FOSS is good — tell them why you chose it for this specific domain.
- Mention the MIT vs AGPL decision explicitly — this community has strong opinions on licensing
- Include contribution opportunities — this is the audience most likely to actually submit PRs
- Don't be defensive about using AI in the pipeline. Be transparent about what's automated and what's auditable.
- If someone asks "why not just use GDELT?" — honest answer: GDELT is an event database, WorldPulse adds claim verification, reliability scoring, and a developer-friendly API. We actually ingest GDELT as one of our sources.
- Respond to every comment, especially code critiques. This community respects founders who engage.

