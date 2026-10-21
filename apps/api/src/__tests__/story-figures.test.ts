/**
 * A story's figures and the outlets that report each one (plan 14, Oct 21,
 * 2026: "next to each claim inside a story, its outlets"). The headlines here
 * are real ones from the Abyei market strike and the Houthi strike on a Yemen
 * training camp (Oct 2026), as collected, plus the traps that must not count.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  sql: [] as string[],
  bindings: [] as unknown[][],
  keys: [] as string[],
}))

vi.mock('../db/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK'), set: vi.fn(async () => 'OK'), del: vi.fn(async () => 1) } }))
vi.mock('../middleware/auth', () => ({
  authenticate: (_req: unknown, _rep: unknown, done: () => void) => done(),
  optionalAuth: (_req: unknown, _rep: unknown, done: () => void) => done(),
}))
vi.mock('../db/postgres', () => {
  const raw = vi.fn(async (sql: string, bindings: unknown[]) => {
    h.sql.push(sql)
    h.bindings.push(bindings)
    return { rows: h.rows }
  })
  return {
    db: Object.assign(
      vi.fn(() => ({ where: (_c: string, id: string) => ({ first: async () => (id === SIGNAL ? { story_id: STORY } : undefined) }) })),
      { schema: { hasColumn: vi.fn(async () => true) }, raw },
    ),
  }
})
vi.mock('../lib/long-query', async () => {
  const { db } = await import('../db/postgres')
  return { longQuery: vi.fn(async (_s: number, run: (trx: unknown) => Promise<unknown>) => run({ raw: db.raw })) }
})
vi.mock('../lib/swr-cache', async (orig) => {
  const real = await orig<typeof import('../lib/swr-cache')>()
  return { ...real, staleWhileRevalidate: vi.fn(async (key: string, _o: unknown, make: () => Promise<unknown>) => { h.keys.push(key); return make() }) }
})

const STORY = '11111111-1111-4111-8111-111111111111'
const SIGNAL = '22222222-2222-4222-8222-222222222222'

const { findFigures, storyFigures } = await import('../lib/story-figures')
const { registerStoryRoutes } = await import('../routes/stories')

const said = (headline: string) => findFigures(headline).map(f => `${f.kind}:${f.qualifier ? f.qualifier + ' ' : ''}${f.value}`)

describe('findFigures: the numbers a headline reports', () => {
  it('reads tolls, both sides of the verb', () => {
    expect(said('Death toll from Houthi attack on Yemen training camp rises to 73')).toEqual(['killed:73'])
    expect(said('Drone strike on a market in disputed African region of Abyei kills at least 153')).toEqual(['killed:at least 153'])
    expect(said('At least 153 people killed in drone strike on disputed Sudan-South Sudan region')).toEqual(['killed:at least 153'])
    expect(said('Sudan army drones hit mourners and fuel market killing more than 200 people, sources say')).toEqual(['killed:more than 200'])
    expect(said('Death toll from Abyei market drone strike rises to more than 220')).toEqual(['killed:more than 220'])
    expect(said('Abyei drone attack death toll reaches 220')).toEqual(['killed:220'])
    expect(said('Fire claims 9 lives in Lagos market')).toEqual(['killed:9'])
  })

  it('reads several kinds in one headline, with words between the number and what it counts', () => {
    expect(said('Shabwa Authorities: 53 Recruits Killed and 200 Injured in Houthi Missile Attack on Training Camp')).toEqual(['killed:53', 'injured:200'])
    expect(said('Ukraine says Russian strike on Kharkiv kills 7, injures 40')).toEqual(['killed:7', 'injured:40'])
    expect(said('Two killed, 12 injured as bus overturns in Kenya')).toEqual(['killed:2', 'injured:12'])
    expect(said('More than 8,000 displaced after deadly drone attack in Abyei')).toEqual(['displaced:more than 8000'])
    expect(said('Floods displace 1.2 million people in Nigeria')).toEqual(['displaced:1200000'])
    expect(said('Gunmen abduct 15 students in Kaduna')).toEqual(['abducted:15'])
    expect(said('Police arrest 11 suspects for cultism, ATM fraud in Kogi')).toEqual(['detained:11'])
    expect(said('15 people missing after boat capsizes off Libya')).toEqual(['missing:15'])
  })

  it('reads Spanish, French and Portuguese, and says the hedge in English', () => {
    expect(said('Incendio deja 12 muertos y 30 heridos en Bogotá')).toEqual(['killed:12', 'injured:30'])
    expect(said('Séisme au Maroc : au moins 2 000 morts')).toEqual(['killed:at least 2000'])
    expect(said('Inundaciones dejan 2.000 desplazados en Colombia')).toEqual(['displaced:2000'])
    expect(said('Ataque deixa ao menos 12 mortos no Rio')).toEqual(['killed:at least 12'])
    expect(said('Más de 300 heridos en protestas en Lima')).toEqual(['injured:more than 300'])
    expect(said('Over 100 dead in Brazil floods')).toEqual(['killed:more than 100'])
    expect(said('Sudan drone strike kills around 150 in Abyei market')).toEqual(['killed:about 150'])
  })

  it('leaves out ages, years, money, shares, names and things that count no one', () => {
    expect(said("Swimmer, 65, killed in shark attack off South Africa's east coast")).toEqual([])
    expect(said('65-year-old woman killed in shark attack off South African coast')).toEqual([])
    expect(said('Man, 40, arrested after stabbing')).toEqual([])
    expect(said('2026 floods kill 15 in Kerala')).toEqual(['killed:15'])
    expect(said('Fire at $5 million warehouse kills 2')).toEqual(['killed:2'])
    expect(said('Unemployment rises to 5.2 percent')).toEqual([])
    expect(said('COVID-19 deaths rise in Delhi')).toEqual([])
    expect(said('Rescue 1122 says 5 killed in Lahore collapse')).toEqual(['killed:5'])
    expect(said('Trump left 2 options on the table')).toEqual([])
    expect(said('Trump claims 2 wins')).toEqual([])
    expect(said('Two held talks in Doha')).toEqual([])
    expect(said('2 suspects fled the scene')).toEqual([])
    expect(said('Explosion kills 1.5 people?')).toEqual([])
    expect(said('Storm leaves dozens dead')).toEqual([])
  })
})

describe('storyFigures: each figure with the outlets that report it', () => {
  const r = (title: string, url: string, at: string) => ({ title, urls: [url, 'https://other.example/x'], at })
  const reports = [
    r('Drone strike on a market in disputed African region of Abyei kills at least 153', 'https://www.reuters.com/a', '2026-10-20T09:00:00Z'),
    r('At least 153 people killed in drone strike on disputed Sudan-South Sudan region', 'https://apnews.com/b', '2026-10-20T10:00:00Z'),
    r('Death toll from drone strikes on Abyei market rises to 153', 'https://www.aljazeera.com/c', '2026-10-20T11:00:00Z'),
    r('Drone strike on a market in disputed African region of Abyei kills at least 153', 'https://reuters.com/d', '2026-10-20T12:00:00Z'),
    r('Abyei drone attack death toll reaches 220', 'https://sudantribune.com/e', '2026-10-21T08:00:00Z'),
    r('More than 8,000 displaced after deadly drone attack in Abyei', 'https://radiotamazuj.org/f', '2026-10-21T07:00:00Z'),
    r('Sudan: what we know', 'https://bbc.com/g', '2026-10-21T09:00:00Z'),
  ]

  it('groups by number, counts outlets by website (www. or not), and keeps the hedge most of them used', () => {
    const [killed, displaced] = storyFigures(reports)
    expect(killed.kind).toBe('killed')
    expect(killed.values.map(v => v.value)).toEqual([220, 153]) // newest first
    const v153 = killed.values[1]!
    expect(v153).toMatchObject({ text: 'at least 153', outlets: 3, reports: 4, outletNames: ['aljazeera.com', 'apnews.com', 'reuters.com'] })
    expect(v153.firstAt).toBe('2026-10-20T09:00:00.000Z')
    expect(v153.lastAt).toBe('2026-10-20T12:00:00.000Z')
    expect(v153.url).toBe('https://reuters.com/d') // the newest report that said it
    expect(killed.values[0]).toMatchObject({ text: '220', outlets: 1, outletNames: ['sudantribune.com'], headline: 'Abyei drone attack death toll reaches 220' })
    expect(displaced).toMatchObject({ kind: 'displaced', label: 'Displaced', values: [{ value: 8000, text: 'more than 8,000', outlets: 1 }] })
  })

  it('keeps the kinds in a fixed order and at most the asked number of values', () => {
    const many = [10, 20, 30, 40, 50, 60].map((n, i) => r(`Clashes kill ${n}`, `https://site${i}.com/x`, `2026-10-2${i}T00:00:00Z`))
    const [killed] = storyFigures([...many, r('Floods leave 5 injured', 'https://x.com/1', '2026-10-20T00:00:00Z')], 5)
    expect(killed.values).toHaveLength(5)
    expect(killed.values[0]!.value).toBe(60)
    expect(storyFigures([r('Floods leave 5 injured and 2 dead', 'https://x.com/1', '2026-10-20T00:00:00Z')]).map(f => f.kind)).toEqual(['killed', 'injured'])
  })

  it('says nothing for a story without figures', () => {
    expect(storyFigures([r('Sudan: what we know', 'https://bbc.com/g', '2026-10-21T09:00:00Z')])).toEqual([])
    expect(storyFigures([])).toEqual([])
  })
})

describe('GET /api/v1/stories/:id/figures', () => {
  async function get(id: string) {
    const app = Fastify({ logger: false })
    await app.register(registerStoryRoutes, { prefix: '/api/v1/stories' })
    return app.inject({ method: 'GET', url: `/api/v1/stories/${id}/figures` })
  }

  beforeEach(() => {
    h.sql = []; h.bindings = []; h.keys = []
    h.rows = [
      { title: 'Death toll from Houthi attack on Yemen training camp rises to 73', original_urls: ['https://www.reuters.com/x'], created_at: '2026-10-21T10:00:00Z' },
      { title: 'Houthi missile attack on Yemen base kills 53', original_urls: ['https://apnews.com/y'], created_at: '2026-10-20T10:00:00Z' },
      { title: 'Shabwa Authorities: 53 Recruits Killed and 200 Injured', original_urls: ['https://sabanew.net/z'], created_at: '2026-10-20T11:00:00Z' },
    ]
  })

  it("answers for a report's story: its members in the story's last two days", async () => {
    const res = await get(SIGNAL)
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data).toMatchObject({ storyId: STORY, reports: 3, countedHours: 48 })
    expect(data.figures[0].values.map((v: { value: number }) => v.value)).toEqual([73, 53])
    expect(data.figures[0].values[1]).toMatchObject({ outlets: 2, outletNames: ['apnews.com', 'sabanew.net'] })
    expect(data.figures[1]).toMatchObject({ kind: 'injured', values: [{ value: 200, outlets: 1 }] })
    expect(h.sql[0]).toMatch(/\(story_id = \? OR id = \?\)/)
    expect(h.sql[0]).toMatch(/INTERVAL '48 hours'/)
    expect(h.sql[0]).toMatch(/LIMIT 400/)
    expect(h.bindings[0]).toEqual([STORY, STORY])
    expect(h.keys).toEqual([`stories:figures:v1:${STORY}`])
  })

  it('refuses an id that is not one, and says when there is no story', async () => {
    const bad = await get('not-an-id')
    expect(bad.statusCode).toBe(400)
    expect(bad.json()).toMatchObject({ success: false })
    h.rows = []
    const none = await get(STORY)
    expect(none.statusCode).toBe(404)
  })
})
