/**
 * Severity without the LLM (plan 0u, Oct 11, 2026): "Twelve killed and 300
 * injured in attack on airport" was medium, a flood report saying "0 deaths"
 * was high, and any "nuclear" or "collapse" was critical ("nuclear talks").
 */
import { describe, it, expect } from 'vitest'
import { rateSeverity, casualties } from '../severity'

describe('casualties', () => {
  it('counts the dead and injured in words and digits', () => {
    expect(casualties('Twelve killed and 300 injured in attack on airport')).toMatchObject({ dead: 12, injured: 300 })
    expect(casualties('Houthis Kill 12, Injure 300+ at Riyadh Airport')).toMatchObject({ dead: 12, injured: 300 })
    expect(casualties('Bombing kills dozens in capital city').dead).toBe(24)
    expect(casualties('Death toll rises to 41 after floods').dead).toBe(41)
    expect(casualties('Nine people, including children, dead after mass shooting').dead).toBe(9)
  })

  it("doesn't count power cuts, years or money as dead", () => {
    expect(casualties('Hurricane leaves 650,000 without power').dead).toBe(0)
    expect(casualties('Floods in 2026 killed crops').dead).toBe(0)
  })
})

describe('rateSeverity', () => {
  it('rates by the dead and injured', () => {
    expect(rateSeverity('Twelve killed and 300 injured in attack on airport in Saudi capital Riyadh')).toBe('high')
    expect(rateSeverity('Russian attack on Zaporizhzhia kills seven, governor says')).toBe('high')
    expect(rateSeverity('Man dies after entering tiger enclosure at UK zoo')).toBe('medium')
    expect(rateSeverity('Floods kill 150 across the region')).toBe('critical')
    expect(rateSeverity('Isaias leaves 700,000 without power as flood threat grows')).toBe('high')
  })

  it('rates by the kind of event', () => {
    expect(rateSeverity('Nuclear strike warning issued')).toBe('critical')
    expect(rateSeverity('Magnitude 7.5 earthquake strikes Turkey')).toBe('high')
    expect(rateSeverity('Hurricane Simon strengthens into Category 4 storm')).toBe('high')
    expect(rateSeverity('Thousands protest in Paris over pension reform')).toBe('medium')
    expect(rateSeverity('G7 leaders hold annual dinner in Italy')).toBe('low')
  })

  it('no longer inflates words out of context', () => {
    expect(rateSeverity('Armenia could become a platform for U.S.-Russian nuclear cooperation')).toBe('low')
    expect(rateSeverity('Breaking: Two Carlton AFL players hospitalised in Melbourne')).toBe('low')
    expect(rateSeverity('Green flood alert in Slovenia', 'The flood caused 0 deaths and 0 displaced.')).toBe('medium')
    expect(rateSeverity('Nobel Peace Prize awarded to UN jurist who accused Israel of committing genocide in Gaza')).toBe('low')
  })

  it('keeps opinion at medium or below, and fighting and disasters at medium or above', () => {
    expect(rateSeverity('Opinion: the airstrike that changed the war')).toBe('medium')
    expect(rateSeverity('Trump says Ukraine should get a new president', null, 'conflict')).toBe('medium')
    expect(rateSeverity('Trump says Ukraine should get a new president', null, 'geopolitics')).toBe('low')
  })

  it('reads the summary for deaths and event words, but event words there lift only to medium', () => {
    expect(rateSeverity('Christa Pike released from hospital', 'She survived a failed execution last month.')).toBe('medium')
    expect(rateSeverity('Officials meet in Geneva', 'Missile strikes continued overnight elsewhere.')).toBe('medium')
    expect(rateSeverity('Officials meet in Geneva', 'At least 20 people were killed in the attack.')).toBe('high')
  })
})
