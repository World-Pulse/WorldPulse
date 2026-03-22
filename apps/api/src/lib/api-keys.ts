import crypto from 'crypto'

export interface GeneratedApiKey {
  key: string
  hash: string
}

export interface TierConfig {
  rpm: number
  rpd: number
}

export const TIER_LIMITS: Record<string, TierConfig> = {
  free:       { rpm: 60,   rpd: 1_000 },
  pro:        { rpm: 300,  rpd: 10_000 },
  enterprise: { rpm: 9999, rpd: 999_999 },
}

export function generateApiKey(): GeneratedApiKey {
  const randomHex = crypto.randomBytes(16).toString('hex') // 32 hex chars
  const key = `wp_live_${randomHex}`
  const hash = hashKey(key)
  return { key, hash }
}

export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

export function verifyKey(key: string, hash: string): boolean {
  const computed = hashKey(key)
  return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'))
}
