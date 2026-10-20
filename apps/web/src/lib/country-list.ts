/**
 * Which entries of the API's country list are real countries with a page of
 * their own (used by the sitemap and the /countries index, H-0023, Oct 20, 2026).
 */

export interface ListedCountry { code: string; name?: string; latest_signal_at?: string | null }

/** Codes the API counts signals under that are not a country of their own: UK repeats GB, ZZ and the rest are placeholders */
const NOT_A_COUNTRY = new Set(['UK', 'ZZ', 'EU', 'UN'])

/** A real country: a two-letter code the API knows by name (it falls back to the code itself for strays) */
export function isListedCountry(c: ListedCountry): boolean {
  if (!c || typeof c.code !== 'string' || !/^[A-Za-z]{2}$/.test(c.code)) return false
  const code = c.code.toUpperCase()
  return !NOT_A_COUNTRY.has(code) && typeof c.name === 'string' && c.name.length > 0 && c.name.toUpperCase() !== code
}
