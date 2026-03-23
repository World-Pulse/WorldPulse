# WorldPulse Public API

The WorldPulse Public API provides read-only access to verified global intelligence signals. No authentication is required. All endpoints are available under the `/api/v1/public` prefix.

**Base URL (production):** `https://api.worldpulse.io`
**Base URL (local dev):** `http://localhost:3001`

---

## Rate Limits

| Tier   | Limit              | Key       |
|--------|--------------------|-----------|
| Public | 60 requests/minute | Per IP    |

Rate-limit headers are included in every response:

| Header                  | Description                              |
|-------------------------|------------------------------------------|
| `X-RateLimit-Limit`     | Maximum requests allowed in the window   |
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-Reset`     | Unix timestamp when the window resets    |

When the rate limit is exceeded the API returns `429 Too Many Requests`:

```json
{
  "success": false,
  "error": "Too many requests. Slow down.",
  "code": "RATE_LIMITED"
}
```

---

## CORS

All public endpoints include the header:

```
Access-Control-Allow-Origin: *
```

You can call these endpoints directly from any browser origin without a proxy.

---

## Endpoints

### `GET /api/v1/public/signals`

Returns the most recent **verified** signals. No authentication required.

#### Query Parameters

| Parameter  | Type    | Default | Maximum | Description                                    |
|------------|---------|---------|---------|------------------------------------------------|
| `category` | string  | —       | —       | Filter by category (see [Categories](#categories)) |
| `severity` | string  | —       | —       | Filter by severity: `critical`, `high`, `medium`, `low`, `info` |
| `limit`    | integer | `50`    | `100`   | Number of signals to return                    |
| `offset`   | integer | `0`     | —       | Number of signals to skip (for pagination)     |

#### Response Shape

```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Magnitude 6.4 earthquake strikes coastal region",
      "category": "disaster",
      "severity": "high",
      "reliability_score": 0.91,
      "location_name": "Sumatra, Indonesia",
      "published_at": "2024-06-01T14:32:00.000Z",
      "source_url": "https://reuters.com/article/earthquake-sumatra"
    }
  ],
  "total": 1284,
  "limit": 50,
  "offset": 0
}
```

#### Response Fields

| Field               | Type            | Description                                         |
|---------------------|-----------------|-----------------------------------------------------|
| `id`                | string (UUID)   | Unique signal identifier                            |
| `title`             | string          | Short headline for the signal                       |
| `category`          | string          | Signal category (see [Categories](#categories))     |
| `severity`          | string          | Severity level: `critical`, `high`, `medium`, `low`, `info` |
| `reliability_score` | number (0–1)    | Automated reliability score; 1.0 = most reliable    |
| `location_name`     | string \| null  | Human-readable location name                        |
| `published_at`      | ISO 8601 string | When the signal was first published                 |
| `source_url`        | string \| null  | URL of the primary source article                   |
| `total`             | integer         | Total matching signals (ignores pagination)         |
| `limit`             | integer         | The `limit` value used for this request             |
| `offset`            | integer         | The `offset` value used for this request            |

#### Categories

`conflict` · `security` · `breaking` · `politics` · `markets` · `economics` · `climate` · `science` · `technology` · `health` · `culture` · `sports` · `disaster`

---

## Examples

### curl

```bash
# Latest 50 verified signals
curl "https://api.worldpulse.io/api/v1/public/signals"

# High-severity climate signals (first 10)
curl "https://api.worldpulse.io/api/v1/public/signals?category=climate&severity=high&limit=10"

# Paginate — page 3 of 20
curl "https://api.worldpulse.io/api/v1/public/signals?limit=20&offset=40"
```

### JavaScript (fetch)

```js
// Fetch the latest 10 conflict signals
const res = await fetch(
  'https://api.worldpulse.io/api/v1/public/signals?category=conflict&limit=10'
)
const { data, total, limit, offset } = await res.json()

console.log(`Showing ${data.length} of ${total} signals`)
data.forEach(signal => {
  console.log(`[${signal.severity.toUpperCase()}] ${signal.title}`)
})
```

### JavaScript (pagination helper)

```js
async function* fetchAllSignals(params = {}) {
  const base = 'https://api.worldpulse.io/api/v1/public/signals'
  let offset = 0
  const limit = 100

  while (true) {
    const url = new URL(base)
    url.searchParams.set('limit',  String(limit))
    url.searchParams.set('offset', String(offset))
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

    const { data, total } = await fetch(url).then(r => r.json())
    yield* data

    offset += limit
    if (offset >= total) break
  }
}

for await (const signal of fetchAllSignals({ category: 'security' })) {
  console.log(signal.title)
}
```

---

## Interactive Docs

A full OpenAPI 3.1 specification with try-it-out UI is available at:

```
https://api.worldpulse.io/api/docs
```

---

## Self-Hosting

See [docs/self-hosting.md](./self-hosting.md) for instructions on running your own WorldPulse instance.
