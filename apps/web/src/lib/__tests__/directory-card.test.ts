/**
 * Who's in the news (world-pulse.io/entities, Oct 13, 2026): the week's range
 * and what its share picture says (lib/entity-directory.ts, lib/directory-card.tsx).
 */
import { describe, it, expect } from 'vitest'
import { weekRange, type EntityDirectory, type DirectoryEntity } from '../entity-directory'
import { directoryCardText } from '../directory-card'

const e = (id: string, type: string, name: string, last7d: number): DirectoryEntity =>
  ({ id, type, name, last7d, last24h: 0, previous7d: 0, change: null })

const directory = (groups: Partial<Record<'people' | 'places' | 'organisations' | 'more', DirectoryEntity[]>>): EntityDirectory => ({
  generatedAt: '2026-10-13T04:00:00Z',
  total: 99,
  groups: (['people', 'places', 'organisations', 'more'] as const).map(key => ({ key, label: key, entities: groups[key] ?? [] })),
})

describe('weekRange', () => {
  it('names the 7 days ending at the time given', () => {
    expect(weekRange('2026-10-13T04:00:00Z')).toBe('Oct 6 – 13')
  })

  it('names both months when the week crosses one', () => {
    expect(weekRange('2026-10-03T12:00:00Z')).toBe('Sep 26 – Oct 3')
  })

  it('uses now for a time it cannot read', () => {
    expect(weekRange('not a date')).toMatch(/^[A-Z][a-z]{2} \d{1,2} – /)
  })
})

describe('directoryCardText', () => {
  it('shows the top three people, places and organizations with their weekly reports', () => {
    const t = directoryCardText(directory({
      people: [e('p1', 'person', 'Donald Trump', 496), e('p2', 'person', 'Volodymyr Zelensky', 135), e('p3', 'person', 'Bola Tinubu', 124), e('p4', 'person', 'Vladimir Putin', 77)],
      places: [e('l1', 'location', 'United States', 656)],
      organisations: [e('o1', 'organisation', 'UN', 1818), e('o2', 'organisation', 'EU', 1)],
      more: [e('c1', 'commodity', 'Crude oil', 102)],
    }))
    expect(t?.range).toBe('Oct 6 – 13')
    expect(t?.columns.map(c => c.label)).toEqual(['PEOPLE', 'PLACES', 'ORGANIZATIONS'])
    expect(t?.columns[0].rows).toEqual([
      { name: 'Donald Trump', count: '496 reports' },
      { name: 'Volodymyr Zelensky', count: '135 reports' },
      { name: 'Bola Tinubu', count: '124 reports' },
    ])
    expect(t?.columns[2].rows).toEqual([{ name: 'UN', count: '1,818 reports' }, { name: 'EU', count: '1 report' }])
  })

  it('shortens long names to fit a column', () => {
    const t = directoryCardText(directory({ organisations: [e('o', 'organisation', 'International Committee of the Red Cross', 40)] }))
    expect(t?.columns[2].rows[0].name.length).toBeLessThanOrEqual(22)
    expect(t?.columns[2].rows[0].name.endsWith('…')).toBe(true)
  })

  it('is null when nobody is listed', () => {
    expect(directoryCardText(directory({ more: [e('c1', 'commodity', 'Crude oil', 102)] }))).toBeNull()
  })
})
