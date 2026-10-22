/**
 * The world's press, counted (Oct 22, 2026): each GDELT article's countries,
 * kinds of event and tone, per file, from the files the second outlet reads.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { store, sets, ttl } = vi.hoisted(() => ({
  store: new Map<string, Map<string, number>>(),
  sets: new Map<string, Set<string>>(),
  ttl: new Map<string, number>(),
}))
vi.mock('../../lib/redis', () => ({
  redis: {
    sadd: vi.fn(async (key: string, member: string) => {
      const s = sets.get(key) ?? new Set<string>()
      sets.set(key, s)
      if (s.has(member)) return 0
      s.add(member)
      return 1
    }),
    multi: vi.fn(() => {
      const ops: Array<() => void> = []
      const m = {
        hincrby: (key: string, field: string, by: number) => {
          ops.push(() => {
            const h = store.get(key) ?? new Map<string, number>()
            store.set(key, h)
            h.set(field, (h.get(field) ?? 0) + by)
          })
          return m
        },
        expire: (key: string, s: number) => { ops.push(() => { ttl.set(key, s) }); return m },
        exec: async () => { ops.forEach(op => op()); return [] },
      }
      return m
    }),
  },
}))

import { readPulse, recordPulse, backfillStamps, backfillPulse, PULSE_GROUPS, type BackfillDeps } from '../gkg-pulse'
import { fresh } from '../gdelt-articles'

/** A GKG 2.1 line with the fields the pulse reads: 2 collection, 7 V1THEMES, 9 V1LOCATIONS, 15 V1.5TONE */
const line = (themes: string, locations: string, tone: string, collection = '1') => {
  const f = Array.from({ length: 27 }, () => '')
  f[0] = 'x-1'; f[1] = '20261022121500'; f[2] = collection; f[3] = 'example.com'; f[4] = 'https://example.com/a'
  f[7] = themes; f[9] = locations; f[15] = tone
  return f.join('\t')
}
// V1LOCATIONS: type#name#FIPS country#ADM1#lat#long#featureid; Nigeria is NI in FIPS, NG in ISO
const lagos = '4#Lagos, Lagos, Nigeria#NI#NI05#6.45#3.39#-2015245'
const abuja = '4#Abuja, Federal Capital Territory, Nigeria#NI#NI11#9.08#7.53#-1997013'
const nairobi = '4#Nairobi, Nairobi Area, Kenya#KE#KE05#-1.28#36.82#-1977207'

describe('the pulse of one file', () => {
  it('counts each country an article names once, with its tone, and each kind of event once', () => {
    const text = [
      line('PROTEST;TAX_FNCACT_POLICE;ARREST;PROTEST', `${lagos};${abuja}`, '-4.5,1.2,5.7,6.9,20.1,0,300'),
      line('NATURAL_DISASTER_FLOODS;EVACUATION;KILL', `${lagos};${nairobi}`, '-6,0.5,6.5,7,18,0,200'),
      line('PROTEST', lagos, '-2,1,3,4,10,0,100', '2'),     // a broadcast transcript: left out
      line('ECON_INFLATION', '', '1,2,1,3,10,0,100'),       // no place: left out
      '',
    ].join('\n')
    expect(readPulse(text)).toEqual({
      _articles: 2,
      'NG|*|n': 2, 'NG|*|t': -105, 'NG|unrest|n': 1, 'NG|disaster|n': 1, 'NG|casualties|n': 1,
      'KE|*|n': 1, 'KE|*|t': -60, 'KE|disaster|n': 1, 'KE|casualties|n': 1,
    })
  })

  it('adds a file to its hour once, whatever a restart re-reads, and counts the files of the hour', async () => {
    store.clear(); sets.clear(); ttl.clear()
    expect(await recordPulse('20261022121500', { 'NG|*|n': 2, 'NG|*|t': -105, 'NG|unrest|n': 1 })).toBe(true)
    expect(await recordPulse('20261022121500', { 'NG|*|n': 2, 'NG|*|t': -105, 'NG|unrest|n': 1 })).toBe(false)
    expect(await recordPulse('20261022123000', { 'NG|*|n': 1, 'KE|*|n': 3 })).toBe(true)
    expect(await recordPulse('20261022130000', { 'KE|*|n': 1 })).toBe(true)
    expect(Object.fromEntries(store.get('gkg:pulse:2:2026102212')!)).toEqual({ 'NG|*|n': 3, 'NG|*|t': -105, 'NG|unrest|n': 1, 'KE|*|n': 3, _files: 2 })
    expect(Object.fromEntries(store.get('gkg:pulse:2:2026102213')!)).toEqual({ 'KE|*|n': 1, _files: 1 })
    expect([...sets.get('gkg:pulse:2:files:20261022')!]).toEqual(['20261022121500', '20261022123000', '20261022130000'])
    expect(ttl.get('gkg:pulse:2:2026102212')).toBe(9 * 86_400)
    expect(ttl.get('gkg:pulse:2:files:20261022')).toBe(9 * 86_400)
  })

  it('a file with nothing to count still counts as read', async () => {
    store.clear(); sets.clear(); ttl.clear()
    expect(await recordPulse('20261022140000', {})).toBe(true)
    expect(Object.fromEntries(store.get('gkg:pulse:2:2026102214')!)).toEqual({ _files: 1 })
  })

  it('knows the kinds of event WorldPulse follows', () => {
    expect(PULSE_GROUPS.map(([g]) => g)).toEqual(['conflict', 'casualties', 'terror', 'unrest', 'coup', 'disaster', 'health', 'election', 'economy', 'energy', 'shipping', 'cyber', 'displacement', 'sanctions'])
  })

  // version 2 (Oct 22): GDELT's vague or misleading themes, read from a real file, are left out
  it('leaves out vague themes: implied disasters, ICE, every disease, every mention of the sea', () => {
    const kinds = (themes: string) => Object.keys(readPulse(line(themes, lagos, '-1,1,2,3,10,0,100'))).filter(k => k.startsWith('NG|') && !k.startsWith('NG|*')).map(k => k.split('|')[1])
    expect(kinds('MANMADE_DISASTER_IMPLIED;NATURAL_DISASTER;NATURAL_DISASTER_ICE')).toEqual([])
    expect(kinds('TAX_DISEASE;TAX_DISEASE_CANCER;TAX_DISEASE_BRAIN_INJURY')).toEqual([])
    expect(kinds('MARITIME;MILITARY_COOPERATION;UNREST_BELLIGERENT;TAX_WEAPONS_FIREARM')).toEqual([])
    expect(kinds('NATURAL_DISASTER_FLOOD;MANMADE_DISASTER_OIL_SPILL')).toEqual(['disaster'])
    expect(kinds('TAX_DISEASE_CHOLERA;TAX_DISEASE_INFECTION')).toEqual(['health'])
    expect(kinds('MARITIME_INCIDENT;ARMEDCONFLICT;TAX_WEAPONS_MISSILE;UNREST_CRACKDOWN')).toEqual(['conflict', 'unrest', 'shipping'])
  })
})

describe("GDELT's files", () => {
  it('are asked for at a fresh address each time, past a cached "not found"', () => {
    expect(fresh('https://data.gdeltproject.org/gdeltv2/20261022200000.gkg.csv.zip', 1792700000000))
      .toBe('https://data.gdeltproject.org/gdeltv2/20261022200000.gkg.csv.zip?t=1792700000000')
  })
})

describe('the week before', () => {
  const now = Date.UTC(2026, 9, 22, 21, 40)   // Oct 22, 21:40 UTC

  it('is counted newest first: two files an hour for the last day, one an hour before', () => {
    const stamps = backfillStamps(now)
    expect(stamps.slice(0, 4)).toEqual(['20261022201500', '20261022204500', '20261022191500', '20261022194500'])
    expect(stamps).toHaveLength(24 * 2 + 6 * 24)
    expect(stamps[48]).toBe('20261021201500')
    expect(stamps.at(-1)).toBe('20261015211500')
    expect(new Set(stamps).size).toBe(stamps.length)
  })

  const deps = (over: Partial<BackfillDeps> = {}) => {
    const seen = new Set<string>(['20261022204500'])
    const recorded: string[] = []
    const d: BackfillDeps = {
      counted: async (s) => seen.has(s),
      fetchText: async (s) => (s === '20261022191500' ? null : line('PROTEST', lagos, '-2,1,3,4,10,0,100')),
      record: async (s) => { recorded.push(s); seen.add(s); return true },
      progress: async () => {},
      pause: async () => {},
      ...over,
    }
    return { d, recorded }
  }

  it('skips what is counted, notes what GDELT never made, and counts the rest', async () => {
    const { d, recorded } = deps()
    const stats = await backfillPulse(d, now)
    expect(stats).toMatchObject({ files: 190, skipped: 1, missing: 1, failed: 0, last: '20261015211500' })
    expect(recorded[0]).toBe('20261022201500')
    expect(recorded).not.toContain('20261022204500')
  })

  it('stops after 10 failures in a row, to be tried again at the next start', async () => {
    const progress = vi.fn(async () => {})
    const { d } = deps({ fetchText: async () => { throw new Error('HTTP 503') }, progress })
    await expect(backfillPulse(d, now)).rejects.toThrow(/10 files in a row/)
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ failed: 10, files: 0 }))
  })

  it('a failure now and then is counted and passed over', async () => {
    let n = 0
    const { d } = deps({ fetchText: async () => { if (++n % 7 === 0) throw new Error('reset'); return line('PROTEST', lagos, '-2,1,3,4,10,0,100') } })
    const stats = await backfillPulse(d, now)
    expect(stats.failed).toBe(27)
    expect(stats.files + stats.failed + stats.skipped).toBe(192)
  })
})
