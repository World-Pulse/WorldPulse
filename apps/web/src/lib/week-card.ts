/**
 * What a "WorldPulse Week" link's share picture says (plan G11 slice 1,
 * Oct 20, 2026), drawn by the entity card (lib/entity-card.tsx): the week's
 * dates, how its stories were ranked, one bar per top story (its outlets),
 * and the top story with its outlets. Kept apart from the drawing so it can be tested.
 */

import { clip } from './story-card'
import type { EntityCardText } from './entity-card'
import { weekSpan } from './week'
import type { WeekData } from '@/components/week/WeekView'

export function weekCardText(d: Pick<WeekData, 'start' | 'underWay' | 'stories'>): EntityCardText {
  const span = weekSpan(new Date(d.start))
  const name = span.replace(/, \d{4}$/, '') // "Oct 12–18": the year is in the counts line
  const year = new Date(new Date(d.start).getTime() + 6 * 86_400_000).getUTCFullYear()
  const lead = d.stories[0]
  const verified = Boolean(lead?.verifiedAt)
  return {
    name,
    nameSize: name.length <= 14 ? 112 : 92,
    kind: d.underWay ? 'WORLDPULSE WEEK · SO FAR' : 'WORLDPULSE WEEK',
    counts: d.stories.length
      ? `${year} · the ${d.stories.length === 1 ? 'top story' : `top ${d.stories.length} stories`}, ranked by independent outlets`
      : `${year} · no story two outlets reported${d.underWay ? ' yet' : ''}`,
    bars: d.stories.slice(0, 12).map(s => s.outletCount),
    story: lead ? clip(lead.title, 90) : null,
    proof: lead ? (verified ? `Verified · ${lead.outletCount} outlets` : `${lead.outletCount} outlets`) : null,
    verified,
  }
}
