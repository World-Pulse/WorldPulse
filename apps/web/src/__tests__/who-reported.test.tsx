/**
 * The story page's outlets in one block, and its sidebar's two lists as tabs
 * (plan P2, steps 3 and 4, Oct 21, 2026). Rendered to HTML as the server
 * sends it. The story so far (StoryMembers) is asked for in the browser, so
 * it isn't in this HTML; it renders inside the same block (checked on the
 * live data of 5 stories: the same outlet links before and after).
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Source } from '@worldpulse/types'
import { WhoReported } from '@/app/signals/[id]/WhoReported'
import { AroundTabs } from '@/app/signals/[id]/AroundTabs'
import { FiguresView, hasFigures, outletsLine } from '@/app/signals/[id]/StoryFigures'

const URLS = ['https://dunyanews.tv/en/World/978936', 'https://defence24.com/industry/france-and-uae']

function guardian(overrides: Partial<Source> = {}): Source {
  return {
    id: 'src-1', slug: 'guardian', name: 'The Guardian', description: null, url: 'https://theguardian.com',
    logoUrl: null, tier: 'national', trustScore: 0.87, language: 'en', country: null, categories: [],
    activeAt: null, ...overrides,
  } as Source
}

const count = (html: string, text: string) => html.split(text).length - 1

describe('Who reported it', () => {
  it('a report without a source record: one "View original source", its outlets, one heading', () => {
    const html = renderToStaticMarkup(
      <WhoReported signalId="s1" sources={[]} sourceUrl={URLS[0]} originalUrls={URLS} storyOutlets={null} />,
    )
    expect(count(html, 'Who reported it')).toBe(2) // the heading, and the block's label
    expect(html).toContain('This report')
    expect(count(html, 'View original source')).toBe(1)
    // it showed "View primary source" too, to the same address
    expect(html).not.toContain('View primary source')
    expect(html).toContain('dunyanews.tv ↗')
    expect(html).toContain('defence24.com ↗')
    expect(html).toContain('Reported by 2 outlets')
    expect(html).not.toContain('Source Intelligence')
  })

  it("a report with a source record: the kind of outlet, the trust bar, and the story's count", () => {
    // the kind comes from the API's outlet directory (plan 15, Oct 22, 2026), not the source record's old tier
    const info = [{ site: 'theguardian.com', name: 'The Guardian', kind: 'national' as const, country: 'GB', stateMedia: false }]
    const html = renderToStaticMarkup(
      <WhoReported signalId="s1" sources={[guardian()]} sourceUrl="https://www.theguardian.com/us-news/x" originalUrls={URLS} storyOutlets={5} outletInfo={info} />,
    )
    expect(html).toContain('>National</span>')
    expect(html).toContain('The Guardian')
    expect(html).toContain('87%')
    expect(html).toContain('This report links 2 of the story&#x27;s 5 outlets')
    // the address isn't the source's article: it has its own button
    expect(count(html, 'View primary source')).toBe(1)
    expect(html).not.toContain('View original source')
  })

  it('no link at all: no empty block', () => {
    expect(renderToStaticMarkup(<WhoReported signalId="s1" sources={[]} sourceUrl={null} originalUrls={[]} storyOutlets={null} />)).toBe('')
  })
})

describe('Around this story', () => {
  it('more stories first, in the HTML; the Intelligence Web asks only when opened', () => {
    const html = renderToStaticMarkup(<AroundTabs signalId="s1" related={[<a key="a" href="/signals/x">Another story</a>]} />)
    expect(html).toContain('role="tablist"')
    expect(html).toContain('More stories')
    expect(html).toContain('Intelligence Web')
    expect(html).toContain('href="/signals/x"')
    expect(html).not.toContain('No entity connections')
  })

  it('without other stories, the Intelligence Web alone, as before', () => {
    const html = renderToStaticMarkup(<AroundTabs signalId="s1" related={null} />)
    expect(html).not.toContain('role="tablist"')
    expect(html).toContain('Intelligence Web')
  })
})

describe('Figures in this story (plan 14)', () => {
  const NOW = Date.parse('2026-10-21T20:00:00Z')
  const data = {
    storyId: 'st1', reports: 7, countedHours: 48,
    figures: [
      { kind: 'killed', label: 'Killed', values: [
        { value: 220, text: '220', outlets: 1, outletNames: ['sudantribune.com'], reports: 1, firstAt: '2026-10-21T08:00:00Z', lastAt: '2026-10-21T08:00:00Z', headline: 'Abyei drone attack death toll reaches 220', url: 'https://sudantribune.com/e' },
        { value: 153, text: 'at least 153', outlets: 3, outletNames: ['aljazeera.com', 'apnews.com', 'reuters.com'], reports: 4, firstAt: '2026-10-20T09:00:00Z', lastAt: '2026-10-20T12:00:00Z', headline: 'Drone strike on a market in disputed African region of Abyei kills at least 153', url: 'https://reuters.com/d' },
        { value: 150, text: 'more than 150', outlets: 2, outletNames: ['a.com', 'b.com'], reports: 2, firstAt: null, lastAt: '2026-10-20T08:00:00Z', headline: 'Sudanese drone strike on market kills more than 150', url: null },
        { value: 53, text: '53', outlets: 1, outletNames: ['c.com'], reports: 1, firstAt: null, lastAt: '2026-10-19T08:00:00Z', headline: 'Strike kills 53', url: null },
      ] },
      { kind: 'displaced', label: 'Displaced', values: [
        { value: 8000, text: 'more than 8,000', outlets: 1, outletNames: ['radiotamazuj.org'], reports: 1, firstAt: null, lastAt: '2026-10-21T07:00:00Z', headline: 'More than 8,000 displaced after deadly drone attack in Abyei', url: 'https://radiotamazuj.org/f' },
      ] },
    ],
  }

  it('each figure with its outlets, when it was last reported and its newest headline; long lists fold', () => {
    const html = renderToStaticMarkup(<FiguresView data={data} bare now={NOW} />)
    expect(html).toContain('Figures in this story')
    expect(html).toContain('in its last 2 days')
    expect(html).toContain('at least 153')
    expect(html).toContain('3 outlets: aljazeera.com, apnews.com +1')
    expect(html).toContain('1 outlet: sudantribune.com')
    expect(html).toContain('latest 12h ago')
    expect(html).toContain('href="https://reuters.com/d"')
    expect(html).toContain('Killed<span')
    expect(html).toContain('4 figures, newest first')
    expect(html).toContain('more than 8,000')
    // three shown, the fourth behind "1 more"
    expect(html).not.toContain('Strike kills 53')
    expect(html).toContain('1 more')
  })

  it('nothing for a story of one report or without figures', () => {
    expect(hasFigures({ ...data, reports: 1 })).toBe(false)
    expect(hasFigures({ ...data, figures: [] })).toBe(false)
    expect(hasFigures(null)).toBe(false)
    expect(renderToStaticMarkup(<FiguresView data={{ ...data, reports: 1 }} />)).toBe('')
  })

  it('names at most two outlets, the rest as a count', () => {
    expect(outletsLine({ outlets: 1, outletNames: ['bbc.com'] })).toBe('1 outlet: bbc.com')
    expect(outletsLine({ outlets: 5, outletNames: ['a.com', 'b.com', 'c.com'] })).toBe('5 outlets: a.com, b.com +3')
    expect(outletsLine({ outlets: 2, outletNames: [] })).toBe('2 outlets')
  })
})
