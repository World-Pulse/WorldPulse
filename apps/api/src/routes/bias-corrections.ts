/**
 * bias-corrections.ts — Community crowdsourced bias correction routes
 *
 * Routes:
 *   POST   /sources/:id/bias-corrections           — submit a correction (auth required)
 *   GET    /sources/:id/bias-corrections           — list top pending corrections
 *   POST   /sources/:id/bias-corrections/:cid/vote — vote up/down (auth required)
 *   GET    /sources/:id/bias-corrections/summary   — summary + consensus flag
 */

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { authenticate } from '../middleware/auth'
import { sendError } from '../lib/errors'
import {
  submitCorrection,
  voteOnCorrection,
  getCorrections,
  getCorrectionSummary,
  VALID_BIAS_LABELS,
} from '../lib/bias-corrections'

export const registerBiasCorrectionsRoutes: FastifyPluginAsync = async app => {
  // ── POST /sources/:id/bias-corrections ──────────────────────────────────────
  // Submit a new bias correction suggestion (authenticated users only)
  app.post<{
    Params: { id: string }
    Body:   { suggested_label?: unknown; notes?: unknown }
  }>('/sources/:id/bias-corrections', { preHandler: [authenticate] }, async (req, reply) => {
    const sourceId = parseInt(req.params.id, 10)
    if (isNaN(sourceId)) return sendError(reply, 400, 'BAD_REQUEST', 'Invalid source id')

    const { suggested_label, notes } = req.body ?? {}

    if (!suggested_label || typeof suggested_label !== 'string') {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'suggested_label is required')
    }
    if (!(VALID_BIAS_LABELS as ReadonlyArray<string>).includes(suggested_label)) {
      return sendError(
        reply, 400, 'VALIDATION_ERROR',
        `suggested_label must be one of: ${VALID_BIAS_LABELS.join(', ')}`,
      )
    }
    if (notes !== undefined && typeof notes !== 'string') {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'notes must be a string')
    }
    if (typeof notes === 'string' && notes.length > 500) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'notes must be 500 characters or fewer')
    }

    // Verify source exists
    const source = await db('sources').where('id', sourceId).first('id')
    if (!source) return sendError(reply, 404, 'NOT_FOUND', 'Source not found')

    const userId = (req.user as { id: number | string }).id
    const id = await submitCorrection(
      db,
      sourceId,
      typeof userId === 'string' ? parseInt(userId, 10) : userId,
      suggested_label,
      typeof notes === 'string' ? notes : undefined,
    )

    return reply.status(201).send({ success: true, data: { id } })
  })

  // ── GET /sources/:id/bias-corrections/summary ───────────────────────────────
  // Must be registered BEFORE /:id/bias-corrections to avoid path collision
  app.get<{ Params: { id: string } }>(
    '/sources/:id/bias-corrections/summary',
    async (req, reply) => {
      const sourceId = parseInt(req.params.id, 10)
      if (isNaN(sourceId)) return sendError(reply, 400, 'BAD_REQUEST', 'Invalid source id')

      const source = await db('sources').where('id', sourceId).first('id')
      if (!source) return sendError(reply, 404, 'NOT_FOUND', 'Source not found')

      const summary = await getCorrectionSummary(db, sourceId)
      return reply.send({ success: true, data: summary })
    },
  )

  // ── GET /sources/:id/bias-corrections ───────────────────────────────────────
  // List top pending corrections (public)
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/sources/:id/bias-corrections',
    async (req, reply) => {
      const sourceId = parseInt(req.params.id, 10)
      if (isNaN(sourceId)) return sendError(reply, 400, 'BAD_REQUEST', 'Invalid source id')

      const limit = Math.min(parseInt(req.query.limit ?? '10', 10) || 10, 50)

      const source = await db('sources').where('id', sourceId).first('id')
      if (!source) return sendError(reply, 404, 'NOT_FOUND', 'Source not found')

      const corrections = await getCorrections(db, sourceId, limit)
      return reply.send({ success: true, data: corrections })
    },
  )

  // ── POST /sources/:id/bias-corrections/:cid/vote ────────────────────────────
  // Vote up (+1) or down (-1) on a correction (authenticated users only)
  app.post<{
    Params: { id: string; cid: string }
    Body:   { vote?: unknown }
  }>(
    '/sources/:id/bias-corrections/:cid/vote',
    { preHandler: [authenticate] },
    async (req, reply) => {
      const sourceId     = parseInt(req.params.id,  10)
      const correctionId = parseInt(req.params.cid, 10)
      if (isNaN(sourceId))     return sendError(reply, 400, 'BAD_REQUEST', 'Invalid source id')
      if (isNaN(correctionId)) return sendError(reply, 400, 'BAD_REQUEST', 'Invalid correction id')

      const { vote } = req.body ?? {}
      if (vote !== 1 && vote !== -1) {
        return sendError(reply, 400, 'VALIDATION_ERROR', 'vote must be 1 (upvote) or -1 (downvote)')
      }

      // Verify correction belongs to this source and is still pending
      const correction = await db('source_bias_corrections')
        .where('id', correctionId)
        .where('source_id', sourceId)
        .first('id', 'status')

      if (!correction) return sendError(reply, 404, 'NOT_FOUND', 'Correction not found')
      if ((correction as { status: string }).status !== 'pending') {
        return sendError(reply, 409, 'CONFLICT', 'Correction is no longer pending')
      }

      const userId = (req.user as { id: number | string }).id
      await voteOnCorrection(
        db,
        redis,
        correctionId,
        typeof userId === 'string' ? parseInt(userId, 10) : userId,
        vote as 1 | -1,
      )

      return reply.send({ success: true })
    },
  )
}
