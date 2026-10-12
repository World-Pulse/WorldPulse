import type { RateLimitPluginOptions } from '@fastify/rate-limit'
import type Redis from 'ioredis'
import { buildCfAwareKeyGenerator } from '../middleware/cloudflare'

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
 */
export function rateLimitOptions(redis: Redis): RateLimitPluginOptions {
  return {
    max:         200,
    timeWindow:  '1 minute',
    redis,
    skipOnError: true,
    keyGenerator: buildCfAwareKeyGenerator,
    errorResponseBuilder: (_req, context) => ({
      statusCode: context.statusCode,   // 429, or 403 once a client is banned
      code:       'RATE_LIMITED',
      message:    'Too many requests. Slow down.',
    }),
  }
}
