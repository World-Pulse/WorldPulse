/**
 * /docs/api says what the API does (plan V3i, Oct 20, 2026). It sent
 * webhooks to POST /developer/webhooks (they are under
 * /api/v1/developer/keys/webhooks), gave API keys three prefixes (wp_free_,
 * wp_live_, wp_ent_; every key starts with wp_live_), said limits were
 * enforced per API key (they are counted per client address), and showed a
 * signature header, filters and WebSocket messages the API doesn't use. The
 * page is rendered here, and its facts (./app/docs/api/reference.ts) are
 * checked against the API's own source (apps/api/src: the prefixes in
 * index.ts, the routes and their checks and limits, the CORS policy, the MCP
 * server). No network.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ApiDocsPage from '../app/docs/api/page'
import {
  API_ORIGIN, INTERACTIVE_DOCS_URL, KEY_PREFIX, API_KEY_HEADER, SIGN_IN_REQUIRED, BAD_TOKEN,
  API_KEY_ENDPOINTS, SIGN_IN_ENDPOINTS,
  DEFAULT_PER_MINUTE, ROUTE_LIMITS, PRO_KEY_BUDGET, RATE_LIMIT_HEADERS, CORS_OPEN_PREFIXES,
  PUBLIC_SIGNALS_PARAMS, OTHER_OPEN_ENDPOINTS, PUBLIC_SIGNALS_RESPONSE,
  MCP_URL, MCP_TOOLS, MCP_GUIDE, MCP_EXAMPLE,
  WEBHOOKS_PATH, WEBHOOK_ENDPOINTS, MAX_WEBHOOKS, WEBHOOK_EVENTS, WEBHOOK_FILTERS,
  WEBHOOK_HEADERS, WEBHOOK_DELIVERY, WS_EVENTS, WS_CLIENT_MESSAGES,
  PUBLIC_SIGNALS_EXAMPLES, WEBHOOK_EXAMPLES, WEBHOOK_VERIFY_EXAMPLES, WEBSOCKET_EXAMPLES,
} from '../app/docs/api/reference'

const APPS = join(__dirname, '..', '..', '..')
const API_SRC = join(APPS, 'api', 'src')
const api = (file: string) => readFileSync(join(API_SRC, file), 'utf8')

// ─── The API's routes, read from its source ─────────────────────────────────

type Access = 'none' | 'signin' | 'apikey'
interface Route { method: string; path: string; access: Access; perMinute: number | null }

const ROUTE_CALL = /\bapp\.(get|post|put|patch|delete)\b/g

/** Each app.get('/path', { …options… }, handler) in a route file */
function routesIn(source: string): Route[] {
  const out: Route[] = []
  for (const m of source.matchAll(ROUTE_CALL)) {
    let i = (m.index ?? 0) + m[0].length
    const skipSpace = () => { while (i < source.length && /\s/.test(source[i])) i++ }
    skipSpace()
    if (source[i] === '<') {
      // a type argument, e.g. app.get<{ Params: { id: string } }>(
      let depth = 0
      for (; i < source.length; i++) {
        if (source[i] === '<') depth++
        else if (source[i] === '>' && source[i - 1] !== '=' && --depth === 0) { i++; break }
      }
      skipSpace()
    }
    if (source[i] !== '(') continue
    i++
    skipSpace()
    const quote = source[i]
    if (quote !== "'" && quote !== '"' && quote !== '`') continue
    const end = source.indexOf(quote, i + 1)
    if (end < 0) continue
    // the options sit between the path and the handler (or the next route)
    const rest = source.slice(end + 1)
    const stop = rest.search(/\basync\s*(?:\(|function\b)|\bapp\.(?:get|post|put|patch|delete)\b/)
    const options = stop < 0 ? rest : rest.slice(0, stop)
    const access: Access = /\b(?:apiKeyAuth|authenticateApiKey)\b/.test(options) ? 'apikey'
      : /\bauthenticate\b/.test(options) ? 'signin' : 'none'
    const limit = options.match(/rateLimit:\s*\{\s*max:\s*(\d+)/)
    out.push({ method: m[1].toUpperCase(), path: source.slice(i + 1, end), access, perMinute: limit ? Number(limit[1]) : null })
  }
  return out
}

/** Route module ('./routes/feed') → the prefixes index.ts registers it under */
function registeredModules(): Map<string, string[]> {
  const index = api('index.ts')
  const moduleOf = new Map<string, string>()
  for (const m of index.matchAll(/import\s+(?:\{([^}]*)\}|(\w+))\s+from\s+'(\.\/(?:routes|ws)\/[^']+)'/g)) {
    const names = m[1]
      ? m[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop()?.trim() ?? '').filter(Boolean)
      : [m[2]]
    for (const name of names) moduleOf.set(name, m[3])
  }
  const prefixes = new Map<string, string[]>()
  for (const m of index.matchAll(/app\.register\(\s*(\w+)\s*(?:,\s*\{\s*prefix:\s*'([^']*)'\s*\})?\s*\)/g)) {
    const mod = moduleOf.get(m[1])
    if (mod) prefixes.set(mod, [...(prefixes.get(mod) ?? []), m[2] ?? ''])
  }
  return prefixes
}

const API_ROUTES: Route[] = [...registeredModules()].flatMap(([mod, prefixes]) => {
  const file = [`${mod}.ts`, `${mod}/index.ts`].map(f => join(API_SRC, f)).find(f => existsSync(f))
  if (!file) return []
  return routesIn(readFileSync(file, 'utf8')).flatMap(route => prefixes.map(prefix => ({
    ...route,
    path: route.path === '/' && prefix ? prefix : prefix + route.path,
  })))
})

function route(method: string, path: string): Route | undefined {
  return API_ROUTES.find(r => r.method === method && r.path === path)
}

// ─── The page ────────────────────────────────────────────────────────────────

const HTML = renderToStaticMarkup(<ApiDocsPage />)
/** The page's words, as a reader sees them */
const TEXT = HTML.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
const EXAMPLES = [PUBLIC_SIGNALS_EXAMPLES, WEBHOOK_EXAMPLES, WEBHOOK_VERIFY_EXAMPLES, WEBSOCKET_EXAMPLES]
  .flatMap(e => Object.values(e)).join('\n')

describe('the route table this test reads', () => {
  it('finds the API\'s routes', () => {
    expect(API_ROUTES.length).toBeGreaterThan(100)
    expect(route('GET', '/api/v1/public/signals')).toMatchObject({ access: 'none', perMinute: 60 })
    expect(route('GET', '/api/v1/stix/signals/:id')).toMatchObject({ access: 'apikey' })
    expect(route('POST', WEBHOOKS_PATH)).toMatchObject({ access: 'signin' })
    expect(route('POST', '/mcp')).toMatchObject({ access: 'none', perMinute: 60 })
  })
})

describe('/docs/api page', () => {
  it('renders its sections', () => {
    expect(HTML).toContain('WorldPulse Developer API</h1>')
    for (const id of ['authentication', 'rate-limits', 'public-endpoints', 'mcp', 'webhooks', 'websocket']) {
      expect(HTML).toContain(`id="${id}"`)
    }
    expect(HTML).toContain('aria-label="Copy code to clipboard"')
    expect(HTML).toContain('cURL')
  })

  it('sends readers for a key to the API keys page (/developer) and links the developer page', () => {
    expect(HTML).not.toContain('href="/settings"')
    expect(HTML.match(/href="\/developer"/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    expect(HTML).toContain('href="/developers"')
    expect(existsSync(join(__dirname, '..', 'app', 'developer', 'page.tsx'))).toBe(true)
    expect(existsSync(join(__dirname, '..', 'app', 'developers', 'page.tsx'))).toBe(true)
  })

  it('sends readers for every endpoint to the interactive docs, which the API serves at /api/docs', () => {
    // the developer page lists a few dozen endpoints, not all of them
    expect(TEXT).not.toMatch(/Every endpoint, with what it needs and its limit, is on the developer page/)
    expect(TEXT).toMatch(/Every endpoint, with what it needs and its own limit, is in the interactive docs/)
    expect(HTML).toMatch(new RegExp(`<a href="${INTERACTIVE_DOCS_URL}"[^>]*>All endpoints →</a>`))
    expect(INTERACTIVE_DOCS_URL).toBe(`${API_ORIGIN}/api/docs`)
    expect(api('index.ts')).toMatch(/app\.register\(swaggerUI, \{\s*routePrefix: '\/api\/docs'/)
    // where the API marks each operation's credential and states its own limit
    const docs = api('lib/api-docs.ts')
    expect(docs).toContain('export const docsTransform')
    expect(docs).toMatch(/out\.description = `\$\{own\}\$\{rateLimitNote\(limit\)\}`/)
  })

  it('no longer shows the prefixes, paths, headers, limits and messages the API doesn\'t have', () => {
    const all = `${HTML}\n${EXAMPLES}`
    expect(all).not.toMatch(/wp_free_|wp_ent_/)
    expect(all).not.toMatch(/\/developer\/webhooks/)
    expect(all).not.toContain('X-WP-Signature')
    expect(all).not.toMatch(/enforced per API key/i)
    expect(all).not.toMatch(/signals:global|alerts:breaking|signals:breaking/)
    expect(all).not.toMatch(/WebSocket streams|5 concurrent/)
    expect(all).not.toMatch(/msg\.type|\{ type, data \}/)
    expect(TEXT).not.toMatch(/a few set their own/)
    // the open endpoints' examples send no credential
    for (const code of Object.values(PUBLIC_SIGNALS_EXAMPLES)) expect(code).not.toMatch(/Authorization|wp_live_|api_key/)
    expect(HTML).not.toMatch(/>stable</)
    expect(HTML).toContain(KEY_PREFIX)
    expect(HTML).toContain(WEBHOOKS_PATH)
    expect(HTML).toContain('per client address')
  })
})

describe('credentials (apps/api/src/middleware/auth.ts, lib/api-keys.ts)', () => {
  it('every key starts with wp_live_ and is sent as X-Api-Key', () => {
    expect(KEY_PREFIX).toBe('wp_live_')
    expect(api('lib/api-keys.ts')).toContain('`wp_live_${randomHex}`')
    expect(API_KEY_HEADER.toLowerCase()).toBe('x-api-key')
    expect(api('middleware/auth.ts')).toContain(`req.headers['x-api-key']`)
    expect(api('routes/slop.ts')).toContain(`req.headers['x-api-key']`)
  })

  it('lists every endpoint that takes an API key, and only those', () => {
    const listed = API_KEY_ENDPOINTS.map(e => `${e.method} ${e.path}`).sort()
    const real = [...new Set(API_ROUTES.filter(r => r.access === 'apikey').map(r => `${r.method} ${r.path}`))].sort()
    expect(listed).toEqual(real)
  })

  it('the sign-in examples take a sign-in token, and the open ones nothing', () => {
    for (const e of SIGN_IN_ENDPOINTS) expect(route(e.method, e.path)?.access, `${e.method} ${e.path}`).toBe('signin')
    for (const e of OTHER_OPEN_ENDPOINTS) expect(route(e.method, e.path)?.access, `${e.method} ${e.path}`).toBe('none')
  })

  it('the login answer, the token\'s life and the refresh are as auth.ts has them', () => {
    const auth = api('routes/auth.ts')
    expect(HTML).toContain('data.accessToken')
    expect(auth).toContain('data: { user: formatUser(user), ...tokens }')
    expect(auth).toMatch(/app\.jwt\.sign\(\{ id: userId \}, \{ expiresIn: '24h' \}\)/)
    expect(TEXT).toContain('It lasts 24 hours')
    // a refresh token: kept 30 days, and the refresh deletes it (it works once)
    expect(auth).toContain('await redis.setex(`refresh:${refreshToken}`, 30 * 24 * 60 * 60, userId)')
    expect(auth).toMatch(/const userId = await redis\.get\(`refresh:\$\{refreshToken\}`\)[\s\S]*?await redis\.del\(`refresh:\$\{refreshToken\}`\)\s*const tokens = await issueTokens/)
    expect(TEXT).toContain('send the answer\'s data.refreshToken to POST /api/v1/auth/refresh (a refresh token lasts 30 days and works once)')
  })

  it('names the answers a request gets without a sign-in token, and with a bad one', () => {
    const middleware = api('middleware/auth.ts')
    expect(middleware).toContain(`'${SIGN_IN_REQUIRED}'`)
    expect(middleware).toContain(`'${BAD_TOKEN}'`)
    expect(TEXT).toContain(`answers 401 ${SIGN_IN_REQUIRED}`)
    expect(TEXT).toContain(`answers 401 ${BAD_TOKEN}`)
    // GET /auth/me checks the token itself and says only this
    expect(api('routes/auth.ts')).toContain("return sendError(reply, 401, 'UNAUTHORIZED', 'Unauthorized')")
    expect(TEXT).toContain('GET /api/v1/auth/me answers just Unauthorized')
  })
})

describe('rate limits (apps/api/src/lib/rate-limit-options.ts and each route\'s config)', () => {
  it('names the budget the routes without their own limit share', () => {
    expect(api('lib/rate-limit-options.ts')).toMatch(new RegExp(`max:\\s+\\(req\\) => req\\.apiPlan\\?\\.perMinute \\?\\? ${DEFAULT_PER_MINUTE},`))
    expect(TEXT).toContain(`Endpoints without a limit of their own share one budget: ${DEFAULT_PER_MINUTE} requests a minute`)
    expect(TEXT).toContain('counted for that endpoint alone')
  })

  it('names each route\'s own limit as its config sets it', () => {
    for (const r of ROUTE_LIMITS) {
      expect(route(r.method, r.path)?.perMinute, `${r.method} ${r.path}`).toBe(r.perMinute)
    }
    // many routes set their own (it said "a few")
    expect(API_ROUTES.filter(r => r.perMinute !== null).length).toBeGreaterThan(50)
  })

  it("names a Pro key's own budget as the API counts it (Oct 21, 2026)", () => {
    const plan = api('lib/api-plan.ts')
    expect(plan).toMatch(new RegExp(`PRO_KEY_LIMITS = \\{ perMinute: ${PRO_KEY_BUDGET.perMinute}, perDay: 50_000 \\}`))
    expect(plan).toMatch(new RegExp(`ROUTE_MULTIPLIER = ${PRO_KEY_BUDGET.routeMultiplier}\\b`))
    expect(api('lib/api-keys.ts')).toMatch(/pro:\s+\{ rpm: 600,\s+rpd: 50_000 \}/)
    expect(TEXT).toContain(`counts in its own budget: ${PRO_KEY_BUDGET.perMinute} requests a minute across the API`)
    expect(TEXT).toContain('A free key counts like no key')
  })

  it('lists the headers browsers on other sites may read', () => {
    const exposed = api('lib/cors-policy.ts')
    for (const h of RATE_LIMIT_HEADERS) expect(exposed).toContain(`'${h.header.toLowerCase()}'`)
  })
})

describe('open endpoints (apps/api/src/routes/public.ts, lib/query-schemas.ts, lib/cors-policy.ts)', () => {
  it('documents /public/signals\' parameters as the schema takes them', () => {
    const schema = api('lib/query-schemas.ts')
    expect(schema).toMatch(/PublicSignalsQuerySchema = z\.object\(\{[\s\S]*?limit:\s+intParam\(50, 1, 100\)/)
    expect(schema).toMatch(/PublicSignalsQuerySchema = z\.object\(\{[\s\S]*?max\(10_000\)/)
    expect(PUBLIC_SIGNALS_PARAMS.map(p => p.name)).toEqual(['category', 'severity', 'limit', 'offset'])
    expect(PUBLIC_SIGNALS_PARAMS.find(p => p.name === 'severity')?.description).toContain('info')
  })

  it('shows the answer public.ts sends', () => {
    const answer = JSON.parse(PUBLIC_SIGNALS_RESPONSE) as Record<string, unknown> & { data: Record<string, unknown>[] }
    expect(Object.keys(answer)).toEqual(['success', 'data', 'total', 'total_exact', 'limit', 'offset'])
    const publicTs = api('routes/public.ts')
    const formatted = publicTs.slice(publicTs.indexOf('function formatPublicSignal'))
    for (const field of Object.keys(answer.data[0])) expect(formatted, field).toMatch(new RegExp(`\\n\\s+${field}:`))
    expect(formatted).toContain('reliability_score: row.reliability_score !== null ? Number(row.reliability_score) : null')
    expect(publicTs).toContain(".header('X-Cache-Hit', 'true')")
  })

  it('names the paths other websites\' pages may read, as the CORS policy has them', () => {
    const policy = api('lib/cors-policy.ts')
    const listed = policy.match(/const PUBLIC_READ_PREFIXES = \[([\s\S]*?)\]/)?.[1] ?? ''
    expect([...listed.matchAll(/'([^']+)'/g)].map(m => m[1])).toEqual([...CORS_OPEN_PREFIXES])
    expect(policy).toContain("const MCP_PATH = '/mcp'")
    const said = TEXT.slice(TEXT.indexOf('These need no sign-in or key.'), TEXT.indexOf('X-Cache-Hit'))
    const named: Record<string, string> = {
      '/api/v1/public/': '/api/v1/public', '/api/v1/rss/': '/rss', '/api/v1/signals': '/signals',
      '/api/v1/stories': '/stories', '/api/v1/countries': '/countries', '/api/v1/search': '/search',
      '/api/v1/feed/global': 'the global and trending feeds', '/api/v1/feed/trending': 'the global and trending feeds',
      '/ws': 'the WebSocket',
    }
    for (const p of CORS_OPEN_PREFIXES) expect(said, p).toContain(named[p])
    expect(said).toContain('the MCP server')
    // /feed/signals is not among them, as its description says
    expect(CORS_OPEN_PREFIXES.some(p => '/api/v1/feed/signals'.startsWith(p))).toBe(false)
  })

  it('says what ?only=entities does on /signals/:id/connections', () => {
    expect(api('lib/signal-connections.ts')).toMatch(/if \(only === 'entities'\) \{[\s\S]*?return \{ connections: \[\], entities, count: 0 \}/)
    expect(api('routes/signals.ts')).toMatch(/const \{ limit = 8, only \} = req\.query/)
    expect(OTHER_OPEN_ENDPOINTS.find(e => e.path === '/api/v1/signals/:id/connections')?.description).toContain('?only=entities')
  })
})

describe('the MCP server (apps/api/src/routes/mcp.ts)', () => {
  const server = api('routes/mcp.ts')

  it('is at /mcp, open, with its own limit of 60 POSTs a minute', () => {
    expect(api('index.ts')).toMatch(/await app\.register\(registerMcpRoutes,\s+\{ prefix: '\/mcp' \}\)/)
    expect(MCP_URL).toBe(`${API_ORIGIN}/mcp`)
    expect(server).toContain(`* WorldPulse for AI assistants: an MCP server at ${MCP_URL}`)
    expect(route('POST', '/mcp')?.access).toBe('none')
    expect(ROUTE_LIMITS.find(r => r.path === '/mcp')).toEqual({ method: 'POST', path: '/mcp', perMinute: 60 })
    expect(TEXT).toContain(`POST ${MCP_URL}`)
    expect(TEXT).toContain('no sign-in or key')
  })

  it('names the server\'s tools, the batch size and an example it answers', () => {
    const served = [...server.matchAll(/^\s{4}name: '([a-z_]+)',$/gm)].map(m => m[1]).sort()
    expect([...MCP_TOOLS].sort()).toEqual(served)
    for (const t of MCP_TOOLS) expect(HTML).toContain(`>${t}</code>`)
    expect(server).toContain('messages.length > 20')
    expect(TEXT).toContain('a batch of up to 20')
    expect(MCP_EXAMPLE).toContain(`"${MCP_URL}"`)
    expect(server).toContain("case 'tools/list':")
    expect(MCP_EXAMPLE).toContain('"method":"tools/list"')
  })

  it('says each tool asks an open endpoint, and names them all', () => {
    // ask(asker, `/api/v1/...`) in each tool: the path up to its query or its first ${...}
    const asked = [...server.matchAll(/ask\(asker, `(\/api\/v1\/[^`?$]*)([?$])?/g)]
      .map(m => (m[2] === '$' && m[1].endsWith('/') ? `${m[1]}:id` : m[1]))
    expect(asked.length).toBe(MCP_TOOLS.length)
    const named: Record<string, string> = {
      '/api/v1/stories': 'the top stories', '/api/v1/stories/:id': 'one story', '/api/v1/search/semantic': 'search by meaning',
      '/api/v1/stories/week': 'the week', '/api/v1/stories/by-link': 'the story of a news link',
      '/api/v1/coverage-gap': 'the under-reported crises',
    }
    const said = TEXT.slice(TEXT.indexOf('Each tool asks the API\'s own open endpoints'), TEXT.indexOf('How to connect'))
    for (const path of asked) {
      expect(route('GET', path)?.access, path).toBe('none')
      expect(said, path).toContain(named[path])
    }
  })

  it('links the developer page\'s MCP section', () => {
    expect(MCP_GUIDE).toBe('/developers#mcp')
    expect(HTML).toContain(`href="${MCP_GUIDE}"`)
    expect(readFileSync(join(__dirname, '..', 'app', 'developers', 'page.tsx'), 'utf8')).toContain('<section id="mcp"')
  })
})

describe('webhooks (apps/api/src/routes/developer.ts, lib/webhooks.ts, ws/handler.ts)', () => {
  const developer = api('routes/developer.ts')
  const webhooks = api('lib/webhooks.ts')
  const handler = api('ws/handler.ts')

  it('lists the webhook routes where the API serves them, each with a sign-in token', () => {
    for (const e of WEBHOOK_ENDPOINTS) {
      expect(route(e.method, e.path)?.access, `${e.method} ${e.path}`).toBe('signin')
    }
    expect(registeredModules().get('./routes/developer')).toEqual(['/api/v1/developer/keys'])
  })

  it('names the limit, events and filters registration takes', () => {
    expect(developer).toContain(`MAX_WEBHOOKS_PER_USER = ${MAX_WEBHOOKS}`)
    expect(developer).toContain("return sendError(reply, 429, 'RATE_LIMITED', `Maximum ${MAX_WEBHOOKS_PER_USER} active webhooks")
    expect(TEXT).toContain('registering one more answers 429')
    const allowed = developer.match(/ALLOWED_EVENTS = \[([^\]]*)\]/)?.[1] ?? ''
    for (const e of WEBHOOK_EVENTS) expect(allowed).toContain(`'${e.event}'`)
    // deliveries are sent for these two; signal.updated is accepted but never sent (the page says so)
    const fired = [...handler.matchAll(/fireWebhooks\('([^']+)'/g)].map(m => m[1]).sort()
    expect(fired).toEqual(WEBHOOK_EVENTS.map(e => e.event).sort())
    expect(allowed).toContain(`'signal.updated'`)
    expect(HTML).toContain('signal.updated')
    const filters = developer.match(/filters: z\.object\(\{([\s\S]*?)\}\)/)?.[1] ?? ''
    expect([...filters.matchAll(/^\s*(\w+):/gm)].map(m => m[1])).toEqual(WEBHOOK_FILTERS.map(f => f.name))
    // one value each, not lists, and each must match exactly
    expect(filters).not.toMatch(/z\.array/)
    for (const code of Object.values(WEBHOOK_EXAMPLES)) expect(code).not.toMatch(/"severity":\s*\[|severity: \[/)
    expect(webhooks).toContain('if (filters.severity && payload.severity !== filters.severity) return false')
    expect(WEBHOOK_FILTERS.find(f => f.name === 'severity')?.description).toMatch(/^Exactly this severity/)
    // an alert's data names its country countryCode, a new signal's country_code: the filter reads both (Oct 20, 2026)
    expect(webhooks).toContain('const code = payload.country_code ?? payload.countryCode')
    expect(webhooks).toContain('if (filters.country_code && countryOf(payload) !== filters.country_code.toUpperCase()) return false')
    const alert = api('lib/breaking-alerts.ts').match(/export interface BreakingAlert \{([^}]*)\}/)?.[1] ?? ''
    expect(alert).toMatch(/\bcountryCode\?: string/)
    expect(alert).not.toContain('country_code')
    expect(WEBHOOK_FILTERS.find(f => f.name === 'country_code')?.description).toContain('an alert.breaking (countryCode)')
  })

  it('names the headers and the signature lib/webhooks.ts sends', () => {
    for (const h of WEBHOOK_HEADERS) expect(webhooks).toContain(`'${h.header}'`)
    expect(webhooks).toContain('`${timestamp}.${body}`')
    expect(webhooks).toContain('`t=${timestamp},v1=${hmac}`')
    expect(webhooks).toContain("createHmac('sha256', secret)")
    expect(WEBHOOK_VERIFY_EXAMPLES.typescript).toContain("createHmac('sha256', secret)")
    expect(WEBHOOK_VERIFY_EXAMPLES.typescript).toContain('`${parts.t}.${rawBody}`')
    expect(WEBHOOK_VERIFY_EXAMPLES.python).toContain('parts["t"].encode() + b"." + raw_body')
  })

  it('shows a delivery as lib/webhooks.ts sends it, with the scraper\'s signal.new data', () => {
    expect(webhooks).toContain('JSON.stringify({ event, payload })')
    const delivery = JSON.parse(WEBHOOK_DELIVERY) as { event: string; payload: Record<string, unknown> }
    expect(Object.keys(delivery)).toEqual(['event', 'payload'])
    const insert = readFileSync(join(APPS, 'scraper', 'src', 'pipeline', 'insert-signal.ts'), 'utf8')
    const published = insert.match(/publish\('wp:signal\.new', JSON\.stringify\(\{\s*event: 'signal\.new',\s*payload: \{([\s\S]*?)\.\.\.geoFields/)?.[1] ?? ''
    const fields = new Set([...[...published.matchAll(/^\s*(\w+):/gm)].map(m => m[1]), 'lat', 'lng'])
    for (const key of Object.keys(delivery.payload)) expect(fields.has(key), key).toBe(true)
  })

  it('registers webhooks with a sign-in token in every example, never an API key', () => {
    for (const code of Object.values(WEBHOOK_EXAMPLES)) {
      expect(code).toContain(WEBHOOKS_PATH)
      expect(code).not.toContain(KEY_PREFIX)
      expect(code).toMatch(/Bearer \$ACCESS_TOKEN|Bearer \$\{accessToken\}|Bearer \{access_token\}/)
    }
    expect(WEBHOOK_EXAMPLES.typescript).toContain('data.secret')
    expect(WEBHOOK_EXAMPLES.python).toContain('resp.json()["data"]')
  })
})

describe('WebSocket (apps/api/src/ws/handler.ts)', () => {
  const handler = api('ws/handler.ts')

  it('speaks the protocol the handler does', () => {
    expect(handler).toMatch(/const message: WSMessage = \{\s*event,\s*data,\s*timestamp:/)
    expect(handler).toMatch(/case 'subscribe': \{\s*const \{ channels \} = msg\.payload/)
    expect(handler).toMatch(/case 'unsubscribe': \{\s*const \{ channels \} = msg\.payload/)
    expect(handler).toMatch(/case 'pong':/)
    expect(handler).toMatch(/> 60_000/)
    expect(handler).toMatch(/\}, 30_000\)/)
    for (const m of WS_CLIENT_MESSAGES) {
      const msg = JSON.parse(m.message) as { type: string; payload?: { channels?: string[] } }
      expect(handler).toContain(`case '${msg.type}':`)
      if (msg.type !== 'pong') expect(Array.isArray(msg.payload?.channels)).toBe(true)
    }
    for (const code of Object.values(WEBSOCKET_EXAMPLES)) {
      // { type: 'subscribe', payload: { channels: [...] } }, in each language's spelling
      expect(code.replace(/[\s'"]/g, '')).toContain('type:subscribe,payload:{channels:[all]}')
      expect(code.replace(/[\s'"]/g, '')).toContain('type:pong')
      expect(code).not.toMatch(/token=|wp_live_|api_key|apiKey/)
    }
  })

  it('says the pings carry only event and data, on connecting and after a subscribe too', () => {
    // every ping goes through send(), not broadcast(): no timestamp or id
    const pings = [...handler.matchAll(/send\((?:socket|client\.socket), \{\s*event: 'ping',\s*data: \{([^}]*)\}/g)].map(m => m[1])
    expect(pings.length).toBe(3)
    expect(pings[0]).toContain('clientId')
    expect(pings[1]).toContain('subscribed')
    expect(TEXT).toContain('the server\'s pings carry only event and data')
    const ping = WS_EVENTS.find(e => e.event === 'ping')?.description ?? ''
    expect(ping).toContain('also sent when you connect (with your clientId) and after a subscribe (with your channels)')
  })

  it('lists the events something sends, and who gets them', () => {
    const factChecker = api('lib/pulse/agents/fact-checker.ts')
    const sources = [
      readFileSync(join(APPS, 'scraper', 'src', 'pipeline', 'insert-signal.ts'), 'utf8'),
      readFileSync(join(APPS, 'scraper', 'src', 'index.ts'), 'utf8'),
      api('lib/breaking-alerts.ts'),
      api('routes/posts.ts'),
      api('lib/pulse/publisher.ts'),
      factChecker,
    ].join('\n')
    const sends = (src: string, event: string) => new RegExp(`event:\\s+'${event.replace('.', '\\.')}'`).test(src)
    for (const e of WS_EVENTS) {
      expect(sends(e.event === 'ping' ? handler : sources, e.event), e.event).toBe(true)
    }
    // nothing sends signal.updated, so the page doesn't list it
    expect(sends(sources, 'signal.updated')).toBe(false)
    expect(WS_EVENTS.map(e => e.event)).not.toContain('signal.updated')
    // post.new carries a channel; signal.new and trending.update none (every connection gets them)
    expect(api('routes/posts.ts')).toMatch(/filter:\s+\{ category: d\.signalId \? 'signal' : 'social' \}/)
    expect(api('lib/pulse/publisher.ts')).toMatch(/filter:\s+\{ category: 'pulse' \}/)
    // ...but PULSE's fact-check posts go out without one, so every connection gets them
    const factPost = factChecker.match(/publish\('wp:post\.new', JSON\.stringify\(\{([\s\S]*?)\}\)\)/)?.[1] ?? ''
    expect(factPost).toContain("event: 'post.new'")
    expect(factPost).not.toContain('filter')
    expect(WS_EVENTS.find(e => e.event === 'post.new')?.reaches).toContain('PULSE\'s fact-check posts reach every connection')
  })
})

describe('the examples use routes the API serves', () => {
  it('every /api/v1 path in them is a route', () => {
    const paths = [...EXAMPLES.matchAll(/\/api\/v1\/[\w./:-]+/g)].map(m => m[0].replace(/\.+$/, ''))
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) expect(API_ROUTES.some(r => r.path === path), path).toBe(true)
  })
})
