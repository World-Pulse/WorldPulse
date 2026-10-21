/**
 * world-pulse.io/check, "Has more than one newsroom reported this?" (paste a
 * link, get the count, version 1, Oct 20, 2026): what it says for each answer
 * of GET /api/v1/stories/by-link, and where it can be found.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import en from '../../messages/en.json'

vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: vi.fn() }) }))

const { byLinkUrl, checkView, failureMessage } = await import('@/lib/link-check')
const { default: CheckPage, metadata } = await import('@/app/check/page')
const { LeftSidebar } = await import('@/components/sidebar/LeftSidebar')

const REPORT = '22222222-2222-4222-8222-222222222222'
const found = (story: Record<string, unknown>, report: Record<string, unknown> = {}) => ({
  found: true,
  link: `https://world-pulse.io/signals/${REPORT}`,
  report: { id: REPORT, title: 'Swimmer, 65, killed in shark attack', outlet: 'bbc.com', ...report },
  story: { id: 's1', outlets: 12, outletNames: ['abc.net.au', 'bbc.com', 'cnn.com', 'smh.com.au'], verified: true, verifiedAt: '2026-10-20T16:40:00Z', size: 20, ...story },
})

describe('checkView', () => {
  it('a verified story: the count, its outlets (this one first) and what verified means', () => {
    const v = checkView(found({}))
    expect(v).toMatchObject({
      kind: 'found', title: 'Swimmer, 65, killed in shark attack', outlet: 'bbc.com',
      count: '✓ Verified · 12 outlets', verified: true, outlets: 'bbc.com, abc.net.au, cnn.com and 9 more',
      href: `/signals/${REPORT}?utm_source=check&utm_medium=web&utm_campaign=link-check`,
    })
    expect(v.kind === 'found' && v.verdict).toMatch(/not that it is proven true/)
  })

  it('several outlets but not verified, and one outlet so far', () => {
    const several = checkView(found({ outlets: 3, verified: false, verifiedAt: null }))
    expect(several).toMatchObject({ count: '3 outlets', verified: false })
    expect(several.kind === 'found' && several.verdict).toMatch(/isn’t verified yet/)
    const one = checkView(found({ outlets: 1, outletNames: ['bbc.com'], verified: false, verifiedAt: null }))
    expect(one).toMatchObject({ count: '1 outlet', outlets: 'Only bbc.com so far' })
    expect(one.kind === 'found' && one.verdict).toMatch(/^Only one outlet so far: treat it as unconfirmed/)
  })

  it("a story that has run longer: its last two days' count, and since it began (Oct 20, 2026)", () => {
    const v = checkView(found({ outlets: 48, outletsAll: 143, firstReportAt: '2026-10-10T15:00:00.000Z' }))
    expect(v).toMatchObject({ count: '✓ Verified · 48 outlets', since: 'in its last 2 days · 143 since Oct 10', outlets: 'bbc.com, abc.net.au, cnn.com and 45 more' })
    expect(checkView(found({}))).toMatchObject({ since: '' })
    // an old article: the verdict goes by everyone since it began, and its own
    // outlet isn't named among the last two days' when it isn't one of them
    const old = checkView(found({ outlets: 1, outletNames: ['cnn.com'], outletsAll: 5, verified: false, verifiedAt: null }))
    expect(old).toMatchObject({ count: '1 outlet', since: 'in its last 2 days · 5 since it began', outlets: 'Only cnn.com so far' })
    expect(old.kind === 'found' && old.verdict).toMatch(/^5 outlets reported this story, but it isn’t verified yet/)
  })

  it('says why there is nothing to show', () => {
    expect(checkView({ found: false, reason: 'not_seen' })).toEqual({ kind: 'missing', message: expect.stringMatching(/hasn’t collected this article/) })
    expect(checkView({ found: false, reason: 'pending' })).toEqual({ kind: 'missing', message: expect.stringMatching(/adding this article right now/) })
    expect(checkView({ found: false, reason: 'not_an_article' })).toEqual({ kind: 'missing', message: expect.stringMatching(/not a home page/) })
    expect(checkView({ found: false, reason: 'something new' })).toEqual({ kind: 'missing', message: expect.stringMatching(/hasn’t collected/) })
  })

  it('version 2: a story found by the page\'s headline says so; and why nothing was found', () => {
    const similar = checkView({ ...found({}), match: 'similar', page: { title: 'Shark kills swimmer off Sydney beach', site: 'Example' } })
    expect(similar).toMatchObject({ kind: 'found', title: 'Swimmer, 65, killed in shark attack', similarTo: 'Shark kills swimmer off Sydney beach' })
    expect(checkView(found({}))).toMatchObject({ similarTo: null })
    expect(checkView({ found: false, reason: 'not_seen', opened: true, page: { title: 'Zoo welcomes twin red panda cubs' } }))
      .toEqual({ kind: 'missing', message: expect.stringMatching(/read this page’s headline, “Zoo welcomes twin red panda cubs”, and has no story telling the same event in the last week/) })
    expect(checkView({ found: false, reason: 'not_seen', opened: false, why: 'not_public' }))
      .toEqual({ kind: 'missing', message: expect.stringMatching(/^That address isn’t a public web page\. WorldPulse hasn’t collected/) })
    expect(checkView({ found: false, reason: 'not_seen', opened: false, why: 'timeout' }))
      .toEqual({ kind: 'missing', message: expect.stringMatching(/^WorldPulse couldn’t open that page/) })
    expect(checkView({ found: false, reason: 'busy' })).toEqual({ kind: 'missing', message: expect.stringMatching(/Try again in a few minutes/) })
  })

  it("asks the API with the link, and says what went wrong when it couldn't answer", () => {
    expect(byLinkUrl(' https://www.bbc.com/news/a?x=1&y=2 ')).toBe('https://api.world-pulse.io/api/v1/stories/by-link?url=https%3A%2F%2Fwww.bbc.com%2Fnews%2Fa%3Fx%3D1%26y%3D2')
    expect(failureMessage(429)).toMatch(/Too many checks/)
    expect(failureMessage(500)).toMatch(/couldn’t check that just now/)
  })
})

describe('the /check page', () => {
  it('asks its question, has the form and says what the count can and cannot tell', () => {
    const html = renderToStaticMarkup(<CheckPage />)
    expect(html).toContain('Has more than one newsroom reported this?')
    expect(html).toContain('role="search"')
    expect(html).toContain('type="url"')
    // version 2 (Oct 21, 2026): it says it may open the page to read its headline
    expect(html).toContain('opens that page once, only to read its headline (public web pages only)')
    expect(html).toContain('href="/how-we-count"')
    expect(String(metadata.title)).toBe('Has more than one newsroom reported this? Check a link — WorldPulse')
  })

  it('is in the menu, the sitemap and on the counting page', () => {
    expect(renderToStaticMarkup(<LeftSidebar />)).toContain('href="/check"')
    expect(en.nav.checkLink).toBe('Check a Link')
    const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
    expect(read('app/sitemap.ts')).toContain("{ path: '/check',")
    expect(read('app/how-we-count/page.tsx')).toContain('href="/check"')
  })
})
