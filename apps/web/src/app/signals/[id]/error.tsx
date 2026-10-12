'use client'

/**
 * A story page that couldn't be loaded (the API didn't answer, or the page
 * failed). Says so plainly and offers to try again; never "not found".
 * Oct 12, 2026: while the server's disk was full, story pages told readers
 * and search engines the story didn't exist.
 */

import Link from 'next/link'
import { useEffect } from 'react'
import { captureException } from '@/lib/sentry'

export default function StoryError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    captureException(error, {
      tags: { boundary: 'story-error' },
      extra: { digest: error.digest },
    })
  }, [error])

  return (
    // Its own dark panel, like the story page, so it reads in both themes
    <div className="flex items-center justify-center min-h-[60vh] px-4 py-10">
      <div className="w-full max-w-md rounded-xl bg-wp-surface border border-wp-s3 px-6 py-10 text-center">
        <h1 className="text-xl font-semibold text-wp-text mb-2 text-balance">
          This story is briefly unavailable
        </h1>
        <p className="text-sm text-wp-text2 mb-6">
          WorldPulse couldn’t load it just now. The story is still here: try again in a minute.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <button
            onClick={() => retry()}
            className="px-5 py-2.5 bg-wp-amber text-black rounded-lg text-sm font-semibold hover:bg-wp-amber/90 transition-colors"
          >
            Try again
          </button>
          <Link
            href="/"
            className="px-5 py-2.5 border border-wp-text3 text-wp-text rounded-lg text-sm font-semibold hover:bg-wp-s2 transition-colors"
          >
            Latest news
          </Link>
        </div>
      </div>
    </div>
  )
}
