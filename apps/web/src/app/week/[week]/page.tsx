import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { pageMetadata } from '@/lib/page-metadata'
import { fetchWeek } from '@/lib/week-data'
import { WEEK_RE, isoWeekName } from '@/lib/week'
import { WeekView, weekTitle, weekDescription } from '@/components/week/WeekView'

// "WorldPulse Week" for a finished week, e.g. /week/2026-W42 (plan G11 slice 1).
// The week under way redirects to /week, so it has one address.

class WeekUnavailableError extends Error {
  constructor() { super('The week could not be loaded: the API did not answer'); this.name = 'WeekUnavailableError' }
}

export async function generateMetadata({ params }: { params: Promise<{ week: string }> }): Promise<Metadata> {
  const { week } = await params
  if (!WEEK_RE.test(week)) return { title: 'Not found — WorldPulse', robots: { index: false } }
  const data = await fetchWeek(week)
  if (data === 'missing') return { title: 'Not found — WorldPulse', robots: { index: false } }
  if (data === 'unavailable') return { title: 'WorldPulse Week' }
  const meta = pageMetadata({ path: `/week/${data.week}`, title: weekTitle(data), description: weekDescription(data) })
  // A week with no story two outlets reported has nothing to find in search
  return data.stories.length ? meta : { ...meta, robots: { index: false, follow: true } }
}

export default async function Page({ params }: { params: Promise<{ week: string }> }) {
  const { week } = await params
  if (!WEEK_RE.test(week)) notFound()
  if (week === isoWeekName(new Date())) redirect('/week')
  const data = await fetchWeek(week)
  if (data === 'missing') notFound()
  if (data === 'unavailable') throw new WeekUnavailableError()
  return <WeekView data={data} />
}
