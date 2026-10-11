/**
 * OpenAI calls pause for an hour when the account is out of credit
 * (lib/openai-credit.ts, Oct 11, 2026).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { openaiPaused, noteOpenAIFailure, resumeOpenAI } from '../openai-credit'
import { logger } from '../logger'

const OUT_OF_CREDIT = '{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","code":"insufficient_quota"}}'
const NOW = Date.parse('2026-10-11T17:20:00Z')

describe('openaiPaused', () => {
  beforeEach(() => { resumeOpenAI(); vi.mocked(logger.warn).mockClear() })

  it('pauses for an hour on "out of credit", and says so once', () => {
    expect(noteOpenAIFailure(429, OUT_OF_CREDIT, NOW)).toBe(true)
    expect(openaiPaused(NOW + 59 * 60_000)).toBe(true)
    expect(openaiPaused(NOW + 61 * 60_000)).toBe(false)
    noteOpenAIFailure(429, OUT_OF_CREDIT, NOW + 1_000)
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it("doesn't pause for a rate limit or an error", () => {
    expect(noteOpenAIFailure(429, '{"error":{"type":"rate_limit_exceeded"}}', NOW)).toBe(false)
    expect(noteOpenAIFailure(500, OUT_OF_CREDIT, NOW)).toBe(false)
    expect(openaiPaused(NOW)).toBe(false)
  })
})
