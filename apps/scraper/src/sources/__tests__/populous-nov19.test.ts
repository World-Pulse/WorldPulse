/**
 * The populous countries round (Nov 19, 2026; Devon, 5:33 PM: "Proceed with 1-3 / More local language coverage, more
 * overall coverage"): India's own languages (Tamil, Telugu, Marathi, Kannada, Malayalam, Odia, Assamese, Gujarati),
 * Indonesia, Pakistan (Urdu, Sindhi), Nigeria, Brazil, Egypt, Ethiopia (Amharic), Vietnam, Mexico, Turkey and Russia.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { NEWS_SOURCE_REGISTRY, inferGeo } = await import('../news-rss')
const byId = new Map(NEWS_SOURCE_REGISTRY.map(s => [s.id, s]))

describe('the populous countries round', () => {
  it('reads their own press in their own languages', () => {
    expect(byId.get('dinamani')).toMatchObject({ language: 'ta', countryCode: 'IN' })
    expect(byId.get('andhra-jyothy')).toMatchObject({ language: 'te', countryCode: 'IN' })
    expect(byId.get('esakal')).toMatchObject({ language: 'mr', countryCode: 'IN' })
    expect(byId.get('kannada-prabha')).toMatchObject({ language: 'kn', countryCode: 'IN' })
    expect(byId.get('suprabhaatham')).toMatchObject({ language: 'ml', countryCode: 'IN' })
    expect(byId.get('sambad')).toMatchObject({ language: 'or', countryCode: 'IN' })
    expect(byId.get('asomiya-pratidin')).toMatchObject({ language: 'as', countryCode: 'IN' })
    expect(byId.get('gujarat-samachar')).toMatchObject({ language: 'gu', countryCode: 'IN' })
    expect(byId.get('detik-news')).toMatchObject({ language: 'id', countryCode: 'ID' })
    expect(byId.get('awami-awaz')).toMatchObject({ language: 'sd', countryCode: 'PK' })
    expect(byId.get('fana-amharic')).toMatchObject({ language: 'am', countryCode: 'ET' })
    expect(byId.get('kommersant')).toMatchObject({ language: 'ru', countryCode: 'RU' })
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.countryCode === 'IN').length).toBeGreaterThanOrEqual(40)
  })

  it('labels state media below 0.6', () => {
    for (const id of ['fana-amharic', 'vtv', 'sggp']) {
      expect(byId.get(id)?.biasLabel, id).toBe('state-media')
      expect(byId.get(id)!.reliability, id).toBeLessThan(0.6)
    }
  })

  // (BusinessDay's news sitemap is left out too; its feed has been on the list since before the terms rule.) Since Devon's
  // word (Nov 20, 2026, 7:03 AM: "proceed"), terms that only limit use to personal or non-commercial use don't keep an
  // outlet out; bans on robots, scraping, data mining or AI training still do.
  it('leaves out the outlets whose terms keep them out', () => {
    const hosts = NEWS_SOURCE_REGISTRY.map(s => new URL(s.feedUrl).hostname)
    for (const host of ['siasat.com', 'prajavani.net', 'legit.ng', 'icirnigeria.org', 'vijayavani.net', 'haberturk.com',
      'yomiuri.co.jp', 'jiji.com', 'chugoku-np.co.jp']) {
      expect(hosts.some(h => h === host || h.endsWith(`.${host}`)), host).toBe(false)
    }
  })

  it('reads the outlets whose terms only limited use to personal or non-commercial use', () => {
    const hosts = NEWS_SOURCE_REGISTRY.map(s => new URL(s.feedUrl).hostname)
    for (const host of ['iamgujarat.com', 'loksatta.com', 'vijaykarnataka.com', 'asianetnews.com', 'janmabhumi.in',
      'manoramaonline.com', 'madhyamam.com', 'ntnews.com', 'eenadu.net', 'on.cc', 'excelsior.com.mx', 'abplive.com',
      'sabah.com.tr', 'trthaber.com', 'tokyo-np.co.jp']) {
      expect(hosts.some(h => h === host || h.endsWith(`.${host}`)), host).toBe(true)
    }
  })

  it('places a Tamil, an Amharic and a Sindhi headline', () => {
    const at = (id: string, title: string) => inferGeo(title, '', byId.get(id)!)
    expect(at('daily-thanthi', 'மதுரையில் கனமழை')).toMatchObject({ locationName: 'Madurai', countryCode: 'IN' })
    expect(at('fana-amharic', 'በመቀሌ ከተማ ስብሰባ ተካሄደ')).toMatchObject({ locationName: 'Mekelle', countryCode: 'ET' })
    expect(at('awami-awaz', 'لاڙڪاڻي ۾ احتجاج').countryCode).toBe('PK')
  })

  it('keeps every id once', () => {
    expect(new Set(NEWS_SOURCE_REGISTRY.map(s => s.id)).size).toBe(NEWS_SOURCE_REGISTRY.length)
  })
})
