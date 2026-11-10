import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/logger', () => { const l: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }; l.child = () => l; return { logger: l } })

import { extractGeo, withoutEnvoyCountries, withoutNonPlaceNames } from '../../pipeline/geo'
import { actionGeoIsNamed } from '../gdelt'

describe("GDELT stories: the headline's place first (Nov 10, 2026)", () => {
  it("a headline's country beats a city the article names", async () => {
    const title = 'Overnight strikes in Yemen kill at least 1 person and wound 9, and other Mideast news'
    const body = 'Overnight strikes in Yemen killed one. Here is the latest: WASHINGTON — The administration said Monday that Iran'
    const [h, b] = withoutNonPlaceNames(withoutEnvoyCountries(title), withoutEnvoyCountries(body))
    expect((await extractGeo(h, b)).countryCode).toBe('YE')
  })

  it('"alleged Chinese spy" is not China, so GDELT\'s coded China is not confirmed by it', () => {
    const [h, b] = withoutNonPlaceNames('Jensen Huang admits to affair with alleged Chinese spy', '')
    expect(actionGeoIsNamed('CN', `${h} ${b}`)).toBe(false)
  })
})
