import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { authenticate } from '../middleware/auth'

export const registerAnalyticsRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['analytics']
  })

  // ─── PERSONAL ANALYTICS ──────────────────────────────────
  // GET /api/v1/analytics/me
  app.get('/me', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = req.user!.id

    const [
      postStats,
      signalStats,
      followStats,
      postsByDay,
      topPosts,
    ] = await Promise.all([
      // Total posts, total likes/boosts/replies received
      db('posts as p')
        .where('p.author_id', userId)
        .whereNull('p.deleted_at')
        .select(
          db.raw('COUNT(*) as total_posts'),
          db.raw('COALESCE(SUM(p.like_count), 0) as total_likes_received'),
          db.raw('COALESCE(SUM(p.boost_count), 0) as total_boosts_received'),
          db.raw('COALESCE(SUM(p.reply_count), 0) as total_replies_received'),
          db.raw('COALESCE(SUM(p.view_count), 0) as total_views'),
        )
        .first(),

      // Signal contributions
      db.raw(`
        SELECT
          COUNT(DISTINCT vl.signal_id) FILTER (
            WHERE EXISTS (SELECT 1 FROM signals s WHERE s.id = vl.signal_id AND s.id IN (
              SELECT signal_id FROM posts WHERE author_id = ? AND signal_id IS NOT NULL
            ))
          ) as signals_submitted,
          COUNT(DISTINCT vl.signal_id) FILTER (
            WHERE vl.actor_id = ? AND vl.result = 'confirmed'
          ) as signals_verified
        FROM verification_log vl
        WHERE vl.actor_id = ?
      `, [userId, userId, userId]).then(r => r.rows[0]),

      // Follow counts from users table
      db('users')
        .where('id', userId)
        .select('follower_count', 'following_count', 'signal_count')
        .first(),

      // Posts per day for last 30 days
      db.raw(`
        SELECT
          DATE_TRUNC('day', created_at AT TIME ZONE 'UTC') as day,
          COUNT(*) as count
        FROM posts
        WHERE author_id = ?
          AND deleted_at IS NULL
          AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY day
        ORDER BY day ASC
      `, [userId]).then(r => r.rows),

      // Top 5 posts by engagement (likes + boosts + replies)
      db('posts as p')
        .where('p.author_id', userId)
        .whereNull('p.deleted_at')
        .whereNull('p.parent_id')
        .select([
          'p.id',
          'p.content',
          'p.post_type',
          'p.like_count',
          'p.boost_count',
          'p.reply_count',
          'p.view_count',
          'p.created_at',
          db.raw('(p.like_count + p.boost_count + p.reply_count) as engagement_total'),
        ])
        .orderByRaw('(p.like_count + p.boost_count + p.reply_count) DESC')
        .limit(5),
    ])

    // Build posts-per-day map filling in zeroes for missing days
    const dayMap = new Map<string, number>()
    for (const row of postsByDay as Array<{ day: Date; count: string }>) {
      dayMap.set(row.day.toISOString().slice(0, 10), Number(row.count))
    }
    const postsPerDay: Array<{ date: string; count: number }> = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - i)
      const key = d.toISOString().slice(0, 10)
      postsPerDay.push({ date: key, count: dayMap.get(key) ?? 0 })
    }

    const ps = postStats as Record<string, string>
    const ss = signalStats as Record<string, string>
    const fs = followStats as Record<string, number>

    const totalLikes    = Number(ps?.total_likes_received ?? 0)
    const totalBoosts   = Number(ps?.total_boosts_received ?? 0)
    const totalViews    = Number(ps?.total_views ?? 0)
    const engagementRate = totalViews > 0
      ? ((totalLikes + totalBoosts) / totalViews)
      : 0

    const signalsSubmitted = Number(ss?.signals_submitted ?? 0)
    const signalsVerified  = Number(ss?.signals_verified  ?? 0)
    const verificationRate = signalsSubmitted > 0
      ? (signalsVerified / signalsSubmitted)
      : 0

    return reply.send({
      success: true,
      data: {
        overview: {
          totalPosts:           Number(ps?.total_posts ?? 0),
          totalLikesReceived:   totalLikes,
          totalBoostsReceived:  totalBoosts,
          totalRepliesReceived: Number(ps?.total_replies_received ?? 0),
          totalViews,
          followerCount:        Number(fs?.follower_count  ?? 0),
          followingCount:       Number(fs?.following_count ?? 0),
          signalCount:          Number(fs?.signal_count    ?? 0),
          engagementRate:       parseFloat(engagementRate.toFixed(4)),
        },
        signals: {
          submitted:        signalsSubmitted,
          verified:         signalsVerified,
          verificationRate: parseFloat(verificationRate.toFixed(4)),
        },
        postsPerDay,
        topPosts: (topPosts as Array<{
          id: string
          content: string
          post_type: string
          like_count: number
          boost_count: number
          reply_count: number
          view_count: number
          created_at: Date
          engagement_total: number
        }>).map(p => ({
          id:              p.id,
          content:         p.content.slice(0, 200),
          postType:        p.post_type,
          likeCount:       Number(p.like_count),
          boostCount:      Number(p.boost_count),
          replyCount:      Number(p.reply_count),
          viewCount:       Number(p.view_count),
          engagementTotal: Number(p.engagement_total),
          createdAt:       p.created_at.toISOString(),
        })),
      },
    })
  })
}
