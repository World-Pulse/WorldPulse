'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Radio, Newspaper, Search, Zap, Shield, KeyRound, Key,
  Globe, Bot, MapPin, Unlock, type LucideIcon,
} from 'lucide-react'

/* ──────────────────────────────────────────────────────────────────────── *
 *  WorldPulse Developer Portal                                            *
 *  Showcases the public API, code examples, and integration guides.       *
 *  Competitive differentiator — no competitor offers an open public API.  *
 * ──────────────────────────────────────────────────────────────────────── */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.world-pulse.io'

/* ── language tabs for code examples ─────────────────────────────────── */
type Lang = 'curl' | 'python' | 'javascript' | 'typescript'

const LANGS: { id: Lang; label: string }[] = [
  { id: 'curl',       label: 'cURL' },
  { id: 'python',     label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
]

/* ── endpoint categories ─────────────────────────────────────────────── */
interface Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  path: string
  description: string
  auth: boolean
  rateLimit?: string
  params?: { name: string; type: string; description: string; required?: boolean }[]
  response?: string
}

interface EndpointGroup {
  name: string
  icon: LucideIcon
  description: string
  endpoints: Endpoint[]
}

const ENDPOINT_GROUPS: EndpointGroup[] = [
  {
    name: 'Public Signals',
    icon: Radio,
    description: 'Access verified world events — no authentication required.',
    endpoints: [
      {
        method: 'GET', path: '/api/v1/public/signals',
        description: 'List the latest verified signals from 50K+ sources worldwide.',
        auth: false, rateLimit: '60 req/min per IP',
        params: [
          { name: 'category', type: 'string', description: 'Filter by category (conflict, climate, health, economy, etc.)', required: false },
          { name: 'severity', type: 'string', description: 'Filter by severity: critical, high, medium, low, info', required: false },
          { name: 'limit', type: 'number', description: 'Number of results (1-100, default 50)', required: false },
          { name: 'offset', type: 'number', description: 'Pagination offset (default 0)', required: false },
        ],
        response: `{
  "success": true,
  "data": [
    {
      "id": "sig_abc123",
      "title": "Magnitude 6.2 earthquake detected near Tonga",
      "category": "disaster",
      "severity": "high",
      "reliability_score": 87,
      "location_name": "Tonga, South Pacific",
      "source_count": 14,
      "published_at": "2026-03-27T14:32:00Z"
    }
  ],
  "meta": { "total": 2847, "limit": 50, "offset": 0 }
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
        description: 'Global feed of signals and posts, sorted by recency and relevance.',
        auth: false, rateLimit: '60 req/min',
        params: [
          { name: 'category', type: 'string', description: 'Filter by category slug', required: false },
          { name: 'cursor', type: 'string', description: 'Cursor for pagination', required: false },
        ],
      },
      {
        method: 'GET', path: '/api/v1/feed/trending',
        description: 'Trending signals and topics in the last 24 hours.',
        auth: false,
      },
      {
        method: 'GET', path: '/api/v1/feed/following',
        description: 'Feed from users and sources you follow.',
        auth: true,
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
        auth: false,
        params: [
          { name: 'q', type: 'string', description: 'Search query', required: true },
          { name: 'type', type: 'string', description: 'Result type: all, signals, posts, users', required: false },
          { name: 'category', type: 'string', description: 'Filter by category', required: false },
          { name: 'limit', type: 'number', description: 'Results per page (default 20)', required: false },
        ],
      },
      {
        method: 'GET', path: '/api/v1/search/autocomplete',
        description: 'Typeahead autocomplete for search input.',
        auth: false,
        params: [
          { name: 'q', type: 'string', description: 'Partial search query', required: true },
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
        description: 'Get full signal details including verification timeline and related signals.',
        auth: false,
      },
      {
        method: 'GET', path: '/api/v1/signals/map/points',
        description: 'Geolocated signals for map rendering with PostGIS bounding box support.',
        auth: false,
        params: [
          { name: 'bbox', type: 'string', description: 'Bounding box: minLng,minLat,maxLng,maxLat', required: false },
          { name: 'category', type: 'string', description: 'Filter by category', required: false },
          { name: 'since', type: 'string', description: 'ISO timestamp — signals since this time', required: false },
        ],
      },
      {
        method: 'GET', path: '/api/v1/signals/map/hotspots',
        description: 'Geographic convergence hotspots — areas with high signal density.',
        auth: false,
      },
      {
        method: 'GET', path: '/api/v1/signals/:id/verifications',
        description: 'Verification audit trail for a signal — AI checks, source corroboration, community flags.',
        auth: false,
      },
    ],
  },
  {
    name: 'Intelligence',
    icon: Shield,
    description: 'Specialized intelligence feeds — military, maritime, jamming, threat tracking. Requires Pro API key.',
    endpoints: [
      {
        method: 'GET', path: '/api/v1/briefing/daily',
        description: 'AI-generated daily intelligence briefing with narrative synthesis.',
        auth: true, rateLimit: 'Pro plan · 10 req/day',
      },
      {
        method: 'GET', path: '/api/v1/threats/missiles',
        description: 'Missile and drone threat intelligence — ballistic, cruise, hypersonic, UAV.',
        auth: true, rateLimit: 'Pro plan · 30 req/min',
      },
      {
        method: 'GET', path: '/api/v1/maritime/vessels',
        description: 'Naval intelligence — carrier strike groups, AIS vessel tracking, dark ships.',
        auth: true, rateLimit: 'Pro plan · 30 req/min',
      },
      {
        method: 'GET', path: '/api/v1/jamming/zones',
        description: 'GPS/GNSS jamming intelligence — military EW, spoofing, civilian interference.',
        auth: true, rateLimit: 'Pro plan · 30 req/min',
      },
      {
        method: 'GET', path: '/api/v1/countries',
        description: 'Country-level risk scores and geopolitical context.',
        auth: false, rateLimit: '30 req/min per IP',
      },
    ],
  },
  {
    name: 'Syndication',
    icon: Radio,
    description: 'RSS, Atom, JSON Feed, and OPML for integrating WorldPulse into any reader.',
    endpoints: [
      {
        method: 'GET', path: '/api/v1/rss/feed.xml',
        description: 'RSS 2.0 feed of latest signals.',
        auth: false,
      },
      {
        method: 'GET', path: '/api/v1/rss/atom.xml',
        description: 'Atom 1.0 feed of latest signals.',
        auth: false,
      },
      {
        method: 'GET', path: '/api/v1/rss/feed.json',
        description: 'JSON Feed 1.1 — machine-readable signal feed.',
        auth: false,
      },
      {
        method: 'GET', path: '/api/v1/rss/opml',
        description: 'OPML export of all WorldPulse category feeds for reader import.',
        auth: false,
      },
    ],
  },
  {
    name: 'STIX & Bundles',
    icon: KeyRound,
    description: 'Threat intelligence export in STIX 2.1 format + Ed25519-signed source packs. Requires Pro API key.',
    endpoints: [
      {
        method: 'GET', path: '/api/v1/stix/bundle',
        description: 'Export signals as STIX 2.1 bundle for integration with TIPs.',
        auth: true, rateLimit: 'Pro plan · 10 req/hour',
      },
      {
        method: 'GET', path: '/api/v1/bundles',
        description: 'Verified source pack bundles — Ed25519 signed, tamper-proof.',
        auth: true, rateLimit: 'Pro plan · 30 req/min',
      },
      {
        method: 'GET', path: '/api/v1/bundles/public-key',
        description: 'Get the Ed25519 public key for verifying bundle signatures.',
        auth: false,
      },
    ],
  },
  {
    name: 'Authentication',
    icon: Key,
    description: 'JWT-based authentication for accessing protected endpoints.',
    endpoints: [
      {
        method: 'POST', path: '/api/v1/auth/register',
        description: 'Create a new WorldPulse account.',
        auth: false,
      },
      {
        method: 'POST', path: '/api/v1/auth/login',
        description: 'Authenticate and receive a JWT access token + refresh token.',
        auth: false,
      },
      {
        method: 'POST', path: '/api/v1/auth/refresh',
        description: 'Exchange a refresh token for a new access token.',
        auth: false,
      },
      {
        method: 'GET', path: '/api/v1/developer/keys',
        description: 'List your API keys.',
        auth: true,
      },
      {
        method: 'POST', path: '/api/v1/developer/keys',
        description: 'Create a new API key for programmatic access.',
        auth: true,
      },
    ],
  },
]

/* ── code examples ───────────────────────────────────────────────────── */
function getCodeExample(lang: Lang): string {
  switch (lang) {
    case 'curl':
      return `# List latest verified signals (no auth needed)
curl -s "${API_BASE}/api/v1/public/signals?limit=10&category=conflict" | jq .

# Search for a topic
curl -s "${API_BASE}/api/v1/search?q=earthquake&type=signals" | jq .

# Get map hotspots
curl -s "${API_BASE}/api/v1/signals/map/hotspots" | jq .

# Authenticated: get your daily briefing
curl -s -H "Authorization: Bearer YOUR_TOKEN" \\
  "${API_BASE}/api/v1/briefing/daily" | jq .`

    case 'python':
      return `import requests

API = "${API_BASE}"

# Public: no auth needed
signals = requests.get(f"{API}/api/v1/public/signals", params={
    "category": "conflict",
    "severity": "critical",
    "limit": 10,
}).json()

for sig in signals["data"]:
    print(f"[{sig['severity'].upper()}] {sig['title']}")
    print(f"  Reliability: {sig['reliability_score']}%")
    print(f"  Sources: {sig['source_count']}\\n")

# Authenticated: daily briefing
token = requests.post(f"{API}/api/v1/auth/login", json={
    "email": "you@example.com",
    "password": "your-password",
}).json()["accessToken"]

briefing = requests.get(
    f"{API}/api/v1/briefing/daily",
    headers={"Authorization": f"Bearer {token}"}
).json()

print(briefing["narrative"])`

    case 'javascript':
      return `const API = "${API_BASE}";

// Public signals — no auth needed
const res = await fetch(
  \`\${API}/api/v1/public/signals?category=climate&limit=5\`
);
const { data: signals } = await res.json();

signals.forEach(sig => {
  console.log(\`[\${sig.severity}] \${sig.title}\`);
  console.log(\`  Reliability: \${sig.reliability_score}%\`);
});

// Real-time updates via WebSocket
const ws = new WebSocket("wss://api.world-pulse.io/ws");
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "signal.new") {
    console.log("NEW SIGNAL:", msg.payload.title);
  }
};`

    case 'typescript':
      return `const API = "${API_BASE}";

interface Signal {
  id: string;
  title: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  reliability_score: number;
  location_name: string | null;
  source_count: number;
  published_at: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta: { total: number; limit: number; offset: number };
}

// Typed public API client
async function getSignals(params?: {
  category?: string;
  severity?: string;
  limit?: number;
}): Promise<Signal[]> {
  const qs = new URLSearchParams(
    Object.entries(params ?? {}).map(([k, v]) => [k, String(v)])
  );
  const res = await fetch(\`\${API}/api/v1/public/signals?\${qs}\`);
  const json: ApiResponse<Signal[]> = await res.json();
  return json.data;
}

const critical = await getSignals({
  severity: "critical",
  limit: 5,
});
critical.forEach(s =>
  console.log(\`[\${s.reliability_score}%] \${s.title}\`)
);`
  }
}

/* ── method badge colors ─────────────────────────────────────────────── */
function methodColor(m: string): string {
  switch (m) {
    case 'GET':    return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
    case 'POST':   return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    case 'PUT':    return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
    case 'PATCH':  return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
    case 'DELETE': return 'bg-red-500/20 text-red-400 border-red-500/30'
    default:       return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  }
}

/* ── components ──────────────────────────────────────────────────────── */

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative group">
      <button
        onClick={handleCopy}
        className="absolute top-3 right-3 px-2 py-1 rounded text-[11px] font-mono
          bg-[rgba(255,255,255,0.05)] text-wp-text3 hover:bg-[rgba(255,255,255,0.1)]
          hover:text-wp-text2 transition-all opacity-0 group-hover:opacity-100"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <pre className="overflow-x-auto p-4 rounded-lg bg-[rgba(0,0,0,0.4)] border border-[rgba(255,255,255,0.06)]
        text-[13px] leading-relaxed font-mono text-wp-text2">
        <code>{code}</code>
      </pre>
    </div>
  )
}

function EndpointCard({ endpoint }: { endpoint: Endpoint }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-[rgba(255,255,255,0.07)] rounded-lg overflow-hidden hover:border-[rgba(255,255,255,0.12)] transition-all">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[rgba(255,255,255,0.02)] transition-all"
      >
        <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold border ${methodColor(endpoint.method)}`}>
          {endpoint.method}
        </span>
        <code className="text-[13px] font-mono text-wp-cyan flex-1 min-w-0 truncate">
          {endpoint.path}
        </code>
        {!endpoint.auth && (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex-shrink-0">
            FREE
          </span>
        )}
        {endpoint.auth && endpoint.rateLimit?.includes('Pro') && (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-purple-500/10 text-purple-400 border border-purple-500/20 flex-shrink-0">
            PRO
          </span>
        )}
        {endpoint.auth && !endpoint.rateLimit?.includes('Pro') && (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20 flex-shrink-0">
            AUTH
          </span>
        )}
        <svg
          className={`w-4 h-4 text-wp-text3 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-[rgba(255,255,255,0.05)]">
          <p className="text-[13px] text-wp-text3 mt-3 mb-3">{endpoint.description}</p>

          {endpoint.rateLimit && (
            <p className="text-[11px] text-wp-text3 mb-3 font-mono">
              Rate limit: <span className="text-wp-amber">{endpoint.rateLimit}</span>
            </p>
          )}

          {endpoint.params && endpoint.params.length > 0 && (
            <div className="mb-3">
              <p className="text-[11px] font-mono text-wp-text3 uppercase tracking-wider mb-2">Parameters</p>
              <div className="space-y-1">
                {endpoint.params.map(p => (
                  <div key={p.name} className="flex items-start gap-2 text-[12px]">
                    <code className="font-mono text-wp-cyan min-w-[80px]">{p.name}</code>
                    <span className="text-wp-text3 font-mono text-[11px] min-w-[50px]">{p.type}</span>
                    <span className="text-wp-text3">{p.description}</span>
                    {p.required && <span className="text-red-400 text-[10px] font-mono">required</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {endpoint.response && (
            <div>
              <p className="text-[11px] font-mono text-wp-text3 uppercase tracking-wider mb-2">Example Response</p>
              <CodeBlock code={endpoint.response} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── main page ───────────────────────────────────────────────────────── */
export default function DevelopersPage() {
  const router = useRouter()
  const [activeLang, setActiveLang] = useState<Lang>('curl')
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [upgradeLoading, setUpgradeLoading] = useState(false)
  const [upgradeError, setUpgradeError] = useState<string | null>(null)

  async function handleUpgrade() {
    setUpgradeLoading(true)
    setUpgradeError(null)
    try {
      const token = typeof window !== 'undefined'
        ? localStorage.getItem('wp_access_token') ?? sessionStorage.getItem('wp_access_token')
        : null

      if (!token) {
        router.push('/auth/login?next=/developers')
        return
      }

      const res = await fetch(`${API_BASE}/api/v1/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          plan: 'pro',
          successUrl: `${window.location.origin}/settings?billing=success`,
          cancelUrl:  `${window.location.origin}/developers`,
        }),
      })

      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        setUpgradeError(data.error ?? 'Failed to start checkout. Please try again.')
        return
      }
      window.location.href = data.url
    } catch {
      setUpgradeError('Network error. Please check your connection and try again.')
    } finally {
      setUpgradeLoading(false)
    }
  }

  return (
    <div className="min-h-[calc(100vh-52px)] bg-wp-bg">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-[rgba(255,255,255,0.07)]">
        <div className="absolute inset-0 bg-gradient-to-b from-[rgba(0,212,255,0.04)] to-transparent pointer-events-none" />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-20 relative">
          <div className="flex items-center gap-2 mb-4">
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-wp-cyan/10 text-wp-cyan border border-wp-cyan/20">
              v1.0
            </span>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              OPEN API
            </span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-display text-wp-text1 mb-4 tracking-wide">
            WORLDPULSE DEVELOPER API
          </h1>
          <p className="text-[15px] sm:text-[17px] text-wp-text3 max-w-2xl leading-relaxed mb-8">
            Access real-time global intelligence from 50,000+ sources. Verified signals, reliability scores,
            geolocation data, and AI-powered briefings — all through a simple REST API.
            Free for open-source projects.
          </p>

          <div className="flex flex-wrap gap-3">
            <a
              href={`${API_BASE}/api/docs`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-wp-cyan text-black font-medium text-[14px] hover:bg-wp-cyan/90 transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Interactive API Docs
            </a>
            <a
              href="https://github.com/World-Pulse/WorldPulse"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[rgba(255,255,255,0.15)] text-wp-text2 font-medium text-[14px] hover:border-[rgba(255,255,255,0.3)] hover:text-wp-text1 transition-all"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              View on GitHub
            </a>
          </div>
        </div>
      </div>

      {/* API Tier Pricing */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 border-b border-[rgba(255,255,255,0.07)]">
        <h2 className="font-display text-xl text-wp-text1 mb-6 tracking-wide">API TIERS</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">FREE</span>
            </div>
            <h3 className="text-[16px] font-bold text-wp-text mb-1">Public</h3>
            <p className="text-[12px] text-wp-text3 mb-3">Open access for research, open-source projects, and prototyping.</p>
            <ul className="space-y-1 text-[12px] text-wp-text3">
              <li>• Public signals, search, feed</li>
              <li>• RSS / Atom / JSON Feed</li>
              <li>• Country risk scores</li>
              <li>• 60 req/min rate limit</li>
            </ul>
          </div>
          <div className="bg-wp-surface border border-wp-amber/30 rounded-xl p-5 relative">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">AUTH</span>
            </div>
            <h3 className="text-[16px] font-bold text-wp-text mb-1">Authenticated</h3>
            <p className="text-[12px] text-wp-text3 mb-3">Free account required. Higher limits and personalized data.</p>
            <ul className="space-y-1 text-[12px] text-wp-text3">
              <li>• Everything in Public</li>
              <li>• Daily AI briefings</li>
              <li>• Following feed</li>
              <li>• 120 req/min rate limit</li>
            </ul>
          </div>
          <div className="bg-wp-surface border border-wp-cyan/40 rounded-xl p-5 relative shadow-[0_0_20px_rgba(0,212,255,0.06)]">
            <div className="absolute -top-2 right-4 px-2 py-0.5 rounded text-[9px] font-mono bg-wp-cyan text-black font-bold">$12 / MO</div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-wp-cyan/10 text-wp-cyan border border-wp-cyan/20">PRO</span>
            </div>
            <h3 className="text-[16px] font-bold text-wp-text mb-1">Pro</h3>
            <p className="text-[12px] text-wp-text3 mb-3">Full intelligence suite for analysts, newsrooms, and enterprise.</p>
            <ul className="space-y-1 text-[12px] text-wp-text3">
              <li>• Everything in Authenticated</li>
              <li>• Missile & drone intelligence</li>
              <li>• Maritime/naval tracking</li>
              <li>• GPS/GNSS jamming zones</li>
              <li>• STIX 2.1 export & signed bundles</li>
              <li>• 600 req/min rate limit</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">

        {/* Quick Start */}
        <section className="mb-16">
          <h2 className="text-xl font-display text-wp-text1 tracking-wide mb-6">QUICK START</h2>

          <div className="grid gap-4 sm:grid-cols-3 mb-8">
            {[
              { step: '1', title: 'No signup needed', desc: 'Public endpoints work immediately. Just make a GET request.' },
              { step: '2', title: 'Get an API key', desc: 'Register an account and create a key for authenticated endpoints.' },
              { step: '3', title: 'Build something', desc: 'Dashboards, bots, alerts, research tools — the data is yours.' },
            ].map(s => (
              <div key={s.step} className="p-4 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)]">
                <div className="w-8 h-8 rounded-full bg-wp-cyan/10 text-wp-cyan flex items-center justify-center font-mono text-[14px] font-bold mb-3">
                  {s.step}
                </div>
                <h3 className="text-[14px] font-medium text-wp-text1 mb-1">{s.title}</h3>
                <p className="text-[13px] text-wp-text3 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>

          {/* Code Examples */}
          <div className="rounded-lg border border-[rgba(255,255,255,0.07)] overflow-hidden">
            <div className="flex items-center border-b border-[rgba(255,255,255,0.07)] bg-[rgba(0,0,0,0.2)]">
              {LANGS.map(lang => (
                <button
                  key={lang.id}
                  onClick={() => setActiveLang(lang.id)}
                  className={`px-4 py-2.5 text-[12px] font-mono font-medium transition-all border-b-2
                    ${activeLang === lang.id
                      ? 'text-wp-cyan border-wp-cyan bg-[rgba(0,212,255,0.05)]'
                      : 'text-wp-text3 border-transparent hover:text-wp-text2'
                    }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
            <CodeBlock code={getCodeExample(activeLang)} />
          </div>
        </section>

        {/* Features Grid */}
        <section className="mb-16">
          <h2 className="text-xl font-display text-wp-text1 tracking-wide mb-6">WHY WORLDPULSE API</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {([
              { icon: Globe, title: '50K+ Sources', desc: 'Wire services, OSINT feeds, GDELT, government databases, and community reports — all deduplicated and verified.' },
              { icon: Bot, title: 'AI Verification', desc: 'Multi-stage reliability scoring with transparent audit trails. Every score is explainable.' },
              { icon: MapPin, title: 'Geolocation', desc: 'PostGIS-powered spatial queries. Bounding box filters, hotspot detection, and convergence analysis.' },
              { icon: Zap, title: 'Real-Time', desc: 'WebSocket streaming for live signal updates. New events hit your app within seconds.' },
              { icon: Unlock, title: 'Open Source', desc: 'MIT licensed. Self-host the entire stack or use our hosted API. Your data, your rules.' },
              { icon: Shield, title: 'STIX 2.1 Export', desc: 'Threat intelligence in industry-standard format. Integrates with any TIP or SIEM.' },
            ] as const).map(f => (
              <div key={f.title} className="p-4 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] hover:border-[rgba(255,255,255,0.12)] transition-all">
                <f.icon className="w-6 h-6 mb-3 text-wp-cyan" />
                <h3 className="text-[14px] font-medium text-wp-text1 mb-1">{f.title}</h3>
                <p className="text-[13px] text-wp-text3 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* API Reference */}
        <section className="mb-16">
          <h2 className="text-xl font-display text-wp-text1 tracking-wide mb-2">API REFERENCE</h2>
          <p className="text-[14px] text-wp-text3 mb-6">
            Base URL: <code className="text-wp-cyan font-mono">{API_BASE}</code> — All responses are JSON with{' '}
            <code className="text-wp-cyan font-mono">{'{ success, data, meta }'}</code> shape.
          </p>

          <div className="space-y-8">
            {ENDPOINT_GROUPS.map(group => (
              <div key={group.name}>
                <button
                  onClick={() => setActiveGroup(activeGroup === group.name ? null : group.name)}
                  className="w-full flex items-center gap-3 mb-3 group"
                >
                  <group.icon className="w-5 h-5" />
                  <h3 className="text-[15px] font-medium text-wp-text1 group-hover:text-wp-cyan transition-colors">
                    {group.name}
                  </h3>
                  <span className="text-[12px] text-wp-text3 font-mono">
                    {group.endpoints.length} endpoint{group.endpoints.length > 1 ? 's' : ''}
                  </span>
                  <div className="flex-1 border-b border-[rgba(255,255,255,0.05)]" />
                  <svg
                    className={`w-4 h-4 text-wp-text3 transition-transform ${activeGroup === group.name ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <p className="text-[13px] text-wp-text3 mb-3 ml-8">{group.description}</p>

                {activeGroup === group.name && (
                  <div className="space-y-2 ml-8">
                    {group.endpoints.map(ep => (
                      <EndpointCard key={`${ep.method}-${ep.path}`} endpoint={ep} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Rate Limits & Auth */}
        <section className="mb-16">
          <h2 className="text-xl font-display text-wp-text1 tracking-wide mb-6">AUTHENTICATION & RATE LIMITS</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="p-5 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)]">
              <h3 className="text-[14px] font-medium text-wp-text1 mb-3">Authentication</h3>
              <div className="space-y-2 text-[13px] text-wp-text3 leading-relaxed">
                <p>Most public endpoints work without auth. For authenticated endpoints, include a JWT token:</p>
                <code className="block p-2 rounded bg-[rgba(0,0,0,0.3)] font-mono text-[12px] text-wp-cyan">
                  Authorization: Bearer {'<your-token>'}
                </code>
                <p>Get tokens via <code className="text-wp-cyan font-mono">POST /api/v1/auth/login</code> or create API keys in your account settings.</p>
              </div>
            </div>

            <div className="p-5 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)]">
              <h3 className="text-[14px] font-medium text-wp-text1 mb-3">Rate Limits</h3>
              <div className="space-y-2 text-[13px] text-wp-text3">
                <div className="flex justify-between">
                  <span>Public endpoints</span>
                  <span className="font-mono text-wp-amber">60 req/min</span>
                </div>
                <div className="flex justify-between">
                  <span>Authenticated</span>
                  <span className="font-mono text-wp-amber">200 req/min</span>
                </div>
                <div className="flex justify-between">
                  <span>Auth endpoints</span>
                  <span className="font-mono text-wp-amber">5 req/min</span>
                </div>
                <div className="flex justify-between">
                  <span>Write endpoints</span>
                  <span className="font-mono text-wp-amber">10 req/min</span>
                </div>
                <p className="text-[12px] mt-2 pt-2 border-t border-[rgba(255,255,255,0.05)]">
                  Rate limit headers (<code className="text-wp-cyan font-mono">X-RateLimit-Limit</code>,{' '}
                  <code className="text-wp-cyan font-mono">X-RateLimit-Remaining</code>) are included in every response.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* WebSocket */}
        <section className="mb-16">
          <h2 className="text-xl font-display text-wp-text1 tracking-wide mb-6">WEBSOCKET STREAMING</h2>
          <div className="p-5 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)]">
            <p className="text-[13px] text-wp-text3 mb-4 leading-relaxed">
              Connect to <code className="text-wp-cyan font-mono">wss://api.world-pulse.io/ws</code> for real-time signal updates.
              The connection supports automatic reconnection with exponential backoff (1s to 30s) and ping/pong heartbeat.
            </p>
            <p className="text-[12px] font-mono text-wp-text3 uppercase tracking-wider mb-2">Event Types</p>
            <div className="space-y-1 text-[13px]">
              <div className="flex gap-3">
                <code className="text-wp-cyan font-mono min-w-[160px]">signal.new</code>
                <span className="text-wp-text3">A new signal has been verified and published</span>
              </div>
              <div className="flex gap-3">
                <code className="text-wp-cyan font-mono min-w-[160px]">signal.updated</code>
                <span className="text-wp-text3">A signal&apos;s reliability score or metadata has changed</span>
              </div>
              <div className="flex gap-3">
                <code className="text-wp-cyan font-mono min-w-[160px]">alert.breaking</code>
                <span className="text-wp-text3">A breaking news alert has been triggered</span>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing & Upgrade */}
        <section className="mb-16">
          <h2 className="text-xl font-display text-wp-text1 tracking-wide mb-2">PLANS & PRICING</h2>
          <p className="text-[14px] text-wp-text3 mb-6">Start free, upgrade when you need more. No lock-in, cancel anytime.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
            {/* Free plan */}
            <div className="rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] p-6 flex flex-col">
              <div className="mb-5">
                <p className="text-[10px] font-mono font-semibold text-wp-text3 uppercase tracking-widest mb-2">Free</p>
                <div className="flex items-end gap-2">
                  <span className="text-4xl font-bold text-wp-text">$0</span>
                  <span className="text-wp-text3 mb-1 text-[13px]">/ month</span>
                </div>
                <p className="mt-1.5 text-[12px] text-wp-text3">Full core access. No credit card required.</p>
              </div>
              <ul className="space-y-2 mb-6 flex-1 text-[13px] text-wp-text3">
                {['60 API requests / minute', '7-day signal history', 'Up to 3 alert subscriptions', 'Global live feed & world map', 'Community access', 'RSS / JSON Feed export'].map(f => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-0.5 flex-shrink-0">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/auth/register"
                className="block w-full text-center rounded-lg border border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] text-wp-text font-semibold py-2.5 text-[14px] transition-colors"
              >
                Get Started — Free
              </Link>
            </div>

            {/* Pro plan */}
            <div className="rounded-xl border-2 border-wp-cyan/50 bg-wp-cyan/5 p-6 flex flex-col shadow-[0_0_30px_rgba(0,212,255,0.07)] relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="px-3 py-1 rounded-full bg-wp-cyan text-black text-[10px] font-mono font-bold tracking-widest uppercase shadow-lg">
                  Most Popular
                </span>
              </div>
              <div className="mb-5">
                <p className="text-[10px] font-mono font-semibold text-wp-cyan/80 uppercase tracking-widest mb-2">Pro</p>
                <div className="flex items-end gap-2">
                  <span className="text-4xl font-bold text-wp-text">$12</span>
                  <span className="text-wp-text3 mb-1 text-[13px]">/ month</span>
                </div>
                <p className="mt-1.5 text-[12px] text-wp-text3">Higher limits, webhooks & full intelligence suite.</p>
              </div>
              <ul className="space-y-2 mb-6 flex-1 text-[13px] text-wp-text3">
                {['600 API requests / minute', '90-day signal history', 'Unlimited alert subscriptions', '5 webhook endpoints', 'Advanced analytics', 'Priority support', 'Early access to beta features'].map(f => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="text-wp-cyan mt-0.5 flex-shrink-0">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {upgradeError && (
                <p className="mb-3 text-[12px] text-red-400 bg-red-400/10 rounded-lg px-3 py-2 border border-red-400/20">
                  {upgradeError}
                </p>
              )}

              <button
                onClick={handleUpgrade}
                disabled={upgradeLoading}
                className="block w-full text-center rounded-lg bg-wp-cyan hover:bg-wp-cyan/90 active:bg-wp-cyan/80 text-black font-bold py-2.5 text-[14px] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {upgradeLoading ? 'Redirecting to Stripe…' : 'Upgrade to Pro — $12/mo'}
              </button>
              <p className="text-center text-[11px] text-wp-text3 mt-2">
                Secure checkout via Stripe. Cancel anytime.
              </p>
            </div>
          </div>

        </section>

        {/* Footer CTA */}
        <section className="text-center py-12 border-t border-[rgba(255,255,255,0.07)]">
          <h2 className="text-2xl font-display text-wp-text1 tracking-wide mb-3">READY TO BUILD?</h2>
          <p className="text-[14px] text-wp-text3 mb-6 max-w-lg mx-auto">
            WorldPulse is open source and free for non-commercial use.
            Start building with the public API today — no API key required.
          </p>
          <div className="flex justify-center gap-3 flex-wrap">
            <a
              href="https://github.com/World-Pulse/WorldPulse"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-wp-cyan text-black font-medium text-[14px] hover:bg-wp-cyan/90 transition-all"
            >
              Try the API Now
            </a>
          </div>
        </section>
      </div>
    </div>
  )
}
