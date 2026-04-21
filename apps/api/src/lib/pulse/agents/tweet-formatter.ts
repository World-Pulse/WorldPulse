/**
 * Tweet Formatter — transforms PULSE content types into tweet-sized output.
 *
 * Handles:
 * - Flash briefs → single tweet (280 chars)
 * - Daily briefings → thread (executive summary → key stories → link)
 * - Analysis → 2-3 tweet thread
 * - Fact checks → single tweet with link
 *
 * All tweets end with the WorldPulse URL for attribution.
 */

const SITE_URL = 'https://world-pulse.io'
const MAX_TWEET = 280
const LINK_LENGTH = 23  // t.co shortens all URLs to 23 chars
const SUFFIX = `\n\n${SITE_URL}`
const SUFFIX_RESERVED = LINK_LENGTH + 2 // 2 newlines + shortened URL

// ─── Types ──────────────────────────────────────────────────────────────────

export type PulseContentType =
  | 'flash_brief'
  | 'analysis'
  | 'daily_briefing'
  | 'social_thread'
  | 'fact_check'

export interface FormattedTweet {
  contentType: PulseContentType
  tweets: string[]
  /** Estimated total character count across all tweets */
  totalChars: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Truncate text to fit in a single tweet with URL suffix */
function truncateToTweet(text: string, reserveForSuffix = true): string {
  const maxContent = MAX_TWEET - (reserveForSuffix ? SUFFIX_RESERVED : 0)
  if (text.length <= maxContent) return text

  // Cut at the last space before the limit, add ellipsis
  const cutPoint = text.lastIndexOf(' ', maxContent - 1)
  return text.slice(0, cutPoint > 0 ? cutPoint : maxContent - 1) + '…'
}

/** Split a long text into tweet-sized chunks at sentence boundaries */
function splitIntoTweets(text: string, maxPerTweet: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) ?? [text]
  const tweets: string[] = []
  let current = ''

  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if ((current + ' ' + trimmed).trim().length > maxPerTweet) {
      if (current.trim()) tweets.push(current.trim())
      current = trimmed
    } else {
      current = current ? current + ' ' + trimmed : trimmed
    }
  }
  if (current.trim()) tweets.push(current.trim())

  return tweets
}

/** Strip PULSE headers and signatures from raw content */
function stripPulseMarkup(content: string): string {
  return content
    // Remove header tags like [DAILY BRIEFING] Apr 20, 2026
    .replace(/^\[(?:DAILY BRIEFING|FLASH BRIEF|ANALYSIS|MID-DAY UPDATE|EVENING WRAP|FACT CHECK)\][^\n]*\n*/i, '')
    // Remove emoji headers
    .replace(/^[\u{1F4CB}\u{1F4CA}\u{26A1}\u{1F4DD}\u{1F50D}\u{1F504}\u{1F319}\u{1F4F0}]\s*[^\n]*\n*/u, '')
    // Remove trailing PULSE signature
    .replace(/\n*\u2014\s*PULSE[^\n]*$/m, '')
    .replace(/\n*— PULSE[^\n]*$/m, '')
    .trim()
}

/** Extract severity tag for tweet emphasis */
function severityEmoji(severity: string): string {
  switch (severity) {
    case 'critical': return '🔴'
    case 'high':     return '🟠'
    case 'medium':   return '🟡'
    default:         return ''
  }
}

// ─── Content Type Formatters ────────────────────────────────────────────────

/**
 * Flash Brief → single punchy tweet.
 * These are already short (2-3 sentences) so we just clean + truncate.
 */
export function formatFlashBrief(
  content: string,
  severity: string = 'high',
): FormattedTweet {
  const clean = stripPulseMarkup(content)
  const prefix = severityEmoji(severity)
  const body = prefix ? `${prefix} ${clean}` : clean
  const tweet = truncateToTweet(body) + SUFFIX

  return {
    contentType: 'flash_brief',
    tweets: [tweet],
    totalChars: tweet.length,
  }
}

/**
 * Daily Briefing → 3-5 tweet thread.
 * Thread structure:
 *   1. "PULSE Daily Briefing — [date]" + top 2-3 headlines
 *   2-4. Key stories (one per tweet)
 *   5. Link + CTA
 */
export function formatDailyBriefing(content: string): FormattedTweet {
  const clean = stripPulseMarkup(content)
  const tweets: string[] = []

  // Extract sections
  const sections = clean.split(/\n(?=\*\*|#{1,3}\s)/)
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })

  // Tweet 1: Header with overview
  const firstParagraph = clean.split('\n\n')[0] ?? clean.slice(0, 200)
  const header = `PULSE Daily Briefing — ${dateStr}\n\n${truncateToTweet(firstParagraph, false)}`
  tweets.push(truncateToTweet(header, false))

  // Tweet 2-4: Extract top stories or bullet points
  const bullets = clean.match(/[•\-\*]\s*\[?\w+\]?\s*.+/g) ?? []
  const keyPoints = bullets.slice(0, 3)

  if (keyPoints.length > 0) {
    // Group bullet points into tweets
    let currentTweet = ''
    for (const point of keyPoints) {
      const cleaned = point.replace(/^[•\-\*]\s*/, '→ ')
      if ((currentTweet + '\n' + cleaned).length > MAX_TWEET - SUFFIX_RESERVED) {
        if (currentTweet) tweets.push(currentTweet)
        currentTweet = cleaned
      } else {
        currentTweet = currentTweet ? currentTweet + '\n' + cleaned : cleaned
      }
    }
    if (currentTweet) tweets.push(currentTweet)
  } else {
    // No bullets found — split narrative into chunks
    const narrativeChunks = splitIntoTweets(clean, MAX_TWEET - SUFFIX_RESERVED)
    tweets.push(...narrativeChunks.slice(1, 3)) // Skip first (already used in header)
  }

  // Final tweet: CTA with link
  tweets.push(`Full briefing and live intelligence map at ${SITE_URL}\n\nWorldPulse tracks 65,000+ verified signals from 300+ sources across 195 countries.`)

  // Add thread numbering
  const numbered = tweets.map((t, i) =>
    tweets.length > 1 ? `${t}` : t // Don't add numbers — X shows thread context
  )

  const totalChars = numbered.reduce((sum, t) => sum + t.length, 0)

  return {
    contentType: 'daily_briefing',
    tweets: numbered,
    totalChars,
  }
}

/**
 * Analysis → 2-3 tweet mini-thread.
 * First tweet: key finding. Second: context/assessment. Third: link.
 */
export function formatAnalysis(content: string, topic: string = ''): FormattedTweet {
  const clean = stripPulseMarkup(content)
  const tweets: string[] = []

  // Split into paragraphs
  const paragraphs = clean.split(/\n\n+/).filter(p => p.trim())

  if (paragraphs.length === 0) {
    const tweet = truncateToTweet(clean) + SUFFIX
    return { contentType: 'analysis', tweets: [tweet], totalChars: tweet.length }
  }

  // Tweet 1: Lead with the finding
  const topicPrefix = topic ? `${topic}: ` : ''
  tweets.push(truncateToTweet(`${topicPrefix}${paragraphs[0]}`))

  // Tweet 2: Assessment or "What to Watch" if present
  const watchSection = paragraphs.find(p =>
    /what to watch|assessment|outlook/i.test(p)
  )
  if (watchSection) {
    tweets.push(truncateToTweet(watchSection))
  } else if (paragraphs.length > 1) {
    tweets.push(truncateToTweet(paragraphs[1]))
  }

  // Final: link
  tweets.push(`Full analysis on WorldPulse → ${SITE_URL}`)

  const totalChars = tweets.reduce((sum, t) => sum + t.length, 0)
  return { contentType: 'analysis', tweets, totalChars }
}

/**
 * Fact Check → single tweet with verdict.
 */
export function formatFactCheck(content: string): FormattedTweet {
  const clean = stripPulseMarkup(content)

  // Try to extract the verdict lines (CONFIRMED, CONTESTED, UNVERIFIED, LIKELY FALSE)
  const verdicts = clean.match(/(CONFIRMED|CONTESTED|UNVERIFIED|LIKELY FALSE)\s*[—–-]\s*.+/g)

  let tweetBody: string
  if (verdicts && verdicts.length > 0) {
    // Lead with the most newsworthy verdict
    tweetBody = `PULSE Fact Check:\n\n${verdicts.slice(0, 2).join('\n')}`
  } else {
    tweetBody = `PULSE Fact Check:\n\n${clean.slice(0, 200)}`
  }

  const tweet = truncateToTweet(tweetBody) + SUFFIX
  return { contentType: 'fact_check', tweets: [tweet], totalChars: tweet.length }
}

// ─── Main Router ────────────────────────────────────────────────────────────

/**
 * Format any PULSE content type for Twitter.
 */
export function formatForTwitter(
  contentType: string,
  content: string,
  metadata?: { severity?: string; topic?: string },
): FormattedTweet {
  switch (contentType) {
    case 'flash_brief':
      return formatFlashBrief(content, metadata?.severity)
    case 'daily_briefing':
      return formatDailyBriefing(content)
    case 'analysis':
      // Fact-checker publishes under 'analysis' content type — detect by content
      if (content.includes('FACT CHECK') || content.includes('Fact Check')) {
        return formatFactCheck(content)
      }
      return formatAnalysis(content, metadata?.topic)
    default:
      // Generic: just truncate to a single tweet
      const clean = stripPulseMarkup(content)
      const tweet = truncateToTweet(clean) + SUFFIX
      return { contentType: contentType as PulseContentType, tweets: [tweet], totalChars: tweet.length }
  }
}
