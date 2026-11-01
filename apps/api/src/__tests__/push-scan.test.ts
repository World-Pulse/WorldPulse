/**
 * Push alerts (lib/push-scan.ts, Oct 31, 2026): which verified stories go
 * to which browsers, once a story and at most 6 a day, and what the
 * notification says.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = new Map<string, string>()
vi.mock('../db/redis', () => ({
  redis: {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, val: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(k)) return null
      store.set(k, val); return 'OK'
    }),
    incr: vi.fn(async (k: string) => { const n = Number(store.get(k) ?? 0) + 1; store.set(k, String(n)); return n }),
    expire: vi.fn(async () => 1),
    del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
  },
}))
vi.mock('../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = { signals: [], web_push_subscriptions: [] }
const updates: Array<{ id: unknown; data: Row }> = []
const deletes: unknown[] = []
vi.mock('../db/postgres', () => {
  const chain = (table: string) => {
    let id: unknown
    const api: Record<string, unknown> = {}
    const self = () => api
    for (const m of ['whereIn', 'whereRaw', 'orderByRaw', 'limit', 'select', 'orWhereRaw']) api[m] = self
    api.where = (f: unknown, v?: unknown) => {
      if (typeof f === 'function') (f as (q: unknown) => void)(api)
      else if (f === 'id') id = v
      return api
    }
    api.update = (data: Row) => { updates.push({ id, data }); const p = Promise.resolve(1) as Promise<number> & { returning?: unknown }; p.returning = async () => [{ fail_count: 1 }]; return p }
    api.delete = async () => { deletes.push(id); return 1 }
    api.then = (res: (v: Row[]) => unknown) => Promise.resolve(tables[table]).then(res)
    return api
  }
  const db = (t: string) => chain(t)
  db.raw = (s: string) => ({ raw: s })
  db.fn = { now: () => 'now()' }
  return { db }
})

const sent: Array<{ endpoint: string; message: Record<string, unknown> }> = []
vi.mock('../lib/web-push', () => ({
  sendPush: vi.fn(async (t: { endpoint: string }, message: Record<string, unknown>) => {
    sent.push({ endpoint: t.endpoint, message })
    return t.endpoint.includes('gone') ? { result: 'gone', status: 410 } : { result: 'sent', status: 201 }
  }),
  pushTopic: (k: string) => `t-${k}`,
}))

import { isBreaking, wants, oneEach, pushMessage, nyDay, welcomeMessage, scanPush, PUSHES_A_DAY, type PushStory } from '../lib/push-scan'

const story = (o: Partial<PushStory> = {}): PushStory => ({
  id: 's1', title: 'Strong earthquake strikes off the coast', severity: 'critical', source_count: 3,
  country_code: 'JP', location_name: 'Sendai, Japan', story_key: 'k1', ...o,
})

describe('which stories go to which browsers', () => {
  it('counts as breaking a critical story once verified, and a high one at 5 outlets', () => {
    expect(isBreaking({ severity: 'critical', source_count: 2 })).toBe(true)
    expect(isBreaking({ severity: 'high', source_count: 4 })).toBe(false)
    expect(isBreaking({ severity: 'high', source_count: 5 })).toBe(true)
    expect(isBreaking({ severity: 'medium', source_count: 30 })).toBe(false)
  })

  it("sends a country's high and critical stories to browsers that follow it, breaking news to those that asked", () => {
    const iran = story({ severity: 'high', source_count: 2, country_code: 'IR' })
    expect(wants({ breaking: false, countries: ['IR'] }, iran)).toBe(true)
    expect(wants({ breaking: true, countries: [] }, iran)).toBe(false)
    expect(wants({ breaking: false, countries: ['QA'] }, iran)).toBe(false)
    expect(wants({ breaking: true, countries: [] }, story())).toBe(true)
    expect(wants({ breaking: false, countries: ['IR'] }, story({ severity: 'medium', country_code: 'IR' }))).toBe(false)
  })

  it('takes each story once, as its report with the most outlets', () => {
    const r = oneEach([story({ id: 'a', source_count: 3 }), story({ id: 'b', source_count: 6 }), story({ id: 'c', story_key: 'k2' })])
    expect(r.map(s => s.id)).toEqual(['b', 'c'])
  })

  it('says the headline, how many outlets and where, and opens the story', () => {
    expect(pushMessage(story())).toEqual({
      title: 'Strong earthquake strikes off the coast',
      body: 'Verified by 3 outlets · Sendai, Japan',
      url: 'https://world-pulse.io/signals/s1?utm_source=push',
      tag: 'k1',
    })
    expect(pushMessage(story({ title: 'x'.repeat(200), location_name: null })).title.length).toBeLessThanOrEqual(140)
    expect(pushMessage(story({ location_name: null })).body).toBe('Verified by 3 outlets')
  })

  it("counts the day in New York and says what the reader will get", () => {
    expect(nyDay(Date.parse('2026-11-01T03:30:00Z'))).toBe('2026-10-31')
    expect(welcomeMessage(true, []).body).toContain('breaking news')
    expect(welcomeMessage(false, ['Iran']).body).toContain('major stories in Iran')
    expect(welcomeMessage(true, ['Iran']).body).toContain(`${PUSHES_A_DAY} a day at most`)
  })
})

describe('a look (scanPush)', () => {
  const now = Date.parse('2026-11-01T12:00:00Z')
  const row = (o: Row) => ({ id: 's1', title: 'Quake', severity: 'critical', source_count: 3, country_code: 'JP',
    location_name: 'Sendai, Japan', story_id: 'k1', at: new Date(now - 11 * 60_000).toISOString(), ...o })

  beforeEach(() => {
    store.clear(); sent.length = 0; updates.length = 0; deletes.length = 0
    delete process.env.WEB_PUSH_OFF
    tables.signals = [
      row({}), row({ id: 's2', source_count: 5, story_id: 'k1' }),
      row({ id: 's3', severity: 'high', source_count: 2, country_code: 'IR', location_name: 'Tehran, Iran', story_id: 'k3' }),
    ]
    tables.web_push_subscriptions = [
      { id: 'b1', endpoint: 'https://fcm.googleapis.com/fcm/send/one', p256dh: 'p', auth: 'a', breaking: true, countries: [] },
      { id: 'b2', endpoint: 'https://web.push.apple.com/gone', p256dh: 'p', auth: 'a', breaking: false, countries: ['IR'] },
    ]
  })

  it('sends each browser the stories it wants, each story once, and drops a subscription the service says is gone', async () => {
    const run = await scanPush(now)
    expect(run).toMatchObject({ stories: 2, sent: 1, gone: 1 })
    expect(sent.map(s => [s.endpoint.split('/').pop(), s.message.tag])).toEqual([['one', 'k1'], ['gone', 'k3']])
    expect(deletes).toEqual(['b2'])
    // the next look starts where this one ended: nothing new, nothing sent twice
    sent.length = 0
    expect((await scanPush(now + 60_000)).sent).toBe(0)
    expect(sent).toHaveLength(0)
  })

  it(`sends a browser ${PUSHES_A_DAY} a day at most`, async () => {
    tables.signals = Array.from({ length: PUSHES_A_DAY + 3 }, (_, i) => row({ id: `s${i}`, story_id: `k${i}` }))
    tables.web_push_subscriptions = [tables.web_push_subscriptions[0]!]
    const run = await scanPush(now)
    expect(run.sent).toBe(PUSHES_A_DAY)
  })

  it('sends nothing while WEB_PUSH_OFF=1', async () => {
    process.env.WEB_PUSH_OFF = '1'
    expect((await scanPush(now)).skipped).toBe('off')
    expect(sent).toHaveLength(0)
  })
})
