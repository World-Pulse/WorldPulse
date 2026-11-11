import { redis } from '../db/redis'

/**
 * Sign an account out everywhere: its refresh tokens (refresh:<token> → user
 * id in Redis, 30 days) are removed, so no device gets a new sign-in token;
 * one already issued lasts out its 24 hours. Up to 50,000 tokens looked at.
 * (Moved here from routes/auth.ts on Nov 11, 2026, so closing an account,
 * lib/account-close.ts, can use it too.)
 */
export async function endSessions(userId: string): Promise<number> {
  let cursor = '0'
  let ended = 0
  for (let round = 0; round < 100; round++) {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'refresh:*', 'COUNT', 500) as [string, string[]]
    if (keys.length) {
      const owners = await redis.mget(...keys)
      const mine = keys.filter((_, i) => owners[i] === userId)
      if (mine.length) ended += await redis.del(...mine)
    }
    cursor = next
    if (cursor === '0') break
  }
  return ended
}
