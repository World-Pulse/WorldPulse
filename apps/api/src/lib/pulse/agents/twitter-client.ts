/**
 * Twitter/X API v2 Client — OAuth 1.0a User Context for posting tweets.
 *
 * Uses the X API v2 "Manage Tweets" endpoint to create tweets and threads.
 * Requires consumer keys + access tokens from developer.x.com
 *
 * Env vars required:
 *   TWITTER_API_KEY         — Consumer / API key
 *   TWITTER_API_SECRET      — Consumer / API secret
 *   TWITTER_ACCESS_TOKEN    — Access token (for @WorldPulse_io)
 *   TWITTER_ACCESS_SECRET   — Access token secret
 */

import crypto from 'crypto'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TweetResult {
  success: boolean
  tweetId?: string
  text?: string
  error?: string
}

export interface ThreadResult {
  success: boolean
  tweetIds: string[]
  errors: string[]
}

// ─── OAuth 1.0a Signature ───────────────────────────────────────────────────

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
}

function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex')
}

function generateOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
): string {
  // Sort parameters alphabetically
  const sortedKeys = Object.keys(params).sort()
  const paramString = sortedKeys
    .map(k => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&')

  // Create signature base string
  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString),
  ].join('&')

  // Create signing key
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`

  // Generate HMAC-SHA1
  return crypto
    .createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64')
}

function buildOAuthHeader(
  method: string,
  url: string,
  apiKey: string,
  apiSecret: string,
  accessToken: string,
  accessSecret: string,
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = generateNonce()

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: '1.0',
  }

  const signature = generateOAuthSignature(
    method,
    url,
    oauthParams,
    apiSecret,
    accessSecret,
  )

  oauthParams['oauth_signature'] = signature

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(', ')

  return `OAuth ${headerParts}`
}

// ─── Configuration ──────────────────────────────────────────────────────────

function getTwitterConfig() {
  const apiKey       = process.env.TWITTER_API_KEY
  const apiSecret    = process.env.TWITTER_API_SECRET
  const accessToken  = process.env.TWITTER_ACCESS_TOKEN
  const accessSecret = process.env.TWITTER_ACCESS_SECRET

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    return null
  }

  return { apiKey, apiSecret, accessToken, accessSecret }
}

export function isTwitterConfigured(): boolean {
  return getTwitterConfig() !== null
}

// ─── Tweet Operations ───────────────────────────────────────────────────────

const TWEETS_URL = 'https://api.x.com/2/tweets'

/**
 * Post a single tweet.
 * @param text      Tweet text (max 280 chars)
 * @param replyTo   Optional tweet ID to reply to (for threading)
 */
export async function postTweet(text: string, replyTo?: string): Promise<TweetResult> {
  const config = getTwitterConfig()
  if (!config) {
    return { success: false, error: 'Twitter API not configured — set TWITTER_API_KEY/SECRET/ACCESS_TOKEN/SECRET env vars' }
  }

  const { apiKey, apiSecret, accessToken, accessSecret } = config

  const body: Record<string, unknown> = { text }
  if (replyTo) {
    body.reply = { in_reply_to_tweet_id: replyTo }
  }

  const authHeader = buildOAuthHeader(
    'POST',
    TWEETS_URL,
    apiKey,
    apiSecret,
    accessToken,
    accessSecret,
  )

  try {
    const res = await fetch(TWEETS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    })

    const data = await res.json() as {
      data?: { id: string; text: string }
      errors?: Array<{ message: string; type: string }>
      detail?: string
    }

    if (!res.ok || data.errors || data.detail) {
      const errMsg = data.errors?.[0]?.message ?? data.detail ?? `HTTP ${res.status}`
      console.error(`[PULSE:Twitter] Tweet failed: ${errMsg}`)
      return { success: false, error: errMsg }
    }

    console.log(`[PULSE:Twitter] Tweet posted: ${data.data?.id}`)
    return {
      success: true,
      tweetId: data.data?.id,
      text: data.data?.text,
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown fetch error'
    console.error(`[PULSE:Twitter] Network error: ${errMsg}`)
    return { success: false, error: errMsg }
  }
}

/**
 * Post a thread — an array of tweets, each replying to the previous one.
 * @param tweets  Array of tweet texts (each max 280 chars)
 */
export async function postThread(tweets: string[]): Promise<ThreadResult> {
  const result: ThreadResult = { success: true, tweetIds: [], errors: [] }

  if (tweets.length === 0) {
    return { success: false, tweetIds: [], errors: ['Empty thread'] }
  }

  let replyTo: string | undefined

  for (let i = 0; i < tweets.length; i++) {
    const tweetResult = await postTweet(tweets[i], replyTo)

    if (tweetResult.success && tweetResult.tweetId) {
      result.tweetIds.push(tweetResult.tweetId)
      replyTo = tweetResult.tweetId
    } else {
      result.errors.push(`Tweet ${i + 1}: ${tweetResult.error}`)
      result.success = false
      break // Stop thread on first failure
    }

    // Small delay between tweets to avoid rate limits
    if (i < tweets.length - 1) {
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  return result
}

/**
 * Delete a tweet by ID. Used for cleanup if a thread partially fails.
 */
export async function deleteTweet(tweetId: string): Promise<boolean> {
  const config = getTwitterConfig()
  if (!config) return false

  const { apiKey, apiSecret, accessToken, accessSecret } = config
  const url = `${TWEETS_URL}/${tweetId}`

  const authHeader = buildOAuthHeader(
    'DELETE',
    url,
    apiKey,
    apiSecret,
    accessToken,
    accessSecret,
  )

  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: authHeader },
    })
    return res.ok
  } catch {
    return false
  }
}
