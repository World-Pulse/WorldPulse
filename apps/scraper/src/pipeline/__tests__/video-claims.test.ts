/**
 * Video/Transcript Claim Extraction Pipeline — Unit Tests
 *
 * Tests claim extraction, confidence scoring, scene segmentation,
 * entity extraction, type detection, and all pipeline utilities.
 */

import { describe, it, expect } from 'vitest'
import {
  VIDEO_SOURCE_TYPES,
  VIDEO_CLAIM_TYPES,
  VIDEO_CLAIM_STATUSES,
  SUPPORTED_LANGUAGES,
  LANGUAGE_NAMES,
  MONITORED_CHANNELS,
  MIN_CLAIM_CONFIDENCE,
  MAX_CLAIMS_PER_VIDEO,
  CACHE_TTL_S,
  CLAIM_PATTERNS,
  DEBATE_PATTERNS,
  BROADCAST_PATTERNS,
  removeFillers,
  hashVideo,
  hashClaim,
  scoreClaimConfidence,
  detectClaimType,
  extractEntities,
  segmentScenes,
  inferTopic,
  calculateCredibility,
  buildClaimSummary,
  extractClaimsFromText,
  type TranscriptSegment,
  type VideoClaim,
  type VideoClaimType as VCT,
  type VideoClaimStatus as VCS,
} from '../video-claims'

// ─── Constants ───────────────────────────────────────────────────────────────

describe('VIDEO_SOURCE_TYPES', () => {
  it('contains all 7 source types', () => {
    expect(VIDEO_SOURCE_TYPES).toHaveLength(7)
    expect(VIDEO_SOURCE_TYPES).toContain('youtube')
    expect(VIDEO_SOURCE_TYPES).toContain('news_broadcast')
    expect(VIDEO_SOURCE_TYPES).toContain('political_debate')
    expect(VIDEO_SOURCE_TYPES).toContain('press_conference')
    expect(VIDEO_SOURCE_TYPES).toContain('un_session')
    expect(VIDEO_SOURCE_TYPES).toContain('direct_url')
    expect(VIDEO_SOURCE_TYPES).toContain('live_stream')
  })
})

describe('VIDEO_CLAIM_TYPES', () => {
  it('contains all 8 claim types including visual/chyron', () => {
    expect(VIDEO_CLAIM_TYPES).toHaveLength(8)
    expect(VIDEO_CLAIM_TYPES).toContain('factual')
    expect(VIDEO_CLAIM_TYPES).toContain('visual')
    expect(VIDEO_CLAIM_TYPES).toContain('chyron')
    expect(VIDEO_CLAIM_TYPES).toContain('opinion')
  })
})

describe('VIDEO_CLAIM_STATUSES', () => {
  it('contains 6 statuses including retracted', () => {
    expect(VIDEO_CLAIM_STATUSES).toHaveLength(6)
    expect(VIDEO_CLAIM_STATUSES).toContain('retracted')
    expect(VIDEO_CLAIM_STATUSES).toContain('verified')
  })
})

describe('SUPPORTED_LANGUAGES', () => {
  it('supports 12 languages', () => {
    expect(SUPPORTED_LANGUAGES).toHaveLength(12)
    expect(SUPPORTED_LANGUAGES).toContain('en')
    expect(SUPPORTED_LANGUAGES).toContain('ar')
    expect(SUPPORTED_LANGUAGES).toContain('zh')
    expect(SUPPORTED_LANGUAGES).toContain('ja')
  })
})

describe('LANGUAGE_NAMES', () => {
  it('maps all supported languages to names', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(LANGUAGE_NAMES[lang]).toBeDefined()
      expect(typeof LANGUAGE_NAMES[lang]).toBe('string')
    }
  })

  it('maps en to English', () => {
    expect(LANGUAGE_NAMES.en).toBe('English')
  })

  it('maps ar to Arabic', () => {
    expect(LANGUAGE_NAMES.ar).toBe('Arabic')
  })
})

describe('MONITORED_CHANNELS', () => {
  it('has 25 monitored channels', () => {
    expect(MONITORED_CHANNELS.length).toBe(25)
  })

  it('each channel has required fields', () => {
    for (const ch of MONITORED_CHANNELS) {
      expect(ch.name).toBeTruthy()
      expect(ch.type).toBeTruthy()
      expect(ch.url).toMatch(/^https:\/\//)
      expect(ch.language).toBeTruthy()
      expect(ch.country).toBeTruthy()
      expect(ch.category).toBeTruthy()
      expect(['hourly', 'daily', 'weekly']).toContain(ch.update_frequency)
    }
  })

  it('includes multi-language channels', () => {
    const languages = new Set(MONITORED_CHANNELS.map(c => c.language))
    expect(languages.size).toBeGreaterThanOrEqual(5)
    expect(languages.has('en')).toBe(true)
    expect(languages.has('fr')).toBe(true)
    expect(languages.has('ar')).toBe(true)
  })

  it('includes all categories', () => {
    const categories = new Set(MONITORED_CHANNELS.map(c => c.category))
    expect(categories.has('News Broadcast')).toBe(true)
    expect(categories.has('Political Debate')).toBe(true)
    expect(categories.has('Press Conference')).toBe(true)
    expect(categories.has('Investigative')).toBe(true)
  })
})

describe('Constants', () => {
  it('MIN_CLAIM_CONFIDENCE is reasonable', () => {
    expect(MIN_CLAIM_CONFIDENCE).toBeGreaterThan(0)
    expect(MIN_CLAIM_CONFIDENCE).toBeLessThan(1)
  })

  it('MAX_CLAIMS_PER_VIDEO is reasonable', () => {
    expect(MAX_CLAIMS_PER_VIDEO).toBeGreaterThan(100)
    expect(MAX_CLAIMS_PER_VIDEO).toBeLessThanOrEqual(1000)
  })

  it('CACHE_TTL_S is 6 hours', () => {
    expect(CACHE_TTL_S).toBe(21_600)
  })
})

// ─── Filler Removal ──────────────────────────────────────────────────────────

describe('removeFillers', () => {
  it('removes um, uh, er, ah', () => {
    expect(removeFillers('The um economy uh grew by er three percent ah this year')).toBe('The economy grew by three percent this year')
  })

  it('removes conversational fillers', () => {
    expect(removeFillers('I mean, like, you know, sort of important')).toBe('important')
  })

  it('preserves clean text', () => {
    expect(removeFillers('GDP increased by 3.2 percent in Q4.')).toBe('GDP increased by 3.2 percent in Q4.')
  })

  it('handles empty string', () => {
    expect(removeFillers('')).toBe('')
  })
})

// ─── Hashing ─────────────────────────────────────────────────────────────────

describe('hashVideo', () => {
  it('returns 16-char hex', () => {
    const h = hashVideo('https://youtube.com/watch?v=abc123')
    expect(h).toHaveLength(16)
    expect(h).toMatch(/^[0-9a-f]+$/)
  })

  it('is deterministic', () => {
    expect(hashVideo('https://example.com')).toBe(hashVideo('https://example.com'))
  })

  it('differs for different URLs', () => {
    expect(hashVideo('https://a.com')).not.toBe(hashVideo('https://b.com'))
  })
})

describe('hashClaim', () => {
  it('returns 16-char hex', () => {
    const h = hashClaim('src1', 'GDP rose 3%', 120)
    expect(h).toHaveLength(16)
    expect(h).toMatch(/^[0-9a-f]+$/)
  })

  it('is deterministic', () => {
    expect(hashClaim('s', 'text', 0)).toBe(hashClaim('s', 'text', 0))
  })

  it('differs for different inputs', () => {
    expect(hashClaim('s', 'a', 0)).not.toBe(hashClaim('s', 'b', 0))
  })
})

// ─── Confidence Scoring ──────────────────────────────────────────────────────

describe('scoreClaimConfidence', () => {
  it('returns value between 0 and 1', () => {
    const score = scoreClaimConfidence('GDP grew by 3 percent.', 'statistical', false, 'news_broadcast')
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  it('boosts statistical claims with numbers', () => {
    const withNum = scoreClaimConfidence('Inflation reached 5.2 percent this quarter.', 'statistical', false, 'youtube')
    const without = scoreClaimConfidence('Inflation reached unprecedented levels this quarter.', 'statistical', false, 'youtube')
    expect(withNum).toBeGreaterThan(without)
  })

  it('boosts claims with visual corroboration', () => {
    const withVisual = scoreClaimConfidence('GDP is 3%.', 'factual', true, 'news_broadcast')
    const withoutVisual = scoreClaimConfidence('GDP is 3%.', 'factual', false, 'news_broadcast')
    expect(withVisual).toBeGreaterThan(withoutVisual)
  })

  it('penalizes hedging language', () => {
    const hedged = scoreClaimConfidence('Maybe the policy could possibly reduce inflation.', 'causal', false, 'youtube')
    const direct = scoreClaimConfidence('The policy will reduce inflation.', 'causal', false, 'youtube')
    expect(hedged).toBeLessThan(direct)
  })

  it('penalizes opinion markers', () => {
    const opinion = scoreClaimConfidence('I think the economy is doing well.', 'opinion', false, 'youtube')
    const factual = scoreClaimConfidence('The economy is doing well according to GDP data.', 'factual', false, 'youtube')
    expect(opinion).toBeLessThan(factual)
  })

  it('caps opinion type at 0.3', () => {
    const score = scoreClaimConfidence('GDP is 10 billion percent according to data.', 'opinion', true, 'political_debate')
    expect(score).toBeLessThanOrEqual(0.3)
  })

  it('boosts debate/press conference sources', () => {
    const debate = scoreClaimConfidence('Test claim.', 'factual', false, 'political_debate')
    const youtube = scoreClaimConfidence('Test claim.', 'factual', false, 'youtube')
    expect(debate).toBeGreaterThan(youtube)
  })
})

// ─── Claim Type Detection ────────────────────────────────────────────────────

describe('detectClaimType', () => {
  it('detects chyron claims', () => {
    expect(detectClaimType('BREAKING: New sanctions announced', false, true)).toBe('chyron')
  })

  it('detects visual claims', () => {
    expect(detectClaimType('Chart shows GDP growth', true, false)).toBe('visual')
  })

  it('detects statistical claims', () => {
    expect(detectClaimType('Unemployment rose by 2.5 percent to 8 million.', false, false)).toBe('statistical')
  })

  it('detects attribution claims', () => {
    expect(detectClaimType('According to the minister, the policy will change. The spokesperson said reforms are planned.', false, false)).toBe('attribution')
  })

  it('detects causal claims', () => {
    expect(detectClaimType('The drought caused widespread famine because of poor infrastructure which resulted in thousands of deaths.', false, false)).toBe('causal')
  })

  it('detects predictive claims', () => {
    expect(detectClaimType('Analysts expect growth to reach 4% by 2027 and project continued expansion next year.', false, false)).toBe('predictive')
  })

  it('detects opinion with multiple markers', () => {
    expect(detectClaimType('I think we should invest more, I believe strongly in my view this is needed.', false, false)).toBe('opinion')
  })

  it('defaults to factual for unmatched text', () => {
    expect(detectClaimType('This is an important development in the region.', false, false)).toBe('factual')
  })
})

// ─── Entity Extraction ───────────────────────────────────────────────────────

describe('extractEntities', () => {
  it('extracts known entities', () => {
    const entities = extractEntities('The United Nations passed a resolution today.')
    expect(entities).toContain('United Nations')
  })

  it('extracts multiple entities', () => {
    const entities = extractEntities('NATO and the EU discussed US sanctions on BRICS nations.')
    expect(entities).toContain('NATO')
    expect(entities).toContain('European Union')
    expect(entities).toContain('United States')
    expect(entities).toContain('BRICS')
  })

  it('extracts proper nouns', () => {
    const entities = extractEntities('President Emmanuel Macron met with Chancellor Olaf Scholz.')
    expect(entities).toContain('Emmanuel Macron')
    expect(entities).toContain('Olaf Scholz')
  })

  it('returns empty array for no entities', () => {
    expect(extractEntities('nothing special here')).toEqual([])
  })

  it('deduplicates entities', () => {
    const entities = extractEntities('The UN met with the United Nations representatives.')
    const unCount = entities.filter(e => e === 'United Nations').length
    expect(unCount).toBe(1)
  })
})

// ─── Scene Segmentation ─────────────────────────────────────────────────────

describe('segmentScenes', () => {
  it('returns empty for no segments', () => {
    expect(segmentScenes([])).toEqual([])
  })

  it('creates single scene for contiguous segments', () => {
    const segments: TranscriptSegment[] = [
      { start_s: 0, end_s: 5, text: 'Hello world.', speaker: 'A', confidence: 0.9, language: 'en' },
      { start_s: 5, end_s: 10, text: 'GDP is growing.', speaker: 'A', confidence: 0.9, language: 'en' },
    ]
    const scenes = segmentScenes(segments)
    expect(scenes).toHaveLength(1)
    expect(scenes[0].start_s).toBe(0)
    expect(scenes[0].end_s).toBe(10)
  })

  it('splits on speaker change', () => {
    const segments: TranscriptSegment[] = [
      { start_s: 0, end_s: 5, text: 'Hello.', speaker: 'A', confidence: 0.9, language: 'en' },
      { start_s: 5, end_s: 10, text: 'Response.', speaker: 'B', confidence: 0.9, language: 'en' },
    ]
    const scenes = segmentScenes(segments)
    expect(scenes).toHaveLength(2)
    expect(scenes[0].speaker).toBe('A')
    expect(scenes[1].speaker).toBe('B')
  })

  it('splits on long pauses (>3s)', () => {
    const segments: TranscriptSegment[] = [
      { start_s: 0, end_s: 5, text: 'First.', speaker: null, confidence: 0.9, language: 'en' },
      { start_s: 10, end_s: 15, text: 'Second after pause.', speaker: null, confidence: 0.9, language: 'en' },
    ]
    const scenes = segmentScenes(segments)
    expect(scenes).toHaveLength(2)
  })

  it('assigns topics to scenes', () => {
    const segments: TranscriptSegment[] = [
      { start_s: 0, end_s: 30, text: 'The economy and GDP and inflation and trade and fiscal policy were discussed.', speaker: null, confidence: 0.9, language: 'en' },
    ]
    const scenes = segmentScenes(segments)
    expect(scenes[0].topic).toBe('Economy')
  })
})

// ─── Topic Inference ─────────────────────────────────────────────────────────

describe('inferTopic', () => {
  it('detects Economy topic', () => {
    expect(inferTopic('GDP growth and inflation rates in the market')).toBe('Economy')
  })

  it('detects Security topic', () => {
    expect(inferTopic('military attack and defense systems in the conflict zone')).toBe('Security')
  })

  it('detects Health topic', () => {
    expect(inferTopic('pandemic vaccine rollout and hospital capacity')).toBe('Health')
  })

  it('detects Climate topic', () => {
    expect(inferTopic('carbon emissions and renewable energy targets')).toBe('Climate')
  })

  it('defaults to General for unmatched text', () => {
    expect(inferTopic('some random conversation about nothing specific')).toBe('General')
  })
})

// ─── Credibility Calculation ─────────────────────────────────────────────────

describe('calculateCredibility', () => {
  it('returns 0 for empty claims', () => {
    expect(calculateCredibility([])).toBe(0)
  })

  it('returns 1.0 for all verified high-confidence claims', () => {
    const claims = [
      { confidence: 1, status: 'verified' as VCS },
      { confidence: 1, status: 'verified' as VCS },
    ] as VideoClaim[]
    expect(calculateCredibility(claims)).toBe(1)
  })

  it('returns 0 for all retracted claims', () => {
    const claims = [
      { confidence: 1, status: 'retracted' as VCS },
    ] as VideoClaim[]
    expect(calculateCredibility(claims)).toBe(0)
  })

  it('mixed statuses produce intermediate score', () => {
    const claims = [
      { confidence: 0.8, status: 'verified' as VCS },
      { confidence: 0.8, status: 'disputed' as VCS },
    ] as VideoClaim[]
    const score = calculateCredibility(claims)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })
})

// ─── Claim Summary ───────────────────────────────────────────────────────────

describe('buildClaimSummary', () => {
  it('returns zeroed summary for empty claims', () => {
    const summary = buildClaimSummary([])
    expect(summary.total_claims).toBe(0)
    expect(summary.avg_confidence).toBe(0)
    expect(summary.speakers_identified).toBe(0)
    expect(summary.visual_claims_count).toBe(0)
  })

  it('counts claims by type', () => {
    const claims = [
      { type: 'factual' as VCT, status: 'unverified' as VCS, confidence: 0.5, speaker: null },
      { type: 'factual' as VCT, status: 'unverified' as VCS, confidence: 0.6, speaker: null },
      { type: 'statistical' as VCT, status: 'verified' as VCS, confidence: 0.8, speaker: 'Alice' },
    ] as VideoClaim[]
    const summary = buildClaimSummary(claims)
    expect(summary.total_claims).toBe(3)
    expect(summary.by_type.factual).toBe(2)
    expect(summary.by_type.statistical).toBe(1)
    expect(summary.speakers_identified).toBe(1)
  })

  it('calculates average confidence', () => {
    const claims = [
      { type: 'factual' as VCT, status: 'unverified' as VCS, confidence: 0.4, speaker: null },
      { type: 'factual' as VCT, status: 'unverified' as VCS, confidence: 0.8, speaker: null },
    ] as VideoClaim[]
    const summary = buildClaimSummary(claims)
    expect(summary.avg_confidence).toBe(0.6)
  })

  it('counts visual claims', () => {
    const claims = [
      { type: 'visual' as VCT, status: 'unverified' as VCS, confidence: 0.7, speaker: null },
      { type: 'chyron' as VCT, status: 'unverified' as VCS, confidence: 0.8, speaker: null },
      { type: 'factual' as VCT, status: 'unverified' as VCS, confidence: 0.5, speaker: null },
    ] as VideoClaim[]
    const summary = buildClaimSummary(claims)
    expect(summary.visual_claims_count).toBe(2)
  })
})

// ─── Claim Extraction from Text ──────────────────────────────────────────────

describe('extractClaimsFromText', () => {
  it('extracts claims from debate text', () => {
    const text = 'GDP increased by 5 percent last quarter. The minister said inflation is under control. I think we should invest more in education.'
    const claims = extractClaimsFromText(text, 'src1', 'political_debate')
    expect(claims.length).toBeGreaterThan(0)
  })

  it('filters out low-confidence claims', () => {
    const text = 'Maybe. Perhaps. Nothing concrete here really.'
    const claims = extractClaimsFromText(text, 'src1', 'youtube')
    // Very vague text should produce few or no claims
    expect(claims.length).toBeLessThanOrEqual(1)
  })

  it('respects MAX_CLAIMS_PER_VIDEO limit', () => {
    // Generate very long text with many sentences
    const sentences = Array.from({ length: 600 }, (_, i) => `Unemployment rose by ${i} percent according to officials.`)
    const text = sentences.join(' ')
    const claims = extractClaimsFromText(text, 'src1', 'news_broadcast')
    expect(claims.length).toBeLessThanOrEqual(MAX_CLAIMS_PER_VIDEO)
  })

  it('includes entities in claims', () => {
    const text = 'The United Nations announced new climate targets. NATO expanded its eastern flank operations.'
    const claims = extractClaimsFromText(text, 'src1', 'press_conference')
    const allEntities = claims.flatMap(c => c.entities)
    expect(allEntities.length).toBeGreaterThan(0)
  })

  it('sets status to unverified by default', () => {
    const text = 'Inflation reached 8 percent according to the central bank.'
    const claims = extractClaimsFromText(text, 'src1', 'news_broadcast')
    for (const claim of claims) {
      expect(claim.status).toBe('unverified')
    }
  })
})

// ─── Claim Patterns ──────────────────────────────────────────────────────────

describe('CLAIM_PATTERNS', () => {
  it('statistical patterns match numbers', () => {
    expect(CLAIM_PATTERNS.statistical.some(p => p.test('25 percent increase'))).toBe(true)
    expect(CLAIM_PATTERNS.statistical.some(p => p.test('3.5 billion dollars'))).toBe(true)
  })

  it('attribution patterns match quotes', () => {
    expect(CLAIM_PATTERNS.attribution.some(p => p.test('The minister said'))).toBe(true)
    expect(CLAIM_PATTERNS.attribution.some(p => p.test('according to officials'))).toBe(true)
  })

  it('causal patterns match cause-effect', () => {
    expect(CLAIM_PATTERNS.causal.some(p => p.test('because of the sanctions'))).toBe(true)
    expect(CLAIM_PATTERNS.causal.some(p => p.test('resulted in economic decline'))).toBe(true)
  })

  it('predictive patterns match forecasts', () => {
    expect(CLAIM_PATTERNS.predictive.some(p => p.test('will increase by 2027'))).toBe(true)
    expect(CLAIM_PATTERNS.predictive.some(p => p.test('expected to grow'))).toBe(true)
  })
})

describe('DEBATE_PATTERNS', () => {
  it('matches debate-specific language', () => {
    expect(DEBATE_PATTERNS.some(p => p.test('my administration has achieved'))).toBe(true)
    expect(DEBATE_PATTERNS.some(p => p.test('the fact is that'))).toBe(true)
    expect(DEBATE_PATTERNS.some(p => p.test('let me be clear'))).toBe(true)
  })
})

describe('BROADCAST_PATTERNS', () => {
  it('matches broadcast-specific language', () => {
    expect(BROADCAST_PATTERNS.some(p => p.test('breaking news today'))).toBe(true)
    expect(BROADCAST_PATTERNS.some(p => p.test('sources say the deal'))).toBe(true)
    expect(BROADCAST_PATTERNS.some(p => p.test('officials say the report'))).toBe(true)
  })
})
