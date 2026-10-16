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
import { rateSeverity } from './severity'
import { categorizeArticle } from './categories'
import { claudeConfigured } from '../lib/claude'
import { llmApiUrl, llmHeaders, llmModel, selfHostedLlmConfigured } from '../lib/llm-models'

interface ClassificationResult {
  category:     Category
  subcategory?: string
  severity:     SignalSeverity
  summary:      string
  tags:         string[]
  language:     string
  isBreaking:   boolean
  topics:       string[]
}

// ─── LLM CLASSIFICATION ──────────────────────────────────────────────────
export async function classifyContent(
  title: string,
  body:  string | null,
): Promise<ClassificationResult> {
  // Cache check (AI results only: the word rules are cheap, and a cached
  // rule result would stand in for the AI's for an hour once it's back)
  const cacheKey = `classify:${hashText(title)}`
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached) as ClassificationResult

  // With a Claude key, the word rules file each article and the editor pass
  // (editor.ts) re-files them 50 at a time: in-house, and far cheaper than a
  // call per article (Oct 11, 2026). Without one, a self-hosted model server
  // can do it (LLM_API_URL + LLM_MODEL, lib/llm-models.ts)
  const llmConfigured = !claudeConfigured() && selfHostedLlmConfigured()
  let result: ClassificationResult
  let byLlm = false
  if (llmConfigured) {
    try {
      result = await llmClassify(title, body)
      byLlm = true
    } catch (err) {
      logger.warn({ err }, 'LLM classification failed, falling back to rule-based')
      result = ruleBasedClassify(title, body)
    }
  } else {
    result = ruleBasedClassify(title, body)
  }

  // ── Severity recalibration ──────────────────────────────────────────────
  // Cultural events, sports, entertainment, opinion pieces should never be
  // classified as CRITICAL or HIGH — cap them at MEDIUM.
  result = recalibrateSeverity(result)

  if (byLlm) await redis.setex(cacheKey, 3600, JSON.stringify(result))
  return result
}

/**
 * Post-classification severity recalibration.
 *
 * Rules:
 * 1. Non-security categories are capped at MEDIUM severity max.
 *    Sports, culture, entertainment, opinion, and lifestyle content
 *    should not trigger CRITICAL/HIGH alerts.
 * 2. The "other" category is capped at LOW — if we can't even classify it,
 *    it's not intelligence-grade.
 * 3. "breaking" category respects the LLM's severity judgment since it
 *    was explicitly tagged as breaking news.
 */
function recalibrateSeverity(result: ClassificationResult): ClassificationResult {
  // Categories that should NEVER be critical or high
  const cappedAtMedium: Category[] = ['culture', 'sports', 'science', 'space']
  // Categories that should be capped at low
  const cappedAtLow: Category[] = ['other']

  if (cappedAtLow.includes(result.category)) {
    if (['critical', 'high', 'medium'].includes(result.severity)) {
      result.severity = 'low'
      result.isBreaking = false
    }
  } else if (cappedAtMedium.includes(result.category)) {
    if (['critical', 'high'].includes(result.severity)) {
      result.severity = 'medium'
      result.isBreaking = false
    }
  }

  // Opinion/editorial detection — cap at medium
  const opinionPatterns = /\b(opinion|editorial|commentary|op-?ed|analysis|column|perspective|review|why\s+(?:we|you|i)\s|should\s+(?:we|you)|what\s+(?:we|you)\s+(?:can|need|must))\b/i
  if (opinionPatterns.test(result.summary) || opinionPatterns.test(result.topics?.join(' ') ?? '')) {
    if (['critical', 'high'].includes(result.severity)) {
      result.severity = 'medium'
      result.isBreaking = false
    }
  }

  return result
}

async function llmClassify(title: string, body: string | null): Promise<ClassificationResult> {
  const baseUrl = llmApiUrl()
  const model   = llmModel()

  // No self-hosted model server — skip to rule-based
  if (!baseUrl || !model) {
    throw new Error('No LLM configured')
  }

  const systemPrompt = `You are an intelligence-grade news classification system for a global signals platform. Analyze the article and respond with ONLY valid JSON.

Respond with exactly this JSON structure:
{
  "category": one of [breaking,conflict,geopolitics,climate,health,economy,technology,science,elections,culture,disaster,security,sports,space,other],
  "subcategory": a more specific label (see below),
  "severity": one of [critical,high,medium,low,info],
  "summary": "concise 1-2 sentence intelligence summary under 200 chars — what happened, where, and why it matters",
  "tags": ["tag1", "tag2", "tag3"],
  "language": "2-letter ISO code",
  "isBreaking": true or false,
  "topics": ["main topic", "secondary topic"]
}

SUBCATEGORY GUIDANCE (pick the most specific that fits):
- conflict → armed-conflict, military-operation, insurgency, terrorism, ceasefire-violation, arms-trade, naval-confrontation, border-clash, civil-war
- geopolitics → diplomatic-tension, sanctions, treaty, alliance-shift, territorial-dispute, diplomatic-cooperation, summit, foreign-policy
- security → cyber-attack, espionage, law-enforcement, border-security, intelligence, arms-control
- disaster → earthquake, flood, hurricane, wildfire, industrial-accident, famine, volcanic-eruption
- economy → market-crash, trade-dispute, sanctions-impact, currency-crisis, energy-crisis, supply-chain
- health → pandemic, outbreak, drug-approval, public-health-crisis, epidemic
- elections → presidential, parliamentary, referendum, political-crisis, protest
- climate → emissions, policy, extreme-weather, sea-level, deforestation, biodiversity
- technology → ai, semiconductor, space-tech, cyber, quantum, social-media
- For other categories, use a descriptive 1-2 word subcategory

CLASSIFICATION RULES:
- "conflict" means ACTIVE violence, armed confrontation, or direct military action. Do NOT use conflict for: diplomatic disputes, political rhetoric, economic sanctions, protests (use geopolitics or elections instead)
- "military" mention alone does NOT mean conflict — a military exercise, arms deal, or defense policy is geopolitics or security
- severity=critical: mass casualties, nuclear/chemical threats, major natural disaster active now
- severity=high: significant geopolitical events, major economic shocks, active armed conflict
- severity=medium: elections, policy changes, notable accidents, military posturing
- severity=low: routine news, minor events, diplomatic meetings
- severity=info: updates, background, context, analysis pieces

SUMMARY RULES:
- Write like an intelligence briefing: what happened, where, why it matters
- Never copy-paste the headline — synthesize the key facts
- Include the actual location of the event, not the author's location`

  const userContent = `Title: ${title}\nBody: ${body ? body.slice(0, 1500) : 'N/A'}`

  // The common chat-completions format, on the self-hosted server
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: llmHeaders(),
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

  // The headline, then the article's opening (pipeline/categories.ts, shared
  // with the RSS reader); politics, urgent wording or "other" when neither
  // says (Oct 11, 2026: the old rules here read the pronoun "who" as the WHO)
  const category = categorizeArticle(title, body)
  // Counts the dead and injured and weighs the kind of event (pipeline/severity.ts, plan 0u)
  const severity  = rateSeverity(title, body, category)
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
