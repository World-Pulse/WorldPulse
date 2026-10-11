/**
 * The editor pass: Claude re-files the newest stories (pipeline/editor.ts,
 * Oct 11, 2026).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  raws: [] as Array<{ sql: string; params?: unknown[] }>,
  rows: [] as Array<Record<string, unknown>>,
  /** What the stories re-filed by the last pass carry now */
  current: [] as Array<{ id: string; title: string; category: string }>,
  redis: new Map<string, string>(),
  replies: [] as Array<{ text: string; costMicros: number } | null>,
  failUpdate: null as Error | null,
}))

vi.mock('../../lib/postgres', () => {
  const raw = vi.fn(async (sql: string, params?: unknown[]) => {
    h.raws.push({ sql, params })
    if (/= ANY\(\?::uuid\[\]\)/.test(sql)) return { rows: h.current }
    if (/^\s*SELECT/.test(sql)) {
      // the window the pass asked for (created_at > since AND created_at <= until), oldest first, at most 300
      const [since, until] = [String(params?.[0]), String(params?.[1])]
      return { rows: h.rows.filter(r => String(r.created_at) > since && String(r.created_at) <= until).slice(0, 300) }
    }
    if (/^\s*UPDATE/.test(sql)) {
      if (h.failUpdate) throw h.failUpdate
      return { rowCount: (sql.match(/\(\?::uuid/g) ?? []).length }
    }
    return {}
  })
  return { db: { raw, transaction: vi.fn(async (fn: (trx: unknown) => unknown) => fn({ raw })) } }
})
vi.mock('../../lib/redis', () => ({
  redis: {
    get: vi.fn(async (k: string) => h.redis.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, ...rest: unknown[]) => {
      if (rest.includes('NX') && h.redis.has(k)) return null
      h.redis.set(k, v)
      return 'OK'
    }),
    del: vi.fn(async (k: string) => { h.redis.delete(k); return 1 }),
  },
}))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../../lib/claude', () => ({
  claudeConfigured: () => true,
  askClaude: vi.fn(async () => {
    const next = h.replies.shift()
    return next === undefined ? null : next && { ...next, inputTokens: 0, outputTokens: 0 }
  }),
}))

import { editorPrompt, parseEditorReply, severityUnder, runEditorPass, catchUpEditor, EDITOR_SYSTEM } from '../editor'
import { askClaude } from '../../lib/claude'

const NOW = new Date('2026-10-11T14:30:00Z')
const at = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString()

describe('editorPrompt and parseEditorReply', () => {
  it('numbers the headlines, with the summary only when it says more', () => {
    expect(editorPrompt([
      { title: 'Pope Leo XIV to undergo surgery', summary: 'Pope Leo XIV to undergo surgery.' },
      { title: 'Au large de Djibouti, 109 migrants meurent', summary: 'Le naufrage a eu lieu samedi.' },
    ])).toBe('1. Pope Leo XIV to undergo surgery\n2. Au large de Djibouti, 109 migrants meurent | Le naufrage a eu lieu samedi.')
  })

  it('reads one category per number and ignores anything else', () => {
    const filed = parseEditorReply('1 health\n2. disaster\n3: Conflict\n4 politics\n9 sports\nSure! Here you go', 4)
    expect([...filed]).toEqual([[1, 'health'], [2, 'disaster'], [3, 'conflict']])
  })

  it('reads the forms a reply drifts to', () => {
    // markdown, a table, "Story n:", the headline repeated before the category
    expect([...parseEditorReply('1. **culture**\n| 2 | sports |\nStory 3: security\n4. New York bids farewell to Calypso King Mighty Sparrow → culture\n5. Election 2026: candidates outline priorities - elections', 5)])
      .toEqual([[1, 'culture'], [2, 'sports'], [3, 'security'], [4, 'culture'], [5, 'elections']])
    // JSON, brackets, several on one line
    expect([...parseEditorReply('{"1": "culture", "2": "Sports"}', 2)]).toEqual([[1, 'culture'], [2, 'sports']])
    expect([...parseEditorReply('(1) culture\n[2] sports', 2)]).toEqual([[1, 'culture'], [2, 'sports']])
    expect([...parseEditorReply('1 culture, 2 sports, 3 conflict', 3)]).toEqual([[1, 'culture'], [2, 'sports'], [3, 'conflict']])
    // bare categories in order, a line each or in a list
    expect([...parseEditorReply('culture\nsports', 2)]).toEqual([[1, 'culture'], [2, 'sports']])
    expect([...parseEditorReply('culture, sports', 2)]).toEqual([[1, 'culture'], [2, 'sports']])
    // a number inside a repeated headline isn't a story number
    expect([...parseEditorReply('1. 109 migrants die off Djibouti → disaster', 1)]).toEqual([[1, 'disaster']])
    // never an Object property name
    expect(parseEditorReply('1 constructor\n2 toString', 2).size).toBe(0)
  })

  it('lists every category for the editor, and never "breaking"', () => {
    expect(EDITOR_SYSTEM).toContain('disaster: earthquakes')
    expect(EDITOR_SYSTEM).not.toMatch(/^breaking:/m)
  })
})

describe('severityUnder', () => {
  it('caps "other" at low and culture at medium', () => {
    expect(severityUnder({ title: "Judi Dench 'loathes' being called a national treasure", summary: null, severity: 'medium', source_count: 1 }, 'other')).toBe('low')
    expect(severityUnder({ title: 'Horror film tops the box office', summary: null, severity: 'high', source_count: 1 }, 'culture')).toBe('medium')
  })

  it("rises to what the words earn, within the outlet count's cap", () => {
    // 109 dead: critical earned, one outlet lets a disaster be high
    expect(severityUnder({ title: 'Au large de Djibouti, 109 dead as migrant boat sinks', summary: null, severity: 'low', source_count: 1 }, 'disaster')).toBe('high')
    // never lowered outside the caps
    expect(severityUnder({ title: 'Talks resume', summary: null, severity: 'high', source_count: 1 }, 'geopolitics')).toBe('high')
  })
})

describe('runEditorPass', () => {
  beforeEach(() => {
    h.raws.length = 0
    h.redis.clear()
    h.replies.length = 0
    h.current = []
    h.failUpdate = null
    vi.mocked(askClaude).mockClear()
  })

  it('files the stories by the editor, and marks where the next pass starts', async () => {
    h.rows = [
      { id: 'a', title: 'Pope Leo XIV to undergo surgery to remove lump on lung', summary: null, category: 'other', severity: 'low', source_count: 3, created_at: at(30) },
      { id: 'b', title: 'Au large de Djibouti, au moins 109 migrants meurent dans un naufrage', summary: null, category: 'geopolitics', severity: 'medium', source_count: 1, created_at: at(20) },
      { id: 'c', title: 'Markets rally', summary: null, category: 'finance', severity: 'low', source_count: 1, created_at: at(10) },
    ]
    h.replies.push({ text: '1 health\n2 disaster\n3 economy', costMicros: 400 })
    const stats = await runEditorPass(NOW)
    expect(stats).toMatchObject({ read: 3, changed: 2, written: 2, batches: 1, costMicros: 400, stopped: false })
    expect(stats.examples).toEqual([
      { title: 'Pope Leo XIV to undergo surgery to remove lump on lung', from: 'other', to: 'health' },
      { title: 'Au large de Djibouti, au moins 109 migrants meurent dans un naufrage', from: 'geopolitics', to: 'disaster' },
    ])

    const select = h.raws.find(r => /^\s*SELECT/.test(r.sql))!
    const update = h.raws.find(r => /^\s*UPDATE/.test(r.sql))!
    expect(select.sql).toMatch(/tags @> ARRAY\['gdelt'\]/)       // GDELT with a headline, not sensor feeds
    expect(select.params![0]).toBe(at(60))                        // no mark: the last hour
    expect(update.sql).toMatch(/SET category = v\.category::category, severity = v\.severity::signal_severity/)
    // (the severity rules read English: the French "109 migrants meurent" stays at a disaster's medium)
    expect(update.params).toEqual(['a', 'health', 'low', 'b', 'disaster', 'medium'])  // finance ≈ economy: unchanged
    expect(h.raws.some(r => /lock_timeout/.test(r.sql))).toBe(true)
    expect(Number(h.redis.get('ai:editor:since'))).toBe(NOW.getTime() - 60_000)
    expect(JSON.parse(h.redis.get('ai:editor:filed')!)).toEqual([['a', 'health'], ['b', 'disaster']])
    expect(JSON.parse(h.redis.get('ai:editor:last')!)).toMatchObject({ at: NOW.toISOString(), since: at(60), changed: 2, written: 2 })
    expect(h.redis.has('ai:editor:lock')).toBe(false)
  })

  it("counts the last pass's changes that still hold, and those changed back since", async () => {
    h.redis.set('ai:editor:filed', JSON.stringify([['a', 'health'], ['b', 'disaster'], ['c', 'culture']]))
    h.current = [
      { id: 'a', title: 'Pope Leo XIV to undergo surgery', category: 'health' },
      { id: 'b', title: 'Photos of the Week', category: 'breaking' },
      { id: 'c', title: 'A proper paella', category: 'culture' },
    ]
    h.rows = []
    const stats = await runEditorPass(NOW)
    expect(stats).toMatchObject({ held: 2, undone: 1, read: 0 })
    expect(stats.undoneExamples).toEqual([{ title: 'Photos of the Week', filed: 'disaster', now: 'breaking' }])
  })

  it('counts the stories a reply gave no category for, with the start of that reply', async () => {
    h.rows = [
      { id: 'a', title: 'Crime Reports', summary: null, category: 'other', severity: 'low', source_count: 1, created_at: at(30) },
      { id: 'b', title: 'Is This Really My Cow?', summary: null, category: 'other', severity: 'low', source_count: 1, created_at: at(20) },
    ]
    h.replies.push({ text: 'Here are the categories:\n1 security\n2 farming', costMicros: 90 })
    const stats = await runEditorPass(NOW)
    expect(stats).toMatchObject({ read: 2, changed: 1, unparsed: 1, replySample: 'Here are the categories:\n1 security\n2 farming' })
  })

  it('stops at a failed update, says why, and retries those stories next time', async () => {
    h.rows = [{ id: 'a', title: 'Strike hits port', summary: null, category: 'other', severity: 'low', source_count: 1, created_at: at(30) }]
    h.replies.push({ text: '1 conflict', costMicros: 100 })
    h.failUpdate = new Error('canceling statement due to lock timeout')
    const stats = await runEditorPass(NOW)
    expect(stats).toMatchObject({ stopped: true, changed: 0, written: 0, error: 'update failed: canceling statement due to lock timeout' })
    expect(Number(h.redis.get('ai:editor:since'))).toBe(new Date(at(30)).getTime() - 1)
    expect(h.redis.has('ai:editor:filed')).toBe(false)
  })

  it('stops when Claude gives nothing (the cap, an error) and retries those stories next time', async () => {
    h.rows = Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, title: `Story ${i}`, summary: null, category: 'other', severity: 'low', source_count: 1, created_at: at(59 - i * 0.5) }))
    h.replies.push({ text: Array.from({ length: 25 }, (_, i) => `${i + 1} other`).join('\n'), costMicros: 300 })
    // the second batch (of 25) gets null
    const stats = await runEditorPass(NOW)
    expect(stats.batches).toBe(1)
    expect(stats.stopped).toBe(true)
    // the mark sits just before the first story of the failed batch
    expect(Number(h.redis.get('ai:editor:since'))).toBe(new Date(h.rows[25]!.created_at as string).getTime() - 1)
  })

  it("doesn't run twice at once", async () => {
    h.redis.set('ai:editor:lock', '1')
    expect((await runEditorPass(NOW)).read).toBe(0)
    expect(h.raws).toHaveLength(0)
  })
})

describe('catchUpEditor', () => {
  beforeEach(() => {
    h.raws.length = 0
    h.redis.clear()
    h.replies.length = 0
    h.current = []
    h.failUpdate = null
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => { vi.useRealTimers() })

  it('reads the last hours again, 300 stories a pass, until it has caught up', async () => {
    // 400 stories over the last 10 hours, all "other"
    h.rows = Array.from({ length: 400 }, (_, i) => ({ id: `s${i}`, title: `Story ${i}`, summary: null, category: 'other', severity: 'low', source_count: 1, created_at: at(600 - i * 1.5) }))
    for (let b = 0; b < 16; b++) h.replies.push({ text: Array.from({ length: 25 }, (_, i) => `${i + 1} other`).join('\n'), costMicros: 150 })
    h.redis.set('ai:editor:lock', '1')   // left by a stopped process
    const total = await catchUpEditor(12)
    expect(total).toEqual({ passes: 2, read: 400, changed: 0, stopped: false })
    expect(vi.mocked(askClaude)).toHaveBeenCalledTimes(16)   // 25 stories a call
    expect(Number(h.redis.get('ai:editor:since'))).toBe(NOW.getTime() - 60_000)
    // each pass in brief, newest first
    const history = JSON.parse(h.redis.get('ai:editor:last')!).history as Array<{ read: number; since: string }>
    expect(history.map(p => p.read)).toEqual([100, 300])
    expect(history[1]!.since).toBe(new Date(NOW.getTime() - 12 * 3_600_000).toISOString())
  })
})
