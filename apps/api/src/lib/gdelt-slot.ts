/**
 * One request to GDELT's APIs at a time, across the server (plan 0s3, Oct 22,
 * 2026). GDELT asks for one request every 5 seconds and answers "Please limit
 * requests to one every 5 seconds" (HTTP 429) past that. The scraper's
 * second-outlet search (apps/scraper/src/pipeline/second-outlet.ts) now asks
 * GDELT's news index a question every few seconds, so the story page's news
 * images and TV clips take the same slot: a Redis key that frees 6 seconds
 * after it was taken.
 */

import { redis } from '../db/redis'

export const GDELT_SLOT_KEY = 'gdelt:doc:slot'
const SLOT_MS = 6_000

/**
 * Wait up to `waitMs` for the slot. True when this request may go to GDELT;
 * false when the slot stayed taken. Without Redis, true (as before).
 */
export async function gdeltSlot(waitMs: number): Promise<boolean> {
  const until = Date.now() + waitMs
  for (;;) {
    let ok: unknown
    try {
      ok = await redis.set(GDELT_SLOT_KEY, '1', 'PX', SLOT_MS, 'NX')
    } catch {
      return true
    }
    // Redis answers null when the slot is taken ("OK" when this request took it)
    if (ok !== null) return true
    if (Date.now() >= until) return false
    await new Promise(resolve => setTimeout(resolve, 250))
  }
}
