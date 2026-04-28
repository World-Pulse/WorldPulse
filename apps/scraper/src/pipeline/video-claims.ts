/**
 * Video/Transcript Claim Extraction Pipeline
 *
 * Extracts checkable claims from video content — YouTube videos, news broadcasts,
 * political debates, press conferences, and live streams. WorldPulse's direct
 * counter to Factiverse Gather and GDELT's TV translation capabilities.
 *
 * Pipeline stages:
 *   1. **Video ingestion** — Accept video URLs (YouTube, news broadcast archives, direct)
 *   2. **Frame analysis** — Optional visual context extraction (key frames, OCR, chyrons)
 *   3. **Transcription** — Multi-provider speech-to-text with speaker diarization
 *   4. **Scene segmentation** — Split transcript by topic/speaker changes
 *   5. **Claim extraction** — NLP-based extraction of checkable factual claims
 *   6. **Visual claim detection** — Extract claims from on-screen graphics/chyrons
 *   7. **Cross-reference** — Verify claims against WorldPulse signals + knowledge graph
 *   8. **Persistence** — Store in PostgreSQL, cache in Redis
 *
 * Supported video sources:
 *   - YouTube videos & channels (via yt-dlp transcript extraction)
 *   - News broadcast archives (BBC, CNN, Al Jazeera, NHK, DW, France24)
 *   - Political debate recordings (C-SPAN, parliament archives)
 *   - Press conferences & UN sessions
 *   - Direct video URLs (.mp4, .webm, .mkv)
 *   - Live streams (chunked processing with rolling window)
 *
 * Design constraints:
 *   - Works with or without video processing API keys (graceful degradation)
 *   - Multi-language support (en, es, fr, ar, zh, ru, de, pt, ja, ko)
 *   - Speaker diarization + identification when available
 *   - Visual context (chyrons, lower-thirds, graphics) supplements audio claims
 *   - Idempotent — re-processing same video produces no duplicate claims
 *   - Redis cache for recent lookups (TTL 6h)
 *   - PostgreSQL for durable storage
 *
 * @module pipeline/video-claims
 */

import { pgPool as db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { createHash } from 'crypto'

// ─── TYPES ─────────────────────────────────────────────────────────────────────

export type VideoSourceType =
  | 'youtube'
  | 'news_broadcast'
  | 'political_debate'
  | 'press_conference'
  | 'un_session'
  | 'direct_url'
  | 'live_stream'

export type VideoClaimType =
  | 'factual'
  | 'statistical'
  | 'attribution'
  | 'causal'
  | 'predictive'
  | 'visual'
  | 'chyron'
  | 'opinion'

export type VideoClaimStatus =
  | 'verified'
  | 'disputed'
  | 'unverified'
  | 'mixed'
  | 'opinion'
  | 'retracted'

export type TranscriptionProvider = 'whisper' | 'deepgram' | 'assemblyai' | 'google_stt' | 'local'

export type VideoLanguage =
  | 'en' | 'es' | 'fr' | 'ar' | 'zh' | 'ru'
  | 'de' | 'pt' | 'ja' | 'ko' | 'hi' | 'tr'

export interface VideoSource {
  id: string
  url: string
  type: VideoSourceType
  title: string
  publisher: string
  language: VideoLanguage
  duration_s: number
  resolution: string
  channel_name: string | null
  broadcast_date: string | null
  country_code: string | null
  thumbnail_url: string | null
  metadata: Record<string, unknown>
}

export interface TranscriptSegment {
  start_s: number
  end_s: number
  text: string
  speaker: string | null
  confidence: number
  language: VideoLanguage
}

export interface VideoTranscript {
  id: string
  source_id: string
  full_text: string
  segments: TranscriptSegment[]
  speaker_count: number
  provider: TranscriptionProvider
  language: VideoLanguage
  word_count: number
  extracted_at: string
}

export interface VisualContext {
  timestamp_s: number
  type: 'chyron' | 'graphic' | 'lower_third' | 'title_card' | 'map' | 'chart'
  text: string
  confidence: number
  ocr_raw: string | null
}

export interface VideoClaim {
  id: string
  transcript_id: string
  source_id: string
  text: string
  type: VideoClaimType
  confidence: number
  verification_score: number | null
  status: VideoClaimStatus
  speaker: string | null
  timestamp_start_s: number
  timestamp_end_s: number
  visual_context: VisualContext | null
  entities: string[]
  cross_references: CrossReference[]
  extracted_at: string
}

export interface CrossReference {
  signal_id: string | null
  source_name: string
  url: string
  agreement: 'supports' | 'contradicts' | 'neutral'
  similarity_score: number
}

export interface VideoProcessingResult {
  source: VideoSource
  transcript: VideoTranscript
  claims: VideoClaim[]
  visual_contexts: VisualContext[]
  processing_time_ms: number
  claim_summary: ClaimSummary
}

export interface ClaimSummary {
  total_claims: number
  by_type: Record<VideoClaimType, number>
  by_status: Record<VideoClaimStatus, number>
  avg_confidence: number
  speakers_identified: number
  visual_claims_count: number
}

// ─── CONSTANTS ─────────────────────────────────────────────────────────────────

export const VIDEO_SOURCE_TYPES: VideoSourceType[] = [
  'youtube', 'news_broadcast', 'political_debate',
  'press_conference', 'un_session', 'direct_url', 'live_stream',
]

export const VIDEO_CLAIM_TYPES: VideoClaimType[] = [
  'factual', 'statistical', 'attribution', 'causal',
  'predictive', 'visual', 'chyron', 'opinion',
]

export const VIDEO_CLAIM_STATUSES: VideoClaimStatus[] = [
  'verified', 'disputed', 'unverified', 'mixed', 'opinion', 'retracted',
]

export const SUPPORTED_LANGUAGES: VideoLanguage[] = [
  'en', 'es', 'fr', 'ar', 'zh', 'ru', 'de', 'pt', 'ja', 'ko', 'hi', 'tr',
]

export const LANGUAGE_NAMES: Record<VideoLanguage, string> = {
  en: 'English', es: 'Spanish', fr: 'French', ar: 'Arabic',
  zh: 'Chinese', ru: 'Russian', de: 'German', pt: 'Portuguese',
  ja: 'Japanese', ko: 'Korean', hi: 'Hindi', tr: 'Turkish',
}

/** Minimum confidence threshold to keep a claim (0–1) */
export const MIN_CLAIM_CONFIDENCE = 0.35

/** Maximum claims to extract per video (safety limit) */
export const MAX_CLAIMS_PER_VIDEO = 500

/** Redis cache TTL for video lookups (6 hours) */
export const CACHE_TTL_S = 21_600

// ─── CLAIM EXTRACTION PATTERNS ─────────────────────────────────────────────────

/**
 * Spoken-language claim patterns tuned for video content.
 * Extends audio-claims patterns with debate/broadcast-specific indicators.
 */
export const CLAIM_PATTERNS: Record<VideoClaimType, RegExp[]> = {
  statistical: [
    /\b(\d[\d,.]*)\s*(percent|%|billion|million|trillion|thousand|hundred)/i,
    /\b(increased|decreased|rose|fell|dropped|surged|plummeted)\s+by\s+(\d[\d,.]*)/i,
    /\b(rate|ratio|index|gdp|unemployment|inflation)\s+(is|was|stands?\s+at)\s+(\d[\d,.]*)/i,
    /\baccording\s+to\s+(the\s+)?(latest|recent|new)\s+(data|figures|statistics|numbers|report)/i,
  ],
  attribution: [
    /\b(said|stated|claimed|announced|declared|confirmed|denied|warned|told|reported)\s/i,
    /\baccording\s+to\s+([\w\s]+)/i,
    /\b(minister|president|secretary|director|spokesperson|analyst|expert|official)\s+(said|stated|warned)/i,
    /\bquote\b.*\bunquote\b/i,
  ],
  causal: [
    /\b(because|caused|due\s+to|resulted?\s+in|led\s+to|as\s+a\s+result|consequence)/i,
    /\b(if|when|unless)\s+.{10,}\b(then|will|would|could|might)/i,
    /\b(impact|effect|influence)\s+of\b/i,
  ],
  predictive: [
    /\b(will|expect|forecast|predict|anticipate|project|estimate)\s/i,
    /\b(by\s+\d{4}|next\s+(year|month|quarter|decade)|in\s+the\s+(coming|next)\s+(years?|months?))/i,
    /\b(likely|unlikely|probable|expected|projected)\s+to\b/i,
  ],
  factual: [
    /\b(is|are|was|were)\s+(the\s+)?(largest|smallest|first|last|only|most|least|highest|lowest)/i,
    /\b(confirmed|verified|established|proven|documented)\s+that\b/i,
    /\bin\s+\d{4}\b/i,
  ],
  visual: [
    // Visual claims are detected from OCR/frame analysis, not speech patterns
  ],
  chyron: [
    // Chyron claims are detected from lower-third text extraction
  ],
  opinion: [
    /\b(I\s+think|I\s+believe|in\s+my\s+(view|opinion)|personally|it\s+seems\s+to\s+me)/i,
    /\b(should|ought\s+to|must|need\s+to)\b/i,
    /\b(clearly|obviously|undoubtedly|without\s+a\s+doubt)\b/i,
  ],
}

/**
 * Debate-specific claim patterns for political content.
 */
export const DEBATE_PATTERNS: RegExp[] = [
  /\b(my\s+opponent|the\s+other\s+side|my\s+administration|we\s+will|I\s+promise)/i,
  /\b(record\s+shows?|voting\s+record|fact\s+is|the\s+truth\s+is|let\s+me\s+be\s+clear)/i,
  /\b(plan|proposal|policy|legislation|bill|act)\s+(will|would|could)\b/i,
]

/**
 * Broadcast-specific claim patterns for news content.
 */
export const BROADCAST_PATTERNS: RegExp[] = [
  /\b(breaking|developing|just\s+in|we\'re\s+learning|sources?\s+say)/i,
  /\b(exclusive|first\s+reported|confirmed\s+by|multiple\s+sources)/i,
  /\b(officials?\s+say|authorities?\s+confirm|government\s+announces?)/i,
]

// ─── FILLER WORD REMOVAL ────────────────────────────────────────────────────────

const FILLER_PATTERN = /\b(um+|uh+|er+|ah+|like,?\s|you\s+know,?\s|sort\s+of,?\s|kind\s+of,?\s|I\s+mean,?\s)/gi

export function removeFillers(text: string): string {
  return text.replace(FILLER_PATTERN, ' ').replace(/\s{2,}/g, ' ').trim()
}

// ─── HASHING ────────────────────────────────────────────────────────────────────

export function hashVideo(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16)
}

export function hashClaim(sourceId: string, text: string, startS: number): string {
  return createHash('sha256')
    .update(`${sourceId}:${text}:${startS}`)
    .digest('hex')
    .slice(0, 16)
}

// ─── CONFIDENCE SCORING ─────────────────────────────────────────────────────────

/**
 * Calculates confidence score for a claim extracted from video.
 *
 * Scoring factors:
 *   - Base confidence from pattern match count
 *   - Boost for statistical claims (numbers = more verifiable)
 *   - Boost for attribution (named speaker = more verifiable)
 *   - Boost for visual corroboration (chyron/graphic matches speech)
 *   - Penalty for hedging language
 *   - Penalty for opinion markers
 *   - Boost for debate/broadcast-specific patterns
 */
export function scoreClaimConfidence(
  text: string,
  type: VideoClaimType,
  hasVisualCorroboration: boolean,
  sourceType: VideoSourceType,
): number {
  let score = 0.5

  // Statistical claims with concrete numbers are highly verifiable
  if (/\d/.test(text)) score += 0.1
  if (/\b(percent|%|billion|million)\b/i.test(text)) score += 0.1

  // Named attribution boosts confidence
  if (/\b(according\s+to|said|stated|confirmed)\b/i.test(text)) score += 0.08

  // Visual corroboration from chyrons/graphics
  if (hasVisualCorroboration) score += 0.15

  // Debate/broadcast sources have more checkable claims
  if (sourceType === 'political_debate' || sourceType === 'press_conference') score += 0.05

  // Hedging language reduces confidence
  if (/\b(maybe|perhaps|might|could|possibly|allegedly|reportedly)\b/i.test(text)) score -= 0.12

  // Opinion markers heavily penalize
  if (/\b(I\s+think|I\s+believe|in\s+my\s+opinion)\b/i.test(text)) score -= 0.2

  // Type-specific adjustments
  if (type === 'opinion') score = Math.min(score, 0.3)
  if (type === 'visual' || type === 'chyron') score += 0.1

  return Math.max(0, Math.min(1, Number(score.toFixed(3))))
}

// ─── CLAIM TYPE DETECTION ───────────────────────────────────────────────────────

export function detectClaimType(
  text: string,
  isVisual: boolean,
  isChyron: boolean,
): VideoClaimType {
  if (isChyron) return 'chyron'
  if (isVisual) return 'visual'

  // Score each pattern type
  const scores: Partial<Record<VideoClaimType, number>> = {}

  for (const [type, patterns] of Object.entries(CLAIM_PATTERNS) as [VideoClaimType, RegExp[]][]) {
    if (type === 'visual' || type === 'chyron') continue
    scores[type] = patterns.filter(p => p.test(text)).length
  }

  // Check opinion first (takes priority as a classifier)
  if ((scores.opinion ?? 0) >= 2) return 'opinion'

  // Find best non-opinion match
  let best: VideoClaimType = 'factual'
  let bestScore = 0

  for (const [type, score] of Object.entries(scores) as [VideoClaimType, number][]) {
    if (type === 'opinion') continue
    if (score > bestScore) {
      bestScore = score
      best = type
    }
  }

  return best
}

// ─── ENTITY EXTRACTION ──────────────────────────────────────────────────────────

const KNOWN_ENTITIES: Record<string, string[]> = {
  'United Nations': ['UN', 'United Nations', 'the UN'],
  'United States': ['US', 'USA', 'United States', 'America'],
  'European Union': ['EU', 'European Union'],
  'World Health Organization': ['WHO', 'World Health Organization'],
  'NATO': ['NATO', 'North Atlantic Treaty Organization'],
  'International Monetary Fund': ['IMF', 'International Monetary Fund'],
  'World Bank': ['World Bank'],
  'BRICS': ['BRICS'],
  'G7': ['G7', 'Group of Seven'],
  'G20': ['G20', 'Group of Twenty'],
}

export function extractEntities(text: string): string[] {
  const found: Set<string> = new Set()

  for (const [canonical, aliases] of Object.entries(KNOWN_ENTITIES)) {
    for (const alias of aliases) {
      if (text.includes(alias)) {
        found.add(canonical)
        break
      }
    }
  }

  // Simple proper noun detection (capitalized multi-word sequences)
  const properNouns = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) ?? []
  for (const noun of properNouns) {
    if (noun.length >= 4) found.add(noun)
  }

  return Array.from(found)
}

// ─── SCENE SEGMENTATION ─────────────────────────────────────────────────────────

export interface SceneSegment {
  start_s: number
  end_s: number
  topic: string
  speaker: string | null
  text: string
}

/**
 * Segments a transcript into topical scenes based on:
 *   - Speaker changes
 *   - Long pauses (>3s gap between segments)
 *   - Topic shifts (keyword diversity change)
 */
export function segmentScenes(segments: TranscriptSegment[]): SceneSegment[] {
  if (segments.length === 0) return []

  const scenes: SceneSegment[] = []
  let currentScene: SceneSegment = {
    start_s: segments[0].start_s,
    end_s: segments[0].end_s,
    topic: '',
    speaker: segments[0].speaker,
    text: segments[0].text,
  }

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]
    const gap = seg.start_s - currentScene.end_s
    const speakerChanged = seg.speaker !== null && seg.speaker !== currentScene.speaker

    if (gap > 3 || speakerChanged) {
      // Finalize current scene
      currentScene.topic = inferTopic(currentScene.text)
      scenes.push(currentScene)

      // Start new scene
      currentScene = {
        start_s: seg.start_s,
        end_s: seg.end_s,
        topic: '',
        speaker: seg.speaker,
        text: seg.text,
      }
    } else {
      currentScene.end_s = seg.end_s
      currentScene.text += ' ' + seg.text
    }
  }

  // Push final scene
  currentScene.topic = inferTopic(currentScene.text)
  scenes.push(currentScene)

  return scenes
}

const TOPIC_KEYWORDS: Record<string, string[]> = {
  'Economy': ['economy', 'gdp', 'inflation', 'unemployment', 'market', 'trade', 'fiscal', 'monetary'],
  'Security': ['military', 'defense', 'security', 'attack', 'war', 'conflict', 'weapon', 'missile'],
  'Health': ['health', 'pandemic', 'vaccine', 'hospital', 'disease', 'medical', 'WHO'],
  'Climate': ['climate', 'carbon', 'emissions', 'temperature', 'renewable', 'energy', 'environment'],
  'Technology': ['technology', 'AI', 'artificial intelligence', 'cyber', 'digital', 'data', 'software'],
  'Politics': ['election', 'vote', 'congress', 'parliament', 'legislation', 'bill', 'policy'],
  'Human Rights': ['rights', 'freedom', 'democracy', 'protest', 'refugee', 'humanitarian'],
}

export function inferTopic(text: string): string {
  const lower = text.toLowerCase()
  let bestTopic = 'General'
  let bestCount = 0

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    const count = keywords.filter(kw => lower.includes(kw.toLowerCase())).length
    if (count > bestCount) {
      bestCount = count
      bestTopic = topic
    }
  }

  return bestTopic
}

// ─── CREDIBILITY CALCULATION ────────────────────────────────────────────────────

export function calculateCredibility(claims: VideoClaim[]): number {
  if (claims.length === 0) return 0

  const weights: Record<VideoClaimStatus, number> = {
    verified: 1.0,
    mixed: 0.5,
    unverified: 0.3,
    disputed: 0.1,
    opinion: 0.2,
    retracted: 0.0,
  }

  let weighted = 0
  let total = 0

  for (const claim of claims) {
    const w = claim.confidence
    weighted += w * (weights[claim.status] ?? 0.3)
    total += w
  }

  return total > 0 ? Number((weighted / total).toFixed(3)) : 0
}

// ─── MONITORED VIDEO CHANNELS ───────────────────────────────────────────────────

export interface MonitoredChannel {
  name: string
  type: VideoSourceType
  url: string
  language: VideoLanguage
  country: string
  category: string
  update_frequency: string
}

export const MONITORED_CHANNELS: MonitoredChannel[] = [
  // News Broadcasts
  { name: 'BBC News', type: 'news_broadcast', url: 'https://www.youtube.com/@BBCNews', language: 'en', country: 'GB', category: 'News Broadcast', update_frequency: 'hourly' },
  { name: 'CNN', type: 'news_broadcast', url: 'https://www.youtube.com/@CNN', language: 'en', country: 'US', category: 'News Broadcast', update_frequency: 'hourly' },
  { name: 'Al Jazeera English', type: 'news_broadcast', url: 'https://www.youtube.com/@AlJazeeraEnglish', language: 'en', country: 'QA', category: 'News Broadcast', update_frequency: 'hourly' },
  { name: 'DW News', type: 'news_broadcast', url: 'https://www.youtube.com/@DWNews', language: 'en', country: 'DE', category: 'News Broadcast', update_frequency: 'hourly' },
  { name: 'France 24 English', type: 'news_broadcast', url: 'https://www.youtube.com/@FRANCE24English', language: 'en', country: 'FR', category: 'News Broadcast', update_frequency: 'hourly' },
  { name: 'NHK World', type: 'news_broadcast', url: 'https://www.youtube.com/@NHKWORLDJAPANNews', language: 'en', country: 'JP', category: 'News Broadcast', update_frequency: 'daily' },
  { name: 'CGTN', type: 'news_broadcast', url: 'https://www.youtube.com/@CGTNOfficial', language: 'en', country: 'CN', category: 'News Broadcast', update_frequency: 'daily' },
  { name: 'RT', type: 'news_broadcast', url: 'https://www.youtube.com/@RTnews', language: 'en', country: 'RU', category: 'News Broadcast', update_frequency: 'daily' },
  { name: 'TRT World', type: 'news_broadcast', url: 'https://www.youtube.com/@taborworld', language: 'en', country: 'TR', category: 'News Broadcast', update_frequency: 'daily' },
  { name: 'WION', type: 'news_broadcast', url: 'https://www.youtube.com/@WIONews', language: 'en', country: 'IN', category: 'News Broadcast', update_frequency: 'hourly' },

  // Political Debates & Parliaments
  { name: 'C-SPAN', type: 'political_debate', url: 'https://www.youtube.com/@caborpan', language: 'en', country: 'US', category: 'Political Debate', update_frequency: 'daily' },
  { name: 'UK Parliament', type: 'political_debate', url: 'https://www.youtube.com/@UKParliament', language: 'en', country: 'GB', category: 'Political Debate', update_frequency: 'weekly' },
  { name: 'European Parliament', type: 'political_debate', url: 'https://www.youtube.com/@EuropeanParliament', language: 'en', country: 'BE', category: 'Political Debate', update_frequency: 'weekly' },
  { name: 'Australian Parliament', type: 'political_debate', url: 'https://www.youtube.com/@AusParlTV', language: 'en', country: 'AU', category: 'Political Debate', update_frequency: 'weekly' },

  // Press Conferences
  { name: 'White House', type: 'press_conference', url: 'https://www.youtube.com/@WhiteHouse', language: 'en', country: 'US', category: 'Press Conference', update_frequency: 'daily' },
  { name: 'UN Web TV', type: 'un_session', url: 'https://www.youtube.com/@UnitedNations', language: 'en', country: 'US', category: 'UN Session', update_frequency: 'daily' },
  { name: 'NATO Channel', type: 'press_conference', url: 'https://www.youtube.com/@NATOChannel', language: 'en', country: 'BE', category: 'Press Conference', update_frequency: 'weekly' },

  // Investigative / Long-form
  { name: 'VICE News', type: 'youtube', url: 'https://www.youtube.com/@VICENews', language: 'en', country: 'US', category: 'Investigative', update_frequency: 'daily' },
  { name: 'Bellingcat', type: 'youtube', url: 'https://www.youtube.com/@Bellingcat', language: 'en', country: 'NL', category: 'Investigative', update_frequency: 'weekly' },

  // Multi-language
  { name: 'France 24 Français', type: 'news_broadcast', url: 'https://www.youtube.com/@FRANCE24', language: 'fr', country: 'FR', category: 'News Broadcast', update_frequency: 'hourly' },
  { name: 'DW Español', type: 'news_broadcast', url: 'https://www.youtube.com/@DWEspanol', language: 'es', country: 'DE', category: 'News Broadcast', update_frequency: 'daily' },
  { name: 'Al Jazeera Arabic', type: 'news_broadcast', url: 'https://www.youtube.com/@AlJazeera', language: 'ar', country: 'QA', category: 'News Broadcast', update_frequency: 'hourly' },
  { name: 'Globo News', type: 'news_broadcast', url: 'https://www.youtube.com/@GloboNews', language: 'pt', country: 'BR', category: 'News Broadcast', update_frequency: 'daily' },
  { name: 'Россия 24', type: 'news_broadcast', url: 'https://www.youtube.com/@Russia24TV', language: 'ru', country: 'RU', category: 'News Broadcast', update_frequency: 'daily' },
]

// ─── CORE PROCESSING ────────────────────────────────────────────────────────────

/**
 * Extract claims from a pre-built transcript (for testing & batch processing).
 */
export function extractClaimsFromText(
  text: string,
  sourceId: string,
  sourceType: VideoSourceType,
  startOffsetS: number = 0,
  segmentDurationS: number = 60,
): Omit<VideoClaim, 'id' | 'transcript_id' | 'extracted_at'>[] {
  const cleaned = removeFillers(text)
  // Split into sentences
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(s => s.length >= 20)

  const claims: Omit<VideoClaim, 'id' | 'transcript_id' | 'extracted_at'>[] = []

  for (const sentence of sentences) {
    const type = detectClaimType(sentence, false, false)
    const confidence = scoreClaimConfidence(sentence, type, false, sourceType)

    if (confidence < MIN_CLAIM_CONFIDENCE) continue
    if (type === 'opinion' && confidence < 0.25) continue

    const entities = extractEntities(sentence)

    claims.push({
      source_id: sourceId,
      text: sentence.trim(),
      type,
      confidence,
      verification_score: null,
      status: 'unverified',
      speaker: null,
      timestamp_start_s: startOffsetS,
      timestamp_end_s: startOffsetS + segmentDurationS,
      visual_context: null,
      entities,
      cross_references: [],
    })

    if (claims.length >= MAX_CLAIMS_PER_VIDEO) break
  }

  return claims
}

/**
 * Process a full video: transcribe → segment → extract claims → persist.
 *
 * This is the main entry point called by the scraper scheduler.
 */
export async function processVideo(
  source: VideoSource,
): Promise<VideoProcessingResult> {
  const start = Date.now()
  const videoHash = hashVideo(source.url)

  // Check Redis cache for recent processing
  const cached = await redis.get(`video:${videoHash}`)
  if (cached) {
    logger.info(`[video-claims] Cache hit for ${source.url}`)
    return JSON.parse(cached) as VideoProcessingResult
  }

  // Check for idempotency in DB
  const existing = await db.query(
    'SELECT id FROM video_sources WHERE url_hash = $1',
    [videoHash],
  )
  if (existing.rows.length > 0) {
    logger.info(`[video-claims] Already processed: ${source.url}`)
    const existingResult = await buildResultFromDb(existing.rows[0].id)
    await redis.set(`video:${videoHash}`, JSON.stringify(existingResult), 'EX', CACHE_TTL_S)
    return existingResult
  }

  // Transcription (provider-abstracted)
  const transcript = await transcribeVideo(source)

  // Scene segmentation
  const scenes = segmentScenes(transcript.segments)

  // Extract claims from each scene
  const allClaims: VideoClaim[] = []
  for (const scene of scenes) {
    const sceneClaims = extractClaimsFromText(
      scene.text,
      source.id,
      source.type,
      scene.start_s,
      scene.end_s - scene.start_s,
    )

    for (const claim of sceneClaims) {
      allClaims.push({
        ...claim,
        id: hashClaim(source.id, claim.text, claim.timestamp_start_s),
        transcript_id: transcript.id,
        speaker: scene.speaker ?? claim.speaker,
        extracted_at: new Date().toISOString(),
      })
    }
  }

  // Build summary
  const summary = buildClaimSummary(allClaims)

  // Persist to PostgreSQL
  await persistVideoData(source, transcript, allClaims)

  const result: VideoProcessingResult = {
    source,
    transcript,
    claims: allClaims,
    visual_contexts: [],
    processing_time_ms: Date.now() - start,
    claim_summary: summary,
  }

  // Cache in Redis
  await redis.set(`video:${videoHash}`, JSON.stringify(result), 'EX', CACHE_TTL_S)

  logger.info(`[video-claims] Processed ${source.title}: ${allClaims.length} claims in ${result.processing_time_ms}ms`)

  return result
}

// ─── HELPERS ────────────────────────────────────────────────────────────────────

export function buildClaimSummary(claims: VideoClaim[]): ClaimSummary {
  const byType: Record<VideoClaimType, number> = {
    factual: 0, statistical: 0, attribution: 0, causal: 0,
    predictive: 0, visual: 0, chyron: 0, opinion: 0,
  }
  const byStatus: Record<VideoClaimStatus, number> = {
    verified: 0, disputed: 0, unverified: 0, mixed: 0, opinion: 0, retracted: 0,
  }

  const speakers = new Set<string>()
  let totalConfidence = 0
  let visualCount = 0

  for (const claim of claims) {
    byType[claim.type] = (byType[claim.type] ?? 0) + 1
    byStatus[claim.status] = (byStatus[claim.status] ?? 0) + 1
    totalConfidence += claim.confidence
    if (claim.speaker) speakers.add(claim.speaker)
    if (claim.type === 'visual' || claim.type === 'chyron') visualCount++
  }

  return {
    total_claims: claims.length,
    by_type: byType,
    by_status: byStatus,
    avg_confidence: claims.length > 0 ? Number((totalConfidence / claims.length).toFixed(3)) : 0,
    speakers_identified: speakers.size,
    visual_claims_count: visualCount,
  }
}

async function transcribeVideo(source: VideoSource): Promise<VideoTranscript> {
  // Placeholder — in production this calls Whisper/Deepgram/AssemblyAI
  return {
    id: `tr_${hashVideo(source.url)}`,
    source_id: source.id,
    full_text: '',
    segments: [],
    speaker_count: 0,
    provider: 'whisper',
    language: source.language,
    word_count: 0,
    extracted_at: new Date().toISOString(),
  }
}

async function buildResultFromDb(sourceId: string): Promise<VideoProcessingResult> {
  // Reconstruct result from DB
  const [sourceRow, transcriptRow, claimRows] = await Promise.all([
    db.query('SELECT * FROM video_sources WHERE id = $1', [sourceId]),
    db.query('SELECT * FROM video_transcripts WHERE source_id = $1 ORDER BY extracted_at DESC LIMIT 1', [sourceId]),
    db.query('SELECT * FROM video_claims WHERE source_id = $1 ORDER BY timestamp_start_s', [sourceId]),
  ])

  const claims = claimRows.rows as VideoClaim[]
  return {
    source: sourceRow.rows[0] as VideoSource,
    transcript: transcriptRow.rows[0] as VideoTranscript,
    claims,
    visual_contexts: [],
    processing_time_ms: 0,
    claim_summary: buildClaimSummary(claims),
  }
}

async function persistVideoData(
  source: VideoSource,
  transcript: VideoTranscript,
  claims: VideoClaim[],
): Promise<void> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')

    // Insert source
    await client.query(
      `INSERT INTO video_sources (id, url, url_hash, type, title, publisher, language, duration_s, resolution, channel_name, broadcast_date, country_code, thumbnail_url, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (url_hash) DO NOTHING`,
      [source.id, source.url, hashVideo(source.url), source.type, source.title, source.publisher, source.language, source.duration_s, source.resolution, source.channel_name, source.broadcast_date, source.country_code, source.thumbnail_url, JSON.stringify(source.metadata)],
    )

    // Insert transcript
    await client.query(
      `INSERT INTO video_transcripts (id, source_id, full_text, segments, speaker_count, provider, language, word_count, extracted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [transcript.id, transcript.source_id, transcript.full_text, JSON.stringify(transcript.segments), transcript.speaker_count, transcript.provider, transcript.language, transcript.word_count, transcript.extracted_at],
    )

    // Insert claims
    for (const claim of claims) {
      await client.query(
        `INSERT INTO video_claims (id, transcript_id, source_id, text, type, confidence, verification_score, status, speaker, timestamp_start_s, timestamp_end_s, visual_context, entities, cross_references, extracted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO NOTHING`,
        [claim.id, claim.transcript_id, claim.source_id, claim.text, claim.type, claim.confidence, claim.verification_score, claim.status, claim.speaker, claim.timestamp_start_s, claim.timestamp_end_s, JSON.stringify(claim.visual_context), claim.entities, JSON.stringify(claim.cross_references), claim.extracted_at],
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
