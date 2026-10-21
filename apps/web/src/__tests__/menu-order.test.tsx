/**
 * The left menu leads with what WorldPulse is for, and keeps every section
 * (Devon, Oct 20, 2026, option B: "nothing removed"): the stories, the map,
 * the Daily Briefing, the Week, Check a Link, In the News, the countries and
 * How We Count first, then every other section as before.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import en from '../../messages/en.json'

vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: vi.fn() }) }))

const { LeftSidebar } = await import('@/components/sidebar/LeftSidebar')

const MAIN = ['/', '/map', '/briefing', '/week', '/check', '/entities', '/countries', '/how-we-count']
const OTHERS = [
  '/alerts', '/analytics', '/explore', '/knowledge-graph/explorer', '/finance', '/maritime', '/sanctions',
  '/internet-outages', '/cyber-threats', '/undersea-cables', '/governance', '/food-security', '/digital-rights', '/water-security',
  '/labor-rights', '/patents', '/communities', '/claims', '/sources', '/developers', '/settings', '/status',
]

describe('the left menu', () => {
  const html = renderToStaticMarkup(<LeftSidebar />)
  const nav = html.slice(html.indexOf('aria-label="Primary navigation"'), html.indexOf('aria-label="Signal channels"'))
  const hrefs = [...nav.matchAll(/href="([^"]+)"/g)].map(m => m[1])

  it('starts with the main sections, in order', () => {
    expect(hrefs.slice(0, MAIN.length)).toEqual(MAIN)
    expect(en.nav.howWeCount).toBe('How We Count')
    expect(en.nav.checkLink).toBe('Check a Link')
  })

  it('keeps every other section, after a line', () => {
    expect(hrefs.slice(MAIN.length)).toEqual(OTHERS)
    expect(nav).toContain('h-px')
  })

  it('keeps the threat index, the signal channels and trending', () => {
    expect(html).toContain('Global Threat Index')
    expect(html).toContain('href="/c/conflict"')
    expect(html).toContain(en.nav.trendingNow)
  })
})
