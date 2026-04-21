# @worldpulse/sdk

Official TypeScript SDK for the [WorldPulse Public API](https://world-pulse.io/developer/api-docs) — real-time global intelligence signals.

## Install

```bash
npm install @worldpulse/sdk
# or
pnpm add @worldpulse/sdk
```

## Quick Start

```ts
import { WorldPulse } from '@worldpulse/sdk'

const wp = new WorldPulse()

// List recent conflict signals
const { data: signals } = await wp.signals.list({
  category: 'conflict',
  severity: 'critical',
  limit: 10,
})

// Get a single signal with full detail
const { data: signal } = await wp.signals.get('sig_abc123')

// Browse all 16 categories with live counts
const { data: categories } = await wp.categories.list()

// Get breaking news (last 24h, critical+high only)
const { data: breaking } = await wp.breaking.list()

// Platform statistics
const { data: stats } = await wp.stats.get()
console.log(`Tracking ${stats.total_signals} signals from ${stats.active_sources} sources`)
```

## API Reference

### `new WorldPulse(config?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | `string` | `https://api.world-pulse.io/api/v1/public` | API base URL |
| `timeout` | `number` | `10000` | Request timeout (ms) |
| `maxRetries` | `number` | `2` | Max retry attempts for 429/5xx |
| `retryDelay` | `number` | `1000` | Initial retry backoff (ms) |
| `headers` | `Record<string, string>` | `{}` | Custom headers |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Custom fetch impl |

### Endpoints

| Method | Description |
|--------|-------------|
| `wp.signals.list(params?)` | List verified signals with filters |
| `wp.signals.get(id)` | Get signal detail by ID |
| `wp.categories.list()` | List 16 signal categories |
| `wp.sources.list(params?)` | Browse 500+ curated sources |
| `wp.intelligence.list()` | List 12 intelligence domains |
| `wp.countries.list(params?)` | Countries by signal activity |
| `wp.threats.list()` | Category-level threat assessments |
| `wp.stats.get()` | Platform-wide statistics |
| `wp.breaking.list(params?)` | Breaking alerts (24h, critical+high) |

### Filters

```ts
await wp.signals.list({
  category: 'climate',     // 16 categories
  severity: 'high',        // critical | high | medium | low | info
  country_code: 'US',      // ISO 3166-1 alpha-2
  q: 'earthquake',         // full-text search
  sort: 'severity',        // newest | severity | reliability
  since: '2026-04-01',     // ISO 8601 datetime
  limit: 25,               // 1–100
  offset: 0,               // pagination offset
})
```

## Error Handling

```ts
import { WorldPulse, ApiError, RateLimitError, TimeoutError } from '@worldpulse/sdk'

try {
  const { data } = await wp.signals.list()
} catch (err) {
  if (err instanceof RateLimitError) {
    console.log(`Rate limited. Retry after ${err.retryAfterMs}ms`)
  } else if (err instanceof TimeoutError) {
    console.log('Request timed out')
  } else if (err instanceof ApiError) {
    console.log(`API error ${err.status}: ${err.message}`)
  }
}
```

The SDK automatically retries on 429 (rate limit) and 5xx (server error) responses with exponential backoff.

## Self-Hosted

Point the SDK at your own WorldPulse instance:

```ts
const wp = new WorldPulse({
  baseUrl: 'http://localhost:3001/api/v1/public',
})
```

## License

CC-BY-4.0 — same as the WorldPulse Public API data.
