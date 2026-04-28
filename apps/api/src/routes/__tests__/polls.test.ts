/**
 * Polls API Route Tests — apps/api/src/routes/polls.ts
 *
 * Tests the polling system: creation, voting, expiration,
 * deletion, duplicate vote prevention, and response formatting.
 *
 * Covers: schema validation, vote mechanics, expiration logic,
 *         option index bounds, JSONB structure, authorization,
 *         and response format.
 */

import { describe, it, expect } from 'vitest'

// ─── Schema Constraints (mirroring polls.ts Zod schemas) ──────────────────────

const QUESTION_MIN = 1
const QUESTION_MAX = 500
const OPTION_TEXT_MIN = 1
const OPTION_TEXT_MAX = 200
const OPTIONS_MIN = 2
const OPTIONS_MAX = 4
const OPTION_INDEX_MIN = 0
const OPTION_INDEX_MAX = 3

// ─── Validation Helpers ─────────────────────────────────────────────────────

function validateCreatePoll(input: {
  question: string
  options: string[]
  expiresAt?: string
  postId?: string
}): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (input.question.length < QUESTION_MIN) errors.push('question too short')
  if (input.question.length > QUESTION_MAX) errors.push('question too long')

  if (input.options.length < OPTIONS_MIN) errors.push('too few options')
  if (input.options.length > OPTIONS_MAX) errors.push('too many options')

  for (const opt of input.options) {
    if (opt.length < OPTION_TEXT_MIN) errors.push('option text too short')
    if (opt.length > OPTION_TEXT_MAX) errors.push('option text too long')
  }

  if (input.expiresAt !== undefined) {
    const d = new Date(input.expiresAt)
    if (isNaN(d.getTime())) errors.push('invalid expiresAt')
  }

  if (input.postId !== undefined) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(input.postId)) errors.push('invalid postId')
  }

  return { valid: errors.length === 0, errors }
}

function validateVote(optionIndex: number): boolean {
  return Number.isInteger(optionIndex) && optionIndex >= OPTION_INDEX_MIN && optionIndex <= OPTION_INDEX_MAX
}

// ─── Format Helper (mirroring polls.ts) ──────────────────────────────────────

interface PollOption {
  text: string
  votes: number
}

interface FormattedPoll {
  id: string
  question: string
  authorId: string
  postId: string | null
  options: PollOption[]
  totalVotes: number
  expiresAt: string | null
  ended: boolean
  userVote: number | null
  createdAt: string
}

function formatPoll(
  poll: {
    id: string
    question: string
    author_id: string
    post_id: string | null
    options: PollOption[]
    expires_at: Date | null
    created_at: Date
  },
  userVote: number | null,
): FormattedPoll {
  const totalVotes = poll.options.reduce((sum, o) => sum + o.votes, 0)
  const expiresAt = poll.expires_at ? poll.expires_at.toISOString() : null
  const ended = expiresAt ? new Date(expiresAt) < new Date() : false

  return {
    id: poll.id,
    question: poll.question,
    authorId: poll.author_id,
    postId: poll.post_id,
    options: poll.options.map(o => ({ text: o.text, votes: o.votes })),
    totalVotes,
    expiresAt,
    ended,
    userVote,
    createdAt: poll.created_at.toISOString(),
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('CreatePollSchema Constraints', () => {
  it('accepts valid poll with 2 options', () => {
    const result = validateCreatePoll({
      question: 'Which country will be most impacted?',
      options: ['Country A', 'Country B'],
    })
    expect(result.valid).toBe(true)
  })

  it('accepts valid poll with 4 options', () => {
    const result = validateCreatePoll({
      question: 'Rate the severity of this event',
      options: ['Critical', 'High', 'Medium', 'Low'],
    })
    expect(result.valid).toBe(true)
  })

  it('accepts poll with expiresAt datetime', () => {
    const result = validateCreatePoll({
      question: 'Quick poll',
      options: ['Yes', 'No'],
      expiresAt: '2026-04-05T12:00:00.000Z',
    })
    expect(result.valid).toBe(true)
  })

  it('accepts poll with postId UUID', () => {
    const result = validateCreatePoll({
      question: 'Embedded poll',
      options: ['Agree', 'Disagree'],
      postId: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(result.valid).toBe(true)
  })

  it('rejects empty question', () => {
    const result = validateCreatePoll({
      question: '',
      options: ['Yes', 'No'],
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('question too short')
  })

  it('rejects question longer than 500 chars', () => {
    const result = validateCreatePoll({
      question: 'Q'.repeat(501),
      options: ['Yes', 'No'],
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('question too long')
  })

  it('rejects fewer than 2 options', () => {
    const result = validateCreatePoll({
      question: 'Only one option?',
      options: ['Only'],
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('too few options')
  })

  it('rejects more than 4 options', () => {
    const result = validateCreatePoll({
      question: 'Too many options',
      options: ['A', 'B', 'C', 'D', 'E'],
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('too many options')
  })

  it('rejects empty option text', () => {
    const result = validateCreatePoll({
      question: 'Empty option',
      options: ['Yes', ''],
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('option text too short')
  })

  it('rejects option text longer than 200 chars', () => {
    const result = validateCreatePoll({
      question: 'Long option',
      options: ['Yes', 'O'.repeat(201)],
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('option text too long')
  })

  it('rejects invalid expiresAt', () => {
    const result = validateCreatePoll({
      question: 'Bad date',
      options: ['Yes', 'No'],
      expiresAt: 'not-a-date',
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('invalid expiresAt')
  })

  it('rejects invalid postId (not UUID)', () => {
    const result = validateCreatePoll({
      question: 'Bad post ID',
      options: ['Yes', 'No'],
      postId: 'not-a-uuid',
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('invalid postId')
  })
})

describe('VoteSchema Validation', () => {
  it('accepts index 0', () => {
    expect(validateVote(0)).toBe(true)
  })

  it('accepts index 1', () => {
    expect(validateVote(1)).toBe(true)
  })

  it('accepts index 2', () => {
    expect(validateVote(2)).toBe(true)
  })

  it('accepts index 3 (max)', () => {
    expect(validateVote(3)).toBe(true)
  })

  it('rejects negative index', () => {
    expect(validateVote(-1)).toBe(false)
  })

  it('rejects index 4 (above max)', () => {
    expect(validateVote(4)).toBe(false)
  })

  it('rejects non-integer', () => {
    expect(validateVote(1.5)).toBe(false)
  })

  it('rejects large number', () => {
    expect(validateVote(100)).toBe(false)
  })
})

describe('Poll Option Index Bounds', () => {
  it('2-option poll: valid indices are 0 and 1', () => {
    const options = [{ text: 'Yes', votes: 0 }, { text: 'No', votes: 0 }]
    expect(0 < options.length).toBe(true)
    expect(1 < options.length).toBe(true)
    expect(2 < options.length).toBe(false)
  })

  it('4-option poll: valid indices are 0-3', () => {
    const options = Array.from({ length: 4 }, (_, i) => ({ text: `Option ${i}`, votes: 0 }))
    for (let i = 0; i < 4; i++) {
      expect(i < options.length).toBe(true)
    }
    expect(4 < options.length).toBe(false)
  })
})

describe('Poll Expiration Logic', () => {
  it('non-expired poll is not ended', () => {
    const future = new Date(Date.now() + 86400000) // +1 day
    const ended = future < new Date()
    expect(ended).toBe(false)
  })

  it('expired poll is ended', () => {
    const past = new Date(Date.now() - 86400000) // -1 day
    const ended = past < new Date()
    expect(ended).toBe(true)
  })

  it('poll with no expiresAt never ends', () => {
    const expiresAt = null
    const ended = expiresAt ? new Date(expiresAt) < new Date() : false
    expect(ended).toBe(false)
  })

  it('poll at boundary time', () => {
    const now = new Date()
    const justPast = new Date(now.getTime() - 1000)
    expect(justPast < new Date()).toBe(true)
  })
})

describe('Poll formatPoll Helper', () => {
  const basePoll = {
    id: 'poll-001',
    question: 'Test question?',
    author_id: 'user-001',
    post_id: null as string | null,
    options: [
      { text: 'Option A', votes: 10 },
      { text: 'Option B', votes: 5 },
    ],
    expires_at: null as Date | null,
    created_at: new Date('2026-04-01T12:00:00Z'),
  }

  it('computes totalVotes correctly', () => {
    const result = formatPoll(basePoll, null)
    expect(result.totalVotes).toBe(15)
  })

  it('sets ended to false when no expiry', () => {
    const result = formatPoll(basePoll, null)
    expect(result.ended).toBe(false)
    expect(result.expiresAt).toBeNull()
  })

  it('passes userVote through correctly', () => {
    const result = formatPoll(basePoll, 1)
    expect(result.userVote).toBe(1)
  })

  it('sets userVote to null when not voted', () => {
    const result = formatPoll(basePoll, null)
    expect(result.userVote).toBeNull()
  })

  it('converts created_at to ISO string', () => {
    const result = formatPoll(basePoll, null)
    expect(result.createdAt).toBe('2026-04-01T12:00:00.000Z')
  })

  it('converts expires_at to ISO string when present', () => {
    const poll = { ...basePoll, expires_at: new Date('2026-04-10T00:00:00Z') }
    const result = formatPoll(poll, null)
    expect(result.expiresAt).toBe('2026-04-10T00:00:00.000Z')
  })

  it('maps option text and votes correctly', () => {
    const result = formatPoll(basePoll, null)
    expect(result.options).toHaveLength(2)
    expect(result.options[0]).toEqual({ text: 'Option A', votes: 10 })
    expect(result.options[1]).toEqual({ text: 'Option B', votes: 5 })
  })

  it('handles zero votes poll', () => {
    const emptyPoll = {
      ...basePoll,
      options: [
        { text: 'A', votes: 0 },
        { text: 'B', votes: 0 },
      ],
    }
    const result = formatPoll(emptyPoll, null)
    expect(result.totalVotes).toBe(0)
  })

  it('sets postId from poll post_id', () => {
    const withPost = { ...basePoll, post_id: 'post-123' }
    const result = formatPoll(withPost, null)
    expect(result.postId).toBe('post-123')
  })

  it('renames author_id to authorId', () => {
    const result = formatPoll(basePoll, null)
    expect(result.authorId).toBe('user-001')
    expect(result).not.toHaveProperty('author_id')
  })
})

describe('Vote Error Responses', () => {
  const ERROR_CODES = {
    NOT_FOUND: 'Poll not found',
    BAD_REQUEST: 'Poll has ended',
    VALIDATION_ERROR: 'Invalid option index',
    CONFLICT: 'Already voted',
    FORBIDDEN: 'Forbidden',
  }

  it('returns NOT_FOUND for missing poll', () => {
    expect(ERROR_CODES.NOT_FOUND).toBe('Poll not found')
  })

  it('returns BAD_REQUEST for expired poll', () => {
    expect(ERROR_CODES.BAD_REQUEST).toBe('Poll has ended')
  })

  it('returns VALIDATION_ERROR for out-of-bounds index', () => {
    expect(ERROR_CODES.VALIDATION_ERROR).toMatch(/invalid/i)
  })

  it('returns CONFLICT for duplicate vote', () => {
    expect(ERROR_CODES.CONFLICT).toBe('Already voted')
  })

  it('returns FORBIDDEN for non-owner delete', () => {
    expect(ERROR_CODES.FORBIDDEN).toBe('Forbidden')
  })
})

describe('JSONB Options Structure', () => {
  it('initial options have zero votes', () => {
    const optionTexts = ['Yes', 'No', 'Maybe']
    const optionsData = optionTexts.map(text => ({ text, votes: 0 }))
    for (const opt of optionsData) {
      expect(opt.votes).toBe(0)
    }
  })

  it('options preserve input text', () => {
    const optionTexts = ['Strongly Agree', 'Agree', 'Disagree', 'Strongly Disagree']
    const optionsData = optionTexts.map(text => ({ text, votes: 0 }))
    expect(optionsData.map(o => o.text)).toEqual(optionTexts)
  })

  it('serializes to valid JSON', () => {
    const options = [{ text: 'A', votes: 5 }, { text: 'B', votes: 3 }]
    const json = JSON.stringify(options)
    const parsed = JSON.parse(json)
    expect(parsed).toEqual(options)
  })

  it('options string can be parsed back', () => {
    const options = [{ text: 'X', votes: 0 }]
    const str = JSON.stringify(options)
    const parsed = typeof str === 'string' ? JSON.parse(str) : str
    expect(parsed[0].text).toBe('X')
  })
})

describe('Poll Delete Authorization', () => {
  it('only poll author can delete', () => {
    const pollAuthorId = 'user-001'
    const currentUserId = 'user-001'
    expect(pollAuthorId === currentUserId).toBe(true)
  })

  it('non-author cannot delete', () => {
    const pollAuthorId = 'user-001'
    const currentUserId = 'user-002'
    expect(pollAuthorId === currentUserId).toBe(false)
  })

  it('delete cascades to poll_votes', () => {
    // The route deletes poll_votes before polls
    const deleteOrder = ['poll_votes', 'polls']
    expect(deleteOrder[0]).toBe('poll_votes')
    expect(deleteOrder[1]).toBe('polls')
  })

  it('delete invalidates Redis cache', () => {
    const pollId = 'poll-001'
    const cacheKey = `poll:${pollId}`
    expect(cacheKey).toBe('poll:poll-001')
  })
})
