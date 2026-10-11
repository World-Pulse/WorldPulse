/**
 * OpenAI's account has had no credit since Oct 10, 2026: every call fails at
 * once with 429 "insufficient_quota". The jobs that still use it (search
 * embeddings, Knowledge Graph entities) have free fallbacks (TF-IDF vectors,
 * rule-based entities), so after such an answer they use those for an hour
 * instead of asking again for every signal and logging each failure (ten
 * warnings every half hour, hiding the ones that matter in ops-status).
 * Once credit is back, the next try after the hour succeeds.
 */

import { logger } from './logger'

const PAUSE_MS = 60 * 60_000
let pausedUntil = 0

/** Whether OpenAI calls are paused for lack of credit */
export function openaiPaused(now = Date.now()): boolean {
  return now < pausedUntil
}

/**
 * Note a failed OpenAI answer; pauses OpenAI calls for an hour when it says
 * the account is out of credit. Returns whether it did.
 */
export function noteOpenAIFailure(status: number, body: string, now = Date.now()): boolean {
  if (status !== 429 || !/insufficient_quota|exceeded your current quota/i.test(body)) return false
  if (!openaiPaused(now)) logger.warn('OpenAI is out of credit: embeddings and entities use their free fallbacks for an hour')
  pausedUntil = now + PAUSE_MS
  return true
}

/** For tests */
export function resumeOpenAI(): void {
  pausedUntil = 0
}
