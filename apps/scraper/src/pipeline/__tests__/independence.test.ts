/**
 * Copies of one article (sister sites, wire reprints) are one outlet.
 */
import { describe, it, expect } from 'vitest'
import { articleSlug, headlineKey, countIndependentOutlets, independentReports, isCopyOf } from '../independence'

const SINCLAIR_A = 'https://cbs12.com/weather/hurricane-stories/governor-ron-desantis-to-address-hurricane-isaias-damage-recovery-as-panhandle-wakes-to-outages-flooding-landfall-'
const SINCLAIR_B = 'https://foxrochester.com/news/nation-world/governor-ron-desantis-to-address-hurricane-isaias-damage-recovery-as-panhandle-wakes-to-outages-flooding-landfall-'

describe('articleSlug', () => {
  it('reads a headline-like slug and ignores the folders before it', () => {
    expect(articleSlug(SINCLAIR_A)).toBe(articleSlug(SINCLAIR_B))
    expect(articleSlug(SINCLAIR_A)).toMatch(/^governor-ron-desantis-to-address/)
  })

  it('drops story ids and file extensions', () => {
    expect(articleSlug('https://news.sky.com/story/uk-nationals-told-to-avoid-saudi-arabia-airport-13563284'))
      .toBe('uk-nationals-told-to-avoid-saudi-arabia-airport')
    expect(articleSlug('https://example.com/2026/10/10/quake-hits-northern-japan-coast.html')).toBe('quake-hits-northern-japan-coast')
  })

  it('returns null for short, numeric or broken addresses', () => {
    expect(articleSlug('https://www.bbc.com/news/articles/c70vqwengxno')).toBeNull()
    expect(articleSlug('https://example.com/story/12345678')).toBeNull()
    expect(articleSlug('https://example.com/')).toBeNull()
    expect(articleSlug('not a url')).toBeNull()
    expect(articleSlug(null)).toBeNull()
  })
})

describe('headlineKey', () => {
  it('ignores case, punctuation, curly quotes and accents', () => {
    expect(headlineKey('At least 12 dead in Riyadh airport attack: Saudi officials'))
      .toBe(headlineKey('At Least 12 Dead in Riyadh Airport Attack — Saudi Officials'))
    expect(headlineKey('Pérez’s party wins Bogotá vote, officials say')).toBe('perezs party wins bogota vote officials say')
  })

  it('returns null for headlines too short to identify a copy', () => {
    expect(headlineKey('Earthquake hits Japan')).toBeNull()
    expect(headlineKey('')).toBeNull()
  })
})

describe('countIndependentOutlets', () => {
  it('counts sister stations publishing one article once', () => {
    expect(countIndependentOutlets([
      { source_id: 'cbs12.com', url: SINCLAIR_A, title: 'DeSantis: 448,000 without power after Isaias; major Panhandle routes reopen' },
      { source_id: 'foxrochester.com', url: SINCLAIR_B, title: 'Governor DeSantis addresses Isaias damage' },
    ])).toBe(1)
  })

  it('counts a wire headline reprinted word for word once', () => {
    const t = 'At least 12 dead in Riyadh airport attack: Saudi officials'
    expect(countIndependentOutlets([
      { source_id: 'channelnewsasia.com', url: 'https://www.channelnewsasia.com/world/a-123', title: t },
      { source_id: 'dw.com', url: 'https://www.dw.com/en/b/a-456', title: t },
      { source_id: 'e.vnexpress.net', url: 'https://e.vnexpress.net/news/c-789.html', title: t },
    ])).toBe(1)
  })

  it('counts different reporting of the same story separately', () => {
    expect(countIndependentOutlets([
      { source_id: 'aljazeera.com', url: 'https://www.aljazeera.com/news/2026/10/10/riyadh-airport-attack', title: 'Twelve killed, more than 300 injured in Riyadh airport attack' },
      { source_id: 'npr.org', url: 'https://www.npr.org/2026/10/10/nx-s1-1/saudi-airport', title: 'Attack on Riyadh airport killed 12 people and wounded over 300 more' },
      { source_id: 'dw.com', url: 'https://www.dw.com/en/b/a-456', title: 'At least 12 dead in Riyadh airport attack: Saudi officials' },
      { source_id: 'channelnewsasia.com', url: 'https://www.channelnewsasia.com/world/a-123', title: 'At least 12 dead in Riyadh airport attack: Saudi officials' },
    ])).toBe(3) // Al Jazeera, NPR, and one AFP copy
  })

  it('links copies through a chain and ignores reports without an outlet', () => {
    expect(countIndependentOutlets([
      { source_id: 'a.com', url: 'https://a.com/x/same-story-slug-for-all-three', title: 'One' },
      { source_id: 'b.com', url: 'https://b.com/y/same-story-slug-for-all-three', title: 'Two headline words that match exactly' },
      { source_id: 'c.com', url: 'https://c.com/other', title: 'Two headline words that match exactly' },
      { source_id: null, url: 'https://d.com/z', title: 'Anything' },
    ])).toBe(1)
    expect(countIndependentOutlets([])).toBe(0)
  })
})

describe('independentReports', () => {
  it('keeps the first report of each outlet in the original order', () => {
    const items = [
      { id: 1, host: 'cbs12.com', url: SINCLAIR_A, title: 'x' },
      { id: 2, host: 'aljazeera.com', url: 'https://www.aljazeera.com/news/a', title: 'y' },
      { id: 3, host: 'foxrochester.com', url: SINCLAIR_B, title: 'z' },
    ]
    expect(independentReports(items, i => ({ source_id: i.host, url: i.url, title: i.title })).map(i => i.id)).toEqual([1, 2])
  })
})

describe('isCopyOf', () => {
  it('spots a copy by slug or by identical headline', () => {
    expect(isCopyOf({ url: SINCLAIR_B, title: 'Different words' }, { urls: [SINCLAIR_A], title: 'Held headline' })).toBe(true)
    expect(isCopyOf({ url: 'https://dw.com/x', title: 'At least 12 dead in Riyadh airport attack: Saudi officials' },
      { urls: ['https://cna.com/y'], title: 'At least 12 dead in Riyadh airport attack - Saudi officials' })).toBe(true)
  })

  it('treats different reporting as independent', () => {
    expect(isCopyOf({ url: 'https://www.npr.org/2026/10/10/saudi-airport-attack-kills-twelve', title: 'Attack on Riyadh airport killed 12 people' },
      { urls: ['https://www.aljazeera.com/news/2026/10/10/riyadh-airport-attack'], title: 'Twelve killed in Riyadh airport attack' })).toBe(false)
  })
})
