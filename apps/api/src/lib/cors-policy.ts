/**
 * Which websites may read the API's answers from a visitor's browser (CORS),
 * per request (plan V3b, Oct 20, 2026).
 *
 * Until now any request carrying another website's Origin header answered 500
 * "Something went wrong on our side": the allowlist check threw an error,
 * which the error handler turned into a 500, on every route, the "no signup
 * needed" public endpoint, its preflight and the WebSocket included. So the
 * developers page's browser examples couldn't work from any other site, and
 * each refusal was logged as a server error.
 *
 * Now:
 * - the site's own addresses (and calls with no Origin: servers, scripts,
 *   apps) are answered as before: the origin echoed, with credentials;
 * - the public reads (GET, HEAD and their preflight on the paths below) are
 *   open to every website, without credentials (the API keeps no cookies;
 *   a token or key a page sends is that page's own);
 * - any other website on any other route is answered normally but without
 *   CORS headers, so the browser keeps the answer from that page; never a 500.
 */

export interface CorsDecision {
  origin: boolean | string
  credentials?: boolean
  methods?: string[]
  exposedHeaders?: string[]
  maxAge?: number
}

/** Paths any website may read from a browser (GET and HEAD) */
const PUBLIC_READ_PREFIXES = [
  '/api/v1/public/',
  '/api/v1/rss/',
  '/api/v1/signals',
  '/api/v1/stories',
  '/api/v1/countries',
  '/api/v1/search',
  '/api/v1/feed/global',
  '/api/v1/feed/trending',
  '/ws',
]

/** Rate-limit headers a page on another site may read (browsers hide headers that aren't listed) */
const EXPOSED = ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after']

const READ_METHODS = new Set(['GET', 'HEAD'])

/** Whether a request is one of the public reads (a preflight counts when it asks for GET or HEAD) */
export function isPublicRead(method: string, url: string, preflightMethod?: string): boolean {
  const path = url.split('?')[0] ?? ''
  const onPath = PUBLIC_READ_PREFIXES.some(p => (p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)))
  if (!onPath) return false
  const m = method.toUpperCase()
  if (READ_METHODS.has(m)) return true
  return m === 'OPTIONS' && READ_METHODS.has((preflightMethod ?? '').toUpperCase())
}

export function corsDecision(
  req: { method: string; url: string; headers: Record<string, string | string[] | undefined> },
  allowedOrigins: readonly string[],
): CorsDecision {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
  if (!origin || origin === 'null' || allowedOrigins.includes(origin)) return { origin: true, credentials: true }
  const asked = req.headers['access-control-request-method']
  if (isPublicRead(req.method, req.url, typeof asked === 'string' ? asked : undefined)) {
    return { origin: '*', credentials: false, methods: ['GET', 'HEAD', 'OPTIONS'], exposedHeaders: EXPOSED, maxAge: 86_400 }
  }
  return { origin: false }
}
