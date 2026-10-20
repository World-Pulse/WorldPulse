/**
 * Generate a static openapi.json file at docs/api-reference.json.
 *
 * Usage:
 *   pnpm --filter @worldpulse/api docs:generate
 *
 * This script registers the route files below (16 of them, not the whole
 * app) with the same docs options as the API's /api/docs (lib/api-docs.ts),
 * waits for the swagger plugin to collect their schemas, then writes the
 * OpenAPI spec to disk without listening on a port. The running API's
 * /api/docs lists the routes of every route file (plan V3i). The database
 * must answer: importing the route files connects to it (db/postgres.ts
 * stops the process when it can't).
 */
import path from 'node:path'
import fs from 'node:fs'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import { openapiOptions }             from '../lib/api-docs'
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

  // The options the API's /api/docs uses (lib/api-docs.ts): what each
  // operation needs and its own limit, without the admin routes
  await app.register(swagger, openapiOptions())

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
