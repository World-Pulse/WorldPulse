/**
 * Which API key tier an account may hold (plan G0, Oct 11, 2026).
 *
 * Until Oct 11, 2026 a key's tier came from the request that created it
 * (POST /api/v1/developer/keys with "tier": "enterprise"), so any signed-in
 * user could give themselves a Pro or Enterprise key, and with it Pro-only
 * features such as batch slop checks. Now the account decides: admins may
 * create any tier, accounts on the Pro (or Enterprise) plan up to their plan,
 * everyone else "free".
 * Pro-only features ask again when a key is used, so keys made before the
 * fix, or kept after a subscription ends, don't keep Pro access.
 */

import { db } from '../db/postgres'

export type KeyTier = 'free' | 'pro' | 'enterprise'

const RANK: Record<KeyTier, number> = { free: 0, pro: 1, enterprise: 2 }

/** A stored or requested tier as a known tier ("free" for anything else) */
export function asKeyTier(tier: unknown): KeyTier {
  return tier === 'pro' || tier === 'enterprise' ? tier : 'free'
}

/** Whether a tier is above another */
export function tierAbove(tier: KeyTier, max: KeyTier): boolean {
  return RANK[tier] > RANK[max]
}

/**
 * The highest tier this account may hold. The plan comes from
 * users.subscription_plan, which the Stripe webhook keeps up to date; it is
 * read on its own so that a database without the column answers "free"
 * instead of failing. Pass the account type when it is already known.
 */
export async function maxKeyTier(userId: string, accountType?: string): Promise<KeyTier> {
  try {
    const type = accountType
      ?? (await db('users').where('id', userId).first(['account_type']) as { account_type?: string } | undefined)?.account_type
    if (type === 'admin') return 'enterprise'
  } catch {
    return 'free'
  }
  try {
    const row = await db('users').where('id', userId).first(['subscription_plan']) as { subscription_plan?: string } | undefined
    return asKeyTier(row?.subscription_plan)
  } catch {
    return 'free'
  }
}
