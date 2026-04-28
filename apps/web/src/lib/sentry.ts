/**
 * Sentry error tracking for WorldPulse web (Next.js).
 *
 * Gracefully skips if:
 *   - NEXT_PUBLIC_SENTRY_DSN env var is not set
 *
 * Usage:
 *   1. Add NEXT_PUBLIC_SENTRY_DSN=https://xxx@sentry.io/123 to .env
 *   2. pnpm add @sentry/nextjs --filter @worldpulse/web
 *   3. Client-side init happens automatically via sentry.client.config.ts
 *   4. Server-side init via sentry.server.config.ts
 *   5. Use captureException(err) anywhere in components/API routes
 *
 * Self-hosted alternative: Glitchtip (drop-in Sentry-compatible API).
 * Set NEXT_PUBLIC_SENTRY_DSN to your Glitchtip project DSN.
 */

const SENTRY_DSN = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_SENTRY_DSN ?? '')
  : (process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN ?? '')

const ENVIRONMENT = process.env.NODE_ENV ?? 'production'
const RELEASE = process.env.NEXT_PUBLIC_APP_VERSION
  ? `worldpulse-web@${process.env.NEXT_PUBLIC_APP_VERSION}`
  : undefined
const TRACES_SAMPLE_RATE = Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_RATE ?? 0.1)
const REPLAY_SAMPLE_RATE = Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY_RATE ?? 0.1)
const ERROR_REPLAY_RATE = Number(process.env.NEXT_PUBLIC_SENTRY_ERROR_REPLAY_RATE ?? 1.0)

export const sentryConfig = {
  dsn: SENTRY_DSN,
  environment: ENVIRONMENT,
  release: RELEASE,
  tracesSampleRate: TRACES_SAMPLE_RATE,
  replaySampleRate: REPLAY_SAMPLE_RATE,
  errorReplaySampleRate: ERROR_REPLAY_RATE,
  enabled: !!SENTRY_DSN,
} as const

// ─── Lightweight helpers (no SDK import) ────────────────────────────

let _sentryBrowser: {
  captureException(err: unknown, ctx?: Record<string, unknown>): string
  captureMessage(msg: string, level?: string): string
  setUser(user: { id?: string; email?: string } | null): void
  withScope(cb: (scope: { setTag(k: string, v: string): void }) => void): void
} | null = null

/**
 * Lazily resolve the @sentry/nextjs client module.
 * Returns null if the package is not installed.
 */
function getSentry(): typeof _sentryBrowser {
  if (_sentryBrowser) return _sentryBrowser
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _sentryBrowser = require('@sentry/nextjs')
    return _sentryBrowser
  } catch {
    return null
  }
}

/**
 * Capture an exception. Safe to call even if Sentry is not configured.
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!sentryConfig.enabled) return
  getSentry()?.captureException(err, context)
}

/**
 * Capture a message at a given severity level.
 */
export function captureMessage(
  msg: string,
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info',
): void {
  if (!sentryConfig.enabled) return
  getSentry()?.captureMessage(msg, level)
}

/**
 * Set the current user context for all subsequent Sentry events.
 */
export function setSentryUser(user: { id?: string; email?: string } | null): void {
  if (!sentryConfig.enabled) return
  getSentry()?.setUser(user)
}

/**
 * Tag all events within a scope.
 */
export function withSentryTag(key: string, value: string): void {
  if (!sentryConfig.enabled) return
  getSentry()?.withScope(scope => scope.setTag(key, value))
}
