/**
 * "Polish", "Spanish" and "Portuguese" are also a verb and languages, so they name a country only before a
 * word like "president" or "government" (Oct 31, 2026: "Polish President Calls Emergency Meeting Over
 * Constitutional Tribunal Crisis" sat at Astana, the outlet's home, because the headline named no country).
 */
import { describe, it, expect } from 'vitest'
import { mentionedCountries } from '../geo'

describe('country adjectives that are also ordinary words', () => {
  it('reads the country when the adjective describes its government or people', () => {
    expect(mentionedCountries('Polish President Calls Emergency Meeting Over Constitutional Tribunal Crisis')).toEqual(['PL'])
    expect(mentionedCountries('Spanish government approves new budget')).toEqual(['ES'])
    expect(mentionedCountries('Portuguese parliament votes on housing law')).toEqual(['PT'])
  })
  it('does not read a country from the verb or the language', () => {
    expect(mentionedCountries('How to polish your CV before you apply')).toEqual([])
    expect(mentionedCountries('Learn Spanish in three months')).toEqual([])
    expect(mentionedCountries('Portuguese cuisine festival opens')).toEqual([])
  })
  it('still reads the plain country names', () => {
    expect(mentionedCountries('Floods hit Poland, Spain and Portugal')).toEqual(expect.arrayContaining(['PL', 'ES', 'PT']))
  })
})
