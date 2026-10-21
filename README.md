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
Tools: top_stories, story, search_reports, week, check_link (paste an article's address: how many outlets reported its story)
```

Claude Code: `claude mcp add --transport http worldpulse https://api.world-pulse.io/mcp`

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

Using the hosted API at api.world-pulse.io: personal, research, education and non-profit use is free, with a link back to world-pulse.io. Companies: email support@world-pulse.io first.


