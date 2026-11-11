/** Northern Ireland is a place (Nov 11, 2026: a hoax email to its schools sat in Scotland) */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { placeFromText } = await import('../../pipeline/geo')

describe('Northern Ireland', () => {
  it('pins it in the UK, not Ireland', () => {
    for (const t of ['Northern Ireland schools hit by hoax email', 'Police in Northern Ireland arrest man']) {
      const r = placeFromText(t)
      expect(r.countryCode).toBe('GB')
      expect(r.name).toBe('Northern Ireland')
    }
  })
  it('keeps Dublin in Ireland and Belfast in the UK', () => {
    expect(placeFromText('Dublin hoax email to Irish schools').countryCode).toBe('IE')
    expect(placeFromText('Stormont talks resume in Belfast').countryCode).toBe('GB')
  })
})
