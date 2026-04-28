/**
 * Unit tests for search.ts document transformers and index helpers.
 *
 * These tests exercise the internal toSignalDoc / toPostDoc / toUserDoc
 * transformation logic without hitting a real Meilisearch instance.
 * The batch/single index functions are lightly smoke-tested via mocks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock meilisearch before importing the module under test ─────────────────

const mockAddDocuments = vi.fn().mockResolvedValue({})
const mockDeleteDocument = vi.fn().mockResolvedValue({})
const mockUpdateSettings = vi.fn().mockResolvedValue({})
const mockIndex = vi.fn(() => ({
  addDocuments:    mockAddDocuments,
  deleteDocument:  mockDeleteDocument,
  updateSettings:  mockUpdateSettings,
}))

vi.mock('meilisearch', () => ({
  MeiliSearch: vi.fn().mockImplementation(() => ({ index: mockIndex })),
}))

// Import after mock registration
const {
  setupSearchIndexes,
  indexSignal,
  indexPost,
  indexUser,
  indexSignals,
  indexPosts,
  indexUsers,
  removeSignal,
  removePost,
  removeUser,
} = await import('../search.js')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSignalRow(overrides: Record<string, unknown> = {}) {
  return {
    id:               'sig-1',
    title:            'Earthquake in Turkey',
    summary:          'A 7.2 magnitude earthquake struck eastern Turkey.',
    category:         'disaster',
    severity:         'critical',
    status:           'verified',
    reliability_score: 0.87,
    location_name:    'Van, Turkey',
    country_code:     'TR',
    tags:             ['earthquake', 'turkey', 'disaster'],
    language:         'en',
    view_count:       1200,
    post_count:       45,
    created_at:       new Date('2025-01-15T10:00:00Z'),
    ...overrides,
  }
}

function makePostRow(overrides: Record<string, unknown> = {}) {
  return {
    id:                   'post-1',
    content:              'Breaking: Major earthquake hits eastern Turkey.',
    post_type:            'signal',
    tags:                 ['earthquake', 'breaking'],
    author_id:            'user-1',
    author_handle:        'newsdesk',
    author_display_name:  'World News Desk',
    like_count:           30,
    boost_count:          12,
    reply_count:          5,
    source_name:          'Reuters',
    language:             'en',
    signal_id:            'sig-1',
    created_at:           new Date('2025-01-15T10:05:00Z'),
    ...overrides,
  }
}

function makeUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id:            'user-1',
    handle:        'newsdesk',
    display_name:  'World News Desk',
    bio:           'Breaking news coverage around the clock.',
    account_type:  'journalist',
    verified:      true,
    follower_count: 95000,
    trust_score:   0.92,
    ...overrides,
  }
}

// ─── setupSearchIndexes ───────────────────────────────────────────────────────

describe('setupSearchIndexes', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('calls updateSettings on signals, posts, and users indexes', async () => {
    await setupSearchIndexes()
    expect(mockIndex).toHaveBeenCalledWith('signals')
    expect(mockIndex).toHaveBeenCalledWith('posts')
    expect(mockIndex).toHaveBeenCalledWith('users')
    expect(mockUpdateSettings).toHaveBeenCalledTimes(3)
  })

  it('configures signals index with expected filterable attributes', async () => {
    await setupSearchIndexes()
    const signalsCall = mockUpdateSettings.mock.calls.find(
      (_, i) => mockIndex.mock.calls[i]?.[0] === 'signals'
    )
    expect(signalsCall).toBeDefined()
    const settings = signalsCall![0] as Record<string, unknown>
    expect((settings.filterableAttributes as string[])).toContain('category')
    expect((settings.filterableAttributes as string[])).toContain('reliabilityScore')
    expect((settings.filterableAttributes as string[])).toContain('createdAt')
  })
})

// ─── indexSignal ─────────────────────────────────────────────────────────────

describe('indexSignal', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('maps snake_case DB row to camelCase SignalDoc', async () => {
    await indexSignal(makeSignalRow())
    expect(mockAddDocuments).toHaveBeenCalledOnce()
    const [docs] = mockAddDocuments.mock.calls[0] as [unknown[]]
    const doc = docs[0] as Record<string, unknown>

    expect(doc.id).toBe('sig-1')
    expect(doc.title).toBe('Earthquake in Turkey')
    expect(doc.category).toBe('disaster')
    expect(doc.severity).toBe('critical')
    expect(doc.reliabilityScore).toBe(0.87)
    expect(doc.locationName).toBe('Van, Turkey')
    expect(doc.countryCode).toBe('TR')
    expect(doc.tags).toEqual(['earthquake', 'turkey', 'disaster'])
    expect(doc.viewCount).toBe(1200)
    expect(doc.postCount).toBe(45)
    // createdAt should be a Unix timestamp in seconds
    expect(doc.createdAt).toBe(Math.floor(new Date('2025-01-15T10:00:00Z').getTime() / 1000))
  })

  it('handles null optional fields gracefully', async () => {
    await indexSignal(makeSignalRow({ summary: null, location_name: null, country_code: null }))
    const [docs] = mockAddDocuments.mock.calls[0] as [unknown[]]
    const doc = docs[0] as Record<string, unknown>
    expect(doc.summary).toBeNull()
    expect(doc.locationName).toBeNull()
    expect(doc.countryCode).toBeNull()
  })

  it('converts string date to unix timestamp', async () => {
    await indexSignal(makeSignalRow({ created_at: '2025-06-01T00:00:00Z' }))
    const [docs] = mockAddDocuments.mock.calls[0] as [unknown[]]
    const doc = docs[0] as Record<string, unknown>
    expect(doc.createdAt).toBe(Math.floor(new Date('2025-06-01T00:00:00Z').getTime() / 1000))
  })

  it('defaults missing numeric fields to 0', async () => {
    const row = makeSignalRow()
    delete (row as Record<string, unknown>).view_count
    delete (row as Record<string, unknown>).post_count
    await indexSignal(row as Record<string, unknown>)
    const [docs] = mockAddDocuments.mock.calls[0] as [unknown[]]
    const doc = docs[0] as Record<string, unknown>
    expect(doc.viewCount).toBe(0)
    expect(doc.postCount).toBe(0)
  })
})

// ─── indexPost ────────────────────────────────────────────────────────────────

describe('indexPost', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('maps joined row (with author_handle) to PostDoc', async () => {
    await indexPost(makePostRow())
    const [docs] = mockAddDocuments.mock.calls[0] as [unknown[]]
    const doc = docs[0] as Record<string, unknown>

    expect(doc.id).toBe('post-1')
    expect(doc.content).toBe('Breaking: Major earthquake hits eastern Turkey.')
    expect(doc.postType).toBe('signal')
    expect(doc.authorId).toBe('user-1')
    expect(doc.authorHandle).toBe('newsdesk')
    expect(doc.authorDisplayName).toBe('World News Desk')
    expect(doc.likeCount).toBe(30)
    expect(doc.boostCount).toBe(12)
    expect(doc.replyCount).toBe(5)
    expect(doc.sourceName).toBe('Reuters')
    expect(doc.signalId).toBe('sig-1')
    expect(doc.createdAt).toBe(Math.floor(new Date('2025-01-15T10:05:00Z').getTime() / 1000))
  })

  it('handles null signalId and sourceName', async () => {
    await indexPost(makePostRow({ signal_id: null, source_name: null }))
    const [docs] = mockAddDocuments.mock.calls[0] as [unknown[]]
    const doc = docs[0] as Record<string, unknown>
    expect(doc.signalId).toBeNull()
    expect(doc.sourceName).toBeNull()
  })
})

// ─── indexUser ────────────────────────────────────────────────────────────────

describe('indexUser', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('maps user row to UserDoc', async () => {
    await indexUser(makeUserRow())
    const [docs] = mockAddDocuments.mock.calls[0] as [unknown[]]
    const doc = docs[0] as Record<string, unknown>

    expect(doc.id).toBe('user-1')
    expect(doc.handle).toBe('newsdesk')
    expect(doc.displayName).toBe('World News Desk')
    expect(doc.bio).toBe('Breaking news coverage around the clock.')
    expect(doc.accountType).toBe('journalist')
    expect(doc.verified).toBe(true)
    expect(doc.followerCount).toBe(95000)
    expect(doc.trustScore).toBe(0.92)
  })

  it('defaults missing optional fields', async () => {
    const row = makeUserRow({ display_name: undefined, bio: null, account_type: undefined, verified: undefined })
    await indexUser(row as Record<string, unknown>)
    const [docs] = mockAddDocuments.mock.calls[0] as [unknown[]]
    const doc = docs[0] as Record<string, unknown>
    expect(doc.displayName).toBe('')
    expect(doc.bio).toBeNull()
    expect(doc.accountType).toBe('community')
    expect(doc.verified).toBe(false)
  })
})

// ─── Batch functions ─────────────────────────────────────────────────────────

describe('indexSignals (batch)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('sends all rows in a single addDocuments call', async () => {
    await indexSignals([makeSignalRow(), makeSignalRow({ id: 'sig-2', title: 'Flood in Germany' })])
    expect(mockAddDocuments).toHaveBeenCalledOnce()
    const [docs] = mockAddDocuments.mock.calls[0] as [unknown[]]
    expect(docs).toHaveLength(2)
  })

  it('is a no-op for empty array', async () => {
    await indexSignals([])
    expect(mockAddDocuments).not.toHaveBeenCalled()
  })
})

describe('indexPosts (batch)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('sends all rows in a single addDocuments call', async () => {
    await indexPosts([makePostRow(), makePostRow({ id: 'post-2' })])
    expect(mockAddDocuments).toHaveBeenCalledOnce()
    const [docs] = mockAddDocuments.mock.calls[0] as [unknown[]]
    expect(docs).toHaveLength(2)
  })

  it('is a no-op for empty array', async () => {
    await indexPosts([])
    expect(mockAddDocuments).not.toHaveBeenCalled()
  })
})

describe('indexUsers (batch)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('sends all rows in a single addDocuments call', async () => {
    await indexUsers([makeUserRow(), makeUserRow({ id: 'user-2', handle: 'breaking' })])
    expect(mockAddDocuments).toHaveBeenCalledOnce()
    const [docs] = mockAddDocuments.mock.calls[0] as [unknown[]]
    expect(docs).toHaveLength(2)
  })

  it('is a no-op for empty array', async () => {
    await indexUsers([])
    expect(mockAddDocuments).not.toHaveBeenCalled()
  })
})

// ─── Remove functions ─────────────────────────────────────────────────────────

describe('removeSignal / removePost / removeUser', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('removeSignal calls deleteDocument on signals index', async () => {
    await removeSignal('sig-abc')
    expect(mockDeleteDocument).toHaveBeenCalledWith('sig-abc')
  })

  it('removePost calls deleteDocument on posts index', async () => {
    await removePost('post-abc')
    expect(mockDeleteDocument).toHaveBeenCalledWith('post-abc')
  })

  it('removeUser calls deleteDocument on users index', async () => {
    await removeUser('user-abc')
    expect(mockDeleteDocument).toHaveBeenCalledWith('user-abc')
  })
})
