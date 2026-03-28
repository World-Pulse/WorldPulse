import type { FastifyInstance } from 'fastify'
import mercurius from 'mercurius'
import { typeDefs } from './schema'
import { resolvers } from './resolvers'

/**
 * Registers the WorldPulse GraphQL API using mercurius.
 *
 * Endpoint:   POST /graphql   (queries & mutations)
 * Playground: GET  /graphiql  (disabled in production)
 * WebSocket:  ws://api.world-pulse.io/graphql  (subscriptions)
 *
 * Example query:
 *   query { signals(limit: 5) { nodes { id title severity } totalCount } }
 *
 * Example subscription (WebSocket):
 *   subscription { signalCreated { id title category severity } }
 *
 * Install dependencies:
 *   pnpm --filter @worldpulse/api add mercurius graphql
 */
export async function registerGraphQL(app: FastifyInstance): Promise<void> {
  await app.register(mercurius, {
    schema: typeDefs,
    resolvers: resolvers as Parameters<typeof mercurius>[1]['resolvers'],

    // Interactive GraphiQL playground — dev / staging only
    graphiql: process.env.NODE_ENV !== 'production',

    // Mount at /graphql (explicit for clarity)
    path: '/graphql',

    // Enable real-time subscriptions over WebSocket using the built-in
    // in-memory pubsub emitter. Publish events via app.graphql.pubsub.publish(...)
    subscription: true,

    // Surface execution errors through Fastify's structured logger
    errorHandler(err, _req, _reply) {
      app.log.warn({ err }, 'GraphQL execution error')
    },

    // Per-request context (extend with auth info when JWT middleware is added)
    context(_req, _reply) {
      return {}
    },
  })

  app.log.info('✓ GraphQL endpoint registered at /graphql (subscriptions enabled)')
}
