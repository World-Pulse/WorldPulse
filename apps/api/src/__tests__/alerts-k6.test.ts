/**
 * Free alerts for everyone (plan K6; Devon, Oct 21, 2026: "Free for
 * everyone"): keywords as whole words, and a daily digest instead of one
 * email per report.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  sets: new Map<string, Set<string>>(),
  keys: new Map<string, string>(),
  subs: [] as Array<{ sub_id: string; name: string; email: string }>,
  signals: [] as Array<Record<string, unknown>>,
  sent: [] as Array<{ to: string; name: string; ids: string[]; total: number }>,
  configured: true,
  accepted: true,
}))

vi.mock('../db/redis', () => ({
  redis: {
    sadd: async (k: string, v: string) => { const s = h.sets.get(k) ?? new Set(); s.add(v); h.sets.set(k, s); return 1 },
    expire: async () => 1,
    smembers: async (k: string) => [...(h.sets.get(k) ?? [])],
    del: async (k: string) => { h.sets.delete(k); return 1 },
    set: async (k: string, v: string, ..._rest: unknown[]) => { if (h.keys.has(k)) return null; h.keys.set(k, v); return 'OK' },
  },
}))
vi.mock('../db/postgres', () => {
  const subsQuery: Record<string, unknown> = {}
  for (const m of ['join', 'where', 'whereRaw', 'whereNotNull']) subsQuery[m] = () => subsQuery
  subsQuery.select = async () => h.subs
  const sigQuery: Record<string, unknown> = {}
  let ids: string[] = []
  sigQuery.whereIn = (col: string, list: string[]) => { if (col === 'id') ids = list; return sigQuery }
  sigQuery.select = async () => h.signals.filter(s => ids.includes(String(s.id)))
  return { db: (table: string) => (table === 'signals' ? sigQuery : subsQuery) }
})
vi.mock('../lib/email', async (orig) => {
  const real = await orig<typeof import('../lib/email')>()
  return {
    ...real,
    get EMAIL_CONFIGURED() { return h.configured },
    sendAlertDigestEmail: async (to: string, name: string, items: Array<{ id: string }>, total: number) => {
      h.sent.push({ to, name, ids: items.map(i => i.id), total }); return h.accepted
    },
  }
})

import { keywordPattern, keywordsMatch, isDailyDigest } from '../lib/alert-match'
import { keepForDigest, sendAlertDigests, DIGEST_ITEMS } from '../lib/alert-digest'
import { buildDigest } from '../lib/email'

beforeEach(() => { h.sets.clear(); h.keys.clear(); h.subs = []; h.signals = []; h.sent = []; h.configured = true; h.accepted = true })

describe('keywords as whole words', () => {
  it('"UN" no longer matches "under", "Mali" no longer matches "Somalia"', () => {
    expect(keywordsMatch('Talks under way in Geneva', ['UN'])).toBe(false)
    expect(keywordsMatch('UN envoy arrives in Geneva', ['UN'])).toBe(true)
    expect(keywordsMatch('Drought in Somalia worsens', ['Mali'])).toBe(false)
    expect(keywordsMatch('Coup attempt in Mali', ['mali'])).toBe(true)
  })
  it('phrases, punctuation and other alphabets', () => {
    expect(keywordsMatch('Strike near the Gaza  Strip border', ['Gaza Strip'])).toBe(true)
    expect(keywordsMatch("NATO's summit opens", ['NATO'])).toBe(true)
    expect(keywordsMatch('Zelensky meets Erdoğan in Ankara', ['Erdoğan'])).toBe(true)
    expect(keywordsMatch('Price (U.S.) index', ['U.S.'])).toBe(true)
    expect(keywordPattern('   ')).toBeNull()
  })
  it('the daily digest setting', () => {
    expect(isDailyDigest({ email: true, digest: 'daily' })).toBe(true)
    expect(isDailyDigest('{"digest":"daily"}')).toBe(true)
    expect(isDailyDigest({ email: true })).toBe(false)
    expect(isDailyDigest(null)).toBe(false)
  })
})

describe('the daily digest', () => {
  const at7 = new Date('2026-10-22T11:05:00Z')   // 7:05 AM in New York (EDT)
  const sig = (id: string, severity: string, minutes: number) => ({ id, title: `Report ${id}`, severity, location_name: null, status: 'verified', created_at: new Date(at7.getTime() - minutes * 60_000).toISOString() })

  it('one email an alert after 7 AM, the most serious first, then the matches are cleared', async () => {
    h.subs = [{ sub_id: 'a1', name: 'Follow: NATO', email: 'reader@example.com' }]
    for (const id of ['s1', 's2', 's3']) await keepForDigest('a1', id)
    h.signals = [sig('s1', 'low', 30), sig('s2', 'critical', 60), sig('s3', 'high', 10)]
    const run = await sendAlertDigests(at7)
    expect(run).toMatchObject({ due: true, alerts: 1, sent: 1 })
    expect(h.sent).toEqual([{ to: 'reader@example.com', name: 'Follow: NATO', ids: ['s2', 's3', 's1'], total: 3 }])
    expect(h.sets.has('alerts:digest:a1')).toBe(false)
    // once a day
    expect((await sendAlertDigests(new Date('2026-10-22T13:00:00Z'))).due).toBe(false)
  })

  it('not before 7, not without the email key, and the matches wait when an email fails', async () => {
    h.subs = [{ sub_id: 'a1', name: 'Follow: NATO', email: 'reader@example.com' }]
    await keepForDigest('a1', 's1')
    h.signals = [sig('s1', 'high', 5)]
    expect((await sendAlertDigests(new Date('2026-10-22T10:30:00Z'))).due).toBe(false)   // 6:30 AM
    h.configured = false
    expect((await sendAlertDigests(at7)).due).toBe(false)
    h.configured = true
    h.accepted = false
    expect((await sendAlertDigests(at7)).sent).toBe(0)
    expect(h.sets.get('alerts:digest:a1')?.has('s1')).toBe(true)
  })

  it(`at most ${DIGEST_ITEMS} reports, and how many more`, async () => {
    h.subs = [{ sub_id: 'a2', name: 'Follow: Kenya', email: 'r@example.com' }]
    h.signals = Array.from({ length: 20 }, (_, i) => sig(`k${i}`, 'medium', i))
    for (const s of h.signals) await keepForDigest('a2', String(s.id))
    await sendAlertDigests(at7)
    expect(h.sent[0]).toMatchObject({ total: 20 })
    expect(h.sent[0]!.ids).toHaveLength(DIGEST_ITEMS)
  })

  it('the email: what it is, safely, and how to stop it', () => {
    const d = buildDigest('Follow: <NATO>', [{ id: 'x1', title: 'Summit <script> opens', severity: 'high', locationName: 'Brussels', status: 'verified' }], 4)
    expect(d.subject).toBe('Follow: <NATO>: 4 new reports on WorldPulse')
    expect(d.html).toContain('Summit &lt;script&gt; opens')
    expect(d.html).not.toContain('<script>')
    expect(d.html).toContain('And 3 more on WorldPulse.')
    expect(d.text).toContain('Change or stop this email: https://world-pulse.io/alerts')
  })
})
