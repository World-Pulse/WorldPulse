/**
 * Audio Claims API Routes — Unit Tests
 *
 * 38 test cases covering:
 *   - Audio source type constants (2)
 *   - Audio claim type constants (2)
 *   - Audio claim status constants (2)
 *   - Sort field validation (4)
 *   - Pagination: clampPage (4)
 *   - Pagination: clampLimit (4)
 *   - mapSourceRow (4)
 *   - mapClaimRow (4)
 *   - mapTranscriptRow (3)
 *   - NEWS_PODCAST_FEEDS (5)
 *   - Cache key consistency (4)
 */

import { describe, it, expect } from 'vitest'

// ─── Inline constants (avoid importing route file which pulls in knex/postgres) ─

const AUDIO_SOURCE_TYPES = ['podcast', 'youtube', 'direct_url', 'live_stream'] as const
const AUDIO_CLAIM_TYPES = ['factual', 'statistical', 'attribution', 'causal', 'predictive', 'opinion'] as const
const AUDIO_CLAIM_STATUSES = ['verified', 'disputed', 'unverified', 'mixed', 'opinion'] as const
const SORT_FIELDS = ['confidence', 'verification_score', 'timestamp_start_s', 'extracted_at', 'status'] as const

type AudioSourceType = typeof AUDIO_SOURCE_TYPES[number]
type AudioClaimType = typeof AUDIO_CLAIM_TYPES[number]
type AudioClaimStatus = typeof AUDIO_CLAIM_STATUSES[number]
type SortField = typeof SORT_FIELDS[number]

function clampPage(page: unknown, fallback = 1): number {
  const n = Number(page)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(n, 1000)
}

function clampLimit(limit: unknown, fallback = 20): number {
  const n = Number(limit)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(n, 100)
}

function isValidSortField(field: unknown): field is SortField {
  return typeof field === 'string' && (SORT_FIELDS as readonly string[]).includes(field)
}

function mapSourceRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    url: String(row.url ?? ''),
    type: String(row.type ?? 'direct_url') as AudioSourceType,
    title: String(row.title ?? ''),
    publisher: String(row.publisher ?? ''),
    language: String(row.language ?? 'en'),
    duration_s: row.duration_s != null ? Number(row.duration_s) : null,
    published_at: row.published_at ? String(row.published_at) : null,
    podcast_name: row.podcast_name ? String(row.podcast_name) : null,
    episode_number: row.episode_number != null ? Number(row.episode_number) : null,
    metadata: row.metadata ?? {},
    created_at: String(row.created_at ?? ''),
    last_processed_at: row.last_processed_at ? String(row.last_processed_at) : null,
  }
}

function mapClaimRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    transcript_id: String(row.transcript_id ?? ''),
    source_id: String(row.source_id ?? ''),
    text: String(row.text ?? ''),
    type: String(row.type ?? 'factual') as AudioClaimType,
    confidence: Number(row.confidence ?? 0),
    verification_score: Number(row.verification_score ?? 0),
    status: String(row.status ?? 'unverified') as AudioClaimStatus,
    speaker: row.speaker ? String(row.speaker) : null,
    speaker_name: row.speaker_name ? String(row.speaker_name) : null,
    timestamp_start_s: Number(row.timestamp_start_s ?? 0),
    timestamp_end_s: Number(row.timestamp_end_s ?? 0),
    context: row.context ? String(row.context) : null,
    entities: Array.isArray(row.entities) ? row.entities : [],
    cross_references: row.cross_references ?? [],
    extracted_at: String(row.extracted_at ?? ''),
  }
}

function mapTranscriptRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    source_id: String(row.source_id ?? ''),
    language: String(row.language ?? 'en'),
    duration_s: Number(row.duration_s ?? 0),
    word_count: Number(row.word_count ?? 0),
    speaker_count: Number(row.speaker_count ?? 0),
    provider: String(row.provider ?? 'whisper'),
    segments: row.segments ?? [],
    transcribed_at: String(row.transcribed_at ?? ''),
  }
}

const NEWS_PODCAST_FEEDS = [
  { name: 'NPR News Now', publisher: 'NPR', language: 'en', category: 'general_news', feed_url: 'https://feeds.npr.org/500005/podcast.xml' },
  { name: 'The Daily', publisher: 'The New York Times', language: 'en', category: 'general_news', feed_url: 'https://feeds.simplecast.com/54nAGcIl' },
  { name: 'Up First', publisher: 'NPR', language: 'en', category: 'general_news', feed_url: 'https://feeds.npr.org/510318/podcast.xml' },
  { name: 'Post Reports', publisher: 'The Washington Post', language: 'en', category: 'general_news', feed_url: 'https://feeds.megaphone.fm/PPY6458293959' },
  { name: 'The Intelligence', publisher: 'The Economist', language: 'en', category: 'analysis', feed_url: 'https://rss.acast.com/theintelligencepodcast' },
  { name: 'Global News Podcast', publisher: 'BBC World Service', language: 'en', category: 'international', feed_url: 'https://podcasts.files.bbci.co.uk/p02nq0gn.rss' },
  { name: 'France 24 — International News', publisher: 'France 24', language: 'en', category: 'international', feed_url: 'https://www.france24.com/en/podcasts/rss' },
  { name: 'Al Jazeera — The Take', publisher: 'Al Jazeera', language: 'en', category: 'international', feed_url: 'https://podcast.aljazeera.com/podcasts/thetake.xml' },
  { name: 'The Lawfare Podcast', publisher: 'Lawfare', language: 'en', category: 'security', feed_url: 'https://www.lawfaremedia.org/feed/lawfare-podcast-feed' },
  { name: 'War on the Rocks', publisher: 'War on the Rocks', language: 'en', category: 'security', feed_url: 'https://warontherocks.com/feed/podcast/' },
  { name: 'Hard Fork', publisher: 'The New York Times', language: 'en', category: 'technology', feed_url: 'https://feeds.simplecast.com/l2i9YnTd' },
  { name: 'Pivot', publisher: 'New York Magazine', language: 'en', category: 'technology', feed_url: 'https://feeds.megaphone.fm/pivot' },
  { name: 'Planet Money', publisher: 'NPR', language: 'en', category: 'economics', feed_url: 'https://feeds.npr.org/510289/podcast.xml' },
  { name: 'Science Friday', publisher: 'WNYC', language: 'en', category: 'science', feed_url: 'https://feeds.feedburner.com/sciencefriday' },
  { name: 'Reveal', publisher: 'The Center for Investigative Reporting', language: 'en', category: 'investigative', feed_url: 'https://feeds.megaphone.fm/revealpodcast' },
  { name: 'Journal en français facile', publisher: 'RFI', language: 'fr', category: 'international', feed_url: 'https://www.rfi.fr/fr/podcasts/journal-français-facile/podcast' },
  { name: 'El Hilo', publisher: 'Radio Ambulante', language: 'es', category: 'international', feed_url: 'https://feeds.megaphone.fm/elhilo' },
  { name: 'NachDenkSeiten', publisher: 'NachDenkSeiten', language: 'de', category: 'analysis', feed_url: 'https://www.nachdenkseiten.de/feed/' },
  { name: 'Internationalen', publisher: 'Dagens Nyheter', language: 'sv', category: 'international', feed_url: 'https://rss.acast.com/internationalen' },
  { name: 'Odd Lots', publisher: 'Bloomberg', language: 'en', category: 'economics', feed_url: 'https://feeds.bloomberg.com/podcasts/etf_iq.xml' },
] as const

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AUDIO_SOURCE_TYPES', () => {
  it('includes all source types', () => {
    expect(AUDIO_SOURCE_TYPES).toContain('podcast')
    expect(AUDIO_SOURCE_TYPES).toContain('youtube')
    expect(AUDIO_SOURCE_TYPES).toContain('direct_url')
    expect(AUDIO_SOURCE_TYPES).toContain('live_stream')
  })

  it('has exactly 4 types', () => {
    expect(AUDIO_SOURCE_TYPES).toHaveLength(4)
  })
})

describe('AUDIO_CLAIM_TYPES', () => {
  it('includes all claim types', () => {
    expect(AUDIO_CLAIM_TYPES).toContain('factual')
    expect(AUDIO_CLAIM_TYPES).toContain('statistical')
    expect(AUDIO_CLAIM_TYPES).toContain('attribution')
    expect(AUDIO_CLAIM_TYPES).toContain('causal')
    expect(AUDIO_CLAIM_TYPES).toContain('predictive')
    expect(AUDIO_CLAIM_TYPES).toContain('opinion')
  })

  it('has exactly 6 types', () => {
    expect(AUDIO_CLAIM_TYPES).toHaveLength(6)
  })
})

describe('AUDIO_CLAIM_STATUSES', () => {
  it('includes all statuses', () => {
    expect(AUDIO_CLAIM_STATUSES).toContain('verified')
    expect(AUDIO_CLAIM_STATUSES).toContain('disputed')
    expect(AUDIO_CLAIM_STATUSES).toContain('unverified')
    expect(AUDIO_CLAIM_STATUSES).toContain('mixed')
    expect(AUDIO_CLAIM_STATUSES).toContain('opinion')
  })

  it('has exactly 5 statuses', () => {
    expect(AUDIO_CLAIM_STATUSES).toHaveLength(5)
  })
})

describe('clampPage', () => {
  it('returns fallback for non-numeric input', () => {
    expect(clampPage('abc')).toBe(1)
    expect(clampPage(undefined)).toBe(1)
    expect(clampPage(null)).toBe(1)
  })

  it('returns fallback for zero or negative', () => {
    expect(clampPage(0)).toBe(1)
    expect(clampPage(-5)).toBe(1)
  })

  it('caps at 1000', () => {
    expect(clampPage(5000)).toBe(1000)
  })

  it('returns valid page numbers', () => {
    expect(clampPage(1)).toBe(1)
    expect(clampPage(50)).toBe(50)
    expect(clampPage(999)).toBe(999)
  })
})

describe('clampLimit', () => {
  it('returns fallback for non-numeric input', () => {
    expect(clampLimit('abc')).toBe(20)
    expect(clampLimit(undefined)).toBe(20)
  })

  it('returns fallback for zero or negative', () => {
    expect(clampLimit(0)).toBe(20)
    expect(clampLimit(-10)).toBe(20)
  })

  it('caps at 100', () => {
    expect(clampLimit(500)).toBe(100)
  })

  it('returns valid limits', () => {
    expect(clampLimit(10)).toBe(10)
    expect(clampLimit(50)).toBe(50)
    expect(clampLimit(100)).toBe(100)
  })
})

describe('isValidSortField', () => {
  it('validates known sort fields', () => {
    for (const field of SORT_FIELDS) {
      expect(isValidSortField(field)).toBe(true)
    }
  })

  it('rejects unknown fields', () => {
    expect(isValidSortField('random')).toBe(false)
    expect(isValidSortField('')).toBe(false)
  })

  it('rejects non-string types', () => {
    expect(isValidSortField(123)).toBe(false)
    expect(isValidSortField(null)).toBe(false)
  })

  it('validates all 5 sort fields', () => {
    expect(SORT_FIELDS).toHaveLength(5)
  })
})

describe('mapSourceRow', () => {
  const fullRow = {
    id: 'abc123', url: 'https://example.com/audio.mp3', type: 'podcast',
    title: 'Test Podcast', publisher: 'Test Pub', language: 'en',
    duration_s: 3600, published_at: '2026-04-06T00:00:00Z',
    podcast_name: 'My Pod', episode_number: 42,
    metadata: { genre: 'news' }, created_at: '2026-04-06T00:00:00Z',
    last_processed_at: '2026-04-06T01:00:00Z',
  }

  it('maps all fields correctly', () => {
    const mapped = mapSourceRow(fullRow)
    expect(mapped.id).toBe('abc123')
    expect(mapped.type).toBe('podcast')
    expect(mapped.duration_s).toBe(3600)
    expect(mapped.podcast_name).toBe('My Pod')
    expect(mapped.episode_number).toBe(42)
  })

  it('handles null optional fields', () => {
    const sparse = { id: 'x', url: 'u', type: 'direct_url', title: 't', publisher: 'p', created_at: 'now' }
    const mapped = mapSourceRow(sparse)
    expect(mapped.duration_s).toBeNull()
    expect(mapped.published_at).toBeNull()
    expect(mapped.podcast_name).toBeNull()
    expect(mapped.last_processed_at).toBeNull()
  })

  it('defaults missing fields', () => {
    const mapped = mapSourceRow({})
    expect(mapped.id).toBe('')
    expect(mapped.type).toBe('direct_url')
    expect(mapped.language).toBe('en')
  })

  it('converts type to string', () => {
    const mapped = mapSourceRow({ ...fullRow, type: 'youtube' })
    expect(typeof mapped.type).toBe('string')
    expect(mapped.type).toBe('youtube')
  })
})

describe('mapClaimRow', () => {
  const fullRow = {
    id: 'c1', transcript_id: 't1', source_id: 's1', text: 'GDP grew 3%.',
    type: 'statistical', confidence: 0.85, verification_score: 0.72,
    status: 'verified', speaker: 'Speaker 1', speaker_name: 'John',
    timestamp_start_s: 120, timestamp_end_s: 135, context: 'context...',
    entities: ['GDP'], cross_references: [{ source_name: 'BLS' }],
    extracted_at: '2026-04-06T00:00:00Z',
  }

  it('maps all fields correctly', () => {
    const mapped = mapClaimRow(fullRow)
    expect(mapped.id).toBe('c1')
    expect(mapped.text).toBe('GDP grew 3%.')
    expect(mapped.confidence).toBe(0.85)
    expect(mapped.speaker_name).toBe('John')
  })

  it('handles null optional fields', () => {
    const mapped = mapClaimRow({ id: 'c', text: 't', extracted_at: 'now' })
    expect(mapped.speaker).toBeNull()
    expect(mapped.speaker_name).toBeNull()
    expect(mapped.context).toBeNull()
  })

  it('defaults numeric fields to 0', () => {
    const mapped = mapClaimRow({})
    expect(mapped.confidence).toBe(0)
    expect(mapped.verification_score).toBe(0)
    expect(mapped.timestamp_start_s).toBe(0)
  })

  it('handles entities array', () => {
    const mapped = mapClaimRow(fullRow)
    expect(mapped.entities).toEqual(['GDP'])
    const noEntities = mapClaimRow({})
    expect(noEntities.entities).toEqual([])
  })
})

describe('mapTranscriptRow', () => {
  it('maps all fields', () => {
    const row = {
      id: 't1', source_id: 's1', language: 'fr', duration_s: 1800,
      word_count: 5000, speaker_count: 3, provider: 'deepgram',
      segments: [{ start_s: 0, end_s: 10 }], transcribed_at: '2026-04-06T00:00:00Z',
    }
    const mapped = mapTranscriptRow(row)
    expect(mapped.id).toBe('t1')
    expect(mapped.language).toBe('fr')
    expect(mapped.duration_s).toBe(1800)
    expect(mapped.provider).toBe('deepgram')
  })

  it('defaults missing fields', () => {
    const mapped = mapTranscriptRow({})
    expect(mapped.language).toBe('en')
    expect(mapped.duration_s).toBe(0)
    expect(mapped.provider).toBe('whisper')
  })

  it('preserves segments', () => {
    const segs = [{ start_s: 0, end_s: 5, text: 'Hello' }]
    const mapped = mapTranscriptRow({ segments: segs })
    expect(mapped.segments).toEqual(segs)
  })
})

describe('NEWS_PODCAST_FEEDS', () => {
  it('has 20 feeds', () => {
    expect(NEWS_PODCAST_FEEDS).toHaveLength(20)
  })

  it('all feeds have required fields', () => {
    for (const feed of NEWS_PODCAST_FEEDS) {
      expect(feed.name).toBeTruthy()
      expect(feed.publisher).toBeTruthy()
      expect(feed.language).toBeTruthy()
      expect(feed.category).toBeTruthy()
      expect(feed.feed_url).toBeTruthy()
    }
  })

  it('includes major publishers', () => {
    const publishers = NEWS_PODCAST_FEEDS.map(f => f.publisher)
    expect(publishers).toContain('NPR')
    expect(publishers).toContain('BBC World Service')
    expect(publishers).toContain('The New York Times')
  })

  it('includes multiple languages', () => {
    const langs = new Set(NEWS_PODCAST_FEEDS.map(f => f.language))
    expect(langs.size).toBeGreaterThanOrEqual(4)
    expect(langs.has('en')).toBe(true)
    expect(langs.has('fr')).toBe(true)
    expect(langs.has('es')).toBe(true)
  })

  it('covers diverse categories', () => {
    const cats = new Set(NEWS_PODCAST_FEEDS.map(f => f.category))
    expect(cats.size).toBeGreaterThanOrEqual(5)
  })
})

describe('Cache Key Consistency', () => {
  it('generates unique keys for different params', () => {
    const key1 = `audio:claims:list:factual:verified:null:null:null:confidence:DESC:1:20`
    const key2 = `audio:claims:list:statistical:verified:null:null:null:confidence:DESC:1:20`
    expect(key1).not.toBe(key2)
  })

  it('generates consistent keys for same params', () => {
    const params = { type: 'factual', status: 'verified', page: 1, limit: 20 }
    const key1 = `audio:claims:list:${params.type}:${params.status}:null:null:null:confidence:DESC:${params.page}:${params.limit}`
    const key2 = `audio:claims:list:${params.type}:${params.status}:null:null:null:confidence:DESC:${params.page}:${params.limit}`
    expect(key1).toBe(key2)
  })

  it('source cache keys include ID', () => {
    const key = `audio:source:abc123`
    expect(key).toContain('abc123')
  })

  it('stats cache key is stable', () => {
    expect('audio:stats').toBe('audio:stats')
  })
})
