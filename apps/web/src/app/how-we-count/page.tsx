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
    // plan 15 (Oct 22, 2026): the outlet directory, apps/api/src/lib/outlet-directory.ts
    id: 'kinds',
    h: 'What kind of outlet it is',
    p: 'Each outlet in WorldPulse’s list of sources has a kind: a news agency (a wire service such as Reuters, AP or Yonhap, whose copy other outlets often run), international (a broadcaster or publisher for the world or a whole region, such as the BBC or Al Jazeera), national, local, specialist (one subject, such as business, defence, science or shipping), aggregator (mostly other outlets’ reports) or official source (a government, central bank, court, the UN or the Red Cross). Outlets a government runs are marked state media. A story page shows each outlet’s kind, and the API gives it as site_info. Every kind counts the same toward Verified; the kind helps you judge who is saying it. Websites outside the list, such as many of the articles GDELT points to, have no kind yet.',
  },
  {
    // plan 11a (Oct 22, 2026): the second read lowers (the scraper's pipeline/second-read.ts)
    id: 'severity',
    h: 'How serious it is',
    p: 'Each report is rated low, medium, high or critical from its own words: how many died or were hurt, and what kind of event it is. Critical is 100 or more dead, a nuclear or chemical attack or a major disaster happening now; high is 5 or more dead or 100 or more injured, a bombing, a coup or a major storm; medium is any death, fighting, protests, arrests or a change of policy. A report only one outlet carries is medium at most, except disasters, health and security. A high or critical report that fewer than three outlets carry gets a second read by an AI model. When the second read rates it lower, the report goes down one level, and its page says so (“Lowered from high by a second read”). Once three or more outlets carry the story, its words decide again. When the second read finds analysis, a roundup or a feature rather than a new event, the page says so too.',
  },
  {
    id: 'score',
    h: 'The reliability score',
    p: 'Every report gets a score from 0 to 100%. It starts from the outlet’s rating in WorldPulse’s list of sources (most outlets are rated between 70% and 90%, state-run outlets between 45% and 60%), moved a few points by the report itself, for example: a summary and a place add a little; a state-run outlet on conflict, politics, elections or security loses 10 points; and a single report marked high or critical loses up to 15. The same report always gets the same score. Each further independent outlet that reports the story closes 40% of the gap to 98%: a report at 80% goes to 87% with a second outlet and to 92% with a third. No story reaches 100%. AI checks and reader flags don’t change the score; an AI check can send a story back to pending when its outlets describe different events.',
  },
  {
    h: 'When a story becomes Verified',
    p: 'When two or more outlets report it and its reliability score reaches 65%. An AI check then reads the reports and looks for contradictions on facts such as where, who and how many.',
  },
  {
    // plan N2 (Oct 23, 2026): scraper pipeline/second-outlet.ts and independence.ts
    id: 'second-outlet',
    h: 'A second outlet from GDELT',
    p: 'WorldPulse reads a few hundred news feeds, so many reports start with one outlet even when others carried the story. Every 15 minutes it also reads GDELT’s free list of the articles news outlets published, and looks for another outlet for each English report of medium or higher seriousness that has only one. An article counts only when it is on a different website, from a newsroom (not an aggregator, a press-release wire or a content farm), has a headline that matches the report’s story, and is not a copy: sister sites of one owner that run the same article, and one wire story on many papers, count as one outlet. Up to three such outlets are added to a report, with links, and its page says “Also reported by”.',
  },
  {
    // plan D6 (Oct 15, 2026): scraper pipeline/crosscheck.ts
    id: 'cross-check',
    h: 'The cross-check read, and held stories',
    p: 'When a report turns verified because another outlet joined it, an AI model reads the outlets’ reports and says whether they describe the same event and whether they agree on its main facts. If they describe different events, the report goes back to pending (held), and its page says so. If the outlets describe the same event but differ on facts, the page says “the outlets differ”. When the AI gives no answer, nothing is held and the story stays verified. A held story can verify again when further outlets report it.',
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
