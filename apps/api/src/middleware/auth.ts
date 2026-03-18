import type { FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../db/postgres'

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
