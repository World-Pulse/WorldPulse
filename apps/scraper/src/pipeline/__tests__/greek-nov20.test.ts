import { describe, it, expect } from 'vitest'
import { placeFromText } from '../geo'
import { withLocalNames } from '../local-names'

const el = (t: string) => placeFromText(withLocalNames(t, 'el')).countryCode ?? null

describe('Greek names, round 2 (Nov 20, 2026)', () => {
  it('pins by the country the story is about', () => {
    expect(el('Γουατεμάλα: Συνελήφθησαν δύο καταζητούμενοι από τις ΗΠΑ για διακίνηση φαιντανύλης')).toBe('GT')
    expect(el('Υεμένη: Καταγγελία των Χούθι για επίθεση της Σαουδικής Αραβίας σε πλοίο με 19 νεκρούς')).toBe('YE')
    expect(el('Σοβαρές πλημμύρες σε Λος Άντζελες και Σαν Φρανσίσκο από καταιγίδα')).toBe('US')
    expect(el('Συνάντηση στη Βηρυτό για την κατάπαυση του πυρός')).toBe('LB')
  })
  it('leaves everyday words alone', () => {
    expect(withLocalNames('Ο κουβάς και ο καιρός', 'el')).toBe('Ο κουβας και ο καιρος')
  })
})
