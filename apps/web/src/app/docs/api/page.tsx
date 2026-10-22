'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import {
  API_ORIGIN, INTERACTIVE_DOCS_URL, KEY_PREFIX, API_KEY_HEADER, SIGN_IN_REQUIRED, BAD_TOKEN,
  API_KEY_ENDPOINTS, SIGN_IN_ENDPOINTS, KEY_TIERS,
  DEFAULT_PER_MINUTE, ROUTE_LIMITS, PRO_KEY_BUDGET, RATE_LIMIT_HEADERS,
  PUBLIC_SIGNALS_PARAMS, OTHER_OPEN_ENDPOINTS, PUBLIC_SIGNALS_RESPONSE,
  MCP_URL, MCP_TOOLS, MCP_GUIDE, MCP_EXAMPLE,
  WEBHOOK_ENDPOINTS, MAX_WEBHOOKS, WEBHOOK_EVENTS, WEBHOOK_BODY_FIELDS, WEBHOOK_FILTERS,
  WEBHOOK_HEADERS, WEBHOOK_DELIVERY,
  WS_URL, WS_EVENTS, WS_CLIENT_MESSAGES,
  PUBLIC_SIGNALS_EXAMPLES, WEBHOOK_EXAMPLES, WEBHOOK_VERIFY_EXAMPLES, WEBSOCKET_EXAMPLES,
  type Tab, type CodeExample, type EndpointInfo,
} from './reference'

// The page's facts (paths, headers, limits, examples) are in ./reference.ts,
// checked against apps/api by src/__tests__/docs-api.test.tsx (plan V3i)

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

const TAB_LABELS: Record<Tab, string> = { curl: 'cURL', typescript: 'TypeScript', python: 'Python' }

function TabbedCodeExample({ examples }: { examples: CodeExample }) {
  const tabs = (Object.keys(TAB_LABELS) as Tab[]).filter(t => examples[t] !== undefined)
  const [tab, setTab] = useState<Tab>(tabs[0] ?? 'curl')
  const code = examples[tab] ?? ''

  return (
    <div className="rounded-lg overflow-hidden border border-zinc-800">
      {/* Tab bar */}
      <div className="flex bg-zinc-900 border-b border-zinc-800">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-[12px] font-mono transition-all
              ${tab === t
                ? 'text-amber-400 border-b-2 border-amber-500 bg-zinc-950'
                : 'text-zinc-500 hover:text-zinc-300'
              }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      {/* Code */}
      <div className="relative">
        <CopyButton text={code} />
        <pre
          className="bg-zinc-950 p-4 overflow-x-auto text-[12.5px] leading-relaxed
            font-mono text-zinc-300 pr-16 min-h-[120px]"
        >
          <code>{code.trim()}</code>
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

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[13px] font-semibold text-zinc-300 mb-3">{children}</h3>
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-amber-400 text-[12px]">{children}</code>
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

function EndpointRow({ method, path, description }: EndpointInfo) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-zinc-800/60 last:border-0">
      <MethodBadge method={method} />
      <div>
        <code className="text-[13px] font-mono text-zinc-200">{`${method} ${path}`}</code>
        <p className="text-[12px] text-zinc-500 mt-0.5">{description}</p>
      </div>
    </div>
  )
}

function EndpointList({ endpoints }: { endpoints: EndpointInfo[] }) {
  return (
    <div className="rounded-lg border border-zinc-800 px-4">
      {endpoints.map(ep => <EndpointRow key={`${ep.method} ${ep.path}`} {...ep} />)}
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
      <td className="py-2.5 px-3">
        <code className="text-[12.5px] font-mono text-amber-400">{name}</code>
        {required && (
          <span className="ml-1.5 text-[10px] text-red-400 font-medium">required</span>
        )}
      </td>
      <td className="py-2.5 px-3">
        <code className="text-[12px] text-zinc-400">{type}</code>
      </td>
      <td className="py-2.5 px-3 text-[12px] text-zinc-500">{description}</td>
    </tr>
  )
}

function ParamTable({ first, rows }: {
  first: string
  rows: { name: string; type: string; required?: boolean; description: string }[]
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-zinc-900 border-b border-zinc-800">
            <th className="text-left px-3 py-2 text-zinc-500 font-medium">{first}</th>
            <th className="text-left px-3 py-2 text-zinc-500 font-medium">Type</th>
            <th className="text-left px-3 py-2 text-zinc-500 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => <ParamRow key={r.name} {...r} />)}
        </tbody>
      </table>
    </div>
  )
}

function NameList({ items }: { items: { name: string; description: string }[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {items.map(i => (
        <div key={i.name} className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
          <code className="text-[12px] font-mono text-amber-400 break-all">{i.name}</code>
          <p className="text-[12px] text-zinc-500 mt-0.5">{i.description}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Nav items ────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'authentication', label: 'Authentication' },
  { id: 'rate-limits', label: 'Rate Limits' },
  { id: 'public-endpoints', label: 'Open Endpoints' },
  { id: 'mcp', label: 'AI Assistants (MCP)' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'websocket', label: 'WebSocket' },
]

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ApiDocsPage() {
  const [activeSection, setActiveSection] = useState('authentication')

  const scrollToSection = (id: string) => {
    setActiveSection(id)
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth' })
  }

  const baseUrl = `${process.env.NEXT_PUBLIC_API_URL || API_ORIGIN}/api/v1`

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
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-zinc-100 mb-3 tracking-tight">
            WorldPulse Developer API
          </h1>
          <p className="text-lg text-zinc-400 max-w-2xl mb-8">
            Sign-in tokens and API keys, rate limits, the MCP server, webhooks and the WebSocket
            stream, as the API handles them. Every endpoint, with what it needs and its own limit, is
            in the{' '}
            <a href={INTERACTIVE_DOCS_URL} className="text-amber-400 hover:text-amber-300 underline underline-offset-2">
              interactive docs
            </a>. The{' '}
            <Link href="/developers" className="text-amber-400 hover:text-amber-300 underline underline-offset-2">
              developer page
            </Link>{' '}
            has guides and examples.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/developer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium
                bg-amber-500 text-zinc-950 hover:bg-amber-400 transition-colors text-[14px]"
            >
              Get API Key
            </Link>
            <a
              href={INTERACTIVE_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium
                border border-zinc-700 text-zinc-300 hover:border-amber-500/50 transition-colors text-[14px]"
            >
              Interactive docs
            </a>
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
            <div className="mt-8 pt-6 border-t border-zinc-800 space-y-2">
              <Link
                href="/developer"
                className="block text-center px-3 py-2 rounded-lg text-[12px] font-medium
                  bg-amber-500/10 text-amber-400 border border-amber-500/20
                  hover:bg-amber-500/20 transition-colors"
              >
                Get API Key →
              </Link>
              <a
                href={INTERACTIVE_DOCS_URL}
                className="block text-center px-3 py-2 rounded-lg text-[12px] font-medium
                  text-zinc-400 border border-zinc-800 hover:text-zinc-200 transition-colors"
              >
                All endpoints →
              </a>
            </div>
          </nav>
        </aside>

        {/* ── Main content ───────────────────────────────────────────── */}
        <main className="flex-1 min-w-0">

          {/* ── Authentication ───────────────────────────────────────── */}
          <Section id="authentication" title="Authentication">
            <p className="text-[13px] text-zinc-400 mb-6">
              Most endpoints are open: no sign-in or key needed. The others take one of two
              credentials, and neither works in place of the other.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-zinc-900/50 border border-zinc-800">
                <h3 className="text-[14px] font-semibold text-zinc-200 mb-2">Sign-in token</h3>
                <p className="text-[12px] text-zinc-500 mb-3">
                  From any free account: <InlineCode>POST /api/v1/auth/login</InlineCode> answers it
                  as <InlineCode>data.accessToken</InlineCode>. It lasts 24 hours. For a new one, send
                  the answer&apos;s <InlineCode>data.refreshToken</InlineCode> to{' '}
                  <InlineCode>POST /api/v1/auth/refresh</InlineCode> (a refresh token lasts 30 days and
                  works once).
                </p>
                <CodeBlock language="http" code="Authorization: Bearer <accessToken>" />
                <p className="text-[12px] text-zinc-500 mt-3">
                  Without a token, an endpoint that needs one answers 401{' '}
                  <InlineCode>{SIGN_IN_REQUIRED}</InlineCode>. With an invalid or expired one, it
                  answers 401 <InlineCode>{BAD_TOKEN}</InlineCode>. (<InlineCode>GET /api/v1/auth/me</InlineCode>{' '}
                  answers just <InlineCode>Unauthorized</InlineCode>.)
                </p>
              </div>
              <div className="p-4 rounded-lg bg-zinc-900/50 border border-zinc-800">
                <h3 className="text-[14px] font-semibold text-zinc-200 mb-2">API key</h3>
                <p className="text-[12px] text-zinc-500 mb-3">
                  Made on the <Link href="/developer" className="text-amber-400 hover:text-amber-300">API keys page</Link> and
                  shown once. Every key starts with <InlineCode>{KEY_PREFIX}</InlineCode>, whatever its tier.{' '}
                  <InlineCode>{`Authorization: Bearer ${KEY_PREFIX}…`}</InlineCode> works too.
                </p>
                <CodeBlock language="http" code={`${API_KEY_HEADER}: ${KEY_PREFIX}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`} />
                <p className="text-[12px] text-zinc-500 mt-3">
                  Without a valid key, an endpoint that takes one answers 401.
                </p>
              </div>
            </div>

            <div className="mt-6">
              <SubHeading>Endpoints that take an API key</SubHeading>
              <EndpointList endpoints={API_KEY_ENDPOINTS} />
            </div>

            <div className="mt-6">
              <SubHeading>Some of the endpoints that take a sign-in token</SubHeading>
              <EndpointList endpoints={SIGN_IN_ENDPOINTS} />
              <p className="mt-2 text-[12px] text-zinc-500">
                The <a href={INTERACTIVE_DOCS_URL} className="text-amber-400 hover:text-amber-300">interactive docs</a> mark
                every endpoint that needs one.
              </p>
            </div>

            <div className="mt-6">
              <SubHeading>API key tiers</SubHeading>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {KEY_TIERS.map((t) => (
                  <div key={t.tier} className="p-4 rounded-lg bg-zinc-900/50 border border-zinc-800">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded text-zinc-300 bg-zinc-800">
                      {t.tier}
                    </span>
                    <code className="block mt-2 mb-1 text-[12px] font-mono text-zinc-400">
                      {KEY_PREFIX}•••
                    </code>
                    <p className="text-[12px] text-zinc-500">{t.who}. {t.opens}.</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-[12px] text-amber-300/80">
              <strong className="font-semibold">Note:</strong> Never expose API keys or sign-in tokens in
              client-side code or public repositories. Use environment variables on your server.
            </div>
          </Section>

          {/* ── Rate Limits ─────────────────────────────────────────────── */}
          <Section id="rate-limits" title="Rate Limits">
            <p className="text-[13px] text-zinc-400 mb-3">
              Requests are counted per client address, whatever credential they carry, except a Pro
              API key&apos;s (below). Endpoints
              without a limit of their own share one budget: {DEFAULT_PER_MINUTE} requests a minute.
              Many endpoints have a limit of their own, counted for that endpoint alone. Here are some;
              the <a href={INTERACTIVE_DOCS_URL} className="text-amber-400 hover:text-amber-300">interactive docs</a> give
              each endpoint&apos;s own limit.
            </p>
            <p className="text-[13px] text-zinc-400 mb-6">
              Past a limit the API answers <InlineCode>429 Too Many Requests</InlineCode> with the code{' '}
              <InlineCode>RATE_LIMITED</InlineCode> and a{' '}
              <code className="font-mono text-zinc-300 text-[12px]">Retry-After</code> header.
            </p>

            <div className="overflow-x-auto rounded-lg border border-zinc-800">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-zinc-900 border-b border-zinc-800">
                    <th className="text-left px-4 py-3 text-zinc-400 font-medium">Endpoint</th>
                    <th className="text-left px-4 py-3 text-zinc-400 font-medium">Requests / min</th>
                  </tr>
                </thead>
                <tbody>
                  {ROUTE_LIMITS.map(r => (
                    <tr key={`${r.method} ${r.path}`} className="border-b border-zinc-800/60">
                      <td className="px-4 py-2.5 font-mono text-[12px] text-zinc-300">{`${r.method} ${r.path}`}</td>
                      <td className="px-4 py-2.5 font-mono text-zinc-400">{r.perMinute}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="px-4 py-2.5 text-zinc-300">Every endpoint without a limit of its own (one budget, shared)</td>
                    <td className="px-4 py-2.5 font-mono text-zinc-400">{DEFAULT_PER_MINUTE}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-[12px] text-zinc-500">
              A Pro API key (<a href="https://world-pulse.io/pricing" className="text-amber-400 hover:text-amber-300">WorldPulse Pro</a>, $12 a month),
              sent as <InlineCode>X-Api-Key</InlineCode>, counts in its own budget:{' '}
              {PRO_KEY_BUDGET.perMinute} requests a minute across the API, each read endpoint up to{' '}
              {PRO_KEY_BUDGET.routeMultiplier} times its own limit (at most {PRO_KEY_BUDGET.perMinute}), and{' '}
              {PRO_KEY_BUDGET.perDay.toLocaleString('en-US')} a day (it starts again at midnight UTC). A free key counts like no key.
            </p>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {RATE_LIMIT_HEADERS.map((h) => (
                <div key={h.header} className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
                  <code className="text-[12px] font-mono text-amber-400">{h.header}</code>
                  <p className="text-[12px] text-zinc-500 mt-0.5">{h.description}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Open Endpoints ───────────────────────────────────────────── */}
          <Section id="public-endpoints" title="Open Endpoints">
            <p className="text-[13px] text-zinc-400 mb-3">
              These need no sign-in or key. CORS only limits web pages: a server or an app can call
              any endpoint, but a web page on another site can read only these from the visitor&apos;s
              browser: the reads (GET) under <InlineCode>/api/v1/public</InlineCode>, <InlineCode>/signals</InlineCode>,{' '}
              <InlineCode>/stories</InlineCode>, <InlineCode>/countries</InlineCode>,{' '}
              <InlineCode>/search</InlineCode> and <InlineCode>/rss</InlineCode>, the global and trending
              feeds, the WebSocket and the MCP server.
            </p>
            <p className="text-[13px] text-zinc-400 mb-6">
              <InlineCode>/public/signals</InlineCode> answers from its 30-second cache carry{' '}
              <InlineCode>X-Cache-Hit: true</InlineCode>.
            </p>

            {/* GET /public/signals */}
            <div className="mb-8">
              <EndpointRow
                method="GET"
                path="/api/v1/public/signals"
                description="Verified signals, newest first. reliability_score is a number from 0 to 1; total counts every match, an estimate while total_exact is false."
              />

              <div className="mt-5">
                <SubHeading>Query Parameters</SubHeading>
                <ParamTable first="Parameter" rows={PUBLIC_SIGNALS_PARAMS} />
              </div>

              <div className="mt-5">
                <SubHeading>Response Shape</SubHeading>
                <CodeBlock language="json" code={PUBLIC_SIGNALS_RESPONSE} />
              </div>

              <div className="mt-5">
                <SubHeading>Code Examples</SubHeading>
                <TabbedCodeExample examples={PUBLIC_SIGNALS_EXAMPLES} />
              </div>
            </div>

            <div>
              <SubHeading>Also open</SubHeading>
              <EndpointList endpoints={OTHER_OPEN_ENDPOINTS} />
            </div>
          </Section>

          {/* ── MCP server (apps/api/src/routes/mcp.ts) ─────────────────── */}
          <Section id="mcp" title="AI Assistants (MCP)">
            <p className="text-[13px] text-zinc-400 mb-4">
              An MCP server (Model Context Protocol) lets AI assistants such as Claude ask WorldPulse.
              It is open like the endpoints above: no sign-in or key, and it only reads. It is not
              under <InlineCode>/api/v1</InlineCode>.
            </p>

            <div className="flex items-center gap-3 p-3 mb-4 rounded-lg bg-zinc-900/60 border border-zinc-800">
              <MethodBadge method="POST" />
              <code className="text-[13px] font-mono text-zinc-200 break-all">{MCP_URL}</code>
            </div>

            <p className="text-[12px] text-zinc-500 mb-4">
              Each POST carries one JSON-RPC 2.0 message, or a batch of up to 20. Its tools:{' '}
              {MCP_TOOLS.map((t, i) => (
                <span key={t}>{i > 0 && (i === MCP_TOOLS.length - 1 ? ' and ' : ', ')}<InlineCode>{t}</InlineCode></span>
              ))}. Each tool asks the API&apos;s own open endpoints (the top stories, one story, search by
              meaning, the week, and the story of a news link), and those calls count against your limits
              on them too. How to connect Claude, Claude Code or Cursor is on the{' '}
              <Link href={MCP_GUIDE} className="text-amber-400 hover:text-amber-300">developer page</Link>.
            </p>

            <CodeBlock language="bash" code={MCP_EXAMPLE} />
          </Section>

          {/* ── Webhooks ──────────────────────────────────────────────────── */}
          <Section id="webhooks" title="Webhooks">
            <p className="text-[13px] text-zinc-400 mb-6">
              Register a URL and WorldPulse POSTs to it when a new signal is saved or a breaking
              alert fires. Webhooks are managed with a sign-in token (not an API key), up to{' '}
              {MAX_WEBHOOKS} active per account (registering one more answers 429). Each delivery is
              signed with the webhook&apos;s secret in the <InlineCode>X-WorldPulse-Signature</InlineCode> header.
            </p>

            <EndpointList endpoints={WEBHOOK_ENDPOINTS} />

            <div className="mt-5">
              <SubHeading>Registering</SubHeading>
              <ParamTable first="Field" rows={WEBHOOK_BODY_FIELDS} />
            </div>

            <div className="mt-5">
              <SubHeading>Events</SubHeading>
              <NameList items={WEBHOOK_EVENTS.map(e => ({ name: e.event, description: e.description }))} />
              <p className="mt-2 text-[12px] text-zinc-500">
                <InlineCode>signal.updated</InlineCode> is accepted when registering, but nothing sends it yet.
              </p>
            </div>

            <div className="mt-5">
              <SubHeading>Filters</SubHeading>
              <ParamTable first="Field" rows={WEBHOOK_FILTERS} />
              <p className="mt-2 text-[12px] text-zinc-500">
                A delivery is sent only when the event&apos;s data matches every filter you set.
              </p>
            </div>

            <div className="mt-5">
              <SubHeading>Code Examples</SubHeading>
              <TabbedCodeExample examples={WEBHOOK_EXAMPLES} />
            </div>

            <div className="mt-5">
              <SubHeading>Each delivery</SubHeading>
              <p className="text-[12px] text-zinc-500 mb-3">
                A POST with a JSON body: the event and its data (for <InlineCode>alert.breaking</InlineCode>,
                the alert: alertId, signalId, title, severity, category, locationName, countryCode,
                sourceUrl, timestamp, expiresAt). WorldPulse waits up to 10 seconds for your server
                and doesn&apos;t retry; the deliveries endpoint shows how each one went.
              </p>
              <NameList items={WEBHOOK_HEADERS.map(h => ({ name: h.header, description: h.description }))} />
              <div className="mt-3">
                <CodeBlock language="json" code={WEBHOOK_DELIVERY} />
              </div>
            </div>

            <div className="mt-5">
              <SubHeading>Checking the signature</SubHeading>
              <TabbedCodeExample examples={WEBHOOK_VERIFY_EXAMPLES} />
            </div>
          </Section>

          {/* ── WebSocket ────────────────────────────────────────────────── */}
          <Section id="websocket" title="WebSocket">
            <p className="text-[13px] text-zinc-400 mb-4">
              A live stream of new signals and alerts without polling. No sign-in needed (API keys
              aren&apos;t read here). Messages are JSON:{' '}
              <InlineCode>{'{ event, data, timestamp, id }'}</InlineCode>; the server&apos;s pings carry
              only <InlineCode>event</InlineCode> and <InlineCode>data</InlineCode>. The server doesn&apos;t
              reconnect for you: when the connection closes, open a new one after a short wait.
            </p>

            <div className="flex items-center gap-3 p-3 mb-6 rounded-lg bg-zinc-900/60
              border border-cyan-500/20">
              <MethodBadge method="WS" />
              <code className="text-[13px] font-mono text-zinc-200">{WS_URL}</code>
            </div>

            <div className="mt-5">
              <SubHeading>Events</SubHeading>
              <div className="space-y-2">
                {WS_EVENTS.map((m) => (
                  <div key={m.event} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-3 py-2
                    rounded bg-zinc-900/40 border border-zinc-800/60">
                    <code className="text-[12px] font-mono text-amber-400 sm:w-32 flex-shrink-0">{m.event}</code>
                    <span className="text-[12px] text-zinc-400 flex-1">{m.description}</span>
                    <span className="text-[11px] text-zinc-600 sm:w-56 flex-shrink-0">{m.reaches}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <SubHeading>What you can send</SubHeading>
              <NameList items={WS_CLIENT_MESSAGES.map(m => ({ name: m.message, description: m.description }))} />
            </div>

            <div className="mt-5">
              <SubHeading>Code Examples</SubHeading>
              <TabbedCodeExample examples={WEBSOCKET_EXAMPLES} />
            </div>
          </Section>

          {/* ── CTA footer ──────────────────────────────────────────────── */}
          <div className="mt-4 mb-8 p-6 rounded-xl glass border border-amber-500/20 text-center">
            <h3 className="text-lg font-semibold text-zinc-100 mb-2">
              Ready to start building?
            </h3>
            <p className="text-[13px] text-zinc-400 mb-5">
              The open endpoints work right away. Make an API key for the STIX export and the
              content-farm checks.
            </p>
            <Link
              href="/developer"
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
