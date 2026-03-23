/**
 * Generate a static openapi.json file at docs/api-reference.json.
 *
 * Usage:
 *   pnpm --filter @worldpulse/api docs:generate
 *
 * This script bootstraps the full Fastify app (without listening on a port),
 * waits for the swagger plugin to collect all route schemas, then writes the
 * OpenAPI spec to disk.  It is safe to run in CI — no external services are
 * required because all DB/Redis/Kafka connections are initiated lazily after
 * app.listen(), which we never call here.
 */
import path from 'node:path'
import fs from 'node:fs'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import { registerFeedRoutes }         from '../routes/feed'
import { registerAuthRoutes }         from '../routes/auth'
import { registerPostRoutes }         from '../routes/posts'
import { registerSignalRoutes }       from '../routes/signals'
import { registerSearchRoutes }       from '../routes/search'
import { registerUserRoutes }         from '../routes/users'
import { registerAlertRoutes }        from '../routes/alerts'
import { registerAnalyticsRoutes }    from '../routes/analytics'
import { registerCommunityRoutes }    from '../routes/communities'
import { registerPollRoutes }         from '../routes/polls'
import { registerSourceRoutes }       from '../routes/sources'
import { registerNotificationRoutes } from '../routes/notifications'
import { registerUploadRoutes }       from '../routes/uploads'
import { registerAdminRoutes }        from '../routes/admin'
import { registerDeveloperRoutes }    from '../routes/developer'
import { registerEmbedRoutes }        from '../routes/embed'

async function generate(): Promise<void> {
  const app = Fastify({ logger: false })

  // Minimal plugin setup — only what swagger needs to produce valid output.
  // We skip websocket, rate-limit Redis, Kafka, ClickHouse and other I/O plugins
  // that would require live connections.
  await app.register(cors, { origin: false })
  await app.register(jwt, {
    secret: 'generate-openapi-placeholder',
    sign:   { expiresIn: '15m' },
  })
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' })

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
        { url: 'http://localhost:3001',      description: 'Local development' },
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
    hideUntagged: false,
    refResolver: {
      buildLocalReference: (json, _baseUri, _fragment, _i) =>
        (json.$id as string | undefined) ?? `model-${_i}`,
    },
  })

  // ─── ROUTES ──────────────────────────────────────────────
  await app.register(registerAuthRoutes,        { prefix: '/api/v1/auth' })
  await app.register(registerFeedRoutes,        { prefix: '/api/v1/feed' })
  await app.register(registerPostRoutes,        { prefix: '/api/v1/posts' })
  await app.register(registerSignalRoutes,      { prefix: '/api/v1/signals' })
  await app.register(registerSearchRoutes,      { prefix: '/api/v1/search' })
  await app.register(registerUserRoutes,        { prefix: '/api/v1/users' })
  await app.register(registerAlertRoutes,       { prefix: '/api/v1/alerts' })
  await app.register(registerAnalyticsRoutes,   { prefix: '/api/v1/analytics' })
  await app.register(registerCommunityRoutes,   { prefix: '/api/v1/communities' })
  await app.register(registerPollRoutes,        { prefix: '/api/v1/polls' })
  await app.register(registerSourceRoutes,      { prefix: '/api/v1/sources' })
  await app.register(registerNotificationRoutes,{ prefix: '/api/v1/notifications' })
  await app.register(registerUploadRoutes,      { prefix: '/api/v1/uploads' })
  await app.register(registerAdminRoutes,       { prefix: '/api/v1/admin' })
  await app.register(registerDeveloperRoutes,   { prefix: '/api/v1/developer/keys' })
  await app.register(registerEmbedRoutes,       { prefix: '/api/v1/embed' })

  // Ready triggers plugin initialization (including swagger schema collection)
  await app.ready()

  const spec = app.swagger()

  // Write to docs/api-reference.json (repo root relative)
  const outPath = path.resolve(__dirname, '../../../../docs/api-reference.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n', 'utf-8')

  console.log(`OpenAPI spec written to ${outPath}`)
  console.log(`  Routes documented: ${Object.keys(spec.paths ?? {}).length} paths`)
  await app.close()
}

generate().catch((err) => {
  console.error('Failed to generate OpenAPI spec:', err)
  process.exit(1)
})
