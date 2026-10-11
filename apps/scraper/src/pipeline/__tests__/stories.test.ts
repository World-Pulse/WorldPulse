/**
 * Story ids: same-story groups get one id (plan 12a).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  raws: [] as Array<{ sql: string; params?: unknown[] }>,
  failAlter: false,
  columnExists: false,
}))

vi.mock('../../lib/postgres', () => {
  const raw = vi.fn(async (sql: string, params?: unknown[]) => {
    h.raws.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
    if (h.failAlter && sql.startsWith('ALTER')) throw new Error('permission denied')
    if (sql.includes('information_schema')) return { rows: h.columnExists ? [{ '?column?': 1 }] : [] }
    return { rowCount: 2 }
  })
  return { db: { raw, transaction: vi.fn(async (fn: (trx: { raw: typeof raw }) => Promise<void>) => fn({ raw })) } }
})
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

describe('story ids', () => {
  beforeEach(() => {
    h.raws.length = 0
    h.failAlter = false
    h.columnExists = false
    vi.resetModules()
  })

  it('adds the column (giving up on a busy lock) and its index once, without blocking inserts', async () => {
    const { ensureStoryIdColumn } = await import('../stories')
    expect(await ensureStoryIdColumn()).toBe(true)
    expect(await ensureStoryIdColumn()).toBe(true)
    expect(h.raws.map(r => r.sql)).toEqual([
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'signals' AND column_name = 'story_id' LIMIT 1",
      "SET LOCAL lock_timeout = '5s'",
      'ALTER TABLE signals ADD COLUMN IF NOT EXISTS story_id uuid',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signals_story_created ON signals (story_id, created_at DESC)',
    ])
  })

  it('skips the ALTER when the column is already there', async () => {
    h.columnExists = true
    const { ensureStoryIdColumn } = await import('../stories')
    expect(await ensureStoryIdColumn()).toBe(true)
    expect(h.raws.some(r => r.sql.startsWith('ALTER'))).toBe(false)
  })

  it('joins nothing when the column can\'t be added, and tries again an hour later', async () => {
    vi.useFakeTimers()
    try {
      const { ensureStoryIdColumn, joinStory } = await import('../stories')
      h.failAlter = true
      expect(await joinStory(['a', 'b'])).toBe(0)
      expect(await joinStory(['a', 'b'])).toBe(0)
      expect(h.raws.filter(r => r.sql.startsWith('ALTER'))).toHaveLength(1) // not retried on every call
      expect(h.raws.some(r => r.sql.includes('UPDATE signals'))).toBe(false)
      h.failAlter = false
      vi.advanceTimersByTime(60 * 60_000)
      expect(await ensureStoryIdColumn()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives the group the id of its oldest signal, joining stories that meet', async () => {
    const { joinStory } = await import('../stories')
    expect(await joinStory(['sig-a', 'sig-b', 'sig-a'])).toBe(2)
    const update = h.raws.find(r => r.sql.includes('UPDATE signals SET story_id'))!
    expect(update.params).toEqual([['sig-a', 'sig-b'], ['sig-a', 'sig-b']])
    expect(update.sql).toMatch(/ORDER BY created_at ASC, id ASC LIMIT 1/)    // the oldest signal names the story
    expect(update.sql).toMatch(/s\.story_id IN \(SELECT story_id FROM signals/) // signals already in a member's story move too
    expect(update.sql).toMatch(/IS DISTINCT FROM/)                            // nothing rewritten needlessly
  })

  it('does nothing for a single signal', async () => {
    const { joinStory } = await import('../stories')
    expect(await joinStory(['sig-a'])).toBe(0)
    expect(await joinStory([])).toBe(0)
    expect(h.raws).toEqual([])
  })
})
