/**
 * Article Text Extractor
 *
 * Fetches the source article URL and extracts the headline + main body text
 * using Cheerio. Used by GDELT and other OSINT pipelines to get real article
 * content for AI summarization instead of relying on raw event codes.
 *
 * Design constraints:
 *   - 8s timeout per fetch (GDELT processes 50 events/cycle, can't block)
 *   - Strips nav, footer, sidebar, ads, scripts, styles
 *   - Returns max 3000 chars of body text (enough for LLM summary)
 *   - Redis cache: 6h TTL per URL to avoid refetching
 *   - Never throws — returns null on any failure
 */

import * as cheerio from 'cheerio'
import { logger } from '../lib/logger'

const log = logger.child({ module: 'article-extractor' })

// Redis instance is passed in to avoid circular imports
let _redis: { get: (k: string) => Promise<string | null>; setex: (k: string, ttl: number, v: string) => Promise<string> } | null = null

export function setArticleExtractorRedis(r: typeof _redis) { _redis = r }

export interface ArticleContent {
  title:   string
  body:    string       // cleaned article text, max 3000 chars
  excerpt: string       // first ~200 chars for quick preview
}

const FETCH_TIMEOUT_MS = 8_000
const CACHE_TTL_S      = 6 * 3600  // 6 hours
const MAX_BODY_CHARS   = 3000
const MAX_EXCERPT      = 200

// Elements to strip before extracting text
const STRIP_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', 'svg',
  'nav', 'header', 'footer',
  '.nav', '.navbar', '.header', '.footer', '.sidebar', '.ad', '.ads',
  '.advertisement', '.social-share', '.share-buttons', '.related-articles',
  '.comments', '.comment-section', '#comments',
  '.cookie-banner', '.popup', '.modal', '.newsletter',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
].join(', ')

// Content selectors in priority order (most specific first)
const CONTENT_SELECTORS = [
  'article .entry-content',
  'article .post-content',
  'article .article-body',
  'article .story-body',
  '.article-content',
  '.post-content',
  '.story-content',
  '.entry-content',
  '[itemprop="articleBody"]',
  '[data-component="text-block"]',
  'article',
  '.article',
  '.story',
  'main',
  '#content',
  '.content',
]

/**
 * Fetch and extract article text from a URL.
 * Returns null on any failure — never throws.
 */
export async function extractArticle(url: string): Promise<ArticleContent | null> {
  if (!url || !url.startsWith('http')) return null

  // Cache check
  if (_redis) {
    const cacheKey = `article:${hashUrl(url)}`
    const cached = await _redis.get(cacheKey).catch(() => null)
    if (cached) {
      try { return JSON.parse(cached) as ArticleContent }
      catch { /* corrupted cache, refetch */ }
    }
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WorldPulse/1.0; +https://world-pulse.io)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (!res.ok) {
      log.debug({ url, status: res.status }, 'article fetch failed')
      return null
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('html')) {
      log.debug({ url, contentType }, 'not HTML, skipping')
      return null
    }

    const html = await res.text()
    const result = parseArticleHtml(html, url)

    // Cache the result
    if (result && _redis) {
      const cacheKey = `article:${hashUrl(url)}`
      await _redis.setex(cacheKey, CACHE_TTL_S, JSON.stringify(result)).catch(() => {})
    }

    return result
  } catch (err) {
    log.debug({ url, err: (err as Error).message }, 'article extraction failed')
    return null
  }
}

/**
 * Parse HTML and extract article title + body text.
 */
function parseArticleHtml(html: string, url: string): ArticleContent | null {
  const $ = cheerio.load(html)

  // Extract title: prefer og:title > article h1 > page title
  const ogTitle   = $('meta[property="og:title"]').attr('content')?.trim()
  const articleH1 = $('article h1').first().text().trim()
  const pageTitle = $('title').text().trim()
  const title = ogTitle || articleH1 || pageTitle || ''

  // Strip noise elements
  $(STRIP_SELECTORS).remove()

  // Find article body using priority content selectors
  let bodyText = ''
  for (const sel of CONTENT_SELECTORS) {
    const el = $(sel).first()
    if (el.length) {
      // Get only paragraph text from within the content area
      const paragraphs: string[] = []
      el.find('p').each((_, p) => {
        const text = $(p).text().trim()
        if (text.length > 40) paragraphs.push(text)  // skip tiny fragments
      })
      if (paragraphs.length >= 2) {
        bodyText = paragraphs.join('\n\n')
        break
      }
    }
  }

  // Fallback: grab all <p> tags from body
  if (!bodyText) {
    const allP: string[] = []
    $('body p').each((_, p) => {
      const text = $(p).text().trim()
      if (text.length > 40) allP.push(text)
    })
    bodyText = allP.join('\n\n')
  }

  // Trim to max length
  if (bodyText.length > MAX_BODY_CHARS) {
    bodyText = bodyText.slice(0, MAX_BODY_CHARS)
    // Cut at last sentence boundary
    const lastPeriod = bodyText.lastIndexOf('. ')
    if (lastPeriod > MAX_BODY_CHARS * 0.6) {
      bodyText = bodyText.slice(0, lastPeriod + 1)
    }
  }

  if (!title && !bodyText) return null
  if (bodyText.length < 80) return null  // too short to be useful

  const excerpt = bodyText.slice(0, MAX_EXCERPT).trim()
  const lastSpace = excerpt.lastIndexOf(' ')
  const cleanExcerpt = lastSpace > MAX_EXCERPT * 0.7
    ? excerpt.slice(0, lastSpace) + '...'
    : excerpt + '...'

  return { title, body: bodyText, excerpt: cleanExcerpt }
}

function hashUrl(url: string): string {
  let hash = 0
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash) + url.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}
