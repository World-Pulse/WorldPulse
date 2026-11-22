/**
 * Two sea layers from NGA's Maritime Safety Information (Nov 22, 2026): ship attacks (ASAM) and navigational warnings
 * in force. Neither reads the database: NGA's answer, made into points. The records below have the members NGA's
 * answers carry (reference, date, latitude, longitude, hostility, victim, description, navArea, subreg for ASAM;
 * navArea, msgYear, msgNumber, subregion, issueDate, text for a warning), with made-up words.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

let still = false
vi.mock('../lib/swr-cache', () => ({
  staleWhileRevalidate: async (key: string, _o: unknown, make: () => Promise<unknown>) => {
    if (still) throw new (await import('../lib/still-making')).StillMaking(key)
    return make()
  },
}))

import Fastify from 'fastify'
import { asamFeatures, seaWarningFeatures, positionsIn, middleOf, warningKind, issuedAt, registerSeaFeedRoutes, ASAM_URL, SEA_WARNINGS_URL } from '../routes/map/sea-feeds'

const NOW = Date.parse('2026-11-22T12:00:00Z')
const asam = (over: Record<string, unknown>) => ({
  reference: '2026-101', date: '2026-11-15', latitude: 1.2345678, longitude: 104.1, position: '1°14\'N 104°06\'E',
  navArea: 'XI', subreg: '71', hostility: 'Robbers', victim: 'Bulk carrier', description: 'Five robbers boarded an anchored bulk carrier and stole engine spares.', ...over,
})
const warn = (over: Record<string, unknown>) => ({
  navArea: 'P', msgYear: 2026, msgNumber: 3229, subregion: '', issueDate: '061306Z NOV 2026',
  text: 'PERSIAN GULF. STRAIT OF HORMUZ. HAZARDOUS OPERATIONS, MISSILE FIRING 0500Z TO 1100Z DAILY 08 THRU 12 NOV IN AREA BOUND BY 26-34.00N 056-15.00E, 26-40.00N 056-30.00E, 26-20.00N 056-30.00E.', ...over,
})

afterEach(() => { vi.unstubAllGlobals(); still = false })

describe('asamFeatures', () => {
  it("each attack of the last 12 months at its position, newest first, with who attacked and the ship", () => {
    const { features, records, newest } = asamFeatures({ asam: [asam({}), asam({ reference: '2026-120', date: '2026-11-20', latitude: 12.5, longitude: 43.4, hostility: 'Pirates', victim: 'Tanker' })] }, NOW)
    expect(records).toBe(2)
    expect(newest).toBe('2026-11-20')
    expect(features.map(f => f.properties.reference)).toEqual(['2026-120', '2026-101'])
    expect(features[1]).toMatchObject({ geometry: { coordinates: [104.1, 1.2346] }, properties: { date: '2026-11-15', hostility: 'Robbers', victim: 'Bulk carrier', navArea: 'XI', subreg: '71' } })
  })

  it('leaves out records older than 12 months, without a position, at 0,0, or with no date; reads an answer that is the list', () => {
    const { features, records } = asamFeatures([
      asam({ reference: 'old', date: '2025-10-01' }), asam({ reference: 'nopos', latitude: null }), asam({ reference: 'zero', latitude: 0, longitude: 0 }),
      asam({ reference: 'nodate', date: '' }), asam({ reference: 'far', latitude: 95 }), asam({ reference: 'ok', date: '11/10/2026' }), null,
    ], NOW)
    expect(records).toBe(7)
    expect(features.map(f => f.properties.reference)).toEqual(['ok'])
  })

  it('cuts a long description', () => {
    const { features } = asamFeatures({ asam: [asam({ description: 'x'.repeat(900) })] }, NOW)
    expect(String(features[0]!.properties.description)).toHaveLength(700)
  })
})

describe('the warnings in force', () => {
  it('reads the positions in a warning\'s text and puts it at their middle, with its area, number and kind', () => {
    expect(positionsIn('AREA BOUND BY 26-34.00N 056-15.00E, 26-40N 056-30E AND 10-05.5S 120-30.25W')).toEqual([[56.25, 26.566666666666666], [56.5, 26.666666666666668], [-120.50416666666666, -10.091666666666667]])
    expect(positionsIn('NO POSITION HERE. 12-75N 056-15E has bad minutes')).toEqual([])
    const { features, records, newest } = seaWarningFeatures({ 'broadcast-warn': [warn({}), warn({ msgNumber: 3230, text: 'NAVAREA IV. ALL SHIPS. NO POSITION GIVEN.' })] })
    expect(records).toBe(2)
    expect(newest).toBe('2026-11-06T13:06:00.000Z')
    expect(features).toHaveLength(1)
    expect(features[0]).toMatchObject({ geometry: { coordinates: [56.4167, 26.5222] }, properties: { title: 'HYDROPAC 3229/26', area: 'P', kind: 'launch', positions: 3, issued: '2026-11-06T13:06:00.000Z' } })
  })

  it('measures the middle the short way across the date line', () => {
    expect(middleOf([[179, 10], [-179, 12]])).toEqual([180, 11])
    expect(middleOf([[170, 10], [-170, 10]])).toEqual([180, 10])
    expect(middleOf([[-10, 0], [10, 2]])).toEqual([0, 1])
    expect(middleOf([])).toBeNull()
  })

  it('tells what a warning is about from its words', () => {
    expect(warningKind('ROCKET LAUNCHING')).toBe('launch')
    expect(warningKind('MINE DANGER AREA')).toBe('mines')
    expect(warningKind('ARMED ROBBERY REPORTED')).toBe('attack')
    expect(warningKind('GUNNERY EXERCISES')).toBe('military')
    expect(warningKind('GPS INTERFERENCE REPORTED')).toBe('gps')
    expect(warningKind('CABLE OPERATIONS')).toBe('cable')
    expect(warningKind('DERELICT VESSEL ADRIFT')).toBe('hazard')
    expect(warningKind('LIGHT UNLIT')).toBe('other')
  })

  it("reads NGA's date-time groups, and names areas by NGA's codes", () => {
    expect(issuedAt('101445Z NOV 2026')).toBe('2026-11-10T14:45:00.000Z')
    expect(issuedAt('101445Z NOV')).toBeNull()
    expect(issuedAt('321445Z NOV 2026')).toBeNull()
    const { features } = seaWarningFeatures([warn({ navArea: '4', msgNumber: 1201 }), warn({ navArea: '12', msgNumber: 77, msgYear: 2025 }), warn({ navArea: 'Z', msgNumber: 5 })])
    expect(features.map(f => f.properties.title)).toEqual(['NAVAREA IV 1201/26', 'NAVAREA XII 77/25', 'NGA area Z 5/26'])
  })
})

describe('the routes', () => {
  async function app() {
    const a = Fastify({ logger: false })
    await a.register(registerSeaFeedRoutes, { prefix: '/api/v1/map' })
    return a
  }

  it("answer NGA's points with what was read, from NGA's two addresses", async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url === ASAM_URL ? { asam: [asam({ date: new Date().toISOString().slice(0, 10) })] } : { 'broadcast-warn': [warn({})] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const a = await app()
    const attacks = await a.inject({ method: 'GET', url: '/api/v1/map/ship-attacks' })
    expect(attacks.statusCode).toBe(200)
    expect(attacks.json()).toMatchObject({ success: true, type: 'FeatureCollection', read: { records: 1 } })
    expect(attacks.json().features).toHaveLength(1)
    expect(attacks.json().source).toContain('NGA Maritime Safety Information')
    const warnings = await a.inject({ method: 'GET', url: '/api/v1/map/sea-warnings' })
    expect(warnings.json()).toMatchObject({ success: true, read: { records: 1, newest: '2026-11-06T13:06:00.000Z' } })
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([ASAM_URL, SEA_WARNINGS_URL])
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ headers: { 'user-agent': expect.stringContaining('WorldPulse') } })
  })

  it('answer 503 when NGA is down for maintenance, and 503 with retry-after while still reading it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>maintenance</html>', { status: 503 })))
    const a = await app()
    const down = await a.inject({ method: 'GET', url: '/api/v1/map/sea-warnings' })
    expect(down.statusCode).toBe(503)
    expect(down.json().error).toBe('NGA did not answer; try again in a few minutes')
    still = true
    const reading = await a.inject({ method: 'GET', url: '/api/v1/map/ship-attacks' })
    expect(reading.statusCode).toBe(503)
    expect(reading.headers['retry-after']).toBe('60')
  })
})
