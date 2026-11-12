/**
 * A morning video's own share picture (Nov 12, 2026): what it says (lib/map-day-card.tsx).
 */
import { describe, it, expect } from 'vitest'
import { dayCardText, dayDescription, dayLabel, dayTitle, parseDay, readDayCard } from '../map-day-card'

const NOW = new Date('2026-11-12T18:00:00Z')
// the card saved beside the Nov 12, 2026 video
const SAVED = { date: '2026-11-12', video: 'world-in-60s-2026-11-12.mp4', reports: 18344, outlets: 1826, countries: 211, verified: 3470, milestone: null, top: [] }

describe('parseDay', () => {
  it('takes a real day, up to tomorrow', () => {
    expect(parseDay('2026-11-12', NOW)).toBe('2026-11-12')
    expect(parseDay('2026-11-13', NOW)).toBe('2026-11-13')
    expect(parseDay('2026-11-01', NOW)).toBe('2026-11-01')
  })
  it('refuses anything else', () => {
    for (const v of ['2026-11-15', '2026-10-31', '2026-13-01', '2026-02-30', '2026-11-12x', '../etc', '', '20261112', null, 12]) {
      expect(parseDay(v, NOW)).toBeNull()
    }
  })
})

describe('readDayCard', () => {
  it('reads the numbers that were on screen', () => {
    expect(readDayCard(SAVED, '2026-11-12')).toEqual({ date: '2026-11-12', reports: 18344, outlets: 1826, countries: 211 })
  })
  it('is null for another day’s card, a card without numbers, or no card', () => {
    expect(readDayCard(SAVED, '2026-11-13')).toBeNull()
    expect(readDayCard({ ...SAVED, countries: 0 }, '2026-11-12')).toBeNull()
    expect(readDayCard({ ...SAVED, reports: '18344' }, '2026-11-12')).toBeNull()
    expect(readDayCard(null, '2026-11-12')).toBeNull()
    expect(readDayCard('<html>', '2026-11-12')).toBeNull()
  })
})

describe('what the picture and the link say', () => {
  it('are the video’s own numbers and day', () => {
    const card = readDayCard(SAVED, '2026-11-12')!
    expect(dayCardText(card)).toEqual({
      day: 'THURSDAY, NOVEMBER 12',
      stats: [{ value: '18,344', label: 'REPORTS' }, { value: '1,826', label: 'OUTLETS' }, { value: '211', label: 'COUNTRIES' }],
    })
    expect(dayTitle('2026-11-12')).toBe('The world in 30 seconds: Thursday, Nov 12')
    expect(dayLabel('2026-11-01')).toBe('Sunday, Nov 1')
    expect(dayDescription(card)).toBe('24 hours of world news on one map: 18,344 reports from 1,826 outlets in 211 countries.')
  })
  it('gives no numbers before the video exists', () => {
    expect(dayDescription(null)).toBe('24 hours of world news on one map: every report, and the stories newsrooms confirmed.')
  })
})
