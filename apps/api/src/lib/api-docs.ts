/**
 * The interactive API docs: the OpenAPI document Swagger UI shows at
 * /api/docs (plan V3i, Oct 20, 2026).
 *
 * Until then the docs said "Most endpoints require a Bearer JWT" (most need
 * nothing), marked only the 4 operations that need a sign-in token and set
 * schema.security themselves (GET /auth/me and billing's 3) and none that
 * take an API key, listed the admin routes, and counted rate limits "per
 * user" (they are counted per client address). Both the running API
 * (index.ts) and the static file (scripts/generate-openapi.ts) now build the
 * document from openapiOptions(), whose transform reads each route's own
 * checks:
 *  - routes whose hooks include authenticate (middleware/auth.ts) take a
 *    sign-in token: security bearerAuth
 *  - routes with apiKeyAuth, or routes/slop.ts's own authenticateApiKey,
 *    take an API key: security apiKeyAuth
 *  - every other route needs neither (optionalAuth only personalizes)
 * and leaves out the internal routes: /api/v1/admin/*, the two admin-only
 * signal operations outside it (INTERNAL_OPERATIONS), /metrics, the load
 * balancer's /health, Stripe's webhook and the PULSE operator routes
 * (requirePulseKey, the server's own PULSE_API_KEY), and the CORS preflight
 * answers (OPTIONS: browsers send those, not developers).
 * A route that sets schema.security itself keeps it. A route with a rate
 * limit of its own (config.rateLimit) says so in its description.
 * The MCP server (POST /mcp, routes/mcp.ts) is public and listed like the
 * other open routes.
 */
import type { FastifySchema, RouteOptions } from 'fastify'
import type { FastifyDynamicSwaggerOptions, SwaggerTransform } from '@fastify/swagger'
import { authenticate, apiKeyAuth } from '../middleware/auth'
import { PRO_KEY_LIMITS, ROUTE_MULTIPLIER } from './api-plan'

/** Where the guides and code examples are */
export const DEVELOPERS_URL = 'https://world-pulse.io/developers'
/** How webhook deliveries are signed, and the WebSocket stream, which this document can't list */
export const DOCS_API_URL = 'https://world-pulse.io/docs/api'
/** The API keys page */
export const API_KEYS_URL = 'https://world-pulse.io/developer'
/** The code's license (no terms are set here for the hosted API or its data) */
export const LICENSE_URL = 'https://github.com/World-Pulse/WorldPulse/blob/main/LICENSE'

/** The OpenAPI security scheme names (bearerAuth is the one route schemas already use) */
export const SIGN_IN_SCHEME = 'bearerAuth'
export const API_KEY_SCHEME = 'apiKeyAuth'

/** The API-wide limit (lib/rate-limit-options.ts), shared by the routes without their own */
export const SHARED_PER_MINUTE = 200

/** What a route takes, as the docs show it */
export type DocsAccess = 'none' | 'signin' | 'apikey' | 'internal'

/**
 * Paths kept out of the docs: these routes serve the people and machines
 * that run WorldPulse, not developers. A prefix covers itself and what's below it.
 */
export const INTERNAL_PATHS = [
  '/api/v1/admin',           // admin.ts, admin-kafka.ts and digest.ts's admin routes: admin accounts only
  '/metrics',                // the server's own Prometheus counters
  '/health',                 // the load balancer's ping (/api/v1/health stays: the status page reads it)
  '/api/v1/billing/webhook', // Stripe's callback, signed with Stripe's secret
] as const

/**
 * Operations outside /api/v1/admin that only admin accounts may use (their
 * handlers answer 403 to every other account), as Fastify spells the path
 */
export const INTERNAL_OPERATIONS = [
  'DELETE /api/v1/signals/:id',          // routes/signals.ts: deletes a signal
  'GET /api/v1/signals/:id/slop-score',  // routes/signals.ts: "not exposed in public API"
] as const

type Hook = (...args: never[]) => unknown

/** The API's shared checks */
const SIGN_IN_CHECKS = new Set<unknown>([authenticate])
const API_KEY_CHECKS = new Set<unknown>([apiKeyAuth])
/** Checks a route file keeps to itself (not exported), known by their function names */
const API_KEY_CHECK_NAMES = new Set(['authenticateApiKey']) // routes/slop.ts: X-API-Key or Bearer wp_live_…
const INTERNAL_CHECK_NAMES = new Set(['requirePulseKey'])   // routes/pulse.ts: the server's PULSE_API_KEY

type RouteHooks = Partial<Pick<RouteOptions, 'onRequest' | 'preParsing' | 'preValidation' | 'preHandler'>>
type DocsRoute = RouteHooks & { method?: string | string[]; config?: unknown }

/** A route's own hooks (the ones in its options, which is where every route here puts its checks) */
function hooksOf(route: RouteHooks | undefined): Hook[] {
  if (!route) return []
  const out: Hook[] = []
  for (const h of [route.onRequest, route.preParsing, route.preValidation, route.preHandler] as unknown[]) {
    if (Array.isArray(h)) out.push(...h.filter((f): f is Hook => typeof f === 'function'))
    else if (typeof h === 'function') out.push(h as Hook)
  }
  return out
}

export function isInternalPath(url: string): boolean {
  const path = url.split('?')[0] ?? ''
  return INTERNAL_PATHS.some(p => path === p || path.startsWith(`${p}/`))
}

/** A route's methods, upper case */
function methodsOf(route?: DocsRoute): string[] {
  return route?.method === undefined ? [] : ([] as string[]).concat(route.method).map(m => m.toUpperCase())
}

/** One of INTERNAL_OPERATIONS (every method the route answers is) */
export function isInternalOperation(url: string, route?: DocsRoute): boolean {
  const path = url.split('?')[0] ?? ''
  const methods = methodsOf(route)
  return methods.length > 0 && methods.every(m => (INTERNAL_OPERATIONS as readonly string[]).includes(`${m} ${path}`))
}

/** What a route takes, from its path, its method and its own checks */
export function routeAccess(url: string, route?: DocsRoute): DocsAccess {
  if (isInternalPath(url) || isInternalOperation(url, route)) return 'internal'
  const hooks = hooksOf(route)
  if (hooks.some(h => INTERNAL_CHECK_NAMES.has(h.name))) return 'internal'
  if (hooks.some(h => API_KEY_CHECKS.has(h) || API_KEY_CHECK_NAMES.has(h.name))) return 'apikey'
  if (hooks.some(h => SIGN_IN_CHECKS.has(h))) return 'signin'
  return 'none'
}

/** A CORS preflight answer (OPTIONS only) */
function isPreflight(route?: DocsRoute): boolean {
  const methods = methodsOf(route)
  return methods.length > 0 && methods.every(m => m === 'OPTIONS')
}

const UNIT_MS: Record<string, number> = { second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000 }

/** A time window as @fastify/rate-limit takes it (milliseconds, or words such as '1 minute') */
function windowMs(w: unknown): number | null {
  if (typeof w === 'number') return w > 0 ? w : null
  if (typeof w !== 'string') return null
  const m = w.trim().toLowerCase().match(/^(\d+)\s*(second|minute|hour|day)s?$/)
  return m ? Number(m[1]) * (UNIT_MS[m[2]!] ?? 0) || null : null
}

/** A route's own rate limit (its config.rateLimit), or null when it shares the API-wide one */
export function ownRateLimit(route?: { config?: unknown }): { max: number; windowMs: number } | null {
  const rl = (route?.config as { rateLimit?: { max?: unknown; timeWindow?: unknown } } | undefined)?.rateLimit
  if (!rl || typeof rl !== 'object' || typeof rl.max !== 'number') return null
  const ms = windowMs(rl.timeWindow ?? '1 minute')
  return ms ? { max: rl.max, windowMs: ms } : null
}

/** "Rate limit: 30 requests a minute …" */
export function rateLimitNote(limit: { max: number; windowMs: number }): string {
  const unit = Object.entries(UNIT_MS).reverse().find(([, ms]) => limit.windowMs % ms === 0)
  const count = unit ? limit.windowMs / unit[1] : limit.windowMs / 1_000
  const name = unit ? unit[0] : 'second'
  const per = count === 1 ? `${name === 'hour' ? 'an' : 'a'} ${name}` : `every ${count} ${name}s`
  return `Rate limit: ${limit.max} requests ${per} per client address, counted for this endpoint alone.`
}

/**
 * A prefix's own route ('/' under '/mcp') is answered with and without the
 * trailing slash; the docs name it as everyone does: POST /mcp, not /mcp/
 */
export function docsPath(url: string): string {
  return url.length > 1 && url.endsWith('/') ? url.slice(0, -1) : url
}

/** Marks each operation with what it takes and its own limit, and hides the internal ones */
export const docsTransform: SwaggerTransform = ({ schema, url: routeUrl, route }) => {
  const docsRoute = route as DocsRoute | undefined
  const url = docsPath(routeUrl)
  const access = routeAccess(url, docsRoute)
  if (access === 'internal' || isPreflight(docsRoute)) return { schema: { ...schema, hide: true }, url }
  const out: FastifySchema & { description?: string } = { ...schema }
  const limit = ownRateLimit(docsRoute)
  if (limit) {
    const own = typeof out.description === 'string' && out.description.trim() ? `${out.description}\n\n` : ''
    out.description = `${own}${rateLimitNote(limit)}`
  }
  // A route that names its own security keeps it (e.g. GET /auth/me)
  if (!schema?.security && access !== 'none') {
    out.security = [{ [access === 'apikey' ? API_KEY_SCHEME : SIGN_IN_SCHEME]: [] }]
  }
  return { schema: out, url }
}

/** What middleware/auth.ts answers a request with no sign-in token */
export const SIGN_IN_REQUIRED = 'Sign-in required: send your sign-in token as "Authorization: Bearer <token>"'

const DESCRIPTION = [
  'The REST API behind world-pulse.io: world events (signals), stories, search, feeds, map layers and country data.',
  'The code is open source under the MIT license.',
  '',
  `Guides and code examples: [world-pulse.io/developers](${DEVELOPERS_URL}). How webhook deliveries are signed, and the WebSocket stream (\`wss://api.world-pulse.io/ws\`, not listed below): [world-pulse.io/docs/api](${DOCS_API_URL}).`,
  '',
  '## What an endpoint needs',
  'Most endpoints are open: no sign-in or key needed. An operation with a lock takes one of two credentials, and neither works in place of the other:',
  '',
  `- **bearerAuth**, a sign-in token from any free account: \`POST /api/v1/auth/login\` answers it as \`data.accessToken\`. It lasts 24 hours; for a new one, send the answer's \`data.refreshToken\` to \`POST /api/v1/auth/refresh\`. Send \`Authorization: Bearer <accessToken>\`. Without a token, these operations answer 401 \`${SIGN_IN_REQUIRED}\` (\`GET /api/v1/auth/me\` answers \`Unauthorized\`); with an invalid or expired one, 401 \`Invalid or expired token\`.`,
  `- **apiKeyAuth**, an API key made on [the API keys page](${API_KEYS_URL}); every key starts with \`wp_live_\`. Send \`X-Api-Key: <key>\`. The STIX export (\`/api/v1/stix/…\`) and the AI content-farm checks (\`POST /api/v1/slop/check\` and \`/slop/batch\`) take one, and answer 401 without a valid key.`,
  '',
  'Use **Authorize** to send one with "Try it out".',
  '',
  '## AI assistants (MCP)',
  `\`POST /mcp\` is an MCP server (Model Context Protocol) for AI assistants such as Claude. It is read-only and open: no sign-in or key. How to connect one: [world-pulse.io/developers#mcp](${DEVELOPERS_URL}#mcp).`,
  '',
  '## Rate limits',
  `Requests are counted per client address, whatever credential they carry, except a Pro API key's. Endpoints without a limit of their own share one budget: ${SHARED_PER_MINUTE} requests a minute. Many endpoints have a limit of their own, counted for that endpoint alone (5 a minute to sign in or register), and each of those says so below.`,
  `A Pro API key ([WorldPulse Pro](https://world-pulse.io/pricing), $12 a month), sent as \`X-Api-Key\`, counts in its own budget: ${PRO_KEY_LIMITS.perMinute} requests a minute across the API, each read endpoint up to ${ROUTE_MULTIPLIER} times its own limit (at most ${PRO_KEY_LIMITS.perMinute}), and ${PRO_KEY_LIMITS.perDay.toLocaleString('en-US')} a day (it starts again at midnight UTC). A free key counts like no key.`,
  'Answers carry `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (seconds until the count starts again); past the limit the API answers 429 with `Retry-After`.',
].join('\n')

/** The OpenAPI document's options, for @fastify/swagger */
export function openapiOptions(): FastifyDynamicSwaggerOptions {
  return {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'WorldPulse API',
        description: DESCRIPTION,
        // The API's own version, as GET /api/v1/health reports it (paths are under /api/v1)
        version: process.env.npm_package_version ?? '0.1.0',
        contact: { name: 'WorldPulse developers', url: DEVELOPERS_URL },
        license: { name: 'MIT', url: LICENSE_URL },
      },
      externalDocs: { description: 'Guides and code examples', url: DEVELOPERS_URL },
      servers: [
        { url: 'https://api.world-pulse.io', description: 'Production' },
        { url: 'http://localhost:3001', description: 'Local development' },
      ],
      // (no "admin" tag: those routes are left out, and Swagger UI shows a listed tag even when empty)
      tags: [
        { name: 'auth',          description: 'Sign up, sign in and sign-in tokens' },
        { name: 'public',        description: 'Open endpoints for developers: verified signals and their categories' },
        // routes/stories.ts tags its routes "stories"; without an entry here Swagger UI lists them last, undescribed
        { name: 'stories',       description: 'Stories: the reports of one event, with how many outlets reported it. The top stories now, one story with its reports, a week\'s top stories, the story of a news link, outlet counts for a list of signals, and a story\'s figures (people killed, injured, displaced…) with the outlets that report each' },
        { name: 'mcp',           description: 'The MCP server for AI assistants: read-only, no sign-in or key' },
        { name: 'feed',          description: 'Global feed, following feed, trending' },
        { name: 'signals',       description: 'World events (signals): lists, one signal in full, its sources and checks, map layers' },
        { name: 'posts',         description: 'User-generated content & threads' },
        { name: 'search',        description: 'Search: full text, by meaning, autocomplete, and sanctioned people and companies' },
        { name: 'users',         description: 'User profiles, follows, notifications' },
        { name: 'communities',   description: 'Topic communities' },
        { name: 'polls',         description: 'Polls attached to posts' },
        { name: 'sources',       description: 'News sources & trust tiers' },
        { name: 'alerts',        description: 'User alert subscriptions' },
        { name: 'analytics',     description: 'Global indexes (threat, escalation), market prices, signal counts and trending names; GET /analytics/me is your own engagement' },
        { name: 'notifications', description: 'Your notifications, push device tokens and alert channels (Telegram, Discord, Slack, Teams, email)' },
        { name: 'uploads',       description: 'Media uploads' },
        { name: 'developer',     description: 'API keys and outbound webhooks' },
        { name: 'embed',         description: 'Public embeddable widgets' },
        { name: 'stix',          description: 'STIX 2.1 threat intelligence export' },
        { name: 'briefings',     description: 'AI-powered daily intelligence briefings' },
        { name: 'breaking-alerts', description: 'Real-time breaking news alert banners' },
        { name: 'cameras',         description: 'Public road and weather cameras, and each one\'s latest picture' },
        { name: 'maritime',        description: 'Ships and the sea: live ships in the main straits (AIS, while its feed runs), naval and shipping news with a place, chokepoints' },
        { name: 'threats',         description: 'Missile and drone threat intelligence — ballistic, cruise, hypersonic, rocket, UAV' },
        { name: 'jamming',         description: 'GPS/GNSS jamming intelligence — military EW, spoofing, civilian interference zones' },
        { name: 'rss',             description: 'Atom and JSON feeds of verified stories, and an OPML list of the feeds' },
        { name: 'bundles',         description: 'Ed25519-signed bundles of the newest verified signals' },
        { name: 'digest',          description: 'Weekly/daily email digest subscriptions' },
        { name: 'finance',         description: 'Financial intelligence — market signals, central bank alerts, crypto, sanctions' },
      ],
      components: {
        securitySchemes: {
          [SIGN_IN_SCHEME]: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Sign-in token from any free account: data.accessToken in the answer of POST /api/v1/auth/login (it lasts 24 hours). API keys are not accepted here.',
          },
          [API_KEY_SCHEME]: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Api-Key',
            description: `API key, made on ${API_KEYS_URL} (every key starts with wp_live_). Authorization: Bearer wp_live_… works too. Sign-in tokens are not accepted here.`,
          },
        },
      },
    },
    hideUntagged: false,
    transform: docsTransform,
    refResolver: {
      buildLocalReference: (json, _baseUri, _fragment, i) =>
        (json.$id as string | undefined) ?? `model-${i}`,
    },
  }
}
