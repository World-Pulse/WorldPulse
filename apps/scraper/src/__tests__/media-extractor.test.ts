import { describe, it, expect } from 'vitest'
import { parseYouTubeId, extractMediaFromContent } from '../pipeline/media-extractor'

// ─── parseYouTubeId ──────────────────────────────────────────────────────────

describe('parseYouTubeId', () => {
  it('extracts ID from watch?v= URL', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('extracts ID from youtu.be short URL', () => {
    expect(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('extracts ID from youtube.com/embed/ URL', () => {
    expect(parseYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('extracts ID from youtube.com/shorts/ URL', () => {
    expect(parseYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('extracts ID from mobile m.youtube.com URL', () => {
    expect(parseYouTubeId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('returns null for non-YouTube URL', () => {
    expect(parseYouTubeId('https://vimeo.com/123456789')).toBeNull()
  })

  it('returns null for plain youtube.com with no video', () => {
    expect(parseYouTubeId('https://www.youtube.com/')).toBeNull()
  })

  it('returns null for invalid (< 11 char) video ID', () => {
    expect(parseYouTubeId('https://youtu.be/short')).toBeNull()
  })

  it('handles youtu.be URLs with query params', () => {
    expect(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe('dQw4w9WgXcQ')
  })
})

// ─── extractMediaFromContent ─────────────────────────────────────────────────

describe('extractMediaFromContent', () => {
  it('finds YouTube link in article URL', () => {
    const items = extractMediaFromContent(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      null,
      null,
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('youtube')
    expect(items[0]!.embedId).toBe('dQw4w9WgXcQ')
  })

  it('finds YouTube link embedded in body text', () => {
    const body = 'Watch the full press conference: https://youtu.be/dQw4w9WgXcQ for details.'
    const items = extractMediaFromContent('https://example.com/article', body, null)
    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('youtube')
    expect(items[0]!.embedId).toBe('dQw4w9WgXcQ')
  })

  it('finds mp3 podcast audio URL in body', () => {
    const body = 'Listen here: https://podcast.example.com/episodes/ep42.mp3 — enjoy!'
    const items = extractMediaFromContent('https://news.example.com/article', body, null)
    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('podcast_audio')
    expect(items[0]!.url).toBe('https://podcast.example.com/episodes/ep42.mp3')
  })

  it('finds Spotify podcast URL in body', () => {
    const body = 'Tune in: https://open.spotify.com/episode/6rqhFgbbKwnb9MLmUQDhG6'
    const items = extractMediaFromContent('https://example.com', body, null)
    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('podcast_audio')
  })

  it('finds SoundCloud URL in body', () => {
    const body = 'Stream: https://soundcloud.com/artist/track-name'
    const items = extractMediaFromContent('https://example.com', body, null)
    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('podcast_audio')
  })

  it('deduplicates the same YouTube ID appearing multiple times', () => {
    const body = `
      Mentioned twice:
      https://www.youtube.com/watch?v=dQw4w9WgXcQ
      https://youtu.be/dQw4w9WgXcQ
    `
    const items = extractMediaFromContent('https://example.com', body, null)
    expect(items).toHaveLength(1)
  })

  it('returns [] if no media found', () => {
    const items = extractMediaFromContent('https://example.com/news', 'No media here.', null)
    expect(items).toHaveLength(0)
  })

  it('handles null body gracefully', () => {
    const items = extractMediaFromContent('https://example.com/news', null, null)
    expect(items).toHaveLength(0)
  })

  it('handles undefined body gracefully', () => {
    const items = extractMediaFromContent('https://example.com/news', undefined, null)
    expect(items).toHaveLength(0)
  })

  it('extracts media from sourceUrl when article URL has none', () => {
    const items = extractMediaFromContent(
      'https://example.com/article',
      null,
      'https://youtu.be/dQw4w9WgXcQ',
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.embedId).toBe('dQw4w9WgXcQ')
  })

  it('extracts multiple distinct media items from body', () => {
    const body = `
      Video: https://www.youtube.com/watch?v=dQw4w9WgXcQ
      Podcast: https://anchor.fm/show/episode-1
    `
    const items = extractMediaFromContent('https://example.com', body, null)
    expect(items).toHaveLength(2)
    expect(items.map(i => i.type).sort()).toEqual(['podcast_audio', 'youtube'])
  })

  it('handles m4a audio extension', () => {
    const body = 'Download: https://cdn.example.com/episode.m4a'
    const items = extractMediaFromContent('https://example.com', body, null)
    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('podcast_audio')
  })

  it('does not pick up unrelated https links', () => {
    const body = 'Read more at https://reuters.com/article/some-story-idUSKBN123'
    const items = extractMediaFromContent('https://example.com', body, null)
    expect(items).toHaveLength(0)
  })

  it('finds Apple Podcasts URL', () => {
    const body = 'Listen: https://podcasts.apple.com/us/podcast/show/id123456789'
    const items = extractMediaFromContent('https://example.com', body, null)
    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('podcast_audio')
  })
})
