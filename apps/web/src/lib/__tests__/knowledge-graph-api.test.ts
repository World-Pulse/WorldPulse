import { describe, it, expect } from 'vitest'
import { toTrendingEntities, toGraphStats } from '../knowledge-graph-api'

describe('toTrendingEntities', () => {
  it("flattens the API's { trending: [{ entity, spike_ratio, recent_mentions }] }", () => {
    const json = {
      trending: [
        { entity: { id: 'a1', type: 'organisation', canonical_name: 'UN', mention_count: 6547 }, spike_ratio: 6.3, recent_mentions: 1733, daily_avg: 39 },
        { entity: { id: '', type: 'person', canonical_name: 'nameless' }, spike_ratio: 1, recent_mentions: 1 },
      ],
      window_hours: 168,
    }
    expect(toTrendingEntities(json)).toEqual([
      { id: 'a1', type: 'organisation', canonical_name: 'UN', mention_count: 6547, spike_score: 6.3, recent_signal_count: 1733 },
    ])
  })

  it('passes a flat list through and treats anything else as empty', () => {
    expect(toTrendingEntities([{ id: 'b', type: 'person', canonical_name: 'X', mention_count: 2, spike_score: 2, recent_signal_count: 1 }])[0].spike_score).toBe(2)
    expect(toTrendingEntities({ error: 'nope' })).toEqual([])
    expect(toTrendingEntities(null)).toEqual([])
  })
})

describe('toGraphStats', () => {
  it("reads the API's nested totals (reading them flat crashed the explorer)", () => {
    const stats = toGraphStats({
      entities: { total: 23022, total_mentions: 105390, by_type: { location: 21047, person: '1928' } },
      edges: { total: 18187, avg_weight: '0.150', by_predicate: { co_occurs_with: 18187 } },
    })
    expect(stats).toEqual({
      total_entities: 23022,
      total_edges: 18187,
      entities_by_type: { location: 21047, person: 1928 },
      edges_by_predicate: { co_occurs_with: 18187 },
    })
  })

  it('gives zeros for a missing or broken answer', () => {
    expect(toGraphStats(undefined)).toEqual({ total_entities: 0, total_edges: 0, entities_by_type: {}, edges_by_predicate: {} })
  })
})

describe('focusGraph', () => {
  it('keeps the trending entities, their strongest links, and links among them', async () => {
    const { focusGraph } = await import('../knowledge-graph-api')
    const n = (id: string) => ({ id, mention_count: 1 })
    const e = (source: string, target: string, weight: number) => ({ source, target, weight })
    const nodes = ['A', 'B', 'x1', 'x2', 'x3', 'x4', 'far'].map(n)
    const edges = [e('A', 'x1', 0.9), e('A', 'x2', 0.8), e('A', 'x3', 0.1), e('A', 'B', 0.5), e('B', 'x4', 0.7), e('x4', 'far', 1), e('x1', 'x2', 0.3)]
    const out = focusGraph(['A', 'B'], nodes, edges, 2)
    expect(out.nodes.map(x => x.id).sort()).toEqual(['A', 'B', 'x1', 'x2', 'x4'])
    // links touching a trending entity only; x1–x2 and x4–far are left out
    expect(out.edges.map(x => `${x.source}-${x.target}`).sort()).toEqual(['A-B', 'A-x1', 'A-x2', 'B-x4'])
  })
})
