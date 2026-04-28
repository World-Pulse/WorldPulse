# Reddit — r/OSINT Launch Post

Post at **10:30 ET Monday** (after HN/X/LinkedIn wave). Educational angle, not promotional.

---

## Title

I built an open-source OSINT platform that monitors 300+ sources across 184 nations in real-time — here's what I learned

## Body

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
- Dedicated pages for cyber threats, sanctions, finance, space weather, internet outages
- 55,000+ signals indexed and growing

**Tech and links:**

- Live: https://world-pulse.io
- GitHub: https://github.com/World-Pulse/WorldPulse (MIT license)
- Stack: Next.js 15, Fastify, PostgreSQL+PostGIS, Redis, MapLibre GL

It's fully open-source and self-hostable. Would love feedback from the community, especially on:

1. What sources am I missing that you use daily?
2. How do you handle deduplication in your own workflows?
3. Any interest in contributing source adapters?

---

## Posting Notes

- r/OSINT values technical depth — this post leads with what you learned, not what you built
- Don't include screenshots in the post (Reddit doesn't render inline images well in text posts) — add them as a comment reply
- Respond to every comment
- If someone asks about a specific source, be honest about limitations
- Cross-post to r/geopolitics on Day 2 with a different angle (data patterns, not tooling)
