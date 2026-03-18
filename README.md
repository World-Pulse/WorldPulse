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
The scraper monitors 500+ global sources across:
- **Tier 1 Wire Services**: AP, Reuters, AFP, BBC, Bloomberg
- **Official Sources**: UN, WHO, USGS, NOAA, NASA, PHIVOLCS
- **National Media**: 200+ vetted outlets in 50 languages
- **Specialized Feeds**: ACLED (conflict), ProMED (disease), OpenSky (aviation)
- **Community Reports**: Geolocated user reports, reputation-weighted

### 🔍 Verification Engine
Every signal goes through a multi-layer check:
1. **Cross-source corroboration** — confirmed by independent sources
2. **Temporal consistency** — timestamps align across sources
3. **Source diversity scoring** — wire service vs community source
4. **AI fact extraction** — claim checking, contradiction detection
5. **Community expert review** — verified experts can flag/confirm

Reliability scores are shown on every piece of content (1–5 dots).

### ⚡ Real-Time Feed
- WebSocket-powered live updates (zero-refresh)
- Server-sent events for breaking signals
- Cursor-based pagination for performance
- Redis-cached public feeds (30s TTL)

### 🗺️ Live World Map
- MapLibre GL (fully open-source, no API key required)
- Hotspots for verified critical/high severity signals
- Click-through to signal detail + discussion

### 🏷️ Trust & Reputation
```
Account Types:
  🏛️  Official Source     — Government, NGO, institution
  ✅  Verified Journalist  — Press credential verified
  🔬  Domain Expert       — Academic/professional verified  
  ⚡  Power User          — Community trust > 0.85
  👤  Community           — Standard account
  🤖  AI Digest           — Platform synthesis
```

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
