/**
 * The World Map's news layers found by headline (Oct 21, 2026): protests,
 * disease outbreaks, refugees and displacement. The cases are real headlines
 * of Oct 21.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../db/postgres', () => ({ db: { raw: (s: string) => s } }))
vi.mock('../db/redis', () => ({ redis: {} }))
vi.mock('../lib/swr-cache', () => ({ staleWhileRevalidate: (_k: string, _o: unknown, make: () => Promise<unknown>) => make() }))
const rowsFor = vi.hoisted(() => ({ rows: [] as unknown[] }))
vi.mock('../lib/long-query', () => ({ longQuery: async () => rowsFor.rows }))

import Fastify from 'fastify'
import { MAP_TOPICS, isMapTopic, isTopicReport, topicCandidate } from '../lib/map-topics'
import { registerMapTopicRoutes, topicFeatures, type TopicRow } from '../routes/map/topics'

describe('protests and unrest', () => {
  it.each([
    "France’s Macron says protesters won’t be allowed to ‘cause chaos’",
    'Italy deploys troops into Milan in response to recent riots',
    'USET staff threaten indefinite strike over salary delays and unpaid deductions',
    'Barilla workers down tools over production plan',
    'Albanian police clash with anti-government protesters for eighth day',
    '“Your Peace Is Capitulation”: Protesters Rally in Sofia Against Government’s "Russia Policy"',
    'Émeutes : Navin Ramgoolam évoque des attaques coordonnées et défend la légalité du couvre-feu',
    'Grève à la SENELEC : le gouverneur de Dakar ordonne la réquisition d’une partie du personnel',
    'Manifestantes do Rossio acusam PSP de violência',
    'Gobierno francés ve en protestas “estrategia de insurrección”',
    'EU Parliament vice president starts Oleshky hunger strike',
  ])('%s', title => {
    expect(isTopicReport('protests', title, 'geopolitics')).toBe(true)
  })

  it.each([
    'SpaceX Boosts the A.I. Rally',
    'Oppenheimer’s Stoltzfus Sees ‘Broader Rally’ in Stocks to Year End',
    'El Rally Dakar prepara su desembarco en Marruecos',
    'Trump to rally for Graham in tight South Carolina Senate race',
    'La Dadetokopon MP rallies women aspirants for peaceful, issue-based campaign',
    'Riot Games announces a new season',
    'A live demonstration of the new reactor design',
    'Opinion: Why the protests will fail',
  ])('not: %s', title => {
    expect(isTopicReport('protests', title, 'economy')).toBe(false)
  })

  it('leaves sport and culture out', () => {
    expect(isTopicReport('protests', 'Fans protest the referee after the final whistle', 'sports')).toBe(false)
  })
})

describe('disease outbreaks', () => {
  it.each([
    'Nigeria confirms first Ebola case as outbreak spreads across Africa',
    'Measles outbreak: Death toll reaches 1,205 as one die in 24 hours',
    'Cholera Fears Grow After 3 Deaths in Central Darfur',
    'Afghanistan records 42 polio cases in 2026, WHO data show',
    'Ouagadougou : une recrudescence de cas probables de dengue observée',
    'Sanidad estudia introducir la vacuna R21 contra el paludismo',
    'Sal: Surto de conjuntivite viral já registou 1.400 casos',
    "Prawn kebab suspected as cause of salmonella outbreak affecting 40 at Iznate wedding",
  ])('%s', title => {
    expect(isTopicReport('outbreaks', title, 'health')).toBe(true)
  })

  it.each([
    'Nuclear tests, purges and a pandemic: The long road to the New Yalu River Bridge',
    'Fresh outbreak of violence in the north leaves 12 dead',
    'The loneliness epidemic is getting worse',
    'Un brote de violencia deja tres heridos',
  ])('not: %s', title => {
    expect(isTopicReport('outbreaks', title, 'geopolitics')).toBe(false)
  })
})

describe('refugees and displacement', () => {
  it.each([
    'More than 8,000 displaced after deadly drone attack in Abyei',
    'Fire destroys homes, displacing families in North Darfur village',
    'Kelantan orders data collection on Myanmar refugees across all districts',
    'Congo/Hcr : Kintélé abritera la sixième réunion tripartite sur la protection des réfugiés de la Rdc',
    'Costa Rica con atraso de 177.971 solicitudes de asilo',
    'Toxic chemical leak sparks mass evacuation as mysterious haze blankets Ohio city',
  ])('%s', title => {
    expect(isTopicReport('displacement', title, 'conflict')).toBe(true)
  })

  it.each([
    'Canada orders deportation of Toronto man who helped Iran evade sanctions',
    'AI could mean job displacement for millions, report says',
    'An exodus of talent from the tech sector',
    'Deportes: el equipo gana la final',
  ])('not: %s', title => {
    expect(isTopicReport('displacement', title, 'geopolitics')).toBe(false)
  })

  it('leaves economy stories out (migrant finance, remittances)', () => {
    expect(isTopicReport('displacement', 'Refugees open shops as the economy recovers', 'economy')).toBe(false)
  })
})

describe('the database pattern', () => {
  it('is one alternation between word edges', () => {
    for (const topic of MAP_TOPICS) {
      const p = topicCandidate(topic)
      expect(p.startsWith('\\m(')).toBe(true)
      expect(p.endsWith(')\\M')).toBe(true)
      // PostgreSQL's ARE has no lookbehind in these patterns, and no JavaScript-only escapes
      expect(p).not.toMatch(/\(\?<|\\p\{|\\b/)
    }
  })

  it('knows its topics', () => {
    expect(isMapTopic('protests')).toBe(true)
    expect(isMapTopic('sports')).toBe(false)
    expect(isMapTopic(undefined)).toBe(false)
  })
})

const row = (over: Partial<TopicRow>): TopicRow => ({
  id: 'a', title: 'Protesters clash with police in Tirana', category: 'geopolitics', severity: 'high',
  location_name: 'Tirana, Albania', created_at: '2026-10-21T10:00:00.000Z', lat: 41.3275, lng: 19.818912, ...over,
})

describe('topicFeatures', () => {
  it('keeps each story once per place, newest first, with a place', () => {
    const f = topicFeatures('protests', [
      row({ id: 'a' }),
      row({ id: 'b' }),                                        // the same headline at the same place
      row({ id: 'c', lat: 37.98, lng: 23.73, location_name: 'Athens' }), // the same headline elsewhere
      row({ id: 'd', lat: null, lng: null }),                  // no place
      row({ id: 'e', lat: 0, lng: 0, title: 'Protest at Null Island' }),
      row({ id: 'f', title: 'Stocks rally as the Fed holds rates' }),
    ])
    expect(f.map(x => x.properties.id)).toEqual(['a', 'c'])
    expect(f[0].geometry.coordinates).toEqual([19.8189, 41.3275])
    expect(f[0].properties).toMatchObject({ title: 'Protesters clash with police in Tirana', place: 'Tirana, Albania', severity: 'high' })
  })

  it('caps the layer', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ id: String(i), title: `Protest number ${i} in Tirana` }))
    expect(topicFeatures('protests', rows, 4)).toHaveLength(4)
  })

  it('writes dates as ISO text', () => {
    const f = topicFeatures('protests', [row({ created_at: new Date('2026-10-21T11:00:00Z') })])
    expect(f[0].properties.created_at).toBe('2026-10-21T11:00:00.000Z')
  })
})

describe('GET /api/v1/map/topics/:topic', () => {
  async function app() {
    const a = Fastify()
    await a.register(registerMapTopicRoutes, { prefix: '/api/v1/map' })
    return a
  }

  it('answers GeoJSON for a topic', async () => {
    rowsFor.rows = [row({ id: 'x', title: 'Ebola outbreak spreads to Abuja', category: 'health' })]
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/map/topics/outbreaks' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({ success: true, topic: 'outbreaks', hours: 72, type: 'FeatureCollection' })
    expect(body.features).toHaveLength(1)
    expect(res.headers['cache-control']).toBe('public, max-age=300')
  })

  it('refuses a topic it doesn\'t have', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/map/topics/sports' })
    expect(res.statusCode).toBe(400)
  })
})
