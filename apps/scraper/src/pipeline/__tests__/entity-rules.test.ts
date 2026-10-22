/**
 * Knowledge Graph entities by rules (plan 0s, Oct 11, 2026): 21,100 of 23,079
 * entities were "places" ("April", "Petroleum Products", "Trump"), people kept
 * their titles ("President Donald Trump") and "UN" matched inside "FUND".
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ pgPool: { query: vi.fn() }, db: vi.fn() }))

import { extractEntitiesByRules, cleanStoredEntity, canonicalPerson, morePlacesInText } from '../entity-rules'
import { planEntityCleanup, refinePlace } from '../entity-cleanup'
import { entityId } from '../entity-graph'
import { morePlacesFor } from '../entity-places-backfill'

const names = (title: string, body: string | null = null, type?: string) =>
  extractEntitiesByRules(title, body).filter(e => !type || e.type === type).map(e => e.name)

describe('people', () => {
  it('drops titles and keeps whole names', () => {
    expect(names('Prime Minister Keir Starmer meets President Donald Trump in Washington', null, 'person'))
      .toEqual(['Keir Starmer', 'Donald Trump'])
    expect(names('President Bola Ahmed Tinubu Signs 2027 Budget Into Law', null, 'person')).toEqual(['Bola Tinubu'])
    expect(names('Former President Park Geun-hye pardoned', null, 'person')).toEqual(['Park Geun-hye'])
  })

  it('knows well-known people by surname alone', () => {
    expect(names('Trump says Zelensky should step aside', null, 'person')).toEqual(['Donald Trump', 'Volodymyr Zelensky'])
  })

  it('takes no job titles or headline verbs for names', () => {
    expect(names('Chief Executive Officer resigns after audit', null, 'person')).toEqual([])
    expect(names('Secretary Kennedy Appoints New Vaccine Panel', null, 'person')).toEqual([])
    expect(canonicalPerson('Former Australian')).toBeNull()
  })
})

describe('organisations, places and things', () => {
  it('reads acronyms as whole words, not in shouted headlines', () => {
    expect(names('WHO warns of cholera in Sudan', null, 'organisation')).toEqual(['WHO'])
    expect(names('WHO WILL PAY FOR THE WAR?', null, 'organisation')).toEqual([])
    expect(names('Pension FUND posts record returns', null, 'organisation')).toEqual([])
    expect(names('Houthi attack on Saudi airport kills 12', null, 'organisation')).toEqual(['Houthis'])
  })

  it('takes places from the gazetteer and country list, and no junk words', () => {
    expect(names('Exports of petroleum products from Nigeria rose in April', null, 'location')).toEqual(['Nigeria'])
    expect(names('Houthi attack on Saudi airport kills 12', null, 'location')).toEqual(['Saudi Arabia'])
  })

  it('takes the cities, capitals and states the gazetteer lacks, where the words around say it is the place', () => {
    expect(names('Bandits kill driver, two passengers on Sokoto road', null, 'location')).toEqual(['Sokoto'])
    expect(names('Ogun offers jobs to 52 newly inducted nurses', 'The Ogun State government has offered jobs.', 'location')).toEqual(['Ogun'])
    expect(names('Ruto attends the 25th COMESA summit in Harare', null, 'location')).toEqual(['Harare'])
    expect(names('2 killed in attack on airport in Dammam, Saudi Arabia', null, 'location')).toEqual(['Saudi Arabia', 'Dammam'])
    expect(names('Lluvias intensas inundan calles de Medellin', null, 'location')).toEqual(['Medellín'])
    expect(names('Floods Hit Piura, Killing Five As Rains Continue', null, 'location')).toEqual(['Piura'])
    expect(names("Clashes in Nigeria's Kano after the vote", null, 'location')).toEqual(['Nigeria', 'Kano'])
  })

  it('leaves a city alone in a name, a club, a newspaper, an acronym or a common word', () => {
    expect(morePlacesInText('Santiago Peña meets business leaders', null)).toEqual([])
    expect(morePlacesInText('Real Madrid beat RB Leipzig 4-1 in the Champions League', null)).toEqual([])
    expect(morePlacesInText('Kano Pillars sign a new striker', null)).toEqual([])
    expect(morePlacesInText('Floods recede, the Kathmandu Post reported on Monday', null)).toEqual([])
    expect(morePlacesInText('The IMO said ships must report the incident', null)).toEqual([])
    expect(morePlacesInText('Para el gobierno, la medida es necesaria', null)).toEqual([])
    expect(morePlacesInText('Brent crude tops $112 as gas prices stay high', null)).toEqual([])
    expect(morePlacesInText('Lewis Hamilton wins in Austin', null)).toEqual([])
  })

  it('gives an older report the places it names, beyond the ones it has (the one-off backfill)', () => {
    expect(morePlacesFor({ title: '2 killed in attack on airport in Dammam, Saudi Arabia', summary: null })).toEqual(['Dammam'])
    expect(morePlacesFor({ title: 'Oil prices rise', summary: null })).toEqual([])
  })

  it('counts one place once', () => {
    expect(morePlacesInText('Rents soar in New York City', null, ['New York'])).toEqual([])
    expect(morePlacesInText('Protest in Guatemala City', null, ['Guatemala'])).toEqual([])
    expect(morePlacesInText('Kano, Kaduna and Zaria get a new highway as Kano celebrates', null)).toEqual(['Kano', 'Kaduna', 'Zaria'])
  })

  it('finds commodities, and not in a sports medal', () => {
    expect(names('Exports of petroleum products from Nigeria rose in April', null, 'commodity')).toEqual(['Petroleum products'])
    expect(names('Gold prices hit a record as the dollar slides', null, 'commodity')).toEqual(['Gold'])
    expect(names('Kenya wins Olympic gold medal in the marathon', null, 'commodity')).toEqual([])
  })
})

describe('cleanStoredEntity', () => {
  it('cleans people', () => {
    expect(cleanStoredEntity('person', 'President Donald Trump')).toEqual({ type: 'person', name: 'Donald Trump' })
    expect(cleanStoredEntity('person', 'PM Keir Starmer')).toEqual({ type: 'person', name: 'Keir Starmer' })
    expect(cleanStoredEntity('person', 'President Bola Ahmed')).toEqual({ type: 'person', name: 'Bola Tinubu' })
    expect(cleanStoredEntity('person', 'Director General Tedros')).toEqual({ type: 'person', name: 'Tedros Adhanom Ghebreyesus' })
    expect(cleanStoredEntity('person', 'Chief Executive Officer')).toBeNull()
    expect(cleanStoredEntity('person', 'Chief Election Commissioner')).toBeNull()
    expect(cleanStoredEntity('person', 'PM Former Australian')).toBeNull()
    expect(cleanStoredEntity('person', 'President To Lam')).toEqual({ type: 'person', name: 'Tô Lâm' })
  })

  it('cleans places', () => {
    for (const junk of ['April', 'County', 'Trump', 'Israeli', 'Source']) expect(cleanStoredEntity('location', junk)).toBeNull()
    expect(cleanStoredEntity('location', 'Petroleum Products')).toEqual({ type: 'commodity', name: 'Petroleum products' })
    expect(cleanStoredEntity('location', 'Iron Ore')).toEqual({ type: 'commodity', name: 'Iron ore' })
    expect(cleanStoredEntity('location', 'Semiconductors')).toEqual({ type: 'technology', name: 'Semiconductors' })
    expect(cleanStoredEntity('location', 'Panama')).toEqual({ type: 'location', name: 'Panama' })
  })

  it('names the African Union in full', () => {
    expect(cleanStoredEntity('organisation', 'AU')).toEqual({ type: 'organisation', name: 'African Union' })
    expect(cleanStoredEntity('organisation', 'UN')).toEqual({ type: 'organisation', name: 'UN' })
  })
})

describe('planEntityCleanup', () => {
  const row = (type: string, name: string, mentions: number, signals: string[] = []) => ({
    id: entityId(type as never, name), type, canonical_name: name, aliases: [name], mention_count: mentions,
    signal_ids: signals, first_seen: '2026-05-01T00:00:00Z', last_seen: '2026-10-11T00:00:00Z', metadata: {},
  })

  it('merges, retypes, renames and deletes; clean entities stay as they are', () => {
    const rows = [
      row('person', 'President Donald Trump', 1671, ['s1']),
      row('person', 'Minister Keir Starmer', 188, ['s2']),
      row('person', 'PM Keir Starmer', 40, ['s3']),
      row('location', 'April', 614),
      row('location', 'Petroleum Products', 1927),
      row('location', 'Panama', 5),
    ]
    const { upserts, deletes, totals } = planEntityCleanup(rows)
    const byName = Object.fromEntries(upserts.map(u => [u.name, u]))
    expect(Object.keys(byName).sort()).toEqual(['Donald Trump', 'Keir Starmer', 'Petroleum products'])
    expect(byName['Keir Starmer']!.members).toHaveLength(2)
    expect(byName['Petroleum products']!.type).toBe('commodity')
    expect(deletes).toHaveLength(5)                                  // April, and the old ids of the four changed
    expect(deletes).not.toContain(rows[5]!.id)
    expect(totals).toEqual({ merged: 1, removed: 1, retyped: 1, renamed: 1 })

    // a second run finds nothing to do
    const clean = [row('person', 'Donald Trump', 1671), row('commodity', 'Petroleum products', 1927), row('location', 'Panama', 5)]
    expect(planEntityCleanup(clean).upserts).toHaveLength(0)
    expect(planEntityCleanup(clean).deletes).toHaveLength(0)
  })
})

describe('refinePlace', () => {
  it('folds a known place out of GDELT label junk, drops rare unknown names, keeps common ones', () => {
    expect(refinePlace('France Consultation', 300)).toEqual({ type: 'location', name: 'France' })
    expect(refinePlace('United Kingdom Public', 40)).toEqual({ type: 'location', name: 'United Kingdom' })
    expect(refinePlace('Pleasant Valley Road', 3)).toBeNull()
    expect(refinePlace('Topeka', 157)).toEqual({ type: 'location', name: 'Topeka' })
    expect(refinePlace('Panama', 5)).toEqual({ type: 'location', name: 'Panama' })
  })
})
