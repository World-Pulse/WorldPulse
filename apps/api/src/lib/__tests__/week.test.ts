/** ISO weeks for "WorldPulse Week" (lib/week.ts, plan G11 slice 1) */
import { describe, it, expect } from 'vitest'
import { isoWeekOf, parseWeek, weekBounds, weekName, previousWeek } from '../week'

describe('ISO weeks', () => {
  it('names the week a moment falls in, Monday to Sunday, UTC', () => {
    expect(weekName(isoWeekOf(new Date('2026-10-20T12:00:00Z')))).toBe('2026-W43')
    expect(weekName(isoWeekOf(new Date('2026-10-19T00:00:00Z')))).toBe('2026-W43')   // Monday
    expect(weekName(isoWeekOf(new Date('2026-10-18T23:59:59Z')))).toBe('2026-W42')   // Sunday
    expect(weekName(isoWeekOf(new Date('2026-01-01T00:00:00Z')))).toBe('2026-W01')   // a Thursday
    expect(weekName(isoWeekOf(new Date('2027-01-01T00:00:00Z')))).toBe('2026-W53')   // 2026 has 53 weeks
    expect(weekName(isoWeekOf(new Date('2025-12-29T00:00:00Z')))).toBe('2026-W01')
  })

  it('gives each week its Monday and the next', () => {
    const { start, end } = weekBounds({ year: 2026, week: 43 })
    expect(start.toISOString()).toBe('2026-10-19T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-10-26T00:00:00.000Z')
    expect(weekBounds({ year: 2026, week: 1 }).start.toISOString()).toBe('2025-12-29T00:00:00.000Z')
  })

  it('reads only real week names', () => {
    expect(parseWeek('2026-W43')).toEqual({ year: 2026, week: 43 })
    expect(parseWeek('2026-W53')).toEqual({ year: 2026, week: 53 })
    expect(parseWeek('2027-W53')).toBeNull()   // 2027 has 52
    expect(parseWeek('2026-W00')).toBeNull()
    expect(parseWeek('2026-43')).toBeNull()
    expect(parseWeek('')).toBeNull()
  })

  it('steps back a week, across the new year too', () => {
    expect(weekName(previousWeek({ year: 2026, week: 43 }))).toBe('2026-W42')
    expect(weekName(previousWeek({ year: 2027, week: 1 }))).toBe('2026-W53')
  })
})
