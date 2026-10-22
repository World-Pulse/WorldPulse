import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SourceChain } from '@/components/signals/SourceChain'
import { hostOf, infoFor, kindLine, type OutletInfo } from '@/lib/outlet-kinds'
import type { Source } from '@worldpulse/types'

// What each outlet is, on the story page (plan 15, Oct 22, 2026): the API's
// outletInfo (the outlet directory) names each website and says its kind

const INFO: OutletInfo[] = [
  { site: 'bbc.co.uk', name: 'BBC', kind: 'international', country: 'GB', stateMedia: false },
  { site: 'tass.com', name: 'TASS', kind: 'agency', country: 'RU', stateMedia: true },
  { site: 'kvia.com', name: null, kind: 'unknown', country: null, stateMedia: false },
]

const BBC: Source = {
  id: 'src-1', slug: 'bbc-world', name: 'BBC World', description: null, url: 'https://bbc.com/news/world', logoUrl: null,
  // the old sources table called the BBC a wire service
  tier: 'wire', trustScore: 0.95, language: 'en', country: null, categories: [], activeAt: new Date().toISOString(),
  articleUrl: 'https://www.bbc.co.uk/news/articles/a1',
} as Source

describe('outlet kinds', () => {
  it('says what a website is, from what the API sent', () => {
    expect(hostOf('https://www.BBC.co.uk/news/a')).toBe('bbc.co.uk')
    expect(hostOf('not a link')).toBeNull()
    expect(infoFor(INFO, 'www.tass.com')?.name).toBe('TASS')
    expect(infoFor(INFO, 'example.org')).toBeNull()
    expect(infoFor(null, 'bbc.co.uk')).toBeNull()
    expect(kindLine(infoFor(INFO, 'tass.com'))).toBe('News agency · state media')
    expect(kindLine(infoFor(INFO, 'bbc.co.uk'))).toBe('International')
    expect(kindLine(infoFor(INFO, 'kvia.com'))).toBe('')
  })
})

describe('the story page\'s outlets (SourceChain)', () => {
  const links = ['https://www.bbc.co.uk/news/articles/a1', 'https://tass.com/world/1', 'https://kvia.com/news/2']

  it("names each outlet with its kind, and a website it doesn't know by its address", () => {
    const html = renderToStaticMarkup(<SourceChain bare sources={[BBC]} sourceUrl={links[0]} originalUrls={links} outletInfo={INFO} />)
    expect(html).toContain('TASS<span class="text-wp-text3">· News agency · state media</span>')
    expect(html).toContain('BBC<span class="text-wp-text3">· International</span>')
    expect(html).toContain('kvia.com')
    // the source card: the directory's kind, not the old tier
    expect(html).toContain('>International</span>')
    expect(html).not.toContain('>wire</span>')
  })

  it('without what the API says, the websites as before and no old tier', () => {
    const html = renderToStaticMarkup(<SourceChain bare sources={[BBC]} sourceUrl={links[0]} originalUrls={links} />)
    expect(html).toContain('bbc.co.uk ↗')
    expect(html).toContain('tass.com ↗')
    expect(html).not.toContain('>wire</span>')
  })
})
