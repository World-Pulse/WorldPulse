/**
 * The map's coverage, Nov 6, 2026, night (Devon: "just focus on more coverage and better accuracy"): each country's
 * 600 largest towns, no longer 60 (Kalaburagi, Shivamogga and Surat in India; Handan and Yangzhou in China), and the
 * big cities looked at by hand that a world outlet couldn't place (scripts/places/make_gazetteer.py's
 * READ_EVERYWHERE). Each case is a story of the day's 13,761 and 2,671 GDELT ones, or one the changes were checked on.
 */

import { describe, it, expect } from 'vitest'
import { NEWS_SOURCE_REGISTRY, inferGeo } from '../../sources/news-rss'
import { placeFromText, homePlaceFromText } from '../geo'

const src = (id: string) => {
  const s = NEWS_SOURCE_REGISTRY.find(x => x.id === id)
  if (!s) throw new Error(`no feed ${id}`)
  return s
}
const at = (id: string, title: string, summary = '') => inferGeo(title, summary, src(id))
const country = (text: string) => placeFromText(text).countryCode ?? null
const home = (text: string, cc: string) => homePlaceFromText(text, cc)?.countryCode ?? null

describe("towns beyond a country's 60 largest", () => {
  it('are on the map', () => {
    expect(at('the-hindu-national', 'Nursing student dies after falling from hostel building in Kalaburagi').locationName).toBe('Kalaburagi')
    expect(at('the-hindu-national', 'Flight operations at Shivamogga Airport unlikely from November 21').locationName).toBe('Shivamogga')
    expect(country('Farmer bought land at less than stamp duty value, got income tax notice in Surat')).toBe('IN')
    expect(country('Floods in Handan and Yangzhou')).toBe('CN')
    expect(country('Groundbreaking on Kennewick VA clinic to bring veterans closer to care')).toBe('US')
  })

  it('but not one named like a person, at home or abroad', () => {
    expect(country("Jude Bellingham's brother Jobe gets England call-up")).not.toBe('US')
    expect(home("Jude Bellingham's brother Jobe gets England call-up", 'US')).toBeNull()
    expect(home('The Poems That Made Emily Dickinson A Literary Icon', 'US')).toBeNull()
  })
})

describe('big cities looked at by hand', () => {
  it('are read everywhere', () => {
    expect(country('Boston climate activist faces felony conviction over State House protest')).toBe('US')
    expect(country('Councilmember Michael D. Crain, United Way and the Junior League of Fort Worth')).toBe('US')
    expect(country('Floods hit Kobe')).toBe('JP')
    expect(country('Drone debris falls on Samara refinery')).toBe('RU')
    expect(country('Cartagena de Indias summit opens')).toBe('CO')
    expect(placeFromText('Kansas City man gets answers after AT&T iPad scam')).toMatchObject({ name: 'Kansas City', region: 'Missouri' })
    expect(placeFromText('Floods in Vila Velha').lat).toBeLessThan(-20)     // Espírito Santo's, not Amapá's
  })

  it("not when it's a person, a company or a team", () => {
    expect(country("Kobe Bryant's daughter signs with UCLA")).toBeNull()
    expect(country('Samara Weaving joins the cast')).toBeNull()
    expect(country('Boston Celtics beat the Knicks')).toBeNull()
    expect(country('S&P revises Boston Scientific outlook to negative')).toBeNull()
    expect(country('Stelco owner Cleveland-Cliffs cuts jobs')).toBeNull()
    expect(home('Bristol-Myers Squibb shares fell', 'GB')).toBeNull()
  })

  it("leaves a namesake's own outlets their own town", () => {
    expect(at('sur-in-english', 'Navy exercise off Cartagena draws crowds').countryCode).toBe('ES')
  })
})

describe('a person, not the place', () => {
  it('after a title or a given name, even at a headline\'s start or in Title Case', () => {
    expect(home('Princess Charlotte turns 11 today', 'US')).toBeNull()
    expect(home('Dr Austin Demby commissions upgraded health centre', 'US')).toBeNull()
    expect(home('Joaquin Phoenix stars in new film', 'US')).toBeNull()
    expect(home('Lewis Hamilton will celebrate his 400th Formula One start', 'CA')).toBeNull()
    expect(home('Flooding in Charlotte', 'US')).toBe('US')
    expect(home('Heat wave grips Phoenix', 'US')).toBe('US')
  })

  it('but a campus after an acronym is the place', () => {
    expect(country('Researchers at UC Irvine found a new antibiotic')).toBe('US')
  })
})

describe('no place at all', () => {
  it('a ship, the northern lights, a permanent secretary', () => {
    expect(at('antara-en', 'Indonesia, US navies honor USS Houston in joint dive').countryCode).toBe('ID')
    expect(home('The Aurora Borealis May Appear In 10 States', 'US')).toBeNull()
    expect(country('Perm Sec says 10 vehicles were delivered')).not.toBe('RU')
  })

  it('a country around a city\'s name, a word in Malay and Indonesian', () => {
    expect(country("El Salvador's president Nayib Bukele said")).toBe('SV')
    expect(country('Pemerintah Kota Surabaya umumkan banjir')).toBe('ID')
  })
})

describe('a longer name read in part before', () => {
  it('is read whole', () => {
    expect(at('actualite-cd', 'Kasaï-Oriental : décès d’Alphonse Muela Kankonda').locationName).toBe('Kasaï-Oriental')
    expect(placeFromText('Rival Forces Dispute Control of North Kordofan Areas').name).toBe('North Kordofan')
  })
})
