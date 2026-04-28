/**
 * Sentry client-side configuration for WorldPulse web.
 *
 * This file is automatically loaded by @sentry/nextjs when installed.
 * If @sentry/nextjs is not installed or NEXT_PUBLIC_SENTRY_DSN is unset,
 * nothing happens — the app works normally without error tracking.
 *
 * @see https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

import { sentryConfig } from './src/lib/sentry'

async function initClientSentry(): Promise<void> {
  if (!sentryConfig.enabled) return

  try {
    const Sentry = await import('@sentry/nextjs')

    Sentry.init({
      dsn: sentryConfig.dsn,
      environment: sentryConfig.environment,
      release: sentryConfig.release,

      // Performance monitoring
      tracesSampleRate: sentryConfig.tracesSampleRate,

      // Session replay — captures DOM for error reproduction
      replaysSessionSampleRate: sentryConfig.replaySampleRate,
      replaysOnErrorSampleRate: sentryConfig.errorReplaySampleRate,

      // Integrations
      integrations: [
        Sentry.replayIntegration({
          // Privacy: mask all text and block all media by default
          maskAllText: true,
          blockAllMedia: true,
        }),
        Sentry.browserTracingIntegration(),
      ],

      // Ignore noisy client errors
      ignoreErrors: [
        // Browser extensions
        'ResizeObserver loop',
        'ResizeObserver loop limit exceeded',
        // Network errors users can't control
        'Failed to fetch',
        'Load failed',
        'NetworkError',
        'ChunkLoadError',
        // Next.js hydration noise
        'Minified React error',
        'Hydration failed',
        'Text content does not match',
      ],

      // Don't send events from dev tools or extensions
      denyUrls: [
        /extensions\//i,
        /^chrome:\/\//i,
        /^moz-extension:\/\//i,
      ],

      beforeSend(event) {
        // Strip PII from breadcrumbs
        if (event.breadcrumbs) {
          event.breadcrumbs = event.breadcrumbs.map(b => {
            if (b.category === 'xhr' || b.category === 'fetch') {
              // Redact auth headers from network breadcrumbs
              if (b.data?.['url']) {
                const url = String(b.data['url'])
                if (url.includes('token=') || url.includes('key=')) {
                  b.data['url'] = url.replace(/([?&])(token|key|secret)=[^&]*/gi, '$1$2=[REDACTED]')
                }
              }
            }
            return b
          })
        }
        return event
      },
    })

    console.info(`[sentry:client] Initialized — environment: ${sentryConfig.environment}`)
  } catch {
    // @sentry/nextjs not installed — graceful no-op
  }
}

initClientSentry()
