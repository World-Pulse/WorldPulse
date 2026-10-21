import type { Metadata } from 'next'
import Link from 'next/link'
import { pageMetadata } from '@/lib/page-metadata'
import { LinkChecker } from '@/components/check/LinkChecker'

// "Paste a link, get the count" (Devon, Oct 20, 2026: "ok to start with 1";
// Oct 21, version 2: "Yes, with safeguards"): how many outlets reported the
// story behind a news link someone shared. The form asks
// GET /api/v1/stories/by-link from the visitor's browser (lib/link-check.ts).
export const metadata: Metadata = pageMetadata({
  path: '/check',
  title: 'Has more than one newsroom reported this? Check a link',
  description: 'Paste a news article’s link: WorldPulse shows how many independent outlets reported its story, which ones, and whether it is verified. Free, no sign-up.',
})

export default function CheckPage() {
  return (
    <div className="min-h-screen bg-wp-bg text-wp-text">
      <main className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-wp-text text-balance">Has more than one newsroom reported this?</h1>
        <p className="text-sm text-wp-text2 mt-2 mb-6 leading-relaxed">
          Paste the link of a news article someone shared. WorldPulse shows how many independent outlets (websites) reported its story, which ones, and whether it is verified.
        </p>
        <LinkChecker />
        <h2 className="text-base font-semibold text-wp-text mt-10">What this can and can’t tell you</h2>
        <ul className="list-disc pl-5 mt-2 space-y-2 text-sm text-wp-text2 leading-relaxed">
          <li>It looks among the articles WorldPulse has collected in the last two weeks. If the link isn’t among them, WorldPulse opens that page once, only to read its headline (public web pages only), and looks for a story from around when it was published that seems to tell the same event; such a match says so, so you can compare them.</li>
          <li>“Verified” means two or more outlets reported the story and its reliability score reached 65%: more than one outlet says so, not proven true.</li>
          <li>Websites, not owners, are counted, and a wire story rewritten under a new headline may count more than once.</li>
        </ul>
        <p className="text-sm text-wp-text2 mt-8 leading-relaxed">
          <Link href="/how-we-count" className="text-wp-amber underline">How we count</Link>
          {' · '}
          <Link href="/week" className="text-wp-amber underline">This week’s top stories</Link>
          {' · '}
          <Link href="/developers#mcp" className="text-wp-amber underline">Check links from an AI assistant</Link>
        </p>
      </main>
    </div>
  )
}
