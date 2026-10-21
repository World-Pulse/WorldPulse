/**
 * Saved alerts against every new report, and on verification (plan 10 and
 * K6, Oct 21, 2026). Until now the dispatcher fed saved alerts the API list's
 * 50 newest verified critical and high reports (its "since" was never read),
 * and only when someone also had chat-app alert settings: a Follow alert
 * ("every report naming it, however minor") almost never matched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  keys: new Map<string, string>(),
  counts: new Map<string, number>(),
  kept: [] as Array<[string, string]>,
  emails: [] as Array<[string, string]>,
  subs: [] as Array<Record<string, unknown>>,
  rows: [] as Array<Record<string, unknown>>,
  queries: [] as Array<Array<[string, unknown[]]>>,
}))

vi.mock('../db/redis', () => ({
  redis: {
    get: async (k: string) => h.keys.get(k) ?? null,
    set: async (k: string, v: string, ...rest: unknown[]) => {
      if (rest.includes('NX') && h.keys.has(k)) return null
      h.keys.set(k, v); return 'OK'
    },
    del: async (k: string) => { h.keys.delete(k); return 1 },
    exists: async (k: string) => (h.keys.has(k) ? 1 : 0),
    setex: async (k: string, _s: number, v: string) => { h.keys.set(k, v); return 'OK' },
    incr: async (k: string) => { const n = (h.counts.get(k) ?? 0) + 1; h.counts.set(k, n); return n },
    expire: async () => 1,
    scan: async () => ['0', []],
    duplicate: () => ({ subscribe: () => {}, on: () => {}, unsubscribe: async () => {}, disconnect: () => {} }),
  },
}))
vi.mock('../db/postgres', () => {
  const subsQuery: Record<string, unknown> = {}
  for (const m of ['join', 'where', 'whereRaw', 'whereNotNull']) subsQuery[m] = () => subsQuery
  subsQuery.select = async () => h.subs
  const signalsQuery = () => {
    const calls: Array<[string, unknown[]]> = []
    h.queries.push(calls)
    const q: Record<string, unknown> = {}
    for (const m of ['where', 'whereIn', 'whereRaw', 'orderBy', 'orderByRaw', 'limit']) q[m] = (...args: unknown[]) => { calls.push([m, args]); return q }
    q.select = async () => h.rows
    return q
  }
  const db = (table: string) => (table === 'signals' ? signalsQuery() : subsQuery)
  return { db: Object.assign(db, { raw: (sql: string) => sql }) }
})
vi.mock('../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../lib/email', () => ({
  sendAlertEmail: async (to: string, s: { id: string }) => { h.emails.push([to, s.id]) },
}))
vi.mock('../lib/alert-digest', () => ({
  keepForDigest: async (sub: string, id: string) => { h.kept.push([sub, id]) },
}))

import { alertWhen, alertMatches } from '../lib/alert-match'
import { alertDispatcher, EMAILS_A_DAY } from '../lib/alert-dispatcher'
import { scanAlerts, rowToSignal, NEW_SETTLE_MS, VERIFIED_SETTLE_MS, MAX_BACK_MS, BATCH } from '../lib/alert-scan'

const NOW = Date.parse('2026-10-21T18:00:00Z')
const sub = (o: Record<string, unknown> = {}) => ({
  sub_id: 'sub-1', user_id: 'u-1', keywords: [], categories: [], countries: [], min_severity: 'medium',
  channels: { email: true }, email: 'reader@example.com', display_name: null, ...o,
})
const row = (o: Record<string, unknown> = {}) => ({
  id: 'r-1', title: 'Flooding in Lagos displaces thousands', summary: null, category: 'disaster', severity: 'medium',
  status: 'pending', country_code: 'NG', location_name: 'Lagos', source_count: 1, reliability_score: 0.6,
  story_id: null, original_urls: ['https://example.com/a'], created_at: '2026-10-21T17:58:00Z',
  verified_at: null, last_corroborated_at: null, at: '2026-10-21T17:58:00Z', ...o,
})
const calls = (i: number, m: string) => (h.queries[i] ?? []).filter(([n]) => n === m).map(([, a]) => a)

beforeEach(() => {
  h.keys.clear(); h.counts.clear(); h.kept = []; h.emails = []; h.subs = []; h.rows = []; h.queries = []
})

describe('when an alert fires', () => {
  it('on each report, or once a story is verified with enough outlets', () => {
    expect(alertWhen({ email: true })).toEqual({ verified: false, minOutlets: 1 })
    expect(alertWhen({ verified: true })).toEqual({ verified: true, minOutlets: 2 })
    expect(alertWhen('{"verified":true,"min_outlets":3}')).toEqual({ verified: true, minOutlets: 3 })
    expect(alertWhen({ verified: true, min_outlets: 40 })).toEqual({ verified: true, minOutlets: 2 })
    expect(alertWhen({ verified: 'yes' }).verified).toBe(false)
  })
  it('a report with no country doesn\'t pass an alert for certain countries', () => {
    const r = { title: 'Markets slide', category: 'economy', severity: 'high', countryCode: null }
    expect(alertMatches({ countries: ['UA'] }, r)).toBe(false)
    expect(alertMatches({ countries: [] }, r)).toBe(true)
    expect(alertMatches({ min_severity: 'critical' }, r)).toBe(false)
    expect(alertMatches({ keywords: ['markets'] }, r)).toBe(true)
  })
})

describe('a look at the new reports', () => {
  it('reads every report since the last look, at the lowest severity any alert asks for, and hands them to the alerts', async () => {
    h.subs = [sub({ min_severity: 'low' }), sub({ sub_id: 'sub-2', min_severity: 'high' })]
    h.rows = [row(), row({ id: 'r-2', severity: 'low', title: 'Lagos council meets' })]
    h.keys.set('alerts:scan:new:since', '2026-10-21T17:55:00.000Z')
    const run = await scanAlerts(NOW)
    expect(run.newReports).toBe(2)
    const wheres = calls(0, 'where')
    expect(wheres).toContainEqual(['created_at', '>', '2026-10-21T17:55:00.000Z'])
    expect(wheres).toContainEqual(['created_at', '<=', new Date(NOW - NEW_SETTLE_MS).toISOString()])
    expect(calls(0, 'whereIn')).toContainEqual(['status', ['pending', 'verified']])
    expect(calls(0, 'whereIn')).toContainEqual(['severity', ['critical', 'high', 'medium', 'low']])
    // the low report reaches the alert that asks for low, not the one for high
    expect(h.emails).toEqual([['reader@example.com', 'r-1'], ['reader@example.com', 'r-2']])
    expect(h.keys.get('alerts:scan:new:since')).toBe(new Date(NOW - NEW_SETTLE_MS).toISOString())
  })

  it('goes back an hour at most, and carries on from the last report of a full batch', async () => {
    h.subs = [sub()]
    h.keys.set('alerts:scan:new:since', '2026-10-20T06:00:00.000Z')
    h.rows = Array.from({ length: BATCH }, (_, i) => row({ id: `r-${i}`, at: new Date(NOW - 50 * 60_000 + i).toISOString() }))
    await scanAlerts(NOW)
    expect(calls(0, 'where')).toContainEqual(['created_at', '>', new Date(NOW - NEW_SETTLE_MS - MAX_BACK_MS).toISOString()])
    expect(h.keys.get('alerts:scan:new:since')).toBe(new Date(NOW - 50 * 60_000 + BATCH - 1).toISOString())
  })

  it('does nothing without alerts', async () => {
    expect((await scanAlerts(NOW)).skipped).toBe('no alerts')
    expect(h.queries).toHaveLength(0)
  })
})

describe('alerts that wait for verification', () => {
  const vsub = sub({ sub_id: 'v-1', countries: ['SD'], min_severity: 'high', channels: { email: true, verified: true, min_outlets: 3 } })

  it('skip the new reports, and fire once a story has the outlets, each story once', async () => {
    h.subs = [vsub]
    h.rows = [
      row({ id: 'a', status: 'verified', severity: 'high', country_code: 'SD', source_count: 3, story_id: 'story-1', title: 'Drone strike on El Fasher market' }),
      row({ id: 'b', status: 'verified', severity: 'high', country_code: 'SD', source_count: 4, story_id: 'story-1', title: 'El Fasher market strike: toll rises' }),
      row({ id: 'c', status: 'verified', severity: 'high', country_code: 'SD', source_count: 2, story_id: 'story-2', title: 'Talks in Jeddah' }),
      row({ id: 'd', status: 'verified', severity: 'high', country_code: 'TD', source_count: 5, story_id: 'story-3', title: 'Chad border closed' }),
    ]
    const run = await scanAlerts(NOW)
    // only the verified look ran (the alert waits for verification)
    expect(h.queries).toHaveLength(1)
    expect(calls(0, 'where')).toContainEqual(['status', 'verified'])
    expect(calls(0, 'whereRaw').some(([sql, args]) => /source_count/.test(String(sql)) && (args as unknown[])[0] === 3)).toBe(true)
    expect(calls(0, 'whereRaw').some(([sql, args]) => /<= \?/.test(String(sql)) && (args as unknown[])[0] === new Date(NOW - VERIFIED_SETTLE_MS).toISOString())).toBe(true)
    expect(run.verifiedSent).toBe(1)
    expect(h.emails).toEqual([['reader@example.com', 'a']])
    // the same story again later: not sent twice
    h.queries = []
    await scanAlerts(NOW + 60_000)
    expect(h.emails).toHaveLength(1)
  })

  it('an alert on each report never gets the verified look\'s stories, and a verified one never the new reports', async () => {
    await alertDispatcher.dispatchDbSubscriptionAlerts([rowToSignal(row({ id: 'n', severity: 'high', country_code: 'SD' }) as never)])
    expect(h.emails).toHaveLength(0) // no alerts loaded yet
    h.subs = [vsub, sub({ sub_id: 'plain' })]
    await alertDispatcher.dispatchDbSubscriptionAlerts([rowToSignal(row({ id: 'n', severity: 'high', country_code: 'SD' }) as never)])
    expect(h.emails).toEqual([['reader@example.com', 'n']])
    expect([...h.keys.keys()].some(k => k.includes(':v-1:'))).toBe(false)
  })

  it('a digest alert keeps its verified stories for the morning: "a 7am digest of verified stories"', async () => {
    h.subs = [sub({ sub_id: 'd-1', channels: { email: true, verified: true, digest: 'daily' } })]
    h.rows = [row({ id: 'v', status: 'verified', source_count: 2, story_id: 's' })]
    await scanAlerts(NOW)
    expect(h.kept).toEqual([['d-1', 'v']])
    expect(h.emails).toHaveLength(0)
  })
})

describe('a day\'s emails', () => {
  it(`stop at ${EMAILS_A_DAY}; the rest wait for the next digest`, async () => {
    h.subs = [sub()]
    h.rows = Array.from({ length: EMAILS_A_DAY + 3 }, (_, i) => row({ id: `m-${i}` }))
    await scanAlerts(NOW)
    expect(h.emails).toHaveLength(EMAILS_A_DAY)
    expect(h.kept.map(([, id]) => id)).toEqual([`m-${EMAILS_A_DAY}`, `m-${EMAILS_A_DAY + 1}`, `m-${EMAILS_A_DAY + 2}`])
  })
})
