'use client'

/**
 * App-level error boundary — catches errors within layouts/pages.
 * Reports to Sentry if configured, then shows a recovery UI.
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/error
 */

import { useEffect } from 'react'
import { captureException } from '@/lib/sentry'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    captureException(error, {
      tags: { boundary: 'app-error' },
      extra: { digest: error.digest },
    })
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
        <svg
          className="w-6 h-6 text-red-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
          />
        </svg>
      </div>

      <h2 className="text-xl font-semibold text-white mb-2">
        Something went wrong
      </h2>
      <p className="text-sm text-gray-400 mb-6 max-w-sm">
        An unexpected error occurred. The issue has been logged and our team will look into it.
      </p>

      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-5 py-2.5 bg-amber-500 text-gray-900 rounded-lg text-sm font-semibold hover:bg-amber-400 transition-colors"
        >
          Try again
        </button>
        <a
          href="/"
          className="px-5 py-2.5 bg-gray-800 text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
        >
          Go home
        </a>
      </div>

      {process.env.NODE_ENV === 'development' && (
        <details className="mt-8 max-w-lg text-left">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
            Error details (dev only)
          </summary>
          <pre className="mt-2 p-3 bg-gray-900 rounded-lg text-xs text-red-300 overflow-auto max-h-48">
            {error.message}
            {error.stack && `\n\n${error.stack}`}
          </pre>
        </details>
      )}
    </div>
  )
}
