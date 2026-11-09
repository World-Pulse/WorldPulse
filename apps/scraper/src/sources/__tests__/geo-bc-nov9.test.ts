/** "B.C." is British Columbia (Nov 9, 2026: Global News' "Third storm heads for already drenched B.C. coast" had no pin) */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { placeFromText } = await import('../../pipeline/geo')

describe('B.C.', () => {
  it('places Global News\' storm in British Columbia', () => {
    const r = placeFromText('Third storm heads for already drenched B.C. coast')
    expect(r.countryCode).toBe('CA')
    expect(r.name).toBe('British Columbia')
  })
  it('keeps a city before it', () => {
    expect(placeFromText('Fire in Kelowna, B.C., forces evacuations').countryCode).toBe('CA')
  })
  it('leaves the era alone', () => {
    for (const t of ['Tomb dated to 500 B.C. found in Greece', 'A coin from the 3rd century B.C. was unearthed', 'Ruins from about 2000 B.C. discovered']) {
      expect(placeFromText(t).name === 'British Columbia').toBe(false)
    }
  })
})
