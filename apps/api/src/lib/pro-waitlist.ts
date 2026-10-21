/**
 * The Pro waitlist (plan 13; Devon, Oct 21, 2026: "Waitlist now, price
 * later"): a "Pro coming soon" sign-up on /pricing, to see who wants Pro
 * before anything is sold. An address is kept to tell its owner, once, when
 * Pro opens; nothing else is sent to it. Not the briefing's list
 * (lib/subscribers.ts): signing up here sends no briefing.
 *
 * The table is created when the API starts, if missing (only adding).
 */

import { db } from '../db/postgres'
import { logger } from './logger'

let ready = false

export async function ensureWaitlistTable(): Promise<boolean> {
  try {
    await db.raw(`
      CREATE TABLE IF NOT EXISTS pro_waitlist (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        email      TEXT        NOT NULL,
        source     TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`)
    await db.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_pro_waitlist_email ON pro_waitlist (lower(email))')
    ready = true
    return true
  } catch (err) {
    logger.warn({ err }, 'Pro waitlist table could not be created')
    return false
  }
}

export function waitlistReady(): boolean {
  return ready
}

/** A plain address check: something@something.tld, no spaces, at most 254 characters */
export function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (email.length < 6 || email.length > 254) return null
  return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i.test(email) ? email : null
}

/** Where on the site the sign-up was made: a short path or a word, nothing else */
export function cleanSource(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const s = value.trim().slice(0, 80)
  return /^[a-z0-9/_-]+$/i.test(s) ? s : null
}

/** Adds the address (once: a second sign-up changes nothing) */
export async function joinWaitlist(email: string, source: string | null): Promise<void> {
  await db.raw('INSERT INTO pro_waitlist (email, source) VALUES (?, ?) ON CONFLICT (lower(email)) DO NOTHING', [email, source])
}
