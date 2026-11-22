/**
 * The story tour of the daily video (Nov 22, 2026; Devon on Grok's read of the video: "it should be 1, 2, and 3"):
 * the video opens on the day's most-reported story and visits the top stories in turn, each with an English
 * headline, its subject and country, and how many outlets and countries carry it.
 */
import { describe, it, expect } from 'vitest'
import { isEnglishHeadline, pickTourStories, trustLine, storyTag, tourIndexAt, TOUR_STORIES_MAX, type DayStory, type TourSignal } from '../map-play'

const story = (over: Partial<DayStory>): DayStory => ({
  id: 's1', title: 'Mexico captures a cartel leader in a string of arrests', outlets: 100, countries: 30,
  category: 'conflict', country: 'MX', severity: 'high', firstSeenAt: '2026-11-21T05:57:00Z', verifiedAt: '2026-11-21T06:04:00Z', ...over,
})
const report = (over: Partial<TourSignal>): TourSignal => ({
  id: 'r1', story: 's1', lat: 19.43, lng: -99.13, title: 'Mexico captures a cartel leader', severity: 'high', status: 'verified', is_breaking: false, ...over,
})

describe('isEnglishHeadline', () => {
  it('takes English headlines, names from other languages included', () => {
    for (const t of [
      'Mexico captures ‘El Chapo Isidro’ in string of arrests', 'Magnitude 6.7 earthquake strikes southern Peru',
      'von der Leyen says EU will act on tariffs soon', 'Al Jazeera journalist killed in Gaza strike',
      'Dozens drown as boat capsizes in Nigeria en route to funeral', 'Dozens Missing After Indonesia Candy Factory Fire',
    ]) expect(isEnglishHeadline(t), t).toBe(true)
  })

  it("leaves out other languages' headlines (the video's Spanish top stories of Nov 22)", () => {
    for (const t of [
      'México capturó a El Chapo Isidro, uno de los fugitivos más buscados por EE.UU.',
      'Al menos 15 heridos deja sismo de magnitud 6,7 en Perú', 'Governo Lula reconhece calamidade em Tupanciretã, no Rio Grande do Sul',
      'Kebakaran Pabrik Permen di Serang: 50 Karyawan Hilang', 'Le président Macron en visite au Maroc cette semaine',
      'முசிறி அருகே கோர விபத்து: ஆம்னி வேன் மரத்தில் மோதி', 'short',
    ]) expect(isEnglishHeadline(t), t).toBe(false)
  })
})

describe('pickTourStories', () => {
  it('the most outlets first, each at its best report, verified, of a kept subject, at most five', () => {
    const stories = Array.from({ length: 8 }, (_, i) => story({ id: `s${i}`, outlets: 10 + i, title: `Story number ${i} reported by the outlets`, country: 'FR' }))
    const buckets = [{ signals: stories.map((s, i) => report({ id: `r${i}`, story: s.id, lat: i * 10, lng: i * 10 + 1, title: s.title })) }]
    const picked = pickTourStories(stories, buckets)
    expect(picked.map(s => s.id)).toEqual(['s7', 's6', 's5', 's4', 's3'])
    expect(picked).toHaveLength(TOUR_STORIES_MAX)
    expect(picked[0]).toMatchObject({ lat: 70, lng: 71, outlets: 17 })
  })

  it("an English report's headline when the story's own isn't English, and no story without one", () => {
    const stories = [
      story({ id: 'a', title: 'México capturó a El Chapo Isidro, uno de los fugitivos más buscados por EE.UU.', outlets: 90 }),
      story({ id: 'b', title: 'Al menos 15 heridos deja sismo de magnitud 6,7 en Perú', outlets: 60, country: 'PE' }),
    ]
    const buckets = [{ signals: [
      report({ id: 'a1', story: 'a', title: 'México capturó a El Chapo Isidro' }),
      report({ id: 'a2', story: 'a', title: "Mexico captures 'El Chapo Isidro' in a string of arrests", status: undefined }),
      report({ id: 'b1', story: 'b', lat: -12, lng: -77, title: 'Sismo de magnitud 6,7 en Perú deja heridos' }),
    ] }]
    expect(pickTourStories(stories, buckets).map(s => [s.id, s.title])).toEqual([['a', "Mexico captures 'El Chapo Isidro' in a string of arrests"]])
  })

  it('leaves out unverified stories, sports, low seriousness, stories with no place, and a second story at the same place', () => {
    const stories = [
      story({ id: 'u', verifiedAt: null, outlets: 99 }), story({ id: 'sp', category: 'sports', outlets: 98 }),
      story({ id: 'lo', severity: 'low', outlets: 97 }), story({ id: 'np', outlets: 96 }),
      story({ id: 'ok', outlets: 95 }), story({ id: 'same', outlets: 94 }),
    ]
    const buckets = [{ signals: [
      report({ id: 'r-u', story: 'u' }), report({ id: 'r-sp', story: 'sp', lat: 1, lng: 1 }), report({ id: 'r-lo', story: 'lo', lat: 2, lng: 2 }),
      report({ id: 'r-np', story: 'np', lat: 0, lng: 0 }), report({ id: 'r-ok', story: 'ok', lat: 40, lng: 40 }), report({ id: 'r-same', story: 'same', lat: 40.1, lng: 40.1 }),
    ] }]
    expect(pickTourStories(stories, buckets).map(s => s.id)).toEqual(['ok'])
  })
})

describe('the cards', () => {
  it('the trust line: outlets, countries and how fast separate outlets confirmed it', () => {
    expect(trustLine(story({}))).toBe('100 outlets · 30 countries · verified in 7 min')
    expect(trustLine(story({ outlets: 1234, countries: 1, verifiedAt: '2026-11-21T05:57:30Z' }))).toBe('1,234 outlets · verified within a minute')
    expect(trustLine(story({ verifiedAt: '2026-11-21T09:57:00Z' }))).toBe('100 outlets · 30 countries · verified in 4 h')
    expect(trustLine(story({ verifiedAt: '2026-11-25T09:57:00Z' }))).toBe('100 outlets · 30 countries')
    expect(trustLine(story({ verifiedAt: null }))).toBe('100 outlets · 30 countries')
  })

  it('the tag: the subject and the country by name', () => {
    expect(storyTag(story({}), c => ({ MX: 'Mexico' })[c])).toBe('CONFLICT · MEXICO')
    expect(storyTag(story({ category: 'natural_disaster', country: 'XX' }))).toBe('NATURAL DISASTER · XX')
    expect(storyTag(story({ category: '', country: undefined }))).toBe('')
  })

  it('each story gets an equal share of the replay, the first from the start', () => {
    expect([0, 0.19, 0.2, 0.5, 0.99, 1].map(p => tourIndexAt(p, 5))).toEqual([0, 0, 1, 2, 4, 4])
    expect(tourIndexAt(0.5, 0)).toBe(-1)
    expect(tourIndexAt(Number.NaN, 3)).toBe(0)
  })
})
