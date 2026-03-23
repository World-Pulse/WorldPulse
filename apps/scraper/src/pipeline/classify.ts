/**
 * Content Classification Pipeline
 * 
 * Uses LLM to classify articles into categories, severity, extract tags,
 * generate summaries, and detect language.
 * 
 * Falls back to rule-based classification when LLM is unavailable.
 */

import type { Category, SignalSeverity } from '@worldpulse/types'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'

interface ClassificationResult {
  category:  Category
  severity:  SignalSeverity
  summary:   string
  tags:      string[]
  language:  string
  isBreaking: boolean
  topics:    string[]
}

// ─── LLM CLASSIFICATION ──────────────────────────────────────────────────
export async function classifyContent(
  title: string,
  body:  string | null,
): Promise<ClassificationResult> {
  // Cache check
  const cacheKey = `classify:${hashText(title)}`
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached) as ClassificationResult

  // Try LLM if configured (requires LLM_API_URL or OPENAI_API_KEY)
  const llmConfigured = !!(process.env.LLM_API_URL || process.env.OPENAI_API_KEY)
  if (llmConfigured) {
    try {
      const result = await llmClassify(title, body)
      await redis.setex(cacheKey, 3600, JSON.stringify(result))
      return result
    } catch (err) {
      logger.warn({ err }, 'LLM classification failed, falling back to rule-based')
    }
  }

  return ruleBasedClassify(title, body)
}

async function llmClassify(title: string, body: string | null): Promise<ClassificationResult> {
  const llmApiUrl   = process.env.LLM_API_URL
  const openaiKey   = process.env.OPENAI_API_KEY
  const model       = process.env.LLM_MODEL ?? 'gpt-4o-mini'

  // Neither LLM source configured — skip to rule-based
  if (!llmApiUrl && !openaiKey) {
    throw new Error('No LLM configured')
  }

  const systemPrompt = `You are a news classification system. Analyze the article and respond with ONLY valid JSON.

Respond with exactly this JSON structure:
{
  "category": one of [breaking,conflict,geopolitics,climate,health,economy,technology,science,elections,culture,disaster,security,sports,space,other],
  "severity": one of [critical,high,medium,low,info],
  "summary": "one sentence summary under 150 chars",
  "tags": ["tag1", "tag2", "tag3"],
  "language": "2-letter ISO code",
  "isBreaking": true or false,
  "topics": ["main topic", "secondary topic"]
}

Rules:
- severity=critical: mass casualties, nuclear/chemical threats, major natural disaster
- severity=high: significant geopolitical events, major economic shocks, serious conflict
- severity=medium: elections, policy changes, notable accidents
- severity=low: routine news, minor events
- severity=info: updates, background, context`

  const userContent = `Title: ${title}\nBody: ${body ? body.slice(0, 800) : 'N/A'}`

  // OpenAI-compatible chat completions API (works for OpenAI and custom LLM_API_URL)
  const endpoint = llmApiUrl
    ? `${llmApiUrl.replace(/\/$/, '')}/chat/completions`
    : 'https://api.openai.com/v1/chat/completions'

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const apiKey = openaiKey ?? process.env.LLM_API_KEY
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userContent },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`LLM API error: ${response.status} — ${text.slice(0, 200)}`)
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('LLM returned empty content')
  return JSON.parse(content) as ClassificationResult
}

// ─── RULE-BASED FALLBACK ─────────────────────────────────────────────────
function ruleBasedClassify(title: string, body: string | null): ClassificationResult {
  const text = `${title} ${body ?? ''}`.toLowerCase()

  const category = detectCategory(text)
  const severity  = detectSeverity(text, category)
  const tags      = extractTags(text)
  const language  = detectLanguage(title)

  return {
    category,
    severity,
    summary:    title.slice(0, 150),
    tags,
    language,
    isBreaking: severity === 'critical' || severity === 'high',
    topics:     tags.slice(0, 2),
  }
}

function detectCategory(text: string): Category {
  // NOTE: order matters — more specific rules first.
  // 'breaking' is checked first so urgent/critical articles are categorised correctly
  // rather than falling through to a more generic bucket.
  const rules: [RegExp, Category][] = [
    // ── Breaking / urgent news ──────────────────────────────────────────────
    [/\b(breaking|urgent|just in|alert|developing story|emergency|evacuation order|state of emergency|major incident)\b/, 'breaking'],
    // ── Disasters ───────────────────────────────────────────────────────────
    [/\b(earthquake|tsunami|hurricane|typhoon|flood|wildfire|eruption|tornado|avalanche|landslide|cyclone|blizzard|drought)\b/, 'disaster'],
    // ── Armed conflict ───────────────────────────────────────────────────────
    [/\b(war|attack|killed|airstrike|troops|military|missile|bomb|gunfire|ceasefire|offensive|frontline|casualt)\b/, 'conflict'],
    // ── Elections & politics ─────────────────────────────────────────────────
    [/\b(election|vote|ballot|campaign|president|prime minister|parliament|congress|referendum|polling)\b/, 'elections'],
    // ── Climate & environment ────────────────────────────────────────────────
    [/\b(climate|emissions|temperature|arctic|glacier|carbon|warming|sea level|deforestation|biodiversity|coral reef)\b/, 'climate'],
    // ── Health & medicine ────────────────────────────────────────────────────
    [/\b(outbreak|virus|disease|pandemic|vaccine|hospital|health|who|cdc|pathogen|epidemic|public health|mortality|infection)\b/, 'health'],
    // ── Markets & economy ────────────────────────────────────────────────────
    [/\b(stock|market|economy|gdp|inflation|federal reserve|interest rate|trade|sanctions|currency|recession|debt|fiscal|imf)\b/, 'economy'],
    // ── Cybersecurity ────────────────────────────────────────────────────────
    [/\b(cyber|hack|ransomware|data breach|phishing|malware|vulnerability|exploit|zero.day|cve|infosec)\b/, 'security'],
    // ── Technology & AI ──────────────────────────────────────────────────────
    [/\b(ai|artificial intelligence|tech|startup|silicon valley|semiconductor|quantum|robotics|autonomous|neural)\b/, 'technology'],
    // ── Space & astronomy ────────────────────────────────────────────────────
    [/\b(space|nasa|rocket|satellite|mars|moon|astronaut|orbit|launch|iss|spacex|esa|asteroid|telescope)\b/, 'space'],
    // ── Science & research ───────────────────────────────────────────────────
    [/\b(research|study|discovery|experiment|scientists|university|published|peer.reviewed|clinical trial|genome|physics|chemistry)\b/, 'science'],
    // ── Geopolitics & diplomacy ───────────────────────────────────────────────
    [/\b(sanctions|diplomat|treaty|nato|un|security council|foreign minister|geopolit|alliance|bilateral|multilateral)\b/, 'geopolitics'],
    // ── Culture, arts & society ───────────────────────────────────────────────
    [/\b(culture|film|music|art|award|festival|celebrity|sports|football|soccer|olympics|world cup|nba|nfl|cricket|tennis|religion|protest|movement|activism)\b/, 'culture'],
  ]

  for (const [regex, cat] of rules) {
    if (regex.test(text)) return cat
  }

  return 'other'
}

function detectSeverity(text: string, category: Category): SignalSeverity {
  const critical = /\b(mass casualty|nuclear|chemical weapon|catastrophic|collapse|emergency declared)\b/
  const high     = /\b(killed|deaths|major|significant|breaking|urgent|alert|critical)\b/
  const medium   = /\b(injured|damage|concern|warning|developing)\b/

  if (critical.test(text) || ['disaster', 'conflict'].includes(category)) {
    if (critical.test(text)) return 'critical'
    return 'high'
  }
  if (high.test(text)) return 'high'
  if (medium.test(text)) return 'medium'
  return category === 'breaking' ? 'high' : 'info'
}

function extractTags(text: string): string[] {
  const tags: string[] = []
  
  // Country/region tags
  const countries: [RegExp, string][] = [
    [/\bunitedstates|usa|america|washington\b/, 'USA'],
    [/\bchina|beijing|chinese\b/, 'China'],
    [/\brussia|moscow|russian|ukraine|ukrainian\b/, 'Russia-Ukraine'],
    [/\bisrael|gaza|palestine|hamas\b/, 'Middle East'],
    [/\bindia|new delhi|indian\b/, 'India'],
    [/\beurope|eu|european union|brussels\b/, 'Europe'],
    [/\bphilippines|manila|philippine\b/, 'Philippines'],
  ]

  for (const [regex, tag] of countries) {
    if (regex.test(text)) tags.push(tag)
  }

  // Topic tags
  const topics: [RegExp, string][] = [
    [/\bclimate change|global warming\b/, 'ClimateChange'],
    [/\bartificial intelligence|ai\b/, 'AI'],
    [/\bcryptocurrency|bitcoin|ethereum\b/, 'Crypto'],
    [/\bceasefire|peace talks|negotiations\b/, 'PeaceTalks'],
  ]

  for (const [regex, tag] of topics) {
    if (regex.test(text)) tags.push(tag)
  }

  return [...new Set(tags)].slice(0, 5)
}

// Script-based language detection covering scripts most common in global news
const SCRIPT_PATTERNS: [RegExp, string][] = [
  [/[\u4E00-\u9FFF]/, 'zh'],   // CJK Unified Ideographs (Chinese)
  [/[\u3040-\u30FF]/, 'ja'],   // Hiragana / Katakana (Japanese)
  [/[\uAC00-\uD7AF]/, 'ko'],   // Hangul (Korean)
  [/[\u0600-\u06FF]/, 'ar'],   // Arabic
  [/[\u0400-\u04FF]/, 'ru'],   // Cyrillic (Russian default)
  [/[\u0900-\u097F]/, 'hi'],   // Devanagari (Hindi)
  [/[\u0370-\u03FF]/, 'el'],   // Greek
  [/[\u0E00-\u0E7F]/, 'th'],   // Thai
  [/[\u0590-\u05FF]/, 'he'],   // Hebrew
]

// Latin-script stop-word heuristic for common European languages
const LATIN_STOPWORDS: Record<string, string[]> = {
  es: ['que', 'del', 'los', 'las', 'una', 'por', 'con', 'para'],
  fr: ['les', 'des', 'une', 'dans', 'sur', 'est', 'pas', 'aux'],
  de: ['die', 'der', 'das', 'und', 'ist', 'ein', 'nicht', 'mit'],
  pt: ['que', 'uma', 'não', 'com', 'dos', 'são', 'para', 'por'],
  it: ['che', 'del', 'una', 'con', 'per', 'non', 'dei', 'sul'],
}

function detectLanguage(text: string): string {
  for (const [pattern, lang] of SCRIPT_PATTERNS) {
    if (pattern.test(text)) return lang
  }
  const words = text.toLowerCase().split(/\W+/).filter(Boolean)
  let bestLang = 'en'
  let bestScore = 0
  for (const [lang, stopwords] of Object.entries(LATIN_STOPWORDS)) {
    const hits = words.filter(w => stopwords.includes(w)).length
    if (hits > bestScore) { bestScore = hits; bestLang = lang }
  }
  return bestLang
}

function hashText(text: string): string {
  let hash = 0
  for (let i = 0; i < Math.min(text.length, 100); i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}
