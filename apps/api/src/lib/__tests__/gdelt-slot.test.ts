/**
 * One request to GDELT at a time across the server (plan 0s3, Oct 22, 2026):
 * the story page's news images and TV clips share a slot with the scraper's
 * second-outlet search.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ answers: [] as Array<string | null | Error> }))
vi.mock('../../db/redis', () => ({
  redis: {
    set: vi.fn(async () => {
      const next = h.answers.shift()
      if (next instanceof Error) throw next
      return next ?? null
    }),
  },
}))

import { gdeltSlot } from '../gdelt-slot'

describe('gdeltSlot', () => {
  beforeEach(() => { h.answers = [] })

  it('takes the slot when it is free, and waits for it when it is taken', async () => {
    h.answers = ['OK']
    expect(await gdeltSlot(1_000)).toBe(true)
    h.answers = [null, null, 'OK']
    expect(await gdeltSlot(2_000)).toBe(true)
  })

  it('gives up when the slot stays taken, and goes ahead without Redis', async () => {
    h.answers = [null, null, null, null, null, null]
    expect(await gdeltSlot(300)).toBe(false)
    h.answers = [new Error('Redis down')]
    expect(await gdeltSlot(300)).toBe(true)
  })
})
