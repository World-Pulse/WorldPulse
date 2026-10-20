/* ──────────────────────────────────────────────────────────────────────── *
 *  /docs/api's content: credentials, rate limits, webhooks, the MCP       *
 *  server and the WebSocket stream as apps/api's code has them (plan      *
 *  V3i, Oct 20, 2026). Until then the page sent webhooks to POST          *
 *  /developer/webhooks (they are under /developer/keys/webhooks, with a   *
 *  sign-in token), gave keys three prefixes (wp_free_, wp_live_, wp_ent_: *
 *  every key starts with wp_live_), said limits were enforced per API key *
 *  (they are counted per client address), sent API keys to endpoints that *
 *  need nothing, and showed a signature header, filters, payload and      *
 *  WebSocket messages the API doesn't use. They live here, not in         *
 *  page.tsx (a page file may only export the page), so                   *
 *  src/__tests__/docs-api.test.tsx can check them against apps/api/src.   *
 * ──────────────────────────────────────────────────────────────────────── */

export const API_ORIGIN = 'https://api.world-pulse.io'

/** Swagger UI: every endpoint, with what it needs and its own limit (apps/api/src/lib/api-docs.ts) */
export const INTERACTIVE_DOCS_URL = `${API_ORIGIN}/api/docs`

export type Method = 'GET' | 'POST' | 'DELETE'

export interface EndpointInfo {
  method: Method
  path: string
  description: string
}

/* ── credentials ─────────────────────────────────────────────────────── */

/** Every API key is wp_live_ and 32 hex characters, whatever its tier (apps/api/src/lib/api-keys.ts) */
export const KEY_PREFIX = 'wp_live_'
export const API_KEY_HEADER = 'X-Api-Key'

/** What apps/api/src/middleware/auth.ts answers (401) without a sign-in token, and with a bad one */
export const SIGN_IN_REQUIRED = 'Sign-in required: send your sign-in token as "Authorization: Bearer <token>"'
export const BAD_TOKEN = 'Invalid or expired token'

/** The endpoints that take an API key (apiKeyAuth, and routes/slop.ts's own check): all of them */
export const API_KEY_ENDPOINTS: EndpointInfo[] = [
  { method: 'GET',  path: '/api/v1/stix/signals',     description: 'Signals as one STIX 2.1 bundle, newest first: category, severity, since, and limit (1 to 500, default 100)' },
  { method: 'GET',  path: '/api/v1/stix/signals/:id', description: 'One signal as a STIX 2.1 bundle' },
  { method: 'GET',  path: '/api/v1/stix/feed',        description: 'The newest 100 signals as a STIX 2.1 bundle' },
  { method: 'POST', path: '/api/v1/slop/check',       description: 'Check one URL or article for signs of an AI content farm' },
  { method: 'POST', path: '/api/v1/slop/batch',       description: 'Check up to 20 at once: a Pro or Enterprise key, from an account still on a paid plan' },
]

/** Some of the endpoints that take a sign-in token (authenticate); the interactive docs mark them all */
export const SIGN_IN_ENDPOINTS: EndpointInfo[] = [
  { method: 'GET',  path: '/api/v1/feed/following',          description: 'Posts from the accounts you follow' },
  { method: 'GET',  path: '/api/v1/threats/missiles',        description: 'Missile and drone threat reports' },
  { method: 'GET',  path: '/api/v1/jamming/zones',           description: 'GPS/GNSS jamming reports' },
  { method: 'GET',  path: '/api/v1/bundles/current',         description: 'The newest verified signals as a signed bundle' },
  { method: 'GET',  path: '/api/v1/developer/keys',          description: 'Your API keys' },
  { method: 'POST', path: '/api/v1/developer/keys/webhooks', description: 'Register a webhook' },
]

/** API key tiers (apps/api/src/lib/key-tier.ts decides which an account may make) */
export const KEY_TIERS = [
  { tier: 'Free',       who: 'Any account',                        opens: 'Every API-key endpoint but /slop/batch' },
  { tier: 'Pro',        who: 'Accounts on the Pro plan',           opens: 'Also /slop/batch' },
  { tier: 'Enterprise', who: 'Issued by the WorldPulse team',      opens: 'Also /slop/batch' },
] as const

/* ── rate limits ─────────────────────────────────────────────────────── */

/** The budget the endpoints without their own limit share, per client address (apps/api/src/lib/rate-limit-options.ts) */
export const DEFAULT_PER_MINUTE = 200

/** Some endpoints' own limits (their config.rateLimit): requests a minute per client address, counted for that endpoint alone */
export const ROUTE_LIMITS: Array<{ method: Method; path: string; perMinute: number }> = [
  { method: 'POST', path: '/api/v1/auth/login',               perMinute: 5 },
  { method: 'POST', path: '/api/v1/auth/register',            perMinute: 5 },
  { method: 'POST', path: '/api/v1/auth/refresh',             perMinute: 10 },
  { method: 'GET',  path: '/api/v1/stix/signals',             perMinute: 10 },
  { method: 'GET',  path: '/api/v1/stix/feed',                perMinute: 10 },
  { method: 'GET',  path: '/api/v1/search/semantic',          perMinute: 20 },
  { method: 'POST', path: '/api/v1/slop/batch',               perMinute: 20 },
  { method: 'GET',  path: '/api/v1/stix/signals/:id',         perMinute: 30 },
  { method: 'GET',  path: '/api/v1/search',                   perMinute: 30 },
  { method: 'GET',  path: '/api/v1/search/autocomplete',      perMinute: 30 },
  { method: 'GET',  path: '/api/v1/signals/:id/connections',  perMinute: 30 },
  { method: 'GET',  path: '/api/v1/public/signals',           perMinute: 60 },
  { method: 'GET',  path: '/api/v1/public/categories',        perMinute: 60 },
  { method: 'GET',  path: '/api/v1/feed/signals',             perMinute: 60 },
  { method: 'GET',  path: '/api/v1/signals/:id',              perMinute: 60 },
  { method: 'GET',  path: '/api/v1/stories',                  perMinute: 60 },
  { method: 'POST', path: '/mcp',                             perMinute: 60 },
  { method: 'POST', path: '/api/v1/slop/check',               perMinute: 100 },
]

/** The tier limits a key records (apps/api/src/lib/api-keys.ts TIER_LIMITS); requests aren't counted against them yet */
export const KEY_RECORDED_LIMITS = [
  { tier: 'free', perMinute: 60, perDay: 1_000 },
  { tier: 'pro',  perMinute: 300, perDay: 10_000 },
] as const

export const RATE_LIMIT_HEADERS = [
  { header: 'X-RateLimit-Limit',     description: 'The endpoint\'s limit, in requests a minute' },
  { header: 'X-RateLimit-Remaining', description: 'Requests left in this minute' },
  { header: 'X-RateLimit-Reset',     description: 'Seconds until the count starts again' },
  { header: 'Retry-After',           description: 'Seconds to wait (on a 429 answer only)' },
]

/* ── open endpoints ──────────────────────────────────────────────────── */

/**
 * What a web page on another site may read from a visitor's browser (CORS):
 * GET and HEAD on these paths (apps/api/src/lib/cors-policy.ts
 * PUBLIC_READ_PREFIXES), and POST /mcp. A prefix without a trailing slash
 * covers the path itself and what's below it.
 */
export const CORS_OPEN_PREFIXES = [
  '/api/v1/public/', '/api/v1/rss/', '/api/v1/signals', '/api/v1/stories', '/api/v1/countries',
  '/api/v1/search', '/api/v1/feed/global', '/api/v1/feed/trending', '/ws',
] as const

export const PUBLIC_SIGNALS_PARAMS = [
  { name: 'category', type: 'string',  description: 'One of the categories GET /api/v1/public/categories lists (conflict, climate, economy, …), or all' },
  { name: 'severity', type: 'string',  description: 'critical, high, medium, low or info' },
  { name: 'limit',    type: 'integer', description: 'Number of results (1-100, default 50)' },
  { name: 'offset',   type: 'integer', description: 'Pagination offset (0-10,000, default 0)' },
]

/** Open like /public/signals (the page listed them as needing an API key) */
export const OTHER_OPEN_ENDPOINTS: EndpointInfo[] = [
  { method: 'GET', path: '/api/v1/feed/signals', description: 'The newest signals, verified or not yet (status says which), a page at a time: { items, total, cursor, hasMore }, where total counts this page. Call it from a server or an app: pages on other websites can\'t read it (no CORS).' },
  { method: 'GET', path: '/api/v1/signals/:id',  description: 'One signal in full: its sources, verification checks, summary and location' },
  { method: 'GET', path: '/api/v1/signals/:id/connections', description: 'Signals from the last 14 days that name the same people, places or organisations. With ?only=entities, just the people, places and organisations it names.' },
  { method: 'GET', path: '/api/v1/search',       description: 'Search signals, posts and users: ?q= (at least 2 characters)' },
]

export const PUBLIC_SIGNALS_RESPONSE = `{
  "success": true,
  "data": [
    {
      "id": "6f1c2a9e-3b7d-4c55-9a0e-8d2f4b1e7c30",
      "title": "Flooding reported across southern regions",
      "category": "climate",
      "severity": "high",
      "reliability_score": 0.87,
      "location_name": "Bangladesh",
      "published_at": "2026-10-20T14:22:00.000Z",
      "source_url": "https://example.com/flooding"
    }
  ],
  "total": 284,
  "total_exact": true,
  "limit": 50,
  "offset": 0
}`

/* ── MCP server ──────────────────────────────────────────────────────── */

/** apps/api/src/routes/mcp.ts, registered at /mcp (not under /api/v1) */
export const MCP_URL = `${API_ORIGIN}/mcp`

/** Its tools (routes/mcp.ts TOOLS) */
export const MCP_TOOLS = ['top_stories', 'story', 'search_reports', 'week', 'check_link'] as const

/** How to connect an assistant (the developer page's MCP section) */
export const MCP_GUIDE = '/developers#mcp'

export const MCP_EXAMPLE = `curl -X POST "${MCP_URL}" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`

/* ── webhooks ────────────────────────────────────────────────────────── */

/** registerDeveloperRoutes is mounted at /api/v1/developer/keys (apps/api/src/index.ts) */
export const WEBHOOKS_PATH = '/api/v1/developer/keys/webhooks'

export const WEBHOOK_ENDPOINTS: EndpointInfo[] = [
  { method: 'POST',   path: WEBHOOKS_PATH,                          description: 'Register a webhook. The answer holds its signing secret, shown this once.' },
  { method: 'GET',    path: WEBHOOKS_PATH,                          description: 'List your webhooks (without their secrets).' },
  { method: 'DELETE', path: `${WEBHOOKS_PATH}/:webhookId`,           description: 'Stop a webhook.' },
  { method: 'GET',    path: `${WEBHOOKS_PATH}/:webhookId/deliveries`, description: 'Its last 50 deliveries: event, status code, whether it worked, error and time taken.' },
]

/** Active webhooks an account may have (apps/api/src/routes/developer.ts MAX_WEBHOOKS_PER_USER) */
export const MAX_WEBHOOKS = 10

/** The events deliveries are sent for (apps/api/src/ws/handler.ts calls fireWebhooks for these two) */
export const WEBHOOK_EVENTS = [
  { event: 'signal.new',     description: 'A new signal was saved (it may not be verified yet)' },
  { event: 'alert.breaking', description: 'A breaking alert fired' },
] as const

export const WEBHOOK_BODY_FIELDS = [
  { name: 'url',     type: 'string',   required: true,  description: 'Where each delivery is POSTed (a full URL, up to 2,048 characters)' },
  { name: 'events',  type: 'string[]', required: false, description: 'signal.new and/or alert.breaking (default ["signal.new"])' },
  { name: 'filters', type: 'object',   required: false, description: 'category, severity and country_code, one value each (below)' },
]

export const WEBHOOK_FILTERS = [
  { name: 'category',     type: 'string', description: 'One category, e.g. conflict' },
  { name: 'severity',     type: 'string', description: 'Exactly this severity, one of critical, high, medium, low, info (high does not include critical)' },
  // lib/webhooks.ts compares it with the data's country_code, which an alert doesn't have
  { name: 'country_code', type: 'string', description: 'A two-letter ISO 3166-1 code, e.g. UA. Only signal.new data has country_code (an alert names its country as countryCode), so with this filter set no alert.breaking delivery is sent' },
]

/** What lib/webhooks.ts sends with each delivery */
export const WEBHOOK_HEADERS = [
  { header: 'X-WorldPulse-Event',     description: 'signal.new or alert.breaking' },
  { header: 'X-WorldPulse-Timestamp', description: 'When it was sent, in Unix seconds' },
  { header: 'X-WorldPulse-Signature', description: 't=<timestamp>,v1=<hex HMAC-SHA256 of "<timestamp>.<raw body>", keyed with your secret>' },
  { header: 'User-Agent',             description: 'WorldPulse-Webhooks/1.0' },
]

export const WEBHOOK_DELIVERY = `{
  "event": "signal.new",
  "payload": {
    "id": "6f1c2a9e-3b7d-4c55-9a0e-8d2f4b1e7c30",
    "title": "Flooding reported across southern regions",
    "category": "climate",
    "severity": "high",
    "alert_tier": "PRIORITY",
    "reliability_score": 0.87,
    "location_name": "Bangladesh",
    "country_code": "BD",
    "source_url": "https://example.com/flooding",
    "created_at": "2026-10-20T14:22:00.000Z",
    "lat": 23.7,
    "lng": 90.4
  }
}`

/* ── WebSocket ───────────────────────────────────────────────────────── */

export const WS_URL = 'wss://api.world-pulse.io/ws'

/** What apps/api/src/ws/handler.ts sends, and to whom */
export const WS_EVENTS = [
  { event: 'signal.new',      reaches: 'Every connection', description: 'A new signal was saved (it may not be verified yet)' },
  { event: 'alert.breaking',  reaches: 'Every connection', description: 'A breaking alert fired' },
  { event: 'trending.update', reaches: 'Every connection', description: 'The trending topics were updated' },
  { event: 'post.new',        reaches: 'Connections subscribed to "all", or to the post\'s channel: signal, social or pulse (PULSE\'s fact-check posts reach every connection)', description: 'A new feed post (signal: about a signal, social: other people\'s posts, pulse: PULSE\'s own)' },
  { event: 'ping',            reaches: 'Every connection', description: 'The heartbeat, every 30 seconds; also sent when you connect (with your clientId) and after a subscribe (with your channels). Answer each with a pong' },
] as const

/** What the server reads from a client */
export const WS_CLIENT_MESSAGES = [
  { message: '{"type":"subscribe","payload":{"channels":["all"]}}',   description: 'Add channels' },
  { message: '{"type":"unsubscribe","payload":{"channels":["all"]}}', description: 'Remove channels' },
  { message: '{"type":"pong"}',                                       description: 'Answer a ping: the server checks every 30 seconds and closes a connection that sent no pong for over 60 seconds' },
] as const

/* ── code examples ───────────────────────────────────────────────────── */

export type Tab = 'curl' | 'typescript' | 'python'

export type CodeExample = Partial<Record<Tab, string>>

export const PUBLIC_SIGNALS_EXAMPLES: CodeExample = {
  curl: `curl "${API_ORIGIN}/api/v1/public/signals?category=conflict&severity=critical&limit=10" \\
  -H "Accept: application/json"`,

  typescript: `interface Signal {
  id: string
  title: string
  category: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  reliability_score: number // 0 to 1
  location_name: string | null
  published_at: string
  source_url: string | null
}

const res = await fetch(
  '${API_ORIGIN}/api/v1/public/signals?category=conflict&limit=10'
)
// total counts every match; while total_exact is false it is an estimate
const { data, total, total_exact } = (await res.json()) as {
  data: Signal[]; total: number; total_exact: boolean
}`,

  python: `import httpx

resp = httpx.get(
    "${API_ORIGIN}/api/v1/public/signals",
    params={"category": "conflict", "severity": "critical", "limit": 10},
)
resp.raise_for_status()
data = resp.json()  # {"success": True, "data": [...], "total": 42, "total_exact": True, ...}`,
}

export const WEBHOOK_EXAMPLES: CodeExample = {
  curl: `# With your sign-in token (data.accessToken from POST /api/v1/auth/login), not an API key
curl -X POST "${API_ORIGIN}${WEBHOOKS_PATH}" \\
  -H "Authorization: Bearer $ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://your-server.example/webhook",
    "events": ["signal.new", "alert.breaking"],
    "filters": { "severity": "critical", "category": "conflict" }
  }'
# The answer's data.secret is shown this once: keep it to check signatures`,

  typescript: `const res = await fetch('${API_ORIGIN}${WEBHOOKS_PATH}', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${accessToken}\`, // your sign-in token
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://your-server.example/webhook',
    events: ['signal.new', 'alert.breaking'],
    filters: { severity: 'critical' },
  }),
})
// data.secret is shown this once: keep it to check signatures
const { data } = await res.json()
console.log(data.id, data.secret)`,

  python: `import httpx

resp = httpx.post(
    "${API_ORIGIN}${WEBHOOKS_PATH}",
    headers={"Authorization": f"Bearer {access_token}"},  # your sign-in token
    json={
        "url": "https://your-server.example/webhook",
        "events": ["signal.new", "alert.breaking"],
        "filters": {"severity": "critical"},
    },
)
webhook = resp.json()["data"]
print(webhook["id"], webhook["secret"])  # the secret is shown this once`,
}

export const WEBHOOK_VERIFY_EXAMPLES: CodeExample = {
  typescript: `import crypto from 'node:crypto'

// rawBody: the request body exactly as it arrived, before parsing it
function isFromWorldPulse(rawBody: string, signature: string, secret: string): boolean {
  const parts = Object.fromEntries(signature.split(',').map(p => p.split('=')))
  const expected = crypto.createHmac('sha256', secret)
    .update(\`\${parts.t}.\${rawBody}\`)
    .digest('hex')
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300 // refuse old deliveries
  return fresh && typeof parts.v1 === 'string' && parts.v1.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected))
}

// isFromWorldPulse(rawBody, req.headers['x-worldpulse-signature'], process.env.WORLDPULSE_WEBHOOK_SECRET)`,

  python: `import hashlib, hmac, time

# raw_body: the request body exactly as it arrived (bytes), before parsing it
def is_from_worldpulse(raw_body: bytes, signature: str, secret: str) -> bool:
    parts = dict(p.split("=", 1) for p in signature.split(","))
    expected = hmac.new(
        secret.encode(), parts["t"].encode() + b"." + raw_body, hashlib.sha256
    ).hexdigest()
    fresh = abs(time.time() - int(parts["t"])) < 300  # refuse old deliveries
    return fresh and hmac.compare_digest(parts.get("v1", ""), expected)`,
}

export const WEBSOCKET_EXAMPLES: CodeExample = {
  curl: `# A WebSocket needs a WebSocket client, e.g. wscat (no sign-in needed)
npx wscat -c "${WS_URL}"
# then send:  {"type":"subscribe","payload":{"channels":["all"]}}
# and answer each ping with:  {"type":"pong"}`,

  typescript: `const ws = new WebSocket('${WS_URL}')

ws.onopen = () => {
  // signal.new, alert.breaking and trending.update reach every connection;
  // subscribe to "all" for every post.new too
  ws.send(JSON.stringify({ type: 'subscribe', payload: { channels: ['all'] } }))
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data) // { event, data, timestamp, id }; a ping has only event and data
  if (msg.event === 'ping') {
    // answer every ping, or the server closes the connection after about a minute
    ws.send(JSON.stringify({ type: 'pong' }))
  } else if (msg.event === 'signal.new') {
    console.log('New signal:', msg.data.title)
  }
}

// The server doesn't reconnect for you: when the connection closes,
// open a new one after a short wait`,

  python: `import asyncio, json, websockets

async def stream():
    async with websockets.connect("${WS_URL}") as ws:
        await ws.send(json.dumps({"type": "subscribe", "payload": {"channels": ["all"]}}))
        async for message in ws:
            msg = json.loads(message)  # {"event", "data", "timestamp", "id"}; a ping has only event and data
            if msg["event"] == "ping":
                # answer every ping, or the server closes the connection after about a minute
                await ws.send(json.dumps({"type": "pong"}))
            elif msg["event"] == "signal.new":
                print("New signal:", msg["data"]["title"])

asyncio.run(stream())`,
}
