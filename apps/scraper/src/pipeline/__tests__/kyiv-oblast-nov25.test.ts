/**
 * Nov 25, 2026 (H-0069): "Russian Strike on Dymer" (Novinite) sat at Moscow, because Dymer, a town in Kyiv oblast, was
 * not in the gazetteer and the attacker was the only country named. Towns of Kyiv oblast and the front now pin in Ukraine.
 */
import { describe, it, expect } from 'vitest'
import { findGazetteerPlace } from '../geo'

describe('Ukrainian towns', () => {
  for (const [text, name] of [
    ['Russian strike on Dymer kills two', 'Dymer'],
    ['Drones hit Boryspil and Vyshhorod overnight', 'Boryspil'],
    ['Shelling of Nova Kakhovka injures five', 'Nova Kakhovka'],
    ['Russian missile hits Kryvyi Rih', 'Kryvyi Rih'],
    ['Attack on Vovchansk repelled', 'Vovchansk'],
  ] as const) {
    it(`pins ${name} in Ukraine`, () => {
      const p = findGazetteerPlace(text)
      expect(p?.coords.country).toBe('UA')
    })
  }
})
