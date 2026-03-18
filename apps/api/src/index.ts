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
import { registerNotificationRoutes } from './routes/notifications'
import { registerUploadRoutes } from './routes/uploads'
import { registerWSHandler } from './ws/handler'
import { metricsPlugin } from './middleware/metrics'
import { logger } from './lib/logger'

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
  await app.register(cors, {
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
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

  // ─── WEBSOCKET ───────────────────────────────────────────
  await app.register(registerWSHandler)

  // ─── START ───────────────────────────────────────────────
  const port = Number(process.env.PORT ?? 3001)
  await app.listen({ port, host: '0.0.0.0' })
  logger.info(`🌍 WorldPulse API running on port ${port}`)
}

bootstrap().catch((err) => {
  logger.error(err, 'Fatal startup error')
  process.exit(1)
})
