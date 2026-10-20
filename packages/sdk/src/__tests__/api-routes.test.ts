/**
 * Every request the SDK makes reaches a route the API serves, open to anyone
 * (plan V3h, Oct 20, 2026). Until then the SDK called nine paths under
 * /api/v1/public, and seven of them don't exist. Like
 * apps/web/src/__tests__/developers-examples.test.ts, this reads the API's own
 * source (the prefixes in apps/api/src/index.ts, the registrations in each
 * route file), so a route that moves, or starts asking for a key, fails here
 * instead of on a developer's first call. Each method is called with fetch
 * stubbed and the request it makes is matched as Fastify matches it. No network.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, vi } from 'vitest'
import { WorldPulse } from '../index'
import { isPublicRead } from '../../../../apps/api/src/lib/cors-policy'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SDK = join(HERE, '..', '..')
const REPO = join(SDK, '..', '..')
const API_SRC = join(REPO, 'apps', 'api', 'src')

// ─── The API's routes, read from its source ──────────────────────

/** What a caller must send: as the route's code checks it */
type Access = 'none' | 'signin' | 'apikey'
interface Route { method: string; path: string; access: Access }

const ROUTE_CALL = /\bapp\.(get|post|put|patch|delete)\b/g
const AUTH_HOOK = (check: string) => new RegExp(`addHook\\(\\s*['"](?:onRequest|preValidation|preHandler)['"]\\s*,\\s*${check}\\b`)

/** Each app.get('/path', { …options… }, async …) in a route file, with the credential its options (or the file's hooks) check */
function routesIn(source: string): Route[] {
  const fileAccess: Access | null = AUTH_HOOK('apiKeyAuth').test(source) ? 'apikey'
    : AUTH_HOOK('authenticate').test(source) ? 'signin' : null
  const out: Route[] = []
  for (const m of source.matchAll(ROUTE_CALL)) {
    let i = (m.index ?? 0) + m[0].length
    const skipSpace = () => { while (i < source.length && /\s/.test(source[i]!)) i++ }
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
    out.push({ method: m[1]!.toUpperCase(), path: source.slice(i + 1, end), access })
  }
  return out
}

/** Route module ('./routes/feed') → the prefixes index.ts registers it under */
function registeredModules(): Map<string, string[]> {
  const index = readFileSync(join(API_SRC, 'index.ts'), 'utf8')
  const moduleOf = new Map<string, string>()
  for (const m of index.matchAll(/import\s+(?:\{([^}]*)\}|(\w+))\s+from\s+'(\.\/(?:routes|ws)\/[^']+)'/g)) {
    const names = m[1]
      ? m[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop()?.trim() ?? '').filter(Boolean)
      : [m[2]!]
    for (const name of names) moduleOf.set(name, m[3]!)
  }
  const prefixes = new Map<string, string[]>()
  for (const m of index.matchAll(/app\.register\(\s*(\w+)\s*(?:,\s*\{\s*prefix:\s*'([^']*)'\s*\})?\s*\)/g)) {
    const mod = moduleOf.get(m[1]!)
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

/**
 * The route a request for `path` reaches, as Fastify (find-my-way) picks it:
 * segment by segment, a fixed name before a :parameter, so /stories/week is
 * the week and /stories/<uuid> one story
 */
function routeFor(method: string, path: string): Route | undefined {
  const asked = path.split('/')
  const fits = API_ROUTES.filter(r => {
    if (r.method !== method) return false
    const parts = r.path.split('/')
    return parts.length === asked.length && parts.every((p, i) => p.startsWith(':') ? asked[i] !== '' : p === asked[i])
  })
  return fits.sort((a, b) => {
    const pa = a.path.split('/')
    const pb = b.path.split('/')
    for (let i = 0; i < pa.length; i++) {
      const aParam = pa[i]!.startsWith(':')
      const bParam = pb[i]!.startsWith(':')
      if (aParam !== bParam) return aParam ? 1 : -1
    }
    return 0
  })[0]
}

// ─── What the SDK asks for ───────────────────────────────────────

const ID = '6f1c2a9e-3b7d-4c55-9a0e-8d2f4b1e7c30'

/** Each SDK method, called with every parameter it takes, and the route it is for */
const CALLS: Array<{ method: string; route: string; call: (wp: WorldPulse) => Promise<unknown> }> = [
  { method: 'signals.list',    route: 'GET /api/v1/public/signals',    call: wp => wp.signals.list({ category: 'conflict', severity: 'high', limit: 10, offset: 20 }) },
  { method: 'signals.get',     route: 'GET /api/v1/signals/:id',       call: wp => wp.signals.get(ID) },
  { method: 'categories.list', route: 'GET /api/v1/public/categories', call: wp => wp.categories.list() },
  { method: 'stories.top',     route: 'GET /api/v1/stories',           call: wp => wp.stories.top({ hours: 24, limit: 10, country: 'NG' }) },
  { method: 'stories.get',     route: 'GET /api/v1/stories/:id',       call: wp => wp.stories.get(ID) },
  { method: 'stories.week',    route: 'GET /api/v1/stories/week',      call: wp => wp.stories.week('2026-W42') },
  { method: 'search.semantic', route: 'GET /api/v1/search/semantic',   call: wp => wp.search.semantic('floods in the Sahel', { limit: 5, category: 'climate' }) },
  { method: 'countries.list',  route: 'GET /api/v1/countries',         call: wp => wp.countries.list({ window: '7d', limit: 20, category: 'conflict' }) },
]

/** The request a call makes (fetch stubbed) */
async function requestOf(call: (wp: WorldPulse) => Promise<unknown>): Promise<{ method: string; url: URL }> {
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('{}', { status: 200 }))
  await call(new WorldPulse({ fetch }))
  expect(fetch).toHaveBeenCalledTimes(1)
  const [url, init] = fetch.mock.calls[0]!
  return { method: init?.method ?? 'GET', url: new URL(String(url)) }
}

/** 'signals.list', … for every method of every method group on a client */
function methodsOf(wp: WorldPulse): string[] {
  return Object.entries(wp).flatMap(([group, value]) => {
    if (!value || typeof value !== 'object') return []
    const proto = Object.getPrototypeOf(value) as object | null
    if (!proto || proto === Object.prototype) return []
    return Object.getOwnPropertyNames(proto).filter(name => name !== 'constructor').map(name => `${group}.${name}`)
  })
}

// ─── Checks ──────────────────────────────────────────────────────

describe('the API route table this test reads', () => {
  it('finds the API\'s routes, with the credentials they check', () => {
    expect(API_ROUTES.length).toBeGreaterThan(100)
    expect(API_ROUTES).toContainEqual({ method: 'GET', path: '/api/v1/public/signals', access: 'none' })
    expect(API_ROUTES).toContainEqual({ method: 'GET', path: '/api/v1/stix/signals/:id', access: 'apikey' })
    expect(API_ROUTES).toContainEqual({ method: 'GET', path: '/api/v1/threats/missiles', access: 'signin' })
    expect(API_ROUTES).toContainEqual({ method: 'GET', path: '/ws', access: 'none' })
  })

  it('picks routes as Fastify does: a fixed name before a parameter', () => {
    expect(routeFor('GET', '/api/v1/stories/week')?.path).toBe('/api/v1/stories/week')
    expect(routeFor('GET', `/api/v1/stories/${ID}`)?.path).toBe('/api/v1/stories/:id')
    expect(routeFor('GET', '/api/v1/public/sources')).toBeUndefined()
  })
})

describe('the SDK\'s requests (plan V3h)', () => {
  it('this test calls every method the client has', () => {
    expect(methodsOf(new WorldPulse({ fetch: vi.fn() })).sort()).toEqual(CALLS.map(c => c.method).sort())
  })

  it.each(CALLS)('$method asks $route, a route the API serves without a sign-in or key', async ({ route, call }) => {
    const { method, url } = await requestOf(call)
    const served = routeFor(method, url.pathname)
    expect(served, `${method} ${url.pathname} isn't a route of apps/api/src`).toBeDefined()
    expect(`${served!.method} ${served!.path}`).toBe(route)
    expect(served!.access, `${route} checks a credential`).toBe('none')
  })

  it.each(CALLS)('$method: a page on any website may read the answer (lib/cors-policy.ts)', async ({ call }) => {
    const { method, url } = await requestOf(call)
    expect(isPublicRead(method, url.pathname + url.search)).toBe(true)
  })
})

describe('README.md and package.json', () => {
  const readme = readFileSync(join(SDK, 'README.md'), 'utf8')
  const pkg = JSON.parse(readFileSync(join(SDK, 'package.json'), 'utf8')) as { license?: string; homepage?: string }

  it('name each method with the route it calls', () => {
    for (const { method, route } of CALLS) {
      expect(readme, method).toContain(`wp.${method}(`)
      expect(readme, route).toContain(route.replace(/^GET /, ''))
    }
  })

  it('say to build it from the repository: it isn\'t on npm', () => {
    expect(readme).not.toMatch(/\b(npm|pnpm|yarn)\s+(install|add|i)\s+@worldpulse\/sdk\b/)
    expect(readme).toContain('pnpm --filter @worldpulse/sdk build')
  })

  it('say MIT, the repository\'s license', () => {
    expect(readFileSync(join(REPO, 'LICENSE'), 'utf8')).toMatch(/^MIT License/)
    expect(pkg.license).toBe('MIT')
    expect(readme).toMatch(/\bMIT\b/)
    expect(readme).not.toMatch(/CC-BY/)
  })

  it('point the homepage at the developers page, which the website has', () => {
    expect(pkg.homepage).toBe('https://world-pulse.io/developers')
    expect(existsSync(join(REPO, 'apps', 'web', 'src', 'app', 'developers', 'page.tsx'))).toBe(true)
  })
})
