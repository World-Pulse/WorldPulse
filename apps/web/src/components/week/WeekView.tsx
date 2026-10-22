import Link from 'next/link'
import { entityPath } from '@/lib/entity-links'
import { isoWeekName, weekSpan, weekStart, weeksBefore } from '@/lib/week'

// "WorldPulse Week" (plan G11 slice 1, Oct 20, 2026): the week's top stories
// ranked by independent outlets, the busiest countries, and for the week
// under way who is in the news. Server-rendered, so it reads as plain links.

export interface WeekData {
  week: string
  start: string
  end: string
  underWay: boolean
  stories: Array<{ id: string; leadId: string; title: string; place: string | null; category: string | null; severity: string; outletCount: number; verifiedAt?: string | null }>
  countries: Array<{ code: string; name: string; stories: number }>
  people: Array<{ id: string; name: string; reports: number }> | null
  generatedAt: string
}

const weekNumber = (name: string) => Number(name.slice(-2))

/** The page title (" — WorldPulse" is added): dates, which people search for, rather than the week's number */
export function weekTitle(d: Pick<WeekData, 'underWay' | 'start'>): string {
  const span = weekSpan(new Date(d.start))
  return d.underWay ? `This week's top verified stories: ${span}` : `The week's top verified stories: ${span}`
}

export function weekDescription(d: Pick<WeekData, 'week' | 'underWay' | 'start'>): string {
  const span = weekSpan(new Date(d.start))
  return `The stories the most independent outlets reported ${d.underWay ? 'so far this week' : 'in the week of'} ${span}, the countries with the most verified stories${d.underWay ? ', and who is in the news' : ''}.`
}

export function WeekView({ data }: { data: WeekData }) {
  const start = new Date(data.start)
  const earlier = weeksBefore(data.week, 4)
  // The week after a finished one: /week when that is the week under way
  const s0 = weekStart(data.week)
  const nextStart = s0 && !data.underWay ? new Date(s0.getTime() + 7 * 86_400_000) : null
  const nextName = nextStart && nextStart.getTime() <= Date.now() ? isoWeekName(nextStart) : null
  const nextHref = nextName ? (nextName === isoWeekName(new Date()) ? '/week' : `/week/${nextName}`) : null
  return (
    <div className="min-h-screen bg-wp-bg text-wp-text">
      <main className="max-w-3xl mx-auto px-4 py-10">
        <p className="font-mono text-[11px] tracking-widest uppercase text-wp-text3">WorldPulse Week {weekNumber(data.week)} · {weekSpan(start)}{data.underWay ? ' · so far' : ''}</p>
        <h1 className="text-2xl font-bold text-wp-text mt-2">The week&apos;s top verified stories</h1>
        <p className="text-sm text-wp-text2 mt-2 leading-relaxed">
          Ranked by how many independent outlets reported each story{data.underWay ? ', from Monday until now' : ', Monday to Sunday (UTC)'}.{' '}
          <Link href="/how-we-count" className="text-wp-amber underline">How we count outlets</Link>.
        </p>

        {data.stories.length > 0 ? (
          <ol className="mt-6 space-y-4">
            {data.stories.map((s, i) => (
              <li key={s.id} className="flex gap-3">
                <span className="font-mono text-[13px] text-wp-text3 w-6 flex-none text-right">{i + 1}</span>
                <div className="min-w-0">
                  <Link href={`/signals/${s.leadId}`} className="text-[15px] font-semibold text-wp-text hover:text-wp-amber">{s.title}</Link>
                  <p className="text-[12px] text-wp-text3 mt-0.5">
                    {/* the week's own reports only, so a story's page, which counts every report, can show more */}
                    {s.outletCount} outlets {data.underWay ? 'this week' : 'that week'}{s.place ? ` · ${s.place}` : ''}{s.category ? ` · ${s.category}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-6 text-sm text-wp-text2">No story was reported by two or more outlets this week{data.underWay ? ' yet' : ''}.</p>
        )}

        {data.countries.length > 0 && (
          <section className="mt-10">
            <h2 className="text-base font-semibold text-wp-text">Busiest countries</h2>
            <p className="text-[12px] text-wp-text3 mt-1">By verified stories this week</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {data.countries.map(c => (
                <li key={c.code}>
                  <Link href={`/countries/${c.code}`} className="inline-block rounded-lg border border-[rgba(255,255,255,0.08)] px-3 py-1.5 text-[13px] text-wp-text2 hover:text-wp-text">
                    {c.name} <span className="text-wp-text3">· {c.stories}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.people && data.people.length > 0 && (
          <section className="mt-10">
            <h2 className="text-base font-semibold text-wp-text">Who is in the news</h2>
            <p className="text-[12px] text-wp-text3 mt-1">Named in the most reports in the last 7 days</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {data.people.map(p => (
                <li key={p.id}>
                  <Link href={entityPath(p.id, p.name)} className="inline-block rounded-lg border border-[rgba(255,255,255,0.08)] px-3 py-1.5 text-[13px] text-wp-text2 hover:text-wp-text">
                    {p.name} <span className="text-wp-text3">· {p.reports}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <nav aria-label="Other weeks" className="mt-12 text-sm text-wp-text2 flex flex-wrap gap-x-4 gap-y-2">
          {nextHref && <Link href={nextHref} className="text-wp-amber underline">Next week →</Link>}
          {earlier.map(w => (
            <Link key={w} href={`/week/${w}`} className="text-wp-amber underline">Week {weekNumber(w)}</Link>
          ))}
          <Link href="/briefing" className="text-wp-amber underline">Today&apos;s briefing</Link>
          <Link href="/under-reported" className="text-wp-amber underline">Under-reported crises</Link>
        </nav>
      </main>
    </div>
  )
}

