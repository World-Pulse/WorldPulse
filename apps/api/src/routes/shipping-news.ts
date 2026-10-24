/**
 * Shipping headlines from Lloyd's List (Oct 23, 2026; Devon: "Add Lloyd's List data ... and layers to
 * the map").
 *
 * The scraper reads the news feed Lloyd's List offers websites (apps/scraper/src/sources/lloyds-list.ts):
 * headlines with their sectors and the countries and sea areas they're tagged with, each linking to the
 * article on lloydslist.com and shown credited to Lloyd's List. Nothing here is summarized or rewritten.
 *   GET /api/v1/maritime/headlines             the latest headlines and the places they're about
 *   GET /api/v1/maritime/headlines?country=GR  one country's
 */

import type { FastifyPluginAsync } from 'fastify'
import { loadJson } from './commodities'

export const HEADLINES_KEY = 'maritime:lloydslist:items'

interface Place { key: string; name: string; iso: string | null; lat: number | null; lon: number | null }
interface Headline { id: string; title: string; url: string; published: string; kind: string | null; sectors: string[]; topics: string[]; places: Place[] }
interface HeadlinesSnapshot { updated_at: string; source: string; source_url: string; items: Headline[] }

export const registerShippingNewsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { country?: string; limit?: number } }>('/headlines', {
    schema: {
      summary: "Shipping headlines from Lloyd's List (its free feed, credited), and the places they're about",
      querystring: { type: 'object', properties: {
        country: { type: 'string', pattern: '^[A-Za-z]{2}$' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 40 },
      } },
    },
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const snap = await loadJson<HeadlinesSnapshot>(HEADLINES_KEY)
    if (!snap) return reply.send({ success: true, data: { available: false, message: "Lloyd's List's headlines haven't been read yet: they come a few minutes after the scraper starts, then every 30 minutes." } })
    const country = req.query.country?.toUpperCase()
    const items = country ? snap.items.filter(i => i.places.some(p => p.iso === country)) : snap.items
    // Each place once, with how many headlines are about it and the newest one
    const places = new Map<string, Place & { count: number; latest: { title: string; url: string; published: string } }>()
    for (const item of items) {
      for (const p of item.places) {
        const known = places.get(p.key)
        if (known) known.count++
        else places.set(p.key, { ...p, count: 1, latest: { title: item.title, url: item.url, published: item.published } })
      }
    }
    return reply.header('Cache-Control', 'public, max-age=600').send({
      success: true,
      data: {
        available: true, updated_at: snap.updated_at,
        source: snap.source, source_url: snap.source_url, credit: `Headlines: ${snap.source} (lloydslist.com)`,
        items: items.slice(0, req.query.limit ?? 40),
        places: [...places.values()].sort((a, b) => b.count - a.count),
      },
    })
  })
}
