/**
 * Readers' flags on a signal (plan C3, handoff H-0020; Oct 20, 2026).
 *
 * Until now an anonymous visitor could flag the same signal again and again
 * (only signed-in readers were checked: 10 flags a minute could inflate any
 * signal's count), and signal_flags.ip_hash was not a hash: the visitor's
 * address base64-encoded, so anyone with the table could read it back. Now
 * the address is stored as a keyed hash (HMAC-SHA256 with a key only the
 * server knows): the same visitor still matches, the address can't be read.
 * One flag per signal per reader: per account when signed in, else per
 * hashed address. No schema change (ip_hash is VARCHAR(64), the hash 64 hex).
 */

import { createHmac } from 'node:crypto'
import { db } from '../db/postgres'
import { logger } from './logger'

const HEX64 = /^[0-9a-f]{64}$/

function hashKey(): string {
  // `||`: compose passes an unset variable as ""
  return process.env.FLAG_HASH_SECRET || process.env.JWT_SECRET || 'worldpulse-flag-hash'
}

/** A visitor's address as a keyed hash: 64 hex characters, the same for the same address */
export function visitorHash(address: string): string {
  return createHmac('sha256', hashKey()).update(address.trim().toLowerCase()).digest('hex')
}

/** Whether this reader already flagged this signal: by account when signed in, else by hashed address */
export async function alreadyFlagged(signalId: string, userId: string | null, ipHash: string | null): Promise<boolean> {
  if (userId) return !!(await db('signal_flags').where({ signal_id: signalId, user_id: userId }).first('id'))
  if (ipHash) return !!(await db('signal_flags').where({ signal_id: signalId, ip_hash: ipHash }).whereNull('user_id').first('id'))
  return false
}

/**
 * Flags stored before the hash (an address base64-encoded): each becomes the
 * keyed hash of the address it held, so it can no longer be read back and an
 * old anonymous flag still counts for that visitor. Rows already hashed don't
 * match, so a later start changes nothing.
 */
export async function hashStoredFlagAddresses(): Promise<number> {
  try {
    const rows = await db('signal_flags')
      .whereNotNull('ip_hash')
      .whereRaw("ip_hash !~ '^[0-9a-f]{64}$'")
      .select('id', 'ip_hash')
      .limit(5_000) as Array<{ id: string; ip_hash: string }>
    let changed = 0
    for (const row of rows) {
      if (HEX64.test(row.ip_hash)) continue
      const address = Buffer.from(row.ip_hash, 'base64').toString('utf8')
      changed += Number(await db('signal_flags').where('id', row.id).update({ ip_hash: visitorHash(address) })) || 0
    }
    return changed
  } catch (err) {
    logger.warn({ err }, 'Flag addresses not hashed yet (will try at the next start)')
    return 0
  }
}
