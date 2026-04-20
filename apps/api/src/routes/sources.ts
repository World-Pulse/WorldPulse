import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { optionalAuth, authenticate } from '../middleware/auth'
import { z } from 'zod'
import { logger } from '../lib/logger'
import { getSourceBias, extractDomain } from '../lib/source-bias'
import { sendError } from '../lib/errors'

const ReviewSuggestionSchema = z.object({
  status: z.enum(['approved', 'rejected']),
})

const SuggestSourceSchema = z.object({
  name:     z.string().min(2).max(255),
  url:      z.string().url().max(512),
  rss_url:  z.string().url().max(512).optional().or(z.literal('')),
  category: z.enum([
    'breaking', 'conflict', 'geopolitics', 'climate', 'health',
    'economy', 'technology', 'science', 'elections', 'culture',
    'disaster', 'security', 'sports', 'space', 'other',
  ]),
  reason: z.string().min(20).max(2000),
})

export const registerSourceRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['sources']
  })

  // ─── LIST SOURCES ──────────────────────────────────────────
  app.get('/', { preHandler: [optionalAuth] }, async (req, reply) => {
    const { tier, category, limit = 50, offset = 0 } = req.query as {
      tier?: string; category?: string; limit?: number; offset?: number
    }

    let query = db('sources')
      .where('active', true)
      .orderBy([
        { column: 'trust_score', order: 'desc' },
        { column: 'name', order: 'asc' },
      ])
      .limit(Math.min(Number(limit), 200))
      .offset(Number(offset))
      .select([
        'id', 'slug', 'name', 'description', 'url', 'logo_url',
        'tier', 'trust_score', 'language', 'country',
        'categories', 'article_count', 'last_scraped', 'created_at',
      ])

    if (tier) query = query.where('tier', tier)
    if (category) query = query.whereRaw('? = ANY(categories)', [category])

    const sources = await query
    const [activeCount, allCount] = await Promise.all([
      db('sources').where('active', true).count('id as count').first(),
      db('sources').count('id as count').first(),
    ])

    return reply.send({
      success: true,
      data: {
        items: sources,
        total: Number(activeCount?.count ?? 0),
        totalAll: Number(allCount?.count ?? 0),
      },
    })
  })

  // ─── SOURCE DETAIL ─────────────────────────────────────────
  app.get('/:slug', { preHandler: [optionalAuth] }, async (req, reply) => {
    const { slug } = req.params as { slug: string }

    const source = await db('sources')
      .where('slug', slug)
      .where('active', true)
      .first()

    if (!source) {
      return sendError(reply, 404, 'NOT_FOUND', 'Source not found')
    }

    return reply.send({ success: true, data: source })
  })

  // ─── SUGGEST A SOURCE ──────────────────────────────────────
  app.post('/suggest', { preHandler: [optionalAuth] }, async (req, reply) => {
    const body = SuggestSourceSchema.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid input',
        details: body.error.flatten().fieldErrors,
        code: 'VALIDATION_ERROR',
      })
    }

    const { name, url, rss_url, category, reason } = body.data

    // Check for duplicate URL suggestion
    const existing = await db('source_suggestions')
      .where('url', url)
      .where('status', 'pending')
      .first('id')

    if (existing) {
      return reply.status(409).send({
        success: false,
        error: 'A suggestion for this source URL is already pending review',
        code: 'DUPLICATE_SUGGESTION',
      })
    }

    // Also check if source already exists
    const sourceExists = await db('sources').where('url', url).first('id')
    if (sourceExists) {
      return reply.status(409).send({
        success: false,
        error: 'This source is already in the WorldPulse database',
        code: 'SOURCE_EXISTS',
      })
    }

    const [suggestion] = await db('source_suggestions')
      .insert({
        user_id:  req.user?.id ?? null,
        name:     name.trim(),
        url:      url.trim(),
        rss_url:  rss_url?.trim() || null,
        category,
        reason:   reason.trim(),
        status:   'pending',
      })
      .returning(['id', 'name', 'url', 'category', 'status', 'created_at'])

    logger.info({ suggestionId: suggestion.id, name, url }, 'New source suggestion received')

    return reply.status(201).send({
      success: true,
      data: suggestion,
      message: 'Thank you for your suggestion! We review all submissions within 48 hours.',
    })
  })

  // ─── ADMIN: LIST SUGGESTIONS ───────────────────────────────
  app.get('/suggestions/list', { preHandler: [authenticate] }, async (req, reply) => {
    // Only allow admin/expert accounts
    if (!req.user || !['official', 'expert'].includes(req.user.accountType)) {
      return sendError(reply, 403, 'FORBIDDEN', 'Admin access required')
    }

    const { status = 'pending', limit = 50 } = req.query as {
      status?: string; limit?: number
    }

    const suggestions = await db('source_suggestions as ss')
      .leftJoin('users as u', 'ss.user_id', 'u.id')
      .where('ss.status', status)
      .orderBy('ss.created_at', 'asc')
      .limit(Math.min(Number(limit), 100))
      .select([
        'ss.id', 'ss.name', 'ss.url', 'ss.rss_url', 'ss.category',
        'ss.reason', 'ss.status', 'ss.created_at',
        'u.handle as submitter_handle',
        'u.display_name as submitter_name',
      ])

    return reply.send({ success: true, data: suggestions })
  })

  // ─── SOURCE BIAS ───────────────────────────────────────────
  app.get('/:id/bias', { preHandler: [optionalAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string }

    const source = await db('sources')
      .where('id', id)
      .where('active', true)
      .first(['id', 'url'])

    if (!source) {
      return sendError(reply, 404, 'NOT_FOUND', 'Source not found')
    }

    const domain = extractDomain(source.url as string)
    const bias   = await getSourceBias(domain)

    return reply.send({ success: true, data: bias })
  })

  // ─── BIAS DISTRIBUTION ─────────────────────────────────────
  app.get('/bias-distribution', { preHandler: [optionalAuth] }, async (req, reply) => {
    const rows = await db('sources')
      .where('active', true)
      .whereNot('bias_label', 'unknown')
      .groupBy('bias_label')
      .select('bias_label')
      .count('id as count')

    const distribution: Record<string, number> = {}
    for (const row of rows) {
      distribution[row.bias_label as string] = Number(row.count)
    }

    return reply.send({ success: true, data: distribution })
  })

  // ─── ADMIN: REVIEW SUGGESTION ──────────────────────────────
  app.patch('/suggestions/:id', { preHandler: [authenticate] }, async (req, reply) => {
    if (!req.user || !['official', 'expert'].includes(req.user.accountType)) {
      return sendError(reply, 403, 'FORBIDDEN', 'Admin access required')
    }

    const { id } = req.params as { id: string }
    const reviewParsed = ReviewSuggestionSchema.safeParse(req.body)
    if (!reviewParsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Status must be approved or rejected')
    }
    const { status } = reviewParsed.data

    const suggestion = await db('source_suggestions').where('id', id).first()
    if (!suggestion) {
      return sendError(reply, 404, 'NOT_FOUND', 'Suggestion not found')
    }

    await db('source_suggestions')
      .where('id', id)
      .update({
        status,
        reviewer_id: req.user.id,
        reviewed_at: new Date(),
      })

    return reply.send({ success: true, message: `Suggestion ${status}` })
  })
}
