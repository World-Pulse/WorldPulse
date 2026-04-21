/**
 * Optional PostHog analytics integration.
 *
 * Gracefully skips if:
 *   - POSTHOG_API_KEY env var is not set
 *   - posthog-node package is not installed
 *
 * Usage:
 *   1. Add POSTHOG_API_KEY and POSTHOG_HOST to .env
 *   2. pnpm add posthog-node --filter @worldpulse/api
 *   3. Call initPostHog() once during bootstrap (before routes)
 *   4. Use captureEvent() anywhere in route handlers
 *   5. Call shutdownPostHog() during graceful shutdown
 */

type PostHogClient = {
  capture(payload: {
    distinctId: string
    event: string
    properties?: Record<string, unknown>
  }): void
  identify(payload: {
    distinctId: string
    properties?: Record<string, unknown>
  }): void
  shutdown(): Promise<void>
}

let _client: PostHogClient | null = null
let _initialized = false

function tryLoadPostHog(): { PostHog: new (key: string, opts: { host?: string; flushAt?: number; flushInterval?: number }) => PostHogClient } | null {
  try {
    // Dynamic require so the app starts even if posthog-node isn't installed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('posthog-node')
  } catch {
    return null
  }
}

/**
 * Initialize PostHog. Call once at startup.
 * No-op if POSTHOG_API_KEY is unset or posthog-node is not installed.
 */
export function initPostHog(): void {
  if (_initialized) return
  _initialized = true

  const apiKey = process.env.POSTHOG_API_KEY
  if (!apiKey) return

  const mod = tryLoadPostHog()
  if (!mod) {
    console.warn('[posthog] POSTHOG_API_KEY is set but posthog-node is not installed. Run: pnpm add posthog-node --filter @worldpulse/api')
    return
  }

  _client = new mod.PostHog(apiKey, {
    host: process.env.POSTHOG_HOST,
    flushAt: 20,
    flushInterval: 10000,
  })

  console.info('[posthog] Initialized')
}

/**
 * Capture an analytics event.
 * Safe to call even if PostHog is not initialized.
 *
 * @param distinctId - User ID or anonymous identifier (e.g. IP hash, session ID)
 * @param event      - Event name (snake_case)
 * @param properties - Optional key/value properties
 */
export function captureEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!_client) return
  try {
    _client.capture({ distinctId, event, properties })
  } catch {
    // Never let analytics crash the app
  }
}

/**
 * Identify / alias a user with named traits.
 * Safe to call even if PostHog is not initialized.
 */
export function identifyUser(
  distinctId: string,
  properties: Record<string, unknown>,
): void {
  if (!_client) return
  try {
    _client.identify({ distinctId, properties })
  } catch {
    // Never let analytics crash the app
  }
}

/**
 * Flush pending events and shut down the PostHog client.
 * Call during graceful shutdown.
 */
export async function shutdownPostHog(): Promise<void> {
  if (!_client) return
  await _client.shutdown()
}
