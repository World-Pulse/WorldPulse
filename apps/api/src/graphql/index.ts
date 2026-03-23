import type { FastifyInstance } from 'fastify'
import mercurius from 'mercurius'
import { typeDefs } from './schema'
import { resolvers } from './resolvers'

export async function registerGraphQL(app: FastifyInstance): Promise<void> {
  const isDev = process.env.NODE_ENV !== 'production'

  await app.register(mercurius, {
    schema:    typeDefs,
    resolvers,
    graphiql:  isDev,
    path:      '/api/graphql',
    // Introspection enabled in all environments — this is a public differentiator
    jit:       1,
    context: (req) => ({ req }),
  })
}
