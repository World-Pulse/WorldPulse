/**
 * "How sure are we" on a story's page (plan P2, step 1), in the same words as
 * world-pulse.io/check: the story's count, what it means, and where the
 * counting is explained.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { howSure } from '@/lib/how-sure'
import { HowSureBlock } from '@/components/signals/HowSureBlock'
import { checkView } from '@/lib/link-check'

describe('howSure', () => {
  it('a verified story: the count, and that verified is not proven true', () => {
    expect(howSure({ verified: true, outlets: 12 })).toEqual({
      tone: 'verified', count: '✓ Verified · 12 outlets', since: '',
      verdict: expect.stringMatching(/reliability score reached 65%.*not that it is proven true\.$/),
    })
  })

  it('a story that has run longer: its last two days, and since it began', () => {
    expect(howSure({ verified: true, outlets: 48, outletsAll: 143, firstReportAt: '2026-10-10T15:00:00.000Z' }))
      .toMatchObject({ count: '✓ Verified · 48 outlets', since: 'in its last 2 days · 143 since Oct 10' })
  })

  it('several outlets but not verified: what verifying takes', () => {
    expect(howSure({ verified: false, outlets: 3 })).toMatchObject({
      tone: 'multi', count: '3 outlets',
      verdict: '3 outlets reported this story, but it isn’t verified yet: that takes two or more independent outlets and a reliability score of 65%.',
    })
  })

  it("one outlet: unconfirmed, not false; and a long story isn't one outlet because one reported it lately", () => {
    expect(howSure({ verified: false, outlets: 1 })).toMatchObject({ tone: 'single', count: '1 outlet', verdict: expect.stringMatching(/^Only one outlet so far/) })
    expect(howSure({ verified: false, outlets: 1, outletsAll: 5 })).toMatchObject({ tone: 'multi', count: '1 outlet', since: 'in its last 2 days · 5 since it began', verdict: expect.stringMatching(/^5 outlets reported this story/) })
    // nothing below one outlet
    expect(howSure({ verified: false, outlets: 0 }).count).toBe('1 outlet')
  })

  it('says the same as the link checker', () => {
    const v = checkView({ found: true, report: { id: 'r1', outlet: 'bbc.com' }, story: { outlets: 3, outletNames: ['bbc.com', 'dw.com', 'cnn.com'], verified: false } })
    expect(v.kind === 'found' && [v.count, v.verdict]).toEqual([howSure({ verified: false, outlets: 3 }).count, howSure({ verified: false, outlets: 3 }).verdict])
  })
})

describe('HowSureBlock', () => {
  it('shows the count, the note since it began, the verdict and the two links', () => {
    const html = renderToStaticMarkup(<HowSureBlock sure={howSure({ verified: true, outlets: 48, outletsAll: 143, firstReportAt: '2026-10-10T15:00:00.000Z' })} />)
    expect(html).toContain('aria-label="How sure are we"')
    expect(html).toContain('✓ Verified · 48 outlets')
    expect(html).toContain('in its last 2 days · 143 since Oct 10')
    expect(html).toContain('not that it is proven true')
    expect(html).toContain('href="/how-we-count"')
    expect(html).toContain('href="/check"')
    expect(html).toContain('text-wp-green')
  })

  it("colours a story that isn't verified apart from a verified one", () => {
    expect(renderToStaticMarkup(<HowSureBlock sure={howSure({ verified: false, outlets: 3 })} />)).toContain('text-wp-amber')
    const one = renderToStaticMarkup(<HowSureBlock sure={howSure({ verified: false, outlets: 1 })} />)
    expect(one).not.toContain('text-wp-green')
    expect(one).not.toContain('since')
  })
})
