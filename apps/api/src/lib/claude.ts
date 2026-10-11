/**
 * Claude for the API's AI work (the AI Digest, signal summaries, briefings,
 * story threads), under the spending cap the scraper shares.
 *
 * Oct 11, 2026: OpenAI ran out of credit, and Devon chose to bring the AI
 * work in-house, onto the Claude key the server already has, with a hard cap
 * of $20 a month. The scraper counts against the same Redis keys
 * (apps/scraper/src/lib/claude.ts); each day may spend the month's cap over
 * its days, and once that's spent no call is made: callers fall back to what
 * they did without AI (no summary, no post).
 */

import { redis } from '../db/redis'
import { logger } from './logger'

/** Claude's newest small model: summaries, flash briefs, thread summaries */
export const CLAUDE_SMALL  = process.env.CLAUDE_SMALL_MODEL || 'claude-haiku-5-5'
/** The writer for analysis and daily briefings */
export const CLAUDE_WRITER = process.env.PULSE_ANTHROPIC_MODEL || 'claude-sonnet-5-5'

/** US dollars per million tokens, [input, output] (Anthropic list prices, Oct 2026) */
const PRICES: Record<string, [number, number]> = {
  'claude-haiku-5-5':          [0.10, 0.50],
  'claude-sonnet-5-5':         [2, 10],
  'claude-haiku-4-5-20251001': [1, 5],
}
const UNKNOWN_PRICE: [number, number] = [2, 10]

export function claudeConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

export function monthlyCapUsd(): number {
  const cap = Number(process.env.AI_MONTHLY_CAP_USD)
  return Number.isFinite(cap) && cap > 0 ? cap : 20
}

/** A reply's cost in millionths of a dollar */
export function costMicros(model: string, inputTokens: number, outputTokens: number): number {
  const [input, output] = PRICES[model] ?? UNKNOWN_PRICE
  return Math.ceil(inputTokens * input + outputTokens * output)
}

const dayOf   = (now: Date) => now.toISOString().slice(0, 10)
const monthOf = (now: Date) => now.toISOString().slice(0, 7)
const daysIn  = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()

/** Redis keys (UTC day and month), shared with the scraper */
export const spendKeys = (now = new Date()) => ({
  day:   `ai:claude:spend:${dayOf(now)}`,
  month: `ai:claude:spend:${monthOf(now)}`,
  calls: `ai:claude:calls:${dayOf(now)}`,
})

export async function claudeBudgetLeft(now = new Date()): Promise<boolean> {
  const keys = spendKeys(now)
  const [day, month] = await redis.mget(keys.day, keys.month)
  const cap = monthlyCapUsd() * 1_000_000
  return Number(month ?? 0) < cap && Number(day ?? 0) < cap / daysIn(now)
}

const KEEP_S = 40 * 86_400

async function recordSpend(purpose: string, micros: number, now = new Date()): Promise<void> {
  const keys = spendKeys(now)
  await redis.multi()
    .incrby(keys.day, micros).expire(keys.day, KEEP_S)
    .incrby(keys.month, micros).expire(keys.month, KEEP_S)
    .hincrby(keys.calls, purpose, 1).expire(keys.calls, KEEP_S)
    .exec()
}

/**
 * Text without unpaired UTF-16 surrogates (half an emoji, as a headline or
 * summary cut short can leave), which make the API refuse the whole request
 * as invalid JSON. Same as the scraper's lib/claude.ts.
 */
export function wellFormed(text: string): string {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
}

export interface ClaudeReply {
  text:         string
  model:        string
  inputTokens:  number
  outputTokens: number
  costMicros:   number
  /** Why the reply ended: "end_turn", "max_tokens" (cut short), "refusal" … */
  stopReason?:  string
}

/**
 * Thinking off for these jobs (the same as the scraper's lib/claude.ts).
 * Claude's 5.5 models think by default, and thinking tokens count toward
 * max_tokens, so a small limit can end the reply before any text (Oct 11,
 * 2026: most of the scraper's editor calls came back empty that way), and
 * thinking would be paid at the output price. Haiku 5.5 turns it off with
 * "disabled" (allowed at its default effort, medium); Sonnet 5.5's lowest
 * setting is "between_tools". Older models don't think unless asked.
 */
export function thinkingOff(model: string): { type: string } | undefined {
  if (/^claude-haiku-5/.test(model)) return { type: 'disabled' }
  if (/^claude-sonnet-5/.test(model)) return { type: 'between_tools' }
  return undefined
}

/**
 * One Messages API call within the cap. Null without a key, when the cap is
 * reached (or Redis can't say), or on any error.
 */
export async function askClaude(opts: {
  purpose:    string
  prompt:     string
  maxTokens:  number
  system?:    string
  model?:     string
  timeoutMs?: number
}): Promise<ClaudeReply | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  if (!(await claudeBudgetLeft().catch(() => false))) {
    logger.info({ purpose: opts.purpose }, 'Claude cap reached for today: no call')
    return null
  }
  const model = opts.model ?? CLAUDE_SMALL
  const post = (body: Record<string, unknown>) => fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  })
  try {
    // No temperature: newer Claude models refuse non-default values
    const request = {
      model,
      max_tokens: opts.maxTokens,
      ...(opts.system ? { system: wellFormed(opts.system) } : {}),
      messages:   [{ role: 'user', content: wellFormed(opts.prompt) }],
    }
    const thinking = thinkingOff(model)
    let res = await post(thinking ? { ...request, thinking } : request)
    if (!res.ok && thinking && res.status === 400) {
      // A model that won't take that setting: ask again with its default
      // thinking, and room for it on top of the answer
      const body = await res.text().catch(() => '')
      if (!/thinking/i.test(body)) {
        logger.warn({ status: res.status, purpose: opts.purpose, model, body: body.slice(0, 300) }, 'Claude call failed')
        return null
      }
      logger.warn({ purpose: opts.purpose, model, body: body.slice(0, 200) }, 'Claude: thinking setting refused, asking with the default')
      res = await post({ ...request, max_tokens: opts.maxTokens + 2_048 })
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      logger.warn({ status: res.status, purpose: opts.purpose, model, body: body.slice(0, 300) }, 'Claude call failed')
      return null
    }
    const json = await res.json() as {
      content?:     Array<{ type: string; text?: string }>
      usage?:       { input_tokens?: number; output_tokens?: number }
      stop_reason?: string
    }
    const inputTokens  = json.usage?.input_tokens ?? 0
    const outputTokens = json.usage?.output_tokens ?? 0
    const micros = costMicros(model, inputTokens, outputTokens)
    await recordSpend(opts.purpose, micros).catch(err => logger.warn({ err }, 'Claude spend not recorded'))
    // (by type: a reply can start with thinking blocks)
    const text = (json.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('').trim()
    if (!text || json.stop_reason === 'refusal') {
      logger.warn({ purpose: opts.purpose, model, stopReason: json.stop_reason, outputTokens }, 'Claude: reply without text')
    }
    return { text: json.stop_reason === 'refusal' ? '' : text, model, inputTokens, outputTokens, costMicros: micros, stopReason: json.stop_reason }
  } catch (err) {
    logger.warn({ err, purpose: opts.purpose, model }, 'Claude call failed')
    return null
  }
}
