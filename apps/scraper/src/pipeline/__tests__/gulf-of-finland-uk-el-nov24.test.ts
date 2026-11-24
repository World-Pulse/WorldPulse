/**
 * Nov 24, 2026 live read: Zelensky's confirmation of the strike on a Russian ship "in the Gulf of Finland" sat at
 * Ukraine in three Ukrainian outlets (Ukrinform had no pin) and a Greek one (tanea); the gulf's name was only known in English.
 */
import { describe, it, expect } from 'vitest'
import { placeFromText } from '../geo'
import { withLocalNames } from '../local-names'

const at = (text: string, lang: string) => placeFromText(withLocalNames(text, lang))

describe('Gulf of Finland in Ukrainian and Greek', () => {
  it('pins the Ukrainian headlines at the gulf', () => {
    for (const t of [
      'Зеленський підтвердив удар по російському судну в Фінській затоці',
      'Зеленський підтвердив, що Україна атакувала російський корабель у Фінській затоці',
    ]) {
      const p = at(t, 'uk')
      expect(p.lat).toBeCloseTo(59.8, 0)
      expect(p.lng).toBeCloseTo(25.0, 0)
    }
  })
  it('pins the Greek headline at the gulf', () => {
    const p = at('Ζελένσκι: Η Ουκρανία πίσω από την επίθεση στο ρωσικό πλοίο «Sparta II» στον Κόλπο της Φινλανδίας', 'el')
    expect(p.lat).toBeCloseTo(59.8, 0)
  })
  it('leaves Finland itself alone', () => {
    expect(at('Вибори у Фінляндії: опозиція перемагає', 'uk').countryCode).toBe('FI')
  })
})
