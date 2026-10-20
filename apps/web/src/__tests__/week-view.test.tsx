import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WeekView, weekDescription, weekTitle, type WeekData } from '@/components/week/WeekView'

// "WorldPulse Week" page (plan G11 slice 1)

const finished: WeekData = {
  week: '2026-W42',
  start: '2026-10-12T00:00:00.000Z',
  end: '2026-10-19T00:00:00.000Z',
  underWay: false,
  stories: [
    { id: 'st-1', leadId: 'sig-1', title: 'Ceasefire talks resume in Doha', place: 'Doha, Qatar', category: 'conflict', severity: 'high', outletCount: 14 },
    { id: 'st-2', leadId: 'sig-2', title: 'Typhoon makes landfall in Luzon', place: null, category: null, severity: 'critical', outletCount: 9 },
  ],
  countries: [{ code: 'QA', name: 'Qatar', stories: 31 }],
  people: null,
  generatedAt: '2026-10-19T00:05:00.000Z',
}

describe('weekTitle and weekDescription', () => {
  it('name the dates, which people search for', () => {
    expect(weekTitle(finished)).toBe("The week's top verified stories: Oct 12–18, 2026")
    expect(weekTitle({ ...finished, underWay: true })).toBe("This week's top verified stories: Oct 12–18, 2026")
    expect(weekDescription(finished)).toContain('in the week of Oct 12–18, 2026')
    expect(weekDescription({ ...finished, underWay: true })).toContain('so far this week')
  })
})

describe('WeekView', () => {
  it('lists the stories in order, linking each to its lead report, and the busiest countries', () => {
    const html = renderToStaticMarkup(<WeekView data={finished} />)
    expect(html.indexOf('Ceasefire talks resume in Doha')).toBeLessThan(html.indexOf('Typhoon makes landfall in Luzon'))
    expect(html).toContain('href="/signals/sig-1"')
    // the week's own reports: a story's page, counting every report, can show more
    expect(html).toContain('14 outlets that week · Doha, Qatar · conflict')
    expect(html).toContain('href="/countries/QA"')
    expect(html).not.toContain('Who is in the news')
  })
  it('links the four earlier weeks and the week after a finished one', () => {
    const html = renderToStaticMarkup(<WeekView data={finished} />)
    for (const w of ['2026-W41', '2026-W40', '2026-W39', '2026-W38']) expect(html).toContain(`href="/week/${w}"`)
    expect(html).toContain('Next week')
  })
  it('says so when no story had two outlets, and shows no next week for the week under way', () => {
    const html = renderToStaticMarkup(<WeekView data={{ ...finished, underWay: true, stories: [], countries: [] }} />)
    expect(html).toContain('No story was reported by two or more outlets this week yet')
    expect(html).not.toContain('Next week')
  })
})
