/**
 * Structured data for search engines and AI assistants (K2a, Oct 21, 2026):
 * K2's 20-page check found country pages, /help and /briefing without any,
 * and /briefing without story links a crawler can follow.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { storyListJsonLd, faqJsonLd, jsonLdText } from '../page-metadata'
import HelpPage from '@/app/help/page'

describe('storyListJsonLd', () => {
  const ld = storyListJsonLd({
    path: '/countries/SD',
    name: 'Sudan news today: verified stories',
    description: 'Verified stories about Sudan.',
    stories: [{ id: 'a1', title: 'Drone strike on Abyei market kills at least 153' }, { id: 'b2', title: 'x'.repeat(130) }],
    trail: [{ name: 'Countries', path: '/countries' }, { name: 'Sudan', path: '/countries/SD' }],
  }) as { '@graph': Array<Record<string, any>> }

  it('a CollectionPage listing the stories, each with its page', () => {
    const page = ld['@graph'][0]!
    expect(page['@type']).toBe('CollectionPage')
    expect(page.url).toBe('https://world-pulse.io/countries/SD')
    const items = page.mainEntity.itemListElement
    expect(items[0]).toEqual({ '@type': 'ListItem', position: 1, url: 'https://world-pulse.io/signals/a1', name: 'Drone strike on Abyei market kills at least 153' })
    expect(items[1].name.length).toBe(110)
  })

  it('a breadcrumb from the home page', () => {
    const crumbs = ld['@graph'][1]!.itemListElement.map((c: { name: string; item: string }) => `${c.name} ${c.item}`)
    expect(crumbs).toEqual(['WorldPulse https://world-pulse.io', 'Countries https://world-pulse.io/countries', 'Sudan https://world-pulse.io/countries/SD'])
  })

  it("a headline can't close the script tag", () => {
    expect(jsonLdText(storyListJsonLd({ path: '/x', name: 'n', description: 'd', stories: [{ id: 'a', title: '</script><b>' }], trail: [] }))).not.toContain('</script>')
  })
})

describe('the help page', () => {
  it('carries every question and its answer as FAQPage data, in plain words', () => {
    const html = renderToStaticMarkup(<HelpPage />)
    const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1]!
    const faq = JSON.parse(json) as { '@type': string; mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> }
    expect(faq['@type']).toBe('FAQPage')
    const shown = (html.match(/<h2[^>]*>/g) ?? []).length
    expect(faq.mainEntity).toHaveLength(shown)
    expect(shown).toBeGreaterThanOrEqual(11)
    for (const q of faq.mainEntity) expect(q.acceptedAnswer.text.length).toBeGreaterThan(20)
    expect(faq.mainEntity.find(q => q.name === 'What does "verified" mean?')!.acceptedAnswer.text).toContain('not "proven true"')
  })

  it('faqJsonLd', () => {
    expect(faqJsonLd([{ q: 'Q?', text: 'A.' }])).toEqual({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: [{ '@type': 'Question', name: 'Q?', acceptedAnswer: { '@type': 'Answer', text: 'A.' } }],
    })
  })
})

describe('the pages that list stories', () => {
  const app = join(__dirname, '..', '..', 'app')
  it('country pages and the briefing put their stories in the first HTML as structured data and links', () => {
    const country = readFileSync(join(app, 'countries', '[code]', 'layout.tsx'), 'utf8')
    const briefing = readFileSync(join(app, 'briefing', 'layout.tsx'), 'utf8')
    for (const src of [country, briefing]) {
      expect(src).toContain('storyListJsonLd(')
      expect(src).toContain('application/ld+json')
      expect(src).toContain('<Link href={`/signals/${s.id}`}>')
    }
  })
})
