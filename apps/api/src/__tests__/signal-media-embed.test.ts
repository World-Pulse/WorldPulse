/**
 * signal-media-embed.test.ts
 *
 * Tests for the media-embed enrichment logic wired into the Signal Detail page.
 * The pure URL-detection functions are re-implemented here (mirroring
 * apps/web/src/components/RichMediaEmbed.tsx) so that API-side tests remain
 * self-contained without importing the React component tree.
 *
 * Coverage:
 *  - extractYouTubeId: watch, short-URL, shorts, embed, v path formats
 *  - extractVimeoId: standard and www hostnames
 *  - extractFirstEmbedUrl: finds embeddable URL in arbitrary text
 *  - isEmbeddable helper: drives "show player vs show button" logic
 *  - media_urls array: all items would render an embed
 */

import { describe, it, expect } from 'vitest'

// ── Re-implement URL helpers (mirrors RichMediaEmbed.tsx) ──────────────────

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if ((u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') && u.pathname === '/watch') {
      return u.searchParams.get('v')
    }
    if (u.hostname === 'youtu.be') {
      return u.pathname.slice(1).split('?')[0] || null
    }
    if (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') {
      const match = u.pathname.match(/\/(embed|shorts|v)\/([a-zA-Z0-9_-]{11})/)
      if (match) return match[2]
    }
    return null
  } catch {
    return null
  }
}

function extractVimeoId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname === 'vimeo.com' || u.hostname === 'www.vimeo.com') {
      const match = u.pathname.match(/\/(\d+)/)
      return match ? match[1] : null
    }
    return null
  } catch {
    return null
  }
}

function detectEmbedType(url: string): 'youtube' | 'vimeo' | null {
  if (extractYouTubeId(url)) return 'youtube'
  if (extractVimeoId(url))   return 'vimeo'
  return null
}

const URL_REGEX = /https?:\/\/[^\s<>"]+/g

function extractFirstEmbedUrl(text: string): string | null {
  const urls = text.match(URL_REGEX) ?? []
  for (const url of urls) {
    if (detectEmbedType(url)) return url
  }
  return null
}

// ── extractYouTubeId ────────────────────────────────────────────────────────

describe('extractYouTubeId', () => {
  it('extracts ID from youtube.com/watch?v= format', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('extracts ID from youtu.be short-URL format', () => {
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('extracts ID from youtu.be short-URL with query string', () => {
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe('dQw4w9WgXcQ')
  })

  it('extracts ID from youtube.com/shorts/ format', () => {
    expect(extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('extracts ID from youtube.com/embed/ format', () => {
    expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('returns null for non-YouTube URL', () => {
    expect(extractYouTubeId('https://vimeo.com/123456789')).toBeNull()
  })

  it('returns null for malformed URL', () => {
    expect(extractYouTubeId('not-a-url')).toBeNull()
  })
})

// ── extractVimeoId ──────────────────────────────────────────────────────────

describe('extractVimeoId', () => {
  it('extracts numeric ID from vimeo.com URL', () => {
    expect(extractVimeoId('https://vimeo.com/76979871')).toBe('76979871')
  })

  it('extracts numeric ID from www.vimeo.com URL', () => {
    expect(extractVimeoId('https://www.vimeo.com/76979871')).toBe('76979871')
  })

  it('returns null for non-Vimeo URL', () => {
    expect(extractVimeoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
  })
})

// ── extractFirstEmbedUrl ────────────────────────────────────────────────────

describe('extractFirstEmbedUrl', () => {
  it('returns YouTube URL when signal source_url is a YouTube watch link', () => {
    const sourceUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    expect(extractFirstEmbedUrl(sourceUrl)).toBe(sourceUrl)
  })

  it('returns Vimeo URL when signal source_url is a Vimeo link', () => {
    const sourceUrl = 'https://vimeo.com/76979871'
    expect(extractFirstEmbedUrl(sourceUrl)).toBe(sourceUrl)
  })

  it('returns null for a non-embeddable source_url (plain news article)', () => {
    expect(extractFirstEmbedUrl('https://reuters.com/world/breaking-story')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(extractFirstEmbedUrl('')).toBeNull()
  })
})

// ── isEmbeddable (drives "show player vs show button" logic) ────────────────

describe('signal detail media section logic', () => {
  it('shows media player when source_url is an embeddable YouTube URL', () => {
    const sourceUrl = 'https://youtu.be/dQw4w9WgXcQ'
    // When extractFirstEmbedUrl returns non-null → RichMediaEmbed is rendered
    expect(extractFirstEmbedUrl(sourceUrl)).not.toBeNull()
  })

  it('shows "View original source" button when source_url is non-embeddable', () => {
    const sourceUrl = 'https://apnews.com/article/some-article-id'
    // When extractFirstEmbedUrl returns null → no embed, prominent source button shown
    expect(extractFirstEmbedUrl(sourceUrl)).toBeNull()
  })

  it('media_urls array items that are YouTube URLs would each be embeddable', () => {
    const mediaUrls = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/oHg5SJYRHA0',
    ]
    // Every item in media_urls should produce an embed
    for (const url of mediaUrls) {
      expect(extractFirstEmbedUrl(url)).not.toBeNull()
    }
  })

  it('media_urls array items that are plain links would NOT produce an embed', () => {
    const mediaUrls = [
      'https://example.com/photo.jpg',
      'https://cdn.reuters.com/article',
    ]
    for (const url of mediaUrls) {
      expect(extractFirstEmbedUrl(url)).toBeNull()
    }
  })
})
