/**
 * The privacy policy (Nov 11, 2026): the AI directories ask for one, and /privacy answered 404. It says what the code
 * keeps.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PrivacyPage, { metadata, PRIVACY_UPDATED } from '@/app/privacy/page'
import sitemap from '@/app/sitemap'

describe('the privacy policy', () => {
  const html = renderToStaticMarkup(<PrivacyPage />)

  it('says what is kept and who else sees it', () => {
    expect(html).toContain(`Last updated: ${PRIVACY_UPDATED}`)
    for (const id of ['short', 'reading', 'account', 'payments', 'emails', 'alerts', 'sharing', 'choices', 'children', 'changes']) {
      expect(html).toContain(`id="${id}"`)
    }
    expect(html).toContain('we don’t use advertising or tracking cookies')
    expect(html).toContain('keep only a daily count of how often each tool was used')
    expect(html).toContain('Stripe, Resend and our hosting provider')
    expect(html).toContain('mailto:support@world-pulse.io')
  })

  it('is its own page in search', async () => {
    expect(String(metadata.title)).toMatch(/Privacy policy/)
    const pages = await sitemap()
    expect(pages.some(p => p.url.endsWith('/privacy'))).toBe(true)
  })
})
