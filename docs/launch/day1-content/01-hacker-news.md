# Hacker News — Show HN Post

## Title

Show HN: WorldPulse – Open-source real-time global intelligence (300+ sources, 184 nations)

## Body

Hey HN,

I've been building WorldPulse for the past several months and it's now live at https://world-pulse.io

WorldPulse is an open-source intelligence platform that monitors 300+ sources across 184 countries in real-time. Think of it as a live-updating global situational awareness dashboard — the kind of tooling that used to be locked behind six-figure enterprise contracts.

**What it does:**

- Ingests signals from RSS feeds, GDELT, government APIs (USGS, NOAA, WHO, NWS), OSINT sources (ACLED, OpenSanctions, IODA), and more
- AI classification pipeline categorizes, geolocates, and assigns reliability scores to every signal
- Cross-source correlation engine links related events across independent sources
- Everything renders on an interactive MapLibre globe with live layers (conflict, natural hazards, cyber threats, maritime/aviation)
- WebSocket-powered live feed — signals appear within 60 seconds of detection

**Tech stack:**

- Next.js 15 + TypeScript frontend
- Fastify API with WebSocket support
- PostgreSQL 16 + PostGIS for geospatial queries
- Redis for caching + pub/sub
- Custom scraper pipeline (Node.js, ~30 source adapters)
- MapLibre GL for the map (no proprietary tile APIs)
- Pinecone for semantic signal similarity search

**Intelligence pages** for specialized deep-dives: cyber threats (APT/CVE tracking), sanctions (OFAC/EU/UN watchlists), finance (market signals + central bank events), space weather (solar flare alerts), internet outages (BGP disruptions + submarine cable cuts), and more.

The entire platform is MIT licensed. You can self-host with `docker compose up` or use the hosted version.

50,000+ signals indexed so far. The scraper runs continuously.

Live: https://world-pulse.io
GitHub: https://github.com/World-Pulse/WorldPulse

Happy to answer any questions about the architecture, the scraper pipeline, or the verification system.

---

## Posting Notes

- Post at **08:00 ET Monday** (peak HN activity)
- Stay online and respond to every comment for 4+ hours
- Be technical, not salesy — HN penalizes marketing speak
- If asked about AI: emphasize it's for classification/correlation, not generation
- If asked about data sources: point to the transparent source list
- Upvote momentum matters in the first 30 min — share the link with close contacts right at post time
