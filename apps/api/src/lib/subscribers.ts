/**
 * Email briefing subscribers (plan G4; Devon approved the table, Oct 11, 2026).
 *
 * The list is the digest_subscriptions table from migration 030. Deploys don't
 * run migrations, so it never existed on the server and every sign-up failed
 * with a 500. ensureSubscribersTable() creates it when the API starts (only
 * adding: a table, two columns, indexes; nothing that exists changes).
 *
 * Nobody gets the briefing until they confirm from their inbox (confirmed_at),
 * and every email carries a one-click unsubscribe link. Both links are signed
 * with a key only the server knows, so no one can sign up or unsubscribe an
 * address that isn't theirs.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { db } from '../db/postgres'
import { logger } from './logger'

/** The public address of the API, for links in emails */
export const API_PUBLIC_URL = (process.env.API_PUBLIC_URL || 'https://api.world-pulse.io').replace(/\/+$/, '')
/** The website, where the links land */
export const SITE_URL = (process.env.SITE_URL || 'https://world-pulse.io').replace(/\/+$/, '')

export type LinkPurpose = 'confirm' | 'unsubscribe'

let tableReady = false

/** True once the subscribers table is known to exist */
export function subscribersReady(): boolean {
  return tableReady
}

/** Create the subscribers table if it is missing (safe to run at every start) */
export async function ensureSubscribersTable(): Promise<boolean> {
  try {
    await db.raw(`
      CREATE TABLE IF NOT EXISTS digest_subscriptions (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      UUID        REFERENCES users(id) ON DELETE CASCADE,
        email        TEXT        NOT NULL,
        frequency    TEXT        NOT NULL DEFAULT 'weekly'
                                 CHECK (frequency IN ('daily', 'weekly')),
        categories   TEXT[]      DEFAULT '{}',
        min_severity TEXT        NOT NULL DEFAULT 'medium'
                                 CHECK (min_severity IN ('critical', 'high', 'medium', 'low', 'info')),
        is_active    BOOLEAN     NOT NULL DEFAULT true,
        last_sent_at TIMESTAMPTZ,
        created_at   TIMESTAMPTZ DEFAULT now(),
        updated_at   TIMESTAMPTZ DEFAULT now()
      )`)
    // When the reader confirmed from their inbox (no email goes out before), and
    // where they signed up (a page path, to see which pages bring subscribers)
    await db.raw('ALTER TABLE digest_subscriptions ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ')
    await db.raw('ALTER TABLE digest_subscriptions ADD COLUMN IF NOT EXISTS source TEXT')
    await db.raw(`CREATE UNIQUE INDEX IF NOT EXISTS idx_digest_subscriptions_email
                    ON digest_subscriptions(email) WHERE is_active = true`)
    await db.raw('CREATE INDEX IF NOT EXISTS idx_digest_subscriptions_user_id ON digest_subscriptions(user_id)')
    tableReady = true
    return true
  } catch (err) {
    logger.warn({ err }, 'Email subscribers table could not be created; sign-ups stay off')
    return false
  }
}

/**
 * The countries a reader follows for the briefing (plan G13, Oct 30, 2026) are kept beside the topics in
 * digest_subscriptions.categories as "country:FR", so following needs no new column
 */
export const COUNTRY_PREFIX = 'country:'
/** At most this many countries per reader */
export const MAX_COUNTRIES = 5

/** A subscriber's categories split into topics and followed countries (two-letter codes, at most MAX_COUNTRIES) */
export function splitFollows(categories: unknown): { topics: string[]; countries: string[] } {
  const all = Array.isArray(categories) ? categories.filter((c): c is string => typeof c === 'string' && c.length > 0) : []
  const countries = all
    .filter(c => c.startsWith(COUNTRY_PREFIX))
    .map(c => c.slice(COUNTRY_PREFIX.length).toUpperCase())
    .filter(c => /^[A-Z]{2}$/.test(c))
  return { topics: all.filter(c => !c.startsWith(COUNTRY_PREFIX)), countries: [...new Set(countries)].slice(0, MAX_COUNTRIES) }
}

/** Topics and followed countries as one categories list */
export function joinFollows(topics: string[], countries: string[]): string[] {
  const own = splitFollows([...topics, ...countries.map(c => `${COUNTRY_PREFIX}${c}`)])
  return [...own.topics, ...own.countries.map(c => `${COUNTRY_PREFIX}${c}`)]
}

/** "France" for "FR" (English names; the code itself if unknown) */
export function countryName(code: string): string {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code)
    return name && name !== code ? name : code
  } catch {
    return code
  }
}

/** One spelling per address: trimmed and lower-case */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

function linkSecret(): string {
  return process.env.EMAIL_LINK_SECRET || process.env.JWT_SECRET || ''
}

/** True when links can be signed (the server has a secret) */
export function linksConfigured(): boolean {
  return linkSecret() !== ''
}

/** The signature for one address and purpose (32 URL-safe characters) */
export function emailToken(email: string, purpose: LinkPurpose): string {
  const secret = linkSecret()
  if (!secret) throw new Error('No secret to sign email links (EMAIL_LINK_SECRET or JWT_SECRET)')
  return createHmac('sha256', secret)
    .update(`worldpulse-email:${purpose}:${normalizeEmail(email)}`)
    .digest('base64url')
    .slice(0, 32)
}

/** Whether `token` is this address's signature for `purpose` */
export function verifyEmailToken(email: string, purpose: LinkPurpose, token: unknown): boolean {
  if (typeof token !== 'string' || token.length !== 32 || !linksConfigured()) return false
  const expected = Buffer.from(emailToken(email, purpose))
  const given = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** A signed link to the API for confirming or unsubscribing one address */
export function emailLink(email: string, purpose: LinkPurpose): string {
  const e = encodeURIComponent(normalizeEmail(email))
  return `${API_PUBLIC_URL}/api/v1/digest/${purpose}?e=${e}&t=${emailToken(email, purpose)}`
}
