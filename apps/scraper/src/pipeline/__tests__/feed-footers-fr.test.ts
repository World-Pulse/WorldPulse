/**
 * WordPress's "appeared first on" footer in the languages the round-3 feeds
 * use, and Radio Ndeke Luka's language switch, aren't part of the story (Oct 20, 2026).
 */
import { describe, it, expect } from 'vitest'
import { cleanSummary } from '../text'

describe('cleanSummary', () => {
  it("removes WordPress's footer in French, Spanish and Portuguese", () => {
    expect(cleanSummary("Le président a nommé un gouvernement. L’article Nouveau gouvernement à Bangui est apparu en premier sur Radio Ndeke Luka."))
      .toBe('Le président a nommé un gouvernement.')
    expect(cleanSummary('El Congreso aprobó la ley. La entrada Ley aprobada se publicó primero en Visión 360.')).toBe('El Congreso aprobó la ley.')
    expect(cleanSummary('O governo anunciou medidas. O post Novas medidas apareceu primeiro em Expresso das Ilhas.')).toBe('O governo anunciou medidas.')
  })

  it("removes Ndeke Luka's language switch, and leaves other text alone", () => {
    expect(cleanSummary('Fr : Sa : Les élections locales auront lieu en décembre.')).toBe('Les élections locales auront lieu en décembre.')
    expect(cleanSummary('Le Fr est une unité de mesure.')).toBe('Le Fr est une unité de mesure.')
  })
})
