import { describe, it, expect } from 'vitest'
import {
  fairZ, zeroFilledStats, fairAnomalies, liveSpikes, liveMinCount,
  sharedSubject, sameEvent, sensibleLinks, honestScore,
} from '../cortex/honest'

describe('fairZ', () => {
  it('gives small counts a fair spread', () => {
    // 5 culture reports in Rome against 1.4 a day with a 0.55 spread read as 6.5σ before
    expect((5 - 1.4) / 0.55).toBeGreaterThan(6)
    expect(fairZ(5, 1.4, 0.55)).toBeLessThan(3.1)
  })
  it('keeps big, steady numbers as they are', () => {
    expect(fairZ(200, 100, 20)).toBeCloseTo(5, 5)
  })
  it('never divides by less than 1', () => {
    expect(fairZ(3, 0, 0)).toBe(3)
  })
})

describe('zeroFilledStats', () => {
  it('counts missing days as 0', () => {
    const { avg, sd } = zeroFilledStats([3, 3, 3], 30)
    expect(avg).toBeCloseTo(0.3, 5)
    expect(sd).toBeGreaterThan(0.8)
  })
  it('handles a full window', () => {
    expect(zeroFilledStats([2, 4], 2)).toEqual({ avg: 3, sd: Math.sqrt(2) })
  })
})

describe('fairAnomalies', () => {
  const steady = (v: number, days = 30) => Array.from({ length: days }, () => v)
  it('keeps a real spike', () => {
    const out = fairAnomalies([{ category: 'conflict', region: 'Yemen', current: 32, history: steady(5) }])
    expect(out).toHaveLength(1)
    expect(out[0]!.direction).toBe('above')
    expect(out[0]!.z_score).toBeGreaterThan(4)
  })
  it('drops tiny counts and places barely seen', () => {
    expect(fairAnomalies([{ category: 'culture', region: 'Rome', current: 4, history: [1, 1, 2, 1] }])).toHaveLength(0)
    expect(fairAnomalies([{ category: 'tech', region: 'New place', current: 40, history: [1, 1] }])).toHaveLength(0)
  })
  it('only reports drops where there is usually plenty', () => {
    expect(fairAnomalies([{ category: 'sports', region: 'Lagos', current: 0, history: steady(3) }])).toHaveLength(0)
    const big = fairAnomalies([{ category: 'economy', region: 'global', current: 100, history: steady(400) }])
    expect(big[0]?.direction).toBe('below')
  })
})

describe('liveSpikes', () => {
  it('compares the last hours with the same hours on the days before', () => {
    const rows = [
      { category: 'conflict', region: 'Aden', day_back: 0, count: 14 },
      { category: 'conflict', region: 'Aden', day_back: 1, count: 1 },
      { category: 'conflict', region: 'Aden', day_back: 3, count: 2 },
      { category: 'economy', region: 'London', day_back: 0, count: 6 },
      ...[1, 2, 3, 4, 5, 6, 7].map(d => ({ category: 'economy', region: 'London', day_back: d, count: 6 })),
    ]
    const out = liveSpikes(rows, { hours: 6 })
    expect(out.map(s => s.region)).toEqual(['Aden'])
    expect(out[0]!.count).toBe(14)
    expect(out[0]!.usual).toBeCloseTo(3 / 7, 2)
    expect(out[0]!.days_seen).toBe(2)
  })
  it('needs enough reports for the window', () => {
    expect(liveMinCount(6)).toBe(4)
    expect(liveMinCount(24)).toBe(10)
    expect(liveSpikes([{ category: 'x', region: 'y', day_back: 0, count: 3 }], { hours: 6 })).toHaveLength(0)
  })
})

describe('sharedSubject', () => {
  it('finds a shared name', () => {
    expect(sharedSubject('Netanyahu says spoke with Syria’s Sharaa', '‘Main suspect’: Syria arrests Assad-era paramilitary')).toEqual(['syria'])
  })
  it('rejects headlines that share nothing real', () => {
    expect(sharedSubject('New White House press secretary defends her background', 'Charlie Cunnion named as Massport new port director')).toBeNull()
  })
})

describe('sensibleLinks', () => {
  it('counts links with shared entities or subjects, and entity links', () => {
    const r = sensibleLinks({
      causal_chains: [
        { cause: { title: 'a' }, effect: { title: 'b' }, shared_entities: ['Houthis'] },
        { cause: { title: 'Kozhikode traders protest' }, effect: { title: 'Kozhikode leader booked' } },
        { cause: { title: 'press secretary' }, effect: { title: 'port director' } },
      ],
      cross_cluster_bridges: [{ signal_title: 'x', thread_a: { title: 'y' }, thread_b: { title: 'z' } }],
      entity_links: [{}, {}],
    })
    expect(r).toEqual({ sensible: 4, total: 6, duplicates: 0 })
  })
  it('handles no report', () => {
    expect(sensibleLinks(null)).toEqual({ sensible: 0, total: 0, duplicates: 0 })
  })
  it('does not count one event told twice', () => {
    const twice = { a: { title: 'DR Congo: Kabila’s move towards M23 raises questions over the peace deal' }, b: { title: "DR Congo: Kabila's move towards M23 rebels raises questions" } }
    const real = { a: { title: 'IN BRIEF: Lukashenko comments on preparations for war to avoid it' }, b: { title: 'Lukashenko denies Belarus breached Latvian border as experts claim intelligence operation' } }
    expect(sensibleLinks({ entity_links: [twice, real] })).toEqual({ sensible: 1, total: 2, duplicates: 1 })
    expect(sensibleLinks({ causal_chains: [{ cause: twice.a, effect: twice.b, shared_entities: ['Joseph Kabila'] }] })).toEqual({ sensible: 0, total: 1, duplicates: 1 })
  })
})

describe('sameEvent', () => {
  it('spots two outlets’ headlines for one event', () => {
    expect(sameEvent('Diri counters Donald Duke, says Lagos-Calabar coastal highway will go on', 'Gov Diri: Donald Duke wrong on Lagos-Calabar coastal highway')).toBe(true)
  })
  it('keeps different events apart', () => {
    expect(sameEvent('Pope Leo diagnosed with cancer as doctors remove part of lung', "Pope 'wants to make the trip to Latin America'")).toBe(false)
    expect(sameEvent('', 'anything at all')).toBe(false)
  })
})

describe('honestScore', () => {
  const base = {
    multiSourceRate: 0.089, avgReliability: 0.77, embeddingCoverage: 66.9,
    entityCoverage: 40, threadCoverage: 0.5, baselineDays: 52, sensibleLinks: 4, linksClaimed: 6,
  }
  it('scores honest parts out of 100', () => {
    const s = honestScore(base)
    expect(s.parts.map(p => p.key)).toEqual(['corroboration', 'reliability', 'embeddings', 'entities', 'threads', 'baselines', 'patterns'])
    expect(s.score).toBeGreaterThan(40)
    expect(s.score).toBeLessThan(60)
    expect(s.left_out).toEqual([])
  })
  it('leaves out a part it could not read instead of counting it as 0', () => {
    const missing = honestScore({ ...base, threadCoverage: null })
    const zero = honestScore({ ...base, threadCoverage: 0 })
    expect(missing.left_out).toEqual(['Reports in story threads'])
    expect(missing.score).toBeGreaterThan(zero.score)
    // the swing that read 74 → 64: one part flipping between full and 0
    expect(honestScore({ ...base, threadCoverage: 1 }).score - zero.score).toBeGreaterThan(5)
    expect(Math.abs(missing.score - honestScore({ ...base }).score)).toBeLessThan(5)
  })
  it('scores links by the share that hold up, not by how many there are', () => {
    const part = (o: Partial<typeof base>) => honestScore({ ...base, ...o }).parts.find(p => p.key === 'patterns')
    // 39 links of which 20 hold up scored 15 of 15 by count; by share it is about half
    expect(part({ sensibleLinks: 20, linksClaimed: 39 })!.got).toBeCloseTo(7.7, 1)
    expect(part({ sensibleLinks: 0, linksClaimed: 74 })!.got).toBe(0)
    expect(part({ sensibleLinks: 12, linksClaimed: 12 })!.got).toBe(15)
    // a few perfect links don't get full marks
    expect(part({ sensibleLinks: 3, linksClaimed: 3 })!.got).toBe(4.5)
    // no links claimed (the pattern pass hasn't run): left out, not 0
    expect(honestScore({ ...base, sensibleLinks: 0, linksClaimed: 0 }).left_out).toContain('Claimed links that hold up')
  })
})
