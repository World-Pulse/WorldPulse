import { describe, it, expect } from 'vitest'
import { plainSummary } from '../../components/signals/AISummary'

describe('plainSummary', () => {
  it('drops the heading and markdown stars', () => {
    expect(plainSummary('**PULSE Summary:**\n\nHouthi rebels attacked King Khalid International Airport.'))
      .toBe('Houthi rebels attacked King Khalid International Airport.')
    expect(plainSummary('A **major** quake struck Panama.')).toBe('A major quake struck Panama.')
    expect(plainSummary('Talks resumed in Geneva.')).toBe('Talks resumed in Geneva.')
  })
})
