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

/**
 * Whether Claude is answering (Oct 14, 2026: the organization's API spend
 * limit was reached at 3:34 AM ET, every call failed for six hours, and the
 * editor could only say "no answer from Claude (the cap, or an error)"). One
 * Redis hash, shared with the API: when a call last worked (ok_at); the newest
 * failure (error_at, and error: which app and job, the HTTP status and why, as
 * a fixed phrase, never the error's own text); and while calls keep failing,
 * since when (failing_since) and how many (failing_calls). A call that works
 * clears those two. /ops-status.json shows it under pipeline.claude.
 */
export const HEALTH_KEY = 'ai:claude:health'

/** Why a call failed, in a few fixed words (what /ops-status.json shows) */
export function failureReason(status: number | null, body = '', err?: unknown): string {
  // The Console's spend limit: "You have reached your specified API usage limits"
  if (/usage limits?\b/i.test(body)) return 'spend limit reached'
  if (/credit balance/i.test(body)) return 'out of credit'
  if (status === 401) return 'key rejected'
  if (status === 403) return 'not allowed'
  if (status === 404) return 'model not found'
  if (status === 413) return 'request too large'
  if (status === 429) return 'rate limited'
  if (status === 529 || /overloaded/i.test(body)) return 'overloaded'
  if (status !== null && status >= 500) return 'server error'
  if (status !== null) return 'request refused'
  if (err instanceof SyntaxError) return 'unreadable reply'
  const what = err instanceof Error ? `${err.name} ${err.message} ${String(err.cause ?? '')}` : String(err ?? '')
  if (/timeout|timed out|abort/i.test(what)) return 'timed out'
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|fetch failed|socket/i.test(what)) return 'cannot connect'
  return 'other'
}

/** Why this process's newest call got no answer; null once one worked */
let lastMiss: string | null = null
/** For a job's own log: "spend limit reached", "our cap for today" … or null */
export const whyNoAnswer = (): string | null => lastMiss

async function recordFailure(purpose: string, model: string, status: number | null, reason: string, now = new Date()): Promise<void> {
  lastMiss = reason
  const at = now.toISOString()
  await redis.multi()
    .hset(HEALTH_KEY, 'error_at', at, 'error', JSON.stringify({ app: 'scraper', purpose, model, status, reason }))
    .hsetnx(HEALTH_KEY, 'failing_since', at)
    .hincrby(HEALTH_KEY, 'failing_calls', 1)
    .expire(HEALTH_KEY, KEEP_S)
    .exec()
}

async function recordSpend(purpose: string, micros: number, now = new Date()): Promise<void> {
  const keys = spendKeys(now)
  await redis.multi()
    .incrby(keys.day, micros).expire(keys.day, KEEP_S)
    .incrby(keys.month, micros).expire(keys.month, KEEP_S)
    .hincrby(keys.calls, purpose, 1).expire(keys.calls, KEEP_S)
    // A call that worked: Claude is answering again
    .hset(HEALTH_KEY, 'ok_at', now.toISOString()).hdel(HEALTH_KEY, 'failing_since', 'failing_calls').expire(HEALTH_KEY, KEEP_S)
    .exec()
}

/**
 * Text without unpaired UTF-16 surrogates (half an emoji, as a summary cut
 * at 160 characters can leave), which make the API refuse the whole request
 * as invalid JSON.
 */
export function wellFormed(text: string): string {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
}

export interface ClaudeReply {
  text:         string
  inputTokens:  number
  outputTokens: number
  costMicros:   number
  /** Why the reply ended: "end_turn", "max_tokens" (cut short), "refusal" … */
  stopReason?:  string
}

/**
 * Thinking off for these short jobs. Claude's 5.5 models think by default,
 * and thinking tokens count toward max_tokens, so a small limit can end the
 * reply before any text: on Oct 11, 2026 most of the editor's calls came back
 * empty that way. Haiku 5.5 turns it off with "disabled" (allowed at its
 * default effort, medium); Sonnet 5.5's lowest setting is "between_tools".
 * Older models don't think unless asked.
 */
export function thinkingOff(model: string): { type: string } | undefined {
  if (/^claude-haiku-5/.test(model)) return { type: 'disabled' }
  if (/^claude-sonnet-5/.test(model)) return { type: 'between_tools' }
  return undefined
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
  if (!key) { lastMiss = 'no key'; return null }
  if (!(await claudeBudgetLeft().catch(() => false))) { lastMiss = 'our cap for today'; return null }
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
      system:     wellFormed(opts.system),
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
        await recordFailure(opts.purpose, model, res.status, failureReason(res.status, body)).catch(() => {})
        return null
      }
      logger.warn({ purpose: opts.purpose, model, body: body.slice(0, 200) }, 'Claude: thinking setting refused, asking with the default')
      res = await post({ ...request, max_tokens: opts.maxTokens + 2_048 })
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      logger.warn({ status: res.status, purpose: opts.purpose, model, body: body.slice(0, 300) }, 'Claude call failed')
      await recordFailure(opts.purpose, model, res.status, failureReason(res.status, body)).catch(() => {})
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
    lastMiss = null
    await recordSpend(opts.purpose, micros).catch(err => logger.warn({ err }, 'Claude spend not recorded'))
    // (by type: a reply can start with thinking blocks)
    const text = (json.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('').trim()
    if (!text || json.stop_reason === 'refusal') {
      logger.warn({ purpose: opts.purpose, model, stopReason: json.stop_reason, outputTokens }, 'Claude: reply without text')
    }
    return { text: json.stop_reason === 'refusal' ? '' : text, inputTokens, outputTokens, costMicros: micros, stopReason: json.stop_reason }
  } catch (err) {
    logger.warn({ err, purpose: opts.purpose, model }, 'Claude call failed')
    await recordFailure(opts.purpose, model, null, failureReason(null, '', err)).catch(() => {})
    return null
  }
}
