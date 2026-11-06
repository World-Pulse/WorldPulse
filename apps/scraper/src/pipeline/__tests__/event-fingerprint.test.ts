/**
 * The cross-source dedup's event fingerprint (dedup.ts) reads Arabic and Cyrillic headlines (Nov 6, 2026): with Latin
 * letters only, every Arabic or Russian headline had the same fingerprint, its category alone, and after the first one
 * each six hours the others were thrown away as its duplicates.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis.js', () => ({ redis: {} }))
const { eventFingerprint } = await import('../dedup.js')

describe('eventFingerprint', () => {
  it('tells Arabic and Russian headlines apart', () => {
    expect(eventFingerprint('الاتحاد الأوروبي يدين العمل الإرهابي الذي أسفر عن استشهاد السلايطة', 'geopolitics'))
      .not.toBe(eventFingerprint('احتراق شاحنة على طريق رأس النقب باتجاه العقبة', 'geopolitics'))
    expect(eventFingerprint('В Бишкеке задержан подозреваемый в краже', 'geopolitics'))
      .not.toBe(eventFingerprint('Число выдворенных из России мигрантов выросло в полтора раза', 'geopolitics'))
    // and neither is the bare category's
    expect(eventFingerprint('Число выдворенных из России мигрантов выросло в полтора раза', 'geopolitics'))
      .not.toBe(eventFingerprint('', 'geopolitics'))
  })

  it('still gives one fingerprint to one headline, with its vowel marks or without', () => {
    expect(eventFingerprint('أمن الأردن مسؤولية الجميع', 'geopolitics')).toBe(eventFingerprint('أَمْنُ الأُرْدُنِّ مَسْؤُولِيَّةُ الجَمِيعِ', 'geopolitics'))
  })

  it('reads Latin headlines as before', () => {
    // the old rule: only a-z, 0-9 and spaces kept, words over 2 letters, English stop words out, sorted, the first 5
    expect(eventFingerprint('Bulgaria seeks suspects in Germany after Starlink sabotage', 'politics'))
      .toBe(eventFingerprint('bulgaria SEEKS suspects in germany after starlink sabotage!', 'politics'))
    expect(eventFingerprint('Sécurité : une délégation du Sultanat', 'geopolitics')).toBe(eventFingerprint('Scurit une dlgation du Sultanat', 'geopolitics'))
  })
})
