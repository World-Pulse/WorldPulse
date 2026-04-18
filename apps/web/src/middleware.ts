import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Content-Security-Policy
// 'unsafe-inline' on script-src is required by Next.js for inline scripts / hydration.
// Tighten with nonces in a future pass once Next.js nonce support is stable.
//
// localhost:3001 / ws://localhost:3001 are ONLY included in development builds.
// Production deployments (Vercel, Docker) must not expose localhost origins in CSP —
// this was the same class of leak fixed in next.config.mjs (Cycle 27).
const isDev = process.env.NODE_ENV !== 'production'

function buildCspDirectives(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    // Allow API, WebSocket, map tile, and analytics connections
    [
      "connect-src 'self'",
      'https://api.world-pulse.io',
      'wss://api.world-pulse.io',
      ...(isDev ? ['http://localhost:3001', 'ws://localhost:3001'] : []),
      'https://tile.openstreetmap.org',
      'https://server.arcgisonline.com',
      'https://*.maptiler.com',
      'https://fonts.openmaptiles.org',
      'https://gibs.earthdata.nasa.gov',
      'https://www.googletagmanager.com',
      'https://www.google-analytics.com',
      'https://*.google-analytics.com',
      'https://*.analytics.google.com',
    ].join(' '),
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join('; ')
}

/** Routes that must be embeddable in third-party iframes. */
const EMBED_PATHS = ['/embed']

function isEmbedRoute(pathname: string): boolean {
  return EMBED_PATHS.some(p => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p + '?'))
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl
  const isEmbed = isEmbedRoute(pathname)
  const res = NextResponse.next()

  if (isEmbed) {
    // Allow any origin to embed the widget iframe
    res.headers.set('Access-Control-Allow-Origin', '*')
    res.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type')
    // Remove clickjacking protection so the iframe can render
    res.headers.delete('X-Frame-Options')
    // Override CSP to allow any frame-ancestor and connect to the API.
    // localhost origins are only included in development (same guard as main CSP).
    const embedCsp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: https:",
      [
        "connect-src 'self'",
        'https://api.world-pulse.io',
        'wss://api.world-pulse.io',
        ...(isDev ? ['http://localhost:3001', 'ws://localhost:3001'] : []),
      ].join(' '),
      "frame-ancestors *",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; ')
    res.headers.set('Content-Security-Policy', embedCsp)
    res.headers.set('X-Content-Type-Options', 'nosniff')
    return res
  }

  // Prevent clickjacking
  res.headers.set('X-Frame-Options', 'DENY')

  // Prevent MIME-type sniffing
  res.headers.set('X-Content-Type-Options', 'nosniff')

  // Control referrer information
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  // Restrict browser features
  res.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(self), payment=()',
  )

  // Content Security Policy
  res.headers.set('Content-Security-Policy', buildCspDirectives())

  // HSTS — only send over HTTPS in production to avoid breaking local HTTP dev
  if (process.env.NODE_ENV === 'production') {
    res.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    )
  }

  // XSS protection header (legacy browsers)
  res.headers.set('X-XSS-Protection', '1; mode=block')

  return res
}

// Apply to all routes except static assets and Next.js internals
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf)).*)',
  ],
}
