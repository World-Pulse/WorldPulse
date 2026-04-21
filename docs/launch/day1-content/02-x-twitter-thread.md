# X/Twitter Launch Thread

Post at **10:05 ET Monday** (5 min after HN). Pin the thread to your profile.

---

### Tweet 1 (Hook — pin this)

I just open-sourced a global intelligence platform that monitors 300+ sources across 184 nations in real-time.

55,000+ signals. Live map. AI-powered verification.

The kind of situational awareness that used to cost six figures — now it's free and open-source.

Here's what WorldPulse does: (thread)

---

### Tweet 2 (The Problem)

The world moves faster than any single news feed can track.

Conflicts, cyber attacks, natural disasters, sanctions — all happening simultaneously across the globe.

OSINT analysts juggle 20+ tabs. Journalists miss breaking events. Risk teams pay $30K/year for fragmented tools.

---

### Tweet 3 (The Solution)

WorldPulse pulls from 300+ verified sources:

- Wire services (AP, Reuters, AFP)
- Government feeds (USGS, NOAA, WHO, NWS)
- OSINT APIs (ACLED, OpenSanctions, IODA)
- Specialized intel (GDELT, FlightRadar, MarineTraffic)

Every signal is classified, geolocated, and scored for reliability.

[SCREENSHOT: signal feed with reliability dots]

---

### Tweet 4 (The Map)

Everything renders on a live interactive globe.

Layers you can toggle:
- Conflict & security events
- Natural hazards (earthquakes, fires, floods)
- Cyber threats & internet outages
- Maritime & aviation tracking

Zoom in. Click any signal. See the full verification trail.

[SCREENSHOT: map with multiple layers active]

---

### Tweet 5 (Verification)

This is the part I'm most proud of — the verification pipeline.

Every signal goes through:
1. Source credibility check
2. Cross-source correlation
3. AI classification + geolocation
4. Reliability scoring (0-1 scale)

No unverified noise. Just actionable intelligence.

[SCREENSHOT: signal detail with verification timeline]

---

### Tweet 6 (Intelligence Pages)

Specialized deep-dive pages for:

- /cyber-threats — APT activity, CVEs, ransomware
- /sanctions — OFAC/EU/UN watchlists
- /finance — market signals, central bank events
- /space-weather — solar flare alerts
- /internet-outages — BGP disruptions, cable cuts

Each one is a standalone intelligence dashboard.

[SCREENSHOT: cyber threats page]

---

### Tweet 7 (Tech Stack)

Built with:

- Next.js 15 + TypeScript
- Fastify + WebSocket (sub-60s latency)
- PostgreSQL + PostGIS
- MapLibre GL (no proprietary APIs)
- Custom scraper pipeline (178 feeds, 30+ adapters)
- Pinecone for semantic search

Everything is MIT licensed. Self-host with docker compose up.

---

### Tweet 8 (Open Source CTA)

WorldPulse is 100% open source.

No paywall on the core platform. No vendor lock-in. No black box algorithms.

Try it live: world-pulse.io
Star it on GitHub: github.com/World-Pulse/WorldPulse

If you've ever wanted government-grade situational awareness for free — this is it.

---

### Tweet 9 (Engagement Ask)

What sources should we add next?

Drop a reply with any feed, API, or data source you'd want to see integrated.

Already on the roadmap: Telegram channel monitoring, satellite imagery, and real-time radio intercepts.

---

## Posting Notes

- Add 2-3 screenshots per visual tweet (map, feed, signal detail, cyber page)
- Use alt text on all images
- Reply to your own thread with a "TL;DR" linking to the site
- Engage with every reply for the first 3 hours
- Retweet from the WorldPulse account if you have one
