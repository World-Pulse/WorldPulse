import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/postgres', () => ({ db: vi.fn() }))

import { sourceKey, publishedAtFor, signalsHavePublishedAt } from '../signal-columns'

describe('sourceKey', () => {
  it('uses the first stored source id when there is one', () => {
    expect(sourceKey(['0b9f1c2e-uuid', 'other'], ['https://www.bbc.co.uk/news/1'])).toBe('0b9f1c2e-uuid')
    expect(sourceKey('reuters', null)).toBe('reuters')
  })

  it('falls back to the host of the first URL, without www.', () => {
    expect(sourceKey([], ['https://www.bbc.co.uk/news/1'])).toBe('bbc.co.uk')
    expect(sourceKey(null, 'https://Earthquake.USGS.gov/event/x')).toBe('earthquake.usgs.gov')
  })

  it('gives two articles from the same outlet the same key', () => {
    expect(sourceKey([], ['https://www.aljazeera.com/a'])).toBe(sourceKey([''], ['https://aljazeera.com/b']))
  })

  it('uses the fallback when there is neither', () => {
    expect(sourceKey([], [], 'usgs-seismic')).toBe('usgs-seismic')
    expect(sourceKey(undefined, ['not a url'])).toBe('')
  })
})

describe('publishedAtFor', () => {
  it('keeps a valid event time', () => {
    const t = new Date('2026-10-10T12:00:00Z')
    expect(publishedAtFor(t).toISOString()).toBe(t.toISOString())
    expect(publishedAtFor('2026-10-09T08:30:00Z').toISOString()).toBe('2026-10-09T08:30:00.000Z')
  })

  it('uses now for a missing or invalid time', () => {
    const before = Date.now()
    expect(publishedAtFor(null).getTime()).toBeGreaterThanOrEqual(before)
    expect(publishedAtFor('not a date').getTime()).toBeGreaterThanOrEqual(before)
  })
})

describe('signalsHavePublishedAt', () => {
  it('answers false (and does not throw) when the database cannot be asked', async () => {
    await expect(signalsHavePublishedAt()).resolves.toBe(false)
  })
})
