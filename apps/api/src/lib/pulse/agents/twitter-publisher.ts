/**
 * PULSE Twitter Publisher Agent — auto-posts intelligence content to X/@WorldPulse_io.
 *
 * This agent monitors new PULSE publications (flash briefs, daily briefings,
 * analysis, fact checks) and automatically formats + posts them to Twitter/X.
 *
 * Posting strategy:
 * - Flash briefs (critical/high) → immediate single tweet
 * - Daily briefings → thread (morning only, skip midday/evening)
 * - Analysis posts  → 2-3 tweet thread
 * - Fact checks     → single tweet
 *
 * Rate limits:
 * - Max 15 tweets per 24h (well within X free tier of 1,500/month)
 * - Min 10 minute gap between posts (avoid spam perception)
 * - Max 1 daily briefing thread per day
 *
 * Deduplication:
 * - Tracks posted content via pulse_syndication table
 * - Won't double-post the same PULSE post
 */

import { db } from '../../../db/postgres'
import { redis } from '../../../db/redis'
import { postTweet, postThread, isTwitterConfigured } from './twitter-client'
import { formatForTwitter } from './tweet-formatter'
import type { AgentConfig, AgentScanResult } from './types'

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_TWEETS_PER_DAY = 15
const MIN_GAP_MINUTES = 10
const REDIS_LAST_TWEET_KEY = 'pulse:twitter:last_tweet_at'
const REDIS_DAILY_COUNT_KEY = 'pulse:twitter:daily_count'

// Content types we'll auto-tweet (skip syndicated, weekly — too long/noisy)
const TWEETABLE_TYPES = ['flash_brief', 'daily_briefing', 'analysis']

// ─── Rate Limiting ──────────────────────────────────────────────────────────

async function canTweet(): Promise<{ allowed: boolean; reason?: string }> {
  if (!isTwitterConfigured()) {
    return { allowed: false, reason: 'Twitter API not configured' }
  }

  // Check daily count
  const countStr = await redis.get(REDIS_DAILY_COUNT_KEY).catch(() => null)
  const dailyCount = Number(countStr ?? 0)
  if (dailyCount >= MAX_TWEETS_PER_DAY) {
    return { allowed: false, reason: `Daily tweet limit reached (${MAX_TWEETS_PER_DAY})` }
  }

  // Check gap between tweets
  const lastTweet = await redis.get(REDIS_LAST_TWEET_KEY).catch(() => null)
  if (lastTweet) {
    const elapsed = Date.now() - Number(lastTweet)
    const minGapMs = MIN_GAP_MINUTES * 60_000
    if (elapsed < minGapMs) {
      const waitMin = Math.ceil((minGapMs - elapsed) / 60_000)
      return { allowed: false, reason: `Rate limit: wait ${waitMin} more minute(s)` }
    }
  }

  return { allowed: true }
}

async function recordTweet(count: number = 1): Promise<void> {
  const now = Date.now()
  const pipeline = redis.multi()

  // Set last tweet timestamp
  pipeline.set(REDIS_LAST_TWEET_KEY, now.toString())

  // Increment daily counter with expiry at midnight UTC
  const secondsUntilMidnight = (() => {
    const tomorrow = new Date()
    tomorrow.setUTCHours(24, 0, 0, 0)
    return Math.ceil((tomorrow.getTime() - now) / 1000)
  })()

  pipeline.incrby(REDIS_DAILY_COUNT_KEY, count)
  pipeline.expire(REDIS_DAILY_COUNT_KEY, secondsUntilMidnight)

  await pipeline.exec().catch(() => {})
}

// ─── Deduplication ──────────────────────────────────────────────────────────

async function alreadyTweeted(postId: string): Promise<boolean> {
  const existing = await db('pulse_syndication')
    .where('platform', 'x')
    .where('post_id', postId)
    .first()

  return !!existing
}

async function recordSyndication(
  postId: string,
  tweetId: string,
  content: string,
): Promise<void> {
  await db('pulse_syndication')
    .insert({
      platform: 'x',
      external_id: tweetId,
      external_url: `https://x.com/WorldPulse_io/status/${tweetId}`,
      post_id: postId,
      title: content.slice(0, 100),
    })
    .onConflict(['platform', 'external_id'])
    .ignore()
}

// ─── Core Logic ─────────────────────────────────────────────────────────────

/**
 * Check for new PULSE posts and tweet them.
 * Called by the scheduler on a regular interval.
 */
export async function runTwitterPublisher(agent: AgentConfig): Promise<AgentScanResult> {
  const result: AgentScanResult = {
    agentId: agent.id,
    agentName: agent.name,
    signalsReviewed: 0,
    trendsIdentified: 0,
    published: false,
  }

  // Pre-flight checks
  if (!isTwitterConfigured()) {
    return { ...result, error: 'Twitter API not configured' }
  }

  const { allowed, reason } = await canTweet()
  if (!allowed) {
    return { ...result, error: reason }
  }

  // Find recent PULSE posts that haven't been tweeted yet
  const recentPosts = await db('posts')
    .join('pulse_publish_log', 'posts.id', 'pulse_publish_log.post_id')
    .where('posts.author_id', '00000000-0000-4000-a000-000000000001') // PULSE user
    .whereIn('pulse_publish_log.content_type', TWEETABLE_TYPES)
    .where('posts.created_at', '>', new Date(Date.now() - 6 * 3600_000)) // last 6 hours
    .whereNotExists(function() {
      this.select('*')
        .from('pulse_syndication')
        .whereRaw('pulse_syndication.post_id = posts.id')
        .where('pulse_syndication.platform', 'x')
    })
    .orderBy('posts.created_at', 'desc')
    .limit(3)
    .select([
      'posts.id as post_id',
      'posts.content',
      'posts.created_at',
      'pulse_publish_log.content_type',
      'pulse_publish_log.metadata',
    ])

  result.signalsReviewed = recentPosts.length

  if (recentPosts.length === 0) {
    return result
  }

  // Process the most recent untweeted post
  // (We only tweet one at a time to respect rate limits)
  const post = recentPosts[0]
  const contentType = post.content_type as string
  const metadata = post.metadata as Record<string, string> | null

  console.log(`[PULSE:Twitter] Found untweeted ${contentType} post: ${post.post_id}`)

  // Format the content for Twitter
  const formatted = formatForTwitter(contentType, post.content, {
    severity: metadata?.severity,
    topic: metadata?.topic,
  })

  // Post to Twitter
  let tweetId: string | undefined
  let tweetCount = 0

  if (formatted.tweets.length === 1) {
    // Single tweet
    const tweetResult = await postTweet(formatted.tweets[0])
    if (tweetResult.success) {
      tweetId = tweetResult.tweetId
      tweetCount = 1
    } else {
      return { ...result, error: `Tweet failed: ${tweetResult.error}` }
    }
  } else {
    // Thread
    const threadResult = await postThread(formatted.tweets)
    if (threadResult.success && threadResult.tweetIds.length > 0) {
      tweetId = threadResult.tweetIds[0] // First tweet ID as reference
      tweetCount = threadResult.tweetIds.length
    } else {
      return { ...result, error: `Thread failed: ${threadResult.errors.join('; ')}` }
    }
  }

  // Record the syndication
  if (tweetId) {
    await recordSyndication(post.post_id, tweetId, formatted.tweets[0])
    await recordTweet(tweetCount)

    result.published = true
    result.trendsIdentified = 1
    result.postId = post.post_id

    console.log(`[PULSE:Twitter] Published ${tweetCount} tweet(s) for post ${post.post_id} → tweet ${tweetId}`)
  }

  return result
}

/**
 * Manually trigger a tweet for a specific PULSE post.
 * Used by the API for on-demand syndication.
 */
export async function tweetPost(postId: string): Promise<{
  success: boolean
  tweetId?: string
  error?: string
}> {
  if (!isTwitterConfigured()) {
    return { success: false, error: 'Twitter API not configured' }
  }

  // Check if already tweeted
  if (await alreadyTweeted(postId)) {
    return { success: false, error: 'Post already tweeted' }
  }

  // Fetch the post
  const post = await db('posts')
    .leftJoin('pulse_publish_log', 'posts.id', 'pulse_publish_log.post_id')
    .where('posts.id', postId)
    .first()
    .select(['posts.content', 'pulse_publish_log.content_type', 'pulse_publish_log.metadata'])

  if (!post) {
    return { success: false, error: 'Post not found' }
  }

  const contentType = post.content_type ?? 'analysis'
  const metadata = post.metadata as Record<string, string> | null

  const formatted = formatForTwitter(contentType, post.content, {
    severity: metadata?.severity,
    topic: metadata?.topic,
  })

  if (formatted.tweets.length === 1) {
    const result = await postTweet(formatted.tweets[0])
    if (result.success && result.tweetId) {
      await recordSyndication(postId, result.tweetId, formatted.tweets[0])
      await recordTweet(1)
      return { success: true, tweetId: result.tweetId }
    }
    return { success: false, error: result.error }
  }

  const result = await postThread(formatted.tweets)
  if (result.success && result.tweetIds[0]) {
    await recordSyndication(postId, result.tweetIds[0], formatted.tweets[0])
    await recordTweet(result.tweetIds.length)
    return { success: true, tweetId: result.tweetIds[0] }
  }
  return { success: false, error: result.errors.join('; ') }
}
