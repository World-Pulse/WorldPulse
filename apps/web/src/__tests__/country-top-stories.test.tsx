import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CountryTopStories, outletLine, type CountryStory } from '@/components/countries/CountryTopStories'
import { fetchCountryStories } from '@/lib/country-stories'

// A country's top stories with how many outlets carry each (plan 14, Oct 20, 2026)

const story = (over: Partial<CountryStory> = {}): CountryStory => ({
  id: 'st-1', leadId: 'sig-1', title: 'Floods close the main road to Kano', place: 'Kano, Nigeria',
  category: 'disaster', severity: 'high', outletCount: 5, verifiedAt: '2026-10-19T10:00:00Z', ...over,
})

describe('outletLine', () => {
  it('says verified and how many outlets, or only how many', () => {
    expect(outletLine(story())).toBe('✓ Verified · 5 outlets')
    expect(outletLine(story({ verifiedAt: null, outletCount: 1 }))).toBe('1 outlet')
  })
})

describe('CountryTopStories', () => {
  it('lists each story with its outlets, linking its lead report', () => {
    const html = renderToStaticMarkup(<CountryTopStories name="Nigeria" stories={[story(), story({ id: 'st-2', leadId: 'sig-2', title: 'Senate passes the budget', verifiedAt: null, outletCount: 2 })]} />)
    expect(html).toContain('Top stories · Nigeria · last 3 days')
    expect(html).toContain('href="/signals/sig-1"')
    expect(html).toContain('✓ Verified · 5 outlets')
    expect(html).toContain('2 outlets')
    expect(html.indexOf('Floods close')).toBeLessThan(html.indexOf('Senate passes'))
    expect(html).toContain('href="/how-we-count"')
  })
  it('draws nothing without stories', () => {
    expect(renderToStaticMarkup(<CountryTopStories name="Nigeria" stories={[]} />)).toBe('')
  })
})

describe('fetchCountryStories', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  it("asks the API for the country's stories and keeps only well-formed ones", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { stories: [story(), { id: 'x' }] } })))
    vi.stubGlobal('fetch', fetchMock)
    const stories = await fetchCountryStories('ng')
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/\/api\/v1\/stories\?country=NG&hours=72&limit=8$/)
    expect(stories).toHaveLength(1)
    expect(stories?.[0]).toMatchObject({ leadId: 'sig-1', outletCount: 5 })
  })
  it('gives null for a code that is not a country, without asking', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchCountryStories('nga')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
