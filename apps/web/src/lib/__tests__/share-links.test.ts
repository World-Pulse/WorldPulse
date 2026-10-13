/**
 * Share links and the story's share picture text (plan G3, Oct 11, 2026).
 */

import { describe, it, expect } from 'vitest'
import { shareLinks, withUtm } from '../share-links'
import { storyCardText } from '../story-card'

const URL_ = 'https://world-pulse.io/signals/a66f30e5-9cfb-49b1-adbd-90fa6cb6e9a1'

describe('shareLinks', () => {
  it("opens each network's post box with the story and a tagged link", () => {
    const links = shareLinks(URL_, 'At least 139 migrants dead after boat capsizes')
    expect(links.map(l => l.network)).toEqual(['x', 'linkedin', 'telegram', 'bluesky', 'whatsapp'])
    const x = new URL(links[0]!.href)
    expect(x.origin + x.pathname).toBe('https://x.com/intent/post')
    expect(x.searchParams.get('text')).toBe('At least 139 migrants dead after boat capsizes')
    expect(x.searchParams.get('via')).toBe('WorldPulse_io')
    const shared = new URL(x.searchParams.get('url')!)
    expect(shared.searchParams.get('utm_source')).toBe('x')
    expect(shared.searchParams.get('utm_medium')).toBe('share')
    expect(new URL(links[1]!.href).searchParams.get('url')).toContain('utm_source=linkedin')
  })

  it('tags each kind of page with its own campaign', () => {
    const story = new URL(new URL(shareLinks(URL_, 'A story')[0]!.href).searchParams.get('url')!)
    expect(story.searchParams.get('utm_campaign')).toBe('story')
    const entity = new URL(new URL(shareLinks('https://world-pulse.io/entities/houthis-a84d671cb97c1d91', 'Houthis', 'entity')[0]!.href).searchParams.get('url')!)
    expect(entity.searchParams.get('utm_campaign')).toBe('entity')
    expect(entity.searchParams.get('utm_source')).toBe('x')
    expect(shareLinks(URL_, 'Houthis', 'entity')[3]!.href).toContain(encodeURIComponent('utm_campaign=entity'))
  })

  it('replaces tags already on the address', () => {
    expect(withUtm(`${URL_}?utm_source=old`, 'telegram')).toBe(`${URL_}?utm_source=telegram&utm_medium=share&utm_campaign=story`)
  })
})

describe('storyCardText', () => {
  const story = {
    title: 'At least 139 migrants dead, including some children, after boat from Djibouti to Yemen capsizes, UN agency says',
    severity: 'critical', category: 'disaster', locationName: 'Djibouti', firstReported: '2026-10-11T16:02:02.473Z', status: 'verified',
  }

  it('says how many outlets carry a verified story', () => {
    const t = storyCardText(story, { outlets: 16, verified: true })
    expect(t).toMatchObject({ proof: 'Verified · 16 outlets', verified: true, severity: 'CRITICAL', category: 'Disaster', place: 'Djibouti', when: 'Oct 11, 2026 · 16:02 UTC' })
    expect(t.headlineSize).toBe(50)
  })

  it("says when a story isn't verified yet", () => {
    expect(storyCardText({ ...story, status: 'pending' }, { outlets: 1, verified: false }).proof).toBe('One outlet so far · not yet verified')
    expect(storyCardText({ ...story, status: 'pending' }, { outlets: 3, verified: false }).proof).toBe('3 outlets so far · not yet verified')
    expect(storyCardText(story, null).proof).toBe('Verified')
  })

  it('keeps long headlines to 150 characters, cut at a word', () => {
    const t = storyCardText({ ...story, title: `${'word '.repeat(60)}end` }, null)
    expect(t.headline.length).toBeLessThanOrEqual(150)
    expect(t.headline.endsWith('…')).toBe(true)
    expect(t.headlineSize).toBe(46)
  })
})
