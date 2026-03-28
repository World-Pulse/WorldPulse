'use client'

/**
 * Next.js global error boundary — catches errors in the root layout.
 * Reports to Sentry if configured, then shows a recovery UI.
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/error#global-errorjs
 */

import { useEffect } from 'react'
import { captureException } from '@/lib/sentry'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    captureException(error, {
      tags: { boundary: 'global-error' },
      extra: { digest: error.digest },
    })
  }, [error])

  return (
    <html lang="en">
      <body style={{
        margin: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#06070d',
        color: '#e0e0e0',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        <div style={{ textAlign: 'center', maxWidth: 480, padding: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#f59e0b', marginBottom: 8 }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 15, color: '#9ca3af', marginBottom: 24, lineHeight: 1.5 }}>
            WorldPulse encountered an unexpected error. Our team has been notified.
          </p>
          <button
            onClick={reset}
            style={{
              padding: '10px 24px',
              background: '#f59e0b',
              color: '#06070d',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
