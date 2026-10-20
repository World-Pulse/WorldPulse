/**
 * The "Verified · 12 outlets" card other sites can embed (plan G20; Devon,
 * Oct 20, 2026: offered on each story's page only): lib/embed-card.ts, the
 * card itself, /embed/story/<id>, and "Embed this card" in Share.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  cardFromStory, countLine, outletsLine, updatedLine, cardLink, cardUrl, storyEmbedCode, CARD_HEIGHT, type StoryCard,
} from '@/lib/embed-card'
import { fetchStoryCard } from '@/lib/embed-card-server'
import { clearServerFetchCache } from '@/lib/server-fetch'
import { StoryCardView } from '@/components/embed/StoryCardView'
import EmbedStoryPage from '@/app/embed/story/[id]/page'
import { EmbedCardPanel } from '@/components/signals/ShareMenu'

const OWN = '3024218f-0000-4000-8000-000000000001'
const report = (over: Record<string, unknown> = {}) => ({
  id: 'edf7a6d5-0000-4000-8000-000000000002', title: 'Trump puts new Russia sanctions on hold', outlet: 'investing.com',
  reliabilityScore: 0.7, createdAt: '2026-10-17T01:47:27.815Z', status: 'verified', ...over,
})
const answer = {
  storyId: 'edf7a6d5-0000-4000-8000-000000000002',
  outlets: 112,
  outletNames: ['aa.com.tr', 'abc.net.au'],
  verifiedAt: '2026-10-17T02:36:40.175Z',
  signals: [
    report(),
    report({ id: 'b', outlet: 'dw.com', reliabilityScore: 0.95, createdAt: '2026-10-17T02:16:16.631Z' }),
    report({ id: 'c', outlet: 'dw.com', reliabilityScore: 0.94, createdAt: '2026-10-17T02:20:28.776Z' }),
    report({ id: 'd', outlet: 'bbc.co.uk', reliabilityScore: 0.9, createdAt: '2026-10-18T09:00:00.000Z' }),
    report({ id: OWN, title: 'Zelensky meets Trump envoy Witkoff in Norway as US-Ukraine ties sour', outlet: 'cbsnews.com', reliabilityScore: 0.6, createdAt: '2026-10-20T17:13:54.508Z' }),
  ],
}
const card = (over: Partial<StoryCard> = {}): StoryCard => ({
  id: OWN, title: 'Zelensky meets Trump envoy Witkoff in Norway', outlets: 112, verified: true,
  named: ['cbsnews.com', 'dw.com', 'bbc.co.uk'], updatedAt: '2026-10-20T17:13:54.508Z', ...over,
})

describe('cardFromStory', () => {
  it("is the report's own headline with the story's count, its outlet first, then the most reliable", () => {
    expect(cardFromStory(OWN, answer)).toEqual({
      id: OWN,
      title: 'Zelensky meets Trump envoy Witkoff in Norway as US-Ukraine ties sour',
      outlets: 112,
      verified: true,
      named: ['cbsnews.com', 'dw.com', 'bbc.co.uk'],
      updatedAt: '2026-10-20T17:13:54.508Z',
    })
  })

  it("takes the story's first report for a story id, and says not verified without a time", () => {
    const c = cardFromStory('not-listed', { ...answer, verifiedAt: null })
    expect(c?.title).toBe('Trump puts new Russia sanctions on hold')
    expect(c?.verified).toBe(false)
  })

  it('has no card without reports or a headline', () => {
    expect(cardFromStory(OWN, { signals: [] })).toBeNull()
    expect(cardFromStory(OWN, { signals: [report({ title: '  ' })] })).toBeNull()
  })

  it('never counts fewer outlets than it names', () => {
    expect(cardFromStory(OWN, { outlets: 0, signals: [report(), report({ id: 'x', outlet: 'dw.com' })] })?.outlets).toBe(2)
  })
})

describe('the lines on the card', () => {
  it('counts as the site does', () => {
    expect(countLine({ outlets: 112, verified: true })).toBe('✓ Verified · 112 outlets')
    expect(countLine({ outlets: 2, verified: false })).toBe('2 outlets')
    expect(countLine({ outlets: 1, verified: false })).toBe('1 outlet')
  })

  it('names a few outlets and says how many more', () => {
    expect(outletsLine({ outlets: 112, named: ['cbsnews.com', 'dw.com', 'bbc.co.uk'] })).toBe('cbsnews.com, dw.com, bbc.co.uk and 109 more')
    expect(outletsLine({ outlets: 2, named: ['cbsnews.com', 'dw.com'] })).toBe('cbsnews.com and dw.com')
    expect(outletsLine({ outlets: 1, named: ['cbsnews.com'] })).toBe('Only cbsnews.com so far')
    expect(outletsLine({ outlets: 0, named: [] })).toBe('')
  })

  it('gives the update time in UTC', () => {
    expect(updatedLine('2026-10-20T17:03:54.508Z')).toBe('Updated Oct 20, 17:03 UTC')
    expect(updatedLine(null)).toBe('')
    expect(updatedLine('soon')).toBe('')
  })
})

describe('the code for other sites', () => {
  it('frames /embed/story/<id>, dark when asked, under a safe title', () => {
    const code = storyEmbedCode('https://world-pulse.io', OWN, 'Strikes on "Kharkiv" <updated>', 'dark')
    expect(code).toContain(`src="https://world-pulse.io/embed/story/${OWN}?theme=dark"`)
    expect(code).toContain(`height="${CARD_HEIGHT}"`)
    expect(code).toContain('title="Strikes on &quot;Kharkiv&quot; &lt;updated&gt; · WorldPulse"')
    expect(cardUrl('https://world-pulse.io', OWN, 'light')).toBe(`https://world-pulse.io/embed/story/${OWN}`)
  })

  it("links back to the story's page, tagged as an embedded card", () => {
    expect(cardLink(OWN)).toBe(`https://world-pulse.io/signals/${OWN}?utm_source=embed&utm_medium=card&utm_campaign=story`)
  })
})

describe('StoryCardView', () => {
  it('shows the headline, the count, the outlets and one link back', () => {
    const html = renderToStaticMarkup(<StoryCardView card={card()} theme="light" id={OWN} />)
    expect(html).toContain('Zelensky meets Trump envoy Witkoff in Norway')
    expect(html).toContain('✓ Verified · 112 outlets')
    expect(html).toContain('cbsnews.com, dw.com, bbc.co.uk and 109 more')
    expect(html).toContain('Updated Oct 20, 17:13 UTC')
    expect(html).toContain('See every outlet on WorldPulse')
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain(`href="https://world-pulse.io/signals/${OWN}?utm_source=embed&amp;utm_medium=card&amp;utm_campaign=story"`)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('background:#ffffff')
  })

  it('has its dark colours on a dark page, and says when a story has one outlet', () => {
    const html = renderToStaticMarkup(<StoryCardView card={card({ outlets: 1, verified: false, named: ['cbsnews.com'] })} theme="dark" id={OWN} />)
    expect(html).toContain('background:#0d0f18')
    expect(html).toContain('>1 outlet<')
    expect(html).toContain('Only cbsnews.com so far')
    expect(html).toContain('Follow this story on WorldPulse')
    expect(html).not.toContain('See every outlet')
  })

  it('says so when the story is gone or could not be loaded', () => {
    expect(renderToStaticMarkup(<StoryCardView card="missing" theme="light" id={OWN} />)).toContain('This story is no longer on WorldPulse.')
    const busy = renderToStaticMarkup(<StoryCardView card="unavailable" theme="light" id={OWN} />)
    expect(busy).toContain('could not load this story just now')
    expect(busy).toContain(`/signals/${OWN}?utm_source=embed`)
  })
})

describe('fetchStoryCard and /embed/story/<id>', () => {
  beforeEach(() => clearServerFetchCache())
  afterEach(() => { vi.unstubAllGlobals() })

  it("reads the story's answer from the API", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: answer })))
    vi.stubGlobal('fetch', fetchMock)
    const c = await fetchStoryCard(OWN)
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(new RegExp(`/api/v1/stories/${OWN}$`))
    expect(c).toMatchObject({ id: OWN, outlets: 112, verified: true })
  })

  it("tells a missing story from an API that didn't answer, and asks nothing for a bad id", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    expect(await fetchStoryCard(OWN)).toBe('missing')
    clearServerFetchCache()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    expect(await fetchStoryCard(OWN)).toBe('unavailable')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchStoryCard('week')).toBe('missing')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is the card in the theme the address asks for', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: answer }))))
    const page = await EmbedStoryPage({ params: Promise.resolve({ id: OWN }), searchParams: Promise.resolve({ theme: 'dark' }) })
    const html = renderToStaticMarkup(page)
    expect(html).toContain('background:#0d0f18')
    expect(html).toContain('✓ Verified · 112 outlets')
  })
})

describe('"Embed this card" in Share', () => {
  const src = (f: string) => readFileSync(path.resolve(__dirname, '..', f), 'utf8')

  it("is offered on a story's page only, not on the home page or the people pages", () => {
    expect(src('app/signals/[id]/SignalDetailClient.tsx')).toContain('<ShareMenu title={signal.title} embedId={signal.id} />')
    for (const f of ['app/entities/[slug]/page.tsx', 'app/entities/page.tsx', 'app/page.tsx']) expect(src(f)).not.toContain('embedId')
    expect(src('components/signals/ShareMenu.tsx')).toMatch(/\{embedId && \(\s*<button role="menuitem" onClick=\{\(\) => setEmbedding\(true\)\}/)
  })

  it('shows the code, a preview and which colours are picked', () => {
    const code = storyEmbedCode('https://world-pulse.io', OWN, 'A story', 'dark')
    const html = renderToStaticMarkup(
      <EmbedCardPanel code={code} previewSrc={cardUrl('https://world-pulse.io', OWN, 'dark')} theme="dark" copied={false} onTheme={() => {}} onCopy={() => {}} />,
    )
    expect(html).toContain('EMBED THIS CARD')
    expect(html).toContain(`src="https://world-pulse.io/embed/story/${OWN}?theme=dark"`)
    expect(html).toContain('aria-label="Embed code"')
    expect(html).toContain(`/embed/story/${OWN}?theme=dark&quot;`)
    expect(html).toMatch(/aria-pressed="true"[^>]*>Dark</)
    expect(html).toMatch(/aria-pressed="false"[^>]*>Light</)
    expect(html).toContain('Copy code')
  })
})
