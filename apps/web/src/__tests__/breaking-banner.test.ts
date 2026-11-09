/**
 * The breaking banner (Nov 9, 2026: back on; Devon: "the banner should always be accurate"): the last few hours of
 * the API's news-only list, newest first, each with its outlet count, never on embeds or the full-screen map.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { alertHref, bannerAlerts, bannerHiddenOn, proofText, timeAgo, BANNER_HOURS, type BannerAlert } from '../lib/breaking-banner'

const NOW = Date.parse('2026-11-09T13:00:00.000Z')
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString()
const alert = (alertId: string, min: number, extra: Partial<BannerAlert> = {}): BannerAlert => ({
  alertId, signalId: `${alertId}-report`, title: `Alert ${alertId}`, severity: 'high', timestamp: ago(min), expiresAt: new Date(NOW + 3_600_000).toISOString(), ...extra,
})

describe('bannerAlerts', () => {
  it('keeps the last few hours, not expired, not closed here, newest first', () => {
    const list = [
      alert('old', BANNER_HOURS * 60 + 5),
      alert('a', 50),
      alert('b', 5),
      alert('closed', 1),
      alert('gone', 2, { expiresAt: ago(1) }),
    ]
    expect(bannerAlerts(list, NOW, new Set(['closed'])).map(a => a.alertId)).toEqual(['b', 'a'])
  })
})

describe('proofText', () => {
  it('says how many outlets carry the story and whether it is verified', () => {
    expect(proofText({ id: 's', outlets: 14, verified: true, countries: 13, page: 'p' })).toBe('Verified · 14 outlets in 13 countries')
    expect(proofText({ id: 's', outlets: 3, verified: false, countries: 2, page: 'p' })).toBe('3 outlets so far in 2 countries, not verified yet')
    expect(proofText({ id: 's', outlets: 1, verified: false, countries: 0, page: 'p' })).toBe('1 outlet so far · unconfirmed')
    expect(proofText(null)).toBe('')
  })
})

describe('where and what it opens', () => {
  it('never shows on embeds or the full-screen map', () => {
    expect(bannerHiddenOn('/embed/signal/x')).toBe(true)
    expect(bannerHiddenOn('/map')).toBe(true)
    expect(bannerHiddenOn('/')).toBe(false)
    expect(bannerHiddenOn('/signals/abc')).toBe(false)
  })

  it('opens the story\'s own page when the API gives it', () => {
    expect(alertHref({ signalId: 'r1', story: { id: 's', outlets: 2, verified: true, countries: 2, page: 'canon' } })).toBe('/signals/canon')
    expect(alertHref({ signalId: 'r1', story: null })).toBe('/signals/r1')
    expect(timeAgo(ago(12), NOW)).toBe('12m ago')
  })

  it('is on every page again, under the top menu, with no connection of its own and no closing for everyone', () => {
    const layout = readFileSync(join(__dirname, '../app/layout.tsx'), 'utf8')
    expect(layout).toMatch(/^import \{ BreakingAlertBanner \} from '@\/components\/alerts\/BreakingAlertBanner'$/m)
    expect(layout).toMatch(/<TopNav \/><\/HideOnEmbed>\s*\{\/\*[^*]*\*\/\}\s*<BreakingAlertBanner \/>/)
    const banner = readFileSync(join(__dirname, '../components/alerts/BreakingAlertBanner.tsx'), 'utf8')
    expect(banner).toContain('top-[52px]')
    expect(banner).not.toContain('new WebSocket')
    expect(banner).not.toContain('/dismiss')
  })
})
