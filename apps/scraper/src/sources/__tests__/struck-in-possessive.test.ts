/** Nov 25, 2026 (live read): "Ukraine says it struck two oil refineries in Russia's Samara region" sat in Ukraine; the place struck is the story's pin */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { placeFromText, withoutNonPlaceNames, withoutSiteSuffix } = await import('../../pipeline/geo')
const named = (title: string) => placeFromText(withoutNonPlaceNames(withoutSiteSuffix(title), '')[0])

describe('a place struck inside another country', () => {
  it('is the pin, not the country that struck', () => {
    expect(named("Ukraine says it struck two oil refineries in Russia's Samara region").name).toBe('Samara')
    expect(named("Ukraine strikes Russia's Saratov").name).toBe('Saratov')
  })
  it('leaves a country that is only the actor, or a place in the same country', () => {
    expect(named('Ukraine says drones hit Saratov').name).toBe('Ukraine')
    expect(named("Russia says it hit Ukraine's Kharkiv region").name).not.toBe('Russia')
  })
})
