/**
 * The index on entity reports (lib/entity-index.ts, Devon's OK Oct 20, 2026):
 * built once, concurrently, on one connection without the 5-second limit,
 * which goes back on before the connection returns to the pool.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ sql: [] as string[], rows: [] as Array<Record<string, unknown>>, fail: null as RegExp | null, released: 0 }))

vi.mock('../../db/postgres', () => {
  const conn = {
    query: vi.fn(async (sql: string) => {
      h.sql.push(sql.replace(/\s+/g, ' ').trim())
      if (h.fail && h.fail.test(sql)) throw new Error('canceling statement')
      return { rows: /pg_index/.test(sql) ? h.rows : [] }
    }),
  }
  return { db: { client: { acquireConnection: vi.fn(async () => conn), releaseConnection: vi.fn(async () => { h.released++ }) } } }
})
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }))

import { ensureEntitySignalsIndex, ENTITY_SIGNALS_INDEX } from '../entity-index'

describe('ensureEntitySignalsIndex', () => {
  beforeEach(() => { h.sql.length = 0; h.rows = []; h.fail = null; h.released = 0 })

  it('builds the index concurrently, without the time limit, and puts the limit back', async () => {
    expect(await ensureEntitySignalsIndex()).toBe('built')
    expect(h.sql[1]).toBe('SET statement_timeout = 0')
    expect(h.sql[2]).toBe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${ENTITY_SIGNALS_INDEX} ON entity_nodes USING gin (signal_ids)`)
    expect(h.sql.at(-1)).toBe('SET statement_timeout = 5000')
    expect(h.released).toBe(1)
  })

  it('does nothing when the index is there and valid (every later start)', async () => {
    h.rows = [{ valid: true }]
    expect(await ensureEntitySignalsIndex()).toBe('ready')
    expect(h.sql.some((s) => /CREATE INDEX|DROP INDEX/.test(s))).toBe(false)
    expect(h.released).toBe(1)
  })

  it('drops an unfinished (invalid) index left by a cut-off build and builds it again', async () => {
    h.rows = [{ valid: false }]
    expect(await ensureEntitySignalsIndex()).toBe('built')
    expect(h.sql).toContain(`DROP INDEX CONCURRENTLY IF EXISTS ${ENTITY_SIGNALS_INDEX}`)
    expect(h.sql.findIndex((s) => s.startsWith('DROP'))).toBeLessThan(h.sql.findIndex((s) => s.startsWith('CREATE')))
  })

  it('reports a failure without throwing, and still restores the limit and releases the connection', async () => {
    h.fail = /CREATE INDEX/
    expect(await ensureEntitySignalsIndex()).toBe('failed')
    expect(h.sql.at(-1)).toBe('SET statement_timeout = 5000')
    expect(h.released).toBe(1)
  })
})
