/**
 * The main search's reports (plan V3g, Oct 21, 2026): Meilisearch first, then
 * Postgres too, the first answer winning. Live that day, broad searches
 * ("ukraine", "sudan") came back from Postgres every time ("partial", no
 * category or severity counts) because Meilisearch had only 150 ms.
 * Times here are short stand-ins: alone 20 ms, 200 ms in all.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../db/postgres', () => ({ db: vi.fn() }))
vi.mock('../db/redis', () => ({ redis: {} }))
vi.mock('../lib/search', () => ({ meili: {}, setupSearchIndexes: vi.fn(), indexSignal: vi.fn(), indexPost: vi.fn() }))

import { firstAnswer, MEILI_ALONE_MS, MEILI_MAX_MS } from '../routes/search'

const after = <T>(ms: number, value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms))
const never = () => new Promise<never>(() => {})

describe('the first answer wins', () => {
  it('a quick Meilisearch answers alone; Postgres is never asked', async () => {
    const pg = vi.fn(() => after(10, 'pg'))
    expect(await firstAnswer(after(5, 'meili'), pg, 20, 200)).toEqual({ from: 'meili', value: 'meili' })
    expect(pg).not.toHaveBeenCalled()
  })

  it('a slow Meilisearch still wins when it answers before Postgres (with its counts)', async () => {
    const pg = vi.fn(() => after(150, 'pg'))
    expect(await firstAnswer(after(60, 'meili'), pg, 20, 200)).toEqual({ from: 'meili', value: 'meili' })
    expect(pg).toHaveBeenCalledOnce()
  })

  it('Postgres wins when it answers first', async () => {
    expect(await firstAnswer(after(120, 'meili'), () => after(30, 'pg'), 20, 200)).toEqual({ from: 'postgres', value: 'pg' })
  })

  it('past the limit, Meilisearch is dropped and Postgres answers, however long it takes', async () => {
    const started = Date.now()
    expect(await firstAnswer(never(), () => after(300, 'pg'), 20, 200)).toEqual({ from: 'postgres', value: 'pg' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(300)
  })

  it('when Meilisearch fails, Postgres answers at once', async () => {
    const started = Date.now()
    expect(await firstAnswer(Promise.reject(new Error('down')), () => after(5, 'pg'), 20, 200)).toEqual({ from: 'postgres', value: 'pg' })
    expect(Date.now() - started).toBeLessThan(20)
  })

  it('Meilisearch has 150 ms alone and 1.5 s in all', () => {
    expect([MEILI_ALONE_MS, MEILI_MAX_MS]).toEqual([150, 1500])
  })
})
