/**
 * The home page's "what changed" and "to watch" lines (plan N6, Oct 30, 2026),
 * from the Daily Briefing's own text (the live answer of Oct 30, 5:24 AM UTC).
 */
import { describe, it, expect, vi } from 'vitest'
import { firstSentence, clip, briefOf, fetchHomeBrief } from '../home-brief'

const LIVE = {
  executive_summary: 'The most serious verified development is a Hong Kong apology for a residential fire that killed 168 people last year, reported by 5 outlets; the leader apologized and a top housing official will resign after an investigation blamed corruption and regulatory failures. A deadly high-speed train collision in Spain, with at least 68 killed and three days of mourning declared, was carried by 28 outlets, and a Russian drone strike on a railway station in Dnipro killed at least 13 civilians, verified by 5 outlets.',
  sections: [
    { id: 'threat_assessment', title: 'Threat Assessment', body: 'A Russian drone strike on the main railway station in Dnipro.' },
    { id: 'what_to_watch', title: 'What to Watch', body: "Coverage of the Spain train crash grew to 28 outlets, with mourning declared for three days. Reporting on Bolsonaro's claim to leadership from the US also grew, to 14 outlets. Our reports do not describe any scheduled future events." },
  ],
}

describe('firstSentence', () => {
  it('ends at the first full stop before a capital', () => {
    expect(firstSentence('Ukraine says 13 were killed. Russia denies it.')).toBe('Ukraine says 13 were killed.')
    expect(firstSentence('Is it over? Nobody knows.')).toBe('Is it over?')
    expect(firstSentence('One sentence only')).toBe('One sentence only')
  })
  it('reads past titles and abbreviations', () => {
    expect(firstSentence('Dr. Tedros warned the U.S. Senate on Monday. Then he left.')).toBe('Dr. Tedros warned the U.S. Senate on Monday.')
    expect(firstSentence('Aid from the U.N. Agency resumed. More follows.')).toBe('Aid from the U.N. Agency resumed.')
  })
  it('gives null for nothing', () => {
    expect(firstSentence('')).toBeNull()
    expect(firstSentence(null)).toBeNull()
    expect(firstSentence(42)).toBeNull()
  })
})

describe('clip', () => {
  it('cuts long lines at a word, with an ellipsis', () => {
    const out = clip('word '.repeat(100).trim(), 50)
    expect(out.length).toBeLessThanOrEqual(50)
    expect(out.endsWith('word…')).toBe(true)
    expect(clip('short', 50)).toBe('short')
  })
})

describe('briefOf', () => {
  it('takes the summary\'s lead and the first thing to watch', () => {
    const b = briefOf(LIVE)
    expect(b.changed).toBe('The most serious verified development is a Hong Kong apology for a residential fire that killed 168 people last year, reported by 5 outlets; the leader apologized and a top housing official will resign after an investigation blamed corruption and regulatory failures.')
    expect(b.watch).toBe('Coverage of the Spain train crash grew to 28 outlets, with mourning declared for three days.')
  })
  it('skips sentences that say nothing is scheduled', () => {
    const b = briefOf({ ...LIVE, sections: [{ id: 'what_to_watch', body: 'Our reports do not describe any scheduled future events. The ECB decides on rates on Thursday.' }] })
    expect(b.watch).toBe('The ECB decides on rates on Thursday.')
    expect(briefOf({ sections: [{ id: 'what_to_watch', body: 'No events are scheduled.' }] }).watch).toBeNull()
  })
  it('gives nulls for an unexpected answer', () => {
    expect(briefOf(null)).toEqual({ changed: null, watch: null })
    expect(briefOf({ success: false })).toEqual({ changed: null, watch: null })
    expect(briefOf({ executive_summary: 7, sections: 'x' })).toEqual({ changed: null, watch: null })
  })
})

describe('fetchHomeBrief', () => {
  it('never throws, and gives nulls when the briefing does not answer', async () => {
    const real = globalThis.fetch
    globalThis.fetch = vi.fn(async () => { throw new Error('down') }) as unknown as typeof fetch
    try {
      expect(await fetchHomeBrief('http://api.test', 1_000_000)).toEqual({ changed: null, watch: null })
    } finally {
      globalThis.fetch = real
    }
  })
})
