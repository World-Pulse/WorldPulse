/**
 * The Daily Briefing written from what is verified (plans E2 and 9, Oct 21,
 * 2026): the writer gets the verified stories with their outlets, the stories
 * that grew, and the serious reports nobody has confirmed yet, and is asked
 * for nothing the reports don't say. The old prompt gave the most severe
 * reports with a reliability percentage, and told the writer every section
 * was "MANDATORY" and to "use ANY available" report for the maritime one.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../db/postgres', () => ({ db: vi.fn() }))
vi.mock('../db/redis', () => ({ redis: {} }))
vi.mock('../lib/claude', () => ({ askClaude: vi.fn(), CLAUDE_SMALL: 'small' }))
vi.mock('../lib/stories', () => ({ signalsHaveStoryIds: async () => true }))

import { briefingLists, buildBriefingPrompt, type BriefingSignal } from '../lib/briefing-generator'

const sig = (o: Partial<BriefingSignal>): BriefingSignal => ({
  id: o.id ?? 'x', title: 'A report', category: 'conflict', severity: 'medium', reliability_score: 0.8,
  location_name: null, country_code: null, source_domain: 'example.com', created_at: '2026-10-21T08:00:00Z',
  status: 'pending', source_count: 1, summary: null, ...o,
})

const reports = [
  sig({ id: 'a', title: 'Drone strike on El Fasher market', severity: 'high', status: 'verified', source_count: 4, location_name: 'El Fasher, Sudan', summary: 'At least 30 people were killed when drones hit the market.' }),
  sig({ id: 'b', title: 'Earthquake shakes central Chile', severity: 'critical', status: 'verified', source_count: 2, location_name: 'Chile' }),
  sig({ id: 'c', title: 'Talks resume in Doha', severity: 'medium', status: 'verified', source_count: 12, category: 'geopolitics' }),
  sig({ id: 'd', title: 'Explosion reported at refinery', severity: 'critical', status: 'pending', source_count: 1 }),
  sig({ id: 'e', title: 'Minor protest in a capital', severity: 'medium', status: 'pending', source_count: 1 }),
]
const grew = [sig({ id: 'g', title: 'Ceasefire holds a second day', severity: 'medium', status: 'verified', source_count: 21 })]

describe('what the writer gets', () => {
  it('verified stories most serious first, then the most carried; unconfirmed only when serious', () => {
    const lists = briefingLists(reports, grew)
    expect(lists.verified.map(s => s.id)).toEqual(['b', 'a', 'c'])
    expect(lists.unconfirmed.map(s => s.id)).toEqual(['d'])
    expect(lists.growing.map(s => s.id)).toEqual(['g'])
  })

  it('each with its severity, outlets, category, place and summary', () => {
    const prompt = buildBriefingPrompt(briefingLists(reports, grew), [], [], 16900, 9800, 24)
    expect(prompt).toContain('- [HIGH · 4 outlets · conflict] Drone strike on El Fasher market (El Fasher, Sudan) — At least 30 people were killed when drones hit the market.')
    expect(prompt).toContain('- [CRITICAL · 1 outlet · conflict] Explosion reported at refinery (no place given)')
    expect(prompt).toContain('- [MEDIUM · 21 outlets · conflict] Ceasefire holds a second day')
    expect(prompt).toContain('16900 reports, 9800 stories')
    // the order the writer reads: verified, grew, not yet confirmed
    const at = (s: string) => prompt.indexOf(s)
    expect(at('VERIFIED STORIES')).toBeLessThan(at('STORIES THAT GREW'))
    expect(at('STORIES THAT GREW')).toBeLessThan(at('NOT YET CONFIRMED'))
  })
})

describe('what the writer is asked', () => {
  const prompt = buildBriefingPrompt(briefingLists(reports, []), [], [], 1, 1, 24)
  it('nothing the reports don\'t say, and single-outlet reports called unconfirmed', () => {
    expect(prompt).toContain('Never add a fact, number, name or place they don\'t give')
    expect(prompt).toContain('Call a single-outlet report unconfirmed')
    expect(prompt).toContain('If none fit, write one sentence saying our reports had nothing notable')
  })
  it('no filler: no section is "MANDATORY", nothing is stretched to fill one', () => {
    expect(prompt).not.toMatch(/MANDATORY|use ANY available|minimum 2 sentences/i)
    expect(prompt).toContain('STORIES THAT GREW (first reported earlier; more outlets carried them in these 24 hours):\n(none)')
  })
  it('the answer keeps its shape: seven sections and key developments', () => {
    for (const id of ['threat_assessment', 'geopolitical_pulse', 'economic_trade', 'maritime_intelligence', 'climate_disaster', 'cyber_tech', 'what_to_watch']) {
      expect(prompt).toContain(`- ${id}:`)
    }
    expect(prompt).toContain('"key_developments"')
  })
})
