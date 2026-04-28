import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { authenticate } from '../middleware/auth'
import { z } from 'zod'
import { logger } from '../lib/logger'
import { notificationService } from '../lib/notifications'
import type { AlertSettings } from '../lib/alert-dispatcher'
import { sendAlertEmail } from '../lib/email'
import type { Signal } from '@worldpulse/types'
import { sendError } from '../lib/errors'

// ─── Alert Settings Schemas ───────────────────────────────────────────────

const AlertSettingsSchema = z.object({
  telegram_chat_id:      z.string().min(1).max(64).optional(),
  telegram_bot_token:    z.string().min(10).max(256).optional(),
  discord_webhook_url:   z.string().url().optional(),
  slack_webhook_url:     z.string().url().optional(),
  ms_teams_webhook_url:  z.string().url().optional(),
  email_address:         z.string().email().optional(),
  min_severity:          z.enum(['critical', 'high', 'medium', 'low']),
  categories:            z.array(z.string()).default([]),
  enabled:               z.boolean(),
})

function alertSettingsKey(userId: string): string {
  return `notif:${userId}:settings`
}

// ─── Test signal fixture ──────────────────────────────────────────────────

function makeTestSignal(): Signal {
  return {
    id:               'test-signal-0000',
    title:            'WorldPulse Test Alert — Notification Setup Verified',
    summary:          'This is a test notification from WorldPulse. Your alert channel is configured correctly.',
    body:             null,
    category:         'breaking',
    severity:         'high',
    status:           'verified',
    reliabilityScore: 0.95,
    alertTier:        'PRIORITY',
    sourceCount:      1,
    location:         null,
    locationName:     null,
    countryCode:      null,
    region:           null,
    tags:             ['test'],
    sources:          [],
    originalUrls:     ['https://worldpulse.io'],
    language:         'en',
    viewCount:        0,
    shareCount:       0,
    postCount:        0,
    eventTime:        null,
    firstReported:    new Date().toISOString(),
    verifiedAt:       new Date().toISOString(),
    lastUpdated:      new Date().toISOString(),
    createdAt:        new Date().toISOString(),
    isBreaking:       true,
  }
}

// ─── Device Token Schemas ─────────────────────────────────────────────────

const DeviceTokenSchema = z.object({
  token:    z.string().min(10).max(512),
  platform: z.enum(['expo', 'fcm', 'apns']).default('expo'),
})

const DeleteDeviceTokenSchema = z.object({
  token: z.string().min(10).max(512),
})

const MarkReadSchema = z.object({
  ids: z.array(z.string().uuid()).max(200).optional(),
})

export const registerNotificationRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['notifications']
  })

  // ─── REGISTER DEVICE TOKEN ────────────────────────────────
  app.post('/device-token', { preHandler: [authenticate] }, async (req, reply) => {
    const body = DeviceTokenSchema.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid input',
        details: body.error.flatten().fieldErrors,
        code: 'VALIDATION_ERROR',
      })
    }

    const { token, platform } = body.data
    const userId = req.user!.id

    // Upsert device token
    await db('device_push_tokens')
      .insert({
        user_id:  userId,
        token,
        platform,
        active:   true,
      })
      .onConflict(['user_id', 'token'])
      .merge({ active: true, updated_at: new Date() })

    logger.debug({ userId, platform }, 'Device push token registered')

    return reply.status(201).send({
      success: true,
      message: 'Device token registered',
    })
  })

  // ─── DEREGISTER DEVICE TOKEN ──────────────────────────────
  app.delete('/device-token', { preHandler: [authenticate] }, async (req, reply) => {
    const parsed = DeleteDeviceTokenSchema.safeParse(req.body)
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Token is required')
    }
    const { token } = parsed.data

    await db('device_push_tokens')
      .where('user_id', req.user!.id)
      .where('token', token)
      .update({ active: false, updated_at: new Date() })

    return reply.send({ success: true, message: 'Device token deregistered' })
  })

  // ─── LIST NOTIFICATIONS ───────────────────────────────────
  app.get('/', { preHandler: [authenticate] }, async (req, reply) => {
    const { limit = 30, cursor } = req.query as { limit?: number; cursor?: string }

    let query = db('notifications as n')
      .leftJoin('users as actor', 'n.actor_id', 'actor.id')
      .where('n.user_id', req.user!.id)
      .orderBy('n.created_at', 'desc')
      .limit(Math.min(Number(limit), 100) + 1)
      .select([
        'n.id', 'n.type', 'n.payload', 'n.read', 'n.created_at',
        'n.post_id', 'n.signal_id',
        'actor.handle as actor_handle',
        'actor.display_name as actor_display_name',
        'actor.avatar_url as actor_avatar',
      ])

    if (cursor) {
      const cur = await db('notifications').where('id', cursor).first('created_at')
      if (cur) query = query.where('n.created_at', '<', cur.created_at)
    }

    const rows = await query
    const pageLimit = Math.min(Number(limit), 100)
    const hasMore = rows.length > pageLimit
    const items = hasMore ? rows.slice(0, pageLimit) : rows

    return reply.send({
      success: true,
      data: {
        items,
        cursor: hasMore ? items[items.length - 1].id : null,
        hasMore,
      },
    })
  })

  // ─── MARK AS READ ─────────────────────────────────────────
  app.patch('/read', { preHandler: [authenticate] }, async (req, reply) => {
    const parsed = MarkReadSchema.safeParse(req.body)
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Invalid input')
    }
    const { ids } = parsed.data

    let query = db('notifications').where('user_id', req.user!.id)
    if (ids && ids.length > 0) {
      query = query.whereIn('id', ids)
    }

    await query.update({ read: true })

    return reply.send({ success: true, message: 'Notifications marked as read' })
  })

  // ─── UNREAD COUNT ─────────────────────────────────────────
  app.get('/unread-count', { preHandler: [authenticate] }, async (req, reply) => {
    const result = await db('notifications')
      .where('user_id', req.user!.id)
      .where('read', false)
      .count('id as count')
      .first()

    return reply.send({ success: true, data: { count: Number(result?.count ?? 0) } })
  })

  // ─── ALERT SETTINGS: GET ──────────────────────────────────
  app.get('/settings', {
    preHandler: [authenticate],
    schema: {
      summary: 'Get Telegram/Discord/Slack/Teams/Email alert settings',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const raw = await redis.get(alertSettingsKey(req.user!.id)).catch(() => null)
    const settings: Partial<AlertSettings> = raw ? (JSON.parse(raw) as AlertSettings) : {}

    // Mask secrets in the response
    const maskedEmail = settings.email_address
      ? `***@${settings.email_address.split('@')[1] ?? '***'}`
      : null

    return reply.send({
      success: true,
      data: {
        telegram_chat_id:     settings.telegram_chat_id     ?? null,
        telegram_bot_token:   settings.telegram_bot_token   ? '***' : null,
        discord_webhook_url:  settings.discord_webhook_url  ? '***' : null,
        slack_webhook_url:    settings.slack_webhook_url    ? '***' : null,
        ms_teams_webhook_url: settings.ms_teams_webhook_url ? '***' : null,
        email_address:        maskedEmail,
        min_severity:         settings.min_severity ?? 'high',
        categories:           settings.categories   ?? [],
        enabled:              settings.enabled      ?? false,
      },
    })
  })

  // ─── ALERT SETTINGS: PUT ──────────────────────────────────
  app.put('/settings', {
    preHandler: [authenticate],
    schema: {
      summary: 'Save Telegram/Discord/Slack/Teams alert settings',
      body: {
        type: 'object',
        properties: {
          telegram_chat_id:     { type: 'string' },
          telegram_bot_token:   { type: 'string' },
          discord_webhook_url:  { type: 'string' },
          slack_webhook_url:    { type: 'string' },
          ms_teams_webhook_url: { type: 'string' },
          min_severity:         { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          categories:           { type: 'array', items: { type: 'string' } },
          enabled:              { type: 'boolean' },
        },
        required: ['min_severity', 'enabled'],
      },
    },
  }, async (req, reply) => {
    const parsed = AlertSettingsSchema.safeParse(req.body)
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input')
    }

    const userId = req.user!.id
    const key    = alertSettingsKey(userId)

    // Merge with existing (preserves masked secrets if client sends ***)
    const existingRaw = await redis.get(key).catch(() => null)
    const existing: Partial<AlertSettings> = existingRaw
      ? (JSON.parse(existingRaw) as AlertSettings)
      : {}

    const incoming = parsed.data

    const settings: AlertSettings = {
      telegram_chat_id: incoming.telegram_chat_id ?? existing.telegram_chat_id,
      telegram_bot_token:
        incoming.telegram_bot_token && incoming.telegram_bot_token !== '***'
          ? incoming.telegram_bot_token
          : existing.telegram_bot_token,
      discord_webhook_url:
        incoming.discord_webhook_url && incoming.discord_webhook_url !== '***'
          ? incoming.discord_webhook_url
          : existing.discord_webhook_url,
      slack_webhook_url:
        incoming.slack_webhook_url && incoming.slack_webhook_url !== '***'
          ? incoming.slack_webhook_url
          : existing.slack_webhook_url,
      ms_teams_webhook_url:
        incoming.ms_teams_webhook_url && incoming.ms_teams_webhook_url !== '***'
          ? incoming.ms_teams_webhook_url
          : existing.ms_teams_webhook_url,
      email_address:
        incoming.email_address !== undefined
          ? incoming.email_address
          : existing.email_address,
      min_severity: incoming.min_severity,
      categories:   incoming.categories,
      enabled:      incoming.enabled,
    }

    await redis.set(key, JSON.stringify(settings))

    logger.debug({ userId }, 'Alert settings updated')

    return reply.send({ success: true, message: 'Alert settings saved' })
  })

  // ─── SEND TEST NOTIFICATION ───────────────────────────────
  app.post('/test', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    schema: {
      summary: 'Send a test alert to all configured channels (Telegram/Discord/Slack/Teams)',
    },
  }, async (req, reply) => {
    const userId = req.user!.id
    const raw    = await redis.get(alertSettingsKey(userId)).catch(() => null)

    if (!raw) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'No alert settings configured. Save your settings first.')
    }

    const settings = JSON.parse(raw) as AlertSettings

    if (!settings.enabled) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Alerts are disabled. Enable them in your settings.')
    }

    const hasTelegram = !!(settings.telegram_chat_id && settings.telegram_bot_token)
    const hasDiscord  = !!settings.discord_webhook_url
    const hasSlack    = !!settings.slack_webhook_url
    const hasTeams    = !!settings.ms_teams_webhook_url
    const hasEmail    = !!settings.email_address

    if (!hasTelegram && !hasDiscord && !hasSlack && !hasTeams && !hasEmail) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'No channels configured. Add a Telegram chat, Discord webhook, Slack webhook, Teams webhook, or email address.')
    }

    const testSignal = makeTestSignal()
    const promises: Promise<void>[] = []

    if (hasTelegram) {
      promises.push(
        notificationService.sendTelegramMessage(
          settings.telegram_chat_id!,
          notificationService.formatSignalAlert(testSignal),
          settings.telegram_bot_token!,
        ),
      )
    }

    if (hasDiscord) {
      promises.push(
        notificationService.sendDiscordMessage(settings.discord_webhook_url!, testSignal),
      )
    }

    if (hasSlack) {
      promises.push(
        notificationService.sendSlackMessage(settings.slack_webhook_url!, testSignal),
      )
    }

    if (hasTeams) {
      promises.push(
        notificationService.sendTeamsMessage(settings.ms_teams_webhook_url!, testSignal),
      )
    }

    if (hasEmail) {
      promises.push(sendAlertEmail(settings.email_address!, testSignal))
    }

    await Promise.allSettled(promises)

    const channelNames = [
      hasTelegram && 'Telegram',
      hasDiscord  && 'Discord',
      hasSlack    && 'Slack',
      hasTeams    && 'Microsoft Teams',
      hasEmail    && 'Email',
    ].filter(Boolean)

    logger.info({ userId, channels: channelNames }, 'Test notification dispatched')

    return reply.send({
      success: true,
      message: `Test notification sent to ${channelNames.join(' and ')}.`,
    })
  })
}
