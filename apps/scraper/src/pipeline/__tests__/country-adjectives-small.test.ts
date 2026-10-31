/**
 * Small countries' own adjectives name them too (Oct 31, 2026, M62): "Botswanan president ...", "Scottish government ..."
 * named no country, so the pin fell to the outlet's home.
 */
import { describe, it, expect } from 'vitest'
import { mentionedCountries } from '../geo'

describe('adjectives of small countries', () => {
  it('reads the country from its adjective', () => {
    const cases: Array<[string, string]> = [
      ['Botswanan president says diamond sales are down', 'BW'],
      ['Djiboutian minister opens new port terminal', 'DJ'],
      ['Basotho workers march in protest', 'LS'],
      ['Seychellois fishermen demand tuna quota', 'SC'],
      ['Cape Verdean president meets union leaders', 'CV'],
      ['Bruneian sultan opens new bridge', 'BN'],
      ['Andorran government approves tax reform', 'AD'],
      ['Sammarinese voters back EU deal', 'SM'],
      ['Greenlandic premier rejects offer', 'GL'],
      ['Scottish government publishes budget', 'GB'],
      ['Monegasque prince attends gala', 'MC'],
      ['Ni-Vanuatu climate envoy speaks at UN', 'VU'],
    ]
    for (const [headline, code] of cases) expect(mentionedCountries(headline)).toEqual([code])
  })
})
