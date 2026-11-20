/**
 * The cross-source dedup's event fingerprint (dedup.ts) reads Arabic and Cyrillic headlines (Nov 6, 2026): with Latin
 * letters only, every Arabic or Russian headline had the same fingerprint, its category alone, and after the first one
 * each six hours the others were thrown away as its duplicates.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis.js', () => ({ redis: {} }))
const { eventFingerprint } = await import('../dedup.js')

describe('eventFingerprint', () => {
  it('tells Arabic and Russian headlines apart', () => {
    expect(eventFingerprint('الاتحاد الأوروبي يدين العمل الإرهابي الذي أسفر عن استشهاد السلايطة', 'geopolitics'))
      .not.toBe(eventFingerprint('احتراق شاحنة على طريق رأس النقب باتجاه العقبة', 'geopolitics'))
    expect(eventFingerprint('В Бишкеке задержан подозреваемый в краже', 'geopolitics'))
      .not.toBe(eventFingerprint('Число выдворенных из России мигрантов выросло в полтора раза', 'geopolitics'))
    // and neither is the bare category's
    expect(eventFingerprint('Число выдворенных из России мигрантов выросло в полтора раза', 'geopolitics'))
      .not.toBe(eventFingerprint('', 'geopolitics'))
  })

  it('still gives one fingerprint to one headline, with its vowel marks or without', () => {
    expect(eventFingerprint('أمن الأردن مسؤولية الجميع', 'geopolitics')).toBe(eventFingerprint('أَمْنُ الأُرْدُنِّ مَسْؤُولِيَّةُ الجَمِيعِ', 'geopolitics'))
  })

  // Nov 19, 2026: the other scripts' headlines (Dinamani's and Andhra Jyothy's first 20 had one fingerprint between them)
  it('tells apart headlines in every other script, and not from the bare category', () => {
    const pairs: Array<[string, string]> = [
      ['சிவகிரி மருத்துவமனையில் அவசர சிகிச்சைக்கான புதிய கட்டடம்', 'தாராபுரம் பகுதியில் கனிமவளம் இருப்பதாக பரவும் தகவல்'],
      ['రోడ్డు భద్రతకు 5 సూత్రాలు', 'సైయెంట్‌ సెమీకండక్టర్స్‌కు రూ.94 కోట్ల నిధులు'],
      ['मुंबई में भारी बारिश, लोकल ट्रेन सेवा ठप', 'दिल्ली में नई मेट्रो लाइन का उद्घाटन'],
      ['ঢাকায় সংঘর্ষ, গ্রেপ্তার ২০', 'ঢাকায় নতুন বইমেলা শুরু'],
      ['国务院常务会议研究部署经济工作', '台风登陆广东 多地停课'],
      ['大分県で土砂崩れ 3人死亡', '新商品の発売日が決定'],
      ['화재로 4명 숨지고 12명 부상', '북 미사일 발사 합참 동해상으로'],
      ['ชุมนุมประท้วงหน้าทำเนียบรัฐบาล', 'ไฟดับหลายพื้นที่ในกรุงเทพฯ'],
      ['Σεισμός στην Κρήτη: 3 νεκροί', 'Νέο μουσείο στη Θεσσαλονίκη'],
      ['הממשלה אישרה את התקציב', 'שריפה גדולה בצפון'],
      ['የመደመር መንግሥት ለቡና ልማት በሰጠው ትኩረት', 'በአዲስ አበባ ከባድ ዝናብ'],
    ]
    for (const [a, b] of pairs) {
      expect(eventFingerprint(a, 'geopolitics'), a).not.toBe(eventFingerprint(b, 'geopolitics'))
      expect(eventFingerprint(a, 'geopolitics'), a).not.toBe(eventFingerprint('', 'geopolitics'))
      expect(eventFingerprint(a, 'geopolitics'), a).toBe(eventFingerprint(`${a}!`, 'geopolitics'))
    }
  })

  it('reads Latin headlines as before', () => {
    // the old rule: only a-z, 0-9 and spaces kept, words over 2 letters, English stop words out, sorted, the first 5
    expect(eventFingerprint('Bulgaria seeks suspects in Germany after Starlink sabotage', 'politics'))
      .toBe(eventFingerprint('bulgaria SEEKS suspects in germany after starlink sabotage!', 'politics'))
    expect(eventFingerprint('Sécurité : une délégation du Sultanat', 'geopolitics')).toBe(eventFingerprint('Scurit une dlgation du Sultanat', 'geopolitics'))
  })
})
