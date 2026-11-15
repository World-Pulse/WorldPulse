/** Nov 15, 2026 (live read): "2027: Like Lagos, NDC campaign attacked in Kano" sat at Lagos; a place named to compare is not the story's place */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { placeFromText, withoutNonPlaceNames, withoutSiteSuffix } = await import('../../pipeline/geo')
const named = (title: string) => placeFromText(withoutNonPlaceNames(withoutSiteSuffix(title), '')[0])

describe('a place named to compare', () => {
  it('does not take the pin from the place the story is in', () => {
    expect(named('2027: Like Lagos, NDC campaign attacked in Kano').name).toBe('Kano')
    expect(named('Unlike Nairobi, Mombasa has no ferry').name).toBe('Mombasa')
    expect(named('Like in Lagos, protests hit Kano').name).toBe('Kano')
  })
  it('leaves a place that is not a comparison', () => {
    expect(named('Floods in Lagos leave thousands homeless').name).toBe('Lagos')
    expect(named('Lagos is like Kano, officials say').name).toBe('Lagos')
  })
})
