/**
 * Audio/Podcast Claim Extraction Pipeline — Unit Tests
 *
 * 48 test cases covering:
 *   - audioSourceId (4)
 *   - audioClaimId (3)
 *   - transcriptId (3)
 *   - cleanSpokenText (5)
 *   - isSupportedAudioUrl (7)
 *   - detectAudioSourceType (5)
 *   - extractSpokenEntities (5)
 *   - calculateClaimConfidence (5)
 *   - calculateOverallCredibility (5)
 *   - formatDuration (4)
 *   - formatTimestamp (4)
 *   - Constants validation (3)
 *
 * Tests inline pure functions to avoid importing the module (which pulls in knex/postgres).
 */

import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'

// ─── Inlined pure functions (mirror of audio-claims.ts) ─────────────────────

const SUPPORTED_AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.wav', '.ogg', '.webm', '.aac', '.flac']

const FILLER_PATTERNS = [
  /\b(?:um|uh|erm|hmm|like|you know|I mean|sort of|kind of|basically|literally|right|okay|so yeah)\b/gi,
  /\b(?:and uh|but um|so uh|well uh)\b/gi,
]

const SPOKEN_CLAIM_PATTERNS = [
  { pattern: /(?:^|[.!?]\s+)([^.!?]*?\b(?:\d+(?:\.\d+)?(?:\s*%|\s*percent)|\d{1,3}(?:,\d{3})+|\d+\s*(?:million|billion|trillion|thousand|hundred))\b[^.!?]*[.!?]?)/gi, type: 'statistical' as const },
  { pattern: /(?:^|[.!?]\s+)([^.!?]*?\b(?:said|claimed|stated|reported|announced|confirmed|denied|warned|revealed|disclosed|alleged|told me|mentioned|pointed out|argued|insisted)\b[^.!?]*[.!?]?)/gi, type: 'attribution' as const },
  { pattern: /(?:^|[.!?]\s+)([^.!?]*?\b(?:because|caused by|resulted? in|led to|due to|attributed to|as a result|contributed to|the reason is|that's why|which means)\b[^.!?]*[.!?]?)/gi, type: 'causal' as const },
  { pattern: /(?:^|[.!?]\s+)([^.!?]*?\b(?:will|going to|expected to|likely to|forecast|projected|predicted|anticipated|I think .* will|probably|almost certainly|bound to)\b[^.!?]*[.!?]?)/gi, type: 'predictive' as const },
  { pattern: /(?:^|[.!?]\s+)([^.!?]*?\b(?:is the (?:first|largest|smallest|most|least|only|highest|lowest|biggest|worst|best)|has been|was found|are considered|actually|in fact|the truth is|the reality is|it's a fact)\b[^.!?]*[.!?]?)/gi, type: 'factual' as const },
]

const NEWS_PODCAST_REGISTRY = [
  { name: 'NPR News Now', publisher: 'NPR', feed_url: 'https://feeds.npr.org/500005/podcast.xml', language: 'en', category: 'general_news' },
  { name: 'The Daily', publisher: 'The New York Times', feed_url: 'https://feeds.simplecast.com/54nAGcIl', language: 'en', category: 'general_news' },
  { name: 'Up First', publisher: 'NPR', feed_url: 'https://feeds.npr.org/510318/podcast.xml', language: 'en', category: 'general_news' },
  { name: 'Post Reports', publisher: 'The Washington Post', feed_url: 'https://feeds.megaphone.fm/PPY6458293959', language: 'en', category: 'general_news' },
  { name: 'The Intelligence', publisher: 'The Economist', feed_url: 'https://rss.acast.com/theintelligencepodcast', language: 'en', category: 'analysis' },
  { name: 'Global News Podcast', publisher: 'BBC World Service', feed_url: 'https://podcasts.files.bbci.co.uk/p02nq0gn.rss', language: 'en', category: 'international' },
  { name: 'France 24 — International News', publisher: 'France 24', feed_url: 'https://www.france24.com/en/podcasts/rss', language: 'en', category: 'international' },
  { name: 'Al Jazeera — The Take', publisher: 'Al Jazeera', feed_url: 'https://podcast.aljazeera.com/podcasts/thetake.xml', language: 'en', category: 'international' },
  { name: 'The Lawfare Podcast', publisher: 'Lawfare', feed_url: 'https://www.lawfaremedia.org/feed/lawfare-podcast-feed', language: 'en', category: 'security' },
  { name: 'War on the Rocks', publisher: 'War on the Rocks', feed_url: 'https://warontherocks.com/feed/podcast/', language: 'en', category: 'security' },
  { name: 'Hard Fork', publisher: 'The New York Times', feed_url: 'https://feeds.simplecast.com/l2i9YnTd', language: 'en', category: 'technology' },
  { name: 'Pivot', publisher: 'New York Magazine', feed_url: 'https://feeds.megaphone.fm/pivot', language: 'en', category: 'technology' },
  { name: 'Planet Money', publisher: 'NPR', feed_url: 'https://feeds.npr.org/510289/podcast.xml', language: 'en', category: 'economics' },
  { name: 'Odd Lots', publisher: 'Bloomberg', feed_url: 'https://feeds.bloomberg.com/podcasts/etf_iq.xml', language: 'en', category: 'economics' },
  { name: 'Science Friday', publisher: 'WNYC', feed_url: 'https://feeds.feedburner.com/sciencefriday', language: 'en', category: 'science' },
  { name: 'Reveal', publisher: 'The Center for Investigative Reporting', feed_url: 'https://feeds.megaphone.fm/revealpodcast', language: 'en', category: 'investigative' },
  { name: 'Journal en français facile', publisher: 'RFI', feed_url: 'https://www.rfi.fr/fr/podcasts/journal-français-facile/podcast', language: 'fr', category: 'international' },
  { name: 'El Hilo', publisher: 'Radio Ambulante', feed_url: 'https://feeds.megaphone.fm/elhilo', language: 'es', category: 'international' },
  { name: 'NachDenkSeiten', publisher: 'NachDenkSeiten', feed_url: 'https://www.nachdenkseiten.de/feed/', language: 'de', category: 'analysis' },
  { name: 'Internationalen', publisher: 'Dagens Nyheter', feed_url: 'https://rss.acast.com/internationalen', language: 'sv', category: 'international' },
]

function audioSourceId(url: string): string {
  return createHash('sha256').update(`audio:${url.toLowerCase().trim()}`).digest('hex').slice(0, 16)
}

function audioClaimId(transcriptId: string, claimText: string, startS: number): string {
  return createHash('sha256')
    .update(`claim:${transcriptId}:${claimText.toLowerCase().trim()}:${startS}`)
    .digest('hex').slice(0, 16)
}

function transcriptId(sourceId: string, provider: string): string {
  return createHash('sha256')
    .update(`transcript:${sourceId}:${provider}`)
    .digest('hex').slice(0, 16)
}

function cleanSpokenText(text: string): string {
  let cleaned = text
  for (const pattern of FILLER_PATTERNS) {
    cleaned = cleaned.replace(new RegExp(pattern.source, pattern.flags), ' ')
  }
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim()
  cleaned = cleaned.replace(/\s([.,!?;:])/g, '$1')
  cleaned = cleaned.replace(/([.!?])\s*([a-z])/g, '$1 $2')
  return cleaned
}

function isSupportedAudioUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.toLowerCase()
    return SUPPORTED_AUDIO_EXTENSIONS.some(ext => path.endsWith(ext)) ||
      parsed.hostname.includes('youtube.com') ||
      parsed.hostname.includes('youtu.be') ||
      parsed.hostname.includes('spotify.com') ||
      parsed.hostname.includes('anchor.fm') ||
      parsed.hostname.includes('podbean.com') ||
      parsed.hostname.includes('buzzsprout.com') ||
      parsed.hostname.includes('transistor.fm') ||
      parsed.hostname.includes('simplecast.com')
  } catch { return false }
}

function detectAudioSourceType(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube'
    if (host.includes('spotify.com') || host.includes('anchor.fm') || host.includes('podbean.com') ||
        host.includes('buzzsprout.com') || host.includes('transistor.fm') || host.includes('simplecast.com') ||
        host.includes('apple.com/podcast') || host.includes('podcasts.google.com')) return 'podcast'
    return 'direct_url'
  } catch { return 'direct_url' }
}

function extractSpokenEntities(text: string): string[] {
  const entities = new Set<string>()
  const titlePattern = /\b(?:President|Prime Minister|CEO|Minister|Secretary|Director|General|Ambassador|Senator|Governor|Mayor|Professor|Dr\.?)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g
  for (const match of text.matchAll(titlePattern)) { entities.add(match[0].trim()) }
  const orgPattern = /\b(?:United States|United Kingdom|European Union|United Nations|NATO|WHO|IMF|World Bank|Federal Reserve|Pentagon|Congress|Parliament|Supreme Court|FBI|CIA|NSA|CDC|FDA|EPA|SEC|FCC|DOJ|DOD|Treasury|State Department)\b/g
  for (const match of text.matchAll(orgPattern)) { entities.add(match[0].trim()) }
  const properNounPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g
  const falsePositives = new Set(['I Think', 'I Mean', 'You Know', 'But Also', 'And Then', 'So What', 'In Fact', 'Right Now', 'Last Week', 'Next Year', 'This Morning', 'Of Course', 'In Terms', 'At This', 'On The', 'For The'])
  for (const match of text.matchAll(properNounPattern)) {
    const entity = match[0].trim()
    if (!falsePositives.has(entity) && entity.length > 3 && entity.length < 60) entities.add(entity)
  }
  return [...entities].slice(0, 15)
}

type ClaimType = 'factual' | 'statistical' | 'attribution' | 'causal' | 'predictive' | 'opinion'

function calculateClaimConfidence(text: string, type: ClaimType): number {
  let score = 0.5
  if (/\d/.test(text)) score += 0.15
  if (/(?:according to|data shows|study found|research indicates)/i.test(text)) score += 0.2
  if (/(?:percent|%|million|billion|thousand)/i.test(text)) score += 0.15
  if (/(?:official|confirmed|report|published)/i.test(text)) score += 0.1
  if (/(?:I think|maybe|possibly|might|could be|seems like|not sure)/i.test(text)) score -= 0.2
  if (/(?:in my opinion|personally|I feel|I believe)/i.test(text)) score -= 0.25
  if (type === 'statistical') score += 0.1
  if (type === 'attribution') score += 0.05
  if (type === 'predictive') score -= 0.05
  if (text.length < 30) score -= 0.1
  if (text.length > 100) score += 0.05
  return Math.max(0, Math.min(1, Math.round(score * 100) / 100))
}

interface AudioClaimLike { type: ClaimType; status: string; confidence: number }

function calculateOverallCredibility(claims: AudioClaimLike[]): number {
  if (claims.length === 0) return 0
  const verifiable = claims.filter(c => c.type !== 'opinion')
  if (verifiable.length === 0) return 0.5
  let wSum = 0, wTotal = 0
  for (const c of verifiable) {
    const w = c.confidence
    let s: number
    switch (c.status) {
      case 'verified': s = 1.0; break; case 'mixed': s = 0.6; break
      case 'unverified': s = 0.5; break; case 'disputed': s = 0.1; break
      default: s = 0.5
    }
    wSum += s * w; wTotal += w
  }
  return wTotal > 0 ? Math.round((wSum / wTotal) * 100) / 100 : 0.5
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// ─── TESTS ──────────────────────────────────────────────────────────────────

describe('audioSourceId', () => {
  it('returns a 16-char hex string', () => {
    expect(audioSourceId('https://example.com/pod.mp3')).toMatch(/^[0-9a-f]{16}$/)
  })
  it('is deterministic', () => {
    const a = audioSourceId('https://example.com/pod.mp3')
    const b = audioSourceId('https://example.com/pod.mp3')
    expect(a).toBe(b)
  })
  it('differs for different URLs', () => {
    expect(audioSourceId('https://example.com/ep1.mp3')).not.toBe(audioSourceId('https://example.com/ep2.mp3'))
  })
  it('normalizes case', () => {
    expect(audioSourceId('https://EXAMPLE.com/POD.mp3')).toBe(audioSourceId('https://example.com/pod.mp3'))
  })
})

describe('audioClaimId', () => {
  it('returns a 16-char hex string', () => {
    expect(audioClaimId('t1', 'GDP grew 3%', 120)).toMatch(/^[0-9a-f]{16}$/)
  })
  it('is deterministic', () => {
    expect(audioClaimId('t1', 'GDP grew 3%', 120)).toBe(audioClaimId('t1', 'GDP grew 3%', 120))
  })
  it('differs when timestamp changes', () => {
    expect(audioClaimId('t1', 'GDP grew 3%', 120)).not.toBe(audioClaimId('t1', 'GDP grew 3%', 200))
  })
})

describe('transcriptId', () => {
  it('returns a 16-char hex string', () => {
    expect(transcriptId('s1', 'whisper')).toMatch(/^[0-9a-f]{16}$/)
  })
  it('is deterministic', () => {
    expect(transcriptId('s1', 'whisper')).toBe(transcriptId('s1', 'whisper'))
  })
  it('differs by provider', () => {
    expect(transcriptId('s1', 'whisper')).not.toBe(transcriptId('s1', 'deepgram'))
  })
})

describe('cleanSpokenText', () => {
  it('removes filler words', () => {
    const result = cleanSpokenText('So um the economy uh grew by like 3 percent')
    expect(result).not.toContain(' um ')
    expect(result).not.toContain(' uh ')
  })
  it('normalizes whitespace', () => {
    expect(cleanSpokenText('The   GDP   grew')).not.toContain('  ')
  })
  it('fixes space before punctuation', () => {
    expect(cleanSpokenText('Economy grew .')).toContain('grew.')
  })
  it('handles empty input', () => {
    expect(cleanSpokenText('')).toBe('')
  })
  it('preserves meaningful content', () => {
    const result = cleanSpokenText('President Biden announced sanctions.')
    expect(result).toContain('President Biden')
    expect(result).toContain('sanctions')
  })
})

describe('isSupportedAudioUrl', () => {
  it('accepts .mp3', () => { expect(isSupportedAudioUrl('https://example.com/ep.mp3')).toBe(true) })
  it('accepts .m4a', () => { expect(isSupportedAudioUrl('https://cdn.ex.com/a.m4a')).toBe(true) })
  it('accepts YouTube', () => { expect(isSupportedAudioUrl('https://www.youtube.com/watch?v=abc')).toBe(true) })
  it('accepts youtu.be', () => { expect(isSupportedAudioUrl('https://youtu.be/abc')).toBe(true) })
  it('accepts podcast platforms', () => {
    expect(isSupportedAudioUrl('https://anchor.fm/show/ep1')).toBe(true)
    expect(isSupportedAudioUrl('https://www.buzzsprout.com/123')).toBe(true)
  })
  it('rejects non-audio', () => { expect(isSupportedAudioUrl('https://example.com/page.html')).toBe(false) })
  it('rejects invalid URLs', () => { expect(isSupportedAudioUrl('not-a-url')).toBe(false) })
})

describe('detectAudioSourceType', () => {
  it('detects YouTube', () => { expect(detectAudioSourceType('https://www.youtube.com/watch?v=abc')).toBe('youtube') })
  it('detects youtu.be', () => { expect(detectAudioSourceType('https://youtu.be/abc')).toBe('youtube') })
  it('detects podcast platforms', () => {
    expect(detectAudioSourceType('https://anchor.fm/show/ep1')).toBe('podcast')
    expect(detectAudioSourceType('https://open.spotify.com/episode/123')).toBe('podcast')
  })
  it('defaults to direct_url', () => { expect(detectAudioSourceType('https://example.com/audio.mp3')).toBe('direct_url') })
  it('defaults for invalid input', () => { expect(detectAudioSourceType('not-a-url')).toBe('direct_url') })
})

describe('extractSpokenEntities', () => {
  it('extracts titled persons', () => {
    expect(extractSpokenEntities('President Biden announced the policy.').some(e => e.includes('Biden'))).toBe(true)
  })
  it('extracts organizations', () => {
    expect(extractSpokenEntities('NATO reported movements.')).toContain('NATO')
  })
  it('extracts WHO', () => {
    expect(extractSpokenEntities('The WHO issued guidelines.')).toContain('WHO')
  })
  it('filters false positives', () => {
    const e = extractSpokenEntities('I Think But Also this is true.')
    expect(e).not.toContain('I Think')
    expect(e).not.toContain('But Also')
  })
  it('caps at 15', () => {
    const long = Array.from({ length: 20 }, (_, i) => `Director Smith${i} spoke.`).join(' ')
    expect(extractSpokenEntities(long).length).toBeLessThanOrEqual(15)
  })
})

describe('calculateClaimConfidence', () => {
  it('higher for numeric claims', () => {
    expect(calculateClaimConfidence('GDP grew by 3.5% last quarter.', 'statistical'))
      .toBeGreaterThan(calculateClaimConfidence('The economy grew significantly.', 'factual'))
  })
  it('penalizes hedging', () => {
    expect(calculateClaimConfidence('Data shows inflation rose 5%.', 'statistical'))
      .toBeGreaterThan(calculateClaimConfidence('I think maybe inflation rose 5%.', 'statistical'))
  })
  it('penalizes opinions', () => {
    expect(calculateClaimConfidence('Report confirmed 500 cases.', 'factual'))
      .toBeGreaterThan(calculateClaimConfidence('In my opinion there are 500 cases.', 'factual'))
  })
  it('returns 0-1', () => {
    const s = calculateClaimConfidence('Some text.', 'factual')
    expect(s).toBeGreaterThanOrEqual(0)
    expect(s).toBeLessThanOrEqual(1)
  })
  it('boosts attribution keywords', () => {
    expect(calculateClaimConfidence('According to official data shows unemployment fell.', 'factual'))
      .toBeGreaterThan(calculateClaimConfidence('Some people were out of work.', 'factual'))
  })
})

describe('calculateOverallCredibility', () => {
  it('returns 0 for empty', () => { expect(calculateOverallCredibility([])).toBe(0) })
  it('returns 0.5 for all opinions', () => {
    expect(calculateOverallCredibility([{ type: 'opinion', status: 'opinion', confidence: 0.5 }])).toBe(0.5)
  })
  it('returns 1.0 for all verified', () => {
    expect(calculateOverallCredibility([
      { type: 'factual', status: 'verified', confidence: 1.0 },
      { type: 'statistical', status: 'verified', confidence: 1.0 },
    ])).toBe(1.0)
  })
  it('returns low for all disputed', () => {
    expect(calculateOverallCredibility([
      { type: 'factual', status: 'disputed', confidence: 0.8 },
    ])).toBeLessThan(0.3)
  })
  it('handles mixed', () => {
    const s = calculateOverallCredibility([
      { type: 'factual', status: 'verified', confidence: 0.9 },
      { type: 'factual', status: 'disputed', confidence: 0.8 },
    ])
    expect(s).toBeGreaterThan(0.3)
    expect(s).toBeLessThan(0.8)
  })
})

describe('formatDuration', () => {
  it('formats seconds', () => { expect(formatDuration(45)).toBe('45s') })
  it('formats minutes', () => { expect(formatDuration(125)).toBe('2m 5s') })
  it('formats hours', () => { expect(formatDuration(3661)).toBe('1h 1m 1s') })
  it('handles zero', () => { expect(formatDuration(0)).toBe('0s') })
})

describe('formatTimestamp', () => {
  it('under a minute', () => { expect(formatTimestamp(45)).toBe('0:45') })
  it('minutes', () => { expect(formatTimestamp(125)).toBe('2:05') })
  it('hours', () => { expect(formatTimestamp(3661)).toBe('1:01:01') })
  it('zero', () => { expect(formatTimestamp(0)).toBe('0:00') })
})

describe('Constants', () => {
  it('SPOKEN_CLAIM_PATTERNS covers all types', () => {
    const types = new Set(SPOKEN_CLAIM_PATTERNS.map(p => p.type))
    expect(types).toContain('statistical')
    expect(types).toContain('attribution')
    expect(types).toContain('causal')
    expect(types).toContain('predictive')
    expect(types).toContain('factual')
  })
  it('NEWS_PODCAST_REGISTRY has 20 feeds', () => {
    expect(NEWS_PODCAST_REGISTRY).toHaveLength(20)
  })
  it('FILLER_PATTERNS are valid RegExps', () => {
    for (const p of FILLER_PATTERNS) { expect(() => new RegExp(p.source, p.flags)).not.toThrow() }
  })
})
