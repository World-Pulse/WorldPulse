import type { Metadata } from 'next'
import Link from 'next/link'
import { pageMetadata } from '@/lib/page-metadata'
import { PRO_PRICE_TEXT } from '@/lib/pro-plan'

// The terms of use (drafted Nov 22, 2026, from what llms.txt, the pricing page and the privacy policy already say;
// Devon approved the wording, 10:53 AM: no refunds, New Jersey law, 13 and over, and his own name as who runs it).
// ChatGPT's and Google's app directories ask for this page, as the AI directories asked for /privacy.
export const metadata: Metadata = pageMetadata({
  path: '/terms',
  title: 'Terms of use',
  description: 'The terms for using WorldPulse, its API, feeds and AI tools: free for personal, research, education and non-profit use with a link back; commercial use with Pro; what Verified means and doesn’t.',
})

/** The date at the top: change it with the terms */
export const TERMS_UPDATED = 'November 22, 2026'
/** Who runs WorldPulse, as the terms name them (Devon, Nov 22: his own name, not a company's) */
export const OPERATOR = 'Devon Gamba'

const LICENSE_URL = 'https://github.com/World-Pulse/WorldPulse/blob/main/LICENSE'

const SECTIONS: Array<{ id: string; h: string; items: React.ReactNode[] }> = [
  {
    id: 'what',
    h: 'What WorldPulse is',
    items: [
      'WorldPulse collects reports from news outlets and public sources, groups the reports of each event into one story, and counts how many independent outlets carry it, with a link to every original report.',
      <>“Verified” means two or more outlets report the story. It doesn’t mean the story is proven true (<Link href="/how-we-count" className="text-wp-amber underline">how we count</Link>). Reports, scores, translations, maps and AI summaries can be wrong or out of date, so check the original sources before relying on them.</>,
      'Nothing on WorldPulse is financial, legal, medical or safety advice. In an emergency, follow your local authorities.',
    ],
  },
  {
    id: 'use',
    h: 'Using the website, API, feeds and AI tools',
    items: [
      'Personal, research, education and non-profit use is free, with a link back to world-pulse.io.',
      <>Commercial use, in your own work and products, comes with <Link href="/pricing" className="text-wp-amber underline">WorldPulse Pro</Link>, with a link back.</>,
      <>Reselling or redistributing WorldPulse’s data (as a dataset or a feed of your own, for example) needs a data license: email <span className="text-wp-text select-all">support@world-pulse.io</span>.</>,
      'Stay within the published limits. Don’t try to get around them, overload the service or reach anything that isn’t public. Apps, AI assistants and crawlers are welcome within those limits.',
    ],
  },
  {
    id: 'content',
    h: 'Other people’s content',
    items: [
      'Headlines, short summaries and links point to articles that belong to their publishers. WorldPulse links to the original instead of copying it, and publishers keep their rights.',
      <>A publisher who wants their content shown differently or taken down can email <span className="text-wp-text select-all">support@world-pulse.io</span>.</>,
    ],
  },
  {
    id: 'accounts',
    h: 'Accounts and posts',
    items: [
      'You must be at least 13 to make an account. You’re responsible for your account and for what you post, and posts are public.',
      'Don’t post anything illegal, threatening, harassing, deliberately misleading or spam, and don’t pretend to be someone else.',
      'WorldPulse may remove posts or suspend accounts that break these terms.',
    ],
  },
  {
    id: 'pro',
    h: 'WorldPulse Pro',
    items: [
      `Pro costs ${PRO_PRICE_TEXT} a month, billed through Stripe every month until you cancel. Cancel any time from Manage subscription on the pricing page; Pro stays on until the end of the month you paid for.`,
      'Payments are not refundable, including for part of a month.',
      'A Pro API key has its own budget (600 requests a minute and 50,000 a day) and covers commercial use with a link back.',
    ],
  },
  {
    id: 'code',
    h: 'The code',
    items: [
      <>WorldPulse’s code is open source under the <a href={LICENSE_URL} className="text-wp-amber underline" rel="noopener noreferrer" target="_blank">MIT license</a>. The license covers the code, not the hosted service or its data, which these terms cover.</>,
    ],
  },
  {
    id: 'no-guarantees',
    h: 'No guarantees',
    items: [
      'WorldPulse is provided as it is, with no guarantee that it is accurate, complete or always available.',
      'As far as the law allows, WorldPulse isn’t liable for losses from using it or relying on it.',
    ],
  },
  {
    id: 'law',
    h: 'Governing law',
    items: ['These terms are governed by the laws of the State of New Jersey, USA. Any dispute about them or about WorldPulse goes to the state or federal courts in New Jersey.'],
  },
  {
    id: 'changes',
    h: 'Changes',
    items: ['These terms may change. This page and its date will be updated, and using WorldPulse after a change means accepting the new terms.'],
  },
]

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-wp-bg text-wp-text">
      <main className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-wp-text">Terms of use</h1>
        <p className="text-xs text-wp-text3 mt-2">Last updated: {TERMS_UPDATED}</p>
        <p className="text-sm text-wp-text2 mt-4 mb-8 leading-relaxed">
          These terms cover WorldPulse (world-pulse.io), run by {OPERATOR}: the website, its API and feeds, and its AI tools
          (the MCP server at api.world-pulse.io/mcp). By using any of them, you agree to these terms. Questions:{' '}
          <span className="text-wp-text select-all">support@world-pulse.io</span>.
        </p>
        <div className="space-y-8">
          {SECTIONS.map(s => (
            <section key={s.id} id={s.id}>
              <h2 className="text-base font-semibold text-wp-text">{s.h}</h2>
              <ul className="list-disc pl-5 mt-2 space-y-2 text-sm text-wp-text2 leading-relaxed">
                {s.items.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </section>
          ))}
        </div>
        <p className="text-sm text-wp-text2 mt-10 leading-relaxed">
          See also the <Link href="/privacy" className="text-wp-amber underline">privacy policy</Link>,{' '}
          <Link href="/pricing" className="text-wp-amber underline">pricing</Link> and the{' '}
          <Link href="/developers" className="text-wp-amber underline">API and AI tools</Link>.
        </p>
      </main>
    </div>
  )
}
