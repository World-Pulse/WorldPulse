/**
 * A verified story's full page (Nov 11, 2026; G28, Devon: "Proceed" to full pages for verified stories): its figures
 * and its reports so far come in the page's own HTML, so search engines and AI assistants that read the page without
 * running it see them and the story's other outlets; its fact line names its own country's newsrooms and its figure;
 * its structured data cites the outlets' own articles. From Bulgaria's motorway pile-ups as the API gave them that
 * night (36 reports, 34 outlets in 26 countries, 2 of them Bulgarian).
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WhoReported } from '@/app/signals/[id]/WhoReported'
import type { StoryFiguresData } from '@/app/signals/[id]/StoryFigures'
import type { StoryDetail } from '@/app/signals/[id]/StoryMembers'
import { storyFactLine, topFigure } from '@/lib/story-count'
import { newsArticleJsonLd } from '@/lib/page-metadata'

const value = (text: string, outlets: number, lastAt: string, headline = 'Twelve dead after motorway pile-ups in Bulgaria fog') => ({
  value: Number.parseInt(text.replace(/\D+/g, ''), 10) || 0, text, outlets, outletNames: ['bbc.co.uk', 'dw.com'], reports: outlets,
  firstAt: '2026-11-10T12:06:27.896Z', lastAt, headline, url: 'https://www.dw.com/en/bulgaria-pileups/a-1',
})

const FIGURES: StoryFiguresData = {
  storyId: 'bfb3984a-cd6a-49b8-b24d-d1667c1363f3',
  reports: 36,
  countedHours: 48,
  figures: [
    { kind: 'killed', label: 'Killed', values: [
      value('12', 13, '2026-11-11T01:31:09.087Z'),
      value('at least 5', 2, '2026-11-10T22:18:09.980Z'),
      value('more than 10', 2, '2026-11-10T22:18:00.346Z'),
      value('11', 16, '2026-11-10T22:17:48.607Z'),
    ] },
    { kind: 'injured', label: 'Injured', values: [value('50', 5, '2026-11-10T18:52:28.790Z')] },
  ],
}

const member = (id: string, outlet: string, url: string, createdAt: string, title: string) =>
  ({ id, title, status: 'verified', outlet, url, createdAt, verifiedAt: createdAt, severity: 'high', position: null })

const STORY: StoryDetail = {
  storyId: 'bfb3984a-cd6a-49b8-b24d-d1667c1363f3',
  size: 36,
  outlets: 34,
  outletNames: ['bnrnews.bg', 'dw.com', 'novinite.com'],
  outletsAll: 34,
  outletNamesAll: ['bnrnews.bg', 'dw.com', 'novinite.com'],
  firstReportAt: '2026-11-10T09:26:42.192Z',
  latestReportAt: '2026-11-11T04:09:39.264Z',
  verifiedAt: '2026-11-10T10:48:34.125Z',
  country: 'BG',
  outletCountries: 26,
  localOutlets: 2,
  localOutletNames: ['Bulgarian National Radio', 'Novinite'],
  signals: [
    member('bfb3984a-cd6a-49b8-b24d-d1667c1363f3', 'novinite.com', 'https://www.novinite.com/articles/241521/Mass+Casualty+Pile-ups', '2026-11-10T09:26:42.192Z', "Mass Casualty Pile-ups Paralyze Bulgaria's Trakia Highway, More Than 10 Dead"),
    member('c1', 'dw.com', 'https://www.dw.com/en/bulgaria-pileups/a-1', '2026-11-10T18:52:28.790Z', 'Bulgaria: People killed in massive highway pileup'),
    member('b892eda1-cd8f-4abd-8773-4a409dd7979a', 'nation.com.pk', 'https://www.nation.com.pk/11-Nov-2026/twelve-dead', '2026-11-11T01:31:09.087Z', 'Twelve dead after motorway pile-ups in Bulgaria fog'),
  ],
}

describe("a verified story's full page", () => {
  it('has its figures and its reports so far in the HTML the server sends', () => {
    const html = renderToStaticMarkup(
      <WhoReported signalId="b892eda1-cd8f-4abd-8773-4a409dd7979a" sources={[]} sourceUrl="https://www.nation.com.pk/11-Nov-2026/twelve-dead"
        originalUrls={['https://www.nation.com.pk/11-Nov-2026/twelve-dead']} storyOutlets={34} initialFigures={FIGURES} initialStory={STORY} />,
    )
    expect(html).toContain('Figures in this story')
    expect(html).toContain('more than 10')
    expect(html).toContain('The story so far')
    // the story's other outlets and their own headlines, not only this report's link
    expect(html).toContain('novinite.com')
    expect(html).toContain('Bulgaria: People killed in massive highway pileup')
  })

  it('without them, as before: the browser asks', () => {
    const html = renderToStaticMarkup(
      <WhoReported signalId="b892eda1-cd8f-4abd-8773-4a409dd7979a" sources={[]} sourceUrl="https://www.nation.com.pk/11-Nov-2026/twelve-dead"
        originalUrls={['https://www.nation.com.pk/11-Nov-2026/twelve-dead']} storyOutlets={34} />,
    )
    expect(html).not.toContain('Figures in this story')
    expect(html).not.toContain('The story so far')
  })

  it("says its figure as it stands: the newest that half as many outlets give as the most-reported", () => {
    expect(topFigure(FIGURES)).toEqual({ text: '12 killed', outlets: 13 })
    // a newer figure few outlets give doesn't replace it
    const early = { ...FIGURES, figures: [{ ...FIGURES.figures[0]!, values: [value('15', 3, '2026-11-11T05:00:00Z'), ...FIGURES.figures[0]!.values] }] }
    expect(topFigure(early)).toEqual({ text: '12 killed', outlets: 13 })
    // one outlet's figure isn't the story's
    expect(topFigure({ figures: [{ label: 'Injured', values: [value('10', 1, '2026-11-10T12:57:30.091Z')] }] })).toBeNull()
    expect(topFigure(null)).toBeNull()
    expect(topFigure({ figures: [] })).toBeNull()
  })

  it('names its own country\'s newsrooms and its figure in its fact line', () => {
    const base = { verified: true, outlets: 34, countries: 26, firstReportAt: '2026-11-10T09:26:42.192Z' }
    expect(storyFactLine({ ...base, local: 2, country: 'BG', figure: topFigure(FIGURES) }))
      .toBe('Verified: 34 outlets in 26 countries have reported this story since Nov 10, 2 of them from Bulgaria. 12 killed, according to 13 outlets.')
    expect(storyFactLine({ ...base, local: 3, country: 'US', figure: { text: 'at least 5 killed', outlets: 4 } }))
      .toBe('Verified: 34 outlets in 26 countries have reported this story since Nov 10, 3 of them from the United States. At least 5 killed, according to 4 outlets.')
    // without them, as before
    expect(storyFactLine(base)).toBe('Verified: 34 outlets in 26 countries have reported this story since Nov 10.')
    expect(storyFactLine({ ...base, local: 0, country: 'BG', figure: null })).toBe('Verified: 34 outlets in 26 countries have reported this story since Nov 10.')
    // an unverified story's line says nothing more
    expect(storyFactLine({ ...base, verified: false, local: 2, country: 'BG', figure: topFigure(FIGURES) }))
      .toBe('34 outlets in 26 countries have reported this story so far; it is not verified yet.')
  })

  it("cites the outlets' own articles in its structured data, one per outlet", () => {
    const ld = newsArticleJsonLd({
      id: 'b892eda1-cd8f-4abd-8773-4a409dd7979a', title: 'Twelve dead after motorway pile-ups in Bulgaria fog', description: 'Verified: …',
      citations: [
        { url: 'https://www.dw.com/en/bulgaria-pileups/a-1', outlet: 'dw.com' },
        { url: 'https://www.dw.com/en/bulgaria-pileups/a-2', outlet: 'dw.com' },
        { url: 'https://www.novinite.com/articles/241521', outlet: 'novinite.com' },
        { url: 'javascript:alert(1)', outlet: 'bad.example' },
      ],
    })
    expect(ld.citation).toEqual([
      { '@type': 'NewsArticle', url: 'https://www.dw.com/en/bulgaria-pileups/a-1', publisher: { '@type': 'Organization', name: 'dw.com' } },
      { '@type': 'NewsArticle', url: 'https://www.novinite.com/articles/241521', publisher: { '@type': 'Organization', name: 'novinite.com' } },
    ])
    const many = Array.from({ length: 30 }, (_, i) => ({ url: `https://outlet${i}.example/a`, outlet: `outlet${i}.example` }))
    expect((newsArticleJsonLd({ id: 'x', title: 't', description: 'd', citations: many }).citation as unknown[]).length).toBe(20)
    expect(newsArticleJsonLd({ id: 'x', title: 't', description: 'd' })).not.toHaveProperty('citation')
  })
})
