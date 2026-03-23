import type { FastifyInstance } from 'fastify'

/**
 * GraphQL endpoint — disabled pending mercurius package installation.
 * To enable: add mercurius to pnpm-lock.yaml via `pnpm add mercurius`,
 * then restore the full implementation from git history.
 */
export async function registerGraphQL(_app: FastifyInstance): Promise<void> {
  // no-op stub — uncomment and restore when mercurius is installed
}
