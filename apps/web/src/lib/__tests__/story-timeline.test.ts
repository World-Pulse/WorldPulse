import { describe, it, expect } from 'vitest'
import { storyTimeline, sinceFirst, type TimelineMember } from '../story-timeline'

const t0 = Date.parse('2026-10-11T06:00:00Z')
const at = (min: number) => new Date(t0 + min * 60_000).toISOString()
const m = (id: string, min: number, outlet: string, severity: string, extra: Partial<TimelineMember> = {}): TimelineMember => ({
  id, title: `report ${id}`, status: 'pending', outlet, url: null, createdAt: at(min), verifiedAt: null, severity, ...extra,
})

describe('storyTimeline', () => {
  it('orders the reports, slots in "verified" and severity rises, and marks what is new since the last look', () => {
    const members = [
      m('d', 60, 'dw.com', 'critical'),
      m('a', 0, 'gulfnews.com', 'medium'),
      m('c', 40, 'smh.com.au', 'high'),
      m('b', 20, 'aljazeera.com', 'high'),
      m('e', 70, 'aljazeera.com', 'high'),
    ]
    const { entries, reports, outlets, newCount } = storyTimeline(members, at(30), 'b', t0 + 50 * 60_000)
    expect(entries.map(e => e.kind === 'report' ? e.member.id : e.kind === 'severity' ? `sev:${e.severity}` : 'verified'))
      .toEqual(['a', 'b', 'sev:high', 'verified', 'c', 'd', 'sev:critical', 'e'])
    const report = (id: string) => entries.find(e => e.kind === 'report' && e.member.id === id) as Extract<typeof entries[number], { kind: 'report' }>
    expect(report('a').first).toBe(true)
    expect(report('b').current).toBe(true)
    expect(report('d').isNew).toBe(true)
    expect(report('c').isNew).toBe(false)
    expect(report('e').newOutlet).toBe(false)     // aljazeera's second report
    expect({ reports, outlets, newCount }).toEqual({ reports: 5, outlets: 4, newCount: 2 })
  })

  it('handles no verification, no last look, and missing times', () => {
    const { entries, newCount } = storyTimeline([m('a', 0, 'x.com', 'low'), m('b', 5, 'y.com', 'low', { createdAt: null })], null, 'a')
    expect(entries.map(e => e.kind)).toEqual(['report'])
    expect(newCount).toBe(0)
  })
})

describe('sinceFirst', () => {
  it('reads minutes, hours and days', () => {
    expect(sinceFirst(t0 + 25 * 60_000, t0)).toBe('+25 min')
    expect(sinceFirst(t0 + 3 * 3600_000, t0)).toBe('+3 h')
    expect(sinceFirst(t0 + 72 * 3600_000, t0)).toBe('+3 d')
  })
})

describe('foldTimeline', () => {
  it('keeps the start, the latest and the report you are reading; folds the runs between', async () => {
    const { foldTimeline } = await import('../story-timeline')
    const members = Array.from({ length: 12 }, (_, i) => m(`r${i}`, i * 10, `o${i}.com`, 'low'))
    const { entries } = storyTimeline(members, null, 'r6')
    const folds = foldTimeline(entries, 3, 4)
    // r0-r2 kept, r3-r5 folded (3), r6 kept (current), r7 folded (1), r8-r11 kept
    expect([...folds.entries()]).toEqual([[3, 3], [4, 0], [5, 0], [7, 1]])
    // short stories don't fold
    expect(foldTimeline(storyTimeline(members.slice(0, 9), null, 'r0').entries, 3, 4).size).toBe(0)
  })
})

describe('foldTimeline on a big story', () => {
  it('counts the reports the API left out of the middle', async () => {
    const { foldTimeline } = await import('../story-timeline')
    // positions 1-10 and 41-50 came back (the API's start and latest); 11-40 were left out
    const members = [...Array.from({ length: 10 }, (_, i) => i + 1), ...Array.from({ length: 10 }, (_, i) => i + 41)]
      .map(p => m(`p${p}`, p, `o${p}.com`, 'low', { position: p }))
    const { entries } = storyTimeline(members, null, 'p1')
    const folds = foldTimeline(entries, 3, 4)
    // after p3, one line for p4-p46: 43 reports
    expect(folds.get(3)).toBe(43)
  })
})
