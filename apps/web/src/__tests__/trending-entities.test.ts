/**
 * "Trending now" in the left menu shows who is in the news, with real counts
 * (Oct 20, 2026): it always showed placeholder topics (#WorldPulse, #OSINT,
 * "— signals · Surging") with made-up bars, because the topics endpoint's
 * items carry `tag`, not the `topic` the menu read.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { trendingRows, TRENDING_SHOWN } from '@/lib/trending-entities'

const row = (id: string, name: string, recent: number | string, ratio: number | string | null, isNew = false, type = 'location') =>
  ({ entity: { id, type, canonical_name: name }, recent_mentions: recent, spike_ratio: ratio, is_new: isNew })

describe('trendingRows', () => {
  it('names each one with its real count, and how fast it is rising when it is', () => {
    const rows = trendingRows({ trending: [
      row('b749a2651c6b20e0', 'United States', 597, 1.2),
      row('f0a1b2c3d4e5f6a7', 'Germany', '155', '3.4'),
      row('0011223344556677', 'Kabila', 1, null, true, 'person'),
    ] })
    expect(rows).toEqual([
      { href: '/entities/united-states-b749a2651c6b20e0', name: 'United States', type: 'location', count: '597 reports in 24 h', rise: '' },
      { href: '/entities/germany-f0a1b2c3d4e5f6a7', name: 'Germany', type: 'location', count: '155 reports in 24 h', rise: '↑3.4×' },
      { href: '/entities/kabila-0011223344556677', name: 'Kabila', type: 'person', count: '1 report in 24 h', rise: 'NEW' },
    ])
  })

  it('skips rows without an id, a name or a count, and shows at most five', () => {
    const many = Array.from({ length: 9 }, (_, i) => row(`id${i}abcd`, `Place ${i}`, 10 + i, null))
    expect(trendingRows({ trending: [row('', 'No id', 5, null), row('id_ok1', ' ', 5, null), row('id_ok2', 'Zero', 0, null), ...many] }))
      .toHaveLength(TRENDING_SHOWN)
    expect(trendingRows(null)).toEqual([])
    expect(trendingRows({ trending: [row('c0ffee12', 'Petroleum products', 72, null, false, 'commodity')] })).toEqual([])
    expect(trendingRows({})).toEqual([])
  })

  it('leaves the placeholder topics, the made-up bars and the always-one channel counts out of the menu', () => {
    const src = readFileSync(join(__dirname, '..', 'components/sidebar/LeftSidebar.tsx'), 'utf8')
    for (const gone of ['#OSINT', '#GlobalEvents', 'sparkHeights', '/api/v1/feed/trending', "'surging'"]) expect(src).not.toContain(gone)
    // the channels' counts: a feed page's item count, so every channel said "1"
    expect(src).not.toContain('/api/v1/feed/signals?category=')
    expect(src).toContain('/api/v1/knowledge-graph/trending?limit=')
  })
})
