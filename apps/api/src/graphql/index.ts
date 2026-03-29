import type { FastifyInstance } from 'fastify'

/**
 * GraphQL via mercurius is temporarily disabled.
 *
 * mercurius 14.x requires Fastify 4.x — this project runs Fastify 5.8.x.
 * Re-enable once mercurius ships official Fastify 5 support, or swap to
 * a Fastify-5-compatible GraphQL library (e.g. graphql-yoga, pothos).
 *
 * All REST endpoints at /api/v1/* continue to work normally.
 */
export async function registerGraphQL(app: FastifyInstance): Promise<void> {
  app.log.warn(
    'GraphQL disabled — mercurius requires Fastify 4.x (installed: 5.x). ' +
    'REST API at /api/v1/* is fully operational.'
  )
}
