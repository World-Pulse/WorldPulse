import { describe, it, expect } from 'vitest'
import { WEEK_RE, finishedWeeks, isoWeekName, weekSpan, weekStart, weeksBefore } from '../week'

// "WorldPulse Week" names (plan G11 slice 1): the same rules as the API's lib/week.ts

describe('isoWeekName', () => {
  it('names the ISO week a moment falls in (UTC, weeks start on Monday)', () => {
    expect(isoWeekName(new Date('2026-10-20T13:00:00Z'))).toBe('2026-W43')
    expect(isoWeekName(new Date('2026-10-19T00:00:00Z'))).toBe('2026-W43') // Monday
    expect(isoWeekName(new Date('2026-10-18T23:59:59Z'))).toBe('2026-W42') // Sunday night
  })
  it('puts the days around New Year in the right year', () => {
    expect(isoWeekName(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53') // a Friday: 2026 has 53 weeks
    expect(isoWeekName(new Date('2025-12-29T12:00:00Z'))).toBe('2026-W01') // a Monday
  })
})

describe('weekStart', () => {
  it("gives a week's Monday at 00:00 UTC", () => {
    expect(weekStart('2026-W43')?.toISOString()).toBe('2026-10-19T00:00:00.000Z')
    expect(weekStart('2026-W01')?.toISOString()).toBe('2025-12-29T00:00:00.000Z')
  })
  it("refuses names that aren't weeks", () => {
    expect(weekStart('2025-W53')).toBeNull() // 2025 has 52 weeks
    expect(weekStart('2026-W00')).toBeNull()
    expect(weekStart('2026-43')).toBeNull()
    expect(WEEK_RE.test('2026-W43')).toBe(true)
  })
})

describe('weeksBefore and finishedWeeks', () => {
  it('lists the earlier weeks newest first, across a year end', () => {
    expect(weeksBefore('2026-W02', 3)).toEqual(['2026-W01', '2025-W52', '2025-W51'])
  })
  it("lists the weeks that have ended, each with the Monday it ended on", () => {
    const weeks = finishedWeeks(new Date('2026-10-20T13:00:00Z'), 2)
    expect(weeks.map(w => w.name)).toEqual(['2026-W42', '2026-W41'])
    expect(weeks[0].end.toISOString()).toBe('2026-10-19T00:00:00.000Z')
  })
})

describe('weekSpan', () => {
  it('names the days a week covers', () => {
    expect(weekSpan(new Date('2026-10-12T00:00:00Z'))).toBe('Oct 12–18, 2026')
    expect(weekSpan(new Date('2026-09-28T00:00:00Z'))).toBe('Sep 28–Oct 4, 2026')
    expect(weekSpan(new Date('2026-12-28T00:00:00Z'))).toBe('Dec 28–Jan 3, 2027')
  })
})
