import { describe, it, expect, vi } from 'vitest'

vi.mock('../pipeline/insert-signal', () => ({ insertAndCorrelate: vi.fn() }))

import {
  AIS_AREAS, applyMessage, areaOf, encodeFrame, fleetSnapshot, isDistressBeacon, readFrames, subscriptionFor,
  type AisMessage, type LiveShip,
} from '../sources/ais'

/** A frame as the server sends it: unmasked */
const serverFrame = (opcode: number, payload: Buffer, fin = true): Buffer => {
  const len = payload.length
  const head = len < 126 ? Buffer.from([(fin ? 0x80 : 0) | opcode, len]) : Buffer.from([(fin ? 0x80 : 0) | opcode, 126, len >> 8, len & 0xff])
  return Buffer.concat([head, payload])
}

const position = (mmsi: number, lat: number, lon: number, extra: Record<string, unknown> = {}): AisMessage => ({
  MessageType: 'PositionReport',
  Message: { PositionReport: { UserID: mmsi, Latitude: lat, Longitude: lon, Sog: 12.3, Cog: 87.5, TrueHeading: 88, NavigationalStatus: 0, ...extra } },
  MetaData: { MMSI: mmsi, ShipName: 'EVER GIVEN@@@@  ', latitude: lat, longitude: lon },
})

describe('aisstream: what is asked for', () => {
  it('the straits and canals only, never the whole world, and only positions and ship details', () => {
    const sub = subscriptionFor('k') as { BoundingBoxes: number[][][]; FilterMessageTypes: string[] }
    expect(sub.BoundingBoxes).toHaveLength(AIS_AREAS.length)
    for (const [[la1, lo1], [la2, lo2]] of sub.BoundingBoxes) {
      expect(la2 - la1).toBeLessThan(5)
      expect(lo2 - lo1).toBeLessThan(5)
    }
    expect(sub.FilterMessageTypes).toEqual(['PositionReport', 'ShipStaticData'])
    expect(areaOf(26.5, 56.3)).toBe('Strait of Hormuz')
    expect(areaOf(40.7, -74)).toBeNull()
  })
})

describe('aisstream: WebSocket frames', () => {
  it('reads what we send (masked) the same as what the server sends (unmasked)', () => {
    const body = Buffer.from(JSON.stringify({ hello: 'world' }))
    expect(readFrames(encodeFrame(0x1, body)).frames[0]!.payload.toString()).toBe(body.toString())
    expect(readFrames(serverFrame(0x2, body)).frames[0]!.payload.toString()).toBe(body.toString())
  })

  it('keeps a message split across two network packets instead of dropping it', () => {
    const a = serverFrame(0x1, Buffer.from('{"n":1}'))
    const b = serverFrame(0x1, Buffer.from('x'.repeat(300)))   // a 16-bit length
    const all = Buffer.concat([a, b])
    const first = readFrames(all.subarray(0, a.length + 5))
    expect(first.frames).toHaveLength(1)
    expect(first.used).toBe(a.length)
    const rest = Buffer.concat([all.subarray(first.used, a.length + 5), all.subarray(a.length + 5)])
    expect(readFrames(rest).frames[0]!.payload.length).toBe(300)
  })

  it('sees a ping (so it can answer pong) and a fragmented message', () => {
    const { frames } = readFrames(Buffer.concat([serverFrame(0x9, Buffer.from('p')), serverFrame(0x1, Buffer.from('{"a"'), false), serverFrame(0x0, Buffer.from(':1}'))]))
    expect(frames.map(f => [f.opcode, f.fin])).toEqual([[0x9, true], [0x1, false], [0x0, true]])
  })
})

describe('aisstream: the fleet', () => {
  it('keeps the latest position of a ship in a watched strait, without the "not available" values', () => {
    const fleet = new Map<string, LiveShip>()
    const ship = applyMessage(fleet, position(353136000, 26.5, 56.3), 1_000)
    expect(ship).toMatchObject({ mmsi: '353136000', name: 'EVER GIVEN', area: 'Strait of Hormuz', sog: 12.3, cog: 87.5, heading: 88, nav: 0, at: 1_000 })
    applyMessage(fleet, position(353136000, 26.6, 56.4, { Sog: 102.3, Cog: 360, TrueHeading: 511 }), 2_000)
    expect(fleet.get('353136000')).toMatchObject({ lat: 26.6, sog: null, cog: null, heading: null })
    expect(applyMessage(fleet, position(366000000, 40.7, -74.0))).toBeNull()   // New York: not watched
    expect(applyMessage(fleet, position(12, 26.5, 56.3))).toBeNull()           // not an MMSI
  })

  it('adds the ship details (type, destination) to a ship it already has', () => {
    const fleet = new Map<string, LiveShip>()
    applyMessage(fleet, position(353136000, 26.5, 56.3))
    applyMessage(fleet, { MessageType: 'ShipStaticData', Message: { ShipStaticData: { UserID: 353136000, Type: 84, Destination: 'FUJAIRAH@@@', Name: 'EVER GIVEN' } }, MetaData: { MMSI: 353136000 } })
    expect(fleet.get('353136000')).toMatchObject({ type: 84, dest: 'FUJAIRAH' })
  })

  it('writes ships heard in the last 30 minutes, newest first, with how many per strait', () => {
    const fleet = new Map<string, LiveShip>()
    applyMessage(fleet, position(353136000, 26.5, 56.3), 0)
    applyMessage(fleet, position(235000000, 26.4, 56.2), 40 * 60_000)
    applyMessage(fleet, position(636000000, 12.6, 43.4), 41 * 60_000)
    const snap = fleetSnapshot(fleet, 45 * 60_000)
    expect(snap.ships.map(s => s.mmsi)).toEqual(['636000000', '235000000'])
    expect(snap.areas.find(a => a.name === 'Strait of Hormuz')?.ships).toBe(1)
    expect(snap.areas.find(a => a.name === 'Bab el-Mandeb')?.ships).toBe(1)
    expect(fleet.has('353136000')).toBe(false)
  })
})

describe('aisstream: distress', () => {
  it('only a distress device transmitting "active" counts; status 15 on ordinary ships (the old flood) never does', () => {
    expect(isDistressBeacon('970123456', 14)).toBe(true)    // AIS-SART active
    expect(isDistressBeacon('972123456', 14)).toBe(true)    // man overboard
    expect(isDistressBeacon('974123456', 14)).toBe(true)    // EPIRB
    expect(isDistressBeacon('970123456', 15)).toBe(false)   // its test mode
    expect(isDistressBeacon('235000000', 15)).toBe(false)   // "not defined": thousands of ships
    expect(isDistressBeacon('235000000', 14)).toBe(false)   // a ship set up wrong
  })
})
