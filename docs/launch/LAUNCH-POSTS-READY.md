# WorldPulse Launch Posts — Ready to Schedule

All posts below are copy-paste ready. Update signal count to current number before posting.

---

## 1. HACKER NEWS (Post at 10:00 ET Monday)

**Title:**
```
Show HN: WorldPulse – Open-source real-time global intelligence (300+ sources, 195 nations)
```

**Body:**
```
Hey HN,

I've been building WorldPulse for the past several months and it's now live at https://world-pulse.io

WorldPulse is an open-source intelligence platform that monitors 300+ sources across 195 countries in real-time. Think of it as a live-updating global situational awareness dashboard — the kind of tooling that used to be locked behind six-figure enterprise contracts.

What it does:

- Ingests signals from RSS feeds, GDELT, government APIs (USGS, NOAA, WHO, NWS), OSINT sources (ACLED, OpenSanctions, IODA), and more
- AI classification pipeline categorizes, geolocates, and assigns reliability scores to every signal
- Cross-source correlation engine links related events across independent sources
- Everything renders on an interactive MapLibre globe with live layers (conflict, natural hazards, cyber threats, maritime/aviation)
- WebSocket-powered live feed — signals appear within 60 seconds of detection

Tech stack:

- Next.js 15 + TypeScript frontend
- Fastify API with WebSocket support
- PostgreSQL 16 + PostGIS for geospatial queries
- Redis for caching + pub/sub
- Custom scraper pipeline (Node.js, 178 active feeds across 30+ source adapters)
- MapLibre GL for the map (no proprietary tile APIs)
- Pinecone for semantic signal similarity search

Intelligence pages for specialized deep-dives: cyber threats (APT/CVE tracking), sanctions (OFAC/EU/UN watchlists), finance (market signals + central bank events), internet outages (BGP disruptions + submarine cable cuts), and more.

The entire platform is MIT licensed. You can self-host with `docker compose up` or use the hosted version.

57,000+ signals indexed so far and growing. The scraper runs continuously — ingesting ~300 new signals per hour.

Live: https://world-pulse.io
GitHub: https://github.com/World-Pulse/WorldPulse

Happy to answer any questions about the architecture, the scraper pipeline, or the verification system.
```

---

## 2. X/TWITTER THREAD (Post at 10:05 ET Monday — pin Tweet 1)

**Tweet 1 (Hook — PIN THIS):**
```
I just open-sourced a global intelligence platform that monitors 300+ sources across 195 nations in real-time.

57,000+ signals. Live map. AI-powered verification.

The kind of situational awareness that used to cost six figures — now it's free and open-source.

Here's what WorldPulse does: 🧵
```

**Tweet 2:**
```
The world moves faster than any single news feed can track.

Conflicts, cyber attacks, natural disasters, sanctions — all happening simultaneously across the globe.

OSINT analysts juggle 20+ tabs. Journalists miss breaking events. Risk teams pay $30K/year for fragmented tools.
```

**Tweet 3:**
```
WorldPulse pulls from 300+ verified sources:

→ Wire services (AP, Reuters, AFP)
→ Government feeds (USGS, NOAA, WHO, NWS)
→ OSINT APIs (ACLED, OpenSanctions, IODA)
→ Specialized intel (GDELT, FlightRadar, MarineTraffic)

Every signal is classified, geolocated, and scored for reliability.
```

**Tweet 4:**
```
Everything renders on a live interactive globe.

Layers you can toggle:
→ Conflict & security events
→ Natural hazards (earthquakes, fires, floods)
→ Cyber threats & internet outages
→ Maritime & aviation tracking

Zoom in. Click any signal. See the full verification trail.
```

**Tweet 5:**
```
The part I'm most proud of — the verification pipeline.

Every signal goes through:
1. Source credibility check
2. Cross-source correlation
3. AI classification + geolocation
4. Reliability scoring (0-1 scale)

No unverified noise. Just actionable intelligence.
```

**Tweet 6:**
```
Specialized deep-dive pages for:

→ /cyber-threats — APT activity, CVEs, ransomware
→ /sanctions — OFAC/EU/UN watchlists
→ /finance — market signals, central bank events
→ /internet-outages — BGP disruptions, cable cuts

Each one is a standalone intelligence dashboard.
```

**Tweet 7:**
```
Built with:

→ Next.js 15 + TypeScript
→ Fastify + WebSocket (sub-60s latency)
→ PostgreSQL + PostGIS
→ MapLibre GL (no proprietary APIs)
→ Custom scraper pipeline (178 feeds, 30+ adapters)

Everything is MIT licensed. Self-host with docker compose up.
```

**Tweet 8:**
```
WorldPulse is 100% open source.

No paywall on the core platform. No vendor lock-in. No black box algorithms.

Try it live: world-pulse.io
Star it on GitHub: github.com/World-Pulse/WorldPulse

If you've ever wanted government-grade situational awareness for free — this is it.
```

**Tweet 9:**
```
What sources should we add next?

Drop a reply with any feed, API, or data source you'd want to see integrated.

Already on the roadmap: Telegram channel monitoring, satellite imagery, and real-time radio intercepts.
```

---

## 3. LINKEDIN (Post at 10:10 ET Monday — from personal profile)

```
Today I'm launching WorldPulse — an open-source global intelligence platform that monitors 300+ sources across 195 nations in real-time.

I built it because I was tired of the gap between what intelligence professionals have access to and what everyone else gets.

Governments and corporations spend six figures on tools like Janes, Dataminr, and Bloomberg Terminal to monitor world events. Meanwhile, journalists, researchers, NGOs, and security teams at smaller orgs are stuck manually checking 20+ sources and hoping they don't miss something critical.

WorldPulse changes that.

What it does:
→ Monitors 300+ verified sources (AP, Reuters, USGS, NOAA, ACLED, OpenSanctions, GDELT, and more)
→ AI-powered classification, geolocation, and cross-source verification on every signal
→ 57,000+ intelligence signals indexed and growing
→ Interactive world map with live conflict, hazard, cyber, and maritime layers
→ Dedicated intelligence pages for cyber threats, sanctions, finance, and internet outages
→ Real-time WebSocket updates — signals appear within 60 seconds of detection

The entire platform is open-source (MIT license). You can self-host it or use the hosted version at world-pulse.io.

The tech stack: Next.js 15, Fastify, PostgreSQL + PostGIS, Redis, MapLibre GL, and a custom scraper pipeline with 178 active feeds across 30+ adapters.

If you work in security, risk, intelligence, journalism, or just care about knowing what's happening in the world — I'd love your feedback.

Live: https://world-pulse.io
GitHub: https://github.com/World-Pulse/WorldPulse
```

---

## 4. REDDIT r/OSINT (Post at 10:30 ET Monday)

**Title:**
```
I built an open-source OSINT platform that monitors 300+ sources across 195 nations in real-time — here's what I learned
```

**Body:**
```
Hey r/OSINT,

I've spent the past several months building an open-source intelligence platform called WorldPulse. It's live now and I wanted to share what I learned building a real-time global signal aggregation pipeline — hopefully useful for anyone thinking about OSINT tooling.

**The problem I was solving:**

I was tired of juggling GDELT, RSS readers, Twitter lists, ACLED exports, and government feeds in separate tabs. I wanted one dashboard that correlates events across independent sources in real-time and surfaces what matters.

**What the platform does:**

WorldPulse ingests from 300+ sources — wire services (AP, Reuters, AFP), government feeds (USGS, NOAA, WHO, NWS), OSINT APIs (ACLED, OpenSanctions, IODA, OTX), and specialized feeds (GDELT, maritime AIS, aviation ADS-B). Every signal goes through:

1. Article extraction and deduplication
2. AI-powered classification (category, severity, region)
3. Geolocation via entity extraction + geocoding
4. Cross-source correlation (linking related signals from independent sources)
5. Reliability scoring (0-1 scale based on source trust tier + corroboration count + temporal consistency)

**Interesting things I learned building the scraper:**

- **RSS feeds lie about timestamps.** Some feeds backdate articles, others use timezone-unaware formats. I ended up normalizing everything to UTC and using ingestion time as the ground truth for "when did we learn about this."

- **Deduplication is harder than it sounds.** The same event gets reported by 15+ sources with different titles, angles, and details. Simple URL dedup catches maybe 30%. You need semantic similarity + entity overlap + temporal proximity to get it right.

- **Source reliability varies wildly.** Wire services are consistently fast and accurate. Regional media sometimes publishes rumors as breaking news. Government feeds are authoritative but slow. Building a trust-tier system that weights sources differently made the feed dramatically more useful.

- **Geolocation is the hardest enrichment step.** An article about "tensions in the South China Sea" needs to be placed on a map. Entity extraction gives you place names, but geocoding "South China Sea" vs "Scarborough Shoal" vs "Manila" requires context about what the event actually is.

- **GDELT is incredible but overwhelming.** The Global Database of Events, Language, and Tone processes basically every news article published worldwide. Without filtering and scoring, it's a firehose. I use it as a correlation source — if GDELT sees an event across 10+ outlets, that's a strong corroboration signal.

**What it looks like:**

- Interactive MapLibre globe with live layers (conflict, hazards, cyber, maritime)
- Real-time signal feed with WebSocket updates
- Dedicated pages for cyber threats, sanctions, finance, internet outages
- 57,000+ signals indexed and growing

**Tech and links:**

- Live: https://world-pulse.io
- GitHub: https://github.com/World-Pulse/WorldPulse (MIT license)
- Stack: Next.js 15, Fastify, PostgreSQL+PostGIS, Redis, MapLibre GL

It's fully open-source and self-hostable. Would love feedback from the community, especially on:

1. What sources am I missing that you use daily?
2. How do you handle deduplication in your own workflows?
3. Any interest in contributing source adapters?
```

---

## 5. REDDIT r/selfhosted (Post at 14:00 ET Monday)

**Title:**
```
Self-hosted global intelligence dashboard — monitors 300+ sources across 195 nations, runs on Docker Compose
```

**Body:**
```
I've been building an open-source intelligence platform called WorldPulse and wanted to share it with this community since self-hosting was a core design goal from the start.

**What it does**

WorldPulse ingests signals from 300+ verified sources — wire services (AP, Reuters, AFP), government feeds (USGS, NOAA, WHO), OSINT APIs (ACLED, OpenSanctions, GDELT), and specialized feeds (maritime AIS, aviation ADS-B, disease tracking). Every signal gets classified, geolocated, and cross-referenced against related events.

The frontend is an interactive world map with toggleable layers for conflict, natural hazards, cyber threats, and maritime activity. There are also 9 specialized dashboards for things like sanctions tracking, internet outages, and food security.

**Self-hosting setup**

    git clone https://github.com/World-Pulse/WorldPulse.git
    cd WorldPulse
    cp .env.production.example .env.production
    # Edit .env.production with your values
    docker compose -f docker-compose.prod.yml up -d

That's it. The stack is:

- **Frontend:** Next.js 15 on port 3000
- **API:** Fastify + WebSocket on port 3001
- **Database:** PostgreSQL 16 + PostGIS
- **Cache:** Redis 7
- **Maps:** MapLibre GL (no proprietary API keys — this was important to me)
- **Scraper:** Node.js service with 30+ source adapters

Total resource usage on my deployment: ~2GB RAM idle, ~4GB under load. Runs fine on a $24/mo DigitalOcean droplet. The scraper is the heaviest component since it's continuously polling feeds.

**What makes it self-host friendly**

- No proprietary API keys required for core functionality. Maps use MapLibre with free tile servers.
- No phone-home, no telemetry (PostHog is opt-in if you want your own analytics).
- MIT license — no AGPL restrictions, no CLA. Fork it, modify it, run it commercially.
- Everything is TypeScript and well-documented. The scraper adapters are modular if you want to add your own sources.
- Works fully offline for the frontend once signals are cached — the scraper obviously needs internet access.

**What I'd like feedback on**

- Resource optimization. The scraper polls 178 feeds continuously and I know there's room to reduce Redis memory usage.
- Source suggestions. I'm always looking for more public data feeds to add. If you monitor something niche (amateur radio, seismic networks, radiation sensors), I'd love to add an adapter.
- Docker Compose improvements. If anything about the production compose file feels non-standard, I want to know.

**Links**

- Live demo: world-pulse.io
- GitHub: github.com/World-Pulse/WorldPulse
- Self-hosting docs: github.com/World-Pulse/WorldPulse/blob/main/docs/self-hosting.md

Happy to answer any questions about the architecture or deployment.
```

---

## 6. REDDIT r/opensource (Post at 17:00 ET Monday)

**Title:**
```
I open-sourced my global intelligence platform under MIT — monitors 300+ sources, 195 nations, with a developer API
```

**Body:**
```
After months of development, I'm releasing WorldPulse as open-source software under the MIT license. It's a global intelligence platform that monitors 300+ verified sources in real-time — and I wanted to share why I chose to open-source it and what the experience has been like.

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

**Links**

- Live: world-pulse.io
- GitHub: github.com/World-Pulse/WorldPulse
- Contributing guide: github.com/World-Pulse/WorldPulse/blob/main/CONTRIBUTING.md

Feedback on the codebase, architecture decisions, or project structure is very welcome. Happy to answer questions.
```

---

## SCHEDULE SUMMARY

| Time (ET Mon) | Platform | Action |
|---|---|---|
| 10:00 | Hacker News | Post Show HN |
| 10:05 | X/Twitter | Post thread (9 tweets), pin Tweet 1 |
| 10:10 | LinkedIn | Post from personal profile |
| 10:30 | Reddit r/OSINT | Post |
| 14:00 | Reddit r/selfhosted | Post |
| 17:00 | Reddit r/opensource | Post |

**Before posting:** Update "57,000+" signal count to current number (check world-pulse.io sidebar).

**After posting:** Stay online and reply to every comment for 4+ hours. Engagement in the first hour drives visibility on all platforms.
