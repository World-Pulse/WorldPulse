/**
 * Unit tests for search-events.ts
 *
 * Verifies that topic constants are correct string values and that
 * the lifecycle/publish functions are callable no-ops (they exist,
 * return void, and never throw).
 */

import { describe, it, expect } from 'vitest'

const {
  TOPIC_SIGNAL_UPDATED,
  TOPIC_SIGNAL_DELETED,
  TOPIC_POST_CREATED,
  TOPIC_POST_DELETED,
  connectSearchProducer,
  disconnectSearchProducer,
  publishSignalUpsert,
  publishSignalDelete,
  publishPostCreated,
  publishPostDeleted,
} = await import('../search-events.js')

// ─── Topic constants ──────────────────────────────────────────────────────────

describe('topic constants', () => {
  it('TOPIC_SIGNAL_UPDATED is the correct Kafka topic name', () => {
    expect(TOPIC_SIGNAL_UPDATED).toBe('signals.updated')
  })

  it('TOPIC_SIGNAL_DELETED is the correct Kafka topic name', () => {
    expect(TOPIC_SIGNAL_DELETED).toBe('signals.deleted')
  })

  it('TOPIC_POST_CREATED is the correct Kafka topic name', () => {
    expect(TOPIC_POST_CREATED).toBe('posts.created')
  })

  it('TOPIC_POST_DELETED is the correct Kafka topic name', () => {
    expect(TOPIC_POST_DELETED).toBe('posts.deleted')
  })

  it('all topic names follow the <entity>.<event> convention', () => {
    const topics = [
      TOPIC_SIGNAL_UPDATED,
      TOPIC_SIGNAL_DELETED,
      TOPIC_POST_CREATED,
      TOPIC_POST_DELETED,
    ]
    for (const topic of topics) {
      expect(topic).toMatch(/^[a-z]+\.[a-z]+$/)
    }
  })
})

// ─── Lifecycle no-ops ─────────────────────────────────────────────────────────

describe('connectSearchProducer', () => {
  it('resolves without throwing', async () => {
    await expect(connectSearchProducer()).resolves.toBeUndefined()
  })
})

describe('disconnectSearchProducer', () => {
  it('resolves without throwing', async () => {
    await expect(disconnectSearchProducer()).resolves.toBeUndefined()
  })
})

// ─── Publish no-ops ───────────────────────────────────────────────────────────

describe('publishSignalUpsert', () => {
  it('returns undefined and does not throw', () => {
    expect(() => publishSignalUpsert('sig-abc')).not.toThrow()
    expect(publishSignalUpsert('sig-abc')).toBeUndefined()
  })
})

describe('publishSignalDelete', () => {
  it('returns undefined and does not throw', () => {
    expect(() => publishSignalDelete('sig-abc')).not.toThrow()
    expect(publishSignalDelete('sig-abc')).toBeUndefined()
  })
})

describe('publishPostCreated', () => {
  it('returns undefined and does not throw', () => {
    expect(() => publishPostCreated('post-abc')).not.toThrow()
    expect(publishPostCreated('post-abc')).toBeUndefined()
  })
})

describe('publishPostDeleted', () => {
  it('returns undefined and does not throw', () => {
    expect(() => publishPostDeleted('post-abc')).not.toThrow()
    expect(publishPostDeleted('post-abc')).toBeUndefined()
  })
})
