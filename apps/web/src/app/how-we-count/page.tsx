import type { Metadata } from 'next'
import Link from 'next/link'
import { pageMetadata } from '@/lib/page-metadata'

// Plan G19 (Oct 20, 2026): what "N outlets" and "Verified" mean, in words a
// reader can check against the code (scraper pipeline/correlate.ts counts a
// story's outlets; GET /api/v1/stories counts the websites in its links)
export const metadata: Metadata = pageMetadata({
  path: '/how-we-count',
  title: 'How we count independent outlets',
  description: 'What “Verified · N outlets” means on WorldPulse: how a story gets its outlet count, what is not counted twice, and what the count cannot tell you.',
})

const STEPS: Array<{ id?: string; h: string; p: React.ReactNode }> = [
  {
    h: 'An outlet is a website',
    p: 'Every report keeps the link to the original article. The outlets of a story are the different websites in those links (a leading “www.” is ignored). Twelve articles on one website are one outlet.',
  },
  {
    h: 'The same story is grouped first',
    p: 'Reports of one event are grouped into one story by their headline wording, place and time. The count belongs to the story, not to a single report, so “Verified · 12 outlets” means twelve websites carried that story.',
  },
  {
    h: 'The count covers the story’s last two days',
    p: 'A story can run for days, and related reports keep joining it. So the number shown with a story counts the websites that reported it in the two days up to its latest report. A story that has run longer also shows how many have reported it since it began, as in “48 outlets in its last 2 days · 143 since Oct 10”. A week’s page counts that week’s reports.',
  },
  {
    h: 'What is not counted twice',
    p: 'A report from a source we already hold for the story. A second website that only copied the article (the same article slug, or the same headline word for word). An article merged into another report still counts as its website: it carried the story.',
  },
  {
    id: 'score',
    h: 'The reliability score',
    p: 'Every report gets a score from 0 to 100%. It starts from the outlet’s rating in WorldPulse’s list of sources (most outlets are rated between 70% and 90%, state-run outlets between 45% and 60%), moved a few points by the report itself, for example: a summary and a place add a little; a state-run outlet on conflict, politics, elections or security loses 10 points; a single report marked high or critical loses up to 15; and a little random spread keeps two reports from tying. Each further independent outlet that reports the story closes 40% of the gap to 98%: a report at 80% goes to 87% with a second outlet and to 92% with a third. No story reaches 100%. AI checks and reader flags don’t change the score; an AI check can send a story back to pending when its outlets describe different events.',
  },
  {
    h: 'When a story becomes Verified',
    p: 'When two or more outlets report it and its reliability score reaches 65%. An AI check then reads the reports and looks for contradictions on facts such as where, who and how many.',
  },
]

const LIMITS = [
  'Verified means “more than one outlet says so”, not “proven true”. Outlets can repeat the same mistaken source.',
  'Websites, not owners, are counted: two sites of one publisher count as two, and a wire story rewritten under a new headline may count as more than one.',
  'Grouping goes by wording, so now and then two cards describe one event, or two events are grouped.',
]

export default function HowWeCountPage() {
  return (
    <div className="min-h-screen bg-wp-bg text-wp-text">
      <main className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-wp-text">How we count independent outlets</h1>
        <p className="text-sm text-wp-text2 mt-2 mb-8 leading-relaxed">
          Every story on WorldPulse shows how many outlets reported it. This page says exactly what that number is, so you can decide how much to trust it.
        </p>
        <ol className="space-y-6">
          {STEPS.map((s, i) => (
            <li key={s.h} id={s.id}>
              <h2 className="text-base font-semibold text-wp-text">{i + 1}. {s.h}</h2>
              <p className="text-sm text-wp-text2 mt-1 leading-relaxed">{s.p}</p>
            </li>
          ))}
        </ol>
        <h2 className="text-base font-semibold text-wp-text mt-10">What the count cannot tell you</h2>
        <ul className="list-disc pl-5 mt-2 space-y-2 text-sm text-wp-text2 leading-relaxed">
          {LIMITS.map(l => <li key={l}>{l}</li>)}
        </ul>
        <p className="text-sm text-wp-text2 mt-8 leading-relaxed">
          Got a link someone shared? <Link href="/check" className="text-wp-amber underline">Check how many outlets reported it</Link>.
        </p>
        <p className="text-sm text-wp-text2 mt-3 leading-relaxed">
          See today’s <Link href="/briefing" className="text-wp-amber underline">verified stories</Link>, the{' '}
          <Link href="/map" className="text-wp-amber underline">live map</Link>, or the <Link href="/help" className="text-wp-amber underline">Help &amp; FAQ</Link>.
        </p>
      </main>
    </div>
  )
}
