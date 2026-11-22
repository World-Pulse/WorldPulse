/**
 * The State Department's codes → two-letter countries (lib/us-travel-codes.ts), which turn the levels the scraper keeps
 * (osint:travel-us:irn) into the travel advice endpoint's countries (IR). The table is a copy of the scraper's own;
 * this checks the copy against the scraper's file, as other tests here read the scraper's code (scraper-stability).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { US_TRAVEL_CODES, usTravelCountry } from '../us-travel-codes'

// apps/api/src/lib/__tests__ → apps/scraper/src/sources
const SCRAPER = join(__dirname, '..', '..', '..', '..', 'scraper', 'src', 'sources', 'travel-advisories.ts')

/** The scraper's ISO2 table, read from its source */
function scraperTable(): Record<string, string> {
  const src = readFileSync(SCRAPER, 'utf8')
  const body = /const ISO2: Record<string, string> = \{([\s\S]*?)\n\}/.exec(src)?.[1]
  if (!body) throw new Error('the scraper has no ISO2 table where this test looks')
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/'?([a-z][a-z-]*)'?\s*:\s*'([A-Z]{2})'/g)) out[m[1]!] = m[2]!
  return out
}

describe('the State Department codes', () => {
  it("are the scraper's, every one", () => {
    const theirs = scraperTable()
    expect(Object.keys(theirs).length).toBeGreaterThan(200)
    expect(US_TRAVEL_CODES).toEqual(theirs)
  })

  it('give the two-letter country, and nothing for a code the table lacks', () => {
    expect(usTravelCountry('irn')).toBe('IR')
    expect(usTravelCountry('IRN')).toBe('IR')
    expect(usTravelCountry('xks')).toBe('XK')
    expect(usTravelCountry('xgz')).toBe('PS')
    expect(usTravelCountry('french-west-indies')).toBe('GP')
    expect(usTravelCountry('ir')).toBeNull()
    expect(usTravelCountry('')).toBeNull()
    // two letters each, so the endpoint's countries are all codes it accepts
    expect(Object.values(US_TRAVEL_CODES).every(c => /^[A-Z]{2}$/.test(c))).toBe(true)
  })
})
