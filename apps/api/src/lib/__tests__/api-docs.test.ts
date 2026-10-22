/**
 * The interactive API docs at /api/docs (plan V3i, Oct 20, 2026): each
 * operation says what it needs (a sign-in token, an API key or nothing) and
 * its own rate limit, the admin and other internal routes are left out, the
 * MCP server is listed like the other open routes, and the descriptions say
 * what the code does. The document is built here from the same options and
 * transform the API registers (lib/api-docs.ts), over stub routes and over
 * some of the API's own route files. No database, Redis or network.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyPluginAsync, type FastifyReply, type FastifyRequest } from 'fastify'
import swagger from '@fastify/swagger'

vi.mock('../../db/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn(), schema: { hasColumn: vi.fn() } }) }))
vi.mock('../../db/redis', () => ({ redis: { get: vi.fn(), setex: vi.fn(), set: vi.fn(), del: vi.fn(), incr: vi.fn(), expire: vi.fn(), hgetall: vi.fn(), smembers: vi.fn(), duplicate: vi.fn(), on: vi.fn() } }))

import { authenticate, optionalAuth, apiKeyAuth } from '../../middleware/auth'
import {
  openapiOptions, routeAccess, isInternalPath, isInternalOperation, ownRateLimit, rateLimitNote, docsPath,
  SIGN_IN_SCHEME, API_KEY_SCHEME, DEVELOPERS_URL, LICENSE_URL, SIGN_IN_REQUIRED, SHARED_PER_MINUTE,
} from '../api-docs'
import { registerAdminRoutes } from '../../routes/admin'
import { registerAdminDigestRoutes } from '../../routes/digest'
import { registerDeveloperRoutes } from '../../routes/developer'
import { registerStixRoutes } from '../../routes/stix'
import { registerSlopRoutes } from '../../routes/slop'
import { registerPulseRoutes } from '../../routes/pulse'
import { registerPublicRoutes } from '../../routes/public'
import { registerMcpRoutes, TOOLS } from '../../routes/mcp'
import { registerAuthRoutes } from '../../routes/auth'
import { registerMaritimeRoutes } from '../../routes/maritime'
import { registerSignalRoutes } from '../../routes/signals'

type Param = { in: string; name: string; description?: string }
type Op = {
  security?: Array<Record<string, string[]>>; tags?: string[]; summary?: string; description?: string
  parameters?: Param[]; requestBody?: { content: Record<string, { example?: unknown }> }
  responses?: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }>
}
type Spec = {
  info: { title: string; description: string; version: string; contact?: { url?: string }; license?: { name: string; url?: string } }
  externalDocs?: { url: string }
  tags?: Array<{ name: string; description?: string }>
  paths: Record<string, Record<string, Op>>
  components: { securitySchemes: Record<string, Record<string, unknown>> }
}

const SRC = join(__dirname, '..', '..')
const source = (file: string) => readFileSync(join(SRC, file), 'utf8')

const ok = async (_req: FastifyRequest, reply: FastifyReply) => reply.send({ ok: true })
// Checks a route file keeps to itself are known by name (lib/api-docs.ts)
async function authenticateApiKey() { /* stands in for routes/slop.ts's */ }
function requirePulseKey(_req: unknown, _reply: unknown, done: () => void) { done() }

async function docsOf(register: (app: FastifyInstance) => Promise<void>): Promise<Spec> {
  const app = Fastify({ logger: false })
  await app.register(swagger, openapiOptions())
  await register(app)
  await app.ready()
  const spec = app.swagger() as unknown as Spec
  await app.close()
  return spec
}

describe('routeAccess', () => {
  it('reads the credential from the route\'s own checks', () => {
    expect(routeAccess('/api/v1/feed/following', { preHandler: [authenticate] })).toBe('signin')
    expect(routeAccess('/api/v1/feed/following', { preHandler: authenticate })).toBe('signin')
    expect(routeAccess('/api/v1/feed/following', { onRequest: [authenticate] })).toBe('signin')
    expect(routeAccess('/api/v1/stix/feed', { preHandler: [apiKeyAuth] })).toBe('apikey')
    expect(routeAccess('/api/v1/slop/check', { preHandler: [authenticateApiKey] })).toBe('apikey')
    expect(routeAccess('/api/v1/feed/global', { preHandler: [optionalAuth] })).toBe('none')
    expect(routeAccess('/api/v1/public/signals', {})).toBe('none')
    expect(routeAccess('/api/v1/public/signals')).toBe('none')
    // the MCP server is public, not internal
    expect(routeAccess('/mcp', {})).toBe('none')
    expect(isInternalPath('/mcp')).toBe(false)
  })

  it('treats the admin, ops, Stripe and PULSE operator routes as internal', () => {
    expect(routeAccess('/api/v1/admin/scraper/health', { preHandler: [authenticate] })).toBe('internal')
    expect(routeAccess('/api/v1/pulse/publish/flash', { preHandler: [requirePulseKey] })).toBe('internal')
    // the admin-only signal operations outside /admin, by method: the same paths' other methods stay
    expect(routeAccess('/api/v1/signals/:id', { method: 'DELETE', preHandler: [authenticate] })).toBe('internal')
    expect(routeAccess('/api/v1/signals/:id/slop-score', { method: 'GET', preHandler: [authenticate] })).toBe('internal')
    expect(routeAccess('/api/v1/signals/:id', { method: 'GET', preHandler: [optionalAuth] })).toBe('none')
    expect(routeAccess('/api/v1/signals/:id', { method: 'PATCH', preHandler: [authenticate] })).toBe('signin')
    expect(isInternalOperation('/api/v1/signals/:id', { method: 'delete' })).toBe(true)
    expect(isInternalOperation('/api/v1/signals/:id')).toBe(false)
    expect(isInternalPath('/api/v1/admin')).toBe(true)
    expect(isInternalPath('/metrics')).toBe(true)
    expect(isInternalPath('/health')).toBe(true)
    expect(isInternalPath('/api/v1/billing/webhook')).toBe(true)
    // the status page's health check, sign-up checkout and look-alike paths stay
    expect(isInternalPath('/api/v1/health')).toBe(false)
    expect(isInternalPath('/api/v1/billing/checkout')).toBe(false)
    expect(isInternalPath('/api/v1/administrators')).toBe(false)
    expect(isInternalPath('/healthz')).toBe(false)
  })
})

describe('a route\'s own rate limit, in words', () => {
  it('reads config.rateLimit as @fastify/rate-limit takes it', () => {
    expect(ownRateLimit({ config: { rateLimit: { max: 5, timeWindow: '1 minute' } } })).toEqual({ max: 5, windowMs: 60_000 })
    expect(ownRateLimit({ config: { rateLimit: { max: 30, timeWindow: 60_000 } } })).toEqual({ max: 30, windowMs: 60_000 })
    expect(ownRateLimit({ config: { rateLimit: { max: 10, timeWindow: '1 hour' } } })).toEqual({ max: 10, windowMs: 3_600_000 })
    // without one (the API-wide budget), or one the docs can't put in words
    expect(ownRateLimit({})).toBeNull()
    expect(ownRateLimit({ config: {} })).toBeNull()
    expect(ownRateLimit({ config: { rateLimit: { max: () => 5, timeWindow: '1 minute' } } })).toBeNull()
  })

  it('says it plainly', () => {
    expect(rateLimitNote({ max: 30, windowMs: 60_000 })).toBe('Rate limit: 30 requests a minute per client address, counted for this endpoint alone.')
    expect(rateLimitNote({ max: 10, windowMs: 3_600_000 })).toBe('Rate limit: 10 requests an hour per client address, counted for this endpoint alone.')
    expect(rateLimitNote({ max: 3, windowMs: 120_000 })).toBe('Rate limit: 3 requests every 2 minutes per client address, counted for this endpoint alone.')
  })

  it('names a prefix\'s own route without the trailing slash', () => {
    expect(docsPath('/mcp/')).toBe('/mcp')
    expect(docsPath('/api/v1/stories/')).toBe('/api/v1/stories')
    expect(docsPath('/api/v1/stories/{id}')).toBe('/api/v1/stories/{id}')
    expect(docsPath('/')).toBe('/')
  })
})

describe('the OpenAPI document, over stub routes', () => {
  let spec: Spec
  beforeAll(async () => {
    spec = await docsOf(async (app) => {
      // as admin.ts does: its own onRoute hook tags each route and names bearerAuth
      const admin: FastifyPluginAsync = async (scope) => {
        scope.addHook('onRoute', (r) => {
          r.schema ??= {}
          r.schema.tags = r.schema.tags ?? ['admin']
          r.schema.security = r.schema.security ?? [{ bearerAuth: [] }]
        })
        scope.get('/scraper/health', { preHandler: [authenticate] }, ok)
      }
      await app.register(admin, { prefix: '/api/v1/admin' })
      app.get('/health', ok)
      app.get('/api/v1/health', ok)
      app.get('/api/v1/feed/following', { preHandler: [authenticate] }, ok)
      app.get('/api/v1/feed/global', { preHandler: [optionalAuth] }, ok)
      app.get('/api/v1/public/signals', { schema: { tags: ['public'], description: 'Verified signals.' }, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, ok)
      // a CORS preflight answer
      app.options('/api/v1/public/signals', ok)
      app.get('/api/v1/stix/signals', { preHandler: [apiKeyAuth] }, ok)
      app.post('/api/v1/slop/check', { preHandler: [authenticateApiKey] }, ok)
      app.post('/api/v1/pulse/publish/flash', { preHandler: [requirePulseKey] }, ok)
      app.post('/api/v1/billing/webhook', ok)
      // a route that names its own security keeps it
      app.get('/api/v1/auth/me', {
        schema: { security: [{ bearerAuth: [] }] },
        preHandler: async () => { /* inline check */ },
      }, ok)
    })
  })

  it('leaves out the admin and other internal routes, and the preflight answers', () => {
    const paths = Object.keys(spec.paths)
    expect(paths.filter(p => p.startsWith('/api/v1/admin'))).toEqual([])
    expect(paths).not.toContain('/health')
    expect(paths).not.toContain('/api/v1/pulse/publish/flash')
    expect(paths).not.toContain('/api/v1/billing/webhook')
    expect(paths).toEqual(expect.arrayContaining([
      '/api/v1/health', '/api/v1/feed/following', '/api/v1/feed/global',
      '/api/v1/public/signals', '/api/v1/stix/signals', '/api/v1/slop/check', '/api/v1/auth/me',
    ]))
    expect(Object.keys(spec.paths['/api/v1/public/signals'])).toEqual(['get'])
    // Swagger UI shows every listed tag, even an empty one
    expect((spec.tags ?? []).map(t => t.name)).not.toContain('admin')
  })

  it('marks sign-in and API-key operations, and leaves open ones open', () => {
    expect(spec.paths['/api/v1/feed/following'].get.security).toEqual([{ [SIGN_IN_SCHEME]: [] }])
    expect(spec.paths['/api/v1/stix/signals'].get.security).toEqual([{ [API_KEY_SCHEME]: [] }])
    expect(spec.paths['/api/v1/slop/check'].post.security).toEqual([{ [API_KEY_SCHEME]: [] }])
    expect(spec.paths['/api/v1/auth/me'].get.security).toEqual([{ bearerAuth: [] }])
    expect(spec.paths['/api/v1/feed/global'].get.security).toBeUndefined()
    expect(spec.paths['/api/v1/public/signals'].get.security).toBeUndefined()
    expect(spec.paths['/api/v1/public/signals'].get.tags).toEqual(['public'])
  })

  it('gives a route\'s own limit after its description, and none to a route without one', () => {
    expect(spec.paths['/api/v1/public/signals'].get.description)
      .toBe('Verified signals.\n\nRate limit: 60 requests a minute per client address, counted for this endpoint alone.')
    expect(spec.paths['/api/v1/feed/global'].get.description).toBeUndefined()
  })

  it('defines both credentials as the API reads them', () => {
    const { securitySchemes } = spec.components
    expect(securitySchemes[SIGN_IN_SCHEME]).toMatchObject({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    expect(securitySchemes[API_KEY_SCHEME]).toMatchObject({ type: 'apiKey', in: 'header', name: 'X-Api-Key' })
    // middleware/auth.ts reads x-api-key, and a key starts with wp_live_ (lib/api-keys.ts)
    expect(source('middleware/auth.ts')).toContain("req.headers['x-api-key']")
    expect(source('lib/api-keys.ts')).toContain('`wp_live_${randomHex}`')
    expect(String(securitySchemes[API_KEY_SCHEME].description)).toContain('wp_live_')
  })

  it('describes the API as the code works: open by default, limits per client address, MIT, the developer page', () => {
    const { info } = spec
    expect(info.title).toBe('WorldPulse API')
    expect(info.description).not.toMatch(/Most endpoints require/i)
    expect(info.description).toMatch(/Most endpoints are open/)
    expect(info.description).toMatch(/per client address/)
    expect(info.description).not.toMatch(/per user/i)
    expect(info.description).toContain(DEVELOPERS_URL)
    expect(info.description).toContain('`data.accessToken`')
    expect(info.license).toEqual({ name: 'MIT', url: LICENSE_URL })
    expect(info.contact?.url).toBe('https://world-pulse.io/developers')
    expect(spec.externalDocs?.url).toBe('https://world-pulse.io/developers')
    expect(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'LICENSE'), 'utf8')).toMatch(/^MIT License/)
    // the version GET /api/v1/health reports, not a "1.0.0" release the code hasn't had
    expect(info.version).toBe(process.env.npm_package_version ?? '0.1.0')
  })

  it('says how to renew a sign-in token and what an operation answers without one', () => {
    const { description } = spec.info
    expect(description).toContain('send the answer\'s `data.refreshToken` to `POST /api/v1/auth/refresh`')
    // the words middleware/auth.ts answers with, and GET /auth/me's own
    expect(source('middleware/auth.ts')).toContain(`'${SIGN_IN_REQUIRED}'`)
    expect(description).toContain(`401 \`${SIGN_IN_REQUIRED}\``)
    expect(source('middleware/auth.ts')).toContain("'Invalid or expired token'")
    expect(description).toContain('401 `Invalid or expired token`')
    expect(source('routes/auth.ts')).toContain("return sendError(reply, 401, 'UNAUTHORIZED', 'Unauthorized')")
    expect(description).toContain('(`GET /api/v1/auth/me` answers `Unauthorized`)')
  })

  it('names the rate limits the code sets', () => {
    // 200 a minute shared by the routes without their own (lib/rate-limit-options.ts), 5 to sign in or register (routes/auth.ts)
    expect(source('lib/rate-limit-options.ts')).toMatch(new RegExp(`max:\\s+\\(req\\) => req\\.apiPlan\\?\\.perMinute \\?\\? ${SHARED_PER_MINUTE},`))
    // a Pro key's own budget (lib/api-plan.ts; Devon, Oct 21, 2026: 600 a minute, 50,000 a day)
    expect(spec.info.description).toContain('counts in its own budget: 600 requests a minute across the API, each read endpoint up to 10 times its own limit (at most 600), and 50,000 a day')
    expect(spec.info.description).toContain(`Endpoints without a limit of their own share one budget: ${SHARED_PER_MINUTE} requests a minute.`)
    expect(spec.info.description).toContain('counted for that endpoint alone')
    const auth = source('routes/auth.ts')
    expect(auth.match(/rateLimit: \{ max: 5, timeWindow: '1 minute' \}/g)?.length).toBe(2)
    expect(spec.info.description).toMatch(/5 a minute to sign in or register/)
    // a route with its own limit gets a counter of its own (@fastify/rate-limit's store.child keyed by the route)
    const plugin = readFileSync(createRequire(join(__dirname, 'api-docs.test.ts')).resolve('@fastify/rate-limit'), 'utf8')
    expect(plugin).toMatch(/newPluginComponent\.store = pluginComponent\.store\.child\(mergedRateLimitParams\)/)
  })

  it('describes the stories tag routes/stories.ts gives its routes', () => {
    expect(source('routes/stories.ts')).toContain("routeOptions.schema.tags = routeOptions.schema.tags ?? ['stories']")
    expect((spec.tags ?? []).find(t => t.name === 'stories')?.description).toMatch(/how many outlets reported it/)
  })

  it('names the MCP server, open', () => {
    expect(spec.info.description).toContain('## AI assistants (MCP)')
    expect(spec.info.description).toContain('`POST /mcp` is an MCP server')
    expect(spec.info.description).toContain('no sign-in or key')
    expect(spec.info.description).toContain(`${DEVELOPERS_URL}#mcp`)
    expect((spec.tags ?? []).map(t => t.name)).toContain('mcp')
  })
})

describe('the OpenAPI document, over the API\'s own route files', () => {
  let spec: Spec
  beforeAll(async () => {
    spec = await docsOf(async (app) => {
      await app.register(registerAdminRoutes,      { prefix: '/api/v1/admin' })
      await app.register(registerAdminDigestRoutes, { prefix: '/api/v1/admin' })
      await app.register(registerDeveloperRoutes,  { prefix: '/api/v1/developer/keys' })
      await app.register(registerStixRoutes,       { prefix: '/api/v1/stix' })
      await app.register(registerSlopRoutes,       { prefix: '/api/v1/slop' })
      await app.register(registerPulseRoutes,      { prefix: '/api/v1/pulse' })
      await app.register(registerPublicRoutes,     { prefix: '/api/v1/public' })
      await app.register(registerAuthRoutes,       { prefix: '/api/v1/auth' })
      await app.register(registerMaritimeRoutes,   { prefix: '/api/v1/maritime' })
      await app.register(registerSignalRoutes,     { prefix: '/api/v1/signals' })
      await app.register(registerMcpRoutes,        { prefix: '/mcp' })
    })
  }, 30_000)

  it('hides every admin route, the PULSE operator routes and the preflights', () => {
    const paths = Object.keys(spec.paths)
    expect(paths.filter(p => p.startsWith('/api/v1/admin'))).toEqual([])
    for (const p of ['/api/v1/pulse/publish/flash', '/api/v1/pulse/check-flash', '/api/v1/pulse/agents/scan', '/api/v1/pulse/signals/top']) {
      expect(paths).not.toContain(p)
    }
    // the public PULSE reads stay
    expect(paths).toEqual(expect.arrayContaining(['/api/v1/pulse/feed', '/api/v1/pulse/latest']))
    expect(Object.values(spec.paths).filter(ops => 'options' in ops)).toEqual([])
    // a prefix's own route is named without the trailing slash
    expect(paths.filter(p => p.length > 1 && p.endsWith('/'))).toEqual([])
  })

  it('hides the two admin-only signal operations outside /admin, and keeps the rest of their paths', () => {
    // each handler answers 403 to any account that isn't an admin
    const signals = source('routes/signals.ts')
    const handler = (start: string) => {
      const from = signals.indexOf(start)
      expect(from, start).toBeGreaterThan(-1)
      const rest = signals.slice(from + start.length)
      return rest.slice(0, rest.search(/\bapp\.(get|post|put|patch|delete)\(/))
    }
    for (const start of ["app.delete('/:id', {", "app.get('/:id/slop-score', {"]) {
      expect(handler(start)).toMatch(/if \(!actor \|\| actor\.account_type !== 'admin'\) \{\s*return sendError\(reply, 403,/)
    }
    expect(Object.keys(spec.paths['/api/v1/signals/{id}']).sort()).toEqual(['get', 'patch'])
    expect(spec.paths['/api/v1/signals/{id}/slop-score']).toBeUndefined()
    expect(spec.paths['/api/v1/signals/{id}'].patch.security).toEqual([{ [SIGN_IN_SCHEME]: [] }])
    expect(spec.paths['/api/v1/signals/{id}'].get.security).toBeUndefined()
  })

  it('marks the API-key routes (STIX, the slop checks) and the sign-in routes (keys and webhooks)', () => {
    for (const p of ['/api/v1/stix/signals', '/api/v1/stix/signals/{id}', '/api/v1/stix/feed']) {
      expect(spec.paths[p]?.get?.security, p).toEqual([{ [API_KEY_SCHEME]: [] }])
    }
    expect(spec.paths['/api/v1/slop/check'].post.security).toEqual([{ [API_KEY_SCHEME]: [] }])
    expect(spec.paths['/api/v1/slop/batch'].post.security).toEqual([{ [API_KEY_SCHEME]: [] }])
    const keys = spec.paths['/api/v1/developer/keys']
    expect(keys?.get?.security).toEqual([{ [SIGN_IN_SCHEME]: [] }])
    expect(keys?.post?.security).toEqual([{ [SIGN_IN_SCHEME]: [] }])
    expect(spec.paths['/api/v1/developer/keys/webhooks'].post.security).toEqual([{ [SIGN_IN_SCHEME]: [] }])
    expect(spec.paths['/api/v1/developer/keys/webhooks/{webhookId}/deliveries'].get.security).toEqual([{ [SIGN_IN_SCHEME]: [] }])
    // open reads stay open
    expect(spec.paths['/api/v1/public/signals'].get.security).toBeUndefined()
    expect(spec.paths['/api/v1/slop/farms'].get.security).toBeUndefined()
    expect(spec.paths['/api/v1/pulse/feed'].get.security).toBeUndefined()
    expect(spec.paths['/api/v1/pulse/feed'].get.description ?? '').not.toContain('Rate limit:')
  })

  it('lists the MCP server like the other open routes, with its own limit and an example to try', () => {
    const mcp = spec.paths['/mcp']
    expect(Object.keys(mcp)).toEqual(['post'])  // GET and DELETE only answer 405
    expect(mcp.post.security).toBeUndefined()
    expect(mcp.post.tags).toEqual(['mcp'])
    expect(mcp.post.description).toContain('Read-only and open: no sign-in or key.')
    expect(source('routes/mcp.ts')).toMatch(/app\.post\('\/', \{\s*schema: POST_DOCS,\s*bodyLimit: 64 \* 1024,\s*config: \{ rateLimit: \{ max: 60, timeWindow: '1 minute' \} \}/)
    expect(mcp.post.description).toContain('Rate limit: 60 requests a minute per client address, counted for this endpoint alone.')
    expect(mcp.post.requestBody?.content['application/json']?.example).toEqual({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    // every tool the server has, by name (five since check_link)
    const names = TOOLS.map(t => t.name)
    expect(names.length).toBeGreaterThanOrEqual(5)
    expect(mcp.post.description).toContain(`Its tools: ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}.`)
    expect(mcp.post.description).toContain('check_link')
  })

  it('says a sign-in token lasts 24 hours, as issueTokens signs it', () => {
    const data = spec.paths['/api/v1/auth/login'].post.responses?.['200']?.content?.['application/json']?.schema as
      { properties: { data: { properties: Record<string, { description?: string }> } } }
    const tokens = data.properties.data.properties
    expect(source('routes/auth.ts')).toContain("app.jwt.sign({ id: userId }, { expiresIn: '24h' })")
    expect(tokens.accessToken.description).toContain('good for 24 hours')
    expect(tokens.accessToken.description).not.toMatch(/15 min/)
    expect(source('routes/auth.ts')).toContain('await redis.setex(`refresh:${refreshToken}`, 30 * 24 * 60 * 60, userId)')
    expect(tokens.refreshToken.description).toContain('good for 30 days, and only once')
  })

  it('gives /public/signals category examples that are categories', () => {
    const category = spec.paths['/api/v1/public/signals'].get.parameters?.find(p => p.name === 'category')
    const examples = category?.description?.match(/e\.g\. ([^)]*)\)/)?.[1].split(', ') ?? []
    expect(examples.length).toBeGreaterThan(0)
    // the database's category enum (init.sql and the values migration_hotfix.sql adds)
    const sql = ['init.sql', 'migration_hotfix.sql']
      .map(f => readFileSync(join(SRC, '..', '..', '..', 'infrastructure', 'docker', 'postgres', f), 'utf8')).join('\n')
    const enumValues = sql.match(/CREATE TYPE category\s+AS ENUM \(([\s\S]*?)\);/)?.[1] ?? ''
    const known = new Set([
      ...[...enumValues.matchAll(/'(\w+)'/g)].map(m => m[1]),
      ...[...sql.matchAll(/ALTER TYPE category ADD VALUE IF NOT EXISTS '(\w+)'/g)].map(m => m[1]),
    ])
    for (const name of examples) expect(known.has(name), name).toBe(true)
    expect(known.has('politics')).toBe(false)
  })

  it('describes /maritime/vessels as the news reports it serves', () => {
    const vessels = spec.paths['/api/v1/maritime/vessels'].get
    expect(source('routes/maritime.ts')).toContain(`.whereRaw("created_at > now() - interval '72 hours'")`)
    expect(vessels.summary).toContain('the last 3 days')
    expect(vessels.summary).toContain('not live ship positions')
    expect(vessels.summary).not.toMatch(/24-hour|AIS/)
  })

  it('no longer says the content-farm list is updated monthly', () => {
    const farms = spec.paths['/api/v1/slop/farms'].get
    expect(farms.description).not.toMatch(/Updated monthly/i)
    expect(farms.description).toContain('GET /api/v1/slop/stats gives its last update')
    expect(source('routes/slop.ts')).toContain("last_blocklist_update:      '2026-03-26'")
    expect(spec.paths['/api/v1/slop/batch'].post.description).toContain('whose account is still on a paid plan')
    expect(source('routes/slop.ts')).toContain("await maxKeyTier(ctx.userId) === 'free'")
  })

  it('lists ?only=entities and ?limit on /signals/:id/connections', () => {
    const connections = spec.paths['/api/v1/signals/{id}/connections'].get
    const query = (connections.parameters ?? []).filter(p => p.in === 'query').map(p => p.name)
    expect(query).toEqual(['only', 'limit'])
    expect(connections.description).toContain('With only=entities')
    expect(connections.description).toContain('Rate limit: 30 requests a minute')
  })
})

describe('the API registers the docs with these options', () => {
  it('in index.ts and in the static file script', () => {
    expect(source('index.ts')).toMatch(/app\.register\(swagger, openapiOptions\(\)\)/)
    expect(source(join('scripts', 'generate-openapi.ts'))).toMatch(/app\.register\(swagger, openapiOptions\(\)\)/)
  })
})
