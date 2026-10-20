/**
 * The /developers page's endpoint list and code examples match the API
 * (plan V3c, Oct 20, 2026). Until then the list named two paths that answer
 * 404 (/stix/bundle, /bundles), labelled six listings "Pro plan" (no listed
 * route checks a plan), and the Python, JavaScript and TypeScript examples
 * read fields and messages the API doesn't send. These checks read the API's
 * own source (apps/api/src: the prefixes in index.ts, the registrations in
 * each route file), so a route that moves or a credential check that changes
 * fails here instead of on a developer's first try. No network.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  ENDPOINT_GROUPS, LANGS, getCodeExample, type Access, type Lang,
} from '../app/developers/api-reference'

const APPS = join(__dirname, '..', '..', '..')
const API_SRC = join(APPS, 'api', 'src')
const PAGE = readFileSync(join(__dirname, '..', 'app', 'developers', 'page.tsx'), 'utf8')

function api(file: string): string {
  return readFileSync(join(API_SRC, file), 'utf8')
}

interface Route { method: string; path: string; access: Access }

const ROUTE_CALL = /\bapp\.(get|post|put|patch|delete)\b/g
const AUTH_HOOK = (check: string) => new RegExp(`addHook\\(\\s*['"](?:onRequest|preValidation|preHandler)['"]\\s*,\\s*${check}\\b`)

/** Each app.get('/path', { …options… }, async …) in a route file, with the credential its options check */
function routesIn(source: string): Route[] {
  const fileAccess: Access | null = AUTH_HOOK('apiKeyAuth').test(source) ? 'apikey'
    : AUTH_HOOK('authenticate').test(source) ? 'signin' : null
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
    const access: Access = /\bapiKeyAuth\b/.test(options) ? 'apikey'
      : /\bauthenticate\b/.test(options) ? 'signin' : (fileAccess ?? 'none')
    out.push({ method: m[1].toUpperCase(), path: source.slice(i + 1, end), access })
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

/** Every route the API registers, with its full path */
const API_ROUTES: Route[] = [...registeredModules()].flatMap(([mod, prefixes]) => {
  const file = [`${mod}.ts`, `${mod}/index.ts`].map(f => join(API_SRC, f)).find(f => existsSync(f))
  if (!file) return []
  return routesIn(readFileSync(file, 'utf8')).flatMap(route => prefixes.map(prefix => ({
    ...route,
    path: route.path === '/' && prefix ? prefix : prefix + route.path,
  })))
})

const ENDPOINTS = ENDPOINT_GROUPS.flatMap(group => group.endpoints)
const EXAMPLES = Object.fromEntries(LANGS.map(l => [l.id, getCodeExample(l.id)])) as Record<Lang, string>

describe('the API route table this test reads', () => {
  it('finds the routes the page is built on', () => {
    expect(API_ROUTES.length).toBeGreaterThan(100)
    expect(API_ROUTES).toContainEqual({ method: 'GET', path: '/api/v1/public/signals', access: 'none' })
    expect(API_ROUTES).toContainEqual({ method: 'GET', path: '/api/v1/stix/signals/:id', access: 'apikey' })
    expect(API_ROUTES).toContainEqual({ method: 'GET', path: '/api/v1/threats/missiles', access: 'signin' })
    expect(API_ROUTES).toContainEqual({ method: 'POST', path: '/api/v1/bundles/verify', access: 'none' })
    expect(API_ROUTES).toContainEqual({ method: 'GET', path: '/ws', access: 'none' })
  })
})

describe('/developers endpoint list (plan V3c)', () => {
  it.each(ENDPOINTS)('$method $path is a route the API serves, with the access the page shows', (ep) => {
    const route = API_ROUTES.find(r => r.method === ep.method && r.path === ep.path)
    expect(route, `${ep.method} ${ep.path} isn't registered in apps/api/src`).toBeDefined()
    expect(ep.access, `${ep.method} ${ep.path}`).toBe(route?.access)
  })

  it('lists the categories endpoint and the real STIX and bundle routes', () => {
    expect(ENDPOINTS.map(ep => `${ep.method} ${ep.path}`)).toEqual(expect.arrayContaining([
      'GET /api/v1/public/categories',
      'GET /api/v1/stix/signals', 'GET /api/v1/stix/signals/:id', 'GET /api/v1/stix/feed',
      'GET /api/v1/bundles/current', 'GET /api/v1/bundles/current.json',
      'POST /api/v1/bundles/verify', 'GET /api/v1/bundles/public-key',
    ]))
  })

  it('names no plan: no listed route checks one', () => {
    for (const group of ENDPOINT_GROUPS) expect(group.description).not.toMatch(/\bPro\b/)
    for (const ep of ENDPOINTS) expect(`${ep.rateLimit ?? ''} ${ep.description}`).not.toMatch(/\bPro\b/)
  })

  it('describes /maritime/vessels as the news reports it serves, not AIS tracking', () => {
    const vessels = ENDPOINTS.find(ep => ep.path === '/api/v1/maritime/vessels')
    expect(vessels?.description).not.toMatch(/\bAIS\b|dark ship/i)
  })

  it('documents the map points window as hours, the parameter the API reads', () => {
    const names = (ENDPOINTS.find(ep => ep.path === '/api/v1/signals/map/points')?.params ?? []).map(p => p.name)
    expect(names).toContain('hours')
    expect(names).not.toContain('since')
    expect(api('lib/query-schemas.ts')).toMatch(/MapPointsQuerySchema = z\.object\(\{[^}]*\bhours:/)
  })
})

describe('/developers code examples (plan V3c)', () => {
  it.each(LANGS)('$label: every /api/v1 path it uses is a route the API serves', ({ id }) => {
    const paths = [...EXAMPLES[id].matchAll(/\/api\/v1\/[\w./:-]+/g)].map(m => m[0].replace(/\.+$/, ''))
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) expect(API_ROUTES.some(r => r.path === path), `${id} uses ${path}`).toBe(true)
  })

  it('read no field the API doesn\'t send', () => {
    const all = Object.values(EXAMPLES).join('\n')
    expect(all).not.toMatch(/source_count/)       // /public/signals has none
    expect(all).not.toMatch(/msg\.(type|payload)/) // socket messages are { event, data, timestamp, id }
    expect(all).not.toMatch(/\bmeta\b/)            // /public/signals has no meta
    expect(all).not.toMatch(/\["narrative"\]/)     // neither briefing has a narrative field
  })

  it('show the 0-1 reliability score as a percentage only after multiplying by 100', () => {
    for (const [lang, code] of Object.entries(EXAMPLES)) {
      for (const line of code.split('\n')) {
        if (line.includes('reliability_score') && line.includes('%')) expect(line, `${lang}: ${line.trim()}`).toMatch(/\* 100\b/)
      }
    }
  })

  it('Python reads the login token from data and the briefing from data.sections, as the API answers them', () => {
    expect(EXAMPLES.python).toContain('.json()["data"]["accessToken"]')
    expect(EXAMPLES.python).toMatch(/\/api\/v1\/briefing\/daily"\)\.json\(\)\["data"\]/)
    expect(EXAMPLES.python).toContain('briefing["sections"]')
    expect(api('routes/auth.ts')).toContain('data: { user: formatUser(user), ...tokens }')
    expect(api('routes/briefing.ts')).toMatch(/data: \{[^}]*\bsections,/)
  })

  it('TypeScript types /public/signals as public.ts answers it', () => {
    const fields = (name: string) => {
      const body = EXAMPLES.typescript.match(new RegExp(`interface ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
      return [...body.matchAll(/^\s*(\w+)\??:/gm)].map(m => m[1])
    }
    expect(fields('SignalList')).toEqual(['success', 'data', 'total', 'total_exact', 'limit', 'offset'])
    const publicTs = api('routes/public.ts')
    for (const field of ['total', 'total_exact', 'limit', 'offset']) expect(publicTs).toMatch(new RegExp(`\\n\\s+${field}:\\s`))
    const formatted = publicTs.slice(publicTs.indexOf('function formatPublicSignal'))
    expect(fields('Signal').length).toBeGreaterThan(5)
    for (const field of fields('Signal')) expect(formatted, field).toMatch(new RegExp(`\\n\\s+${field}:`))
  })

  it('JavaScript speaks the WebSocket protocol of ws/handler.ts', () => {
    const js = EXAMPLES.javascript
    const handler = api('ws/handler.ts')
    // server to client: { event, data, timestamp, id }; a new signal's data has its title
    expect(handler).toMatch(/const message: WSMessage = \{\s*event,\s*data,\s*timestamp:/)
    expect(readFileSync(join(APPS, 'scraper', 'src', 'pipeline', 'insert-signal.ts'), 'utf8'))
      .toMatch(/publish\('wp:signal\.new'[\s\S]{0,200}\btitle:/)
    expect(js).toContain('msg.event === "signal.new"')
    expect(js).toContain('msg.data.title')
    // the heartbeat: the server drops a connection that doesn't answer its pings
    expect(handler).toMatch(/case 'pong':/)
    expect(js).toContain('msg.event === "ping"')
    expect(js).toContain('JSON.stringify({ type: "pong" })')
    // the subscribe message: { type: 'subscribe', payload: { channels } }
    expect(handler).toMatch(/case 'subscribe': \{\s*const \{ channels \} = msg\.payload/)
    expect(js).toContain('JSON.stringify({ type: "subscribe", payload: { channels: ["all"] } })')
    expect(js).toContain('"wss://api.world-pulse.io/ws"')
  })
})

describe('/developers page text', () => {
  it('links the API keys page (/developer) from the Quick Start and the Authentication box', () => {
    expect(PAGE.match(/href: '\/developer'|href="\/developer"/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(existsSync(join(__dirname, '..', 'app', 'developer', 'page.tsx'))).toBe(true)
  })

  it('says the code is MIT licensed, with no other terms for it (owner, Oct 20)', () => {
    expect(PAGE).toContain('https://github.com/World-Pulse/WorldPulse/blob/main/LICENSE')
    expect(PAGE).not.toMatch(/non-commercial/i)
    expect(PAGE).not.toMatch(/free for open-source projects/i)
  })

  it('no longer promises a { success, data, meta } shape, automatic reconnection or signal.updated', () => {
    expect(PAGE).not.toContain('{ success, data, meta }')
    expect(PAGE).not.toMatch(/automatic reconnection/i)
    expect(PAGE).not.toContain('>signal.updated<')
  })
})
