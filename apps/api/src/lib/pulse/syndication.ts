/**
 * PULSE Social Syndication — mirrors social media posts back into the feed.
 *
 * When WorldPulse content is posted to X, Reddit, or LinkedIn,
 * this module creates a syndicated post in the AI Digest feed
 * so users can engage with social media discussion without leaving
 * the platform.
 *
 * Flow:
 * 1. Social posts are registered via registerSocialPost()
 * 2. The syndication engine creates a PULSE post linking back
 * 3. Engagement stats can be updated later via updateEngagement()
 */
import { db } from '../../db/postgres'
import { syndicatePost } from './publisher'

interface SocialPost {
  platform: 'x' | 'reddit' | 'linkedin' | 'hackernews'
  externalId?: string
  externalUrl: string
  title: string
  content: string
}

/**
 * Register a social media post and create a syndicated feed entry.
 * Idempotent — skips if the external URL has already been syndicated.
 */
export async function registerSocialPost(post: SocialPost): Promise<{ success: boolean; postId?: string; skipped?: boolean }> {
  // Check if already syndicated
  const existing = await db('pulse_syndication')
    .where('external_url', post.externalUrl)
    .first()

  if (existing) {
    return { success: true, skipped: true, postId: existing.post_id }
  }

  const result = await syndicatePost(
    post.platform,
    post.externalUrl,
    post.title,
    post.content,
    post.externalId,
  )

  return {
    success: result.success,
    postId: result.postId,
  }
}

/**
 * Update engagement metrics for a syndicated post.
 * Called periodically to reflect likes/comments/shares from social platforms.
 */
export async function updateEngagement(
  platform: string,
  externalId: string,
  engagement: {
    likes?: number
    comments?: number
    shares?: number
    views?: number
  },
): Promise<void> {
  await db('pulse_syndication')
    .where({ platform, external_id: externalId })
    .update({
      engagement: JSON.stringify(engagement),
      last_checked: db.fn.now(),
    })
}

/**
 * Get all syndicated posts for a platform, ordered by most recent.
 */
export async function getSyndicatedPosts(
  platform?: string,
  limit = 20,
): Promise<any[]> {
  let q = db('pulse_syndication')
    .orderBy('synced_at', 'desc')
    .limit(limit)

  if (platform) {
    q = q.where('platform', platform)
  }

  return q
}

/**
 * Batch register multiple social posts (e.g. from launch day).
 * Returns count of new posts created.
 */
export async function batchRegisterSocialPosts(posts: SocialPost[]): Promise<number> {
  let created = 0
  for (const post of posts) {
    const result = await registerSocialPost(post)
    if (result.success && !result.skipped) created++
  }
  return created
}
