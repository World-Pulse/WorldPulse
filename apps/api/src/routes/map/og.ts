/**
 * routes/map/og.ts — BAT-15
 * GET /api/v1/map/og?state=ENCODED
 *
 * Returns a 1200×630 SVG-based OG card for the given map state.
 * Cached 1h in Redis. Used by Next.js generateMetadata() for rich
 * social media previews on Twitter/Reddit/Slack.
 *
 * Design: dark background, WorldPulse branding, coordinate display,
 * signal count (fetched from DB), and active layers listed.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { redis } from '../../db/redis'
import { db } from '../../db/postgres'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PermalinkState {
  lat?: number
  lng?: number
  zoom?: number
  layers?: string[]
  timelineRange?: string
  signalId?: string
  basemap?: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CACHE_TTL_SECONDS = 3600  // 1 hour
const OG_WIDTH          = 1200
const OG_HEIGHT         = 630

// ─── Permalink decoder ───────────────────────────────────────────────────────

function decodeState(raw: string): PermalinkState {
  const result: PermalinkState = { layers: [] }
  const segments = raw.split('|')

  for (const seg of segments) {
    if (seg.startsWith('@')) {
      const parts = seg.slice(1).split(',')
      if (parts.length >= 3) {
        result.lat  = parseFloat(parts[0])
        result.lng  = parseFloat(parts[1])
        result.zoom = parseFloat(parts[2])
      }
    } else if (seg.startsWith('l=')) {
      result.layers = seg.slice(2).split(',').filter(Boolean)
    } else if (seg.startsWith('t=')) {
      result.timelineRange = seg.slice(2).split(':')[0]
    } else if (seg.startsWith('s=')) {
      result.signalId = decodeURIComponent(seg.slice(2))
    } else if (seg.startsWith('b=')) {
      result.basemap = seg.slice(2)
    }
  }

  return result
}

// ─── SVG builder ─────────────────────────────────────────────────────────────

function buildOgSvg(state: PermalinkState, signalCount: number): string {
  const lat  = state.lat  != null ? state.lat.toFixed(2)  : '0.00'
  const lng  = state.lng  != null ? state.lng.toFixed(2)  : '0.00'
  const zoom = state.zoom != null ? state.zoom.toFixed(0) : '2'

  const coordLabel = `${lat}°, ${lng}° · zoom ${zoom}`
  const countLabel = signalCount.toLocaleString('en-US')

  const layerEmojis: Record<string, string> = {
    wind: '💨', heat: '🔥', timeline: '⏱', adsb: '✈️',
    ships: '🚢', cameras: '📹', naval: '⚓', carriers: '🛡',
    threats: '⚠️', jamming: '📡', hazards: '🌋', sat: '🛰',
    'country-risk': '🗺',
  }

  const layers = (state.layers ?? [])
    .slice(0, 6)
    .map(k => layerEmojis[k] ?? k)
    .join('  ')

  // Generate simple grid pattern for background texture
  const gridLines = Array.from({ length: 12 }, (_, i) => {
    const x = (i * OG_WIDTH / 11).toFixed(0)
    return `<line x1="${x}" y1="0" x2="${x}" y2="${OG_HEIGHT}" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>`
  }).join('') + Array.from({ length: 7 }, (_, i) => {
    const y = (i * OG_HEIGHT / 6).toFixed(0)
    return `<line x1="0" y1="${y}" x2="${OG_WIDTH}" y2="${y}" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <radialGradient id="g1" cx="30%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#0d2033"/>
      <stop offset="100%" stop-color="#06070d"/>
    </radialGradient>
    <radialGradient id="g2" cx="70%" cy="60%" r="50%">
      <stop offset="0%" stop-color="#0a1a1a" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="transparent" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#g1)"/>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#g2)"/>
  ${gridLines}

  <!-- Top accent bar -->
  <rect x="0" y="0" width="${OG_WIDTH}" height="4" fill="#f59e0b"/>

  <!-- WorldPulse logo area -->
  <circle cx="80" cy="100" r="26" fill="none" stroke="#f59e0b" stroke-width="2" opacity="0.9"/>
  <circle cx="80" cy="100" r="16" fill="none" stroke="#f59e0b" stroke-width="1.5" opacity="0.5"/>
  <circle cx="80" cy="100" r="6"  fill="#f59e0b" opacity="0.9"/>
  <line x1="54" y1="100" x2="106" y2="100" stroke="#f59e0b" stroke-width="1" opacity="0.4"/>
  <line x1="80"  y1="74"  x2="80"  y2="126"  stroke="#f59e0b" stroke-width="1" opacity="0.4"/>

  <!-- WORLDPULSE wordmark -->
  <text x="122" y="95" font-family="'Courier New', Courier, monospace" font-size="32" font-weight="700" fill="#f59e0b" letter-spacing="4">WORLDPULSE</text>
  <text x="124" y="120" font-family="'Courier New', Courier, monospace" font-size="13" fill="#8892a4" letter-spacing="3">GLOBAL INTELLIGENCE NETWORK</text>

  <!-- Divider -->
  <line x1="60" y1="158" x2="1140" y2="158" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>

  <!-- Signal count hero -->
  <text x="60" y="290" font-family="'Courier New', Courier, monospace" font-size="90" font-weight="700" fill="white" opacity="0.95">${countLabel}</text>
  <text x="62" y="340" font-family="'Courier New', Courier, monospace" font-size="18" fill="#8892a4" letter-spacing="2">INTELLIGENCE SIGNALS TRACKED</text>

  <!-- Coordinates -->
  <text x="60" y="410" font-family="'Courier New', Courier, monospace" font-size="20" fill="#67e8f9" letter-spacing="1">${coordLabel}</text>

  <!-- Active layers -->
  ${layers ? `<text x="60" y="455" font-family="'Courier New', Courier, monospace" font-size="22">${layers}</text>` : ''}

  <!-- Timeline badge -->
  ${state.timelineRange ? `
  <rect x="60" y="475" width="140" height="30" rx="6" fill="rgba(168,85,247,0.2)" stroke="rgba(168,85,247,0.4)" stroke-width="1"/>
  <text x="130" y="495" text-anchor="middle" font-family="'Courier New', Courier, monospace" font-size="13" fill="#c084fc">⏱ ${state.timelineRange.toUpperCase()}</text>
  ` : ''}

  <!-- Bottom domain -->
  <text x="1140" y="600" text-anchor="end" font-family="'Courier New', Courier, monospace" font-size="18" fill="#8892a4" opacity="0.8">world-pulse.io</text>

  <!-- LIVE indicator -->
  <circle cx="1080" cy="66" r="6" fill="#22c55e">
    <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite"/>
  </circle>
  <text x="1095" y="71" font-family="'Courier New', Courier, monospace" font-size="14" fill="#22c55e">LIVE</text>
</svg>`
}

// ─── Route ────────────────────────────────────────────────────────────────────

export const registerMapOgRoutes: FastifyPluginAsync = async (app) => {
  app.get('/og', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    schema: {
      querystring: {
        type: 'object',
        properties: {
          state: { type: 'string', maxLength: 512 },
        },
      },
    },
  }, async (req: FastifyRequest<{ Querystring: { state?: string } }>, reply: FastifyReply) => {
    const rawState = (req.query.state ?? '').trim()
    const cacheKey = `map:og:${rawState.slice(0, 200)}`

    // Try Redis cache first
    if (rawState) {
      const cached = await redis.get(cacheKey)
      if (cached) {
        return reply
          .header('Content-Type', 'image/svg+xml')
          .header('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`)
          .header('X-Cache', 'HIT')
          .send(cached)
      }
    }

    // Parse state
    const state = rawState ? decodeState(rawState) : {}

    // Fetch live signal count from DB
    let signalCount = 0
    try {
      const row = await db
        .selectFrom('signals as s')
        .select(({ fn }) => [fn.count<number>('s.id').as('n')])
        .where('s.status', '!=', 'deleted')
        .executeTakeFirst()
      signalCount = Number(row?.n ?? 0)
    } catch {
      // Non-fatal — use 0
    }

    const svg = buildOgSvg(state, signalCount)

    // Cache in Redis
    if (rawState) {
      await redis.set(cacheKey, svg, 'EX', CACHE_TTL_SECONDS).catch(() => {})
    }

    return reply
      .header('Content-Type', 'image/svg+xml')
      .header('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`)
      .header('X-Cache', 'MISS')
      .send(svg)
  })
}
