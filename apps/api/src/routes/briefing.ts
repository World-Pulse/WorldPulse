import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { generateDailyBriefing } from '../lib/briefing-generator'
import { staleWhileRevalidate, type SwrOptions } from '../lib/swr-cache'
import type { ListedStory } from '../lib/story-list'
import { topStories, storiesBetween } from './stories'

/** The last 24 hours: kept 10 minutes, then served for 6 hours while remade */
const TODAY_KEEP: SwrOptions = { freshSeconds: 600, staleSeconds: 6 * 3_600, lockSeconds: 120 }
/** A past day hardly changes: kept 6 hours, then served for a week while remade */
const PAST_DAY_KEEP: SwrOptions = { freshSeconds: 6 * 3_600, staleSeconds: 7 * 86_400, lockSeconds: 120 }
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** Stories shown, and ranked before the category filter */
const SHOWN = 20
const RANKED = 80

/** A real day (2026-10-20, not 2026-13-45) */
function validDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false
  const t = new Date(`${d}T00:00:00.000Z`)
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d
}

type Lead = { summary: string | null; reliability_score: number; country_code: string | null }

/**
 * The briefing's stories (Daily Briefing upgrade, plan 9, Oct 20, 2026): the
 * day's stories two or more outlets reported, each event once, ranked as the
 * home page ranks them (outlets, severity, how recent; a past day by outlets
 * and severity only), each with its lead report's summary, score and country.
 * It listed the 20 most severe single reports instead: the same story
 * several times (two of Sudan's drone strike reports on Oct 20), reports one
 * outlet carried with a 33% reliability, and an outlet count of 0 for most,
 * from a column the news readers leave empty. News only (editorial
 * standards): low-severity culture, sports and "other" are left out.
 */
async function briefingDay(date: string | undefined): Promise<{ stories: ListedStory[]; leads: Record<string, Lead> }> {
  const ranked = date
    ? await storiesBetween(new Date(`${date}T00:00:00.000Z`), new Date(`${date}T23:59:59.999Z`), RANKED)
    : await topStories(24, RANKED)
  const stories = ranked.filter(s => !(['culture', 'sports', 'other'].includes(s.category ?? 'other') && ['low', 'info'].includes(s.severity)))
  const rows = stories.length
    ? await db('signals').whereIn('id', stories.map(s => s.leadId)).select('id', 'summary', 'reliability_score', 'country_code') as
      Array<{ id: string; summary: string | null; reliability_score: string | number | null; country_code: string | null }>
    : []
  const leads: Record<string, Lead> = {}
  for (const r of rows) leads[String(r.id)] = { summary: r.summary ?? null, reliability_score: Number(r.reliability_score ?? 0), country_code: r.country_code ?? null }
  return { stories, leads }
}

/** The response for one category (or all): the first 20 stories, grouped by category */
export function briefingResponse(targetDate: string, day: { stories: ListedStory[]; leads: Record<string, Lead> }, category: string | null) {
  const stories = day.stories.filter(s => !category || s.category === category).slice(0, SHOWN)
  const sectionMap = new Map<string, Array<Record<string, unknown>>>()
  for (const s of stories) {
    const l = day.leads[s.leadId]
    const cat = s.category ?? 'other'
    if (!sectionMap.has(cat)) sectionMap.set(cat, [])
    sectionMap.get(cat)!.push({
      id:                s.leadId,
      story_id:          s.id,
      title:             s.title,
      summary:           l?.summary ?? null,
      severity:          s.severity,
      reliability_score: l?.reliability_score ?? 0,
      location_name:     s.place,
      country_code:      l?.country_code ?? null,
      category:          cat,
      published_at:      s.firstSeenAt,
      updated_at:        s.updatedAt,
      // how many outlets (websites) reported the story; source_count is kept for older readers of this API
      source_count:      s.outletCount,
      outlet_count:      s.outletCount,
      outlets:           s.outlets,
      verified:          Boolean(s.verifiedAt),
    })
  }
  const sections = [...sectionMap.entries()].map(([cat, signals]) => ({ category: cat, signals }))

  const locationCounts = new Map<string, number>()
  for (const s of stories) if (s.place) locationCounts.set(s.place, (locationCounts.get(s.place) ?? 0) + 1)
  const top_locations = [...locationCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([location_name, count]) => ({ location_name, count }))

  const severity_breakdown = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const s of stories) {
    const sev = s.severity as keyof typeof severity_breakdown
    if (sev in severity_breakdown) severity_breakdown[sev]++
  }

  return {
    success: true,
    data: {
      date:           targetDate,
      generated_at:   new Date().toISOString(),
      headline_count: stories.length,
      sections,
      top_locations,
      severity_breakdown,
    },
  }
}

// ─── Route Plugin ─────────────────────────────────────────────────────────────

export const registerBriefingDailyRoutes: FastifyPluginAsync = async (app) => {

  // Auto-tag all routes in this plugin
  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['briefing']
  })

  // ─── GET /api/v1/briefing/daily ──────────────────────────────────────────────
  // The day's top 20 stories (two outlets or more, each event once) from the
  // last 24h (or the specified date), grouped by category. Kept 10 minutes
  // (a past day 6 hours). Public, no auth.
  app.get('/daily', {
    schema: {
      summary: 'Get structured daily intelligence briefing',
      description: [
        'Returns the top 20 stories from the last 24 hours (or the specified date):',
        'each event once, reported by two or more outlets, ranked by outlets, severity and how recent,',
        'each with its lead report, its outlet count and whether it is verified.',
        'Grouped by category. Kept 10 minutes. No authentication required.',
      ].join(' '),
      querystring: {
        type: 'object',
        properties: {
          date:     { type: 'string', description: 'ISO date (YYYY-MM-DD). Defaults to today.' },
          category: { type: 'string', description: 'Filter to a single category (e.g. conflict, climate).' },
        },
      },
      response: {
        400: {
          type: 'object',
          properties: { success: { type: 'boolean' }, code: { type: 'string' }, error: { type: 'string' } },
        },
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                date:            { type: 'string' },
                generated_at:    { type: 'string' },
                headline_count:  { type: 'integer' },
                sections: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      category: { type: 'string' },
                      signals: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id:                { type: 'string' },
                            title:             { type: 'string' },
                            summary:           { type: ['string', 'null'] },
                            severity:          { type: 'string' },
                            reliability_score: { type: 'number' },
                            location_name:     { type: ['string', 'null'] },
                            country_code:      { type: ['string', 'null'] },
                            category:          { type: 'string' },
                            published_at:      { type: 'string' },
                            updated_at:        { type: 'string' },
                            story_id:          { type: 'string' },
                            source_count:      { type: 'integer', description: 'Outlets (websites) that reported the story, as outlet_count' },
                            outlet_count:      { type: 'integer' },
                            outlets:           { type: 'array', items: { type: 'string' } },
                            verified:          { type: 'boolean' },
                          },
                        },
                      },
                    },
                  },
                },
                top_locations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      location_name: { type: 'string' },
                      count:         { type: 'integer' },
                    },
                  },
                },
                severity_breakdown: {
                  type: 'object',
                  properties: {
                    critical: { type: 'integer' },
                    high:     { type: 'integer' },
                    medium:   { type: 'integer' },
                    low:      { type: 'integer' },
                  },
                },
              },
            },
          },
        },
        429: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error:   { type: 'string' },
            code:    { type: 'string' },
          },
        },
      },
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    try {
    const { date, category } = req.query as { date?: string; category?: string }
    if (date !== undefined && !validDate(date)) {
      return reply.code(400).send({ success: false, code: 'VALIDATION_ERROR', error: 'date must be a day such as 2026-10-20' })
    }
    const targetDate = date ?? new Date().toISOString().slice(0, 10)
    const wanted = category && category !== 'all' ? category : null

    // The day's stories (a story is every outlet's report of one event), kept
    // per day, 10 minutes for the last 24 hours, and served while one process
    // remakes them; a category is picked from them, so it costs nothing more
    const day = await staleWhileRevalidate(`briefing:daily:v2:${date ?? '24h'}`, date ? PAST_DAY_KEEP : TODAY_KEEP, () => briefingDay(date))
    return reply.send(briefingResponse(targetDate, day, wanted))
    } catch (err) {
      req.log.error({ err }, 'briefing/daily: handler error')
      return reply.send({
        success: true,
        data: {
          date: new Date().toISOString().slice(0, 10),
          generated_at: new Date().toISOString(),
          headline_count: 0,
          sections: [],
          top_locations: [],
          severity_breakdown: { critical: 0, high: 0, medium: 0, low: 0 },
        },
      })
    }
  })

  // ─── GET /api/v1/briefing/structured ────────────────────────────────────────
  // Returns the AI-generated 7-section structured briefing (with caching).
  // No auth required — public endpoint.
  app.get('/structured', {
    schema: {
      tags: ['briefing'],
      summary: 'Get AI-generated structured daily briefing with 7 fixed sections',
    },
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    try {
      const briefing = await generateDailyBriefing(24)
      return reply.send(briefing)
    } catch (err) {
      req.log.error({ err }, 'briefing/structured: handler error')
      return reply.status(500).send({ success: false, error: 'Failed to generate structured briefing' })
    }
  })
}
