/**
 * Map accuracy, Nov 9, 2026 (Devon, 10:12 PM: "Keep working through mapping accuracy"): a hand check of 70 random pins
 * of the day and the 95 whose headlines named only other countries. Three of the place-finder's own misreads, fixed
 * here: a Portuguese name for Puerto Rico read as Porto, and two people's names read as towns.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { NEWS_SOURCE_REGISTRY, inferGeo } = await import('../news-rss')
const src = (id: string) => NEWS_SOURCE_REGISTRY.find(s => s.id === id)!
const generic = (language: string, countryCode = 'GB') =>
  ({ id: 'no-pin', defaultLat: 0, defaultLng: 0, defaultLocation: 'x', countryCode, language }) as never

describe('map accuracy (Nov 9, 2026)', () => {
  it('reads Portuguese "Porto Rico" as Puerto Rico, and Porto as Porto', () => {
    expect(inferGeo('Miss Universe2026: Armandina Cunha já se encontra no Porto Rico para representar Cabo Verde na 75.ª edição', '', src('noticias-do-norte-cv')).countryCode).toBe('PR')
    expect(inferGeo('Incêndio no Porto obriga a evacuar prédio', '', generic('pt', 'PT')).countryCode).toBe('PT')
  })

  it('does not read a man named Pawan Kalyan as the town of Kalyan', () => {
    expect(inferGeo('Deputy CM Pawan Kalyan to part ways with wife, Anna Lezhneva', '', generic('en', 'GB')).locationName).not.toBe('Kalyan')
    expect(inferGeo('Building collapse in Kalyan kills four', '', generic('en', 'GB')).locationName).toBe('Kalyan')
  })

  it('does not read Beni before a surname as the Congo\'s Beni, in Albanian', () => {
    const portalb = src('portalb-mk')
    expect(inferGeo('Ish-zëdhënësi i VMRO-DPMNE-së u emërua drejtor i QKR-së, Beni Shaqiri u bë këshilltar i Gjorgjievskit', '', portalb).countryCode).not.toBe('CD')
    // the Congo's Beni stays the place, in English and when no surname follows
    expect(inferGeo('Ebola cases rise in Beni as attacks hamper response', '', generic('en', 'GB')).countryCode).toBe('CD')
  })
})
