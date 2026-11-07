/**
 * A national outlet's story whose headline names no place is pinned at a town or province of its own country that its
 * summary names, before the outlet's home (Nov 7, 2026: of 120 random stories pinned at a spot, 9 sat at the outlet's
 * home though the summary named the town). Never a place abroad (Oct 30, 2026, M57), nor the country itself.
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, inferGeo } from '../news-rss'

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no feed ${id}`)
  return s
}
const at = (id: string, title: string, summary: string) => inferGeo(title, summary, src(id))

describe("a national outlet's own town in its summary", () => {
  it('pins the story there', () => {
    expect(at('windhoek-observer', 'A President who listens: Nandi-Ndaitwah takes government closer to the people',
      'The Swakopmund town hall meeting, facilitated by Erongo Governor Natalia /Goagoses, is a timely demonstration of responsive leadership.'))
      .toMatchObject({ countryCode: 'NA', locationName: 'Swakopmund' })
    expect(at('friday-times-pk', 'Body Of Missing Tourist Bushra Samoi Recovered Four Months After Swat Boat Tragedy',
      'The body of tourist Bushra Samoi, who had gone missing in Lake Saifullah in the tourist area of Kalam in Upper Swat district of Khyber Pakhtunkhwa, was recovered after more than four months near Mahodand Lake.'))
      .toMatchObject({ countryCode: 'PK', locationName: 'Khyber Pakhtunkhwa' })
    expect(at('kbc-ke', 'KPA strengthens workplace safety through first aid competitions',
      'Kenya Ports Authority (KPA) has reaffirmed its commitment to workplace safety and emergency preparedness after hosting the 2026 Mombasa Regional Adults and Links First Aid Competitions at Mbaraki Sports Club.'))
      .toMatchObject({ countryCode: 'KE', locationName: 'Mombasa' })
    expect(at('jamaica-gleaner', 'Siloah Primary gets $1.9m boost from Appleton',
      'Students and teachers at Siloah Primary School in St Elizabeth are to benefit from improved access to drinking water.'))
      .toMatchObject({ countryCode: 'JM', locationName: 'Saint Elizabeth' })
  })

  it('but not a place abroad, the country itself, or the territory its home is written with', () => {
    expect(at('haaretz', 'The opposition has no plan', 'Netanyahu flew to Washington on Sunday to meet the president.').countryCode).toBe('IL')
    expect(at('trinidad-express', 'TSTT raises US$481m',
      'Telecommunications Services of Trinidad and Tobago (TSTT) has raised US$481 million through a dual-currency bond offering.').locationName)
      .toBe(src('trinidad-express').defaultLocation)
    expect(at('guam-daily-post', 'UOG launches fisheries education program, names 1st fellow',
      'The University of Guam is launching a year-round program to teach sustainable fishing practices.').locationName)
      .toBe(src('guam-daily-post').defaultLocation)
  })
})
