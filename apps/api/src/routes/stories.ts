/**
 * Stories: the signals the scraper's same-story rule linked (signals.story_id,
 * plan item 12b). GET /api/v1/stories/:id lists them oldest first, so a page
 * can show when each outlet picked the story up and when it turned verified.
 */

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { optionalAuth } from '../middleware/auth'
import { sendError } from '../lib/errors'
import { signalsHaveStoryIds, hostOf } from '../lib/stories'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SIGNALS = 50

export const registerStoryRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['stories']
  })

  /**
   * GET /api/v1/stories/:id
   * One story's signals, oldest first. :id is a storyId from
   * /api/v1/feed/signals?group=story, or the id of any signal in the story.
   */
  app.get('/:id', { preHandler: [optionalAuth], config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!UUID_RE.test(id)) return sendError(reply, 400, 'VALIDATION_ERROR', 'id: must be a story or signal id')

    const hasStories = await signalsHaveStoryIds()
    let storyId = id
    if (hasStories) {
      const row = await db('signals').where('id', id).first('story_id') as { story_id?: string | null } | undefined
      if (row?.story_id) storyId = String(row.story_id)
    }

    const members = await db('signals')
      .whereIn('status', ['verified', 'pending'])
      .where(function () {
        if (hasStories) this.where('story_id', storyId).orWhere('id', storyId)
        else this.where('id', storyId)
      })
      .orderBy('created_at', 'asc')
      .limit(MAX_SIGNALS)
      .select([
        'id', 'title', 'status', 'severity', 'category', 'reliability_score',
        'original_urls', 'location_name', 'created_at', 'verified_at',
      ]) as Array<Record<string, unknown>>
    if (members.length === 0) return sendError(reply, 404, 'NOT_FOUND', 'Story not found')

    const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null)
    const verifiedTimes = members.map(m => iso(m.verified_at)).filter((t): t is string => t !== null).sort()

    return reply.send({
      success: true,
      data: {
        storyId,
        size: members.length,
        verifiedAt: verifiedTimes[0] ?? null,
        signals: members.map(m => {
          // A signal's own article comes first; the story's other links follow it
          const urls = Array.isArray(m.original_urls) ? (m.original_urls as unknown[]).map(String) : []
          return {
            id:               m.id,
            title:            m.title,
            status:           m.status,
            severity:         m.severity,
            category:         m.category,
            reliabilityScore: Number(m.reliability_score ?? 0),
            outlet:           hostOf(urls[0]),
            url:              urls[0] ?? null,
            locationName:     m.location_name ?? null,
            createdAt:        iso(m.created_at),
            verifiedAt:       iso(m.verified_at),
          }
        }),
      },
    })
  })
}
