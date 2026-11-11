import { describe, it, expect } from 'vitest'
import { playCard } from '../map-play'

describe("the morning video's card, for the recorder to save beside it (Nov 11, 2026)", () => {
  it("is the title card's numbers and the closing card's three most-reported stories", () => {
    const card = playCard(
      { reports: 18508, outlets: 1827, countries: 215, verified: 3471, milestone: null },
      [{ title: ' Senator calls on Nvidia CEO to step down ', outlets: 170, countries: 57 }, { title: 'B', outlets: 90 }, { title: 'C', outlets: 80, countries: 12 }, { title: 'D', outlets: 70, countries: 9 }],
    )
    expect(card).toEqual({
      reports: 18508, outlets: 1827, countries: 215, verified: 3471, milestone: null,
      top: [{ title: 'Senator calls on Nvidia CEO to step down', outlets: 170, countries: 57 }, { title: 'B', outlets: 90, countries: 0 }, { title: 'C', outlets: 80, countries: 12 }],
    })
    expect(JSON.parse(JSON.stringify(card))).toEqual(card)
  })

  it("keeps the day's milestone, not a preview's", () => {
    expect(playCard({ reports: 18000, outlets: 1, countries: 1, verified: 1, milestone: 750_000 }, []).milestone).toBe(750_000)
    expect(playCard({ reports: 18000, outlets: 1, countries: 1, verified: 1, milestone: 750_000, preview: true }, []).milestone).toBeNull()
  })
})
