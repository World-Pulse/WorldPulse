import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SourcesList, { sourcesLine } from '@/app/sources/SourcesList'

// /sources says how many sources are read and in how many countries and territories (Nov 25, 2026:
// it said "19 verified sources", the length of the curated list, against 1,442 sources read)

describe('sourcesLine', () => {
  it('names the sources read and the 202 countries and territories', () => {
    expect(sourcesLine(1442)).toBe('1,442 sources read in 202 countries and territories · Continuously monitored')
  })
  it('says what is read, with no number, when the count is unknown', () => {
    expect(sourcesLine(null)).toBe('News outlets and data feeds in 202 countries and territories · Continuously monitored')
  })
})

describe('the Sources page as first sent', () => {
  it('shows the sources read and the countries covered before the list loads, never the curated list as the total', () => {
    const html = renderToStaticMarkup(<SourcesList sourcesRead={1442} />)
    expect(html).toContain('1,442 sources read in 202 countries and territories')
    expect(html).toContain('Sources read')
    expect(html).toContain('>1,442<')
    expect(html).toContain('Countries covered')
    expect(html).toContain('>202<')
    expect(html).not.toContain('verified sources')
    expect(html).not.toMatch(/>0</)   // a dash, never 0, for what isn't loaded yet (H-0058)
    expect(html).toContain('href="/how-we-count"')
  })
  it('shows a dash for each count it does not know yet', () => {
    const html = renderToStaticMarkup(<SourcesList sourcesRead={null} />)
    expect(html).toContain('News outlets and data feeds in 202 countries and territories')
    expect(html.match(/>–</g)?.length).toBe(3)   // sources read, curated sources, their average trust
    expect(html).toContain('>202<')
  })
})
