import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { authenticate, optionalAuth } from '../middleware/auth'
import { z } from 'zod'

const CreatePollSchema = z.object({
  question:  z.string().min(1).max(500),
  options:   z.array(z.string().min(1).max(200)).min(2).max(4),
  expiresAt: z.string().datetime().optional(),
  postId:    z.string().uuid().optional(),
})

const VoteSchema = z.object({
  optionIndex: z.number().int().min(0).max(3),
})

export const registerPollRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['polls']
  })

  // ─── CREATE POLL ──────────────────────────────────────────
  app.post('/', { preHandler: [authenticate] }, async (req, reply) => {
    const body = CreatePollSchema.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ success: false, error: 'Invalid input', code: 'VALIDATION' })
    }

    const userId = req.user!.id
    const d = body.data

    // If postId provided, ensure the post exists and belongs to caller
    if (d.postId) {
      const post = await db('posts').where('id', d.postId).whereNull('deleted_at').first('id, author_id')
      if (!post) return reply.status(404).send({ success: false, error: 'Post not found' })
      if (post.author_id !== userId) return reply.status(403).send({ success: false, error: 'Forbidden' })
    }

    // Build options JSONB: [{text, votes: 0}, ...]
    const optionsData = d.options.map(text => ({ text, votes: 0 }))

    const [poll] = await db('polls')
      .insert({
        author_id:  userId,
        question:   d.question,
        options:    JSON.stringify(optionsData),
        expires_at: d.expiresAt ?? null,
        post_id:    d.postId ?? null,
      })
      .returning('*')

    const formatted = formatPoll(poll, null)
    return reply.status(201).send({ success: true, data: formatted })
  })

  // ─── GET POLL ─────────────────────────────────────────────
  app.get('/:id', { preHandler: [optionalAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId  = req.user?.id

    const poll = await db('polls').where('id', id).first()
    if (!poll) return reply.status(404).send({ success: false, error: 'Poll not found' })

    let userVote: number | null = null
    if (userId) {
      const vote = await db('poll_votes')
        .where({ poll_id: id, user_id: userId })
        .first('option_index')
      userVote = vote?.option_index ?? null
    }

    return reply.send({ success: true, data: formatPoll(poll, userVote) })
  })

  // ─── VOTE ─────────────────────────────────────────────────
  app.post('/:id/vote', { preHandler: [authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId  = req.user!.id

    const body = VoteSchema.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ success: false, error: 'Invalid input', code: 'VALIDATION' })
    }
    const { optionIndex } = body.data

    const poll = await db('polls').where('id', id).first()
    if (!poll) return reply.status(404).send({ success: false, error: 'Poll not found' })

    // Check if poll expired
    if (poll.expires_at && new Date(poll.expires_at) < new Date()) {
      return reply.status(410).send({ success: false, error: 'Poll has ended', code: 'POLL_ENDED' })
    }

    const options: Array<{ text: string; votes: number }> = typeof poll.options === 'string'
      ? JSON.parse(poll.options)
      : poll.options

    if (optionIndex >= options.length) {
      return reply.status(400).send({ success: false, error: 'Invalid option index' })
    }

    // Check for existing vote
    const existing = await db('poll_votes').where({ poll_id: id, user_id: userId }).first()
    if (existing) {
      return reply.status(409).send({ success: false, error: 'Already voted', code: 'ALREADY_VOTED' })
    }

    // Record vote and increment option count atomically
    await db.transaction(async trx => {
      await trx('poll_votes').insert({ poll_id: id, user_id: userId, option_index: optionIndex })

      // Increment vote count for the chosen option in the JSONB array
      await trx.raw(
        `UPDATE polls
           SET options = jsonb_set(options, '{${optionIndex},votes}',
             ((options->${optionIndex}->>'votes')::int + 1)::text::jsonb)
         WHERE id = ?`,
        [id]
      )
    })

    // Invalidate any cached poll data
    await redis.del(`poll:${id}`)

    const updated = await db('polls').where('id', id).first()
    return reply.send({ success: true, data: formatPoll(updated, optionIndex) })
  })

  // ─── DELETE POLL ──────────────────────────────────────────
  app.delete('/:id', { preHandler: [authenticate] }, async (req, reply) => {
    const { id }   = req.params as { id: string }
    const userId   = req.user!.id

    const poll = await db('polls').where('id', id).first('id, author_id')
    if (!poll) return reply.status(404).send({ success: false, error: 'Poll not found' })
    if (poll.author_id !== userId) return reply.status(403).send({ success: false, error: 'Forbidden' })

    await db('poll_votes').where('poll_id', id).delete()
    await db('polls').where('id', id).delete()
    await redis.del(`poll:${id}`)

    return reply.send({ success: true })
  })
}

// ─── HELPERS ────────────────────────────────────────────────────────────────
function formatPoll(
  poll:     Record<string, unknown>,
  userVote: number | null,
) {
  const options: Array<{ text: string; votes: number }> = typeof poll.options === 'string'
    ? JSON.parse(poll.options as string)
    : (poll.options as Array<{ text: string; votes: number }>)

  const totalVotes = options.reduce((sum, o) => sum + o.votes, 0)
  const expiresAt  = poll.expires_at ? (poll.expires_at as Date).toISOString() : null
  const ended      = expiresAt ? new Date(expiresAt) < new Date() : false

  return {
    id:         poll.id,
    question:   poll.question,
    authorId:   poll.author_id,
    postId:     poll.post_id,
    options:    options.map(o => ({ text: o.text, votes: o.votes })),
    totalVotes,
    expiresAt,
    ended,
    userVote,
    createdAt:  (poll.created_at as Date).toISOString(),
  }
}
