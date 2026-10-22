import type { Metadata } from 'next'
import Link from 'next/link'
import { pageMetadata, faqJsonLd, jsonLdText } from '@/lib/page-metadata'

export const metadata: Metadata = pageMetadata({
  path: '/help',
  title: 'Help & FAQ',
  description: 'What "verified" means, how the reliability score works and where WorldPulse gets its news.',
})

// Plain-language answers, checked against the code (Harbor's draft, plan C2).
// `text`: an answer with links, in plain words, for the structured data search
// engines and AI assistants read (K2a, Oct 21, 2026)
const FAQ: Array<{ q: string; a: React.ReactNode; text?: string }> = [
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
    text: 'From news outlets, wire services, government and institutional feeds and open data sources. Each report keeps a link to the original. The full list is on the Sources page (world-pulse.io/sources), and you can suggest one at world-pulse.io/sources/suggest.',
  },
  {
    q: 'What does "verified" mean?',
    a: (
      <>
        A story is marked verified when two or more outlets (websites) report it and its reliability score reaches 65%. Reports from the same outlet, or copies of one article, don&apos;t count twice. An AI check then reads the reports and looks for contradictions on facts such as where, who and how many. Verified means &ldquo;more than one outlet says so&rdquo;, not &ldquo;proven true&rdquo;. <Link href="/how-we-count" className="text-wp-amber underline">How the outlets are counted</Link>.
      </>
    ),
    text: 'A story is marked verified when two or more outlets (websites) report it and its reliability score reaches 65%. Reports from the same outlet, or copies of one article, don\'t count twice. An AI check then reads the reports and looks for contradictions on facts such as where, who and how many. Verified means "more than one outlet says so", not "proven true". How the outlets are counted: world-pulse.io/how-we-count.',
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
    // plan C5 and C6 (Devon, Oct 21, 2026): readers' flags and reports are shown, reviewed, never automatic
    q: 'A story looks wrong. What can I do?',
    a: 'Open the story and press Flag, then pick a reason. The story page shows how many readers flagged it and why, never who. A flag is a reader\'s report, not a ruling: it does not change the reliability score or hide the story. When 3 or more readers flag the same story, it goes on a list that a person reviews. Posts and communities have a Report button that works the same way. For anything else, email support@world-pulse.io.',
  },
  {
    q: 'Are the AI digests written by AI?',
    a: 'Yes. The digests and briefings are written by an AI model from the verified reports.',
  },
  {
    q: 'Is there an API?',
    a: (
      <>
        Yes, and an MCP server for AI assistants. The public endpoints work without signing up or a key; see the{' '}
        <Link href="/developers" className="text-wp-amber underline">developer page</Link>. All of it is free; Pro ($12 a month) adds an API key with its own budget, commercial use and priority support (
        <Link href="/pricing" className="text-wp-amber underline">Pricing</Link>).
      </>
    ),
    text: 'Yes, and an MCP server for AI assistants. The public endpoints work without signing up or a key; see the developer page (world-pulse.io/developers). All of it is free; Pro ($12 a month) adds an API key with its own budget, commercial use and priority support (world-pulse.io/pricing).',
  },
  {
    // Devon, Oct 21, 2026: the hosted API is "Free with credit"; 8:10 PM: commercial use comes with Pro, reselling is a data license
    q: 'Can I use WorldPulse\'s data?',
    a: 'Personal, research, education and non-profit use is free, with a link back to world-pulse.io. Commercial use, in your own work and products, comes with Pro ($12 a month), with a link back. Reselling or redistributing the data needs a data license: email support@world-pulse.io. The code is open source under the MIT license.',
  },
  {
    // Devon, Oct 21, 2026: support@world-pulse.io reaches him (plan C1)
    q: 'How do I contact WorldPulse?',
    a: (
      <>
        Email <span className="text-wp-amber select-all">support@world-pulse.io</span>. To suggest a news source, use{' '}
        <Link href="/sources/suggest" className="text-wp-amber underline">/sources/suggest</Link>.
      </>
    ),
    text: 'Email support@world-pulse.io. To suggest a news source, use world-pulse.io/sources/suggest.',
  },
]

/** Every answer in plain text: an answer with links has its own `text` */
const FAQ_TEXT = FAQ.map(i => ({ q: i.q, text: i.text ?? (typeof i.a === 'string' ? i.a : '') })).filter(i => i.text)

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-wp-bg text-wp-text">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(faqJsonLd(FAQ_TEXT)) }} />
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
