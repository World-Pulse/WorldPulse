# Reddit r/selfhosted Post — WorldPulse

**Subreddit:** r/selfhosted (~400K members)
**Post on:** Monday Apr 20, 2026 at 14:00 ET (afternoon wave, after HN settles)
**Flair:** Select "New Software" or "Project Share" if available

---

## Title

Self-hosted global intelligence dashboard — monitors 300+ sources across 184 nations, runs on Docker Compose

---

## Body

I've been building an open-source intelligence platform called WorldPulse and wanted to share it with this community since self-hosting was a core design goal from the start.

**What it does**

WorldPulse ingests signals from 300+ verified sources — wire services (AP, Reuters, AFP), government feeds (USGS, NOAA, WHO), OSINT APIs (ACLED, OpenSanctions, GDELT), and specialized feeds (maritime AIS, aviation ADS-B, disease tracking). Every signal gets classified, geolocated, and cross-referenced against related events.

The frontend is an interactive world map with toggleable layers for conflict, natural hazards, cyber threats, and maritime activity. There are also 9 specialized dashboards for things like sanctions tracking, internet outages, space weather, and food security.

**Self-hosting setup**

```bash
git clone https://github.com/World-Pulse/WorldPulse.git
cd WorldPulse
cp .env.production.example .env.production
# Edit .env.production with your values
docker compose -f docker-compose.prod.yml up -d
```

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

---

## Posting Notes

- r/selfhosted values: practical details, resource usage, Docker setup, honest limitations
- Lead with the `docker compose` command — that's what they want to see first
- Include resource numbers (RAM, CPU, disk)
- Don't over-sell. Mention real limitations (scraper needs internet, 4GB RAM under load)
- Respond to every technical question within an hour
- If someone asks about alternatives, be honest about WorldMonitor (AGPL, more mature UI) and Crucix (lighter, 26 feeds)
- Don't spam links — keep it to the end

