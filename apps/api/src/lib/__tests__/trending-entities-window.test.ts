/**
 * The side panel's "Trending entities" box counts reports inside its window
 * (Oct 20, 2026): it showed each entity's all-time count under "24h"
 * (UN 7,212 while about 8,100 reports came in that day).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { trendingEntityRows, KG_TYPE_FOR_API } from '../trending-entities'

const item = (id: string, name: string, type: string, recent: number | string) =>
  ({ entity: { id, type, canonical_name: name }, recent_mentions: recent })

describe('trendingEntityRows', () => {
  const items = [
    item('un', 'UN', 'organisation', 161),
    item('us', 'United States', 'location', 597),
    item('oil', 'Petroleum products', 'commodity', 72),
    item('trump', 'Donald Trump', 'person', '316'),
    item('war', 'Gaza ceasefire', 'event', 40),
  ]

  it("counts each entity's reports in the window, most named first", () => {
    expect(trendingEntityRows(items, 'all', 10).map(r => [r.name, r.count]))
      .toEqual([['United States', 597], ['Donald Trump', 316], ['UN', 161], ['Gaza ceasefire', 40]])
  })

  it('leaves goods out of "all", keeps them under "topic", and stops at the limit', () => {
    expect(trendingEntityRows(items, 'topic', 10).map(r => r.name)).toEqual(['Petroleum products', 'Gaza ceasefire'])
    expect(trendingEntityRows(items, 'all', 2)).toHaveLength(2)
    expect(trendingEntityRows([item('', 'No id', 'person', 3), item('x', 'Zero', 'person', 0)], 'all', 5)).toEqual([])
    expect(trendingEntityRows(null, 'all', 5)).toEqual([])
  })

  it("asks the knowledge graph for one type when the box's filter is one type", () => {
    expect(KG_TYPE_FOR_API.actor).toBe('person')
    expect(KG_TYPE_FOR_API.country).toBe('location')
    expect(KG_TYPE_FOR_API.topic).toBeUndefined()
  })

  it('the route counts from /knowledge-graph/trending, not the all-time mention count', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'routes', 'analytics.ts'), 'utf8')
    const kg = src.slice(src.indexOf('// ── Knowledge Graph path'), src.indexOf('// Count total signals analyzed for this window'))
    expect(kg).toContain('/api/v1/knowledge-graph/trending?window_hours=')
    expect(kg).not.toContain('Number(row.mention_count)')
  })
})
