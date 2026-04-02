'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'curl' | 'typescript' | 'python'

interface CodeExample {
  curl: string
  typescript: string
  python: string
}

// ─── Copy button ─────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <button
      onClick={handleCopy}
      aria-label="Copy code to clipboard"
      className="copy-btn absolute top-3 right-3 px-2 py-1 text-[11px] font-mono rounded
        bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-100
        hover:border-amber-500/50 transition-all"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

// ─── Code block ──────────────────────────────────────────────────────────────

function CodeBlock({ code, language }: { code: string; language: string }) {
  return (
    <div className="relative">
      <CopyButton text={code} />
      <pre
        className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 overflow-x-auto
          text-[12.5px] leading-relaxed font-mono text-zinc-300 pr-16"
        data-language={language}
      >
        <code>{code.trim()}</code>
      </pre>
    </div>
  )
}

// ─── Tabbed code example ─────────────────────────────────────────────────────

function TabbedCodeExample({ examples }: { examples: CodeExample }) {
  const [tab, setTab] = useState<Tab>('curl')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'curl', label: 'cURL' },
    { id: 'typescript', label: 'TypeScript' },
    { id: 'python', label: 'Python' },
  ]

  return (
    <div className="rounded-lg overflow-hidden border border-zinc-800">
      {/* Tab bar */}
      <div className="flex bg-zinc-900 border-b border-zinc-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-[12px] font-mono transition-all
              ${tab === t.id
                ? 'text-amber-400 border-b-2 border-amber-500 bg-zinc-950'
                : 'text-zinc-500 hover:text-zinc-300'
              }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Code */}
      <div className="relative">
        <CopyButton text={examples[tab]} />
        <pre
          className="bg-zinc-950 p-4 overflow-x-auto text-[12.5px] leading-relaxed
            font-mono text-zinc-300 pr-16 min-h-[120px]"
        >
          <code>{examples[tab].trim()}</code>
        </pre>
      </div>
    </div>
  )
}

// ─── Section wrapper ─────────────────────────────────────────────────────────

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 mb-14 glass rounded-xl border border-zinc-800/60 p-6 md:p-8"
    >
      <h2 className="text-[22px] font-semibold text-zinc-100 mb-6 pb-3
        border-b border-zinc-800 flex items-center gap-3">
        <span className="w-1 h-5 rounded-full bg-amber-500 inline-block flex-shrink-0" />
        {title}
      </h2>
      {children}
    </section>
  )
}

// ─── Method badge ─────────────────────────────────────────────────────────────

function MethodBadge({ method }: { method: 'GET' | 'POST' | 'DELETE' | 'WS' }) {
  const colours: Record<typeof method, string> = {
    GET: 'text-emerald-400 bg-emerald-400/10 border-emerald-500/30',
    POST: 'text-amber-400 bg-amber-400/10 border-amber-500/30',
    DELETE: 'text-red-400 bg-red-400/10 border-red-500/30',
    WS: 'text-cyan-400 bg-cyan-400/10 border-cyan-500/30',
  }
  return (
    <span
      className={`inline-block px-2 py-0.5 text-[11px] font-mono font-bold rounded border
        ${colours[method]}`}
    >
      {method}
    </span>
  )
}

// ─── Endpoint header ─────────────────────────────────────────────────────────

function EndpointRow({
  method,
  path,
  description,
}: {
  method: 'GET' | 'POST' | 'DELETE' | 'WS'
  path: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-zinc-800/60 last:border-0">
      <MethodBadge method={method} />
      <div>
        <code className="text-[13px] font-mono text-zinc-200">{path}</code>
        <p className="text-[12px] text-zinc-500 mt-0.5">{description}</p>
      </div>
    </div>
  )
}

// ─── Param row ────────────────────────────────────────────────────────────────

function ParamRow({
  name,
  type,
  required,
  description,
}: {
  name: string
  type: string
  required?: boolean
  description: string
}) {
  return (
    <tr className="border-b border-zinc-800/50">
      <td className="py-2.5 pr-4">
        <code className="text-[12.5px] font-mono text-amber-400">{name}</code>
        {required && (
          <span className="ml-1.5 text-[10px] text-red-400 font-medium">required</span>
        )}
      </td>
      <td className="py-2.5 pr-4">
        <code className="text-[12px] text-zinc-400">{type}</code>
      </td>
      <td className="py-2.5 text-[12px] text-zinc-500">{description}</td>
    </tr>
  )
}

// ─── Nav items ────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'authentication', label: 'Authentication' },
  { id: 'rate-limits', label: 'Rate Limits' },
  { id: 'public-endpoints', label: 'Public Endpoints' },
  { id: 'authenticated-endpoints', label: 'Authenticated Endpoints' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'websocket', label: 'WebSocket' },
]

// ─── Code examples ────────────────────────────────────────────────────────────

const PUBLIC_SIGNALS_EXAMPLES: CodeExample = {
  curl: `curl "https://api.worldpulse.io/api/v1/public/signals?category=conflict&severity=critical&limit=10" \\
  -H "Accept: application/json"`,

  typescript: `const res = await fetch(
  \`\${process.env.NEXT_PUBLIC_API_URL}/api/v1/public/signals?category=conflict&limit=10\`
)
const { data, total } = await res.json()

interface Signal {
  id: string
  title: string
  category: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  reliability_score: number
  location_name: string
  published_at: string
  source_url: string
}`,

  python: `import httpx

resp = httpx.get(
    "https://api.worldpulse.io/api/v1/public/signals",
    params={"category": "conflict", "severity": "critical", "limit": 10},
)
resp.raise_for_status()
data = resp.json()  # {"success": True, "data": [...], "total": 42, ...}`,
}

const FEED_SIGNALS_EXAMPLES: CodeExample = {
  curl: `curl "https://api.worldpulse.io/api/v1/feed/signals" \\
  -H "Authorization: Bearer wp_live_xxxxxxxxxxxx" \\
  -H "Accept: application/json"`,

  typescript: `const res = await fetch(
  \`\${process.env.NEXT_PUBLIC_API_URL}/api/v1/feed/signals\`,
  { headers: { Authorization: \`Bearer \${apiKey}\` } }
)
const { data } = await res.json()`,

  python: `import httpx

resp = httpx.get(
    "https://api.worldpulse.io/api/v1/feed/signals",
    headers={"Authorization": f"Bearer {api_key}"},
)
data = resp.json()`,
}

const SIGNAL_DETAIL_EXAMPLES: CodeExample = {
  curl: `curl "https://api.worldpulse.io/api/v1/signals/sig_abc123" \\
  -H "Authorization: Bearer wp_live_xxxxxxxxxxxx"`,

  typescript: `const res = await fetch(
  \`\${process.env.NEXT_PUBLIC_API_URL}/api/v1/signals/sig_abc123\`,
  { headers: { Authorization: \`Bearer \${apiKey}\` } }
)
const { data: signal } = await res.json()`,

  python: `resp = httpx.get(
    "https://api.worldpulse.io/api/v1/signals/sig_abc123",
    headers={"Authorization": f"Bearer {api_key}"},
)`,
}

const SEARCH_EXAMPLES: CodeExample = {
  curl: `curl "https://api.worldpulse.io/api/v1/search?q=ukraine+energy+infrastructure" \\
  -H "Authorization: Bearer wp_live_xxxxxxxxxxxx"`,

  typescript: `const params = new URLSearchParams({ q: 'ukraine energy infrastructure' })
const res = await fetch(
  \`\${process.env.NEXT_PUBLIC_API_URL}/api/v1/search?\${params}\`,
  { headers: { Authorization: \`Bearer \${apiKey}\` } }
)
const { data } = await res.json()`,

  python: `resp = httpx.get(
    "https://api.worldpulse.io/api/v1/search",
    params={"q": "ukraine energy infrastructure"},
    headers={"Authorization": f"Bearer {api_key}"},
)`,
}

const WEBHOOK_EXAMPLES: CodeExample = {
  curl: `curl -X POST "https://api.worldpulse.io/api/v1/developer/webhooks" \\
  -H "Authorization: Bearer wp_live_xxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://your-server.com/webhook",
    "events": ["signal.new", "alert.breaking"],
    "filters": {
      "severity": ["critical", "high"],
      "category": ["conflict", "climate"]
    }
  }'`,

  typescript: `const res = await fetch(
  \`\${process.env.NEXT_PUBLIC_API_URL}/api/v1/developer/webhooks\`,
  {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${apiKey}\`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: 'https://your-server.com/webhook',
      events: ['signal.new', 'alert.breaking'],
      filters: { severity: ['critical', 'high'] },
    }),
  }
)
const { id } = await res.json()`,

  python: `resp = httpx.post(
    "https://api.worldpulse.io/api/v1/developer/webhooks",
    headers={"Authorization": f"Bearer {api_key}"},
    json={
        "url": "https://your-server.com/webhook",
        "events": ["signal.new", "alert.breaking"],
        "filters": {"severity": ["critical", "high"]},
    },
)
webhook_id = resp.json()["id"]`,
}

const WEBSOCKET_EXAMPLES: CodeExample = {
  curl: `# WebSocket connections require a WS client. Use wscat:
npx wscat -c "wss://api.worldpulse.io/ws" \\
  --header "Authorization: Bearer wp_live_xxxxxxxxxxxx"`,

  typescript: `const ws = new WebSocket(
  \`wss://api.worldpulse.io/ws?token=\${apiKey}\`
)

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    channels: ['signals:global', 'alerts:breaking'],
    filters: { severity: ['critical', 'high'] },
  }))
}

ws.onmessage = (event) => {
  const { type, data } = JSON.parse(event.data)
  if (type === 'signal.new') console.log('New signal:', data)
}`,

  python: `import asyncio, json, websockets

async def stream():
    uri = f"wss://api.worldpulse.io/ws?token={api_key}"
    async with websockets.connect(uri) as ws:
        await ws.send(json.dumps({
            "type": "subscribe",
            "channels": ["signals:global", "alerts:breaking"],
        }))
        async for message in ws:
            event = json.loads(message)
            print(event["type"], event.get("data", {}).get("title"))

asyncio.run(stream())`,
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ApiDocsPage() {
  const [activeSection, setActiveSection] = useState('authentication')

  const scrollToSection = (id: string) => {
    setActiveSection(id)
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth' })
  }

  const baseUrl = `${process.env.NEXT_PUBLIC_API_URL ?? 'https://api.worldpulse.io'}/api/v1`

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="border-b border-zinc-800/60 bg-zinc-950">
        <div className="max-w-6xl mx-auto px-4 py-12 md:py-16">
          <div className="flex items-center gap-2 mb-4">
            <span className="px-2.5 py-1 text-[11px] font-mono font-semibold tracking-widest
              uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded">
              v1
            </span>
            <span className="text-zinc-600 text-[12px] font-mono">stable</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-zinc-100 mb-3 tracking-tight">
            WorldPulse Developer API
          </h1>
          <p className="text-lg text-zinc-400 max-w-2xl mb-8">
            Real-time global intelligence signals, semantic search, and live streaming —
            all from a single REST + WebSocket API.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/settings"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium
                bg-amber-500 text-zinc-950 hover:bg-amber-400 transition-colors text-[14px]"
            >
              Get API Key
            </Link>
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg
              bg-zinc-900 border border-zinc-800 font-mono text-[12px] text-zinc-400">
              <span className="text-zinc-600">Base URL</span>
              <code className="text-zinc-200 select-all">{baseUrl}</code>
            </div>
          </div>
        </div>
      </div>

      {/* ── 2-column layout ────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 py-8 md:flex md:gap-8">

        {/* ── Sticky sidebar ─────────────────────────────────────────── */}
        <aside className="hidden md:block w-52 flex-shrink-0">
          <nav className="sticky top-24" aria-label="API documentation sections">
            <p className="text-[11px] font-semibold tracking-widest uppercase
              text-zinc-600 mb-3 px-2">
              Contents
            </p>
            <ul className="space-y-0.5">
              {NAV_ITEMS.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => scrollToSection(item.id)}
                    className={`w-full text-left px-2 py-1.5 rounded text-[13px] transition-all
                      ${activeSection === item.id
                        ? 'text-amber-400 bg-amber-500/10'
                        : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60'
                      }`}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-8 pt-6 border-t border-zinc-800">
              <Link
                href="/settings"
                className="block text-center px-3 py-2 rounded-lg text-[12px] font-medium
                  bg-amber-500/10 text-amber-400 border border-amber-500/20
                  hover:bg-amber-500/20 transition-colors"
              >
                Get API Key →
              </Link>
            </div>
          </nav>
        </aside>

        {/* ── Main content ───────────────────────────────────────────── */}
        <main className="flex-1 min-w-0">

          {/* ── Authentication ───────────────────────────────────────── */}
          <Section id="authentication" title="Authentication">
            <p className="text-[13px] text-zinc-400 mb-6">
              WorldPulse uses bearer token authentication. Include your API key in the{' '}
              <code className="font-mono text-amber-400 text-[12px]">Authorization</code> header
              on every authenticated request.
            </p>

            <CodeBlock
              language="http"
              code={`Authorization: Bearer wp_live_xxxxxxxxxxxx`}
            />

            <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  tier: 'Free',
                  prefix: 'wp_free_',
                  description: 'Public data access, rate-limited.',
                  colour: 'border-zinc-700',
                  badge: 'text-zinc-400 bg-zinc-800',
                },
                {
                  tier: 'Pro',
                  prefix: 'wp_live_',
                  description: 'Full signal feed, search, and webhooks.',
                  colour: 'border-amber-500/40',
                  badge: 'text-amber-400 bg-amber-500/10',
                },
                {
                  tier: 'Enterprise',
                  prefix: 'wp_ent_',
                  description: 'Unlimited access + dedicated support.',
                  colour: 'border-cyan-500/40',
                  badge: 'text-cyan-400 bg-cyan-500/10',
                },
              ].map((t) => (
                <div
                  key={t.tier}
                  className={`p-4 rounded-lg bg-zinc-900/50 border ${t.colour}`}
                >
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${t.badge}`}>
                    {t.tier}
                  </span>
                  <code className="block mt-2 mb-1 text-[12px] font-mono text-zinc-400">
                    {t.prefix}•••
                  </code>
                  <p className="text-[12px] text-zinc-500">{t.description}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-[12px] text-amber-300/80">
              <strong className="font-semibold">Note:</strong> Never expose API keys in client-side
              code or public repositories. Use environment variables on your server.
            </div>
          </Section>

          {/* ── Rate Limits ─────────────────────────────────────────────── */}
          <Section id="rate-limits" title="Rate Limits">
            <p className="text-[13px] text-zinc-400 mb-6">
              Rate limits are enforced per API key. Exceeding them returns a{' '}
              <code className="font-mono text-amber-400 text-[12px]">429 Too Many Requests</code>{' '}
              response with a{' '}
              <code className="font-mono text-zinc-300 text-[12px]">Retry-After</code> header.
            </p>

            <div className="overflow-x-auto rounded-lg border border-zinc-800">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-zinc-900 border-b border-zinc-800">
                    <th className="text-left px-4 py-3 text-zinc-400 font-medium">Plan</th>
                    <th className="text-left px-4 py-3 text-zinc-400 font-medium">Requests / min</th>
                    <th className="text-left px-4 py-3 text-zinc-400 font-medium">Requests / day</th>
                    <th className="text-left px-4 py-3 text-zinc-400 font-medium">WebSocket streams</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-zinc-800/60">
                    <td className="px-4 py-3 text-zinc-300 font-medium">Free</td>
                    <td className="px-4 py-3 font-mono text-zinc-400">60</td>
                    <td className="px-4 py-3 font-mono text-zinc-400">1,000</td>
                    <td className="px-4 py-3 text-zinc-500">—</td>
                  </tr>
                  <tr className="border-b border-zinc-800/60">
                    <td className="px-4 py-3 text-amber-400 font-medium">Pro</td>
                    <td className="px-4 py-3 font-mono text-zinc-400">300</td>
                    <td className="px-4 py-3 font-mono text-zinc-400">10,000</td>
                    <td className="px-4 py-3 text-zinc-400">5 concurrent</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-cyan-400 font-medium">Enterprise</td>
                    <td className="px-4 py-3 font-mono text-zinc-400">Unlimited</td>
                    <td className="px-4 py-3 font-mono text-zinc-400">Unlimited</td>
                    <td className="px-4 py-3 text-zinc-400">Unlimited</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { header: 'X-RateLimit-Limit', desc: 'Max requests allowed in the current window' },
                { header: 'X-RateLimit-Remaining', desc: 'Requests remaining in this window' },
                { header: 'X-RateLimit-Reset', desc: 'Unix timestamp when the window resets' },
                { header: 'Retry-After', desc: 'Seconds to wait before retrying (429 only)' },
              ].map((h) => (
                <div key={h.header} className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
                  <code className="text-[12px] font-mono text-amber-400">{h.header}</code>
                  <p className="text-[12px] text-zinc-500 mt-0.5">{h.desc}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Public Endpoints ─────────────────────────────────────────── */}
          <Section id="public-endpoints" title="Public Endpoints">
            <p className="text-[13px] text-zinc-400 mb-6">
              Public endpoints require no authentication and are suitable for embedding
              WorldPulse data in public-facing applications. Cached responses include an{' '}
              <code className="font-mono text-amber-400 text-[12px]">X-Cache-Hit: true</code> header.
            </p>

            {/* GET /public/signals */}
            <div className="mb-8">
              <EndpointRow
                method="GET"
                path="GET /public/signals"
                description="Paginated list of recent verified signals, publicly accessible."
              />

              <div className="mt-5">
                <h3 className="text-[13px] font-semibold text-zinc-300 mb-3">Query Parameters</h3>
                <div className="overflow-x-auto rounded-lg border border-zinc-800">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="bg-zinc-900 border-b border-zinc-800">
                        <th className="text-left px-3 py-2 text-zinc-500 font-medium">Parameter</th>
                        <th className="text-left px-3 py-2 text-zinc-500 font-medium">Type</th>
                        <th className="text-left px-3 py-2 text-zinc-500 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      <ParamRow name="category" type="string" description="Filter by category: conflict, climate, economy, health, technology" />
                      <ParamRow name="severity" type="string" description="Filter by severity: low, medium, high, critical" />
                      <ParamRow name="limit" type="integer" description="Number of results (default: 20, max: 100)" />
                      <ParamRow name="offset" type="integer" description="Pagination offset (default: 0)" />
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-5">
                <h3 className="text-[13px] font-semibold text-zinc-300 mb-3">Response Shape</h3>
                <CodeBlock
                  language="json"
                  code={`{
  "success": true,
  "data": [
    {
      "id": "sig_abc123",
      "title": "Flooding reported across southern regions",
      "category": "climate",
      "severity": "high",
      "reliability_score": 0.87,
      "location_name": "Bangladesh",
      "published_at": "2026-03-30T14:22:00Z",
      "source_url": "https://reuters.com/..."
    }
  ],
  "total": 284,
  "limit": 20,
  "offset": 0
}`}
                />
                <p className="mt-2 text-[12px] text-zinc-500">
                  When served from Redis cache: response includes{' '}
                  <code className="font-mono text-amber-400">X-Cache-Hit: true</code> header.
                </p>
              </div>

              <div className="mt-5">
                <h3 className="text-[13px] font-semibold text-zinc-300 mb-3">Code Examples</h3>
                <TabbedCodeExample examples={PUBLIC_SIGNALS_EXAMPLES} />
              </div>
            </div>
          </Section>

          {/* ── Authenticated Endpoints ──────────────────────────────────── */}
          <Section id="authenticated-endpoints" title="Authenticated Endpoints">
            <p className="text-[13px] text-zinc-400 mb-6">
              These endpoints require a valid API key in the{' '}
              <code className="font-mono text-amber-400 text-[12px]">Authorization</code> header.
              Pro and Enterprise keys unlock the full signal feed with enrichment data.
            </p>

            {/* GET /feed/signals */}
            <div className="mb-8 pb-8 border-b border-zinc-800/50">
              <EndpointRow
                method="GET"
                path="GET /feed/signals"
                description="Authenticated live signal feed with enrichment metadata."
              />
              <p className="mt-3 text-[12px] text-zinc-500">
                Returns the same shape as{' '}
                <code className="font-mono text-amber-400">/public/signals</code> with additional
                fields: <code className="font-mono text-zinc-400">enrichment</code>,{' '}
                <code className="font-mono text-zinc-400">related_signals</code>,{' '}
                <code className="font-mono text-zinc-400">reliability_breakdown</code>.
                For real-time delivery, use the{' '}
                <button
                  onClick={() => scrollToSection('websocket')}
                  className="text-amber-400 hover:text-amber-300 underline underline-offset-2"
                >
                  WebSocket API
                </button>.
              </p>
              <div className="mt-4">
                <TabbedCodeExample examples={FEED_SIGNALS_EXAMPLES} />
              </div>
            </div>

            {/* GET /signals/:id */}
            <div className="mb-8 pb-8 border-b border-zinc-800/50">
              <EndpointRow
                method="GET"
                path="GET /signals/:id"
                description="Single signal with full enrichment, related signals, and source metadata."
              />
              <div className="mt-4">
                <TabbedCodeExample examples={SIGNAL_DETAIL_EXAMPLES} />
              </div>
            </div>

            {/* GET /search */}
            <div className="mb-2">
              <EndpointRow
                method="GET"
                path="GET /search?q="
                description="Semantic + keyword hybrid search across all verified signals."
              />
              <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-800">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-zinc-900 border-b border-zinc-800">
                      <th className="text-left px-3 py-2 text-zinc-500 font-medium">Parameter</th>
                      <th className="text-left px-3 py-2 text-zinc-500 font-medium">Type</th>
                      <th className="text-left px-3 py-2 text-zinc-500 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <ParamRow name="q" type="string" required description="Search query (semantic + keyword)" />
                    <ParamRow name="category" type="string" description="Narrow results to a category" />
                    <ParamRow name="limit" type="integer" description="Results per page (default: 20, max: 50)" />
                  </tbody>
                </table>
              </div>
              <div className="mt-4">
                <TabbedCodeExample examples={SEARCH_EXAMPLES} />
              </div>
            </div>
          </Section>

          {/* ── Webhooks ──────────────────────────────────────────────────── */}
          <Section id="webhooks" title="Webhooks">
            <p className="text-[13px] text-zinc-400 mb-6">
              Register a webhook URL to receive real-time push notifications when signals
              match your filters. WorldPulse signs each delivery with an{' '}
              <code className="font-mono text-amber-400 text-[12px]">X-WP-Signature</code> header
              (HMAC-SHA256 of the raw body).
            </p>

            <EndpointRow
              method="POST"
              path="POST /developer/webhooks"
              description="Register a new webhook endpoint."
            />

            <div className="mt-5">
              <h3 className="text-[13px] font-semibold text-zinc-300 mb-3">Supported Events</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { event: 'signal.new', desc: 'A new signal is ingested and verified' },
                  { event: 'signal.updated', desc: 'Reliability score or category changes' },
                  { event: 'alert.breaking', desc: 'Critical severity signal detected' },
                ].map((e) => (
                  <div
                    key={e.event}
                    className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800"
                  >
                    <code className="text-[12px] font-mono text-amber-400">{e.event}</code>
                    <p className="text-[11px] text-zinc-500 mt-1">{e.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <h3 className="text-[13px] font-semibold text-zinc-300 mb-3">Filters</h3>
              <div className="overflow-x-auto rounded-lg border border-zinc-800">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-zinc-900 border-b border-zinc-800">
                      <th className="text-left px-3 py-2 text-zinc-500 font-medium">Field</th>
                      <th className="text-left px-3 py-2 text-zinc-500 font-medium">Type</th>
                      <th className="text-left px-3 py-2 text-zinc-500 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <ParamRow name="category" type="string[]" description="Only deliver events for these categories" />
                    <ParamRow name="severity" type="string[]" description="Only deliver events matching severity levels" />
                    <ParamRow name="country_code" type="string[]" description="ISO 3166-1 alpha-2 country codes to filter by location" />
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-5">
              <h3 className="text-[13px] font-semibold text-zinc-300 mb-3">Code Examples</h3>
              <TabbedCodeExample examples={WEBHOOK_EXAMPLES} />
            </div>

            <div className="mt-5">
              <h3 className="text-[13px] font-semibold text-zinc-300 mb-3">Payload Shape</h3>
              <CodeBlock
                language="json"
                code={`{
  "event": "signal.new",
  "timestamp": "2026-03-30T14:22:00Z",
  "data": {
    "id": "sig_abc123",
    "title": "Flooding reported across southern regions",
    "category": "climate",
    "severity": "high",
    "reliability_score": 0.87,
    "location_name": "Bangladesh",
    "published_at": "2026-03-30T14:22:00Z"
  }
}`}
              />
            </div>
          </Section>

          {/* ── WebSocket ────────────────────────────────────────────────── */}
          <Section id="websocket" title="WebSocket">
            <p className="text-[13px] text-zinc-400 mb-4">
              Subscribe to a live stream of signals without polling. The WebSocket endpoint
              pushes events as they are ingested and verified — typically within 2–5 seconds
              of source publication.
            </p>

            <div className="flex items-center gap-3 p-3 mb-6 rounded-lg bg-zinc-900/60
              border border-cyan-500/20">
              <MethodBadge method="WS" />
              <code className="text-[13px] font-mono text-zinc-200">
                wss://api.worldpulse.io/ws
              </code>
            </div>

            <div className="mt-5">
              <h3 className="text-[13px] font-semibold text-zinc-300 mb-3">Available Channels</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { channel: 'signals:global', desc: 'All verified signals worldwide' },
                  { channel: 'signals:breaking', desc: 'Critical severity signals only' },
                  { channel: 'alerts:breaking', desc: 'Breaking alert notifications' },
                  { channel: 'signals:{category}', desc: 'Category-scoped stream (e.g. signals:conflict)' },
                ].map((c) => (
                  <div key={c.channel} className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
                    <code className="text-[12px] font-mono text-cyan-400">{c.channel}</code>
                    <p className="text-[11px] text-zinc-500 mt-1">{c.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <h3 className="text-[13px] font-semibold text-zinc-300 mb-3">Message Types</h3>
              <div className="space-y-2">
                {[
                  { type: 'subscribe', dir: 'Client → Server', desc: 'Subscribe to one or more channels' },
                  { type: 'unsubscribe', dir: 'Client → Server', desc: 'Unsubscribe from channels' },
                  { type: 'ping', dir: 'Client → Server', desc: 'Keepalive ping (server responds with pong)' },
                  { type: 'signal.new', dir: 'Server → Client', desc: 'New signal ingested' },
                  { type: 'signal.updated', dir: 'Server → Client', desc: 'Signal reliability or metadata changed' },
                  { type: 'alert.breaking', dir: 'Server → Client', desc: 'Breaking alert triggered' },
                ].map((m) => (
                  <div key={m.type} className="flex items-center gap-3 px-3 py-2
                    rounded bg-zinc-900/40 border border-zinc-800/60">
                    <code className="text-[12px] font-mono text-amber-400 w-28 flex-shrink-0">
                      {m.type}
                    </code>
                    <span className="text-[11px] text-zinc-600 w-32 flex-shrink-0">{m.dir}</span>
                    <span className="text-[12px] text-zinc-400">{m.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <h3 className="text-[13px] font-semibold text-zinc-300 mb-3">Code Examples</h3>
              <TabbedCodeExample examples={WEBSOCKET_EXAMPLES} />
            </div>
          </Section>

          {/* ── CTA footer ──────────────────────────────────────────────── */}
          <div className="mt-4 mb-8 p-6 rounded-xl glass border border-amber-500/20 text-center">
            <h3 className="text-lg font-semibold text-zinc-100 mb-2">
              Ready to start building?
            </h3>
            <p className="text-[13px] text-zinc-400 mb-5">
              Generate your API key and start querying live global intelligence signals in minutes.
            </p>
            <Link
              href="/settings"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-semibold
                bg-amber-500 text-zinc-950 hover:bg-amber-400 transition-colors"
            >
              Get API Key
            </Link>
          </div>

        </main>
      </div>
    </div>
  )
}
