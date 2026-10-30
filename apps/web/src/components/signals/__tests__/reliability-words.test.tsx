/**
 * The reliability score's words say only what the scraper does (checked Oct
 * 20, 2026, H-0025: apps/scraper/src/pipeline/reliability-score.ts and
 * correlate.ts). The tooltip called any score of 80% or more "Fully
 * Verified: multi-source confirmed, AI-verified, cross-checked", so one
 * report from a highly rated outlet read as fully verified, and it named AI
 * checks and reader flags as factors, which don't move the score.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ReliabilityDots, SCORE_TIERS, SCORE_FACTORS, SCORE_NOTE, scoreBand } from '../ReliabilityDots'

const SCRAPER = join(__dirname, '..', '..', '..', '..', '..', 'scraper', 'src', 'pipeline')
const read = (f: string) => readFileSync(join(SCRAPER, f), 'utf8')

describe('the score bands and factors', () => {
  it("never call a score verified, and don't name what the score doesn't use", () => {
    const words = JSON.stringify([SCORE_TIERS, SCORE_FACTORS])
    expect(words).not.toMatch(/\bverified\b|\bAI\b|\bflags?\b|cross-check/i)
    expect(SCORE_NOTE).toBe('Not in the score: AI checks and reader flags. Verified is separate: two or more independent outlets and a score of at least 65%.')
  })

  it("match the scraper's formula: 40% of the gap to 98% per outlet, and verified at 65% with two outlets", () => {
    const correlate = read('correlate.ts')
    expect(correlate).toContain('export const RELIABILITY_CEILING = 0.98')
    expect(correlate).toContain('const OUTLET_GAP_KEPT = 0.6')
    expect(correlate).toMatch(/\.where\('source_count', '>=', 2\)\s*\n\s*\.where\('reliability_score', '>=', 0\.65\)/)
    expect(SCORE_FACTORS.find(f => f.label === 'Independent outlets')?.desc).toContain('closes 40% of the gap to 98%')
    // the start: the outlet's rating and a few points either way, with no random spread (Devon, Oct 20, 2026)
    const start = read('reliability-score.ts')
    expect(start).toContain('let score = inputs.baseReliability')
    expect(start).not.toContain('Math.random')
    expect(JSON.stringify(SCORE_FACTORS)).not.toMatch(/random/i)
    // the AI checks and flags don't write the score
    for (const f of ['crosscheck.ts', 'verify.ts']) expect(read(f)).not.toMatch(/reliability_score\s*[:=]/)
  })

  it('puts a score in its band', () => {
    expect(scoreBand(0.98).label).toBe('Very high')
    expect(scoreBand(0.79).label).toBe('High')
    expect(scoreBand(0.5).label).toBe('Moderate')
    expect(scoreBand(0.2).label).toBe('Low')
    expect(scoreBand(0.1).label).toBe('Very low')
    expect(scoreBand(Number.NaN).label).toBe('Very low')
  })
})

describe('the tooltip', () => {
  it('names outlets as outlets and the status in words', () => {
    const html = renderToStaticMarkup(<ReliabilityDots score={0.87} sourceCount={2} crossCheckStatus="confirmed" aiVerified={false} communityFlagCount={0} />)
    expect(html).toContain('Independent outlets')
    expect(html).not.toContain('Sources verified')
    expect(html).toContain('none yet') // the AI check row
    expect(html).toContain('>verified<')
    expect(html).toContain('What moves the score')
    expect(html).toContain(SCORE_NOTE)
  })
})

describe('How We Count', () => {
  it('explains the score where the story page links (#score)', async () => {
    // The page has been async since N2 (it reads today's totals from the status file), so it is awaited
    // first; with no network here it shows no totals
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => { throw new Error('offline in tests') }) as unknown as typeof fetch
    try {
      const { default: HowWeCountPage } = await import('@/app/how-we-count/page')
      const html = renderToStaticMarkup(await HowWeCountPage())
      expect(html).toContain('id="score"')
      expect(html).toContain('The reliability score')
      expect(html).toContain('closes 40% of the gap to 98%')
      expect(html).toContain('AI checks and reader flags don’t change the score')
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
