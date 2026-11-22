/**
 * The terms of use (drafted Nov 22, 2026; Devon approves the wording before it goes up): ChatGPT's and Google's app
 * directories ask for one. Its numbers are the ones the code and the other pages use.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import TermsPage, { metadata, TERMS_UPDATED, OPERATOR } from '@/app/terms/page'
import sitemap from '@/app/sitemap'
import { PRO_PRICE_TEXT } from '@/lib/pro-plan'

const api = (p: string) => readFileSync(join(__dirname, '..', '..', '..', 'api', 'src', p), 'utf8')

describe('the terms of use', () => {
  const html = renderToStaticMarkup(<TermsPage />).replace(/<!-- -->/g, '')

  it('cover the site, the API, the feeds and the AI tools, with every section', () => {
    expect(html).toContain(`Last updated: ${TERMS_UPDATED}`)
    for (const id of ['what', 'use', 'content', 'accounts', 'pro', 'code', 'no-guarantees', 'law', 'changes']) expect(html).toContain(`id="${id}"`)
    expect(html).toContain('api.world-pulse.io/mcp')
    expect(html).toContain('It doesn’t mean the story is proven true')
    expect(String(metadata.title)).toMatch(/Terms of use/)
  })

  it('say what llms.txt says about using the data', () => {
    const llms = readFileSync(join(__dirname, '..', 'app', 'llms.txt', 'route.ts'), 'utf8')
    expect(llms).toContain('Personal, research, education and non-profit use of the hosted API is free, with a link back to world-pulse.io.')
    expect(html).toContain('Personal, research, education and non-profit use is free, with a link back to world-pulse.io.')
    expect(llms).toContain('Reselling or redistributing the data needs a data license')
    expect(html).toContain('needs a data license')
  })

  it("give Pro's price and budget as the code has them", () => {
    expect(html).toContain(`Pro costs ${PRO_PRICE_TEXT} a month`)
    expect(api('lib/api-plan.ts')).toContain('PRO_KEY_LIMITS = { perMinute: 600, perDay: 50_000 }')
    expect(html).toContain('600 requests a minute and 50,000 a day')
  })

  it("say what Devon decided (Nov 22, 2026): no refunds, New Jersey law, 13 and over, and his own name as who runs it", () => {
    expect(html).toContain('Payments are not refundable, including for part of a month.')
    expect(html).toContain('governed by the laws of the State of New Jersey')
    expect(html).toContain('You must be at least 13 to make an account.')
    expect(OPERATOR).toBe('Devon Gamba')
    expect(html).toContain('These terms cover WorldPulse (world-pulse.io), run by Devon Gamba:')
  })

  it('are in the sitemap and linked from the privacy policy', async () => {
    expect((await sitemap()).some(p => p.url.endsWith('/terms'))).toBe(true)
    expect(readFileSync(join(__dirname, '..', 'app', 'privacy', 'page.tsx'), 'utf8')).toContain('<Link href="/terms"')
  })
})
