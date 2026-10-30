/**
 * Places that are also people's names (plan 0s5, Oct 22, 2026): the gazetteer
 * read "Santiago Peña" (Paraguay's president) as Santiago, Chile, and pinned
 * him there; "Paris Hilton", "Sydney Sweeney" and "Houston Rockets" the same.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ pgPool: { query: vi.fn() }, db: vi.fn() }))

import { partOfAName, titleCaseAround } from '../place-words'
import { placesInText, placeFromText, findGazetteerPlace, splitPlaces } from '../geo'

const at = (text: string, name: string) => { const i = text.indexOf(name); return partOfAName(text, i, i + name.length) }

describe('a place that is part of a name', () => {
  it('reads first names, surnames and clubs as names', () => {
    expect(at('Santiago Peña meets business leaders', 'Santiago')).toBe(true)
    expect(at('President Santiago Peña visits Brazil', 'Santiago')).toBe(true)
    expect(at('Paris Hilton reveals her new album', 'Paris')).toBe(true)
    expect(at('Houston Rockets beat the Lakers', 'Houston')).toBe(true)
    expect(at('Fans mourn Whitney Houston on her birthday', 'Houston')).toBe(true)
    expect(at('Manchester United head coach Michael Carrick', 'Manchester')).toBe(true)
    expect(at('Real Madrid beat Leipzig', 'Madrid')).toBe(true)
  })

  it('keeps the place in its own story, after a sentence start, a party or a nationality, and in a Title Case headline', () => {
    expect(at('One more person arrested in connection with Kolkata Durga Puja stampede', 'Kolkata')).toBe(false)
    expect(at('Workers treated at Dhaka Medical College Hospital', 'Dhaka')).toBe(false)
    expect(at('Top Democratic Virginia lawmaker charged', 'Virginia')).toBe(false)
    expect(at('Feds charge powerful Virginia Democrat', 'Virginia')).toBe(false)
    expect(at('As Houston braces for the storm, schools close', 'Houston')).toBe(false)
    expect(at('Russian forces hit Kyiv as Moscow talks stall', 'Moscow')).toBe(false)
    expect(at('Paris Police Ban Protests After Night Of Riots', 'Paris')).toBe(false)
    expect(at('Floods hit Sydney suburbs', 'Sydney')).toBe(false)
    expect(at('paris hilton', 'paris')).toBe(false)
    expect(titleCaseAround('Athens Explosion Puzzles Police as Three Scenarios Emerge', 0, 6)).toBe(true)
  })

  it('reads the Colorado party as a party, not the US state', () => {
    expect(findGazetteerPlace('Hugo Velázquez inscribió Fuerza Republicana ante el TEP de ANR. Dirigente colorado')).toBeNull()
    expect(findGazetteerPlace('Cartes lidera el Partido Colorado')).toBeNull()
    expect(findGazetteerPlace('Wildfire near Denver, Colorado forces evacuations')?.place).toBe('denver')
    expect(findGazetteerPlace('Snow closes roads across Colorado')?.place).toBe('colorado')
  })

  it('takes them out of the map pin, the places and the countries', () => {
    expect(placesInText('Santiago Peña meets business leaders in Asunción')).not.toContain('Santiago')
    expect(placeFromText('Paris Hilton reveals her new album').name ?? null).toBeNull()
    expect(findGazetteerPlace('Sydney Sweeney stuns at premiere')).toBeNull()
    expect(splitPlaces('Houston Rockets beat the Lakers').countries).toEqual([])
    expect(findGazetteerPlace('Floods hit Sydney suburbs')?.place).toBe('sydney')
    expect(placesInText('One more person arrested in connection with Kolkata Durga Puja stampede')).toEqual(['Kolkata'])
  })
})
