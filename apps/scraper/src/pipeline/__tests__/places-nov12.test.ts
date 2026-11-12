/**
 * Nov 12, 2026: Haiti's central bank posts its daily rate as "Taux de référence de la BRH" with no place word; one post was
 * pinned in the United States while the same post saying "Haïti" sat in Haiti.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { placeFromText } from '../geo'
import { withLocalNames } from '../local-names'

const inLanguage = (text: string, language: string) => placeFromText(withLocalNames(text, language)).countryCode ?? null

describe('Haiti\'s central bank in French', () => {
  it('reads the BRH as Haiti', () => {
    expect(inLanguage('Taux de référence de la BRH pour le 12 novembre 2026', 'fr')).toBe('HT')
    expect(inLanguage('Haïti – Taux de référence BRH : jeudi 12 novembre 2026', 'fr')).toBe('HT')
  })
  it('leaves other words alone', () => {
    expect(inLanguage('Le tournoi de BRHX commence', 'fr')).toBeNull()
  })
})
