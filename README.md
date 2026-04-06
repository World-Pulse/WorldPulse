# 🌍 WorldPulse

**The open-source global intelligence network.**  
Real-time world events + social discourse, verified and trustworthy.

[![License: MIT](https://img.shields.io/badge/License-MIT-amber.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://typescriptlang.org)

---

## What is WorldPulse?

WorldPulse is what you get when you combine the live event monitoring of a global wire service with the social dynamics of the early internet — open-source, verifiable, and free.

- **Real-time signals** from 500+ global sources, verified and cross-checked
- **Social layer** where journalists, experts, and communities add context
- **Reliability scores** on every piece of content (no more guessing)
- **Open API** — build on top of WorldPulse freely
- **Self-hostable** — run your own instance in minutes

---

## Quick Start (Local Dev)

### Prerequisites
- Node.js 20+
- pnpm 9+
- Docker + Docker Compose

### 1. Clone & Install

```bash
git clone https://github.com/worldpulse/worldpulse.git
cd worldpulse
pnpm install
```

### 2. Start Infrastructure

```bash
docker compose up -d postgres redis kafka meilisearch
```

This starts:
- PostgreSQL 16 + PostGIS on `localhost:5432`
- Redis 7 on `localhost:6379`
- Kafka + Zookeeper on `localhost:9092`
- Meilisearch on `localhost:7700`

### 3. Configure Environment

```bash
cp apps/api/.env.example     apps/api/.env.local
cp apps/scraper/.env.example apps/scraper/.env.local
cp apps/web/.env.example     apps/web/.env.local
```

### 4. Run Migrations & Seed

```bash
pnpm db:migrate
pnpm db:seed
```

### 5. Start Development

```bash
pnpm dev
```

This starts:
- **Web app** → http://localhost:3000
- **API server** → http://localhost:3001
- **Signal scraper** → background process
- **Kafka UI** → http://localhost:8090
- **Grafana** → http://localhost:3100 (admin/admin)

---

## Architecture

```
worldpulse/
├── apps/
│   ├── web/          # Next.js 15 frontend (TypeScript)
│   ├── api/          # Fastify API + WebSocket server
│   └── scraper/      # Signal intelligence pipeline
├── packages/
│   ├── types/        # Shared TypeScript types
│   ├── ui/           # Shared React component library
│   └── config/       # Shared ESLint/TS configs
├── infrastructure/
│   ├── docker/       # Docker configs, init scripts
│   ├── k8s/          # Kubernetes manifests (production)
│   └── terraform/    # Cloud infrastructure (AWS/GCP/self-hosted)
└── docs/             # Documentation
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, TypeScript, Tailwind CSS |
| API | Fastify, TypeScript, WebSocket |
| Scraper | Node.js, Kafka, RSS/web scraping |
| Database | PostgreSQL 16 + PostGIS |
| Cache | Redis 7 |
| Search | Meilisearch |
| Queue | Apache Kafka |
| Maps | MapLibre GL (open-source) |
| Monitoring | Prometheus + Grafana |
| AI | Ollama (local) / OpenAI-compatible API |

---

## Key Features

### 🛰️ Signal Pipeline
The scraper monitors 80+ verified global sources across:
- **Tier 1 Wire Services**: AP, Reuters, AFP, BBC, Bloomberg, Nikkei Asia, Al Jazeera
- **Official Sources**: UN, WHO, USGS, NOAA, NASA, PHIVOLCS, FEMA
- **Global Media**: Le Monde, Der Spiegel, El País, The Wire India, Daily Maverick, AllAfrica, Folha, Arab News
- **Specialized Feeds**: ACLED (conflict), ProMED (disease), OpenSky (aviation), AIS (maritime)

### 🔍 7-Layer Signal Enrichment
Every verified signal is enriched with:
1. **Reliability score** (0–1) — cross-source corroboration + temporal consistency
2. **Virality badge** — spreading velocity across sources and social channels
3. **Geolocation** — PostGIS coordinates for map rendering
4. **GDELT TV clips** — broadcast news segments mentioning the event
5. **GDELT visual imagery** — editorial photos from global press
6. **YouTube/podcast embedding** — multimedia context per signal
7. **Semantic vector embedding** — Pinecone-powered similarity search

### ⚡ Real-Time Feed
- WebSocket-powered live updates (zero-refresh)
- ⌘K / Ctrl+K global command palette for instant navigation
- Redis-cached public feeds (30s TTL)
- Configurable alerts: Email, Telegram, Discord, Slack, Teams

### 🗺️ Palantir-Style Intelligence Map
- MapLibre GL — open-source, no proprietary API key required
- Satellite + dark + terrain basemap switcher
- 3D tilt (45° pitch) with NavigationControl
- Live intelligence overlays:
  - ✈️ **ADS-B Aircraft** — real-time aviation signals (60s refresh)
  - ⚓ **Maritime AIS** — ship tracking with clustering (120s refresh)
  - 🌊 **Naval Intel** — carrier movements, dark ship alerts
  - 🌋 **Natural Hazards** — earthquakes, floods, wildfires
- Palantir-style annotation cards on click
- Supercluster for marker clustering at all zoom levels

### 🕵️ Intelligence Pages
Dedicated deep-dive pages for specialized analysts:
- **[/cyber-threats](/cyber-threats)** — APT activity, CVEs, ransomware, DDoS events
- **[/sanctions](/sanctions)** — Watchlist entries, OFAC/UN/EU sanctions data
- **[/finance](/finance)** — Market signals, central bank events, economic indicators
- **[/space-weather](/space-weather)** — Solar flares, geomagnetic storms, NOAA alerts
- **[/internet-outages](/internet-outages)** — BGP disruptions, submarine cable cuts, Cloudflare Radar data

### 🏷️ Source Credibility
- **AI Content Farm Detection** — 3,000+ flagged AI-generated content farms via Pangram Labs data
- **Reliability Scores** shown on every signal (0–1 scale, color-coded)
- **NewsGuard integration** — known disinformation domains flagged
- **Source trust tiers**: Wire Service → Official → Verified Media → Community

### 📧 Alerts & Digest
- **Real-time alerts**: Telegram, Discord, Slack, Teams, email (Resend)
- **Category + severity filters**: Get only what matters
- **Country-level targeting**: Alerts scoped to specific countries
- **Weekly email digest**: Curated top signals, delivered Sunday

### 🧩 Browser Extensions
- **Chrome** (MV3 Manifest V3, Chromium-compatible)
- **Firefox** (MV3, Android Firefox-compatible)
- Floating overlay on any news page — surface WorldPulse signals for the article you're reading

### 💳 Pro Tier
| Plan | Rate Limit | History | Price |
|------|-----------|---------|-------|
| Free | 60 req/min · 1,000/day | 7 days | Free |
| Pro  | 300 req/min · 10,000/day | 90 days | $12/mo |
| Enterprise | Unlimited | Full archive | Contact us |

---

## How WorldPulse Compares

WorldPulse is built around **verified, enriched intelligence** — not raw data dumps. Here's how it stacks up against the leading alternatives:

| Feature | WorldPulse | WorldMonitor | Ground News |
|---------|-----------|-------------|-------------|
| **Signal verification** | ✅ Multi-layer (5-step pipeline) | ❌ Raw aggregation | ⚠️ Bias labels only |
| **Per-signal enrichment** | ✅ 7 layers (TV clips, imagery, reliability, virality, semantic, media, geolocation) | ❌ None | ⚠️ Podcast clips |
| **Public REST API** | ✅ Open, rate-limited, documented | ⚠️ Proto/gRPC (complex) | ❌ None |
| **Semantic search** | ✅ Pinecone vector embeddings | ❌ No | ❌ No |
| **Real-time WebSocket feed** | ✅ Yes | ❌ No | ❌ No |
| **Pro subscription tier** | ✅ $12/mo · 300 rpm · 90-day history | ✅ Yes | ✅ ~$40/yr |
| **Browser extensions** | ✅ Chrome + Firefox (MV3) | ❌ Chrome only | ✅ Chrome only |
| **Mobile app** | ✅ React Native (iOS + Android) | ✅ iOS (Tauri) | ✅ iOS + Android |
| **Intelligence pages** | ✅ 5 unique: Cyber, Sanctions, Finance, Space Weather, Internet Outages | ❌ No dedicated pages | ❌ No |
| **Configurable alerts** | ✅ Email, Telegram, Discord, Slack, SMS | ❌ Passive only | ⚠️ Push only |
| **Weekly digest emails** | ✅ Yes | ❌ No | ✅ Daily Briefing |
| **Webhooks** | ✅ Push events to your server | ❌ No | ❌ No |
| **Self-hostable** | ✅ Docker + Kubernetes | ✅ Yes | ❌ No |
| **Open source** | ✅ MIT | ✅ AGPL-3.0 | ❌ Closed source |
| **AI content farm detection** | ✅ 3,000+ farms flagged | ❌ No | ❌ No |
| **Sanctions & watchlist data** | ✅ Yes (/sanctions) | ❌ No | ❌ No |
| **⌘K Command palette** | ✅ Yes | ✅ Yes | ❌ No |
| **Live map layers** | ✅ 4 layers: ADS-B aircraft, Maritime AIS, Natural Hazards, Naval Intel | ✅ 45 raw layers | ❌ No |
| **Data sources** | ✅ 80+ verified, enriched | ✅ 435+ raw feeds | ✅ 50,000+ (bias labels) |

### WorldPulse's philosophy: **Quality over Quantity**

- **WorldMonitor** aggregates the most raw data (45 layers, 435+ feeds). It's excellent for OSINT reconnaissance but gives you raw data with no verification, enrichment, or actionability.
- **Ground News** excels at bias comparison but provides no OSINT, no API, no intelligence synthesis, and no alerting.
- **WorldPulse** sits between wire-service quality and open-source flexibility — verified signals with a full enrichment pipeline, a developer API, configurable alerts, and no walled garden.

---

## API Reference

### REST API

Base URL: `https://api.worldpulse.io/api/v1`  
Auth: Bearer JWT token (optional for read, required for write)

#### Feed Endpoints

```
GET  /feed/global          Global public feed
GET  /feed/following       Personalized feed (auth required)
GET  /feed/signals         Breaking signals stream
GET  /feed/trending        Trending topics
```

#### Signal Endpoints

```
GET  /signals              List signals
GET  /signals/:id          Signal detail
GET  /signals/:id/posts    Posts discussing this signal
GET  /signals/map          Signals with geo data (for map)
```

#### Post Endpoints

```
GET  /posts/:id            Post detail + replies
POST /posts                Create post (auth required)
POST /posts/:id/like       Like/unlike
POST /posts/:id/boost      Boost
GET  /posts/:id/replies    Reply thread
```

#### User Endpoints

```
GET  /users/:handle        User profile
GET  /users/:handle/posts  User's posts
POST /users/:handle/follow Follow (auth)
GET  /users/me             Own profile (auth)
PUT  /users/me             Update profile (auth)
```

#### Search

```
GET /search?q=...&type=all|signals|posts|users
```

### WebSocket API

Connect: `wss://api.worldpulse.io/ws?token=<optional_jwt>`

**Send:**
```json
{ "type": "subscribe",   "payload": { "channels": ["breaking", "climate"] } }
{ "type": "unsubscribe", "payload": { "channels": ["sports"] } }
{ "type": "pong" }
```

**Receive:**
```json
{ "event": "signal.new",      "data": { "signal": Signal }  }
{ "event": "signal.updated",  "data": { "signal": Signal }  }
{ "event": "post.new",        "data": { "post": Post }      }
{ "event": "trending.update", "data": { "topics": [...] }   }
{ "event": "alert.trigger",   "data": { "alert": {...} }    }
{ "event": "ping",            "data": { "serverTime": "..." }}
```

---

## Contributing

WorldPulse is fully open-source and welcomes contributions of all kinds.

### Ways to Contribute
- 🐛 **Bug reports** — [Open an issue](https://github.com/worldpulse/worldpulse/issues)
- ✨ **Feature requests** — [Discussions tab](https://github.com/worldpulse/worldpulse/discussions)
- 🔧 **Code** — Fork, branch, PR
- 🌍 **Translations** — Help localize the UI
- 📡 **Scraper nodes** — Run a scraper instance for your region
- 🏛️  **Source curation** — Propose new verified sources
- 📖 **Documentation** — Improve docs

### Development Setup

```bash
# Fork the repo, then:
git clone https://github.com/<your-fork>/worldpulse.git
cd worldpulse
pnpm install
docker compose up -d
pnpm db:migrate && pnpm db:seed
pnpm dev
```

### Code Style
- TypeScript strict mode
- ESLint + Prettier (config in `packages/config`)
- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`)
- Tests required for new pipeline features

---

## Self-Hosting

### Single-Server (1–10K users)

```bash
# Clone
git clone https://github.com/worldpulse/worldpulse.git
cd worldpulse

# Configure
cp .env.production.example .env.production
# Edit .env.production with your values

# Launch
docker compose -f docker-compose.prod.yml up -d

# WorldPulse is now running at http://your-server:80
```

### Kubernetes (Production Scale)

```bash
# Install Helm chart
helm repo add worldpulse https://charts.worldpulse.io
helm install worldpulse worldpulse/worldpulse \
  --set domain=yourdomain.com \
  --set postgres.size=100Gi \
  --values my-values.yaml
```

Full self-hosting docs: [docs/self-hosting.md](docs/self-hosting.md)

---

## Community & Support

- **Discord**: [discord.gg/worldpulse](https://discord.gg/worldpulse)
- **GitHub Discussions**: [github.com/worldpulse/worldpulse/discussions](https://github.com/worldpulse/worldpulse/discussions)
- **Matrix**: `#worldpulse:matrix.org`
- **Status Page**: [status.worldpulse.io](https://status.worldpulse.io)

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full roadmap.

**v0.2 (Next):** Expanded sources, mobile app beta, full-text search  
**v0.3:** Communities, expert verification program  
**v1.0:** Production-ready, stable API, native iOS/Android  

---

## License

MIT License — see [LICENSE](LICENSE) for details.

**WorldPulse is free forever. The open-source version will never have paywalls or feature restrictions.**

---

*Built with ❤️ by the global open-source community.*  
*No investors. No ad revenue. No data sales. Just the world, in real time.*
