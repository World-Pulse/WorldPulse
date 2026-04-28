# Launch Day Copy-Paste Ready — Monday Apr 20, 2026

All text below is ready to copy-paste into each platform. No markdown formatting artifacts — just the raw text you'll post.

---

## SCHEDULE AT A GLANCE

| Time (ET) | Channel | Action |
|---|---|---|
| 00:01 PT / 3:01 AM ET | Product Hunt | Goes live automatically (submit tonight) |
| 09:00 | Press | Send pitch emails from devon@world-pulse.io |
| 10:00 | Hacker News | Post Show HN (manually — can't schedule) |
| 10:05 | X/Twitter | Thread goes live (schedule tonight via X) |
| 10:10 | LinkedIn | Post goes live (schedule tonight via LinkedIn) |
| 10:30 | Reddit r/OSINT | Post manually |
| 12:00 | Press | Follow up with any quick replies |
| 14:00 | Reddit r/selfhosted | Post manually |
| 15:30 | Reddit r/geopolitics | Post manually |
| 17:00 | Reddit r/opensource | Post manually |

---

## 1. HACKER NEWS — 10:00 ET (manual post)

**Title** (paste into HN title field):
```
Show HN: WorldPulse – Open-source real-time global intelligence (300+ sources, 184 nations)
```

**URL** (paste into URL field):
```
https://world-pulse.io
```

**Body** (paste into text field — only if you choose text post instead of URL):
```
Hey HN,

I've been building WorldPulse for the past several months and it's now live at https://world-pulse.io

WorldPulse is an open-source intelligence platform that monitors 300+ sources across 184 countries in real-time. Think of it as a live-updating global situational awareness dashboard — the kind of tooling that used to be locked behind six-figure enterprise contracts.

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

Intelligence pages for specialized deep-dives: cyber threats (APT/CVE tracking), sanctions (OFAC/EU/UN watchlists), finance (market signals + central bank events), space weather (solar flare alerts), internet outages (BGP disruptions + submarine cable cuts), and more.

The entire platform is MIT licensed. You can self-host with `docker compose up` or use the hosted version.

55,000+ signals indexed so far and growing. The scraper runs continuously — ingesting ~300 new signals per hour.

Live: https://world-pulse.io
GitHub: https://github.com/World-Pulse/WorldPulse

Happy to answer any questions about the architecture, the scraper pipeline, or the verification system.
```

**NOTE:** HN works best as a URL submission (just the title + URL, no body text). Post the body as the first comment instead. This way HN links directly to your site.

---

## 2. X/TWITTER THREAD — 10:05 ET (schedule via X tonight)

Schedule all 9 tweets as a thread. Attach screenshots where noted.

**Tweet 1** (pin this):
```
I just open-sourced a global intelligence platform that monitors 300+ sources across 184 nations in real-time.

55,000+ signals. Live map. AI-powered verification.

The kind of situational awareness that used to cost six figures — now it's free and open-source.

Here's what WorldPulse does:
```

**Tweet 2:**
```
The world moves faster than any single news feed can track.

Conflicts, cyber attacks, natural disasters, sanctions — all happening simultaneously across the globe.

OSINT analysts juggle 20+ tabs. Journalists miss breaking events. Risk teams pay $30K/year for fragmented tools.
```

**Tweet 3** (attach screenshot of signal feed):
```
WorldPulse pulls from 300+ verified sources:

• Wire services (AP, Reuters, AFP)
• Government feeds (USGS, NOAA, WHO, NWS)
• OSINT APIs (ACLED, OpenSanctions, IODA)
• Specialized intel (GDELT, FlightRadar, MarineTraffic)

Every signal is classified, geolocated, and scored for reliability.
```

**Tweet 4** (attach screenshot of the map):
```
Everything renders on a live interactive globe.

Layers you can toggle:
• Conflict & security events
• Natural hazards (earthquakes, fires, floods)
• Cyber threats & internet outages
• Maritime & aviation tracking

Zoom in. Click any signal. See the full verification trail.
```

**Tweet 5** (attach screenshot of signal detail):
```
This is the part I'm most proud of — the verification pipeline.

Every signal goes through:
1. Source credibility check
2. Cross-source correlation
3. AI classification + geolocation
4. Reliability scoring (0-1 scale)

No unverified noise. Just actionable intelligence.
```

**Tweet 6** (attach screenshot of cyber threats page):
```
Specialized deep-dive pages for:

• /cyber-threats — APT activity, CVEs, ransomware
• /sanctions — OFAC/EU/UN watchlists
• /finance — market signals, central bank events
• /space-weather — solar flare alerts
• /internet-outages — BGP disruptions, cable cuts

Each one is a standalone intelligence dashboard.
```

**Tweet 7:**
```
Built with:

• Next.js 15 + TypeScript
• Fastify + WebSocket (sub-60s latency)
• PostgreSQL + PostGIS
• MapLibre GL (no proprietary APIs)
• Custom scraper pipeline (178 feeds, 30+ adapters)
• Pinecone for semantic search

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

**After posting, reply to your own thread with:**
```
TL;DR — open-source global intelligence platform. 300+ sources, 184 nations, real-time map, free API.

world-pulse.io
github.com/World-Pulse/WorldPulse
```

---

## 3. LINKEDIN — 10:10 ET (schedule via LinkedIn tonight)

```
Today I'm launching WorldPulse — an open-source global intelligence platform that monitors 300+ sources across 184 nations in real-time.

I built it because I was tired of the gap between what intelligence professionals have access to and what everyone else gets.

Governments and corporations spend six figures on tools like Janes, Dataminr, and Bloomberg Terminal to monitor world events. Meanwhile, journalists, researchers, NGOs, and security teams at smaller orgs are stuck manually checking 20+ sources and hoping they don't miss something critical.

WorldPulse changes that.

What it does:
- Monitors 300+ verified sources (AP, Reuters, USGS, NOAA, ACLED, OpenSanctions, GDELT, and more)
- AI-powered classification, geolocation, and cross-source verification on every signal
- 55,000+ intelligence signals indexed and growing
- Interactive world map with live conflict, hazard, cyber, and maritime layers
- Dedicated intelligence pages for cyber threats, sanctions, finance, space weather, and internet outages
- Real-time WebSocket updates — signals appear within 60 seconds of detection

The entire platform is open-source (MIT license). You can self-host it or use the hosted version at world-pulse.io.

The tech stack: Next.js 15, Fastify, PostgreSQL + PostGIS, Redis, MapLibre GL, and a custom scraper pipeline with 178 active feeds across 30+ adapters.

If you work in security, risk, intelligence, journalism, or just care about knowing what's happening in the world — I'd love your feedback.

Live: https://world-pulse.io
GitHub: https://github.com/World-Pulse/WorldPulse
```

Attach 2-3 screenshots as a carousel: map view, signal feed, signal detail page.

---

## 4. REDDIT r/OSINT — 10:30 ET (manual post)

See `04-reddit-r-osint.md` — post the full body as-is. Title:

```
I built an open-source OSINT platform that monitors 300+ sources across 184 nations in real-time — here's what I learned
```

---

## 5. REDDIT r/selfhosted — 14:00 ET (manual post)

See `07-reddit-r-selfhosted.md` — post the full body as-is. Title:

```
Self-hosted global intelligence dashboard — monitors 300+ sources across 184 nations, runs on Docker Compose
```

---

## 6. REDDIT r/geopolitics — 15:30 ET (manual post)

See `08-reddit-r-geopolitics.md` — post the full body as-is. Title:

```
I built a platform that tracks geopolitical events across 184 nations in real-time — here are some patterns that emerge when you see the full picture
```

---

## 7. REDDIT r/opensource — 17:00 ET (manual post)

See `09-reddit-r-opensource.md` — post the full body as-is. Title:

```
I open-sourced my global intelligence platform under MIT — monitors 300+ sources, 184 nations, with a developer API
```

---

## SCREENSHOTS NEEDED (take tonight)

You need 5-6 screenshots for the launch. Dark theme, 1920x1080 or 2560x1440, clear browser chrome:

1. **Hero map** — Full MapLibre globe with active signal markers, multiple continents visible
2. **Live signal feed** — Recent signals with category badges, reliability bars, source tags
3. **Signal detail** — Click into one signal, show verification timeline + reliability score
4. **Cyber threats page** — The /cyber-threats dashboard
5. **Developer page** — The /developers page with API docs + pricing
6. **Sanctions page** — The /sanctions dashboard (optional, for variety)

Use these across X thread, LinkedIn carousel, Product Hunt gallery, and press emails.

---

## PRODUCT HUNT — Submit tonight, goes live 00:01 PT Monday

See `05-product-hunt.md` for full listing details. Key fields to fill:

- **Tagline:** Open-source global intelligence — 300+ sources, 184 nations, real-time.
- **Topics:** Open Source, Developer Tools, Data Visualization, Artificial Intelligence, Geospatial
- **Gallery:** Use the 5 screenshots above
- **Maker comment:** Copy from `05-product-hunt.md` "Maker Comment" section — paste immediately after it goes live

---

## PRESS EMAILS — 9:00 AM ET Monday (no embargo)

Send from devon@world-pulse.io. See `06-press-pitch.md` for the full template.

Since there's no embargo, update the opening to:

```
I'm launching WorldPulse today — an open-source global intelligence platform that monitors 300+ verified sources across 184 nations in real-time. It's MIT-licensed, self-hostable, and has a free developer API.
```

Attach 3 screenshots (map, signal detail, developer page).

Priority journalists (Tier 1 — send these first):
1. Lorenzo Franceschi-Bicchierai (TechCrunch)
2. Kim Zetter (Zero Day / Substack)
3. Catalin Cimpanu (The Record)
4. Zack Whittaker (TechCrunch)
5. Joseph Cox (404 Media)

Submit to TLDR Newsletter at tldr.tech/submit.
