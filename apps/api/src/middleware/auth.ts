import type { FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../db/postgres'
import { hashKey } from '../lib/api-keys'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { id: string }
    user: { id: string; handle: string; accountType: string; trustScore: number }
  }
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify()
    const payload = req.user as { id: string }
    
    const user = await db('users')
      .where('id', payload.id)
      .where('suspended', false)
      .first(['id', 'handle', 'account_type', 'trust_score'])

    if (!user) {
      return reply.status(401).send({ success: false, error: 'User not found', code: 'UNAUTHORIZED' })
    }

    req.user = {
      id:          user.id,
      handle:      user.handle,
      accountType: user.account_type,
      trustScore:  user.trust_score,
    }
  } catch {
    return reply.status(401).send({ success: false, error: 'Invalid or expired token', code: 'UNAUTHORIZED' })
  }
}

export async function optionalAuth(req: FastifyRequest) {
  try {
    await req.jwtVerify()
    const payload = req.user as { id: string }
    const user = await db('users').where('id', payload.id).first(['id', 'handle', 'account_type', 'trust_score'])
    if (user) {
      req.user = { id: user.id, handle: user.handle, accountType: user.account_type, trustScore: user.trust_score }
    }
  } catch { /* no-op */ }
}

export async function requireTrust(minScore: number) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await authenticate(req, reply)
    if (req.user && req.user.trustScore < minScore) {
      return reply.status(403).send({
        success: false,
        error: `This action requires a trust score of ${minScore}+`,
        code: 'INSUFFICIENT_TRUST',
      })
    }
  }
}

/**
 * API key authentication for developer/machine access.
 * Reads the key from Authorization: Bearer wp_live_xxx or X-Api-Key header.
 * Attaches `req.apiKey` with tier and rate-limit metadata on success.
 */
export async function apiKeyAuth(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers['authorization'] ?? ''
  const headerKey  = req.headers['x-api-key'] as string | undefined

  let rawKey: string | undefined
  if (headerKey) {
    rawKey = headerKey
  } else if (typeof authHeader === 'string' && authHeader.startsWith('Bearer wp_live_')) {
    rawKey = authHeader.slice('Bearer '.length)
  }

  if (!rawKey) {
    return reply.status(401).send({ success: false, error: 'API key required', code: 'UNAUTHORIZED' })
  }

  const hash = hashKey(rawKey)
  const apiKey = await db('api_keys')
    .where({ key_hash: hash, is_active: true })
    .first(['id', 'user_id', 'name', 'tier', 'rate_limit_per_min', 'rate_limit_per_day'])

  if (!apiKey) {
    return reply.status(401).send({ success: false, error: 'Invalid or revoked API key', code: 'UNAUTHORIZED' })
  }

  // Update last_used_at asynchronously — don't block the request
  db('api_keys').where('id', apiKey.id).update({ last_used_at: new Date() }).catch(() => {})

  ;(req as FastifyRequest & { apiKey: typeof apiKey }).apiKey = apiKey
}

export async function requireAccountType(types: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await authenticate(req, reply)
    if (req.user && !types.includes(req.user.accountType)) {
      return reply.status(403).send({
        success: false,
        error: 'Your account type does not have permission for this action',
        code: 'FORBIDDEN',
      })
    }
  }
}
