import type { FastifyPluginAsync } from 'fastify'
import bcrypt from 'bcryptjs'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { z } from 'zod'
import type { AuthTokens, ApiResponse, AuthUser } from '@worldpulse/types'
import { indexUser } from '../lib/search'
import { checkLoginAttempt, recordFailedLogin, clearLoginAttempts } from '../lib/security'
import { sendError } from '../lib/errors'

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

const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1).max(512),
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

  // ─── GITHUB OAUTH COLUMN MIGRATION (idempotent) ──────────────────────────
  try {
    const hasCol = await db.schema.hasColumn('users', 'github_id')
    if (!hasCol) {
      await db.schema.table('users', (t) => {
        t.bigInteger('github_id').nullable().unique()
      })
      app.log.info('✅ Added github_id column to users table')
    }
  } catch (err) {
    app.log.warn({ err }, 'Could not migrate github_id column — continuing')
  }


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
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Invalid input')
    }

    const { handle, displayName, email, password } = body.data

    // Check uniqueness
    const exists = await db('users')
      .where('email', email)
      .orWhere('handle', handle.toLowerCase())
      .first()

    if (exists) {
      const field = exists.email === email ? 'email' : 'handle'
      return sendError(reply, 409, 'CONFLICT', `That ${field} is already taken`)
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
        429: { description: 'Too many login attempts', ...ErrorSchema },
      },
    },
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = LoginSchema.safeParse(req.body)
    if (!body.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Invalid input')
    }

    const { email, password } = body.data

    // ── Gate 6: Brute-force protection ─────────────────────
    const loginCheck = await checkLoginAttempt(email)
    if (!loginCheck.allowed) {
      return sendError(reply, 429, 'RATE_LIMITED', 'Too many failed login attempts. Please try again later.')
    }

    const user = await db('users').where('email', email).first()

    if (!user || !user.password_hash) {
      await recordFailedLogin(email)
      return sendError(reply, 401, 'UNAUTHORIZED', 'Invalid credentials')
    }

    if (user.suspended) {
      return sendError(reply, 403, 'FORBIDDEN', 'Account suspended')
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      await recordFailedLogin(email)
      return sendError(reply, 401, 'UNAUTHORIZED', 'Invalid credentials')
    }

    // Clear failed attempts on successful login
    await clearLoginAttempts(email)

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
    const parsed = RefreshTokenSchema.safeParse(req.body)
    if (!parsed.success) {
      return sendError(reply, 400, 'BAD_REQUEST', 'Refresh token required')
    }
    const { refreshToken } = parsed.data

    // Verify refresh token from Redis
    const userId = await redis.get(`refresh:${refreshToken}`)
    if (!userId) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Invalid or expired refresh token')
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
    const parsed = RefreshTokenSchema.safeParse(req.body)
    if (parsed.success) await redis.del(`refresh:${parsed.data.refreshToken}`)
    return reply.send({ success: true })
  })

  // ─── GITHUB OAUTH — INITIATE ─────────────────────────────
  app.get('/github', {
    schema: {
      tags: ['auth'],
      summary: 'Redirect to GitHub OAuth authorization page',
      response: {
        302: { description: 'Redirect to GitHub' },
        503: { description: 'OAuth not configured', ...ErrorSchema },
      },
    },
  }, async (req, reply) => {
    const clientId = process.env.GITHUB_CLIENT_ID
    const redirectUri = process.env.GITHUB_REDIRECT_URI
    if (!clientId || !redirectUri) {
      return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'GitHub OAuth is not configured')
    }

    const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')
    await redis.setex(`oauth:state:${state}`, 600, 'new')

    const url = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user%3Aemail&state=${state}`
    return reply.redirect(url, 302)
  })

  // ─── GITHUB OAUTH — CALLBACK ──────────────────────────────
  app.get('/github/callback', {
    schema: {
      tags: ['auth'],
      summary: 'Handle GitHub OAuth callback',
      querystring: {
        type: 'object',
        properties: {
          code:  { type: 'string' },
          state: { type: 'string' },
          error: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000'
    const errorRedirect = `${frontendUrl}/auth/login?error=oauth_failed`

    const { code, state, error } = req.query as { code?: string; state?: string; error?: string }

    if (error || !code || !state) {
      return reply.redirect(errorRedirect, 302)
    }

    // Validate state
    const stateVal = await redis.get(`oauth:state:${state}`)
    if (!stateVal) {
      return reply.redirect(errorRedirect, 302)
    }
    await redis.del(`oauth:state:${state}`)

    try {
      // Exchange code for access token
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id:     process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri:  process.env.GITHUB_REDIRECT_URI,
        }),
      })

      const tokenData = await tokenRes.json() as { access_token?: string; error?: string }
      if (!tokenData.access_token) {
        return reply.redirect(errorRedirect, 302)
      }

      const ghToken = tokenData.access_token
      const ghHeaders = { Authorization: `token ${ghToken}`, Accept: 'application/json' }

      // Fetch GitHub profile + emails in parallel
      const [profileRes, emailsRes] = await Promise.all([
        fetch('https://api.github.com/user', { headers: ghHeaders }),
        fetch('https://api.github.com/user/emails', { headers: ghHeaders }),
      ])

      const ghProfile = await profileRes.json() as {
        id: number; login: string; name: string | null; avatar_url: string
      }
      const ghEmails = await emailsRes.json() as Array<{
        email: string; primary: boolean; verified: boolean
      }>

      const primaryEmail = ghEmails.find(e => e.primary && e.verified)?.email
        ?? ghEmails.find(e => e.verified)?.email
        ?? ghEmails[0]?.email

      if (!primaryEmail) {
        return reply.redirect(errorRedirect, 302)
      }

      // Look up existing user by github_id
      let user = await db('users').where('github_id', ghProfile.id).first()

      if (!user) {
        // Check if email is already registered — link the account
        user = await db('users').where('email', primaryEmail).first()

        if (user) {
          // Merge: attach github_id to existing account
          await db('users').where('id', user.id).update({
            github_id:  ghProfile.id,
            avatar_url: user.avatar_url ?? ghProfile.avatar_url,
          })
          user = await db('users').where('id', user.id).first()
        } else {
          // New user — generate a unique handle from github login
          const baseHandle = ghProfile.login.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 48)
          let handle = baseHandle
          let suffix = 0
          while (await db('users').where('handle', handle).first()) {
            suffix++
            handle = `${baseHandle}_${suffix}`
          }

          const [newUser] = await db('users')
            .insert({
              handle,
              display_name: ghProfile.name ?? ghProfile.login,
              email:        primaryEmail,
              github_id:    ghProfile.id,
              avatar_url:   ghProfile.avatar_url,
              account_type: 'community',
              password_hash: null,
            })
            .returning(['id', 'handle', 'display_name', 'email', 'bio', 'avatar_url',
                        'account_type', 'trust_score', 'follower_count', 'following_count',
                        'signal_count', 'verified', 'onboarded', 'created_at'])

          user = newUser
          indexUser(user).catch(() => {})
        }
      }

      await db('users').where('id', user.id).update({ last_seen_at: new Date() })
      const tokens = await issueTokens(app, user.id)

      const params = new URLSearchParams({
        accessToken:  tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn:    String(tokens.expiresIn),
      })
      return reply.redirect(`${frontendUrl}/auth/github/callback?${params.toString()}`, 302)

    } catch (err) {
      app.log.error({ err }, 'GitHub OAuth callback error')
      return reply.redirect(errorRedirect, 302)
    }
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
        return sendError(reply, 401, 'UNAUTHORIZED', 'Unauthorized')
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

    if (!user) return sendError(reply, 404, 'NOT_FOUND', 'User not found')
    return reply.send({ success: true, data: formatUser(user) })
  })
}

// ─── HELPERS ─────────────────────────────────────────────────────────────
async function issueTokens(app: Parameters<FastifyPluginAsync>[0], userId: string): Promise<AuthTokens> {
  const accessToken  = app.jwt.sign({ id: userId }, { expiresIn: '24h' })
  const refreshToken = crypto.randomUUID()

  // Store refresh token in Redis (30 days)
  await redis.setex(`refresh:${refreshToken}`, 30 * 24 * 60 * 60, userId)

  return { accessToken, refreshToken, expiresIn: 24 * 60 * 60 }
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
