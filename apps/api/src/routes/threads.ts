/**
 * Event Threads API — Phase 1.6.2
 *
 * Persistent event threads that track developing stories over weeks.
 *
 * GET /api/v1/threads          — List active threads
 * GET /api/v1/threads/:id      — Thread detail with timeline
 * GET /api/v1/threads/active    — Count of active threads by status
 *
 * @module routes/threads
 */

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'

const CACHE_TTL = 120 // 2 min

export const registerThreadRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['threads']
  })

  // ─── List threads ──────────────────────────────────────────
  app.get('/', {
    schema: {
      summary: 'List Event Threads',
      description: 'Active event threads tracking developing stories',
      querystring: {
        type: 'object',
        properties: {
          status:   { type: 'string', enum: ['developing', 'escalating', 'stable', 'resolved', 'all'], default: 'all' },
          category: { type: 'string' },
          region:   { type: 'string' },
          limit:    { type: 'number', default: 20 },
          offset:   { type: 'number', default: 0 },
        },
      },
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { status = 'all', category, region, limit = 20, offset = 0 } = req.query as {
      status?: string; category?: string; region?: string; limit?: number; offset?: number
    }

    const cacheKey = `threads:list:${status}:${category ?? ''}:${region ?? ''}:${limit}:${offset}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))

    let query = db('event_threads')
      .orderByRaw("CASE status WHEN 'escalating' THEN 0 WHEN 'developing' THEN 1 WHEN 'stable' THEN 2 ELSE 3 END")
      .orderBy('last_updated', 'desc')
      .limit(Math.min(limit, 50))
      .offset(offset)

    if (status !== 'all') {
      query = query.where('status', status)
    } else {
      // By default exclude resolved threads older than 30 days
      query = query.where(function () {
        this.whereNot('status', 'resolved')
          .orWhere('resolved_at', '>=', db.raw("CURRENT_TIMESTAMP - INTERVAL '30 days'"))
      })
    }

    if (category) query = query.where('category', category)
    if (region)   query = query.where('region', 'ilike', `%${region}%`)

    const threads = await query

    // Get total count for pagination
    let countQuery = db('event_threads')
    if (status !== 'all') countQuery = countQuery.where('status', status)
    if (category) countQuery = countQuery.where('category', category)
    const countResult = await countQuery.count('* as count').first()

    const result = {
      success: true,
      threads: threads.map(formatThread),
      total: Number((countResult as any)?.count ?? 0),
      limit,
      offset,
    }

    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result)).catch(() => {})
    return reply.send(result)
  })

  // ─── Thread detail ─────────────────────────────────────────
  app.get('/:id', {
    schema: {
      summary: 'Event Thread Detail',
      description: 'Full thread with signal timeline and severity trajectory',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }

    const thread = await db('event_threads').where('id', id).first()
    if (!thread) {
      return reply.status(404).send({ success: false, error: 'Thread not found' })
    }

    // Get all signals in this thread with their details
    const signals = await db('event_thread_signals as ets')
      .join('signals as s', 'ets.signal_id', 's.id')
      .where('ets.thread_id', id)
      .select(
        's.id', 's.title', 's.category', 's.severity',
        's.location_name', 's.reliability_score', 's.source_count',
        's.published_at', 's.created_at',
        'ets.role',
      )
      .orderBy('s.published_at', 'asc')

    return reply.send({
      success: true,
      thread: formatThread(thread),
      signals,
      timeline: {
        first_signal: signals[0]?.published_at ?? null,
        latest_signal: signals[signals.length - 1]?.published_at ?? null,
        duration_hours: signals.length >= 2
          ? Math.round((new Date(signals[signals.length - 1]!.published_at).getTime() -
              new Date(signals[0]!.published_at).getTime()) / 3600000)
          : 0,
      },
    })
  })

  // ─── Active thread summary ─────────────────────────────────
  app.get('/active/summary', {
    schema: {
      summary: 'Active Thread Summary',
      description: 'Count of threads by status',
    },
  }, async (_req, reply) => {
    const cacheKey = 'threads:active:summary'
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))

    const counts = await db('event_threads')
      .select('status')
      .count('* as count')
      .groupBy('status')

    const byStatus: Record<string, number> = {}
    for (const row of counts as any[]) {
      byStatus[row.status] = Number(row.count)
    }

    const result = {
      success: true,
      developing: byStatus.developing ?? 0,
      escalating: byStatus.escalating ?? 0,
      stable: byStatus.stable ?? 0,
      resolved: byStatus.resolved ?? 0,
      total_active: (byStatus.developing ?? 0) + (byStatus.escalating ?? 0),
      generated_at: new Date().toISOString(),
    }

    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result)).catch(() => {})
    return reply.send(result)
  })
}

function formatThread(t: any) {
  return {
    ...t,
    severity_trajectory: typeof t.severity_trajectory === 'string'
      ? JSON.parse(t.severity_trajectory)
      : t.severity_trajectory ?? [],
    related_entities: typeof t.related_entities === 'string'
      ? JSON.parse(t.related_entities)
      : t.related_entities ?? [],
  }
}
