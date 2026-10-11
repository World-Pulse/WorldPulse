/**
 * Claude for the scraper's AI work, under one spending cap.
 *
 * Oct 11, 2026: OpenAI ran out of credit, and Devon chose to bring the sorter,
 * the fact-checker and the AI Digest in-house, onto the Claude key the server
 * already has, with a hard cap of $20 a month. The cap is shared with the API
 * through Redis (the same keys in apps/api/src/lib/claude.ts) and spread
 * evenly over the month's days: once today's share or the month's total is
 * spent, no call is made and callers fall back to the word rules.
 *
 * Spend is counted from each reply's token usage at Anthropic's list prices,
 * in millionths of a dollar.
 */

import { redis } from './redis'
import { logger } from './logger'

/** The model for sorting and checking: Claude's newest small model */
export const CLAUDE_SMALL = process.env.CLAUDE_SMALL_MODEL || 'claude-haiku-5-5'

/** US dollars per million tokens, [input, output] (Anthropic list prices, Oct 2026) */
const PRICES: Record<string, [number, number]> = {
  'claude-haiku-5-5':          [0.10, 0.50],
  'claude-sonnet-5-5':         [2, 10],
  'claude-haiku-4-5-20251001': [1, 5],
}
/** A model missing above is counted at the dearest price listed */
const UNKNOWN_PRICE: [number, number] = [2, 10]

export function claudeConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

/** The monthly cap in dollars (AI_MONTHLY_CAP_USD, default 20) */
export function monthlyCapUsd(): number {
  const cap = Number(process.env.AI_MONTHLY_CAP_USD)
  return Number.isFinite(cap) && cap > 0 ? cap : 20
}

/** A reply's cost in millionths of a dollar ($ per million tokens × tokens) */
export function costMicros(model: string, inputTokens: number, outputTokens: number): number {
  const [input, output] = PRICES[model] ?? UNKNOWN_PRICE
  return Math.ceil(inputTokens * input + outputTokens * output)
}

const dayOf   = (now: Date) => now.toISOString().slice(0, 10)
const monthOf = (now: Date) => now.toISOString().slice(0, 7)
const daysIn  = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()

/** Redis keys (UTC day and month), shared with the API */
export const spendKeys = (now = new Date()) => ({
  day:   `ai:claude:spend:${dayOf(now)}`,
  month: `ai:claude:spend:${monthOf(now)}`,
  calls: `ai:claude:calls:${dayOf(now)}`,
})

/** Whether today's share of the monthly cap, and the month's cap, have room left */
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

export interface ClaudeReply {
  text:         string
  inputTokens:  number
  outputTokens: number
  costMicros:   number
}

/**
 * One Messages API call within the cap. Null without a key, when the cap is
 * reached (or Redis can't say), or on any error: callers keep what they had.
 */
export async function askClaude(opts: {
  purpose:    string
  system:     string
  prompt:     string
  maxTokens:  number
  model?:     string
  timeoutMs?: number
}): Promise<ClaudeReply | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  if (!(await claudeBudgetLeft().catch(() => false))) return null
  const model = opts.model ?? CLAUDE_SMALL
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      // No temperature: newer Claude models refuse non-default values
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens,
        system:     opts.system,
        messages:   [{ role: 'user', content: opts.prompt }],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      logger.warn({ status: res.status, purpose: opts.purpose, model, body: body.slice(0, 300) }, 'Claude call failed')
      return null
    }
    const json = await res.json() as {
      content?: Array<{ type: string; text?: string }>
      usage?:   { input_tokens?: number; output_tokens?: number }
    }
    const inputTokens  = json.usage?.input_tokens ?? 0
    const outputTokens = json.usage?.output_tokens ?? 0
    const micros = costMicros(model, inputTokens, outputTokens)
    await recordSpend(opts.purpose, micros).catch(err => logger.warn({ err }, 'Claude spend not recorded'))
    const text = (json.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('').trim()
    return { text, inputTokens, outputTokens, costMicros: micros }
  } catch (err) {
    logger.warn({ err, purpose: opts.purpose, model }, 'Claude call failed')
    return null
  }
}
