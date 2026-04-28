/**
 * signal-summary.ts — AI-generated signal summaries
 *
 * Strategy (priority order, first available key wins):
 *   1. Check Redis cache (TTL 24h) — return if hit
 *   2. If ANTHROPIC_API_KEY set → call Anthropic claude-haiku-4-5-20251001
 *   3. Else if OPENAI_API_KEY set → call OpenAI gpt-4o-mini
 *   4. Else if GEMINI_API_KEY set → call Google Gemini 2.0 Flash
 *   5. Else if OPENROUTER_API_KEY set → call OpenRouter (configurable model)
 *   6. Else if OLLAMA_URL set  → call Ollama (llama3.2 or configured model)
 *   7. Fallback                → extractive summary from title + summary + body
 *
 * No extra npm packages — uses native fetch (Node 18+).
 */

import { redis } from '../db/redis'

// ─── Config ──────────────────────────────────────────────────────────────────
const SUMMARY_CACHE_TTL   = 60 * 60 * 24  // 24 hours in seconds
const CACHE_KEY_PREFIX    = 'signal-ai-summary:'
const MAX_INPUT_CHARS     = 2000           // truncate long bodies before sending to LLM
const OPENAI_MODEL        = 'gpt-4o-mini'
const ANTHROPIC_MODEL     = 'claude-haiku-4-5-20251001'
const GEMINI_MODEL        = 'gemini-2.0-flash'
const OLLAMA_MODEL        = process.env.OLLAMA_MODEL        ?? 'llama3.2'
const OPENROUTER_MODEL    = process.env.OPENROUTER_MODEL    ?? 'meta-llama/llama-3.2-3b-instruct:free'

// ─── Types ────────────────────────────────────────────────────────────────────
export interface SignalSummaryInput {
  id:       string
  title:    string
  summary:  string | null
  body:     string | null
  category: string
  severity: string
  tags:     string[]
  language?: string
}

export interface AISummary {
  text:        string
  model:       'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'ollama' | 'extractive'
  generatedAt: string
}

// ─── Cache helpers ────────────────────────────────────────────────────────────
async function getCached(signalId: string): Promise<AISummary | null> {
  try {
    const raw = await redis.get(`${CACHE_KEY_PREFIX}${signalId}`)
    if (!raw) return null
    return JSON.parse(raw) as AISummary
  } catch {
    return null
  }
}

async function setCached(signalId: string, summary: AISummary): Promise<void> {
  try {
    await redis.setex(
      `${CACHE_KEY_PREFIX}${signalId}`,
      SUMMARY_CACHE_TTL,
      JSON.stringify(summary),
    )
  } catch {
    // Non-fatal — cache miss is acceptable
  }
}

export async function invalidateSummaryCache(signalId: string): Promise<void> {
  try {
    await redis.del(`${CACHE_KEY_PREFIX}${signalId}`)
  } catch {
    // Non-fatal
  }
}

// ─── Extractive fallback ──────────────────────────────────────────────────────
/**
 * Produces a 2-3 sentence summary without an LLM by:
 *  - Using the existing summary if present
 *  - Otherwise extracting the first 2 sentences from the body
 *  - Appending severity/category context
 */
function buildExtractiveSummary(signal: SignalSummaryInput): AISummary {
  const parts: string[] = []

  if (signal.summary && signal.summary.trim().length > 20) {
    parts.push(signal.summary.trim())
  } else if (signal.body) {
    // Split body on sentence boundaries and take first 2
    const sentences = signal.body
      .replace(/\n+/g, ' ')
      .match(/[^.!?]+[.!?]+/g) ?? []
    const first2 = sentences.slice(0, 2).join(' ').trim()
    if (first2.length > 20) parts.push(first2)
  }

  if (parts.length === 0) {
    parts.push(`${signal.title}.`)
  }

  // Append context tag if not already similar
  const context = `[${signal.severity.toUpperCase()} · ${signal.category}]`
  const text = `${parts.join(' ')} ${context}`.trim()

  return {
    text,
    model:       'extractive',
    generatedAt: new Date().toISOString(),
  }
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────
async function generateWithOpenAI(
  signal: SignalSummaryInput,
  language: string,
): Promise<AISummary> {
  const apiKey = process.env.OPENAI_API_KEY!
  const inputText = buildInputText(signal)

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:      OPENAI_MODEL,
      max_tokens: 150,
      messages: [
        {
          role:    'system',
          content: `You are PULSE, the AI Bureau for WorldPulse — a global intelligence platform.
Write a concise 2-3 sentence summary following PULSE style:
Sentence 1: What happened + where (active voice, lead with event).
Sentence 2: Why it matters — significance, impact, or affected population.
Sentence 3: What to watch next — forward-looking indicator or next development.
Be factual and neutral. No hedging words. Cite source types when known.
${language !== 'en' ? `Respond in ${language}.` : 'Respond in English.'}`,
        },
        {
          role:    'user',
          content: inputText,
        },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI API error ${res.status}: ${err}`)
  }

  const json = await res.json() as {
    choices: Array<{ message: { content: string } }>
  }
  const text = json.choices[0]?.message?.content?.trim()
  if (!text) throw new Error('OpenAI returned empty response')

  return {
    text,
    model:       'openai',
    generatedAt: new Date().toISOString(),
  }
}

// ─── Ollama ───────────────────────────────────────────────────────────────────
async function generateWithOllama(
  signal: SignalSummaryInput,
  language: string,
): Promise<AISummary> {
  const baseUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434'
  const inputText = buildInputText(signal)
  const prompt = `You are PULSE, the AI Bureau for WorldPulse. Write a concise 2-3 sentence summary following PULSE style: Sentence 1: What happened + where (active voice). Sentence 2: Why it matters. Sentence 3: What to watch next. Be factual.${language !== 'en' ? ` Respond in ${language}.` : ''}

${inputText}

Summary:`

  const res = await fetch(`${baseUrl}/api/generate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:  OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { num_predict: 150, temperature: 0.3 },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Ollama API error ${res.status}: ${err}`)
  }

  const json = await res.json() as { response?: string }
  const text = json.response?.trim()
  if (!text) throw new Error('Ollama returned empty response')

  return {
    text,
    model:       'ollama',
    generatedAt: new Date().toISOString(),
  }
}

// ─── Anthropic (Claude) ───────────────────────────────────────────────────────
async function generateWithAnthropic(
  signal: SignalSummaryInput,
  language: string,
): Promise<AISummary> {
  const apiKey = process.env.ANTHROPIC_API_KEY!
  const inputText = buildInputText(signal)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      ANTHROPIC_MODEL,
      max_tokens: 200,
      system: `You are PULSE, the AI Bureau for WorldPulse — a global intelligence platform.
Write a concise 2-3 sentence summary following PULSE style:
Sentence 1: What happened + where (active voice, lead with event).
Sentence 2: Why it matters — significance, impact, or affected population.
Sentence 3: What to watch next — forward-looking indicator or next development.
Be factual and neutral. No hedging words. Cite source types when known.${language !== 'en' ? ` Respond in ${language}.` : ' Respond in English.'}`,
      messages: [{ role: 'user', content: inputText }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Anthropic API error ${res.status}: ${err}`)
  }

  const json = await res.json() as {
    content: Array<{ type: string; text: string }>
  }
  const text = json.content.find(c => c.type === 'text')?.text?.trim()
  if (!text) throw new Error('Anthropic returned empty response')

  return { text, model: 'anthropic', generatedAt: new Date().toISOString() }
}

// ─── Google Gemini ────────────────────────────────────────────────────────────
async function generateWithGemini(
  signal: SignalSummaryInput,
  language: string,
): Promise<AISummary> {
  const apiKey = process.env.GEMINI_API_KEY!
  const inputText = buildInputText(signal)
  const prompt = `You are PULSE, the AI Bureau for WorldPulse — a global intelligence platform.
Write a concise 2-3 sentence summary following PULSE style:
Sentence 1: What happened + where (active voice, lead with event).
Sentence 2: Why it matters — significance, impact, or affected population.
Sentence 3: What to watch next — forward-looking indicator or next development.
Be factual and neutral. No hedging words. Cite source types when known.${language !== 'en' ? ` Respond in ${language}.` : ' Respond in English.'}

${inputText}`

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents:         [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 200, temperature: 0.3 },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini API error ${res.status}: ${err}`)
  }

  const json = await res.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>
  }
  const text = json.candidates[0]?.content?.parts[0]?.text?.trim()
  if (!text) throw new Error('Gemini returned empty response')

  return { text, model: 'gemini', generatedAt: new Date().toISOString() }
}

// ─── OpenRouter ───────────────────────────────────────────────────────────────
async function generateWithOpenRouter(
  signal: SignalSummaryInput,
  language: string,
): Promise<AISummary> {
  const apiKey = process.env.OPENROUTER_API_KEY!
  const inputText = buildInputText(signal)

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer':  'https://world-pulse.io',
      'X-Title':       'WorldPulse',
    },
    body: JSON.stringify({
      model:      OPENROUTER_MODEL,
      max_tokens: 200,
      messages: [
        {
          role:    'system',
          content: `You are PULSE, the AI Bureau for WorldPulse — a global intelligence platform.
Write a concise 2-3 sentence summary following PULSE style:
Sentence 1: What happened + where (active voice, lead with event).
Sentence 2: Why it matters — significance, impact, or affected population.
Sentence 3: What to watch next — forward-looking indicator or next development.
Be factual and neutral. No hedging words. Cite source types when known.${language !== 'en' ? ` Respond in ${language}.` : ' Respond in English.'}`,
        },
        { role: 'user', content: inputText },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenRouter API error ${res.status}: ${err}`)
  }

  const json = await res.json() as {
    choices: Array<{ message: { content: string } }>
  }
  const text = json.choices[0]?.message?.content?.trim()
  if (!text) throw new Error('OpenRouter returned empty response')

  return { text, model: 'openrouter', generatedAt: new Date().toISOString() }
}

// ─── Input builder ────────────────────────────────────────────────────────────
function buildInputText(signal: SignalSummaryInput): string {
  const parts = [
    `TITLE: ${signal.title}`,
    signal.summary ? `SUMMARY: ${signal.summary}` : '',
    signal.body    ? `BODY: ${signal.body.slice(0, MAX_INPUT_CHARS)}` : '',
    `CATEGORY: ${signal.category}`,
    `SEVERITY: ${signal.severity}`,
    signal.tags.length > 0 ? `TAGS: ${signal.tags.join(', ')}` : '',
  ]
  return parts.filter(Boolean).join('\n')
}

// ─── Main public API ──────────────────────────────────────────────────────────
/**
 * Generate (or return cached) AI summary for a signal.
 * Never throws — falls back to extractive summary on any LLM failure.
 */
export async function generateSignalSummary(
  signal: SignalSummaryInput,
): Promise<AISummary> {
  // 1. Cache hit
  const cached = await getCached(signal.id)
  if (cached) return cached

  const language = signal.language ?? 'en'
  let summary: AISummary

  try {
    if (process.env.ANTHROPIC_API_KEY) {
      summary = await generateWithAnthropic(signal, language)
    } else if (process.env.OPENAI_API_KEY) {
      summary = await generateWithOpenAI(signal, language)
    } else if (process.env.GEMINI_API_KEY) {
      summary = await generateWithGemini(signal, language)
    } else if (process.env.OPENROUTER_API_KEY) {
      summary = await generateWithOpenRouter(signal, language)
    } else if (process.env.OLLAMA_URL) {
      summary = await generateWithOllama(signal, language)
    } else {
      summary = buildExtractiveSummary(signal)
    }
  } catch (err) {
    // LLM failed — use extractive fallback and do NOT cache (allow retry)
    console.warn('[signal-summary] LLM error, using extractive fallback:', err)
    return buildExtractiveSummary(signal)
  }

  // Cache successful LLM or extractive result
  await setCached(signal.id, summary)
  return summary
}

/**
 * Regenerate summary (bypass cache). Useful for admin refresh.
 */
export async function refreshSignalSummary(
  signal: SignalSummaryInput,
): Promise<AISummary> {
  await invalidateSummaryCache(signal.id)
  return generateSignalSummary(signal)
}
