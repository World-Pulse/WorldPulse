/**
 * engine-loader.ts — the optional engine of the hosted WorldPulse.
 *
 * The hosted build adds an analysis engine that the open-source edition
 * doesn't include (scripts/server-deploy.sh adds its files before building).
 * It brings its own API pages and scheduled jobs; without it those don't
 * exist, and what can use it (the escalation index's 30-day baseline) works
 * without it.
 */

import { existsSync } from 'node:fs'
import * as path from 'node:path'
import type { FastifyInstance } from 'fastify'

export interface BaselineStats {
  avg_30d: number
  stddev_30d: number
  z_score_30d: number
}

export interface Engine {
  registerRoutes(app: FastifyInstance): Promise<void>
  startJobs(): void
  stopJobs(): void
  baselineStats(category: string, region: string, severity: string): Promise<BaselineStats | null>
}

let loading: Promise<Engine | null> | null = null

/** The engine, or null in the open-source edition (looked up once) */
export function loadEngine(): Promise<Engine | null> {
  if (!loading) {
    // nothing to load in the open-source edition (index.js once built, index.ts in tests)
    const dir = path.join(__dirname, 'engine')
    if (!['index.js', 'index.ts'].some(f => existsSync(path.join(dir, f)))) {
      loading = Promise.resolve(null)
      return loading
    }
    // a variable, so the open-source edition compiles without the files
    const where = './engine/index.js'
    loading = import(where)
      .then((m: { engine?: Engine; default?: Engine & { engine?: Engine } }) => m.engine ?? m.default?.engine ?? m.default ?? null)
      .catch((err: unknown) => {
        console.error('[engine] could not be loaded:', err)
        return null
      })
  }
  return loading
}

/** For tests: look the engine up again */
export function resetEngineLoader(): void {
  loading = null
}
