/** Nov 15, 2026 (H-0051): leaders arriving for a summit are the host's story, not their own countries' */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { placeFromText, withoutNonPlaceNames, withoutSiteSuffix } = await import('../../pipeline/geo')
const named = (title: string) => placeFromText(withoutNonPlaceNames(withoutSiteSuffix(title), '')[0])

describe('visiting leaders', () => {
  it('are not their own countries\' place', () => {
    expect(named('Lao, Vietnamese PMs arrive in PH for ASEAN Summit').countryCode ?? null).toBeNull()
    expect(named('Lao and Vietnam PMs arrive in PH for 49th ASEAN Summit').countryCode ?? null).toBeNull()
  })
  it('leave the host when it is named', () => {
    expect(named('Thai PM arrives in Manila for ASEAN summit').countryCode).toBe('PH')
    expect(named('Vietnam PM lands in Manila').name).toBe('Manila')
  })
  it('leave a leader\'s own story in their country', () => {
    expect(named('Vietnam PM hails record exports').countryCode).toBe('VN')
    expect(named('Thai PM heads to polls as coalition splits').countryCode).toBe('TH')
    expect(named('Vietnam president arrives home to cheering crowds').countryCode).toBe('VN')
  })
})
