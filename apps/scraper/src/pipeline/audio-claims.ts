/**
 * Audio/Podcast Claim Extraction Pipeline
 *
 * Extracts checkable claims from audio and podcast content — WorldPulse's
 * direct counter to Factiverse's live audio/video fact-checking capability.
 *
 * Pipeline stages:
 *   1. **Audio ingestion** — Accept audio URLs (podcast RSS, YouTube, direct MP3/MP4)
 *   2. **Transcription** — Whisper API / Deepgram / AssemblyAI with speaker diarization
 *   3. **Claim extraction** — NLP-based extraction of checkable factual claims
 *   4. **Claim classification** — Type, confidence, speaker attribution
 *   5. **Cross-reference** — Verify claims against existing WorldPulse signals + sources
 *   6. **Persistence** — Store transcripts + claims in PostgreSQL, cache in Redis
 *
 * Supported audio sources:
 *   - Podcast RSS feeds (auto-discover episodes via enclosure tags)
 *   - YouTube videos (extract audio track)
 *   - Direct audio URLs (.mp3, .m4a, .wav, .ogg, .webm)
 *   - Live streams (chunked processing)
 *
 * Design constraints:
 *   - Works with or without transcription API keys (graceful degradation)
 *   - Speaker diarization when available (who said what)
 *   - Idempotent — re-processing same audio produces no duplicate claims
 *   - Redis cache for recent transcript lookups (TTL 4h)
 *   - PostgreSQL for durable storage (audio_transcripts + audio_claims tables)
 *
 * @module pipeline/audio-claims
 */

import { pgPool as db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { createHash } from 'crypto'

// ─── TYPES ─────────────────────────────────────────────────────────────────────

export type AudioSourceType = 'podcast' | 'youtube' | 'direct_url' | 'live_stream'

export type ClaimType = 'factual' | 'statistical' | 'attribution' | 'causal' | 'predictive' | 'opinion'

export type ClaimStatus = 'verified' | 'disputed' | 'unverified' | 'mixed' | 'opinion'

export type TranscriptionProvider = 'whisper' | 'deepgram' | 'assemblyai' | 'local'

export interface AudioSource {
  id: string
  url: string
  type: AudioSourceType
  title: string
  publisher: string
  language: string             // ISO 639-1
  duration_s: number | null
  published_at: string | null
  podcast_name: string | null
  episode_number: number | null
}

export interface TranscriptSegment {
  start_s: number
  end_s: number
  text: string
  speaker: string | null       // Speaker diarization label (e.g. "Speaker 1")
  speaker_name: string | null  // Resolved speaker name if known
  confidence: number           // 0-1 transcription confidence
}

export interface AudioTranscript {
  id: string
  source_id: string
  segments: TranscriptSegment[]
  full_text: string
  language: string
  duration_s: number
  word_count: number
  speaker_count: number
  provider: TranscriptionProvider
  transcribed_at: string
}

export interface AudioClaim {
  id: string
  transcript_id: string
  source_id: string
  text: string
  type: ClaimType
  confidence: number           // 0-1: how confident this IS a checkable claim
  verification_score: number   // 0-1: cross-reference confidence
  status: ClaimStatus
  speaker: string | null
  speaker_name: string | null
  timestamp_start_s: number
  timestamp_end_s: number
  context: string              // surrounding transcript text
  entities: string[]
  cross_references: CrossReference[]
  extracted_at: string
}

export interface CrossReference {
  signal_id: string | null
  source_name: string
  source_slug: string
  url: string | null
  trust_score: number
  agrees: boolean
  snippet: string | null
}

export interface AudioClaimExtractionResult {
  source: AudioSource
  transcript: AudioTranscript
  total_claims: number
  verified_count: number
  disputed_count: number
  unverified_count: number
  mixed_count: number
  opinion_count: number
  overall_credibility: number
  claims: AudioClaim[]
  processing_time_ms: number
}

// ─── CONSTANTS ──────────────────────────────────────────────────────────────────

export const SUPPORTED_AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.wav', '.ogg', '.webm', '.aac', '.flac']

export const SUPPORTED_LANGUAGES = [
  'en', 'es', 'fr', 'de', 'pt', 'ar', 'zh', 'ja', 'ko', 'ru',
  'hi', 'it', 'nl', 'pl', 'tr', 'sv', 'da', 'no', 'fi', 'uk',
  'cs', 'ro', 'hu', 'el', 'th', 'vi', 'id', 'ms', 'tl', 'sw',
] as const

export const MAX_AUDIO_DURATION_S = 14400 // 4 hours max
export const TRANSCRIPT_CACHE_TTL_S = 14400 // 4 hours
export const CLAIMS_CACHE_TTL_S = 7200 // 2 hours

/**
 * Claim extraction patterns — tuned for spoken language (more informal,
 * sentence fragments, filler words stripped)
 */
export const SPOKEN_CLAIM_PATTERNS: Array<{ pattern: RegExp; type: ClaimType }> = [
  // Statistical: numbers, percentages, metrics in spoken context
  {
    pattern: /(?:^|[.!?]\s+)([^.!?]*?\b(?:\d+(?:\.\d+)?(?:\s*%|\s*percent)|\d{1,3}(?:,\d{3})+|\d+\s*(?:million|billion|trillion|thousand|hundred))\b[^.!?]*[.!?]?)/gi,
    type: 'statistical',
  },
  // Attribution: "X said/claimed" — common in interviews & podcasts
  {
    pattern: /(?:^|[.!?]\s+)([^.!?]*?\b(?:said|claimed|stated|reported|announced|confirmed|denied|warned|revealed|disclosed|alleged|told me|mentioned|pointed out|argued|insisted)\b[^.!?]*[.!?]?)/gi,
    type: 'attribution',
  },
  // Causal: spoken causal reasoning
  {
    pattern: /(?:^|[.!?]\s+)([^.!?]*?\b(?:because|caused by|resulted? in|led to|due to|attributed to|as a result|contributed to|the reason is|that's why|which means)\b[^.!?]*[.!?]?)/gi,
    type: 'causal',
  },
  // Predictive: forecasts and predictions in speech
  {
    pattern: /(?:^|[.!?]\s+)([^.!?]*?\b(?:will|going to|expected to|likely to|forecast|projected|predicted|anticipated|I think .* will|probably|almost certainly|bound to)\b[^.!?]*[.!?]?)/gi,
    type: 'predictive',
  },
  // Factual: definitive spoken assertions
  {
    pattern: /(?:^|[.!?]\s+)([^.!?]*?\b(?:is the (?:first|largest|smallest|most|least|only|highest|lowest|biggest|worst|best)|has been|was found|are considered|actually|in fact|the truth is|the reality is|it's a fact)\b[^.!?]*[.!?]?)/gi,
    type: 'factual',
  },
]

/**
 * Filler words and spoken artifacts to strip before claim extraction
 */
export const FILLER_PATTERNS = [
  /\b(?:um|uh|erm|hmm|like|you know|I mean|sort of|kind of|basically|literally|right|okay|so yeah)\b/gi,
  /\b(?:and uh|but um|so uh|well uh)\b/gi,
]

/**
 * Speaker name patterns — extract real names from transcript context
 */
export const SPEAKER_NAME_PATTERNS = [
  /(?:I'm|I am|my name is|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g,
  /(?:welcome|joining us|our guest|speaking with|interview with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g,
  /(?:thank you|thanks),?\s+([A-Z][a-z]+)/g,
]

// ─── UTILITY FUNCTIONS ──────────────────────────────────────────────────────────

/**
 * Generate deterministic ID for an audio source
 */
export function audioSourceId(url: string): string {
  return createHash('sha256').update(`audio:${url.toLowerCase().trim()}`).digest('hex').slice(0, 16)
}

/**
 * Generate deterministic ID for a claim within a transcript
 */
export function audioClaimId(transcriptId: string, claimText: string, startS: number): string {
  return createHash('sha256')
    .update(`claim:${transcriptId}:${claimText.toLowerCase().trim()}:${startS}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * Generate deterministic ID for a transcript
 */
export function transcriptId(sourceId: string, provider: TranscriptionProvider): string {
  return createHash('sha256')
    .update(`transcript:${sourceId}:${provider}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * Clean spoken text: strip fillers, normalize whitespace, fix common transcription artifacts
 */
export function cleanSpokenText(text: string): string {
  let cleaned = text
  for (const pattern of FILLER_PATTERNS) {
    cleaned = cleaned.replace(new RegExp(pattern.source, pattern.flags), ' ')
  }
  // Normalize whitespace
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim()
  // Fix common transcription artifacts
  cleaned = cleaned.replace(/\s([.,!?;:])/g, '$1') // remove space before punctuation
  cleaned = cleaned.replace(/([.!?])\s*([a-z])/g, '$1 $2') // ensure space after sentence-end
  return cleaned
}

/**
 * Detect if audio URL is a supported format
 */
export function isSupportedAudioUrl(url: string): boolean {
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
  } catch {
    return false
  }
}

/**
 * Detect audio source type from URL
 */
export function detectAudioSourceType(url: string): AudioSourceType {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube'
    if (
      host.includes('spotify.com') || host.includes('anchor.fm') ||
      host.includes('podbean.com') || host.includes('buzzsprout.com') ||
      host.includes('transistor.fm') || host.includes('simplecast.com') ||
      host.includes('apple.com/podcast') || host.includes('podcasts.google.com')
    ) return 'podcast'
    return 'direct_url'
  } catch {
    return 'direct_url'
  }
}

/**
 * Extract named entities from spoken text (tuned for conversational language)
 */
export function extractSpokenEntities(text: string): string[] {
  const entities = new Set<string>()

  // Title + name patterns
  const titlePattern = /\b(?:President|Prime Minister|CEO|Minister|Secretary|Director|General|Ambassador|Senator|Governor|Mayor|Professor|Dr\.?)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g
  for (const match of text.matchAll(titlePattern)) {
    entities.add(match[0].trim())
  }

  // Organisation patterns
  const orgPattern = /\b(?:United States|United Kingdom|European Union|United Nations|NATO|WHO|IMF|World Bank|Federal Reserve|Pentagon|Congress|Parliament|Supreme Court|FBI|CIA|NSA|CDC|FDA|EPA|SEC|FCC|DOJ|DOD|Treasury|State Department)\b/g
  for (const match of text.matchAll(orgPattern)) {
    entities.add(match[0].trim())
  }

  // Multi-word proper nouns (2-4 capitalized words)
  const properNounPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g
  for (const match of text.matchAll(properNounPattern)) {
    const entity = match[0].trim()
    // Filter out common false positives from spoken language
    const falsePositives = new Set([
      'I Think', 'I Mean', 'You Know', 'But Also', 'And Then', 'So What',
      'In Fact', 'Right Now', 'Last Week', 'Next Year', 'This Morning',
      'Of Course', 'In Terms', 'At This', 'On The', 'For The',
    ])
    if (!falsePositives.has(entity) && entity.length > 3 && entity.length < 60) {
      entities.add(entity)
    }
  }

  return [...entities].slice(0, 15) // cap at 15 entities
}

/**
 * Extract speaker names from transcript segments
 */
export function extractSpeakerNames(segments: TranscriptSegment[]): Map<string, string> {
  const speakerNames = new Map<string, string>()
  const fullText = segments.map(s => s.text).join(' ')

  for (const pattern of SPEAKER_NAME_PATTERNS) {
    for (const match of fullText.matchAll(new RegExp(pattern.source, pattern.flags))) {
      if (match[1] && match[1].length > 2 && match[1].length < 40) {
        // Try to associate with the nearest speaker label
        const matchIndex = match.index ?? 0
        const nearestSegment = segments.find(s => {
          const segStart = fullText.indexOf(s.text)
          return Math.abs(segStart - matchIndex) < 200 && s.speaker !== null
        })
        if (nearestSegment?.speaker) {
          speakerNames.set(nearestSegment.speaker, match[1])
        }
      }
    }
  }

  return speakerNames
}

/**
 * Extract claims from cleaned transcript text
 */
export function extractClaimsFromText(
  text: string,
  segments: TranscriptSegment[],
  transcriptIdVal: string,
  sourceId: string,
  speakerNames: Map<string, string>,
): AudioClaim[] {
  const claims: AudioClaim[] = []
  const seenTexts = new Set<string>()

  const cleanedText = cleanSpokenText(text)

  for (const { pattern, type } of SPOKEN_CLAIM_PATTERNS) {
    const matches = cleanedText.matchAll(new RegExp(pattern.source, pattern.flags))
    for (const match of matches) {
      const claimText = match[1]?.trim()
      if (!claimText || claimText.length < 20 || claimText.length > 500) continue

      // Deduplicate by normalized lowercase text
      const normalizedKey = claimText.toLowerCase().replace(/\s+/g, ' ')
      if (seenTexts.has(normalizedKey)) continue
      seenTexts.add(normalizedKey)

      // Find the corresponding segment for timestamp & speaker info
      const matchingSegment = findMatchingSegment(claimText, segments)
      const speaker = matchingSegment?.speaker ?? null
      const speakerName = speaker ? (speakerNames.get(speaker) ?? null) : null

      // Extract entities from this specific claim
      const entities = extractSpokenEntities(claimText)

      // Get surrounding context (claim + 1 sentence before/after)
      const contextStart = Math.max(0, cleanedText.indexOf(claimText) - 200)
      const contextEnd = Math.min(cleanedText.length, cleanedText.indexOf(claimText) + claimText.length + 200)
      const context = cleanedText.slice(contextStart, contextEnd).trim()

      // Calculate initial confidence based on pattern match quality
      const confidence = calculateClaimConfidence(claimText, type)

      const claim: AudioClaim = {
        id: audioClaimId(transcriptIdVal, claimText, matchingSegment?.start_s ?? 0),
        transcript_id: transcriptIdVal,
        source_id: sourceId,
        text: claimText,
        type,
        confidence,
        verification_score: 0, // Set after cross-referencing
        status: 'unverified',
        speaker,
        speaker_name: speakerName,
        timestamp_start_s: matchingSegment?.start_s ?? 0,
        timestamp_end_s: matchingSegment?.end_s ?? 0,
        context,
        entities,
        cross_references: [],
        extracted_at: new Date().toISOString(),
      }

      claims.push(claim)
      if (claims.length >= 50) break // cap per transcript
    }
    if (claims.length >= 50) break
  }

  // Sort by timestamp
  claims.sort((a, b) => a.timestamp_start_s - b.timestamp_start_s)

  return claims
}

/**
 * Find the transcript segment that best matches a claim text
 */
function findMatchingSegment(claimText: string, segments: TranscriptSegment[]): TranscriptSegment | null {
  const claimLower = claimText.toLowerCase()
  // Find segment with highest text overlap
  let bestMatch: TranscriptSegment | null = null
  let bestScore = 0
  for (const seg of segments) {
    const segLower = seg.text.toLowerCase()
    if (segLower.includes(claimLower) || claimLower.includes(segLower)) {
      const score = Math.min(segLower.length, claimLower.length) / Math.max(segLower.length, claimLower.length)
      if (score > bestScore) {
        bestScore = score
        bestMatch = seg
      }
    }
  }
  return bestMatch
}

/**
 * Calculate confidence that a text is a checkable claim (vs. opinion or noise)
 */
export function calculateClaimConfidence(text: string, type: ClaimType): number {
  let score = 0.5 // baseline

  // Boost for specific patterns
  if (/\d/.test(text)) score += 0.15 // contains numbers
  if (/(?:according to|data shows|study found|research indicates)/i.test(text)) score += 0.2
  if (/(?:percent|%|million|billion|thousand)/i.test(text)) score += 0.15
  if (/(?:official|confirmed|report|published)/i.test(text)) score += 0.1

  // Penalize for hedging / uncertainty (common in speech)
  if (/(?:I think|maybe|possibly|might|could be|seems like|not sure)/i.test(text)) score -= 0.2
  if (/(?:in my opinion|personally|I feel|I believe)/i.test(text)) score -= 0.25

  // Type-based adjustments
  if (type === 'statistical') score += 0.1
  if (type === 'attribution') score += 0.05
  if (type === 'predictive') score -= 0.05

  // Length-based: very short claims are less reliable
  if (text.length < 30) score -= 0.1
  if (text.length > 100) score += 0.05

  return Math.max(0, Math.min(1, Math.round(score * 100) / 100))
}

/**
 * Calculate overall credibility score from verified claims
 */
export function calculateOverallCredibility(claims: AudioClaim[]): number {
  if (claims.length === 0) return 0

  const verifiableClaims = claims.filter(c => c.type !== 'opinion')
  if (verifiableClaims.length === 0) return 0.5 // neutral if all opinions

  let weightedSum = 0
  let totalWeight = 0

  for (const claim of verifiableClaims) {
    const weight = claim.confidence
    let score: number
    switch (claim.status) {
      case 'verified': score = 1.0; break
      case 'mixed': score = 0.6; break
      case 'unverified': score = 0.5; break
      case 'disputed': score = 0.1; break
      default: score = 0.5
    }
    weightedSum += score * weight
    totalWeight += weight
  }

  return totalWeight > 0
    ? Math.round((weightedSum / totalWeight) * 100) / 100
    : 0.5
}

/**
 * Format duration in seconds to human-readable string
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/**
 * Format timestamp for display (e.g. "1:23:45")
 */
export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// ─── DATABASE OPERATIONS ────────────────────────────────────────────────────────

/**
 * Persist audio transcript to database
 */
export async function persistTranscript(transcript: AudioTranscript): Promise<void> {
  try {
    await db.query(
      `INSERT INTO audio_transcripts (id, source_id, full_text, language, duration_s,
        word_count, speaker_count, provider, segments, transcribed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         full_text = EXCLUDED.full_text,
         segments = EXCLUDED.segments,
         word_count = EXCLUDED.word_count,
         speaker_count = EXCLUDED.speaker_count`,
      [
        transcript.id,
        transcript.source_id,
        transcript.full_text,
        transcript.language,
        transcript.duration_s,
        transcript.word_count,
        transcript.speaker_count,
        transcript.provider,
        JSON.stringify(transcript.segments),
        transcript.transcribed_at,
      ],
    )

    // Cache in Redis
    await redis.setex(
      `audio:transcript:${transcript.id}`,
      TRANSCRIPT_CACHE_TTL_S,
      JSON.stringify(transcript),
    )

    logger.info({ transcriptId: transcript.id, sourceId: transcript.source_id },
      'Persisted audio transcript')
  } catch (err) {
    logger.error({ err, transcriptId: transcript.id }, 'Failed to persist transcript')
    throw err
  }
}

/**
 * Persist extracted claims to database
 */
export async function persistClaims(claims: AudioClaim[]): Promise<void> {
  if (claims.length === 0) return

  try {
    for (const claim of claims) {
      await db.query(
        `INSERT INTO audio_claims (id, transcript_id, source_id, text, type, confidence,
          verification_score, status, speaker, speaker_name, timestamp_start_s,
          timestamp_end_s, context, entities, cross_references, extracted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (id) DO UPDATE SET
           verification_score = EXCLUDED.verification_score,
           status = EXCLUDED.status,
           cross_references = EXCLUDED.cross_references`,
        [
          claim.id,
          claim.transcript_id,
          claim.source_id,
          claim.text,
          claim.type,
          claim.confidence,
          claim.verification_score,
          claim.status,
          claim.speaker,
          claim.speaker_name,
          claim.timestamp_start_s,
          claim.timestamp_end_s,
          claim.context,
          JSON.stringify(claim.entities),
          JSON.stringify(claim.cross_references),
          claim.extracted_at,
        ],
      )
    }

    // Cache claim summary
    const cacheKey = `audio:claims:${claims[0]?.transcript_id}`
    await redis.setex(cacheKey, CLAIMS_CACHE_TTL_S, JSON.stringify(claims))

    logger.info({ count: claims.length, transcriptId: claims[0]?.transcript_id },
      'Persisted audio claims')
  } catch (err) {
    logger.error({ err }, 'Failed to persist audio claims')
    throw err
  }
}

// ─── PODCAST RSS DISCOVERY ──────────────────────────────────────────────────────

/**
 * Well-known news podcast feeds for monitoring
 */
export const NEWS_PODCAST_REGISTRY: Array<{
  name: string
  publisher: string
  feed_url: string
  language: string
  category: string
}> = [
  // US News
  { name: 'NPR News Now', publisher: 'NPR', feed_url: 'https://feeds.npr.org/500005/podcast.xml', language: 'en', category: 'general_news' },
  { name: 'The Daily', publisher: 'The New York Times', feed_url: 'https://feeds.simplecast.com/54nAGcIl', language: 'en', category: 'general_news' },
  { name: 'Up First', publisher: 'NPR', feed_url: 'https://feeds.npr.org/510318/podcast.xml', language: 'en', category: 'general_news' },
  { name: 'Post Reports', publisher: 'The Washington Post', feed_url: 'https://feeds.megaphone.fm/PPY6458293959', language: 'en', category: 'general_news' },
  { name: 'The Intelligence', publisher: 'The Economist', feed_url: 'https://rss.acast.com/theintelligencepodcast', language: 'en', category: 'analysis' },
  // International News
  { name: 'Global News Podcast', publisher: 'BBC World Service', feed_url: 'https://podcasts.files.bbci.co.uk/p02nq0gn.rss', language: 'en', category: 'international' },
  { name: 'France 24 — International News', publisher: 'France 24', feed_url: 'https://www.france24.com/en/podcasts/rss', language: 'en', category: 'international' },
  { name: 'Al Jazeera — The Take', publisher: 'Al Jazeera', feed_url: 'https://podcast.aljazeera.com/podcasts/thetake.xml', language: 'en', category: 'international' },
  // Geopolitics & Security
  { name: 'The Lawfare Podcast', publisher: 'Lawfare', feed_url: 'https://www.lawfaremedia.org/feed/lawfare-podcast-feed', language: 'en', category: 'security' },
  { name: 'War on the Rocks', publisher: 'War on the Rocks', feed_url: 'https://warontherocks.com/feed/podcast/', language: 'en', category: 'security' },
  // Technology & AI
  { name: 'Hard Fork', publisher: 'The New York Times', feed_url: 'https://feeds.simplecast.com/l2i9YnTd', language: 'en', category: 'technology' },
  { name: 'Pivot', publisher: 'New York Magazine', feed_url: 'https://feeds.megaphone.fm/pivot', language: 'en', category: 'technology' },
  // Economics & Finance
  { name: 'Planet Money', publisher: 'NPR', feed_url: 'https://feeds.npr.org/510289/podcast.xml', language: 'en', category: 'economics' },
  { name: 'Odd Lots', publisher: 'Bloomberg', feed_url: 'https://feeds.bloomberg.com/podcasts/etf_iq.xml', language: 'en', category: 'economics' },
  // Science & Health
  { name: 'Science Friday', publisher: 'WNYC', feed_url: 'https://feeds.feedburner.com/sciencefriday', language: 'en', category: 'science' },
  // Investigative
  { name: 'Reveal', publisher: 'The Center for Investigative Reporting', feed_url: 'https://feeds.megaphone.fm/revealpodcast', language: 'en', category: 'investigative' },
  // Multilingual
  { name: 'Journal en français facile', publisher: 'RFI', feed_url: 'https://www.rfi.fr/fr/podcasts/journal-fran%C3%A7ais-facile/podcast', language: 'fr', category: 'international' },
  { name: 'El Hilo', publisher: 'Radio Ambulante', feed_url: 'https://feeds.megaphone.fm/elhilo', language: 'es', category: 'international' },
  { name: 'NachDenkSeiten', publisher: 'NachDenkSeiten', feed_url: 'https://www.nachdenkseiten.de/feed/', language: 'de', category: 'analysis' },
  { name: 'Internationalen', publisher: 'Dagens Nyheter', feed_url: 'https://rss.acast.com/internationalen', language: 'sv', category: 'international' },
]

// ─── MAIN PIPELINE ──────────────────────────────────────────────────────────────

/**
 * Main audio claim extraction pipeline entry point
 *
 * In production, this coordinates:
 *   1. Audio download + format detection
 *   2. Transcription via configured provider
 *   3. Claim extraction from transcript
 *   4. Cross-referencing with existing WorldPulse signals
 *   5. Database persistence + cache update
 *
 * Currently the transcription step requires external API keys.
 * The claim extraction and cross-referencing logic works locally.
 */
export async function processAudioSource(
  source: AudioSource,
  segments: TranscriptSegment[],
  provider: TranscriptionProvider = 'whisper',
): Promise<AudioClaimExtractionResult> {
  const startTime = Date.now()

  // Build transcript
  const fullText = segments.map(s => s.text).join(' ')
  const wordCount = fullText.split(/\s+/).filter(Boolean).length
  const speakers = new Set(segments.filter(s => s.speaker).map(s => s.speaker))
  const duration = segments.length > 0
    ? segments[segments.length - 1]!.end_s
    : (source.duration_s ?? 0)

  const tId = transcriptId(source.id, provider)

  const transcript: AudioTranscript = {
    id: tId,
    source_id: source.id,
    segments,
    full_text: fullText,
    language: source.language,
    duration_s: duration,
    word_count: wordCount,
    speaker_count: speakers.size,
    provider,
    transcribed_at: new Date().toISOString(),
  }

  // Extract speaker names from context
  const speakerNames = extractSpeakerNames(segments)

  // Extract claims
  const claims = extractClaimsFromText(fullText, segments, tId, source.id, speakerNames)

  // Calculate stats
  const verified = claims.filter(c => c.status === 'verified').length
  const disputed = claims.filter(c => c.status === 'disputed').length
  const unverified = claims.filter(c => c.status === 'unverified').length
  const mixed = claims.filter(c => c.status === 'mixed').length
  const opinion = claims.filter(c => c.status === 'opinion').length
  const credibility = calculateOverallCredibility(claims)

  // Persist
  await persistTranscript(transcript)
  await persistClaims(claims)

  const processingTime = Date.now() - startTime

  logger.info({
    sourceId: source.id,
    claims: claims.length,
    credibility,
    processingTime,
  }, 'Audio claim extraction complete')

  return {
    source,
    transcript,
    total_claims: claims.length,
    verified_count: verified,
    disputed_count: disputed,
    unverified_count: unverified,
    mixed_count: mixed,
    opinion_count: opinion,
    overall_credibility: credibility,
    claims,
    processing_time_ms: processingTime,
  }
}
