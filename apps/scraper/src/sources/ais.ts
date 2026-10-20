/**
 * Live ships from aisstream.io (rewritten Oct 19, 2026, for live ship
 * positions on the map: PLAN M39).
 *
 * AIS is the radio message every large ship broadcasts: who it is, where,
 * how fast and which way. aisstream.io relays it from receivers around the
 * world over one WebSocket. With AIS_STREAM_API_KEY set, the scraper:
 *
 *   - listens to the straits and canals world trade runs through
 *     (AIS_AREAS), not the whole world;
 *   - keeps each ship's latest position and writes the fleet to Redis
 *     (AIS_LIVE_KEY) every 30 seconds, for GET /api/v1/maritime/live and the
 *     map's Ships layer;
 *   - files a story only for a real distress beacon: an AIS-SART,
 *     man-overboard or EPIRB device (MMSI 970…, 972…, 974…) transmitting
 *     "active" (status 14), as unconfirmed (pending), at most 3 an hour.
 *
 * What the old version did instead: it asked for every ship on Earth, filed
 * every ship with status 15 as a high-severity disaster ("not defined", the
 * default on thousands of ships), and announced them as verified. Its
 * hand-made WebSocket client also dropped any message split across two
 * network packets and never answered pings. This one keeps partial frames,
 * answers pings, reads text and binary frames, and reconnects when the line
 * goes quiet. (Node 20 has no WebSocket client of its own.)
 */

import tls from 'node:tls'
import crypto from 'node:crypto'
import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger as rootLogger } from '../lib/logger'
import { insertAndCorrelate } from '../pipeline/insert-signal'

const log = rootLogger.child({ module: 'ais-source' })

const HOST = 'stream.aisstream.io'
/** The fleet as the API reads it (apps/api/src/routes/maritime.ts) */
export const AIS_LIVE_KEY = 'ais:live:v1'
const FLUSH_MS = 30_000
/** A ship not heard from for this long has left the area or the receivers' range */
const SHIP_TTL_MS = 30 * 60_000
const MAX_SHIPS = 8_000
/** No data for this long: the line is dead, reconnect */
const QUIET_MS = 120_000
const BEACONS_PER_HOUR = 3

/** The straits and canals watched: [[latMin, lonMin], [latMax, lonMax]] */
export const AIS_AREAS: Array<{ name: string; box: [[number, number], [number, number]] }> = [
  { name: 'Strait of Hormuz',           box: [[24.6, 54.6], [27.4, 58.6]] },
  { name: 'Bab el-Mandeb',              box: [[11.6, 42.2], [14.6, 45.2]] },
  { name: 'Red Sea, Jeddah to Port Sudan', box: [[19.0, 36.8], [22.2, 39.4]] },
  { name: 'Suez Canal',                 box: [[29.6, 32.1], [31.6, 32.8]] },
  { name: 'Strait of Malacca and Singapore', box: [[1.0, 99.5], [5.0, 104.4]] },
  { name: 'Taiwan Strait',              box: [[22.8, 118.0], [25.6, 121.0]] },
  { name: 'Bosporus',                   box: [[40.95, 28.85], [41.35, 29.25]] },
  { name: 'Western Black Sea',          box: [[42.4, 27.8], [46.6, 31.0]] },
  { name: 'Kerch Strait',               box: [[44.9, 36.2], [45.6, 37.0]] },
  { name: 'Strait of Gibraltar',        box: [[35.75, -6.2], [36.25, -5.2]] },
  { name: 'Dover Strait',               box: [[50.7, 0.9], [51.4, 2.0]] },
  { name: 'Panama Canal',               box: [[8.7, -80.0], [9.5, -79.4]] },
]

export function areaOf(lat: number, lon: number): string | null {
  for (const a of AIS_AREAS) {
    const [[la1, lo1], [la2, lo2]] = a.box
    if (lat >= la1 && lat <= la2 && lon >= lo1 && lon <= lo2) return a.name
  }
  return null
}

/** What aisstream is asked for (the key goes only into this message on the wire, never into logs) */
export function subscriptionFor(apiKey: string): Record<string, unknown> {
  return {
    APIKey:             apiKey,
    BoundingBoxes:      AIS_AREAS.map(a => a.box),
    FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
  }
}

// ─── WebSocket frames (RFC 6455), client side ─────────────────────────────────

/** A frame to the server: always masked */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length
  const head = len < 126 ? 2 : len < 65_536 ? 4 : 10
  const out = Buffer.alloc(head + 4 + len)
  out[0] = 0x80 | opcode
  if (len < 126) out[1] = 0x80 | len
  else if (len < 65_536) { out[1] = 0x80 | 126; out.writeUInt16BE(len, 2) }
  else { out[1] = 0x80 | 127; out.writeBigUInt64BE(BigInt(len), 2) }
  const mask = crypto.randomBytes(4)
  mask.copy(out, head)
  for (let i = 0; i < len; i++) out[head + 4 + i] = payload[i]! ^ mask[i % 4]!
  return out
}

export interface Frame { fin: boolean; opcode: number; payload: Buffer }

/** The complete frames at the start of `buf`, and how many bytes they took (a partial frame waits for more) */
export function readFrames(buf: Buffer): { frames: Frame[]; used: number } {
  const frames: Frame[] = []
  let off = 0
  while (buf.length - off >= 2) {
    const b0 = buf[off]!
    const b1 = buf[off + 1]!
    let len = b1 & 0x7f
    let head = 2
    if (len === 126) {
      if (buf.length - off < 4) break
      len = buf.readUInt16BE(off + 2); head = 4
    } else if (len === 127) {
      if (buf.length - off < 10) break
      len = Number(buf.readBigUInt64BE(off + 2)); head = 10
    }
    const masked = (b1 & 0x80) !== 0
    const maskAt = off + head
    if (masked) head += 4
    if (buf.length - off < head + len) break
    let payload = buf.subarray(off + head, off + head + len)
    if (masked) {
      const mask = buf.subarray(maskAt, maskAt + 4)
      payload = Buffer.from(payload.map((v, i) => v ^ mask[i % 4]!))
    }
    frames.push({ fin: (b0 & 0x80) !== 0, opcode: b0 & 0x0f, payload })
    off += head + len
  }
  return { frames, used: off }
}

// ─── AIS messages and the fleet ───────────────────────────────────────────────

export interface AisMessage {
  MessageType?: string
  error?: string
  Message?: {
    PositionReport?: {
      UserID?: number; NavigationalStatus?: number; Latitude?: number; Longitude?: number
      Sog?: number; Cog?: number; TrueHeading?: number
    }
    ShipStaticData?: { UserID?: number; Name?: string; Type?: number; Destination?: string }
  }
  MetaData?: { MMSI?: number | string; ShipName?: string; latitude?: number; longitude?: number; time_utc?: string }
}

export interface LiveShip {
  mmsi:    string
  name:    string | null
  lat:     number
  lon:     number
  /** Knots */
  sog:     number | null
  /** Course over ground, degrees */
  cog:     number | null
  /** Bow direction, degrees */
  heading: number | null
  /** AIS navigational status (0 under way, 1 at anchor, 5 moored…) */
  nav:     number | null
  /** AIS ship type (70s cargo, 80s tanker, 60s passenger…) */
  type:    number | null
  dest:    string | null
  area:    string
  /** Last heard, ms */
  at:      number
}

const text = (v: unknown, max = 40): string | null => {
  const s = typeof v === 'string' ? v.trim().replace(/@+$/, '').replace(/\s+/g, ' ').trim() : ''
  return s ? s.slice(0, max) : null
}
const inRange = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v < hi ? v : null

/** Updates the fleet from one message; returns the ship it moved, if any */
export function applyMessage(fleet: Map<string, LiveShip>, msg: AisMessage, now = Date.now()): LiveShip | null {
  const mmsi = String(msg.MetaData?.MMSI ?? msg.Message?.PositionReport?.UserID ?? msg.Message?.ShipStaticData?.UserID ?? '')
  if (!/^\d{9}$/.test(mmsi)) return null
  const stat = msg.Message?.ShipStaticData
  if (stat) {
    const had = fleet.get(mmsi)
    if (had) {
      had.type = inRange(stat.Type, 1, 100) ?? had.type
      had.dest = text(stat.Destination) ?? had.dest
      had.name = text(stat.Name) ?? had.name
    }
    return null
  }
  const pos = msg.Message?.PositionReport
  if (!pos) return null
  const lat = inRange(pos.Latitude ?? msg.MetaData?.latitude, -90, 90.0001)
  const lon = inRange(pos.Longitude ?? msg.MetaData?.longitude, -180, 180.0001)
  if (lat == null || lon == null) return null
  const area = areaOf(lat, lon)
  if (!area) return null
  const had = fleet.get(mmsi)
  const ship: LiveShip = {
    mmsi,
    name:    text(msg.MetaData?.ShipName) ?? had?.name ?? null,
    lat:     Math.round(lat * 1e5) / 1e5,
    lon:     Math.round(lon * 1e5) / 1e5,
    sog:     inRange(pos.Sog, 0, 102.3),      // 102.3: not available
    cog:     inRange(pos.Cog, 0, 360),        // 360: not available
    heading: inRange(pos.TrueHeading, 0, 360), // 511: not available
    nav:     inRange(pos.NavigationalStatus, 0, 16),
    type:    had?.type ?? null,
    dest:    had?.dest ?? null,
    area,
    at:      now,
  }
  fleet.set(mmsi, ship)
  return ship
}

/** The fleet to write: ships heard in the last 30 minutes (newest first, at most MAX_SHIPS) and how many per area */
export function fleetSnapshot(fleet: Map<string, LiveShip>, now = Date.now(), connected = true) {
  for (const [k, s] of fleet) if (now - s.at > SHIP_TTL_MS) fleet.delete(k)
  const ships = [...fleet.values()].sort((a, b) => b.at - a.at).slice(0, MAX_SHIPS)
  const counts = new Map<string, number>()
  for (const s of ships) counts.set(s.area, (counts.get(s.area) ?? 0) + 1)
  return {
    at:        new Date(now).toISOString(),
    source:    'aisstream.io',
    connected,
    areas:     AIS_AREAS.map(a => ({ name: a.name, ships: counts.get(a.name) ?? 0 })),
    ships,
  }
}

const BEACON_KIND: Record<string, string> = { '970': 'AIS-SART (search and rescue transponder)', '972': 'man-overboard beacon', '974': 'EPIRB distress beacon' }

/** A real distress beacon: an AIS-SART, man-overboard or EPIRB device transmitting "active" (14; 15 is its test mode) */
export function isDistressBeacon(mmsi: string, nav: number | null): boolean {
  return /^97[024]\d{6}$/.test(mmsi) && nav === 14
}

// ─── The connection ───────────────────────────────────────────────────────────

function connectAisStream(apiKey: string, onMessage: (msg: AisMessage) => void, onClose: (why: string) => void): () => void {
  let closed = false
  let upgraded = false
  let header: Buffer = Buffer.alloc(0)
  let pending: Buffer = Buffer.alloc(0)
  let fragments: Buffer[] = []
  let lastData = Date.now()

  const socket = tls.connect({ host: HOST, port: 443, servername: HOST }, () => {
    const key = crypto.randomBytes(16).toString('base64')
    socket.write([
      'GET /v0/stream HTTP/1.1', `Host: ${HOST}`, 'Upgrade: websocket', 'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13', '', '',
    ].join('\r\n'))
  })

  const finish = (why: string) => {
    if (closed) return
    closed = true
    clearInterval(watchdog)
    socket.destroy()
    onClose(why)
  }
  const watchdog = setInterval(() => { if (Date.now() - lastData > QUIET_MS) finish('no data for 2 minutes') }, 30_000)

  const handleText = (raw: Buffer) => {
    try { onMessage(JSON.parse(raw.toString('utf8')) as AisMessage) } catch { /* not JSON: ignore */ }
  }

  socket.on('data', (chunk: Buffer) => {
    lastData = Date.now()
    if (!upgraded) {
      header = Buffer.concat([header, chunk])
      const end = header.indexOf('\r\n\r\n')
      if (end === -1) { if (header.length > 16_384) finish('no HTTP answer'); return }
      const status = header.subarray(0, header.indexOf('\r\n')).toString('utf8')
      if (!/^HTTP\/1\.1 101/.test(status)) { finish(`refused: ${status.slice(0, 80)}`); return }
      upgraded = true
      // the subscription has to arrive within 3 seconds of connecting
      socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify(subscriptionFor(apiKey)), 'utf8')))
      log.info({ areas: AIS_AREAS.length }, 'AIS stream connected and subscribed')
      chunk = header.subarray(end + 4)
      header = Buffer.alloc(0)
      if (!chunk.length) return
    }
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
    const { frames, used } = readFrames(pending)
    pending = pending.subarray(used)
    for (const f of frames) {
      if (f.opcode === 0x9) { socket.write(encodeFrame(0xA, f.payload)); continue }   // ping → pong
      if (f.opcode === 0x8) { finish('closed by the server'); return }
      if (f.opcode === 0xA) continue                                                // pong
      if (f.opcode === 0x0) {                                                       // continuation
        fragments.push(f.payload)
        if (f.fin) { handleText(Buffer.concat(fragments)); fragments = [] }
        continue
      }
      if (f.opcode === 0x1 || f.opcode === 0x2) {                                   // text or binary
        if (f.fin) handleText(f.payload)
        else fragments = [f.payload]
      }
    }
  })
  socket.on('error', (err: Error) => { log.warn({ err: err.message }, 'AIS stream error') })
  socket.on('close', () => finish('connection closed'))

  return () => { closed = true; clearInterval(watchdog); socket.destroy() }
}

// ─── The poller ───────────────────────────────────────────────────────────────

export function startAisPoller(db: Knex, redis: Redis, _producer?: Producer | null): () => void {
  const apiKey = (process.env.AIS_STREAM_API_KEY || '').trim()
  if (!apiKey) {
    log.info('AIS stream off: set AIS_STREAM_API_KEY to show live ships')
    return () => {}
  }

  const fleet = new Map<string, LiveShip>()
  let stopped = false
  let connected = false
  let failures = 0
  let messages = 0
  let destroy: (() => void) | null = null
  let reconnect: ReturnType<typeof setTimeout> | null = null

  async function fileBeacon(ship: LiveShip): Promise<void> {
    const once = await redis.set(`osint:ais:beacon:${ship.mmsi}`, '1', 'EX', 6 * 3600, 'NX').catch(() => null)
    if (once !== 'OK') return
    const hourKey = `osint:ais:beacons:${Math.floor(Date.now() / 3_600_000)}`
    const n = await redis.incr(hourKey).catch(() => BEACONS_PER_HOUR + 1)
    await redis.expire(hourKey, 3600).catch(() => {})
    if (n > BEACONS_PER_HOUR) return
    const kind = BEACON_KIND[ship.mmsi.slice(0, 3)] ?? 'distress beacon'
    try {
      await insertAndCorrelate({
        title:             `Distress beacon active near ${ship.area}: ${kind}`,
        summary:           `An ${kind} (MMSI ${ship.mmsi}) is transmitting "active" at ${ship.lat.toFixed(3)}, ${ship.lon.toFixed(3)}, near ${ship.area}. ` +
                           'One automatic AIS report via aisstream.io, not confirmed by a rescue authority yet.',
        category:          'disaster',
        severity:          'high',
        status:            'pending',
        reliability_score: 0.6,
        source_count:      1,
        source_ids:        [],
        original_urls:     [`https://www.marinetraffic.com/en/ais/details/ships/mmsi:${ship.mmsi}`],
        location:          db.raw('ST_MakePoint(?, ?)', [ship.lon, ship.lat]),
        location_name:     ship.area,
        country_code:      null,
        region:            null,
        tags:              ['osint', 'ais', 'maritime', 'distress-beacon'],
        language:          'en',
        event_time:        new Date(ship.at),
      }, { lat: ship.lat, lng: ship.lon, sourceId: 'ais' })
      log.info({ mmsi: ship.mmsi, area: ship.area }, 'AIS distress beacon filed (pending)')
    } catch (err) {
      log.debug({ err, mmsi: ship.mmsi }, 'AIS beacon story skipped')
    }
  }

  const onMessage = (msg: AisMessage) => {
    if (msg.error) { log.warn({ error: String(msg.error).slice(0, 200) }, 'AIS stream refused the subscription'); return }
    messages++
    if (!connected) { connected = true; failures = 0 }
    const ship = applyMessage(fleet, msg)
    if (ship && isDistressBeacon(ship.mmsi, ship.nav)) void fileBeacon(ship)
    if (fleet.size > MAX_SHIPS * 2) fleetSnapshot(fleet)   // drop the stalest early
  }

  const connect = () => {
    if (stopped) return
    destroy = connectAisStream(apiKey, onMessage, (why) => {
      connected = false
      if (stopped) return
      failures++
      const wait = Math.min(300_000, 30_000 * 2 ** Math.min(failures - 1, 4))
      log.warn({ why, retryInS: wait / 1000 }, 'AIS stream down; reconnecting')
      reconnect = setTimeout(connect, wait)
    })
  }

  const flush = setInterval(() => {
    const snap = { ...fleetSnapshot(fleet, Date.now(), connected), messages }
    redis.set(AIS_LIVE_KEY, JSON.stringify(snap), 'EX', 900).catch(err => log.debug({ err }, 'AIS fleet not written'))
  }, FLUSH_MS)

  connect()
  log.info({ areas: AIS_AREAS.map(a => a.name) }, 'AIS stream starting (aisstream.io)')

  return () => {
    stopped = true
    clearInterval(flush)
    if (reconnect) clearTimeout(reconnect)
    if (destroy) destroy()
    log.info('AIS stream stopped')
  }
}
