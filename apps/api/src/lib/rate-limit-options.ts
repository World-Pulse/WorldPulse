import type { FastifyRequest } from 'fastify'
import type { RateLimitPluginOptions } from '@fastify/rate-limit'
import type Redis from 'ioredis'
import { buildCfAwareKeyGenerator } from '../middleware/cloudflare'
import { internalCallClient } from './internal-call'
import { isSiteCall } from './site-calls'
import './api-plan' // req.apiPlan (lib/api-plan.ts sets it)

/**
 * Whose budget a request counts in: the signed-in user's or the client
 * address's, or, for a call the API makes to itself on a client's behalf
 * (an MCP tool asking a public route), that client's (lib/internal-call.ts).
 */
export function rateLimitKey(req: FastifyRequest): string {
  return internalCallClient(req.headers as Record<string, unknown>) ?? buildCfAwareKeyGenerator(req)
}

/**
 * The API-wide rate limit: 200 requests a minute per signed-in user or per
 * client address, counted in Redis.
 *
 * skipOnError (Oct 12, 2026): the server's disk filled, Redis stopped taking
 * writes, and every request, /health included, answered 500 because the
 * counter couldn't count it. A request the counter can't count is served,
 * not refused: the rest of the API mostly reads Postgres and keeps working.
 * Routes with their own limits inherit this.
 *
 * The plugin throws what errorResponseBuilder returns, and the API's error
 * handler (lib/error-reply.ts) answers with its statusCode. Without one, a
 * client over the limit got "500 Something went wrong on our side." instead
 * of 429, and each refusal was logged as a server error.
 *
 * allowList (plan D3, Oct 21, 2026): the website's own server, calling over
 * the server's private network, is never counted (lib/site-calls.ts); every
 * route's own limit keeps this list, since a route's options are laid over
 * these ones and none sets its own.
 *
 * Pro keys (plan V3d, Oct 21, 2026; lib/api-plan.ts): a request with a Pro
 * key counts in the key's own budget, 600 a minute, instead of the user's or
 * address's 200; read endpoints' own limits are raised for it there.
 */
export function rateLimitOptions(redis: Redis): RateLimitPluginOptions {
  return {
    max:         (req) => req.apiPlan?.perMinute ?? 200,
    timeWindow:  '1 minute',
    redis,
    skipOnError: true,
    keyGenerator: (req) => (req.apiPlan ? `key:${req.apiPlan.keyId}` : rateLimitKey(req)),
    allowList:   (req) => isSiteCall(req as { ip?: string; headers: Record<string, unknown> }),
    errorResponseBuilder: (_req, context) => ({
      statusCode: context.statusCode,   // 429, or 403 once a client is banned
      code:       'RATE_LIMITED',
      message:    'Too many requests. Slow down.',
    }),
  }
}
