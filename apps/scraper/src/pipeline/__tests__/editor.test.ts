/**
 * The editor pass: Claude re-files the newest stories (pipeline/editor.ts,
 * Oct 11, 2026).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  raws: [] as Array<{ sql: string; params?: unknown[] }>,
  rows: [] as Array<Record<string, unknown>>,
  redis: new Map<string, string>(),
  replies: [] as Array<{ text: string; costMicros: number } | null>,
}))

vi.mock('../../lib/postgres', () => ({
  db: {
    raw: vi.fn(async (sql: string, params?: unknown[]) => {
      h.raws.push({ sql, params })
      return /^\s*SELECT/.test(sql) ? { rows: h.rows } : { rowCount: 0 }
    }),
  },
}))
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

import { editorPrompt, parseEditorReply, severityUnder, runEditorPass, EDITOR_SYSTEM } from '../editor'
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
    expect(stats).toEqual({ read: 3, changed: 2, batches: 1, costMicros: 400, stopped: false })

    const [select, update] = h.raws
    expect(select!.sql).toMatch(/tags @> ARRAY\['gdelt'\]/)       // GDELT with a headline, not sensor feeds
    expect(select!.params![0]).toBe(at(60))                        // no mark: the last hour
    expect(update!.sql).toMatch(/SET category = v\.category::category, severity = v\.severity::signal_severity/)
    // (the severity rules read English: the French "109 migrants meurent" stays at a disaster's medium)
    expect(update!.params).toEqual(['a', 'health', 'low', 'b', 'disaster', 'medium'])  // finance ≈ economy: unchanged
    expect(Number(h.redis.get('ai:editor:since'))).toBe(NOW.getTime() - 60_000)
    expect(h.redis.has('ai:editor:lock')).toBe(false)
  })

  it('stops when Claude gives nothing (the cap, an error) and retries those stories next time', async () => {
    h.rows = Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, title: `Story ${i}`, summary: null, category: 'other', severity: 'low', source_count: 1, created_at: at(59 - i * 0.5) }))
    h.replies.push({ text: Array.from({ length: 50 }, (_, i) => `${i + 1} other`).join('\n'), costMicros: 300 })
    // the second batch gets null
    const stats = await runEditorPass(NOW)
    expect(stats.batches).toBe(1)
    expect(stats.stopped).toBe(true)
    // the mark sits just before the first story of the failed batch
    expect(Number(h.redis.get('ai:editor:since'))).toBe(new Date(h.rows[50]!.created_at as string).getTime() - 1)
  })

  it("doesn't run twice at once", async () => {
    h.redis.set('ai:editor:lock', '1')
    expect((await runEditorPass(NOW)).read).toBe(0)
    expect(h.raws).toHaveLength(0)
  })
})
