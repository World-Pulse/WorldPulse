'use client'

import { useState } from 'react'
import Link from 'next/link'
import { authHref } from '@/lib/auth-next'
import { Zap, Shield, Globe, Bot, MapPin, Unlock } from 'lucide-react'
import {
  API_BASE, LANGS, ENDPOINT_GROUPS, ACCESS_LABEL, getCodeExample,
  type Lang, type Endpoint,
} from './api-reference'

/** The MCP server's tools (apps/api/src/routes/mcp.ts) */
const MCP_TOOLS = [
  { name: 'top_stories', what: 'The stories the most outlets carry in the last 1 to 72 hours, optionally one country\'s' },
  { name: 'story', what: 'One story with every outlet and its reports, from a story or report id' },
  { name: 'search_reports', what: 'Reports about a subject, found by meaning' },
  { name: 'week', what: 'WorldPulse Week: a week\'s top stories and its busiest countries' },
  { name: 'check_link', what: 'An article\'s address: how many outlets reported its story, and which' },
]
const MCP_CURSOR = '{"mcpServers":{"worldpulse":{"url":"https://api.world-pulse.io/mcp"}}}'

/* ──────────────────────────────────────────────────────────────────────── *
 *  WorldPulse Developer Portal                                            *
 *  Showcases the public API, code examples, and integration guides.       *
 *  Competitive differentiator — no competitor offers an open public API.  *
 *  The endpoint list and examples are in ./api-reference.ts (plan V3c).   *
 * ──────────────────────────────────────────────────────────────────────── */

/** The code is MIT licensed (the hosted API's and data's terms aren't set here) */
const LICENSE_URL = 'https://github.com/World-Pulse/WorldPulse/blob/main/LICENSE'

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
        {endpoint.access === 'none' && (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex-shrink-0">
            FREE
          </span>
        )}
        {endpoint.access === 'signin' && (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20 flex-shrink-0">
            SIGN-IN
          </span>
        )}
        {endpoint.access === 'apikey' && (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-purple-500/10 text-purple-400 border border-purple-500/20 flex-shrink-0">
            API KEY
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

          <p className="text-[11px] text-wp-text3 mb-2 font-mono">
            Access: <span className="text-wp-text2">{ACCESS_LABEL[endpoint.access]}</span>
          </p>

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
  const [activeLang, setActiveLang] = useState<Lang>('curl')
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
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
            World stories with how many independent outlets reported each, from 1,000+ outlets a day: verified
            stories, reliability scores, places and AI briefings, through a simple REST API and an MCP server.
            The code is open source under the{' '}
            <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer" className="text-wp-cyan hover:underline">MIT license</a>.
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

      {/* API tiers (Oct 21, 2026): what the code does. Pro (Devon, 8:10 PM: $12 a month) gives a
          key its own budget (apps/api/src/lib/api-plan.ts); a free key counts like no key */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 border-b border-[rgba(255,255,255,0.07)]">
        <h2 className="font-display text-xl text-wp-text1 mb-6 tracking-wide">API ACCESS</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">FREE</span>
            </div>
            <h3 className="text-[16px] font-bold text-wp-text mb-1">Public</h3>
            <p className="text-[12px] text-wp-text3 mb-3">No key, no sign-up.</p>
            <ul className="space-y-1 text-[12px] text-wp-text3">
              <li>• Stories with their outlet counts, signals, search, feeds</li>
              <li>• RSS / Atom / JSON Feed, OPML</li>
              <li>• The MCP server for AI assistants</li>
              <li>• Up to 200 requests a minute (some endpoints fewer)</li>
            </ul>
          </div>
          <div className="bg-wp-surface border border-wp-amber/30 rounded-xl p-5 relative">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">FREE ACCOUNT</span>
            </div>
            <h3 className="text-[16px] font-bold text-wp-text mb-1">Signed in</h3>
            <p className="text-[12px] text-wp-text3 mb-3">The same limits, plus what needs an account.</p>
            <ul className="space-y-1 text-[12px] text-wp-text3">
              <li>• Everything in Public</li>
              <li>• Daily AI briefings and the following feed</li>
              <li>• Up to 10 webhooks</li>
              <li>• API keys for the STIX export</li>
            </ul>
          </div>
          <div className="bg-wp-surface border border-wp-cyan/40 rounded-xl p-5 relative shadow-[0_0_20px_rgba(0,212,255,0.06)]">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-wp-cyan/10 text-wp-cyan border border-wp-cyan/20">PRO · $12/MO</span>
            </div>
            <h3 className="text-[16px] font-bold text-wp-text mb-1">Pro</h3>
            <p className="text-[12px] text-wp-text3 mb-3">For using WorldPulse at work.</p>
            <ul className="space-y-1 text-[12px] text-wp-text3 mb-3">
              <li>• Everything in Signed in</li>
              <li>• A Pro key with its own budget: 600 requests a minute, 50,000 a day</li>
              <li>• Commercial use, with a link back</li>
              <li>• Priority support</li>
            </ul>
            <Link href="/pricing#pro" className="text-[12px] text-wp-cyan hover:underline">See Pro →</Link>
          </div>
        </div>
        <div className="mt-5 p-4 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] text-[13px] text-wp-text3 leading-relaxed">
          <span className="text-wp-text1 font-medium">Using the data.</span>{' '}
          Personal, research, education and non-profit use of the hosted API is free, with a link back to world-pulse.io.
          Commercial use, in your own work and products, comes with <Link href="/pricing#pro" className="text-wp-cyan hover:underline">Pro</Link>, with a link back.
          Reselling or redistributing the data needs a data license: email <span className="text-wp-cyan select-all">support@world-pulse.io</span>.
          The code is open source under the{' '}
          <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer" className="text-wp-cyan hover:underline">MIT license</a>.
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">

        {/* Quick Start */}
        <section className="mb-16">
          <h2 className="text-xl font-display text-wp-text1 tracking-wide mb-6">QUICK START</h2>

          <div className="grid gap-4 sm:grid-cols-3 mb-8">
            {([
              { step: '1', title: 'No signup needed', desc: 'Public endpoints work immediately. Just make a GET request.' },
              // Keys are made on /developer, which this page didn't link (plan V3c)
              { step: '2', title: 'Get an API key', desc: 'Register an account, then create a key on the API keys page. Keys open the STIX export; endpoints marked SIGN-IN take your sign-in token instead.', link: { href: '/developer', label: 'Create an API key →' } },
              { step: '3', title: 'Build something', desc: 'Dashboards, bots, alerts, research tools — the data is yours.' },
            ] as { step: string; title: string; desc: string; link?: { href: string; label: string } }[]).map(s => (
              <div key={s.step} className="p-4 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)]">
                <div className="w-8 h-8 rounded-full bg-wp-cyan/10 text-wp-cyan flex items-center justify-center font-mono text-[14px] font-bold mb-3">
                  {s.step}
                </div>
                <h3 className="text-[14px] font-medium text-wp-text1 mb-1">{s.title}</h3>
                <p className="text-[13px] text-wp-text3 leading-relaxed">{s.desc}</p>
                {s.link && (
                  <Link href={s.link.href} className="inline-block mt-2 text-[13px] text-wp-cyan hover:underline">
                    {s.link.label}
                  </Link>
                )}
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
              // ("50K+ sources" until Oct 13, 2026; ops-status counts about 1,000 outlets a day)
              { icon: Globe, title: '1,000+ Outlets a Day', desc: 'Wire services, OSINT feeds, GDELT, government databases, and community reports — deduplicated, with every report checked against the others.' },
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
            Base URL: <code className="text-wp-cyan font-mono">{API_BASE}</code> — Responses are JSON, most of them{' '}
            <code className="text-wp-cyan font-mono">{'{ success, data }'}</code> plus a list&apos;s paging fields (on{' '}
            <code className="text-wp-cyan font-mono">/public/signals</code>:{' '}
            <code className="text-wp-cyan font-mono">total</code>, <code className="text-wp-cyan font-mono">total_exact</code>,{' '}
            <code className="text-wp-cyan font-mono">limit</code> and <code className="text-wp-cyan font-mono">offset</code>).
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
                <p>
                  Most endpoints work without signing in. Endpoints marked SIGN-IN take the{' '}
                  <code className="text-wp-cyan font-mono">accessToken</code> that{' '}
                  <code className="text-wp-cyan font-mono">POST /api/v1/auth/login</code> answers inside{' '}
                  <code className="text-wp-cyan font-mono">data</code> (it lasts 24 hours):
                </p>
                <code className="block p-2 rounded bg-[rgba(0,0,0,0.3)] font-mono text-[12px] text-wp-cyan">
                  Authorization: Bearer {'<accessToken>'}
                </code>
                <p>
                  Endpoints marked API KEY (the STIX export) take a key from the{' '}
                  <Link href="/developer" className="text-wp-cyan hover:underline">API keys page</Link>, sent as{' '}
                  <code className="text-wp-cyan font-mono">X-Api-Key: {'<key>'}</code>. A key won&apos;t work in place of a sign-in token, or the other way round.
                </p>
              </div>
            </div>

            <div className="p-5 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)]">
              <h3 className="text-[14px] font-medium text-wp-text1 mb-3">Rate Limits</h3>
              <div className="space-y-2 text-[13px] text-wp-text3">
                <div className="flex justify-between gap-3">
                  <span>The whole API, per signed-in user or per address</span>
                  <span className="font-mono text-wp-amber whitespace-nowrap">200 req/min</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Most endpoints, each (listed with it above)</span>
                  <span className="font-mono text-wp-amber whitespace-nowrap">30–60 req/min</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Sign-in endpoints</span>
                  <span className="font-mono text-wp-amber whitespace-nowrap">5 req/min</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>A Pro key (<Link href="/pricing#pro" className="text-wp-cyan hover:underline">Pro</Link>), its own budget: the whole API, and each read endpoint up to 10× its limit</span>
                  <span className="font-mono text-wp-amber whitespace-nowrap">600 req/min</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>A Pro key, a day (resets at midnight UTC)</span>
                  <span className="font-mono text-wp-amber whitespace-nowrap">50,000 req</span>
                </div>
                <p className="text-[12px]">A free key counts like no key, and a sign-in doesn&apos;t raise the limits. Send a key as <code className="text-wp-cyan font-mono">X-Api-Key</code>.</p>
                <p className="text-[12px] mt-2 pt-2 border-t border-[rgba(255,255,255,0.05)]">
                  Rate limit headers (<code className="text-wp-cyan font-mono">X-RateLimit-Limit</code>,{' '}
                  <code className="text-wp-cyan font-mono">X-RateLimit-Remaining</code>) are included in every response.
                </p>
              </div>
            </div>

            {/* The one error body (plan V3f, lib/error-body.ts in the API) */}
            <div id="errors" className="sm:col-span-2 p-5 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)]">
              <h3 className="text-[14px] font-medium text-wp-text1 mb-3">Errors</h3>
              <div className="space-y-2 text-[13px] text-wp-text3 leading-relaxed">
                <p>Every error answers the same JSON, with the HTTP status:</p>
                <code className="block p-2 rounded bg-[rgba(0,0,0,0.3)] font-mono text-[12px] text-wp-cyan overflow-x-auto whitespace-pre">
                  {'{ "success": false, "code": "NOT_FOUND", "error": "Signal not found", "statusCode": 404 }'}
                </code>
                <p>
                  <code className="text-wp-cyan font-mono">code</code> is one word for the kind of error:{' '}
                  <span className="font-mono text-[12px]">BAD_REQUEST, VALIDATION_ERROR, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, RATE_LIMITED, INTERNAL_ERROR, UPSTREAM_ERROR, SERVICE_UNAVAILABLE</span>,
                  or an endpoint&apos;s own (such as <span className="font-mono text-[12px]">SOURCE_EXISTS</span>).{' '}
                  <code className="text-wp-cyan font-mono">error</code> says what went wrong, in words. Some errors carry more fields (a list of valid values, say).
                  The MCP server answers JSON-RPC errors instead.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* WebSocket */}
        <section className="mb-16">
          <h2 className="text-xl font-display text-wp-text1 tracking-wide mb-6">WEBSOCKET STREAMING</h2>
          <div className="p-5 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)]">
            {/* As apps/api/src/ws/handler.ts works (plan V3c): it doesn't reconnect
                clients, it drops those that don't answer its pings, and nothing
                sends signal.updated */}
            <p className="text-[13px] text-wp-text3 mb-4 leading-relaxed">
              Connect to <code className="text-wp-cyan font-mono">wss://api.world-pulse.io/ws</code> for real-time signal updates.
              Messages are JSON: <code className="text-wp-cyan font-mono">{'{ event, data, timestamp, id }'}</code>.
              The server sends a <code className="text-wp-cyan font-mono">ping</code> event every 30 seconds: answer each with{' '}
              <code className="text-wp-cyan font-mono">{'{"type":"pong"}'}</code>, or it closes the connection after 60 seconds without one.
              It doesn&apos;t reconnect for you: when the connection closes, open a new one after a short wait.
              To add channels, send <code className="text-wp-cyan font-mono">{'{"type":"subscribe","payload":{"channels":["all"]}}'}</code>.
            </p>
            <p className="text-[12px] font-mono text-wp-text3 uppercase tracking-wider mb-2">Event Types</p>
            <div className="space-y-1 text-[13px]">
              <div className="flex gap-3">
                <code className="text-wp-cyan font-mono min-w-[160px]">signal.new</code>
                <span className="text-wp-text3">A new report has been saved (it may not be verified yet)</span>
              </div>
              <div className="flex gap-3">
                <code className="text-wp-cyan font-mono min-w-[160px]">alert.breaking</code>
                <span className="text-wp-text3">A breaking news alert has been triggered</span>
              </div>
              <div className="flex gap-3">
                <code className="text-wp-cyan font-mono min-w-[160px]">trending.update</code>
                <span className="text-wp-text3">The trending topics have been updated</span>
              </div>
              <div className="flex gap-3">
                <code className="text-wp-cyan font-mono min-w-[160px]">post.new</code>
                <span className="text-wp-text3">A new feed post (subscribe to &quot;all&quot; to get every one)</span>
              </div>
              <div className="flex gap-3">
                <code className="text-wp-cyan font-mono min-w-[160px]">ping</code>
                <span className="text-wp-text3">The server&apos;s heartbeat: answer it with a pong</span>
              </div>
            </div>
          </div>
        </section>

        {/* MCP (plan 15, Oct 20, 2026): apps/api/src/routes/mcp.ts */}
        <section id="mcp" className="mb-16">
          <h2 className="text-xl font-display text-wp-text1 tracking-wide mb-6">AI ASSISTANTS (MCP)</h2>
          <div className="p-5 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)]">
            <p className="text-[13px] text-wp-text3 mb-4 leading-relaxed">
              AI assistants can ask WorldPulse directly. Its MCP server (MCP is the protocol assistants such as Claude use to call
              outside tools) is at <code className="text-wp-cyan font-mono">https://api.world-pulse.io/mcp</code>: no sign-up, no key,
              read-only. Every answer gives the outlet count, whether the story is verified and its world-pulse.io link, as text and as
              structured data. It allows 60 requests a minute per address, and each tool call counts as a call to the route it asks.
            </p>
            <p className="text-[12px] font-mono text-wp-text3 uppercase tracking-wider mb-2">Tools</p>
            <div className="space-y-1 text-[13px] mb-5">
              {MCP_TOOLS.map(t => (
                <div key={t.name} className="flex gap-3">
                  <code className="text-wp-cyan font-mono min-w-[160px]">{t.name}</code>
                  <span className="text-wp-text3">{t.what}</span>
                </div>
              ))}
            </div>
            <p className="text-[12px] font-mono text-wp-text3 uppercase tracking-wider mb-2">Connect</p>
            <div className="space-y-2 text-[13px] text-wp-text3">
              <p>Claude: Customize, Connectors, &ldquo;+ Add&rdquo;, &ldquo;Add custom connector&rdquo;; paste the address above and choose no sign-in. Then turn WorldPulse on in a chat (&ldquo;+&rdquo;, Connectors). Free accounts can add one custom connector.</p>
              <p>Claude Code: <code className="text-wp-cyan font-mono break-all">claude mcp add --transport http worldpulse https://api.world-pulse.io/mcp</code></p>
              <p>Cursor, in <code className="text-wp-cyan font-mono">.cursor/mcp.json</code>: <code className="text-wp-cyan font-mono break-all">{MCP_CURSOR}</code></p>
            </div>
          </div>
        </section>

        {/* Plans (Oct 21, 2026, 8:10 PM; Devon: Pro at $12 a month; checkout opens on /pricing) */}
        <section className="mb-16">
          <h2 className="text-xl font-display text-wp-text1 tracking-wide mb-2">PLANS</h2>
          <p className="text-[14px] text-wp-text3 mb-6">Everything here is free. Pro is for using WorldPulse at work.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
            <div className="rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] p-6 flex flex-col">
              <p className="text-[10px] font-mono font-semibold text-wp-text3 uppercase tracking-widest mb-2">Free</p>
              <p className="text-4xl font-bold text-wp-text mb-4">$0</p>
              <ul className="space-y-2 mb-6 flex-1 text-[13px] text-wp-text3">
                {['The public API, feeds and MCP server, no key', 'Up to 200 requests a minute', 'Up to 10 webhooks (free account)', 'Alerts on what you follow', 'RSS / JSON Feed export'].map(f => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="text-emerald-400 mt-0.5 flex-shrink-0">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={authHref('register', '/developers')}
                className="block w-full text-center rounded-lg border border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] text-wp-text font-semibold py-2.5 text-[14px] transition-colors"
              >
                Create a free account
              </Link>
            </div>
            <div className="rounded-xl border-2 border-wp-cyan/50 bg-wp-cyan/5 p-6 flex flex-col shadow-[0_0_30px_rgba(0,212,255,0.07)]">
              <p className="text-[10px] font-mono font-semibold text-wp-cyan/80 uppercase tracking-widest mb-2">Pro</p>
              <p className="text-4xl font-bold text-wp-text mb-4">$12 <span className="text-[14px] font-normal text-wp-text3">a month</span></p>
              <ul className="space-y-2 mb-6 flex-1 text-[13px] text-wp-text3">
                {['Everything in Free', 'A Pro API key with its own budget: 600 requests a minute, 50,000 a day', 'Commercial use of the API and data, with a link back', 'Priority support by email'].map(f => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="text-wp-cyan mt-0.5 flex-shrink-0">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/pricing#pro"
                className="block w-full text-center rounded-lg bg-wp-cyan hover:bg-wp-cyan/90 text-black font-semibold py-2.5 text-[14px] transition-colors"
              >
                See Pro
              </Link>
            </div>
          </div>
        </section>

        {/* Footer CTA */}
        <section className="text-center py-12 border-t border-[rgba(255,255,255,0.07)]">
          <h2 className="text-2xl font-display text-wp-text1 tracking-wide mb-3">READY TO BUILD?</h2>
          <p className="text-[14px] text-wp-text3 mb-6 max-w-lg mx-auto">
            WorldPulse&apos;s code is open source under the{' '}
            <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer" className="text-wp-cyan hover:underline">MIT license</a>.
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
