import type { Metadata } from 'next'
import Link from 'next/link'
import { pageMetadata } from '@/lib/page-metadata'

export const metadata: Metadata = pageMetadata({
  path: '/help',
  title: 'Help & FAQ',
  description: 'What "verified" means, how the reliability score works and where WorldPulse gets its news.',
})

// Plain-language answers, checked against the code (Harbor's draft, plan C2)
const FAQ: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: 'What is WorldPulse?',
    a: 'WorldPulse collects news and open-source signals from around the world, checks how far each can be trusted, and shows them in a live feed, AI digests and a World Map.',
  },
  {
    q: 'Where does the news come from?',
    a: (
      <>
        From news outlets, wire services, government and institutional feeds and open data sources. Each report keeps a link to the original.
        The full list is on the <Link href="/sources" className="text-wp-amber underline">Sources page</Link>, and you can suggest one at{' '}
        <Link href="/sources/suggest" className="text-wp-amber underline">/sources/suggest</Link>.
      </>
    ),
  },
  {
    q: 'What does "verified" mean?',
    a: 'A story is marked verified when a second, independent outlet reports the same story. Reports from the same outlet, or copies of one article, don\'t count twice. An AI check then reads the reports and looks for contradictions on facts such as where, who and how many. Verified means "more than one outlet says so", not "proven true".',
  },
  {
    q: 'What is the reliability score?',
    a: 'A number from 0 to 100% for each report, built from how much we trust the outlet and how many different kinds of source report the same story. More independent outlets raise it; a single source keeps it low, and a single-source story can\'t be rated as severe as a corroborated one.',
  },
  {
    q: 'What is "pending"?',
    a: 'A report we have collected that no second outlet has confirmed yet. Treat it as a lead, not a fact.',
  },
  {
    q: 'Why does one story sometimes appear more than once?',
    a: 'Reports of the same event are grouped into one card in the feed. Grouping goes by headline wording, so now and then two cards describe one event. We are working on it.',
  },
  {
    q: 'Are the AI digests written by AI?',
    a: 'Yes. The digests and briefings are written by an AI model from the verified reports.',
  },
  {
    q: 'Is there an API?',
    a: (
      <>
        Yes. Sign in and create a key on <Link href="/developer" className="text-wp-amber underline">/developer</Link>; see{' '}
        <Link href="/pricing" className="text-wp-amber underline">Pricing</Link> for the plans.
      </>
    ),
  },
]

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-wp-bg text-wp-text">
      <main className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-wp-text">Help &amp; FAQ</h1>
        <p className="text-sm text-wp-text3 mt-1 mb-8">How to read what you see on WorldPulse.</p>
        <div className="space-y-6">
          {FAQ.map(item => (
            <section key={item.q}>
              <h2 className="text-base font-semibold text-wp-text">{item.q}</h2>
              <p className="text-sm text-wp-text2 mt-1 leading-relaxed">{item.a}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  )
}
