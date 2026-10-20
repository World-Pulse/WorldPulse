import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/page-metadata'
import { fetchWeek } from '@/lib/week-data'
import { WeekView, weekTitle, weekDescription } from '@/components/week/WeekView'

// "WorldPulse Week", the week under way (plan G11 slice 1, Oct 20, 2026).
// Finished weeks live at /week/<YYYY>-W<ww>.

class WeekUnavailableError extends Error {
  constructor() { super('The week could not be loaded: the API did not answer'); this.name = 'WeekUnavailableError' }
}

export async function generateMetadata(): Promise<Metadata> {
  const data = await fetchWeek()
  if (data === 'missing' || data === 'unavailable') return pageMetadata({ path: '/week', title: 'WorldPulse Week', description: "The week's top verified stories, ranked by independent outlets." })
  return pageMetadata({ path: '/week', title: weekTitle(data), description: weekDescription(data) })
}

export default async function Page() {
  const data = await fetchWeek()
  if (data === 'missing' || data === 'unavailable') throw new WeekUnavailableError()
  return <WeekView data={data} />
}
