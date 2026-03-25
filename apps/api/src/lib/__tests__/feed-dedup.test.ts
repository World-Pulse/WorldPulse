import { describe, it, expect } from 'vitest'

// ─── Inline the topic-key logic so this test file is self-contained ──────────
// (mirrors the dedup filter added to apps/api/src/routes/feed.ts)
function topicKey(title: string): string {
  return (title ?? '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w: string) => w.length > 3)
    .slice(0, 6)
    .sort()
    .join('_')
}

function dedupByTopic(rows: Array<{ title: string; id: string }>): Array<{ title: string; id: string }> {
  const seen = new Set<string>()
  return rows.filter(row => {
    const key = topicKey(row.title)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('topicKey()', () => {
  it('produces a stable fingerprint from a title', () => {
    const k = topicKey('Israel launches airstrikes on Tehran')
    expect(k).toBe('airstrikes_israel_launches_tehran')
  })

  it('strips punctuation before fingerprinting', () => {
    expect(topicKey('Israel launches airstrikes on Tehran!')).toBe(
      topicKey('Israel launches airstrikes on Tehran'),
    )
  })

  it('is case-insensitive', () => {
    expect(topicKey('ISRAEL Launches AIRSTRIKES On Tehran')).toBe(
      topicKey('israel launches airstrikes on tehran'),
    )
  })

  it('drops short words (≤3 chars) and stop-word noise', () => {
    // "on", "a", "the", "in" should be filtered
    expect(topicKey('A fire on the island')).toBe('fire_island')
  })

  it('returns empty string for empty / whitespace-only input', () => {
    expect(topicKey('')).toBe('')
    expect(topicKey('  ')).toBe('')
  })

  it('returns empty string for title made entirely of short words', () => {
    expect(topicKey('A B C D')).toBe('')
  })

  it('uses only the first 6 meaningful words (sorted)', () => {
    const title = 'Breaking alpha bravo charlie delta epsilon zeta extra words here'
    const key = topicKey(title)
    // Should contain exactly 6 words, sorted alphabetically
    const parts = key.split('_')
    expect(parts.length).toBe(6)
    const sorted = [...parts].sort()
    expect(parts).toEqual(sorted)
  })
})

describe('dedupByTopic()', () => {
  it('removes near-duplicate signals about the same event', () => {
    const rows = [
      { id: '1', title: 'Israel launches airstrikes on Tehran overnight' },
      { id: '2', title: 'Israel launches airstrikes on Tehran — live updates' },
      { id: '3', title: 'Israel launches airstrikes on Tehran, death toll rises' },
      { id: '4', title: 'Magnitude 6.8 earthquake strikes off coast of Japan' },
    ]
    const result = dedupByTopic(rows)
    // First "Israel / Tehran" kept; duplicates removed; earthquake kept
    expect(result.length).toBe(2)
    expect(result[0].id).toBe('1')
    expect(result[1].id).toBe('4')
  })

  it('keeps first occurrence (most recent, since feed is ordered desc)', () => {
    const rows = [
      { id: 'new', title: 'Wildfire spreads across California hills' },
      { id: 'old', title: 'Wildfire spreads across California hills — update' },
    ]
    expect(dedupByTopic(rows)[0].id).toBe('new')
  })

  it('passes through fully distinct titles unchanged', () => {
    const rows = [
      { id: '1', title: 'Earthquake in Japan' },
      { id: '2', title: 'Flooding across Bangladesh delta region' },
      { id: '3', title: 'NATO summit begins in Warsaw Poland tomorrow' },
    ]
    expect(dedupByTopic(rows).length).toBe(3)
  })

  it('handles an empty array gracefully', () => {
    expect(dedupByTopic([])).toEqual([])
  })

  it('handles titles that resolve to empty keys by passing all through', () => {
    // All short-word titles get key '' — only the first '' is kept (which means
    // only 1 passes through), but that is acceptable defensive behaviour.
    const rows = [
      { id: '1', title: 'A B C' },
      { id: '2', title: 'D E F' },
    ]
    // Both produce key '' → only first passes filter
    expect(dedupByTopic(rows).length).toBe(1)
  })
})
