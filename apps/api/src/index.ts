import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
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
import { registerNotificationRoutes } from './routes/notifications'
import { registerUploadRoutes } from './routes/uploads'
import { registerWSHandler } from './ws/handler'
import { metricsPlugin } from './middleware/metrics'
import { logger } from './lib/logger'
import { setupSearchIndexes } from './lib/search'
import { connectSearchProducer, disconnectSearchProducer } from './lib/search-events'
import { startSearchConsumer, stopSearchConsumer } from './lib/search-consumer'
import { initClickHouse } from './lib/search-analytics'

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

  // ─── HEALTH ──────────────────────────────────────────────
  app.get('/health', async () => {
    const [pgOk, redisOk] = await Promise.allSettled([
      db.raw('SELECT 1'),
      redis.ping(),
    ])
    return {
      status: 'ok',
      version: process.env.npm_package_version ?? '0.1.0',
      postgres: pgOk.status === 'fulfilled' ? 'ok' : 'error',
      redis:    redisOk.status === 'fulfilled' ? 'ok' : 'error',
      uptime:   process.uptime(),
      timestamp: new Date().toISOString(),
    }
  })

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

  // ─── WEBSOCKET ───────────────────────────────────────────
  await app.register(registerWSHandler)

  // ─── SEARCH INDEX SETUP ──────────────────────────────────
  setupSearchIndexes().catch(err => {
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

  // ─── GRACEFUL SHUTDOWN ────────────────────────────────────
  const shutdown = async () => {
    await Promise.allSettled([
      stopSearchConsumer(),
      disconnectSearchProducer(),
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
