/**
 * Follow a story (plan 8; Devon, Oct 21, 2026: "Yes, add it"), for signed-in
 * readers, under /api/v1/stories:
 *   GET    /following          the stories this reader follows, news first
 *   GET    /:id/follow         following or not, and what changed since the last visit
 *   PUT    /:id/follow         follow
 *   DELETE /:id/follow         stop following
 *   POST   /:id/follow/seen    the reader has seen the story as it is now
 * :id is a story's id or the id of any signal in it (as GET /stories/:id).
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { authenticate } from '../middleware/auth'
import { sendError } from '../lib/errors'
import {
  followsReady, storyKeyOf, followState, followStory, unfollowStory, markStorySeen, followedStories, MAX_FOLLOWS,
} from '../lib/story-follows'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIMIT = { rateLimit: { max: 30, timeWindow: '1 minute' } }

export const registerStoryFollowRoutes: FastifyPluginAsync = async (app) => {
  /** The story :id belongs to, or an error sent (null) */
  async function storyOf(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    if (!followsReady()) { void sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'Following is starting up. Please try again in a minute.'); return null }
    const { id } = req.params as { id: string }
    if (!UUID_RE.test(id)) { void sendError(reply, 400, 'VALIDATION_ERROR', 'id: must be a story or signal id'); return null }
    const key = await storyKeyOf(id.toLowerCase())
    if (!key) { void sendError(reply, 404, 'NOT_FOUND', 'Story not found'); return null }
    return key
  }

  app.get('/following', { preHandler: [authenticate], config: LIMIT }, async (req, reply) => {
    if (!followsReady()) return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'Following is starting up. Please try again in a minute.')
    return reply.send({ success: true, data: { stories: await followedStories(req.user!.id) } })
  })

  app.get('/:id/follow', { preHandler: [authenticate], config: LIMIT }, async (req, reply) => {
    const key = await storyOf(req, reply)
    if (!key) return reply
    return reply.send({ success: true, data: { storyId: key, ...(await followState(req.user!.id, key)) } })
  })

  app.put('/:id/follow', { preHandler: [authenticate], config: LIMIT }, async (req, reply) => {
    const key = await storyOf(req, reply)
    if (!key) return reply
    if (!(await followStory(req.user!.id, key))) {
      return sendError(reply, 409, 'CONFLICT', `You follow ${MAX_FOLLOWS} stories already: stop following one first.`)
    }
    return reply.send({ success: true, data: { storyId: key, ...(await followState(req.user!.id, key)) } })
  })

  app.delete('/:id/follow', { preHandler: [authenticate], config: LIMIT }, async (req, reply) => {
    const key = await storyOf(req, reply)
    if (!key) return reply
    await unfollowStory(req.user!.id, key)
    return reply.send({ success: true, data: { storyId: key, following: false } })
  })

  app.post('/:id/follow/seen', { preHandler: [authenticate], config: LIMIT }, async (req, reply) => {
    const key = await storyOf(req, reply)
    if (!key) return reply
    await markStorySeen(req.user!.id, key)
    return reply.send({ success: true })
  })
}
