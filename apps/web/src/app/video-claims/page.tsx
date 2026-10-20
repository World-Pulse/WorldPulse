import Link from 'next/link'

// Plan P15 (Oct 20, 2026): this page asked the API for video-claims routes that
// aren't served (apps/api/src/routes/video-claims.ts is not registered, and no
// pipeline collects video claims), so it showed an error. Until claims are collected it says so plainly; the dashboard waits in
// VideoClaimsDashboard.tsx. The menu link was already hidden, and the layout keeps it out of search.

export default function Page() {
  return (
    <div className="min-h-screen bg-wp-bg text-wp-text">
      <main className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-wp-text">Video claims</h1>
        <p className="text-sm text-wp-text2 mt-2 leading-relaxed">
          Checking claims made in videos is not running yet, so there is nothing to show here.
        </p>
        <p className="text-sm text-wp-text2 mt-4 leading-relaxed">
          Meanwhile, see the <Link href="/claims" className="text-wp-amber underline">claims made in the news</Link>,
          checked against what independent outlets report, or today’s <Link href="/briefing" className="text-wp-amber underline">verified stories</Link>.
        </p>
      </main>
    </div>
  )
}
