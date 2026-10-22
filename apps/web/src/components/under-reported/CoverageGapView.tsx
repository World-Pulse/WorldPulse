import Link from 'next/link'
import { jsonLdText } from '@/lib/page-metadata'
import { isoWeekName, weekStart, weeksBefore } from '@/lib/week'
import {
  API_ORIGIN, UNHCR_DATA_URL, gapJsonLd, gapSpan, people, plural,
  type CoverageGapData, type GapCrisis,
} from '@/lib/coverage-gap'

// Under-reported crises (the coverage gap, Oct 21, 2026; Devon: "Let's get
// after it"): the countries with at least a million people displaced, ranked
// by how few news outlets reported on them. Server-rendered: plain links.

const weekNumber = (name: string) => Number(name.slice(-2))

function Crisis({ c, week }: { c: GapCrisis; week: boolean }) {
  const lead = c.stories[0]
  return (
    <li className="flex gap-3">
      <span className="font-mono text-[13px] text-wp-text3 w-6 flex-none text-right pt-0.5">{c.rank}</span>
      <div className="min-w-0 flex-1">
        {/* on a phone the figures go under the name, side by side from sm up; the name's link stays
            inline, as the phone rule giving links 44px (globals.css) would open a gap under a block one */}
        <div className="sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-3">
          <div><Link href={`/countries/${c.code}`} className="text-[16px] font-semibold text-wp-text hover:text-wp-amber">{c.name}</Link></div>
          <div className="mt-0.5 sm:mt-0 text-[13px] text-wp-text2 tabular-nums">
            {people(c.displaced)} displaced · <span className={c.outlets <= 2 ? 'text-wp-amber' : ''}>{plural(c.outlets, 'outlet')}</span>
            {(c.outletsAbroad ?? 0) > 0 && <span className="text-wp-text3"> ({c.outletsAbroad} based abroad)</span>}
            {c.outlets > 0 && <span className="text-wp-text3"> · {people(c.peoplePerOutlet)} people per outlet</span>}
          </div>
        </div>
        {c.outlets === 0 ? (
          <p className="text-[13px] text-wp-text3 mt-1">No outlet WorldPulse reads reported on it {week ? 'that week' : 'in these 7 days'}.</p>
        ) : (
          <>
            {lead && (
              <p className="text-[13px] mt-1 leading-snug">
                <Link href={`/signals/${lead.id}`} className="text-wp-text2 hover:text-wp-amber">{lead.title}</Link>
                <span className="text-wp-text3"> · {lead.verified ? `Verified · ${plural(lead.outlets, 'outlet')}` : plural(lead.outlets, 'outlet')}</span>
              </p>
            )}
            {c.sites.length > 0 && (
              <p className="text-[12px] text-wp-text3 mt-1 break-words">Reported by {c.sites.map(s => s.site).join(', ')}{c.outlets > c.sites.length ? ` and ${c.outlets - c.sites.length} more` : ''}</p>
            )}
          </>
        )}
      </div>
    </li>
  )
}

export function CoverageGapView({ data }: { data: CoverageGapData }) {
  const week = data.window === 'week'
  const share = data.totals.crisisShare * 100
  // the finished weeks to link: the 4 before this one (or before the week under way)
  const from = week && data.week ? data.week : isoWeekName(new Date())
  const earlier = weeksBefore(from, 4)
  const s0 = week && data.week ? weekStart(data.week) : null
  const nextStart = s0 ? new Date(s0.getTime() + 7 * 86_400_000) : null
  const nextName = nextStart && nextStart.getTime() + 7 * 86_400_000 <= Date.now() ? isoWeekName(nextStart) : null
  return (
    <div className="min-h-screen bg-wp-bg text-wp-text">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(gapJsonLd(data)) }} />
      <main className="max-w-3xl mx-auto px-4 py-10">
        <p className="font-mono text-[11px] tracking-widest uppercase text-wp-text3">
          Coverage gap · {week && data.week ? `Week ${weekNumber(data.week)} · ` : 'Last 7 days · '}{gapSpan(data)}
        </p>
        <h1 className="text-2xl font-bold text-wp-text mt-2">Under-reported crises</h1>
        <p className="text-sm text-wp-text2 mt-2 leading-relaxed">
          The {data.crises.length} countries where at least a million people have been forced from their homes, ranked by how few
          news outlets reported on them {week ? 'that week' : 'in the last 7 days'}: the most people for the fewest outlets first.
          {data.totals.articles > 0 && (
            <> Together they account for {people(data.totals.crisisDisplaced)} displaced people, and got{' '}
              <strong className="text-wp-text">{share < 10 ? share.toFixed(1) : Math.round(share)}%</strong> of the news articles
              WorldPulse placed in a country {week ? 'that week' : 'this week'}.</>
          )}
        </p>

        <ol className="mt-8 space-y-5">
          {data.crises.map(c => <Crisis key={c.code} c={c} week={week} />)}
        </ol>

        {data.mostCovered.length > 0 && (
          <section className="mt-10">
            <h2 className="text-base font-semibold text-wp-text">For comparison</h2>
            <p className="text-[12px] text-wp-text3 mt-1">The countries with the most outlets {week ? 'that week' : 'in the last 7 days'}</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {data.mostCovered.map(c => (
                <li key={c.code}>
                  <Link href={`/countries/${c.code}`} className="inline-block rounded-lg border border-[rgba(255,255,255,0.08)] px-3 py-1.5 text-[13px] text-wp-text2 hover:text-wp-text tabular-nums">
                    {c.name} <span className="text-wp-text3">· {plural(c.outlets, 'outlet')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-10 text-[13px] text-wp-text2 leading-relaxed space-y-2">
          <h2 className="text-base font-semibold text-wp-text">How it&apos;s counted</h2>
          <p>
            <span className="text-wp-text">The crises</span> are the countries UNHCR counts at least a million people displaced from,
            inside the country or abroad as refugees and asylum-seekers ({data.unhcrYear} figures,{' '}
            <a href={UNHCR_DATA_URL} className="text-wp-amber underline" rel="noopener noreferrer" target="_blank">UNHCR Refugee Data Finder</a>, CC BY 4.0).
            They are ranked by people displaced per outlet, and any crisis no outlet covered comes first.
          </p>
          <p>
            <span className="text-wp-text">The coverage</span> is the news websites (outlets) WorldPulse placed in each country:
            the sites of the articles in its news reports, from the 500+ outlets it reads and the articles GDELT points it to. Data feeds and official press offices don&apos;t count, and neither do reports on sports, culture,
            technology, science or space. {data.totals.outlets > 0 && <>This {week ? 'week' : 'time'}: {plural(data.totals.articles, 'article')} from {plural(data.totals.outlets, 'outlet')} in {plural(data.totals.countries, 'country', 'countries')}.</>}
            {' '}&ldquo;Based abroad&rdquo; counts the outlets in WorldPulse&apos;s outlet list whose home country isn&apos;t the crisis&apos;s own;
            the other websites GDELT points to count as outlets, but not there.
          </p>
          <p>
            <span className="text-wp-text">What it can&apos;t tell you:</span> it counts the outlets WorldPulse reads, not all the world&apos;s
            media, and a country&apos;s own outlets count too. UNHCR&apos;s yearly figures don&apos;t include crises newer than them, and
            leave out the Palestine refugees UNRWA serves and people displaced inside Gaza and the West Bank.
          </p>
          <p>
            The same figures as data, free and without a key:{' '}
            <a href={`${API_ORIGIN}/api/v1/coverage-gap${data.week ? `?week=${data.week}` : ''}`} className="text-wp-amber underline break-all">GET /api/v1/coverage-gap{data.week ? `?week=${data.week}` : ''}</a>,
            and for AI assistants the MCP tool under_reported (<Link href="/developers#mcp" className="text-wp-amber underline">how</Link>).
          </p>
        </section>

        <nav aria-label="Other weeks" className="mt-12 text-sm text-wp-text2 flex flex-wrap gap-x-4 gap-y-2">
          {week && <Link href="/under-reported" className="text-wp-amber underline">The last 7 days</Link>}
          {nextName && <Link href={`/under-reported/${nextName}`} className="text-wp-amber underline">Next week →</Link>}
          {earlier.map(w => (
            <Link key={w} href={`/under-reported/${w}`} className="text-wp-amber underline">Week {weekNumber(w)}</Link>
          ))}
          <Link href="/week" className="text-wp-amber underline">WorldPulse Week</Link>
          <Link href="/how-we-count" className="text-wp-amber underline">How we count outlets</Link>
        </nav>
      </main>
    </div>
  )
}
