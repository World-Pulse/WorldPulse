/**
 * Optional Sentry error tracking integration.
 *
 * Gracefully skips if:
 *   - SENTRY_DSN env var is not set
 *   - @sentry/node package is not installed
 *
 * Usage:
 *   1. Add SENTRY_DSN=https://xxx@sentry.io/123 to .env
 *   2. pnpm add @sentry/node --filter @worldpulse/api
 *   3. Call initSentry() once during bootstrap (before routes)
 *   4. Use captureException(err) anywhere in route handlers
 *
 * Self-hosted alternative: Glitchtip (drop-in Sentry-compatible API).
 * Set SENTRY_DSN to your Glitchtip project DSN.
 */

type SentryNode = {
  init(opts: { dsn: string; environment: string; release?: string; tracesSampleRate?: number }): void
  captureException(err: unknown, context?: Record<string, unknown>): string
  captureMessage(msg: string, level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug'): string
  withScope(cb: (scope: { setTag(k: string, v: string): void; setUser(u: { id?: string }): void }) => void): void
  flush(timeout?: number): Promise<boolean>
}

let _sentry: SentryNode | null = null
let _initialized = false

function tryLoadSentry(): SentryNode | null {
  try {
    // Dynamic require so the app starts even if @sentry/node isn't installed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@sentry/node') as SentryNode
  } catch {
    return null
  }
}

/**
 * Initialize Sentry. Call once at startup.
 * No-op if SENTRY_DSN is unset or @sentry/node is not installed.
 */
export function initSentry(): void {
  if (_initialized) return
  _initialized = true

  const dsn = process.env.SENTRY_DSN
  if (!dsn) return

  const sentry = tryLoadSentry()
  if (!sentry) {
    console.warn('[sentry] SENTRY_DSN is set but @sentry/node is not installed. Run: pnpm add @sentry/node --filter @worldpulse/api')
    return
  }

  sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    release:     process.env.npm_package_version ? `worldpulse@${process.env.npm_package_version}` : undefined,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  })

  _sentry = sentry
  console.info(`[sentry] Initialized — environment: ${process.env.NODE_ENV ?? 'production'}`)
}

/**
 * Capture an exception and forward to Sentry.
 * Safe to call even if Sentry is not initialized.
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!_sentry) return
  _sentry.captureException(err, context)
}

/**
 * Capture a message and forward to Sentry.
 */
export function captureMessage(msg: string, level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info'): void {
  if (!_sentry) return
  _sentry.captureMessage(msg, level)
}

/**
 * Set request-scoped user context on Sentry.
 */
export function setSentryUser(userId: string): void {
  if (!_sentry) return
  _sentry.withScope(scope => scope.setUser({ id: userId }))
}

/**
 * Flush pending Sentry events before shutdown.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!_sentry) return
  await _sentry.flush(timeoutMs)
}
