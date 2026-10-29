/**
 * A value kept in Redis and served at once, even when a little old, while a
 * fresh one is made in the background ("stale while revalidate"; Oct 13,
 * 2026: the morning briefing's first visitor in each 15 minutes waited 18 s
 * for Claude's summary).
 *
 * Fresh for `freshSeconds`: served as is. Then, for up to `staleSeconds`
 * more, still served, while one process (a Redis lock) makes the next.
 * With nothing kept, or Redis unavailable, it is made while the caller waits.
 */

import { redis } from '../db/redis'

interface Kept<T> { at: number; value: T }

export interface SwrOptions {
  freshSeconds: number
  staleSeconds: number
  /** How long one process may take to make the next value before another may try */
  lockSeconds?: number
}

async function store<T>(key: string, value: T, opts: SwrOptions): Promise<void> {
  const kept: Kept<T> = { at: Date.now(), value }
  await redis.setex(key, opts.freshSeconds + opts.staleSeconds, JSON.stringify(kept)).catch(() => {})
}

/**
 * The values this process is making right now, by key (Oct 29, 2026): a
 * second caller shares the one under way instead of starting another. The
 * Redis lock below keeps processes apart, but it lapses after lockSeconds: on
 * Oct 28, with the server out of memory, the stories list's remake outlived
 * its 2-minute lock and each lapse started one more, until three of the same
 * query were running at once, and with nothing kept every visitor started
 * their own. Each entry goes when its make settles (lib/long-query.ts ends a
 * query stuck past its limit, so they do settle).
 */
const making = new Map<string, Promise<unknown>>()

/** Make the value and keep it: one make per key at a time in this process, shared by every caller */
function makeAndKeep<T>(key: string, opts: SwrOptions, make: () => Promise<T>): Promise<T> {
  const running = making.get(key) as Promise<T> | undefined
  if (running) return running
  const job: Promise<T> = Promise.resolve()
    .then(make)
    .then(async (value) => { await store(key, value, opts); return value })
    .finally(() => { if (making.get(key) === job) making.delete(key) })
  making.set(key, job)
  return job
}

/** Make the next value in the background, by one process at a time (a Redis lock) */
async function remakeInBackground<T>(key: string, opts: SwrOptions, make: () => Promise<T>): Promise<void> {
  if (making.has(key)) return   // under way here already
  const lock = `${key}:refreshing`
  const mine = await redis.set(lock, '1', 'EX', opts.lockSeconds ?? 120, 'NX').catch(() => null)
  if (mine !== 'OK') return
  void makeAndKeep(key, opts, make)
    .catch(() => { /* keep serving what's kept; the next request tries again */ })
    .finally(() => { redis.del(lock).catch(() => {}) })
}

/**
 * Make and keep the value now, waiting for it, unless another process is
 * making it (for jobs that keep values made ahead of visitors, such as
 * stories.ts warmWeeks): whether this call made it
 */
export async function remakeNow<T>(key: string, opts: SwrOptions, make: () => Promise<T>): Promise<boolean> {
  if (making.has(key)) return false
  const lock = `${key}:refreshing`
  const mine = await redis.set(lock, '1', 'EX', opts.lockSeconds ?? 120, 'NX').catch(() => null)
  if (mine !== 'OK') return false
  try {
    await makeAndKeep(key, opts, make)
    return true
  } finally {
    await redis.del(lock).catch(() => {})
  }
}

/** How many seconds ago the kept value was made, or null when nothing is kept (or Redis can't say) */
export async function keptAge(key: string): Promise<number | null> {
  try {
    const raw = await redis.get(key)
    if (!raw) return null
    const kept = JSON.parse(raw) as Kept<unknown>
    return typeof kept.at === 'number' ? (Date.now() - kept.at) / 1000 : null
  } catch {
    return null
  }
}

/**
 * `cold` (Oct 20, 2026): with nothing kept, answers at once (an estimate, say)
 * while one process makes the value in the background, instead of the caller
 * waiting for it.
 */
export async function staleWhileRevalidate<T>(key: string, opts: SwrOptions, make: () => Promise<T>, cold?: () => Promise<T>): Promise<T> {
  let kept: Kept<T> | null = null
  try {
    const raw = await redis.get(key)
    if (raw) kept = JSON.parse(raw) as Kept<T>
  } catch { /* nothing kept */ }

  if (kept && typeof kept.at === 'number') {
    const age = (Date.now() - kept.at) / 1000
    if (age < opts.freshSeconds) return kept.value
    if (age < opts.freshSeconds + opts.staleSeconds) {
      await remakeInBackground(key, opts, make)
      return kept.value
    }
  }

  if (cold) {
    await remakeInBackground(key, opts, make)
    return cold()
  }

  // Nothing kept: made while the caller waits, and callers arriving meanwhile wait for the same one
  return makeAndKeep(key, opts, make)
}
