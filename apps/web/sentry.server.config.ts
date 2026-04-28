/**
 * Sentry server-side configuration for WorldPulse web.
 *
 * This file is automatically loaded by @sentry/nextjs on the server.
 * If @sentry/nextjs is not installed or SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN
 * is unset, nothing happens.
 *
 * @see https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

import { sentryConfig } from './src/lib/sentry'

async function initServerSentry(): Promise<void> {
  if (!sentryConfig.enabled) return

  try {
    const Sentry = await import('@sentry/nextjs')

    Sentry.init({
      dsn: sentryConfig.dsn,
      environment: sentryConfig.environment,
      release: sentryConfig.release,

      // Performance monitoring — lower rate on server to reduce overhead
      tracesSampleRate: sentryConfig.tracesSampleRate,

      // Ignore noisy server-side errors
      ignoreErrors: [
        'NEXT_NOT_FOUND',
        'NEXT_REDIRECT',
      ],
    })

    console.info(`[sentry:server] Initialized — environment: ${sentryConfig.environment}`)
  } catch {
    // @sentry/nextjs not installed — graceful no-op
  }
}

initServerSentry()
