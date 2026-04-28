/**
 * Media Extractor — Multimedia Signal Enrichment
 *
 * Pure regex/URL parsing — no external API calls.
 * Extracts YouTube video IDs and podcast audio URLs from article bodies.
 *
 * Called after signal insertion; results are inserted into signal_media
 * in a non-blocking try/catch so extraction failures never break ingestion.
 */

export type MediaType = 'youtube' | 'podcast_audio' | 'video' | 'iframe'

export interface MediaItem {
  type:        MediaType
  url:         string
  embedId?:    string
  title?:      string
  sourceName?: string
}

// ─── YouTube ─────────────────────────────────────────────────────────────────

/**
 * Extract a YouTube video ID from any known YouTube URL format:
 *   - youtube.com/watch?v=ID
 *   - youtu.be/ID
 *   - youtube.com/embed/ID
 *   - youtube.com/shorts/ID
 * Returns null if not a recognised YouTube URL.
 */
export function parseYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)

    const isYT =
      u.hostname === 'youtube.com' ||
      u.hostname === 'www.youtube.com' ||
      u.hostname === 'm.youtube.com' ||
      u.hostname === 'youtu.be' ||
      u.hostname === 'www.youtu.be'

    if (!isYT) return null

    // youtu.be/ID
    if (u.hostname === 'youtu.be' || u.hostname === 'www.youtu.be') {
      const id = u.pathname.slice(1).split(/[/?#]/)[0] ?? ''
      return isValidYouTubeId(id) ? id : null
    }

    // youtube.com/watch?v=ID
    const v = u.searchParams.get('v')
    if (v && isValidYouTubeId(v)) return v

    // youtube.com/embed/ID  or  youtube.com/shorts/ID
    const embedMatch = u.pathname.match(/\/(?:embed|shorts|v)\/([A-Za-z0-9_-]{11})/)
    if (embedMatch?.[1]) return embedMatch[1]

    return null
  } catch {
    return null
  }
}

function isValidYouTubeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id)
}

// ─── Podcast / audio ─────────────────────────────────────────────────────────

const AUDIO_EXTENSION_RE = /\.(?:mp3|m4a|ogg|wav|aac|opus|flac)(?:[?#]|$)/i

const PODCAST_HOST_RE = /(?:^|\.)(?:spotify\.com|podcasts\.apple\.com|anchor\.fm|buzzsprout\.com|soundcloud\.com|podbean\.com|libsyn\.com|transistor\.fm|simplecast\.com|spreaker\.com|pinecast\.com|captivate\.fm)$/

function isPodcastUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    // Direct audio file
    if (AUDIO_EXTENSION_RE.test(u.pathname)) return true
    // Known podcast hosting platforms
    if (PODCAST_HOST_RE.test(host)) return true
    return false
  } catch {
    return false
  }
}

// ─── URL extraction from body text ───────────────────────────────────────────

// Matches http(s) URLs — greedy up to first whitespace/quote/bracket/angle bracket
const URL_RE = /https?:\/\/[^\s"'<>)\]]+/gi

function extractUrls(text: string): string[] {
  const matches = text.match(URL_RE) ?? []
  // Strip trailing punctuation that's likely not part of the URL
  return matches.map(u => u.replace(/[.,;!?]+$/, ''))
}

// ─── Main extractor ───────────────────────────────────────────────────────────

/**
 * Extract media items from an article's URL and body text.
 *
 * @param articleUrl  - Canonical URL of the article itself
 * @param body        - Raw article body text (may be null/undefined)
 * @param sourceUrl   - Original source URL (may be null/undefined)
 * @returns           Deduplicated array of MediaItem — empty if none found
 */
export function extractMediaFromContent(
  articleUrl: string,
  body: string | null | undefined,
  sourceUrl: string | null | undefined,
): MediaItem[] {
  const seen  = new Set<string>()
  const items: MediaItem[] = []

  function addItem(item: MediaItem): void {
    // Deduplicate on canonical key: embedId for YouTube, url for audio
    const key = item.embedId ?? item.url
    if (seen.has(key)) return
    seen.add(key)
    items.push(item)
  }

  // Candidate URLs: article URL + source URL + all URLs found in body
  const candidateUrls: string[] = []

  if (articleUrl) candidateUrls.push(articleUrl)
  if (sourceUrl)  candidateUrls.push(sourceUrl)

  if (body) {
    candidateUrls.push(...extractUrls(body))
  }

  for (const rawUrl of candidateUrls) {
    // YouTube first
    const ytId = parseYouTubeId(rawUrl)
    if (ytId) {
      addItem({
        type:    'youtube',
        url:     `https://www.youtube.com/watch?v=${ytId}`,
        embedId: ytId,
      })
      continue
    }

    // Podcast / audio
    if (isPodcastUrl(rawUrl)) {
      addItem({
        type: 'podcast_audio',
        url:  rawUrl,
      })
    }
  }

  return items
}
