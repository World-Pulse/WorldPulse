import { describe, it, expect } from 'vitest'
import { isListedCountry } from '../country-list'

describe('isListedCountry (sitemap and /countries, H-0023)', () => {
  it('keeps real countries the API names', () => {
    expect(isListedCountry({ code: 'NG', name: 'Nigeria' })).toBe(true)
    expect(isListedCountry({ code: 'ie', name: 'Ireland' })).toBe(true)
  })
  it('leaves out placeholders, repeats and codes the API only knows as letters', () => {
    expect(isListedCountry({ code: 'UK', name: 'United Kingdom' })).toBe(false)
    expect(isListedCountry({ code: 'ZZ', name: 'Unknown' })).toBe(false)
    expect(isListedCountry({ code: 'EI', name: 'EI' })).toBe(false)
    expect(isListedCountry({ code: 'NGA', name: 'Nigeria' })).toBe(false)
    expect(isListedCountry({ code: 'US' })).toBe(false)
  })
})
