/**
 * The optional engine (src/engine-loader.ts): the open-source edition has no
 * engine files, so the loader answers null without an error.
 */
import { describe, it, expect, vi } from 'vitest'
import { existsSync } from 'node:fs'
import * as path from 'node:path'

vi.mock('../lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))
// The hosted build's engine opens the databases when it loads; tests have none
vi.mock('../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }) }))
vi.mock('../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(), set: vi.fn(), del: vi.fn() } }))

import { loadEngine, resetEngineLoader } from '../engine-loader'
import { logger } from '../lib/logger'

const present = existsSync(path.join(__dirname, '..', 'engine', 'index.ts'))

describe.skipIf(present)('without the engine (the open-source edition)', () => {
  it('answers null and logs nothing', async () => {
    resetEngineLoader()
    expect(await loadEngine()).toBeNull()
    expect(logger.error).not.toHaveBeenCalled()
  })
})

describe.skipIf(!present)('with the engine (the hosted build)', () => {
  it('has its jobs', async () => {
    resetEngineLoader()
    const engine = await loadEngine()
    expect(typeof engine?.startJobs).toBe('function')
  })
})
