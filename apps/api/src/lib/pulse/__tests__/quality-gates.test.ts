import { describe, it, expect } from 'vitest'
import { bodyProblem, flashBriefProblem, sentenceCount } from '../quality-gates'

const GOOD = 'Rescue teams reached two villages near Aleppo early Tuesday after the quake, according to 4 independent outlets. At least 40 are confirmed dead. Watch for aid convoys at the Bab al-Hawa crossing.'

describe('PULSE quality gates', () => {
  it('passes a plain, sourced flash brief', () => {
    expect(flashBriefProblem(GOOD)).toBeNull()
  })

  it.each([
    ['In a developing story, a quake hit Aleppo; 4 outlets report.', 'in a developing story'],
    ['A quake hit Aleppo, per 4 outlets. Only time will tell.', 'only time will tell'],
    ['A quake reportedly hit Aleppo, per 4 outlets.', 'reportedly'],
    ['A shocking quake hit Aleppo, per 4 outlets.', 'shocking'],
  ])('refuses banned filler: %s', (text, phrase) => {
    expect(bodyProblem(text)).toContain(phrase)
  })

  it('refuses exclamation marks, placeholders and AI leftovers', () => {
    expect(bodyProblem('A quake hit Aleppo!')).toBe('exclamation mark')
    expect(bodyProblem('A quake hit [LOCATION], per 4 outlets.')).toBe('placeholder or AI leftover')
    expect(bodyProblem('Casualties: N/A')).toBe('placeholder or AI leftover')
    expect(bodyProblem('As an AI, I cannot confirm.')).toBe('placeholder or AI leftover')
    expect(bodyProblem('Certainly, here you go.')).toBe('placeholder or AI leftover')
  })

  it('caps a flash brief at 3 sentences and 400 characters', () => {
    expect(flashBriefProblem('One. Two. Three. Four, per 3 sources.')).toBe('more than 3 sentences')
    expect(flashBriefProblem(`${'word '.repeat(90)}per 3 sources.`)).toBe('over 400 characters')
  })

  it('counts a decimal or an abbreviation as part of its sentence', () => {
    expect(sentenceCount('Reliability is 0.7 per U.S. officials. Watch the border.')).toBe(2)
  })

  it('wants a source line', () => {
    expect(flashBriefProblem('A quake hit Aleppo early Tuesday. Watch the border.')).toBe('no source line (outlet count or kind of source)')
    expect(flashBriefProblem('A quake hit Aleppo early Tuesday, per wire reports.')).toBeNull()
    expect(flashBriefProblem('A quake hit Aleppo, according to three outlets.')).toBeNull()
  })

  it('refuses a markdown heading', () => {
    expect(flashBriefProblem('## Quake\nHit Aleppo, per 3 sources.')).toBe('markdown heading in a flash brief')
  })
})
