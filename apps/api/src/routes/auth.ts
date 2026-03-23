import type { FastifyPluginAsync } from 'fastify'
import bcrypt from 'bcryptjs'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { z } from 'zod'
import type { AuthTokens, ApiResponse, AuthUser } from '@worldpulse/types'
import { indexUser } from '../lib/search'

const RegisterSchema = z.object({
  handle:      z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/),
  displayName: z.string().min(1).max(100),
  email:       z.string().email(),
  password:    z.string().min(8).max(128),
})

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string(),
})

// ─── OpenAPI shared schemas ───────────────────────────────────────────────────
const AuthUserSchema = {
  type: 'object',
  properties: {
    id:            { type: 'string', format: 'uuid' },
    handle:        { type: 'string' },
    displayName:   { type: 'string' },
    email:         { type: 'string', format: 'email' },
    bio:           { type: 'string', nullable: true },
    avatarUrl:     { type: 'string', nullable: true },
    location:      { type: 'string', nullable: true },
    website:       { type: 'string', nullable: true },
    accountType:   { type: 'string', enum: ['community', 'journalist', 'official', 'expert', 'ai', 'bot', 'admin'] },
    trustScore:    { type: 'number' },
    followerCount: { type: 'number' },
    followingCount:{ type: 'number' },
    signalCount:   { type: 'number' },
    verified:      { type: 'boolean' },
    onboarded:     { type: 'boolean' },
    createdAt:     { type: 'string', format: 'date-time' },
  },
}

const AuthTokensSchema = {
  type: 'object',
  properties: {
    accessToken:  { type: 'string', description: 'Short-lived JWT (15 min)' },
    refreshToken: { type: 'string', description: 'Rotation token (30 days, stored in Redis)' },
    expiresIn:    { type: 'number', description: 'Access token lifetime in seconds' },
  },
}

const ErrorSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error:   { type: 'string' },
    code:    { type: 'string' },
  },
}

export const registerAuthRoutes: FastifyPluginAsync = async (app) => {

  // ─── REGISTER ────────────────────────────────────────────
  app.post('/register', {
    schema: {
      tags: ['auth'],
      summary: 'Create a new account',
      body: {
        type: 'object',
        required: ['handle', 'displayName', 'email', 'password'],
        properties: {
          handle:      { type: 'string', minLength: 3, maxLength: 50, pattern: '^[a-zA-Z0-9_]+$' },
          displayName: { type: 'string', minLength: 1, maxLength: 100 },
          email:       { type: 'string', format: 'email' },
          password:    { type: 'string', minLength: 8, maxLength: 128 },
        },
      },
      response: {
        201: {
          description: 'Account created',
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                user: AuthUserSchema,
                ...AuthTokensSchema.properties,
              },
            },
          },
        },
        400: { description: 'Validation error', ...ErrorSchema },
        409: { description: 'Handle or email already taken', ...ErrorSchema },
      },
    },
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = RegisterSchema.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ success: false, error: 'Invalid input', code: 'VALIDATION_ERROR' })
    }

    const { handle, displayName, email, password } = body.data

    // Check uniqueness
    const exists = await db('users')
      .where('email', email)
      .orWhere('handle', handle.toLowerCase())
      .first()

    if (exists) {
      const field = exists.email === email ? 'email' : 'handle'
      return reply.status(409).send({ success: false, error: `That ${field} is already taken`, code: 'DUPLICATE' })
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const [user] = await db('users')
      .insert({
        handle:        handle.toLowerCase(),
        display_name:  displayName,
        email,
        password_hash: passwordHash,
      })
      .returning(['id', 'handle', 'display_name', 'email', 'account_type', 'trust_score', 'verified', 'onboarded', 'created_at'])

    const tokens = await issueTokens(app, user.id)

    // Index new user in Meilisearch (non-blocking)
    indexUser(user).catch(() => {})

    return reply.status(201).send({
      success: true,
      data: {
        user: formatUser(user),
        ...tokens,
      },
    } satisfies ApiResponse<{ user: AuthUser } & AuthTokens>)
  })

  // ─── LOGIN ───────────────────────────────────────────────
  app.post('/login', {
    schema: {
      tags: ['auth'],
      summary: 'Log in and receive JWT tokens',
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:    { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
      },
      response: {
        200: {
          description: 'Login successful',
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                user: AuthUserSchema,
                ...AuthTokensSchema.properties,
              },
            },
          },
        },
        400: { description: 'Validation error', ...ErrorSchema },
        401: { description: 'Invalid credentials', ...ErrorSchema },
        403: { description: 'Account suspended', ...ErrorSchema },
      },
    },
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = LoginSchema.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ success: false, error: 'Invalid input', code: 'VALIDATION_ERROR' })
    }

    const { email, password } = body.data

    const user = await db('users').where('email', email).first()

    if (!user || !user.password_hash) {
      return reply.status(401).send({ success: false, error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' })
    }

    if (user.suspended) {
      return reply.status(403).send({ success: false, error: 'Account suspended', code: 'SUSPENDED' })
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      return reply.status(401).send({ success: false, error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' })
    }

    await db('users').where('id', user.id).update({ last_seen_at: new Date() })
    const tokens = await issueTokens(app, user.id)

    return reply.send({
      success: true,
      data: { user: formatUser(user), ...tokens },
    })
  })

  // ─── REFRESH TOKEN ───────────────────────────────────────
  app.post('/refresh', {
    schema: {
      tags: ['auth'],
      summary: 'Rotate a refresh token into new access + refresh tokens',
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string' },
        },
      },
      response: {
        200: {
          description: 'New token pair issued',
          type: 'object',
          properties: { success: { type: 'boolean' }, data: AuthTokensSchema },
        },
        400: { description: 'Missing token', ...ErrorSchema },
        401: { description: 'Invalid or expired refresh token', ...ErrorSchema },
      },
    },
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { refreshToken } = req.body as { refreshToken?: string }
    if (!refreshToken) {
      return reply.status(400).send({ success: false, error: 'Refresh token required', code: 'MISSING_TOKEN' })
    }

    // Verify refresh token from Redis
    const userId = await redis.get(`refresh:${refreshToken}`)
    if (!userId) {
      return reply.status(401).send({ success: false, error: 'Invalid or expired refresh token', code: 'INVALID_TOKEN' })
    }

    // Rotate: delete old, issue new
    await redis.del(`refresh:${refreshToken}`)
    const tokens = await issueTokens(app, userId)

    return reply.send({ success: true, data: tokens })
  })

  // ─── LOGOUT ──────────────────────────────────────────────
  app.post('/logout', {
    schema: {
      tags: ['auth'],
      summary: 'Invalidate refresh token',
      body: {
        type: 'object',
        properties: {
          refreshToken: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' } } },
      },
    },
  }, async (req, reply) => {
    const { refreshToken } = req.body as { refreshToken?: string }
    if (refreshToken) await redis.del(`refresh:${refreshToken}`)
    return reply.send({ success: true })
  })

  // ─── ME ──────────────────────────────────────────────────
  app.get('/me', {
    schema: {
      tags: ['auth'],
      summary: 'Get the authenticated user\'s profile',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          description: 'Current user profile',
          type: 'object',
          properties: { success: { type: 'boolean' }, data: AuthUserSchema },
        },
        401: { description: 'Unauthorized', ...ErrorSchema },
        404: { description: 'User not found', ...ErrorSchema },
      },
    },
    preHandler: async (req, reply) => {
      try {
        await req.jwtVerify()
      } catch {
        return reply.status(401).send({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' })
      }
    },
  }, async (req, reply) => {
    const { id } = req.user as { id: string }
    const user = await db('users')
      .where('id', id)
      .select(['id', 'handle', 'display_name', 'email', 'bio', 'avatar_url',
               'account_type', 'trust_score', 'follower_count', 'following_count',
               'signal_count', 'verified', 'onboarded', 'created_at'])
      .first()

    if (!user) return reply.status(404).send({ success: false, error: 'User not found' })
    return reply.send({ success: true, data: formatUser(user) })
  })
}

// ─── HELPERS ─────────────────────────────────────────────────────────────
async function issueTokens(app: Parameters<FastifyPluginAsync>[0], userId: string): Promise<AuthTokens> {
  const accessToken  = app.jwt.sign({ id: userId }, { expiresIn: '15m' })
  const refreshToken = crypto.randomUUID()
  
  // Store refresh token in Redis (30 days)
  await redis.setex(`refresh:${refreshToken}`, 30 * 24 * 60 * 60, userId)
  
  return { accessToken, refreshToken, expiresIn: 15 * 60 }
}

function formatUser(user: Record<string, unknown>): AuthUser {
  return {
    id:            user.id as string,
    handle:        user.handle as string,
    displayName:   user.display_name as string,
    email:         user.email as string,
    bio:           user.bio as string | null,
    avatarUrl:     user.avatar_url as string | null,
    location:      user.location as string | null,
    website:       user.website as string | null,
    accountType:   user.account_type as AuthUser['accountType'],
    trustScore:    user.trust_score as number,
    followerCount: user.follower_count as number ?? 0,
    followingCount:user.following_count as number ?? 0,
    signalCount:   user.signal_count as number ?? 0,
    verified:      user.verified as boolean,
    onboarded:     (user.onboarded as boolean) ?? false,
    createdAt:     (user.created_at as Date).toISOString(),
  }
}
