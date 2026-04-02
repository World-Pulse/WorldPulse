import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { WebSocket } from '@fastify/websocket'
import { redis } from '../db/redis'
import { db } from '../db/postgres'
import { logger } from '../lib/logger'
import { checkAndEmitBreakingAlert } from '../lib/breaking-alerts'
import { fireWebhooks } from '../lib/webhooks'
import { indexSignal } from '../lib/search'
import type { SignalInput } from '../lib/breaking-alerts'
import type { WSMessage, WSEventType } from '@worldpulse/types'

// ─── CONNECTION REGISTRY ─────────────────────────────────────────────────
interface WSClient {
  socket:       WebSocket
  userId:       string | null
  subscriptions: Set<string>  // categories, country codes, tags
  connectedAt:  Date
  lastPing:     Date
}

const clients = new Map<string, WSClient>()

/** Returns the number of active WebSocket connections (used by the status endpoint). */
export function getWsClientCount(): number {
  return clients.size
}

// ─── WEBSOCKET HANDLER ───────────────────────────────────────────────────
export const registerWSHandler: FastifyPluginAsync = async (app) => {

  app.get('/ws', { websocket: true }, async (socket: WebSocket, req: FastifyRequest) => {
    const clientId = crypto.randomUUID()

    // Auth (optional — anonymous connections get public events only)
    let userId: string | null = null
    try {
      const token = (req.query as { token?: string }).token
      if (token) {
        const decoded = app.jwt.verify<{ id: string }>(token)
        userId = decoded.id
      }
    } catch { /* anonymous */ }

    const client: WSClient = {
      socket,
      userId,
      subscriptions: new Set(['breaking', 'critical']),  // default subs
      connectedAt: new Date(),
      lastPing: new Date(),
    }

    clients.set(clientId, client)
    logger.debug({ clientId, userId, total: clients.size }, 'WS client connected')

    // Send welcome + current state
    send(socket, {
      event: 'ping',
      data: {
        clientId,
        authenticated: !!userId,
        serverTime: new Date().toISOString(),
        connectedClients: clients.size,
      },
    })

    // ─── INCOMING MESSAGES ─────────────────────────────────
    socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; payload?: unknown }
        
        switch (msg.type) {
          case 'subscribe': {
            const { channels } = msg.payload as { channels: string[] }
            channels.forEach(ch => client.subscriptions.add(ch))
            send(socket, { event: 'ping', data: { subscribed: [...client.subscriptions] } })
            break
          }
          case 'unsubscribe': {
            const { channels } = msg.payload as { channels: string[] }
            channels.forEach(ch => client.subscriptions.delete(ch))
            break
          }
          case 'pong': {
            client.lastPing = new Date()
            break
          }
        }
      } catch (e) {
        logger.warn({ clientId, e }, 'Invalid WS message')
      }
    })

    // ─── DISCONNECT ─────────────────────────────────────────
    socket.on('close', () => {
      clients.delete(clientId)
      logger.debug({ clientId, total: clients.size }, 'WS client disconnected')
    })

    socket.on('error', (err: Error) => {
      logger.error({ clientId, err }, 'WS socket error')
      clients.delete(clientId)
    })
  })
}

// ─── BROADCAST ENGINE ────────────────────────────────────────────────────
/**
 * Broadcast an event to all subscribed clients.
 * Called by internal services after publishing to Kafka.
 */
export function broadcast(
  event: WSEventType,
  data: unknown,
  filter?: {
    category?:   string
    country?:    string
    severity?:   string
    userIds?:    string[]
  }
) {
  const message: WSMessage = {
    event,
    data,
    timestamp: new Date().toISOString(),
    id: crypto.randomUUID(),
  }

  let sent = 0
  
  for (const [, client] of clients) {
    if (client.socket.readyState !== 1 /* OPEN */) continue

    // User-specific events
    if (filter?.userIds && filter.userIds.length > 0) {
      if (!client.userId || !filter.userIds.includes(client.userId)) continue
    }

    // Category/subscription filter
    if (filter?.category && !client.subscriptions.has(filter.category) && !client.subscriptions.has('all')) {
      // Always send critical/breaking regardless
      if (filter?.severity !== 'critical') continue
    }

    send(client.socket, message)
    sent++
  }

  logger.debug({ event, sent, total: clients.size }, 'Broadcast sent')
  return sent
}

// ─── REDIS PUB/SUB LISTENER ──────────────────────────────────────────────
// API instances subscribe to Redis to receive events from scraper/other services
export async function startRedisSubscriber() {
  const sub = redis.duplicate()
  
  await sub.subscribe(
    'wp:signal.new',
    'wp:signal.updated',
    'wp:post.new',
    'wp:trending.update',
    'wp:alert.trigger',
  )

  sub.on('message', (channel, message) => {
    try {
      const data = JSON.parse(message) as { event: WSEventType; payload: unknown; filter?: Record<string, unknown> }
      broadcast(data.event, data.payload, data.filter as Parameters<typeof broadcast>[2])

      // Evaluate new signals for breaking alert eligibility
      if (channel === 'wp:signal.new' && data.event === 'signal.new') {
        const signal = data.payload as SignalInput
        if (signal?.id && signal?.title) {
          checkAndEmitBreakingAlert(signal).catch((err) => {
            logger.warn({ err, signalId: signal.id }, 'Breaking alert check failed (non-fatal)')
          })
          // Fire outbound developer webhooks (non-blocking, best-effort)
          fireWebhooks('signal.new', signal as unknown as Record<string, unknown>).catch((err) => {
            logger.warn({ err, signalId: signal.id }, 'Webhook delivery failed (non-fatal)')
          })
          // Index the full signal in Meilisearch — scraper signals bypass the API
          // signals route, so we must index them here.  Fetch the full DB row so
          // all fields (summary, tags, language, etc.) are present in the index.
          db('signals').where('id', signal.id).first('*').then((row: Record<string, unknown> | undefined) => {
            if (row) indexSignal(row).catch(() => {})
          }).catch(() => {})

          // BAT-18: Increment Redis real-time signal counter (avoids DB COUNT(*) on
          // every /signals/count request).  Keys reset themselves when the count
          // endpoint is next queried and re-caches fresh DB values.
          redis.incr('signals:live:total').catch(() => {})
          redis.incr('signals:live:last_hour').catch(() => {})
          // Expire the hourly key after 65 minutes so it stays accurate
          redis.expire('signals:live:last_hour', 3900).catch(() => {})
        }
      }

      // Fire webhooks for alert.breaking events too
      if (channel === 'wp:alert.trigger' && data.event === 'alert.breaking') {
        fireWebhooks('alert.breaking', data.payload as Record<string, unknown>).catch((err) => {
          logger.warn({ err }, 'Webhook delivery for alert.breaking failed (non-fatal)')
        })
      }
    } catch (e) {
      logger.error({ channel, e }, 'Redis message parse error')
    }
  })

  logger.info('Redis pub/sub subscriber started')
}

// ─── HEARTBEAT ───────────────────────────────────────────────────────────
setInterval(() => {
  const now = new Date()
  for (const [id, client] of clients) {
    // Timeout stale connections (no pong in 60s)
    if (now.getTime() - client.lastPing.getTime() > 60_000) {
      logger.debug({ id }, 'Removing stale WS client')
      client.socket.close()
      clients.delete(id)
      continue
    }
    // Send ping
    if (client.socket.readyState === 1) {
      send(client.socket, {
        event: 'ping',
        data: { serverTime: now.toISOString(), connectedClients: clients.size },
      })
    }
  }
}, 30_000)

// ─── HELPERS ─────────────────────────────────────────────────────────────
function send(socket: WebSocket, data: unknown) {
  try {
    socket.send(JSON.stringify(data))
  } catch { /* ignore */ }
}

export function getConnectedCount() {
  return clients.size
}
