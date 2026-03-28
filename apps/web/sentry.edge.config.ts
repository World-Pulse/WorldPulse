/**
 * Sentry edge runtime configuration for WorldPulse web.
 *
 * Used by Next.js middleware and edge API routes.
 * If @sentry/nextjs is not installed or SENTRY_DSN is unset, nothing happens.
 *
 * @see https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

import { sentryConfig } from './src/lib/sentry'

async function initEdgeSentry(): Promise<void> {
  if (!sentryConfig.enabled) return

  try {
    const Sentry = await import('@sentry/nextjs')

    Sentry.init({
      dsn: sentryConfig.dsn,
      environment: sentryConfig.environment,
      release: sentryConfig.release,
      tracesSampleRate: sentryConfig.tracesSampleRate,
    })

    console.info(`[sentry:edge] Initialized — environment: ${sentryConfig.environment}`)
  } catch {
    // @sentry/nextjs not installed — graceful no-op
  }
}

initEdgeSentry()
