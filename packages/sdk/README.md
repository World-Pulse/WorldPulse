# @worldpulse/sdk

A small TypeScript client for WorldPulse's open read routes: verified signals, the categories they have, the stories most outlets are reporting, a week's top stories, search by meaning, and countries by risk. It runs in Node.js 18 and later and in browsers (it uses `fetch`), and has no dependencies.

None of these routes needs an account or an API key, and a page on any website may call them.

## Install

The SDK isn't on npm. Build it from this repository (you need Node.js 20 or later and pnpm 9; `corepack enable` gives you pnpm):

```bash
git clone https://github.com/World-Pulse/WorldPulse.git
cd WorldPulse
pnpm install --filter @worldpulse/sdk   # only what the SDK needs; a plain `pnpm install` works too
pnpm --filter @worldpulse/sdk build
```

That writes `packages/sdk/dist`: an ES module (`index.js`), a CommonJS build (`index.cjs`) and the type declarations. Then add that folder to your project:

```bash
npm install /path/to/WorldPulse/packages/sdk
```

npm links the folder, so rebuilding it updates your project. In a package inside this repository, add `"@worldpulse/sdk": "workspace:*"` to its dependencies instead.

## Quick start

```ts
import { WorldPulse } from '@worldpulse/sdk'

const wp = new WorldPulse()

const { data, total, total_exact } = await wp.signals.list({ category: 'conflict', limit: 10 })
for (const signal of data) {
  console.log(signal.severity, signal.title, signal.location_name ?? '')
}
console.log(total_exact ? `${total} in all` : `about ${total} in all`)
```

Each method returns the API's answer as it comes, typed: most are wrapped in `{ success, data }`; search by meaning and the countries list aren't.

## Methods

| Method | Route | Per minute |
|---|---|---|
| `wp.signals.list(params?)` | `GET /api/v1/public/signals` | 60 |
| `wp.signals.get(id)` | `GET /api/v1/signals/:id` | 60 |
| `wp.categories.list()` | `GET /api/v1/public/categories` | 60 |
| `wp.stories.top(params?)` | `GET /api/v1/stories` | 60 |
| `wp.stories.get(id)` | `GET /api/v1/stories/:id` | 60 |
| `wp.stories.week(week?)` | `GET /api/v1/stories/week` | 30 |
| `wp.search.semantic(q, params?)` | `GET /api/v1/search/semantic` | 20 |
| `wp.countries.list(params?)` | `GET /api/v1/countries` | 60 |

The last column is how many requests a minute each route answers from one address.

### The latest verified signals

```ts
const page = await wp.signals.list({
  category: 'climate', // one of wp.categories.list(), or 'all' (the default)
  severity: 'high',    // critical, high, medium, low or info
  limit: 25,           // 1 to 100, default 50
  offset: 25,          // 0 to 10,000, default 0
})
// page.data: [{ id, title, category, severity, reliability_score, location_name, published_at, source_url }]
// page.total, page.total_exact, page.limit, page.offset
```

Newest first. `reliability_score` runs from 0 to 1, and `published_at` is when WorldPulse saved the report. `total` counts every match; while `total_exact` is false it is the database's estimate (the exact count is made in the background). A category that isn't on the list answers 400 with the list.

### One signal in full

```ts
const { data: signal } = await wp.signals.get(page.data[0].id)
console.log(signal.status, signal.summary, signal.location) // location: { lng, lat } or null
console.log(signal.sources.map(source => source.name), signal.riskScore.label)
```

Any signal, verified or not: check `status`. Its `reliabilityScore` comes as the database keeps it, usually a decimal in a string such as `"0.850"`, so use `Number(signal.reliabilityScore)`.

### The categories

```ts
const { data: categories } = await wp.categories.list()
// the names signals.list() takes, such as 'conflict', 'climate' and 'economy'
```

### The stories most outlets are reporting

```ts
const { data } = await wp.stories.top({ hours: 24, limit: 10, country: 'NG' })
for (const story of data.stories) {
  console.log(`${story.title}: ${story.outletCount} outlets (${story.outlets.join(', ')})`)
}
```

`hours` is 1 to 72 (default 12), `limit` 1 to 20 (default 6), and `country` a two-letter code (leave it out for the whole world). Each story was reported by at least two outlets; they are ranked by how many and how serious, fading as they age, with each event once.

### One story

```ts
const { data: story } = await wp.stories.get(data.stories[0].id) // or the id of any of its reports
console.log(`${story.size} reports from ${story.outlets} outlets: ${story.outletNames.join(', ')}`)
for (const report of story.signals) console.log(report.createdAt, report.outlet, report.title)
```

`signals` holds the story's first 10 reports and its latest 40, oldest first. Signal and story ids are UUIDs: `signals.get` and `stories.get` refuse anything else with a `TypeError` before asking.

### A week

```ts
const { data: week } = await wp.stories.week('2026-W42') // leave it out for the week under way
console.log(week.week, week.start, week.end, week.underWay)
week.stories.forEach((story, i) => console.log(i + 1, story.title, story.outletCount))
week.countries.forEach(country => console.log(country.name, country.stories))
```

Weeks run Monday to Monday, UTC, and only the week's own reports count. For the week under way, `people` names the people in the most reports of the last 7 days; for a finished week it is null. A week that hasn't started answers 404.

### Search by meaning

```ts
const found = await wp.search.semantic('drought and crop failure in East Africa', { limit: 5, category: 'climate' })
if (!found.semantic) console.log(found.message) // the search model is still starting up
for (const match of found.results) console.log(match.score.toFixed(2), match.title, match.countryCode)
```

`q` is 2 to 500 characters and `limit` 1 to 50 (default 10). Results come closest first, with a `score` from 0 to 1 (1 is the same meaning), and can have any status. Their `reliabilityScore` is a decimal in a string too.

### Countries by risk

```ts
const { countries } = await wp.countries.list({ window: '7d', limit: 20 })
for (const country of countries) {
  console.log(country.name, country.risk_score, country.risk_label, country.trend, country.signal_count)
}
```

`window` is `24h` (the default), `48h`, `7d` or `30d`; `limit` 1 to 200 (default 50); `category` (one of `categories.list()`) counts one category only. `risk_score` (10 to 95) is relative to the other countries in the answer.

## Options

```ts
const wp = new WorldPulse({
  baseUrl: 'http://localhost:3001',  // your own WorldPulse API; default https://api.world-pulse.io
  apiKey: 'wp_live_…',               // sent as X-API-Key
  token: '…',                        // a sign-in token, sent as Authorization: Bearer …
  headers: { 'X-Request-Id': '42' }, // added to every request
  fetch: myFetch,                    // default: the global fetch
  timeout: 60_000,                   // ms before giving up (the default); 0 waits as long as it takes
})
```

None of the routes above needs a key or a token; if you pass them, they are sent the way the API reads them. The default timeout is a minute because the slowest answer (a story list nobody has asked for lately) can take that long to make.

## Errors

- Any answer other than 2xx throws an `ApiError` with the HTTP `status`, the API's error `code` when it sends one (`VALIDATION_ERROR`, `NOT_FOUND`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`, …; otherwise null), its whole error answer as `body`, and the `url` asked. Its `message` reads like `WorldPulse API 400 VALIDATION_ERROR: category must be one of: …`.
- A 429 throws a `RateLimitError`, which is an `ApiError` too, whose `retryAfter` is the number of seconds the answer's Retry-After header asks you to wait (null when there is none).
- `NetworkError` means fetch failed (its `cause` says why); `TimeoutError` means no answer came within `timeout`.

All of them are `WorldPulseError`s. Nothing is retried for you.

```ts
import { WorldPulse, ApiError, RateLimitError } from '@worldpulse/sdk'

const wp = new WorldPulse()
try {
  const { data } = await wp.stories.top({ hours: 24 })
  console.log(data.stories.length)
} catch (err) {
  if (err instanceof RateLimitError) {
    console.log(`Too many requests: try again in ${err.retryAfter ?? 60} s`)
  } else if (err instanceof ApiError) {
    console.error(err.status, err.code, err.body)
  } else {
    throw err // NetworkError or TimeoutError
  }
}
```

## Live updates

The SDK doesn't cover the WebSocket. Connect to `wss://api.world-pulse.io/ws` and answer each `ping` message with `{"type":"pong"}` (the server closes a connection that sends no pong for 60 seconds); new signals arrive as `signal.new` messages. [world-pulse.io/developers](https://world-pulse.io/developers) describes the rest.

## Tests

```bash
pnpm --filter @worldpulse/sdk test   # fetch is stubbed: no network
pnpm --filter @worldpulse/sdk lint   # tsc --noEmit
```

The tests read the API's route files (`apps/api/src`) and check that every request the SDK makes reaches a route the API serves without a sign-in or key.

## License

MIT, like the rest of the repository: see [LICENSE](../../LICENSE).
