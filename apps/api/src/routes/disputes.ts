/**
 * Signal Dispute Routes — Classification Accuracy Tracking
 *
 * Users can flag signals as miscategorized, wrong severity, wrong location,
 * duplicate, spam, misleading, or outdated. Disputes are tracked and
 * aggregated to identify systematic classification errors.
 *
 * Endpoints:
 *   POST   /signals/:signalId/dispute  — Submit a dispute
 *   GET    /signals/:signalId/disputes — List disputes for a signal
 *   GET    /disputes/summary           — Aggregate dispute stats (admin)
 */

import type { FastifyPluginAsync } from 'fastify'
import { authenticate, optionalAuth } from '../middleware/auth'
import { db } from '../db/postgres'

export const registerDisputeRoutes: FastifyPluginAsync = async (app) => {

  /** Submit a dispute for a signal */
  app.post('/signals/:signalId/dispute', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = (req as any).user.id
    const { signalId } = req.params as any
    const body = req.body as any

    // Validate signal exists
    const signal = await db('signals').where('id', signalId).first('id', 'category', 'severity', 'location_name')
    if (!signal) return reply.code(404).send({ error: 'Signal not found' })

    // Prevent duplicate disputes from same user on same signal+type
    const existing = await db('signal_disputes')
      .where({ signal_id: signalId, user_id: userId, dispute_type: body.type })
      .first('id')
    if (existing) return reply.code(409).send({ error: 'You already submitted this type of dispute for this signal' })

    // Determine original value based on dispute type
    let originalValue: string | null = null
    if (body.type === 'wrong_category') originalValue = signal.category
    else if (body.type === 'wrong_severity') originalValue = signal.severity
    else if (body.type === 'wrong_location') originalValue = signal.location_name

    const [dispute] = await db('signal_disputes').insert({
      signal_id: signalId,
      user_id: userId,
      dispute_type: body.type,
      original_value: originalValue,
      suggested_value: body.suggested_value || null,
      reason: body.reason || null,
    }).returning('*')

    // Auto-resolve: if 3+ users dispute the same thing, apply correction
    const sameDisputes = await db('signal_disputes')
      .where({ signal_id: signalId, dispute_type: body.type, status: 'pending' })
      .count('id as count')

    if (Number(sameDisputes[0].count) >= 3 && body.suggested_value) {
      // Auto-apply correction
      const updateField = body.type === 'wrong_category' ? 'category'
        : body.type === 'wrong_severity' ? 'severity'
        : null

      if (updateField) {
        await db('signals').where('id', signalId).update({ [updateField]: body.suggested_value })
        await db('signal_disputes')
          .where({ signal_id: signalId, dispute_type: body.type, status: 'pending' })
          .update({ status: 'auto_resolved', resolved_at: db.raw('NOW()') })
      }
    }

    return reply.code(201).send(dispute)
  })

  /** List disputes for a signal */
  app.get('/signals/:signalId/disputes', { preHandler: [optionalAuth] }, async (req) => {
    const { signalId } = req.params as any
    const disputes = await db('signal_disputes')
      .where('signal_id', signalId)
      .orderBy('created_at', 'desc')
      .limit(50)

    return { items: disputes }
  })

  /** Aggregate dispute summary — patterns by category/type */
  app.get('/disputes/summary', { preHandler: [authenticate] }, async (req) => {
    const query = req.query as Record<string, string>
    const days = Math.min(Number(query.days) || 30, 90)
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    // Disputes by type
    const byType = await db('signal_disputes')
      .select('dispute_type')
      .count('id as count')
      .where('created_at', '>=', since.toISOString())
      .groupBy('dispute_type')
      .orderBy('count', 'desc')

    // Disputes by original category (which categories are most disputed?)
    const byCategory = await db('signal_disputes')
      .join('signals', 'signal_disputes.signal_id', 'signals.id')
      .select('signals.category')
      .count('signal_disputes.id as count')
      .where('signal_disputes.created_at', '>=', since.toISOString())
      .groupBy('signals.category')
      .orderBy('count', 'desc')

    // Most disputed sources
    const bySource = await db('signal_disputes')
      .join('signals', 'signal_disputes.signal_id', 'signals.id')
      .select(db.raw('signals.source_ids[1]::text as source_id'))
      .count('signal_disputes.id as count')
      .where('signal_disputes.created_at', '>=', since.toISOString())
      .groupByRaw('signals.source_ids[1]::text')
      .orderBy('count', 'desc')
      .limit(10)

    // Resolution stats
    const resolutionStats = await db('signal_disputes')
      .select('status')
      .count('id as count')
      .where('created_at', '>=', since.toISOString())
      .groupBy('status')

    // Auto-resolved count
    const [autoResolved] = await db('signal_disputes')
      .where('status', 'auto_resolved')
      .where('created_at', '>=', since.toISOString())
      .count('id as count')

    return {
      period_days: days,
      by_type: byType,
      by_category: byCategory,
      by_source: bySource,
      resolution: resolutionStats,
      auto_resolved: Number(autoResolved?.count ?? 0),
    }
  })
}
