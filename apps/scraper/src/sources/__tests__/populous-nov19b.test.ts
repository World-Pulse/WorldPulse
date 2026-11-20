/**
 * The populous countries round 2 (Nov 19, 2026; Devon, 7:56 PM: "where should we add and improve now?"): the coverage
 * balance panel's gaps (India, Pakistan, DR Congo, the Philippines, Indonesia) and the first feeds in Punjabi, Sinhala,
 * Burmese and Filipino.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: {} }))

const { NEWS_SOURCE_REGISTRY, inferGeo } = await import('../news-rss')
const { withLocalNames } = await import('../../pipeline/local-names')
const byId = new Map(NEWS_SOURCE_REGISTRY.map(s => [s.id, s]))

describe('the populous countries round 2', () => {
  it('reads the new languages and places', () => {
    expect(byId.get('jagbani')).toMatchObject({ language: 'pa', countryCode: 'IN' })
    expect(byId.get('divaina')).toMatchObject({ language: 'si', countryCode: 'LK' })
    expect(byId.get('dvb-burmese')).toMatchObject({ language: 'my', countryCode: 'MM' })
    expect(byId.get('bombo-radyo')).toMatchObject({ language: 'tl', countryCode: 'PH' })
    expect(byId.get('mediacongo')).toMatchObject({ language: 'fr', countryCode: 'CD' })
    expect(NEWS_SOURCE_REGISTRY.filter(s => s.countryCode === 'IN').length).toBeGreaterThanOrEqual(54)
  })

  it('leaves out the outlets whose terms keep them out', () => {
    const hosts = NEWS_SOURCE_REGISTRY.map(s => new URL(s.feedUrl).hostname)
    for (const host of ['tribune.com.pk', 'bhaskar.com', 'divyabhaskar.co.in', 'amarujala.com', 'sangbadpratidin.in', 'tv9bangla.com',
      'mathrubhumi.com', 'eastmojo.com', 'satyahindi.com', 'ntvtelugu.com', 'ratopati.com', 'sunstar.com.ph', 'isolezwe.co.za',
      'chandrikadaily.com', 'deccanherald.com', 'apa.az', 'dn.se', 'sydsvenskan.se', 'expressen.se', 'aftonbladet.se', 'svd.se',
      'svt.se', 'storm.mg', 'stheadline.com']) {
      expect(hosts.some(h => h === host || h.endsWith(`.${host}`)), host).toBe(false)
    }
  })

  it('places Punjabi, Sinhala, Burmese and Filipino headlines', () => {
    expect(withLocalNames('ਅੰਮ੍ਰਿਤਸਰ ਵਿੱਚ ਮੀਂਹ', 'pa')).toContain('Amritsar')
    expect(withLocalNames('කොළඹට අධික වැසි', 'si')).toContain('Colombo')
    expect(withLocalNames('ရန်ကုန်တွင် မိုးသည်းထန်', 'my')).toContain('Yangon')
    expect(withLocalNames('Bagyo, tatama sa Maynila', 'tl')).toContain('Manila')
    const at = (id: string, title: string) => inferGeo(title, '', byId.get(id)!)
    expect(at('lankadeepa', 'යාපනයේ ගංවතුර').countryCode).toBe('LK')
    expect(at('dvb-burmese', 'မန္တလေး မြို့တွင် ငလျင်').countryCode).toBe('MM')
  })

  it('keeps every id once', () => {
    expect(new Set(NEWS_SOURCE_REGISTRY.map(s => s.id)).size).toBe(NEWS_SOURCE_REGISTRY.length)
  })
})
