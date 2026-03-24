/**
 * Custom 404 page — renders outside of any locale/next-intl request context.
 * Keeping this simple avoids the "Couldn't find next-intl config file" error
 * that occurs when Next.js tries to statically prerender /_not-found using
 * the root layout's getLocale()/getMessages() calls.
 */

import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <h1 className="text-6xl font-bold text-wp-amber mb-4">404</h1>
      <p className="text-xl text-wp-text-muted mb-8">
        This signal couldn&apos;t be found.
      </p>
      <Link
        href="/"
        className="px-6 py-3 bg-wp-amber text-black font-semibold rounded-lg hover:bg-wp-amber/90 transition-colors"
      >
        Back to WorldPulse
      </Link>
    </div>
  )
}
