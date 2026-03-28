import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import swagger from '@fastify/swagger'
import swaggerUI from '@fastify/swagger-ui'
import { redis } from './db/redis'
import { db } from './db/postgres'
import { registerFeedRoutes } from './routes/feed'
import { registerAuthRoutes } from './routes/auth'
import { registerPostRoutes } from './routes/posts'
import { registerSignalRoutes } from './routes/signals'
import { registerSearchRoutes } from './routes/search'
import { registerUserRoutes } from './routes/users'
import { registerAlertRoutes } from './routes/alerts'
import { registerAnalyticsRoutes } from './routes/analytics'
import { registerCommunityRoutes } from './routes/communities'
import { registerPollRoutes } from './routes/polls'
import { registerSourceRoutes } from './routes/sources'
import { registerAdminRoutes } from './routes/admin'
import { registerDeveloperRoutes } from './routes/developer'
import { registerEmbedRoutes } from './routes/embed'
import { registerStixRoutes } from './routes/stix'
import { registerPublicRoutes } from './routes/public'
import { registerNotificationRoutes } from './routes/notifications'
import { registerUploadRoutes } from './routes/uploads'
import { registerBriefingRoutes } from './routes/briefings'
import { registerCountryRoutes } from './routes/countries'
import { registerBreakingRoutes } from './routes/breaking'
import { registerTradeRoutes } from './routes/trade'
import { registerCameraRoutes } from './routes/cameras'
import { registerPatentRoutes } from './routes/patents'
import { registerMaritimeRoutes } from './routes/maritime'
import { registerThreatsRoutes }  from './routes/threats'
import { registerWSHandler } from './ws/handler'
import { registerGraphQL } from './graphql'
import { metricsPlugin } from './middleware/metrics'
import { requestLoggerPlugin } from './middleware/request-logger'
import { registerHealthRoutes } from './routes/health'
import { logger } from './lib/logger'
import { initSentry, flushSentry } from './lib/sentry'
import { meili, setupSearchIndexes, indexSignals } from './lib/search'
import { connectSearchProducer, disconnectSearchProducer } from './lib/search-events'
import { startSearchConsumer, stopSearchConsumer } from './lib/search-consumer'
import { initClickHouse } from './lib/search-analytics'
import { startDispatcher, stopDispatcher } from './lib/alert-dispatcher'

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
  trustProxy: true,
})

async function bootstrap() {
  // ─── SENTRY (optional, env-gated) ────────────────────────
  initSentry()

  // ─── PLUGINS ─────────────────────────────────────────────
  const isDev = process.env.NODE_ENV !== 'production'
  const allowedOrigins = isDev
    ? [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3000',
        ...(process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
      ]
    : [
        'https://worldpulse.io',
        'https://www.worldpulse.io',
        ...(process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
      ]

  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (server-to-server, curl, etc.)
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, true)
      } else {
        cb(new Error(`CORS: origin '${origin}' not allowed`), false)
      }
    },
    credentials: true,
  })

  // ─── SECURITY HEADERS (helmet) ────────────────────────────
  // Must be registered after CORS so helmet doesn't override CORS headers.
  await app.register(helmet, {
    // Content-Security-Policy: locked down for an API-only server.
    // The Swagger UI at /api/docs needs inline styles/scripts, so we
    // use a relaxed policy only for that prefix via the contentSecurityPolicy
    // override below; all other routes get the strict policy.
    contentSecurityPolicy: {
      directives: {
        defaultSrc:     ["'none'"],
        scriptSrc:      ["'self'"],
        styleSrc:       ["'self'"],
        imgSrc:         ["'self'", 'data:'],
        connectSrc:     ["'self'"],
        fontSrc:        ["'self'"],
        objectSrc:      ["'none'"],
        mediaSrc:       ["'none'"],
        frameSrc:       ["'none'"],
        frameAncestors: ["'none'"],
        formAction:     ["'self'"],
        baseUri:        ["'none'"],
        upgradeInsecureRequests: isDev ? null : [],
      },
    },
    // X-Frame-Options: DENY — no iframing of the API
    frameguard: { action: 'deny' },
    // X-Content-Type-Options: nosniff
    noSniff: true,
    // Referrer-Policy: strict-origin-when-cross-origin
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // Strict-Transport-Security: 1 year + includeSubDomains (prod only)
    hsts: isDev ? false : { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    // X-DNS-Prefetch-Control: off
    dnsPrefetchControl: { allow: false },
    // X-Download-Options: noopen (IE)
    ieNoOpen: true,
    // X-Permitted-Cross-Domain-Policies: none
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    // Cross-Origin-Opener-Policy
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    // Cross-Origin-Resource-Policy
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })

  await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? 'dev_secret_change_in_prod',
    sign:   { expiresIn: '15m' },
  })

  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    redis,
    keyGenerator: (req) => req.headers['x-user-id'] as string ?? req.ip,
    errorResponseBuilder: () => ({
      success: false,
      error: 'Too many requests. Slow down.',
      code: 'RATE_LIMITED',
    }),
  })

  await app.register(websocket)
  await app.register(metricsPlugin)
  await app.register(requestLoggerPlugin)

  // ─── SWAGGER / OPENAPI ───────────────────────────────────
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'WorldPulse API',
        description: [
          'Real-time global intelligence network.',
          '',
          '## Authentication',
          'Most endpoints require a Bearer JWT. Obtain tokens via `POST /api/v1/auth/login`.',
          'Pass the access token as `Authorization: Bearer <token>`.',
          '',
          '## Rate Limits',
          'Default: 200 req/min per user. Auth endpoints: 5 req/min.',
          'Rate-limit headers are included in every response.',
        ].join('\n'),
        version: '1.0.0',
        contact: {
          name: 'WorldPulse',
          url: 'https://worldpulse.io',
        },
        license: {
          name: 'MIT',
          url: 'https://opensource.org/licenses/MIT',
        },
      },
      servers: [
        { url: 'https://api.worldpulse.io', description: 'Production' },
        { url: 'http://localhost:3001', description: 'Local development' },
      ],
      tags: [
        { name: 'auth',          description: 'Authentication & session management' },
        { name: 'feed',          description: 'Global feed, following feed, trending' },
        { name: 'signals',       description: 'Verified world events / breaking signals' },
        { name: 'posts',         description: 'User-generated content & threads' },
        { name: 'search',        description: 'Full-text search & autocomplete' },
        { name: 'users',         description: 'User profiles, follows, notifications' },
        { name: 'communities',   description: 'Topic communities' },
        { name: 'polls',         description: 'Polls attached to posts' },
        { name: 'sources',       description: 'News sources & trust tiers' },
        { name: 'alerts',        description: 'User alert subscriptions' },
        { name: 'analytics',     description: 'Personal engagement analytics' },
        { name: 'notifications', description: 'Push notification device tokens' },
        { name: 'uploads',       description: 'Media uploads' },
        { name: 'developer',     description: 'Developer API keys' },
        { name: 'embed',         description: 'Public embeddable widgets' },
        { name: 'admin',         description: 'Admin-only operations' },
        { name: 'stix',          description: 'STIX 2.1 threat intelligence export' },
        { name: 'briefings',     description: 'AI-powered daily intelligence briefings' },
        { name: 'breaking-alerts', description: 'Real-time breaking news alert banners' },
        { name: 'cameras',         description: 'Live public CCTV/webcam feeds by region' },
        { name: 'maritime',        description: 'Naval intelligence — carrier strike groups and AIS vessel tracking' },
        { name: 'threats',         description: 'Missile and drone threat intelligence — ballistic, cruise, hypersonic, rocket, UAV' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http' as const,
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT access token from POST /api/v1/auth/login',
          },
        },
      },
    },
    // Strip internal/runtime fields from the spec
    hideUntagged: false,
    refResolver: {
      buildLocalReference: (json, _baseUri, _fragment, _i) =>
        (json.$id as string | undefined) ?? `model-${_i}`,
    },
  })

  await app.register(swaggerUI, {
    routePrefix: '/api/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      tryItOutEnabled: true,
      persistAuthorization: true,
    },
    staticCSP: true,
  })

  // ─── HEALTH ──────────────────────────────────────────────
  // Legacy shallow health check (for load-balancer pings)
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))
  // Enhanced per-service health check
  await app.register(registerHealthRoutes, { prefix: '/api/v1/health' })

  // ─── ROUTES ──────────────────────────────────────────────
  await app.register(registerAuthRoutes,   { prefix: '/api/v1/auth' })
  await app.register(registerFeedRoutes,   { prefix: '/api/v1/feed' })
  await app.register(registerPostRoutes,   { prefix: '/api/v1/posts' })
  await app.register(registerSignalRoutes, { prefix: '/api/v1/signals' })
  await app.register(registerSearchRoutes, { prefix: '/api/v1/search' })
  await app.register(registerUserRoutes,   { prefix: '/api/v1/users' })
  await app.register(registerAlertRoutes,     { prefix: '/api/v1/alerts' })
  await app.register(registerAnalyticsRoutes,  { prefix: '/api/v1/analytics' })
  await app.register(registerCommunityRoutes,  { prefix: '/api/v1/communities' })
  await app.register(registerPollRoutes,       { prefix: '/api/v1/polls' })
  await app.register(registerSourceRoutes,     { prefix: '/api/v1/sources' })
  await app.register(registerNotificationRoutes, { prefix: '/api/v1/notifications' })
  await app.register(registerUploadRoutes,       { prefix: '/api/v1/uploads' })
  await app.register(registerAdminRoutes,        { prefix: '/api/v1/admin' })
  await app.register(registerDeveloperRoutes,    { prefix: '/api/v1/developer/keys' })
  await app.register(registerEmbedRoutes,        { prefix: '/api/v1/embed' })
  await app.register(registerStixRoutes,         { prefix: '/api/v1/stix' })
  await app.register(registerPublicRoutes,       { prefix: '/api/v1/public' })
  await app.register(registerBriefingRoutes,    { prefix: '/api/v1/briefings' })
  await app.register(registerCountryRoutes,     { prefix: '/api/v1/countries' })
  await app.register(registerBreakingRoutes,    { prefix: '/api/v1/breaking' })
  await app.register(registerTradeRoutes,       { prefix: '/api/v1/trade' })
  await app.register(registerCameraRoutes,      { prefix: '/api/v1/cameras' })
  await app.register(registerPatentRoutes,      { prefix: '/api/v1/patents' })
  await app.register(registerMaritimeRoutes,    { prefix: '/api/v1/maritime' })
  await app.register(registerThreatsRoutes,     { prefix: '/api/v1/threats' })

  // ─── GRAPHQL ─────────────────────────────────────────────
  await registerGraphQL(app)

  // ─── WEBSOCKET ───────────────────────────────────────────
  await app.register(registerWSHandler)

  // ─── SEARCH INDEX SETUP ──────────────────────────────────
  setupSearchIndexes()
    .then(async () => {
      // Backfill any signals not yet in MeiliSearch (e.g. from OSINT pollers
      // that insert directly to the DB, bypassing the API signals route).
      try {
        const stats = await meili.index('signals').getStats()
        if (stats.numberOfDocuments === 0) {
          logger.info('MeiliSearch signals index empty — backfilling from DB...')
          const rows = await db('signals')
            .select('*')
            .orderBy('created_at', 'desc')
            .limit(5000)
          await indexSignals(rows as Record<string, unknown>[])
          logger.info({ count: rows.length }, 'MeiliSearch backfill complete')
        }
      } catch (err) {
        logger.warn({ err }, 'MeiliSearch backfill failed — search may return empty results')
      }
    })
    .catch(err => {
      logger.warn({ err }, 'Meilisearch index setup failed — search may degrade gracefully')
    })

  // ─── CLICKHOUSE INIT ─────────────────────────────────────
  initClickHouse().catch(err => {
    logger.warn({ err }, 'ClickHouse init failed — search analytics will be silently skipped')
  })

  // ─── SEARCH KAFKA PRODUCER + CONSUMER ────────────────────
  // Both are non-fatal — routes fall back to direct Meilisearch calls.
  connectSearchProducer().catch(err => {
    logger.warn({ err }, 'Search producer failed to connect')
  })
  startSearchConsumer().catch(err => {
    logger.warn({ err }, 'Search consumer failed to start')
  })

  // ─── ALERT DISPATCHER ────────────────────────────────────
  // Non-fatal — starts 60s polling loop for Telegram/Discord alerts.
  startDispatcher()

  // ─── GRACEFUL SHUTDOWN ────────────────────────────────────
  const shutdown = async () => {
    stopDispatcher()
    await Promise.allSettled([
      stopSearchConsumer(),
      disconnectSearchProducer(),
      flushSentry(2000),
      app.close(),
    ])
    process.exit(0)
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT',  shutdown)

  // ─── START ───────────────────────────────────────────────
  const port = Number(process.env.PORT ?? 3001)
  await app.listen({ port, host: '0.0.0.0' })
  logger.info(`WorldPulse API running on port ${port}`)
}

bootstrap().catch((err) => {
  logger.error(err, 'Fatal startup error')
  process.exit(1)
})
