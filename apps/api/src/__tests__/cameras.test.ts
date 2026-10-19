/**
 * Live cameras (Oct 19, 2026): the sources' parsers, the checks on every
 * camera, and the picture fetch. The old tests checked a hand-written list
 * whose Windy ids were made up.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('../db/redis', () => ({ redis: { get: vi.fn(async () => null), set: vi.fn(), hgetall: vi.fn(async () => ({})), hdel: vi.fn(), getBuffer: vi.fn(async () => null) } }))

import {
  parseTfl, parseNyc, parseCaltrans, parseDigitraffic, finnishName, parseHongKong, parseNewZealand,
  toEntries, interleave, publicFeed, fetchPicture, cameraPicture, cameraImageUrl,
  CAMERA_SOURCES, CAMERA_ID, PICTURE_STALE_MS,
} from '../lib/ip-cameras'

const source = (key: string) => {
  const s = CAMERA_SOURCES.find(x => x.key === key)
  if (!s) throw new Error(key)
  return s
}

describe('the sources', () => {
  it('are all real services with their own lists, read over https', () => {
    expect(CAMERA_SOURCES.map(s => s.key)).toEqual(['tfl', 'nyc', 'ca-la', 'ca-sf', 'fi', 'hk', 'nz'])
    for (const s of CAMERA_SOURCES) {
      expect(s.list).toMatch(/^https:\/\//)
      expect(s.page).toMatch(/^https:\/\//)
      expect(s.imagePrefixes.every(p => p.startsWith('https://'))).toBe(true)
    }
  })

  it('no camera is Windy or EarthCam any more', () => {
    const text = JSON.stringify(CAMERA_SOURCES)
    expect(text).not.toMatch(/windy|earthcam/i)
  })
})

describe('parsers', () => {
  it('TfL: only available cameras, id without "JamCams_"', () => {
    const body = JSON.stringify([
      { id: 'JamCams_00002.00865', commonName: 'A406 Billet Upass E', lat: 51.60067, lon: -0.01594,
        additionalProperties: [{ key: 'available', value: 'true' }, { key: 'imageUrl', value: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.jpg' }] },
      { id: 'JamCams_00001.01251', commonName: 'Off', lat: 51.5, lon: -0.1,
        additionalProperties: [{ key: 'available', value: 'false' }, { key: 'imageUrl', value: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.01251.jpg' }] },
    ])
    const rows = parseTfl(body)
    expect(rows).toEqual([{ id: '00002.00865', name: 'A406 Billet Upass E', lat: 51.60067, lng: -0.01594, image: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.jpg' }])
  })

  it('NYC: only online cameras, the borough as the place', () => {
    const body = JSON.stringify([
      { id: '8a6bc417', name: 'Central Park West @ 86 St', latitude: 40.785302, longitude: -73.969353, area: 'Manhattan', isOnline: 'true', imageUrl: 'https://webcams.nyctmc.org/api/cameras/8a6bc417/image' },
      { id: 'x', name: 'Dark', latitude: 40.7, longitude: -73.9, area: 'Queens', isOnline: 'false', imageUrl: 'https://webcams.nyctmc.org/api/cameras/x/image' },
    ])
    const rows = parseNyc(body)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: '8a6bc417', city: 'Manhattan, New York' })
  })

  it('Caltrans: only cameras in service, named by their picture folder', () => {
    const cam = (inService: string, folder: string) => ({ cctv: { inService,
      location: { locationName: 'I-110 : (196) Avenue 26 Off Ramp', nearbyPlace: 'Cypress Park', latitude: '34.0837', longitude: '-118.2215' },
      imageData: { static: { currentImageURL: `https://cwwp2.dot.ca.gov/data/d7/cctv/image/${folder}/${folder}.jpg` } } } })
    const rows = parseCaltrans(JSON.stringify({ data: [cam('true', 'i110196avenue26offramp'), cam('false', 'gone')] }))
    expect(rows).toEqual([{ id: 'i110196avenue26offramp', name: 'I-110 : (196) Avenue 26 Off Ramp', lat: 34.0837, lng: -118.2215,
      image: 'https://cwwp2.dot.ca.gov/data/d7/cctv/image/i110196avenue26offramp/i110196avenue26offramp.jpg', city: 'Cypress Park' }])
  })

  it('Finland: names read as place and road', () => {
    expect(finnishName('vt1_Espoo_Kehä_III')).toEqual({ name: 'Kehä III (road 1)', city: 'Espoo' })
    expect(finnishName('kt51_Inkoo')).toEqual({ name: 'Inkoo (road 51)', city: 'Inkoo' })
    expect(finnishName('Helsinki_Satama')).toEqual({ name: 'Satama', city: 'Helsinki' })
  })

  it('Finland: stations still photographing, their first working direction', () => {
    const body = JSON.stringify({ features: [
      { geometry: { coordinates: [23.99616, 60.05374, 0] }, properties: { name: 'kt51_Inkoo', collectionStatus: 'GATHERING', presets: [{ id: 'C0150301', inCollection: false }, { id: 'C0150302', inCollection: true }] } },
      { geometry: { coordinates: [24, 61, 0] }, properties: { name: 'vt3_Off', collectionStatus: 'REMOVED_TEMPORARILY', presets: [{ id: 'C09', inCollection: true }] } },
    ] })
    expect(parseDigitraffic(body)).toEqual([{ id: 'C0150302', name: 'Inkoo (road 51)', city: 'Inkoo', lat: 60.05374, lng: 23.99616, image: 'https://weathercam.digitraffic.fi/C0150302.jpg' }])
  })

  it('Hong Kong: the description without its code, the district as the place', () => {
    const body = `<?xml version="1.0"?><image-list><image><key>H429F</key><region>Hong Kong Island</region><district>Southern</district>
      <description>Aberdeen Praya Road near Fish Market [H429F]</description><latitude>22.24845</latitude><longitude>114.1505</longitude>
      <url>https://tdcctv.data.one.gov.hk/H429F.JPG</url></image></image-list>`
    expect(parseHongKong(body)).toEqual([{ id: 'H429F', name: 'Aberdeen Praya Road near Fish Market', lat: 22.24845, lng: 114.1505, image: 'https://tdcctv.data.one.gov.hk/H429F.JPG', city: 'Southern, Hong Kong' }])
  })

  it('New Zealand: the camera\'s own id and name (not its journey\'s), offline ones left out', () => {
    const cam = (id: string, offline: string) => `<camera><description>South along Hinds Highway</description><id>${id}</id><imageUrl>/camera/${id}.jpg</imageUrl>
      <journey><id>86</id><name>SH1</name></journey><journeyLeg><name>Ashburton to Rangitata</name></journeyLeg>
      <latitude>-43.919632</latitude><longitude>171.721055</longitude><name>SH1 Tinwald </name><offline>${offline}</offline>
      <region><id>11</id><name>Canterbury</name></region><underMaintenance>false</underMaintenance></camera>`
    const rows = parseNewZealand(`<response>${cam('714', 'false')}${cam('715', 'true')}</response>`)
    expect(rows).toEqual([{ id: '714', name: 'SH1 Tinwald', lat: -43.919632, lng: 171.721055, image: 'https://www.trafficnz.info/camera/714.jpg', city: 'Canterbury' }])
  })
})

describe('the checks on every camera', () => {
  const tfl = source('tfl')
  const ok = { id: '00002.00865', name: 'A406', lat: 51.6, lng: -0.016, image: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.jpg' }

  it('a picture is only ever fetched from the source\'s own address', () => {
    const rows = toEntries(tfl, [ok, { ...ok, id: 'evil', image: 'http://169.254.169.254/latest/meta-data' }, { ...ok, id: 'evil2', image: 'https://evil.example/x.jpg' }])
    expect(rows.map(r => r.id)).toEqual(['tfl:00002.00865'])
  })

  it('leaves out cameras at 0,0, off the earth, without a name, or repeated', () => {
    const rows = toEntries(tfl, [ok, { ...ok, id: 'a', lat: 0, lng: 0 }, { ...ok, id: 'b', lat: 95 }, { ...ok, id: 'c', name: '' }, ok])
    expect(rows).toHaveLength(1)
  })

  it('every camera\'s picture is our own address; ids are "source:id"', () => {
    const [cam] = toEntries(tfl, [ok])
    expect(cam.snapshotUrl).toBe(cameraImageUrl('tfl:00002.00865'))
    expect(cam.snapshotUrl).toMatch(/\/api\/v1\/cameras\/tfl%3A00002\.00865\/image$/)
    expect(CAMERA_ID.test(cam.id)).toBe(true)
    expect(CAMERA_ID.test('../../etc/passwd')).toBe(false)
    expect(publicFeed(cam)).not.toHaveProperty('image')
  })

  it('a short list shows every city in turn', () => {
    const list = ['tfl:1', 'tfl:2', 'tfl:3', 'nyc:1', 'hk:1', 'nyc:2'].map(id => ({ id }))
    expect(interleave(list).map(c => c.id)).toEqual(['tfl:1', 'nyc:1', 'hk:1', 'tfl:2', 'nyc:2', 'tfl:3'])
  })
})

describe('fetchPicture', () => {
  const jpeg = Buffer.alloc(4_000, 0xff)
  const reply = (headers: Record<string, string>, body: Buffer = jpeg, status = 200) =>
    vi.fn(async () => new Response(body, { status, headers })) as unknown as typeof fetch
  const now = Date.parse('2026-10-19T17:00:00Z')

  it('a fresh JPEG: the picture and when it was taken', async () => {
    const pic = await fetchPicture('https://x/1.jpg', reply({ 'content-type': 'image/jpeg', 'last-modified': 'Mon, 19 Oct 2026 16:58:00 GMT' }), now)
    expect(pic?.type).toBe('image/jpeg')
    expect(pic?.at).toBe('2026-10-19T16:58:00.000Z')
    expect(pic?.body.length).toBe(4_000)
  })

  it('a page, an error, a placeholder or a picture older than 6 hours is no picture', async () => {
    expect(await fetchPicture('https://x', reply({ 'content-type': 'text/html' }), now)).toBeNull()
    expect(await fetchPicture('https://x', reply({ 'content-type': 'image/jpeg' }, jpeg, 404), now)).toBeNull()
    expect(await fetchPicture('https://x', reply({ 'content-type': 'image/jpeg' }, Buffer.alloc(300)), now)).toBeNull()
    const old = new Date(now - PICTURE_STALE_MS - 60_000).toUTCString()
    expect(await fetchPicture('https://x', reply({ 'content-type': 'image/jpeg', 'last-modified': old }), now)).toBeNull()
  })

  it('never follows a redirect', async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe('error')
      throw new TypeError('redirect mode is set to error')
    }) as unknown as typeof fetch
    expect(await fetchPicture('https://x', f, now)).toBeNull()
  })

  it('an id that isn\'t a camera id is never looked up', async () => {
    expect(await cameraPicture('../../etc/passwd')).toBeNull()
  })
})
