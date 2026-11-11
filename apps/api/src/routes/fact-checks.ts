/**
 * The latest fact-checks WorldPulse reads (Nov 11, 2026; lib/fact-checks.ts): fact-checkers' own feeds,
 * each check's headline, the claim it checked and the checker's rating where the feed gives them, credited
 * and linked to the check. Nothing here is WorldPulse's own ruling.
 *   GET /api/v1/fact-checks                     the latest checks, and each checker's last read
 *   GET /api/v1/fact-checks?checker=full-fact   one checker's
 */

import type { FastifyPluginAsync } from 'fastify'
import { CHECKER_SITES, loadFactChecks, shown } from '../lib/fact-checks'

export const registerFactCheckRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { checker?: string; limit?: number } }>('/', {
    schema: {
      summary: "The latest fact-checks from the fact-checkers WorldPulse reads, in the checkers' own words, linked",
      querystring: { type: 'object', properties: {
        checker: { type: 'string', pattern: '^[a-z0-9-]{2,40}$' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 40 },
      } },
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const loaded = await loadFactChecks()
    const checkers = Object.entries(CHECKER_SITES).map(([id, c]) => {
      const status = loaded?.checkers.find(s => s.id === id)
      return { id, name: c.name, url: c.url, ok: status?.ok ?? null, readAt: status?.read_at ?? null, inFeed: status?.items ?? null }
    })
    if (!loaded) {
      return reply.send({ success: true, data: {
        available: false, checkers, items: [],
        message: 'The fact-checkers\' feeds haven\'t been read yet: they come a few minutes after the scraper starts, then every 30 minutes.',
      } })
    }
    const items = loaded.items
      .map(i => i.check)
      .filter(c => !req.query.checker || c.checker === req.query.checker)
      .slice(0, req.query.limit ?? 40)
      .map(shown)
    return reply.header('Cache-Control', 'public, max-age=300').send({
      success: true,
      data: {
        available: true, readAt: loaded.updatedAt, checkers, items,
        note: "Each check is the fact-checker's own work, in its own words, linked to it. WorldPulse doesn't rule on claims.",
      },
    })
  })
}
