# WorldPulse

**Open-source world news, checked by counting the outlets that report each story.**
Reports from more than 150 news feeds and open data sources, grouped into stories, checked against each other and mapped.

[![License: MIT](https://img.shields.io/badge/License-MIT-amber.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://typescriptlang.org)

**[world-pulse.io](https://world-pulse.io)** · **[API](#api-reference)** · **[Self-hosting](#self-hosting)** · **[Contributing](#contributing)**

---

## What is WorldPulse?

WorldPulse reads news outlets' feeds and open data, groups the reports of one event into one story, and counts how many outlets carry it. An outlet is a website: twelve articles on one website are one outlet, and copies are not counted twice. A story is marked Verified when two or more outlets report it and its reliability score reaches 65%; an AI check then reads the reports and looks for contradictions on facts such as where, who and how many. Verified means "more than one outlet says so", not "proven true". The details: [world-pulse.io/how-we-count](https://world-pulse.io/how-we-count).

- **Stories, not duplicates** — the reports of one event are one story, with every outlet that carries it
- **Every report keeps a link to its original source**
- **A world map** of located reports, filterable by topic, region and time (MapLibre GL)
- **Country pages and a daily briefing** of the verified stories (the briefings are written by an AI model from the verified reports)
- **Feeds and an open API** — Atom and JSON feeds of verified stories; the public API endpoints need no key
- **Live updates** over WebSocket
- **For AI assistants** — an MCP server (the protocol assistants such as Claude use to call outside tools) that needs no key
- **Sources** — news outlets' own feeds plus open data such as GDELT, USGS (earthquakes) and GDACS (disaster alerts); the full list is at [world-pulse.io/sources](https://world-pulse.io/sources)

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker + Docker Compose

### 1. Clone and install

```bash
git clone https://github.com/World-Pulse/WorldPulse.git
cd WorldPulse
pnpm install
```

### 2. Start infrastructure

```bash
docker compose up -d postgres redis
```

### 3. Configure environment

```bash
cp apps/api/.env.example     apps/api/.env.local
cp apps/scraper/.env.example apps/scraper/.env.local
cp apps/web/.env.example     apps/web/.env.local
```

### 4. Run migrations and seed

```bash
pnpm db:migrate
pnpm db:seed
```

### 5. Start development

```bash
pnpm dev
```

- **Web app** at http://localhost:3000
- **API server** at http://localhost:3001
- **Scraper** runs as a background process

---

## Architecture

```
WorldPulse/
├── apps/
│   ├── web/          # Next.js frontend
│   ├── api/          # Fastify API + WebSocket server
│   └── scraper/      # Signal intelligence pipeline
├── packages/
│   ├── types/        # Shared TypeScript types
│   ├── ui/           # Shared component library
│   └── sdk/          # TypeScript client (not on npm yet)
└── infrastructure/
    └── docker/       # Docker configs, init scripts
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, TypeScript, Tailwind CSS |
| API | Fastify, TypeScript, WebSocket |
| Database | PostgreSQL 16 + PostGIS |
| Cache | Redis 7 |
| Maps | MapLibre GL (no proprietary APIs) |
| Search | Meilisearch (full-text) |
| Scraper | Node.js, a news-feed poller plus adapters for open data sources |

---

## Key Features

### Stories and verification

Every report passes through the same steps: its place and category are read, reports of one event are grouped into one story, and each story's outlets are counted. How a story becomes Verified, and what that does and doesn't mean: [world-pulse.io/how-we-count](https://world-pulse.io/how-we-count).

### Map

- A MapLibre GL globe, with no proprietary API keys
- Located reports, filterable by topic, region and time
- Click a report to open its page, with the outlets that carry its story

### Developer API

Public endpoints need no API key. Endpoints, examples and limits: [world-pulse.io/developers](https://world-pulse.io/developers).

AI assistants can query WorldPulse through its MCP server at `https://api.world-pulse.io/mcp` (no key): see [world-pulse.io/developers#mcp](https://world-pulse.io/developers#mcp).

---

## API Reference

### REST API

Base URL: `https://api.world-pulse.io/api/v1`

```
GET  /public/signals               Newest verified reports (no key needed)
GET  /stories                      The stories most outlets are reporting
GET  /signals/:id                  One report
GET  /signals/map/points           Located reports for the map
GET  /search?q=...                 Search
GET  /rss/signals.xml              Atom feed of verified reports (also /rss/signals.json)
```

### MCP (AI assistants)

```
POST https://api.world-pulse.io/mcp     Streamable HTTP, JSON-RPC; no key
Tools: top_stories, story, search_reports, week, check_link (paste an article's address: how many outlets reported its story), under_reported (the crises with the fewest outlets for the people displaced), story_numbers (a story's figures, each with how many outlets give it), outlet (what a news website is), near (the reports pinned near a place), country (a country right now), daily_brief (the Daily Briefing), entity (a person, organisation or place in the news), trend (coverage of a country or an entity, day by day), check_claim (what the newsrooms report about a claim), breaking (the urgent reports of the last few hours), trending (who and what is in the news most), hotspots (where serious reports of several kinds meet), story_by_country (one story country by country), shipping (ships, ports, straits and navies), hazards (earthquakes, volcanoes, tsunamis, wildfires), latest (the newest verified reports), how_verified (how a story was checked), story_timeline (who reported a story first and how it spread), conflicts (where conflict and military news is reported), internet_outages (from IODA), connections (who and what an entity is named with, or the stories naming two), protests, outbreaks and displacement (the map's layers, place by place), who_covers (the newsrooms read in a country), day (one day's top stories), unconfirmed (serious reports no second outlet has confirmed yet), newly_verified (reports that just found their second outlet), local_press (stories covered abroad while the home press barely appears), site_check (known AI content farms and reliability scores), quiet_places (where news most rarely finds a second outlet), story_languages (the languages a story is reported in), verified_in_languages (the newest non-English reports to turn verified), languages_today (the languages the news came in), missed_in_english (stories verified with no English report found), military_aircraft (military aircraft in the air now), emergency_flights (aircraft squawking an emergency now), live_cameras (public cameras near a place), busiest_countries (the countries with the most news), news_volume (how much news WorldPulse reads), similar_reports (the reports closest to one report), reader_flags (what readers flagged on a report), outlet_mix (what kinds of newsroom carry a story), country_compare (two countries side by side), space_weather (NOAA's alerts), chokepoints_news (the shipping chokepoints in the news), exploited_vulnerabilities (CISA's catalogue of exploited flaws), travel_advice (US and UK travel advice), first_reporters (the outlets first on a story), verification_speed (how fast stories find a second outlet), topics_today (the topics of the news), outlet_reports (one outlet's newest reports), region_top_stories (a region's top stories), rising_stories (new stories spreading fast), thin_coverage (the places WorldPulse reads few newsrooms in), sanctions_actions (new US and EU sanctions), us_weather_alerts (US National Weather Service warnings), carrier_groups (where the US Navy's carriers are), cyber_attacks, elections_watch and disaster_news (that news by country), state_media_stories (state media in the top stories), country_topics (what a country's news is about), busiest_outlets (the outlets read most), local_only_stories (a country's stories only its own press reports), numbers_differ (top stories whose outlets give different numbers), long_running_stories, news_by_hour, serious_places (the countries with the most serious reports), state_media_outlets, outlet_languages, how_worldpulse_counts, worldpulse_status, story_compare (two stories side by side), report_entities (who and what a report names), topic_top_stories, whats_new_today (the top stories that were not among yesterday's), rising_countries, entity_compare, outlet_compare, outlet_profile (what an outlet reports about), coverage_stats (how much of the world WorldPulse reads), world_today, region_snapshot (the world or a region in one answer), find_outlet, most_global_stories, country_rank, compare_regions, topic_countries, who_reports_on (the outlets reporting the most on a country), country_languages, news_by_day, topic_trend, region_topics, tool_guide (which tool answers which question)
```

Claude Code: `claude mcp add --transport http worldpulse https://api.world-pulse.io/mcp`

Fewer tools, for apps that take 40 at most: `https://api.world-pulse.io/mcp/essentials` (28), `/mcp/news` (39), `/mcp/places` (38), `/mcp/outlets` (19), `/mcp/live` (16).

### WebSocket

```
wss://api.world-pulse.io/ws

Subscribe:  { "type": "subscribe", "payload": { "channels": ["breaking"] } }
Receive:    { "event": "signal.new", "data": { "signal": {...} } }
```

Full API documentation: [docs/api.md](docs/api.md)

---

## Self-Hosting

### Docker Compose (recommended)

```bash
git clone https://github.com/World-Pulse/WorldPulse.git
cd WorldPulse
cp .env.prod.example .env.prod
# Edit .env.prod with your values
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Domains, certificates and keys: [docs/self-hosting.md](docs/self-hosting.md)

---

## Contributing

WorldPulse welcomes contributions of all kinds.

### Ways to contribute

- **Bug reports** — [Open an issue](https://github.com/World-Pulse/WorldPulse/issues)
- **Feature requests** — [Open an issue](https://github.com/World-Pulse/WorldPulse/issues)
- **Code** — Fork, branch, PR. See [CONTRIBUTING.md](CONTRIBUTING.md)
- **New sources** — Propose or build a scraper adapter for a data source we're missing
- **Documentation** — Improve guides, add examples, fix typos

### Development setup

```bash
git clone https://github.com/<your-fork>/WorldPulse.git
cd WorldPulse
pnpm install
docker compose up -d postgres redis
pnpm db:migrate && pnpm db:seed
pnpm dev
```

### Code style

- TypeScript strict mode
- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`)
- Tests required for new pipeline features

---

## License

The code is MIT — see [LICENSE](LICENSE) for details.

Using the hosted API at api.world-pulse.io: personal, research, education and non-profit use is free, with a link back to world-pulse.io. Commercial use, in your own work and products, comes with WorldPulse Pro ($12 a month: [world-pulse.io/pricing](https://world-pulse.io/pricing)), with a link back; a Pro API key also gets its own budget, 600 requests a minute and 50,000 a day. Reselling or redistributing the data needs a data license: email support@world-pulse.io.


