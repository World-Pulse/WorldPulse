/**
 * The countries and territories the day's count counts (Nov 12, 2026): the coverage map's 202.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COUNTED_CODES } from '../counted-places'

describe('COUNTED_CODES', () => {
  it('are 202 two-letter codes, each once', () => {
    expect(COUNTED_CODES).toHaveLength(202)
    expect(new Set(COUNTED_CODES).size).toBe(202)
    expect(COUNTED_CODES.every(c => /^[A-Z]{2}$/.test(c))).toBe(true)
  })

  it('are the coverage map\'s counted places, code for code', () => {
    const src = readFileSync(join(__dirname, '../../../../scraper/src/sources/coverage.ts'), 'utf8')
    const start = src.indexOf('export const COUNTED_PLACES')
    expect(start).toBeGreaterThan(-1)
    const block = src.slice(start, src.indexOf('\n}\n', start))
    const theirs = [...block.matchAll(/\b([A-Z]{2}): ['"]/g)].map(m => m[1])
    expect(theirs).toHaveLength(202)
    expect([...COUNTED_CODES].sort()).toEqual([...theirs].sort())
  })

  it('leave out the territories that are shown, not counted', () => {
    for (const code of ['GU', 'BM', 'KY', 'CK', 'PF', 'EH', 'FK']) expect(COUNTED_CODES).not.toContain(code)
    for (const code of ['XK', 'TW', 'HK', 'MO', 'PR', 'GL', 'NC', 'PS', 'VA']) expect(COUNTED_CODES).toContain(code)
  })
})
