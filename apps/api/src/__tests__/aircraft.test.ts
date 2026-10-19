import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => ({ kv: new Map<string, string>() }))
vi.mock('../db/redis', () => ({
  redis: {
    get: vi.fn(async (k: string) => store.kv.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, ...args: string[]) => {
      if (args.includes('NX') && store.kv.has(k)) return null
      store.kv.set(k, v); return 'OK'
    }),
    del: vi.fn(async (k: string) => { store.kv.delete(k); return 1 }),
  },
}))
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }))

import { toLiveAircraft, readAircraft, liveAircraft, AIRCRAFT_FRESH_MS } from '../lib/aircraft'

const c17 = { hex: 'ae1234', flight: 'RCH123  ', r: '07-7180', t: 'C17', desc: 'BOEING C-17A Globemaster III', ownOp: 'United States Air Force',
  lat: 50.123456, lon: 8.654321, alt_baro: 31000, gs: 451.6, track: 93.2, squawk: '1234', dbFlags: 1, seen_pos: 3 }

describe('toLiveAircraft', () => {
  it('reads a military aircraft', () => {
    expect(toLiveAircraft(c17, true)).toEqual({ hex: 'ae1234', callsign: 'RCH123', reg: '07-7180', type: 'C17', desc: 'BOEING C-17A Globemaster III',
      operator: 'United States Air Force', lat: 50.1235, lng: 8.6543, alt: 31000, speed: 452, track: 93.2, squawk: '1234', emergency: null, military: true })
  })
  it('names an emergency squawk and keeps "ground"', () => {
    const a = toLiveAircraft({ ...c17, dbFlags: 0, squawk: '7700', alt_baro: 'ground' })
    expect(a).toMatchObject({ emergency: 'Emergency', alt: 'ground', military: false })
    expect(toLiveAircraft({ ...c17, squawk: '7500' })?.emergency).toBe('Hijack')
  })
  it('leaves out privacy-programme aircraft, old positions and ones without a position', () => {
    expect(toLiveAircraft({ ...c17, dbFlags: 4 })).toBeNull()
    expect(toLiveAircraft({ ...c17, dbFlags: 8 })).toBeNull()
    expect(toLiveAircraft({ ...c17, seen_pos: 600 })).toBeNull()
    expect(toLiveAircraft({ ...c17, lat: undefined })).toBeNull()
  })
})

describe('readAircraft', () => {
  it('merges the military list and the emergency squawks; a failed list is named', async () => {
    const lists: Record<string, unknown> = {
      'mil': { ac: [c17, { ...c17, hex: 'ae9999', lat: undefined }] },
      'sqk/7700': { ac: [{ ...c17, hex: 'abc001', dbFlags: 0, squawk: '7700', flight: 'DAL45' }, { ...c17, squawk: '7700' }] },
      'sqk/7600': { ac: [] },
    }
    const f = vi.fn(async (url: string) => {
      const path = url.replace('https://api.adsb.lol/v2/', '')
      if (!(path in lists)) return new Response('busy', { status: 429 })
      return new Response(JSON.stringify(lists[path]), { status: 200 })
    }) as unknown as typeof fetch
    const snap = await readAircraft(f, 0)
    expect(snap.aircraft.map(a => a.hex).sort()).toEqual(['abc001', 'ae1234'])
    const ae = snap.aircraft.find(a => a.hex === 'ae1234')
    expect(ae).toMatchObject({ military: true, emergency: 'Emergency' })
    expect(snap.counts).toEqual({ military: 1, emergency: 2 })
    expect(snap.failed).toEqual(['sqk/7500'])
    expect(snap.license).toBe('ODbL 1.0')
  })
})

describe('liveAircraft', () => {
  beforeEach(() => store.kv.clear())

  it('serves the kept snapshot and reads again in the background once it is 3 minutes old', async () => {
    const at = new Date(Date.now() - AIRCRAFT_FRESH_MS - 1_000).toISOString()
    store.kv.set('aircraft:live:v1', JSON.stringify({ at, aircraft: [{ hex: 'x' }], counts: { military: 1, emergency: 0 }, failed: [] }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ac: [] }), { status: 200 }))
    const snap = await liveAircraft()
    expect(snap?.at).toBe(at)
    fetchSpy.mockRestore()
  })
})
