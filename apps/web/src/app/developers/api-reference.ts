import {
  Radio, Newspaper, Search, Zap, Shield, KeyRound, Key, Layers, type LucideIcon,
} from 'lucide-react'

/* ──────────────────────────────────────────────────────────────────────── *
 *  The /developers page's endpoint list and code examples (plan V3c,      *
 *  Oct 20, 2026). They had drifted from the API: the Python example       *
 *  crashed three times, the WebSocket example never fired, two listed     *
 *  paths answered 404 and six listings said "Pro plan", which no code     *
 *  checks. They live here, not in page.tsx (a page file may only export   *
 *  the page), so src/__tests__/developers-examples.test.ts can check      *
 *  every path and access label against apps/api/src/routes.               *
 * ──────────────────────────────────────────────────────────────────────── */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.world-pulse.io'

/* ── language tabs for code examples ─────────────────────────────────── */
export type Lang = 'curl' | 'python' | 'javascript' | 'typescript'

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'curl',       label: 'cURL' },
  { id: 'python',     label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
]

/* ── what a caller must send ─────────────────────────────────────────── */
/**
 * As the API's code checks it today: routes with `authenticate` take only a
 * sign-in token, routes with `apiKeyAuth` only an API key (any tier), and the
 * other routes need neither
 */
export type Access = 'none' | 'signin' | 'apikey'

export const ACCESS_LABEL: Record<Access, string> = {
  none:   'Open: no sign-in or key needed',
  signin: 'Sign-in token from any free account (Authorization: Bearer <accessToken>, from POST /api/v1/auth/login). API keys aren\'t accepted here.',
  apikey: 'API key of any tier (X-Api-Key: <key>; make one on the API keys page, /developer). Sign-in tokens aren\'t accepted here.',
}

/* ── endpoint categories ─────────────────────────────────────────────── */
export interface Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  path: string
  description: string
  access: Access
  rateLimit?: string
  params?: { name: string; type: string; description: string; required?: boolean }[]
  response?: string
}

export interface EndpointGroup {
  name: string
  icon: LucideIcon
  description: string
  endpoints: Endpoint[]
}

export const ENDPOINT_GROUPS: EndpointGroup[] = [
  {
    name: 'Public Signals',
    icon: Radio,
    description: 'Access verified world events — no authentication required.',
    endpoints: [
      {
        method: 'GET', path: '/api/v1/public/signals',
        description: 'List the latest verified signals from the 1,000+ outlets WorldPulse reads each day, newest first. Each is verified: two or more independent outlets reported it. outlets is how many (an outlet\'s sister sites and word-for-word wire copies count once), sites the websites of the reports it links to, and url its page on WorldPulse. reliability_score runs from 0 to 1, and published_at is when WorldPulse saved the report. total counts every match; while total_exact is false it is an estimate.',
        access: 'none', rateLimit: '60 req/min per IP',
        params: [
          { name: 'category', type: 'string', description: 'One of the categories GET /api/v1/public/categories lists (conflict, climate, economy, …), or all', required: false },
          { name: 'severity', type: 'string', description: 'Filter by severity: critical, high, medium, low, info', required: false },
          { name: 'limit', type: 'number', description: 'Number of results (1-100, default 50)', required: false },
          { name: 'offset', type: 'number', description: 'Pagination offset (0-10,000, default 0)', required: false },
        ],
        response: `{
  "success": true,
  "data": [
    {
      "id": "6f1c2a9e-3b7d-4c55-9a0e-8d2f4b1e7c30",
      "title": "Magnitude 6.2 earthquake detected near Tonga",
      "category": "disaster",
      "severity": "high",
      "reliability_score": 0.87,
      "location_name": "Tonga, South Pacific",
      "published_at": "2026-10-20T14:32:00.000Z",
      "source_url": "https://example.com/tonga-earthquake",
      "outlets": 4,
      "sites": ["rnz.co.nz", "abc.net.au", "matangitonga.to", "example.com"],
      "url": "https://world-pulse.io/signals/6f1c2a9e-3b7d-4c55-9a0e-8d2f4b1e7c30"
    }
  ],
  "total": 2847,
  "total_exact": true,
  "limit": 50,
  "offset": 0
}`,
      },
      {
        method: 'GET', path: '/api/v1/public/categories',
        description: 'The full list of categories a signal can have: the values the category parameter takes.',
        access: 'none', rateLimit: '60 req/min per IP',
        response: `{
  "success": true,
  "data": ["breaking", "conflict", "climate", "economy", "health"]
}`,
      },
    ],
  },
  {
    name: 'Feed',
    icon: Newspaper,
    description: 'Real-time global feed with trending topics and AI-curated content.',
    endpoints: [
      {
        method: 'GET', path: '/api/v1/feed/global',
        description: 'Global feed of posts (many of them about a signal), newest first. Answers { items, total, cursor, hasMore }; total counts this page only.',
        access: 'none', rateLimit: '60 req/min',
        params: [
          { name: 'category', type: 'string', description: 'Filter by category slug', required: false },
          { name: 'cursor', type: 'string', description: 'The cursor the previous page answered', required: false },
          { name: 'limit', type: 'number', description: 'Results per page (1-50, default 20)', required: false },
        ],
      },
      {
        method: 'GET', path: '/api/v1/feed/trending',
        description: 'The top 10 trending topics of the last hour.',
        access: 'none',
        params: [
          { name: 'window', type: 'string', description: '1h (default), 6h or 24h', required: false },
        ],
      },
      {
        method: 'GET', path: '/api/v1/feed/following',
        description: 'Feed from the accounts you follow.',
        access: 'signin',
      },
    ],
  },
  {
    name: 'Search',
    icon: Search,
    description: 'Full-text search with Meilisearch — typo-tolerant, faceted, and fast.',
    endpoints: [
      {
        method: 'GET', path: '/api/v1/search',
        description: 'Search signals, posts, and users.',
        access: 'none',
        params: [
          { name: 'q', type: 'string', description: 'Search query (at least 2 characters)', required: true },
          { name: 'type', type: 'string', description: 'Result type: all, signals, posts, users, tags', required: false },
          { name: 'category', type: 'string', description: 'Filter by category', required: false },
          { name: 'limit', type: 'number', description: 'Results per page (1-50, default 20)', required: false },
          { name: 'page', type: 'number', description: 'Page number, counting from 0', required: false },
        ],
      },
      {
        method: 'GET', path: '/api/v1/search/autocomplete',
        description: 'Typeahead autocomplete for search input.',
        access: 'none',
        params: [
          { name: 'q', type: 'string', description: 'Partial search query', required: true },
        ],
      },
    ],
  },
  {
    name: 'Stories',
    icon: Layers,
    description: 'Each event once, with how many outlets (websites) reported it and which ones — no authentication required.',
    endpoints: [
      {
        method: 'GET', path: '/api/v1/stories',
        description: 'The stories the most outlets are reporting, each event once, ranked by outlets, severity and how recent.',
        access: 'none',
        rateLimit: '60 req/min',
        params: [
          { name: 'hours', type: 'number', description: 'How many hours back (1-72, default 12)', required: false },
          { name: 'limit', type: 'number', description: 'How many stories (1-20, default 6)', required: false },
          { name: 'country', type: 'string', description: 'One country\'s stories: an ISO 3166-1 alpha-2 code such as NG', required: false },
        ],
      },
      {
        method: 'GET', path: '/api/v1/stories/:id',
        description: 'One story, from a story or report id: every outlet (website) that carried it, when it turned verified, and its reports.',
        access: 'none',
        rateLimit: '60 req/min',
      },
      {
        method: 'GET', path: '/api/v1/stories/week',
        description: '"WorldPulse Week": a week\'s top stories ranked by independent outlets, and the countries with the most verified stories.',
        access: 'none',
        rateLimit: '30 req/min',
        params: [
          { name: 'week', type: 'string', description: 'An ISO week such as 2026-W42 (default: the week under way)', required: false },
        ],
      },
      {
        method: 'GET', path: '/api/v1/stories/by-link',
        description: 'Paste a news article\'s address: the story it belongs to, how many outlets reported it and which. Articles WorldPulse has collected in the last two weeks; for another link, WorldPulse opens the public page once to read its headline and looks for a story of the last week telling the same event (match: "similar"). 6 page openings a minute per client.',
        access: 'none',
        rateLimit: '30 req/min',
        params: [
          { name: 'url', type: 'string', description: 'The article\'s address', required: true },
        ],
      },
    ],
  },
  {
    name: 'Signals',
    icon: Zap,
    description: 'Detailed signal data — verification history, source chain, geolocation.',
    endpoints: [
      {
        method: 'GET', path: '/api/v1/signals/:id',
        description: 'Full signal details: its sources, verification checks, summary and location.',
        access: 'none',
      },
      {
        method: 'GET', path: '/api/v1/signals/map/points',
        description: 'Geolocated signals for map rendering with PostGIS bounding box support. Includes reports not verified yet: check each point\'s status.',
        access: 'none',
        params: [
          { name: 'bbox', type: 'string', description: 'Bounding box: minLng,minLat,maxLng,maxLat', required: false },
          { name: 'category', type: 'string', description: 'Filter by category', required: false },
          { name: 'hours', type: 'number', description: 'How many hours back (1-168, default 24)', required: false },
          { name: 'limit', type: 'number', description: 'How many points (up to 3,000, default 500)', required: false },
        ],
      },
      {
        method: 'GET', path: '/api/v1/signals/map/hotspots',
        description: 'Geographic convergence hotspots — areas with high signal density.',
        access: 'none',
      },
      {
        method: 'GET', path: '/api/v1/signals/:id/verifications',
        description: 'Verification audit trail for a signal — AI checks, source corroboration, community flags.',
        access: 'none',
      },
    ],
  },
  {
    name: 'Intelligence',
    icon: Shield,
    description: 'Specialized intelligence feeds — military, maritime, jamming, threat tracking. Threats and jamming need a free account\'s sign-in token; the rest need nothing.',
    endpoints: [
      {
        method: 'GET', path: '/api/v1/briefing/daily',
        description: 'The top 20 signals of the last 24 hours (or of one date), most severe first, grouped by category in data.sections.',
        access: 'none', rateLimit: '60 req/min',
        params: [
          { name: 'date', type: 'string', description: 'A day as YYYY-MM-DD (default: the last 24 hours)', required: false },
          { name: 'category', type: 'string', description: 'Only this category', required: false },
        ],
      },
      {
        method: 'GET', path: '/api/v1/briefings/daily',
        description: 'The AI-written daily briefing: executive_summary, key_developments, threat_assessment and outlook. Each one is kept for up to 4 hours.',
        access: 'none', rateLimit: '10 req/min',
        params: [
          { name: 'hours', type: 'number', description: 'The period: 24 (default), 48 or 72 hours', required: false },
        ],
      },
      {
        method: 'GET', path: '/api/v1/threats/missiles',
        description: 'Missile and drone threat reports from the last 48 hours, with coordinates — ballistic, cruise, hypersonic, drone, rocket.',
        access: 'signin', rateLimit: '30 req/min',
      },
      {
        method: 'GET', path: '/api/v1/maritime/vessels',
        description: 'Naval news with coordinates: the last 3 days\' reports about warships and carrier groups. These are news reports, not live ship positions.',
        access: 'none', rateLimit: '30 req/min',
      },
      {
        method: 'GET', path: '/api/v1/jamming/zones',
        description: 'GPS/GNSS jamming reports from the last 24 hours — military EW, spoofing, civilian interference.',
        access: 'signin', rateLimit: '30 req/min',
      },
      {
        method: 'GET', path: '/api/v1/countries',
        description: 'Country-level risk scores and geopolitical context.',
        access: 'none', rateLimit: '60 req/min per IP',
      },
    ],
  },
  {
    name: 'Syndication',
    icon: Radio,
    description: 'RSS, Atom, JSON Feed, and OPML for integrating WorldPulse into any reader.',
    endpoints: [
      {
        method: 'GET', path: '/api/v1/rss/signals.xml',
        description: 'Atom 1.0 feed of the latest verified stories, one item per story.',
        access: 'none',
      },
      {
        method: 'GET', path: '/api/v1/rss/signals.json',
        description: 'JSON Feed 1.1 of the latest verified stories — machine-readable.',
        access: 'none',
      },
      {
        method: 'GET', path: '/api/v1/rss/opml',
        description: 'OPML export of all WorldPulse category feeds for reader import.',
        access: 'none',
      },
    ],
  },
  {
    name: 'STIX & Bundles',
    icon: KeyRound,
    description: 'Threat intelligence export in STIX 2.1 format (needs an API key of any tier) + Ed25519-signed bundles of the newest verified signals (need a sign-in token).',
    endpoints: [
      {
        method: 'GET', path: '/api/v1/stix/signals',
        description: 'Signals as one STIX 2.1 bundle for TIPs and SIEMs, newest first. Includes reports not verified yet.',
        access: 'apikey', rateLimit: '10 req/min',
        params: [
          { name: 'category', type: 'string', description: 'Filter by category', required: false },
          { name: 'severity', type: 'string', description: 'critical, high, medium, low or info', required: false },
          { name: 'since', type: 'string', description: 'Only signals saved since this ISO 8601 time, e.g. 2026-10-20T00:00:00Z', required: false },
          { name: 'limit', type: 'number', description: 'Number of signals (1-500, default 100)', required: false },
        ],
      },
      {
        method: 'GET', path: '/api/v1/stix/signals/:id',
        description: 'One signal as a STIX 2.1 bundle.',
        access: 'apikey', rateLimit: '30 req/min',
      },
      {
        method: 'GET', path: '/api/v1/stix/feed',
        description: 'The newest 100 signals as a STIX 2.1 bundle.',
        access: 'apikey', rateLimit: '10 req/min',
      },
      {
        method: 'GET', path: '/api/v1/bundles/current',
        description: 'The 50 newest verified signals as a signed bundle, with its Ed25519 signature and public_key.',
        access: 'signin',
      },
      {
        method: 'GET', path: '/api/v1/bundles/current.json',
        description: 'The same signed bundle as a file download.',
        access: 'signin',
      },
      {
        method: 'POST', path: '/api/v1/bundles/verify',
        description: 'Check a bundle\'s signature: send { bundle, signature, public_key }, where bundle is the bundle without its signature, public_key and verify_url fields. Answers { valid }.',
        access: 'none',
      },
      {
        method: 'GET', path: '/api/v1/bundles/public-key',
        description: 'Get the Ed25519 public key for verifying bundle signatures.',
        access: 'none',
      },
    ],
  },
  {
    name: 'Authentication',
    icon: Key,
    description: 'Sign-in tokens (JWT) for the endpoints marked SIGN-IN, and API keys for the STIX export.',
    endpoints: [
      {
        method: 'POST', path: '/api/v1/auth/register',
        description: 'Create a new WorldPulse account.',
        access: 'none',
      },
      {
        method: 'POST', path: '/api/v1/auth/login',
        description: 'Sign in with email and password. Answers { success, data: { user, accessToken, refreshToken, expiresIn } }; the access token lasts 24 hours.',
        access: 'none',
      },
      {
        method: 'POST', path: '/api/v1/auth/refresh',
        description: 'Exchange a refresh token for a new access token.',
        access: 'none',
      },
      {
        method: 'GET', path: '/api/v1/developer/keys',
        description: 'List your API keys.',
        access: 'signin',
      },
      {
        method: 'POST', path: '/api/v1/developer/keys',
        description: 'Create a new API key (the API keys page, /developer, does this for you). The key is shown once.',
        access: 'signin',
      },
    ],
  },
]

/* ── code examples ───────────────────────────────────────────────────── */
export function getCodeExample(lang: Lang): string {
  switch (lang) {
    case 'curl':
      return `# List latest verified signals (no sign-in needed)
curl -s "${API_BASE}/api/v1/public/signals?limit=10&category=conflict" | jq .

# The categories the category parameter takes
curl -s "${API_BASE}/api/v1/public/categories" | jq .

# Search for a topic
curl -s "${API_BASE}/api/v1/search?q=earthquake&type=signals" | jq .

# Get map hotspots
curl -s "${API_BASE}/api/v1/signals/map/hotspots" | jq .

# Daily briefing: the top 20 signals of the last 24 hours, by category
curl -s "${API_BASE}/api/v1/briefing/daily" | jq '.data.sections'`

    case 'python':
      return `import requests

API = "${API_BASE}"

# Public: no sign-in needed
signals = requests.get(f"{API}/api/v1/public/signals", params={
    "category": "conflict",
    "severity": "critical",
    "limit": 10,
}).json()

for sig in signals["data"]:
    print(f"[{sig['severity'].upper()}] {sig['title']}")
    # reliability_score runs from 0 to 1
    print(f"  Reliability: {sig['reliability_score'] * 100:.0f}%")
    print(f"  Where: {sig['location_name'] or 'unknown'}\\n")

# total is an estimate while total_exact is False
print(f"{signals['total']} verified signals match")

# Daily briefing: the top 20 signals of the last 24 hours, by category
briefing = requests.get(f"{API}/api/v1/briefing/daily").json()["data"]

for section in briefing["sections"]:
    print(section["category"].upper())
    for sig in section["signals"]:
        print(f"  - {sig['title']}")

# Signed in (any free account): missile and drone threats
token = requests.post(f"{API}/api/v1/auth/login", json={
    "email": "you@example.com",
    "password": "your-password",
}).json()["data"]["accessToken"]

threats = requests.get(
    f"{API}/api/v1/threats/missiles",
    headers={"Authorization": f"Bearer {token}"},
).json()

for threat in threats["data"]:
    print(f"[{threat['threat_type']}] {threat['title']}")`

    case 'javascript':
      return `const API = "${API_BASE}";

// Public signals — no sign-in needed
const res = await fetch(
  \`\${API}/api/v1/public/signals?category=climate&limit=5\`
);
const { data: signals } = await res.json();

signals.forEach(sig => {
  console.log(\`[\${sig.severity}] \${sig.title}\`);
  // reliability_score runs from 0 to 1
  console.log(\`  Reliability: \${Math.round(sig.reliability_score * 100)}%\`);
});

// Real-time updates via WebSocket. Messages are
// { event, data, timestamp, id } (pings carry only event and data)
const ws = new WebSocket("wss://api.world-pulse.io/ws");

ws.onopen = () => {
  // signal.new and alert.breaking reach every connection;
  // subscribe to "all" to get every post.new (new feed posts) too
  ws.send(JSON.stringify({ type: "subscribe", payload: { channels: ["all"] } }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.event === "ping") {
    // The server pings every 30 s and closes a connection
    // that hasn't answered with a pong for 60 s
    ws.send(JSON.stringify({ type: "pong" }));
  } else if (msg.event === "signal.new") {
    console.log("NEW SIGNAL:", msg.data.title);
  }
};

ws.onclose = () => {
  // The server doesn't reconnect for you: open a new
  // WebSocket after a short wait, longer after each try
};`

    case 'typescript':
      return `const API = "${API_BASE}";

interface Signal {
  id: string;
  title: string;
  category: string;          // one of GET /api/v1/public/categories
  severity: "critical" | "high" | "medium" | "low" | "info";
  reliability_score: number; // 0 to 1
  location_name: string | null;
  published_at: string;      // when WorldPulse saved the report
  source_url: string | null;
  outlets: number;           // independent outlets that reported it (2 or more)
  sites: string[];           // the websites of the reports it links to
  url: string;               // its page on world-pulse.io
}

// What GET /api/v1/public/signals answers
interface SignalList {
  success: boolean;
  data: Signal[];
  total: number;             // every verified signal that matches
  total_exact: boolean;      // false while total is an estimate
  limit: number;
  offset: number;
}

// Typed public API client
async function getSignals(params: {
  category?: string;
  severity?: Signal["severity"];
  limit?: number;
  offset?: number;
} = {}): Promise<SignalList> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  const res = await fetch(\`\${API}/api/v1/public/signals?\${qs}\`);
  if (!res.ok) throw new Error(\`WorldPulse API answered \${res.status}\`);
  return (await res.json()) as SignalList;
}

const critical = await getSignals({
  severity: "critical",
  limit: 5,
});
console.log(\`\${critical.total} critical signals\${critical.total_exact ? "" : " (estimate)"}\`);
critical.data.forEach(s =>
  console.log(\`[\${Math.round(s.reliability_score * 100)}%] \${s.title}\`)
);`
  }
}
