# WorldPulse

**Open-source global intelligence platform.**
Real-time signals from 300+ sources across 184 nations — verified, enriched, and mapped.

[![License: MIT](https://img.shields.io/badge/License-MIT-amber.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://typescriptlang.org)

**[Home Base](https://world-pulse.io)** · **[API Docs](#api-reference)** · **[Self-Host Guide](#self-hosting)** · **[Contributing](#contributing)**

---

<!-- TODO: Replace with actual screenshots before launch -->
<!-- ![WorldPulse Dashboard](docs/images/hero-screenshot.png) -->

## What is WorldPulse?

WorldPulse monitors the world so you don't have to. It ingests signals from wire services, government feeds, OSINT APIs, and specialized data sources — then classifies, geolocates, verifies, and maps every event in real-time.

The kind of situational awareness that used to cost six figures, now open-source and free.

- **300+ verified sources** — AP, Reuters, USGS, NOAA, ACLED, OpenSanctions, GDELT, and more
- **50,000+ intelligence signals** indexed and growing continuously
- **AI-powered verification** — cross-source correlation, reliability scoring, deduplication
- **Interactive world map** — live conflict, hazard, cyber, and maritime layers on MapLibre GL
- **Real-time updates** — WebSocket-powered, signals appear within 60 seconds
- **Open API** — build on top of WorldPulse, no API key required for public data
- **Self-hostable** — `docker compose up` and you're running

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
│   ├── web/          # Next.js 15 frontend
│   ├── api/          # Fastify API + WebSocket server
│   └── scraper/      # Signal intelligence pipeline
├── packages/
│   ├── types/        # Shared TypeScript types
│   ├── ui/           # Shared component library
│   └── config/       # ESLint/TS configs
└── infrastructure/
    └── docker/       # Docker configs, init scripts
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, TypeScript, Tailwind CSS |
| API | Fastify, TypeScript, WebSocket |
| Database | PostgreSQL 16 + PostGIS |
| Cache | Redis 7 |
| Maps | MapLibre GL (no proprietary APIs) |
| Search | Pinecone (semantic) + Meilisearch (full-text) |
| Scraper | Node.js, 30+ source adapters |
| AI | Anthropic (verification), Ollama (local classification) |

---

## Key Features

### Signal Pipeline

The scraper monitors 300+ verified global sources:

- **Wire Services**: AP, Reuters, AFP, BBC, Bloomberg, Al Jazeera
- **Government Feeds**: USGS, NOAA, WHO, NWS, NASA, FEMA
- **OSINT Sources**: ACLED (conflict), OpenSanctions, IODA (outages), OTX (cyber threats)
- **Specialized**: GDELT, maritime AIS, aviation ADS-B, ProMED (disease)

Every signal passes through a 5-stage enrichment pipeline: extraction, classification, geolocation, cross-source correlation, and reliability scoring.

### Intelligence Map

- MapLibre GL globe — no proprietary API keys
- Satellite, dark, and terrain basemap switcher
- 3D tilt with NavigationControl
- Live overlay layers: conflict, natural hazards, cyber threats, maritime/aviation
- Click any signal for a full verification timeline
- Supercluster for marker grouping at all zoom levels

### Intelligence Pages

Dedicated deep-dive dashboards for specialized analysis:

- **/cyber-threats** — APT activity, CVEs, ransomware tracking
- **/sanctions** — OFAC, EU, UN watchlist entries
- **/finance** — Market signals, central bank events, economic indicators
- **/space-weather** — Solar flares, geomagnetic storms, NOAA alerts
- **/internet-outages** — BGP disruptions, submarine cable cuts
- **/governance** — Democracy indices, policy changes by country
- **/food-security** — Famine early warning, crop disruptions
- **/digital-rights** — Internet shutdowns, surveillance events
- **/undersea-cables** — Global cable infrastructure monitoring

### Source Credibility

- AI content farm detection — 3,000+ flagged domains
- Reliability scores on every signal (0–1 scale, color-coded)
- Source trust tiers: Wire Service > Official > Verified Media > Community

### Real-Time Feed

- WebSocket-powered live updates
- Command palette (Cmd+K / Ctrl+K) for instant navigation
- Category and severity filters
- Redis-cached public feeds (30s TTL)

### Developer API

No API key required for public endpoints. Full REST API + WebSocket.

| Plan | Rate Limit | History | Price |
|------|-----------|---------|-------|
| Free | 60 req/min | 7 days | $0 |
| Pro | 300 req/min | 90 days | $12/mo |

---

## API Reference

### REST API

Base URL: `https://api.world-pulse.io/api/v1`

```
GET  /feed/signals                 Live signal feed
GET  /signals                      List signals (filterable)
GET  /signals/:id                  Signal detail + verification trail
GET  /signals/map                  Geo-located signals for map rendering
GET  /search?q=...                 Full-text + semantic search
GET  /api/v1/public/signals        Public API (no auth, CORS enabled)
```

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
cp .env.production.example .env.production
# Edit .env.production with your values
docker compose -f docker-compose.prod.yml up -d
```

WorldPulse is now running on port 80. Point a reverse proxy with TLS at it and you're production-ready.

Full self-hosting guide: [docs/self-hosting.md](docs/self-hosting.md)

---

## Contributing

WorldPulse welcomes contributions of all kinds.

**Good first issues** are labeled and ready for new contributors: [browse them here](https://github.com/World-Pulse/WorldPulse/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).

### Ways to contribute

- **Bug reports** — [Open an issue](https://github.com/World-Pulse/WorldPulse/issues)
- **Feature requests** — [Start a discussion](https://github.com/World-Pulse/WorldPulse/discussions)
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

## Community

- **Discord**: [discord.gg/worldpulse](https://discord.gg/worldpulse)
- **GitHub Discussions**: [World-Pulse/WorldPulse/discussions](https://github.com/World-Pulse/WorldPulse/discussions)

---

## Roadmap

**Now**: Expanding source coverage, mobile app, contributor onboarding

**Next**: Communities, expert verification program, Telegram channel monitoring

**Later**: Satellite imagery integration, real-time radio intercepts, native iOS/Android

See [ROADMAP.md](ROADMAP.md) for details.

---

## License

MIT — see [LICENSE](LICENSE) for details.


