/**
 * The AI Digest tab shows what is current and when it last published (P5).
 */

import { describe, it, expect } from 'vitest'
import { freshDigest, lastDigestUpdate, updatedAgo, DIGEST_FRESH_MS } from '../digest'

const NOW = Date.parse('2026-10-11T16:30:00Z')

describe('freshDigest', () => {
  it('leaves out the May briefings, and says so', () => {
    const items = [
      { id: 'hurricane', createdAt: '2026-10-11T16:21:15Z' },
      { id: 'may', createdAt: '2026-05-13T11:06:40Z' },
      { id: 'undated' },
    ]
    const { fresh, droppedOld } = freshDigest(items, NOW)
    expect(fresh.map(i => i.id)).toEqual(['hurricane', 'undated'])
    expect(droppedOld).toBe(true)
  })

  it('keeps two weeks', () => {
    const recent = { createdAt: new Date(NOW - DIGEST_FRESH_MS + 60_000).toISOString() }
    expect(freshDigest([recent], NOW)).toEqual({ fresh: [recent], droppedOld: false })
  })
})

describe('lastDigestUpdate and updatedAgo', () => {
  it("takes the newest item, wherever it's ranked", () => {
    expect(lastDigestUpdate([{ createdAt: '2026-10-11T16:21:13Z' }, { createdAt: '2026-10-11T16:21:15Z' }, {}]))
      .toBe('2026-10-11T16:21:15.000Z')
    expect(lastDigestUpdate([])).toBeNull()
  })

  it('reads as plain words', () => {
    expect(updatedAgo('2026-10-11T16:29:40Z', NOW)).toBe('just now')
    expect(updatedAgo('2026-10-11T16:21:15Z', NOW)).toBe('8 minutes ago')
    expect(updatedAgo('2026-10-11T15:29:00Z', NOW)).toBe('1 hour ago')
    expect(updatedAgo('2026-10-09T16:30:00Z', NOW)).toBe('2 days ago')
  })
})
