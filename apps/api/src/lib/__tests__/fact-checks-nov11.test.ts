/**
 * Fact-checks beside verified stories (Nov 11, 2026): a check is about a story by meaning and by headline
 * words (lib/fact-checks.ts). The fingerprints here are made up; the real ones were tried against the
 * week's top stories (the file's notes).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ raw: null as string | null, gets: 0 }))
vi.mock('../../db/redis', () => ({
  redis: { get: async () => { h.gets++; return h.raw } },
}))

import {
  contentWords, matchFactChecks, decodeVec, parseVectorText, loadFactChecks, resetFactChecks,
  MATCH_MIN_SCORE, type LoadedFactCheck, type StoredFactCheck,
} from '../fact-checks'
import { FINGERPRINT_DIMS, FINGERPRINT_MODEL } from '../fingerprint'

/** A unit vector along axis 0, turned toward axis 1 by its cosine with axis 0 */
function toward(cos: number): Float32Array {
  const v = new Float32Array(FINGERPRINT_DIMS)
  v[0] = cos
  v[1] = Math.sqrt(1 - cos * cos)
  return v
}

const check = (title: string, published: string, extra: Partial<StoredFactCheck> = {}): StoredFactCheck => ({
  id: title.slice(0, 16), checker: 'full-fact', name: 'Full Fact', title, url: `https://fullfact.org/${encodeURIComponent(title)}/`,
  published, claim: null, rating: null, summary: 'Their summary', language: 'en', model: FINGERPRINT_MODEL, vec: null, ...extra,
})

const STORY_TITLES = [
  'Florida jet crash: plane parts found far from the crash site',
  'Nine killed as private plane crashes near Palm Beach, Florida',
  'Investigators search Learjet wreckage after Florida crash',
  'Palm Beach plane crash: what we know',
]
const story = {
  centroid: toward(1),
  titles: STORY_TITLES,
  firstAt: Date.parse('2026-11-01T15:00:00Z'),
  latestAt: Date.parse('2026-11-04T09:00:00Z'),
}

describe('the words that tie a check to a story', () => {
  it('leaves out everyday news and fact-check words, years and possessives, and reads plurals as singulars', () => {
    expect(contentWords("Florida Learjet plane crash was real, not faked to cover up a missile strike"))
      .toEqual(['florida', 'learjet', 'plane', 'crash', 'cover', 'missile', 'strike'])
    expect(contentWords("FactChecking Trump’s Post-Election ‘60 Minutes’ Interview")).toEqual(['minute', 'interview'])
    expect(contentWords('Fake images of Donald Trump being carried after US midterm elections shared online'))
      .toEqual(['donald', 'carried'])
    expect(contentWords('The 2026 FactCheck Awards')).toEqual(['award'])
  })
})

describe('matching checks to a story', () => {
  const items: LoadedFactCheck[] = [
    // close by meaning and four headline words in two or more of its headlines: a match
    { check: check('Florida Learjet plane crash was real, not faked to cover up a missile strike', '2026-11-04T16:00:49Z'), vector: toward(0.67) },
    { check: check('Palm Beach plane crash footage isn’t AI-generated', '2026-11-02T21:14:05Z', { checker: 'politifact', name: 'PolitiFact', rating: 'Pants on Fire!' }), vector: toward(0.6) },
    // close by meaning, one word shared: not enough
    { check: check('Florida senator misleads on insurance costs', '2026-11-03T12:00:00Z'), vector: toward(0.7) },
    // the words, but far by meaning
    { check: check('Plane crash in Florida was in 1998, not this week', '2026-11-03T12:00:00Z'), vector: toward(0.3) },
    // a match by meaning and words, but published before the story by more than 3 days
    { check: check('Old Florida plane crash photo', '2026-10-20T12:00:00Z'), vector: toward(0.8) },
    // no fingerprint yet
    { check: check('Florida plane crash claims', '2026-11-03T12:00:00Z'), vector: null },
  ]

  it('finds the checks close by meaning that share two or more words with the reports, closest first', () => {
    const found = matchFactChecks(story, items)
    expect(found.map(f => f.title)).toEqual([
      'Florida Learjet plane crash was real, not faked to cover up a missile strike',
      'Palm Beach plane crash footage isn’t AI-generated',
    ])
    expect(found[0]).toMatchObject({ checker: 'Full Fact', checkerUrl: 'https://fullfact.org', score: 0.67, shared: ['florida', 'plane', 'crash'] })
    expect(found[1]).toMatchObject({ checker: 'PolitiFact', checkerUrl: 'https://www.politifact.com', rating: 'Pants on Fire!', shared: ['palm', 'beach', 'plane', 'crash'] })
    expect(found[1]!.score).toBeGreaterThanOrEqual(MATCH_MIN_SCORE)
  })

  it("reads the story's average fingerprint at any length", () => {
    const half = { ...story, centroid: toward(1).map(x => x * 0.5) }
    expect(matchFactChecks(half, items).map(f => f.score)).toEqual([0.67, 0.6])
  })

  it('needs a word in two headlines (or the only one), and shows at most three', () => {
    const oneTitle = { ...story, titles: ['Investigators search Learjet wreckage after Florida crash'] }
    expect(matchFactChecks(oneTitle, items).map(f => f.title)).toEqual(['Florida Learjet plane crash was real, not faked to cover up a missile strike'])
    const many = Array.from({ length: 5 }, (_, i) => ({ check: check(`Palm Beach plane crash rumor ${i}`, '2026-11-03T12:00:00Z'), vector: toward(0.9 - i / 100) }))
    expect(matchFactChecks(story, many)).toHaveLength(3)
  })

  it('finds nothing without a fingerprint or headlines', () => {
    expect(matchFactChecks({ ...story, centroid: null }, items)).toEqual([])
    expect(matchFactChecks({ ...story, titles: [] }, items)).toEqual([])
  })
})

describe("reading the scraper's checks", () => {
  beforeEach(() => { resetFactChecks(); h.gets = 0 })

  it('reads fingerprints of the same model only, and keeps them 5 minutes', async () => {
    const v = toward(0.5)
    const b64 = Buffer.from(v.buffer).toString('base64')
    h.raw = JSON.stringify({
      updated_at: '2026-11-11T15:00:00Z',
      checkers: [{ id: 'full-fact', name: 'Full Fact', ok: true, read_at: '2026-11-11T15:00:00Z', items: 10 }],
      items: [check('A', '2026-11-10T00:00:00Z', { vec: b64 }), check('B', '2026-11-10T00:00:00Z', { vec: b64, model: 'another-model' })],
    })
    const now = Date.parse('2026-11-11T15:00:00Z')
    const loaded = await loadFactChecks(now)
    expect(loaded!.items.map(i => i.vector?.[0])).toEqual([0.5, undefined])
    expect(loaded!.checkers[0]!.ok).toBe(true)
    await loadFactChecks(now + 60_000)
    expect(h.gets).toBe(1)
    await loadFactChecks(now + 6 * 60_000)
    expect(h.gets).toBe(2)
  })

  it('is null before the first read', async () => {
    h.raw = null
    expect(await loadFactChecks()).toBeNull()
  })

  it('reads fingerprints in base64 and in pgvector text, and nothing of another length', () => {
    const v = toward(0.25)
    expect(decodeVec(Buffer.from(v.buffer).toString('base64'))![0]).toBe(0.25)
    expect(decodeVec(Buffer.from(new Float32Array(3).buffer).toString('base64'))).toBeNull()
    expect(decodeVec(null)).toBeNull()
    const text = `[${Array.from(v, x => x.toFixed(6)).join(',')}]`
    expect(parseVectorText(text)![0]).toBeCloseTo(0.25)
    expect(parseVectorText('[1,2,3]')).toBeNull()
    expect(parseVectorText(null)).toBeNull()
  })
})
