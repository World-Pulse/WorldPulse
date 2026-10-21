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
    const html = renderToStaticMarkup(
      <WhoReported signalId="s1" sources={[guardian()]} sourceUrl="https://www.theguardian.com/us-news/x" originalUrls={URLS} storyOutlets={5} />,
    )
    expect(html).toContain('national')
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
