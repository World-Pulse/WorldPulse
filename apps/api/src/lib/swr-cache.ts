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

export async function staleWhileRevalidate<T>(key: string, opts: SwrOptions, make: () => Promise<T>): Promise<T> {
  let kept: Kept<T> | null = null
  try {
    const raw = await redis.get(key)
    if (raw) kept = JSON.parse(raw) as Kept<T>
  } catch { /* nothing kept */ }

  if (kept && typeof kept.at === 'number') {
    const age = (Date.now() - kept.at) / 1000
    if (age < opts.freshSeconds) return kept.value
    if (age < opts.freshSeconds + opts.staleSeconds) {
      const lock = `${key}:refreshing`
      const mine = await redis.set(lock, '1', 'EX', opts.lockSeconds ?? 120, 'NX').catch(() => null)
      if (mine === 'OK') {
        void make()
          .then(value => store(key, value, opts))
          .catch(() => { /* keep serving what's kept; the next request tries again */ })
          .finally(() => { redis.del(lock).catch(() => {}) })
      }
      return kept.value
    }
  }

  const value = await make()
  await store(key, value, opts)
  return value
}
