/**
 * The optional engine (lib/engine-loader.ts): the open-source edition has no
 * engine files, so the loader answers null, once, without an error.
 */
import { describe, it, expect, vi } from 'vitest'
import { existsSync } from 'node:fs'
import * as path from 'node:path'

// The hosted build's engine opens the databases when it loads; tests have none
vi.mock('../../db/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }) }))
vi.mock('../../db/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(), set: vi.fn(), del: vi.fn() } }))

import { loadEngine, resetEngineLoader } from '../engine-loader'

const present = existsSync(path.join(__dirname, '..', 'engine', 'index.ts'))

describe.skipIf(present)('without the engine (the open-source edition)', () => {
  it('answers null and logs nothing', async () => {
    resetEngineLoader()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await loadEngine()).toBeNull()
    expect(await loadEngine()).toBeNull()
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })
})

describe.skipIf(!present)('with the engine (the hosted build)', () => {
  it('loads its routes, jobs and baselines', async () => {
    resetEngineLoader()
    const engine = await loadEngine()
    expect(engine).not.toBeNull()
    for (const k of ['registerRoutes', 'startJobs', 'stopJobs', 'baselineStats'] as const) {
      expect(typeof engine?.[k]).toBe('function')
    }
  })
})
