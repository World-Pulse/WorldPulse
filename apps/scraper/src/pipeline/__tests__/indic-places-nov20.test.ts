/**
 * Places named in the scripts of India, Nepal and Bangladesh (Nov 20, 2026), so their reports are linked to them as
 * reports in English are: of 4,320 reports of 13 hours in Hindi, Marathi, Nepali, Bengali, Punjabi, Gujarati, Odia,
 * Tamil, Telugu, Kannada and Malayalam, those whose headline names a person, place or organisation: 4.8% before,
 * 25% now.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK'), set: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})

const { indicPlaces, INDIC_PLACE_NAMES } = await import('../indic-places')
const { scriptPlaces } = await import('../insert-signal')
const { placesInText } = await import('../geo')
const { listedPlace } = await import('../entity-rules')

describe('places in the scripts of India, Nepal and Bangladesh', () => {
  it('are read in each script, with the endings joined to them', () => {
    expect(indicPlaces('कानपुर में किसान का शव पेड़ से लटका मिला')).toEqual(['Kanpur'])
    expect(indicPlaces('ट्रंप, शी, पुतिन के घोषणापत्र में ईरान व यूक्रेन युद्ध पर कुछ ठोस नहीं')).toEqual(['Iran', 'Ukraine'])
    expect(indicPlaces('पंजाबमध्ये १.५ लाख कोटी रुपयांची गुंतवणूक')).toEqual(['Punjab'])                     // Marathi
    expect(indicPlaces('के हामी भारतसँग विवादका बुँदा बनाउन सक्छौं ?')).toEqual(['India'])                    // Nepali
    expect(indicPlaces('हिमाचल प्रदेश में बर्फबारी')).toEqual(['Himachal Pradesh'])
    expect(indicPlaces('হাসিনা ফেরাতে উত্তাল বাংলাদেশ, ভারতের ‘হাত’ দেখছেন তারেক')).toEqual(['Bangladesh', 'India'])
    expect(indicPlaces('ਜਲੰਧਰ ਵਿਖੇ ਦੋ ਦਿਨਾਂ ਤੋਂ ਲਾਪਤਾ ਨੌਜਵਾਨ ਦੀ ਮਿਲੀ ਲਾਸ਼')).toEqual(['Jalandhar'])
    expect(indicPlaces('અમેરિકામાં કેબ ચાલક પર હુમલો')).toEqual(['United States'])
    expect(indicPlaces('ତିନି ବର୍ଷ ପରେ ଭାରତ ମାଟିରେ ପାକିସ୍ତାନୀ ମନ୍ତ୍ରୀ')).toEqual(['India', 'Pakistan'])
    expect(indicPlaces('இந்தியாவில் உள்ள சிவிங்கிப்புலிகளின் எண்ணிக்கை 62-ஆக உயர்வு')).toEqual(['India'])
    expect(indicPlaces('தமிழ்நாட்டில் கனமழை')).toEqual(['Tamil Nadu'])
    expect(indicPlaces('హైదరాబాద్‌లో నవంబర్ 21 రాత్రి నుంచి')).toEqual(['Hyderabad'])
    expect(indicPlaces('ಬೆಂಗಳೂರಿನ 90ಕ್ಕೂ ಅಧಿಕ ಬಡಾವಣೆಗಳಲ್ಲಿ ವಿದ್ಯುತ್‌ ಇರಲ್ಲ')).toEqual(['Bangalore'])
    expect(indicPlaces('ഇറാനിൽ പ്രതിഷേധം; ഇന്ത്യയുടെ നിലപാട്')).toEqual(['Iran', 'India'])
  })

  it("doesn't read a longer word as the place", () => {
    expect(indicPlaces('असमंजस में सरकार')).toEqual([])                  // a dilemma, not Assam
    expect(indicPlaces('चीनी मिलों का भुगतान')).toEqual([])                // sugar mills
    expect(indicPlaces('ଗୋବରୀ ନଦୀ ମଝିରେ କଟକଣାକୁ ଫୁ')).toEqual([])          // a restriction, not Cuttack
    expect(indicPlaces('ഇറാഖിൽ സ്ഫോടനം')).toEqual([])                    // Iraq, not Iran
    expect(indicPlaces('Monsoon reaches Kerala')).toEqual([])
  })

  it('names each place as the gazetteer or the newer list spells it', () => {
    for (const name of INDIC_PLACE_NAMES) expect(placesInText(name)[0] === name || listedPlace(name) === name, name).toBe(true)
  })

  it('come after the countries the matcher reads, two at most', () => {
    expect(scriptPlaces('今年1-10月中国财政收入同比增长4.9%')).toEqual(['China'])
    expect(scriptPlaces('सीएम रेवंत रेड्डी दिल्ली और हैदराबाद में, फिर मुंबई')).toEqual(['Delhi', 'Hyderabad'])
  })
})
