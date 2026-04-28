# Product Hunt Listing Draft — WorldPulse

**Scheduled:** Monday Apr 20, 2026 at 00:01 PT (launch day — ride the HN wave)
**Category:** Developer Tools / Open Source / Data & Analytics

---

## Tagline (60 chars max)

Open-source global intelligence — 300+ sources, 184 nations, real-time.

---

## Short Description (260 chars max)

WorldPulse monitors 300+ verified sources across 184 nations in real-time. AI-powered classification, cross-source verification, and an interactive world map — MIT-licensed, self-hostable, with a free API. The situational awareness that used to cost six figures, now open-source.

---

## Full Description

### The problem

Tracking what's happening across the globe means juggling GDELT, RSS feeds, Twitter lists, government alerts, and specialized OSINT sources — manually. Enterprise intelligence platforms cost $30K+/year. OSINT analysts spend more time aggregating than analyzing.

### What we built

WorldPulse is an open-source global intelligence platform. It ingests signals from wire services (AP, Reuters, AFP), government feeds (USGS, NOAA, WHO), and OSINT APIs (ACLED, OpenSanctions, GDELT) — then classifies, geolocates, correlates, and maps every event in real-time.

### How it works

Every signal passes through a 5-stage enrichment pipeline: extraction, classification, geolocation, cross-source correlation, and reliability scoring. The result is an interactive world map with live conflict, natural hazard, cyber threat, and maritime layers — updated within 60 seconds of an event.

### Key features

- **300+ verified sources** — AP, Reuters, USGS, NOAA, ACLED, OpenSanctions, GDELT, and more
- **55,000+ intelligence signals** indexed and growing continuously
- **AI-powered verification** — cross-source correlation and reliability scoring (0-1 scale)
- **Interactive world map** — MapLibre GL globe with satellite, dark, and terrain views
- **9 intelligence dashboards** — cyber threats, sanctions, finance, space weather, internet outages, food security, and more
- **Real-time WebSocket updates** — signals appear within 60 seconds
- **Developer API** — REST + WebSocket, no API key required for public data
- **Self-hostable** — `docker compose up` and you're running
- **MIT license** — free forever, no feature restrictions

### Tech stack

Next.js 15, Fastify, PostgreSQL + PostGIS, Redis, MapLibre GL, Anthropic (verification), TypeScript throughout.

### Who it's for

- OSINT analysts who are tired of manual aggregation
- Developers who want to build on top of real-time intelligence data
- Journalists who need early signal detection without a $30K budget
- Security teams monitoring global threats to their operations

---

## Maker Comment (post immediately after launch)

Hey Product Hunt! I'm Devon, the developer behind WorldPulse.

I built this because I was frustrated by how fragmented global intelligence is. You need one tool for conflict tracking, another for sanctions, another for natural disasters, another for cyber threats — and most of them are either prohibitively expensive or proprietary black boxes.

WorldPulse consolidates 300+ verified sources into a single real-time dashboard. Every signal is classified by AI, geolocated, and cross-referenced against related events in a knowledge graph. You get reliability scores on every claim, not just source-level ratings.

A few things I'm proud of:

**The map.** It's a full MapLibre GL globe with satellite/dark/terrain views. You can tilt into 3D, toggle conflict/hazard/cyber/maritime layers, and click any signal for its full verification timeline. No proprietary map APIs.

**The pipeline.** Signals go from raw RSS/API ingest to classified, geolocated, and correlated in under 60 seconds. The scraper monitors 178 active feeds continuously and we're expanding toward 500+.

**The openness.** MIT license. Free API (60 req/min, no key needed). Self-hostable with Docker Compose. I think intelligence tools should be transparent and auditable — especially the ones that tell you what's true.

The platform is live right now at world-pulse.io. The code is on GitHub. I'd love your feedback on what sources or features to add next.

Happy to answer any questions about the architecture, the verification pipeline, or why I chose to open-source this instead of going the SaaS route.

---

## Screenshot Guidance (Devon takes these)

You need 5 screenshots for the PH gallery, in this order:

1. **Hero: World map with signals** — Show the full MapLibre globe with active signal markers. Use dark theme. Zoom to show multiple continents with visible clusters. This is your money shot.

2. **Live signal feed** — The real-time feed showing recent signals with category badges, severity indicators, and source attribution. Show variety (conflict, cyber, natural hazard).

3. **Signal detail page** — Click into one interesting signal. Show the verification timeline, source attribution, reliability score, and related signals.

4. **Intelligence dashboard** — Pick the most visually striking one (cyber-threats or sanctions). Show the specialized layout with charts/tables.

5. **Developer API page** — The /developers page showing code examples, pricing tiers, and the SDK install command.

**Tips:**
- Use 1920x1080 or 2560x1440 resolution
- Dark theme throughout (matches PH's dark mode aesthetic)
- Clear browser chrome — just the content
- Add a subtle browser mockup frame if possible (Figma has free templates)

---

## Topics to Select on Product Hunt

- Open Source
- Developer Tools
- Data Visualization
- Artificial Intelligence
- Geospatial

---

## Posting Notes

- Submit the draft tonight (Sunday Apr 19) for a Monday launch
- PH launches at 00:01 PT (3:01 AM ET Monday) — have the maker comment ready to paste immediately
- First 4 hours are critical for ranking. Share the PH link across X, LinkedIn, Discord immediately after it goes live
- Respond to every comment within 30 minutes
- Don't ask friends to upvote — ask them to leave genuine comments about their use case (PH penalizes vote rings)

