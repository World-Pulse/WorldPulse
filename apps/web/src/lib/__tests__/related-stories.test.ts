/**
 * "Related" on a story's page (plan G18 (1), Oct 20, 2026): other stories,
 * one row each, from the country's top stories and the day's most-reported.
 * It listed single reports, so the Kenyan cult verdict's page listed another
 * report of the verdict and one headline twice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CountryStory } from '@/components/countries/CountryTopStories'

const h = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@/lib/server-fetch', () => ({ cachedFetch: h.fetch }))

import { rankRelatedStories, fetchTopStories } from '@/lib/related-stories'
import { storiesOf } from '@/lib/country-stories'

const story = (id: string, category = 'security', title = `Story ${id}`): CountryStory =>
  ({ id, leadId: `lead-${id}`, title, place: null, category, severity: 'high', outletCount: 3, verifiedAt: null })

describe('rankRelatedStories', () => {
  const me = { storyId: 'x', signalId: 'lead-x', category: 'security' }

  it("puts the country's stories first (the same topic first), then the day's of the topic, then the day's", () => {
    const out = rankRelatedStories(me, [story('a', 'economy'), story('b')], [story('c', 'health'), story('d'), story('e', 'economy')])
    expect(out.map(s => s.id)).toEqual(['b', 'a', 'd', 'c', 'e'])
  })

  it('never lists the page\'s own story, by its id or its lead report, and each story once', () => {
    const out = rankRelatedStories(me, [story('x'), story('a')], [story('a'), { ...story('y'), leadId: 'lead-x' }, story('c')])
    expect(out.map(s => s.id)).toEqual(['a', 'c'])
  })

  it('shows one headline once (the same headline twice was two rows)', () => {
    const t = "Kenya cult leader's children still being starved weeks before trial, son says"
    const out = rankRelatedStories(me, [story('a', 'security', t), story('b', 'security', `${t.toUpperCase()}!`)], [])
    expect(out.map(s => s.id)).toEqual(['a'])
  })

  it('keeps at most five, and works without a country or a story id', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => story(id))
    expect(rankRelatedStories(me, many, [])).toHaveLength(5)
    expect(rankRelatedStories({ signalId: 'z', category: null }, [], [story('a')]).map(s => s.id)).toEqual(['a'])
  })
})

describe('the lists it picks from', () => {
  beforeEach(() => { h.fetch.mockReset() })

  it("asks for the day's most-reported as the home page does, and reads them", async () => {
    h.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: { stories: [{ id: 's1', leadId: 'l1', title: 'A', category: 'conflict', severity: 'high', outletCount: 25, verifiedAt: '2026-10-20T10:00:00Z' }, { id: 's2' }] } }) })
    expect(await fetchTopStories()).toEqual([{ id: 's1', leadId: 'l1', title: 'A', place: null, category: 'conflict', severity: 'high', outletCount: 25, verifiedAt: '2026-10-20T10:00:00Z' }])
    expect(h.fetch.mock.calls[0]![0]).toMatch(/\/api\/v1\/stories\?hours=24&limit=12$/)
  })

  it('is empty when the API fails', async () => {
    h.fetch.mockResolvedValue({ ok: false, json: async () => ({}) })
    expect(await fetchTopStories()).toEqual([])
    h.fetch.mockRejectedValue(new Error('down'))
    expect(await fetchTopStories()).toEqual([])
  })

  it('reads a story list, leaving out rows without an id, lead or headline', () => {
    expect(storiesOf([{ id: 'a', leadId: 'b', title: 'T', outletCount: '4' }, { id: 'c', leadId: 'd', title: '' }, null])).toEqual([
      { id: 'a', leadId: 'b', title: 'T', place: null, category: null, severity: 'info', outletCount: 4, verifiedAt: null },
    ])
    expect(storiesOf(undefined)).toEqual([])
  })
})
