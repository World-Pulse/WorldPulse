/**
 * Cities and provinces named in Chinese, Japanese and Korean (Nov 20, 2026). The story matcher reads their country
 * names ("中国", "ロシア", "미국"), but not the places within: of 30,323 reports of 13 hours, the headlines of 17% of
 * those in Chinese and 13% in Japanese were linked to a place, though they name Taipei, Kaohsiung, Shanghai, Tokyo
 * or Osaka as often as a country. Chinese and Japanese write no spaces, so a name is read wherever it stands, the
 * longest first ("東京都" is Tokyo, not Kyoto); Korean names are read where no syllable comes before them ("세계대전",
 * a world war, is not Daejeon). Each with its English name as the gazetteer (or the newer list) spells it. Left out:
 * names that are as often a surname or a common word ("石川", "山口", "大分", "경기") and places the gazetteer doesn't
 * know (Guangdong, Sichuan, Hokkaido), and Kochi, whose English name is also the Indian city's;
 * "千葉", "秋田", "長野" and "岡山" are read only with 県 or 市.
 */

type Entry = [string, string]

// Chinese (both scripts) and Japanese kanji: read wherever they stand
const HAN: Entry[] = [
  // Taiwan
  ['台北', 'Taipei'], ['臺北', 'Taipei'], ['新北', 'New Taipei'], ['桃園', 'Taoyuan'], ['桃园', 'Taoyuan'], ['台中', 'Taichung'],
  ['臺中', 'Taichung'], ['台南', 'Tainan'], ['臺南', 'Tainan'], ['高雄', 'Kaohsiung'], ['基隆', 'Keelung'], ['新竹', 'Hsinchu'],
  ['嘉義', 'Chiayi'], ['嘉义', 'Chiayi'], ['花蓮', 'Hualien'], ['花莲', 'Hualien'], ['台東', 'Taitung'], ['臺東', 'Taitung'],
  ['台东', 'Taitung'], ['屏東', 'Pingtung'], ['屏东', 'Pingtung'], ['彰化', 'Changhua'], ['雲林', 'Yunlin'], ['云林', 'Yunlin'],
  ['苗栗', 'Miaoli'], ['澎湖', 'Penghu'], ['金門', 'Kinmen'], ['金门', 'Kinmen'],
  // mainland China, Hong Kong, Macau
  ['北京', 'Beijing'], ['上海', 'Shanghai'], ['广州', 'Guangzhou'], ['廣州', 'Guangzhou'], ['深圳', 'Shenzhen'], ['香港', 'Hong Kong'],
  ['澳门', 'Macau'], ['澳門', 'Macau'], ['天津', 'Tianjin'], ['重庆', 'Chongqing'], ['重慶', 'Chongqing'], ['成都', 'Chengdu'],
  ['武汉', 'Wuhan'], ['武漢', 'Wuhan'], ['杭州', 'Hangzhou'], ['南京', 'Nanjing'], ['西安', "Xi'an"], ['苏州', 'Suzhou'],
  ['蘇州', 'Suzhou'], ['浙江', 'Zhejiang'], ['江苏', 'Jiangsu'], ['江蘇', 'Jiangsu'], ['山东', 'Shandong'], ['山東', 'Shandong'],
  ['河南', 'Henan'], ['湖北', 'Hubei'], ['湖南', 'Hunan'], ['新疆', 'Xinjiang'], ['西藏', 'Tibet'], ['云南', 'Yunnan'],
  ['雲南', 'Yunnan'], ['海南', 'Hainan'], ['内蒙古', 'Inner Mongolia'], ['內蒙古', 'Inner Mongolia'], ['黑龙江', 'Heilongjiang'],
  ['黑龍江', 'Heilongjiang'], ['吉林', 'Jilin'], ['辽宁', 'Liaoning'], ['遼寧', 'Liaoning'], ['河北', 'Hebei'], ['山西', 'Shanxi'],
  ['陕西', 'Shaanxi'], ['陝西', 'Shaanxi'], ['甘肃', 'Gansu'], ['甘肅', 'Gansu'], ['贵州', 'Guizhou'], ['貴州', 'Guizhou'],
  ['广西', 'Guangxi'], ['廣西', 'Guangxi'], ['江西', 'Jiangxi'], ['安徽', 'Anhui'], ['宁夏', 'Ningxia'], ['寧夏', 'Ningxia'],
  ['青海', 'Qinghai'],
  // Japan
  ['東京', 'Tokyo'], ['大阪', 'Osaka'], ['京都', 'Kyoto'], ['沖縄', 'Okinawa'], ['福岡', 'Fukuoka'], ['名古屋', 'Nagoya'],
  ['横浜', 'Yokohama'], ['神戸', 'Kōbe'], ['埼玉', 'Saitama'], ['神奈川', 'Kanagawa Prefecture'], ['愛知', 'Aichi Prefecture'],
  ['兵庫', 'Hyōgo Prefecture'], ['広島', 'Hiroshima'], ['仙台', 'Sendai'], ['札幌', 'Sapporo'], ['静岡', 'Shizuoka'],
  ['新潟', 'Niigata'], ['熊本', 'Kumamoto'], ['鹿児島', 'Kagoshima'], ['長崎', 'Nagasaki'], ['茨城', 'Ibaraki Prefecture'],
  ['栃木', 'Tochigi Prefecture'], ['群馬', 'Gunma Prefecture'], ['岐阜', 'Gifu'], ['滋賀', 'Shiga Prefecture'],
  ['和歌山', 'Wakayama Prefecture'], ['愛媛', 'Ehime Prefecture'], ['青森', 'Aomori'], ['岩手', 'Iwate Prefecture'],
  ['富山', 'Toyama'], ['山梨', 'Yamanashi Prefecture'], ['鳥取', 'Tottori Prefecture'], ['島根', 'Shimane Prefecture'],
  ['徳島', 'Tokushima Prefecture'], ['福島', 'Fukushima'], ['千葉県', 'Chiba'], ['千葉市', 'Chiba'], ['秋田県', 'Akita'],
  ['秋田市', 'Akita'], ['長野県', 'Nagano Prefecture'], ['長野市', 'Nagano Prefecture'], ['岡山県', 'Okayama'], ['岡山市', 'Okayama'],
]
// what follows a name that makes it something else: Beijing time, the Golden Gate Bridge, the Shanghai Cooperation
// Organisation; and what comes before: the Badain Jaran desert ("巴丹吉林")
const HAN_NOT_AFTER: Record<string, string[]> = { '北京': ['时间', '時間'], '金门': ['大桥', '大橋'], '金門': ['大桥', '大橋'], '上海': ['合作'] }
const HAN_NOT_BEFORE: Record<string, string[]> = { '吉林': ['巴丹'] }

// Korean: read where no syllable comes before ("세계대전", a world war, is not Daejeon), nor after a by-product
const HANGUL: Entry[] = [
  ['부산', 'Busan'], ['인천', 'Incheon'], ['대구', 'Daegu'], ['광주', 'Gwangju'], ['대전', 'Daejeon'], ['울산', 'Ulsan'],
  ['제주', 'Jeju'], ['강원', 'Gangwon'], ['수원', 'Suwon'], ['창원', 'Changwon'], ['포항', 'Pohang'],
]
const HANGUL_NOT_AFTER: Record<string, string[]> = { '부산': ['물'] }
const HANGUL_NOT_BEFORE: Record<string, string[]> = {}

const CJK = /[\p{sc=Han}\p{sc=Hangul}]/u
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const byLength = (entries: Entry[]) => [...entries].sort((a, b) => b[0].length - a[0].length)
const NAMES = new Map([...HAN, ...HANGUL])
const HAN_RE = new RegExp(`(${byLength(HAN).map(e => escapeRe(e[0])).join('|')})`, 'gu')
const HANGUL_RE = new RegExp(`(?<![가-힣])(${byLength(HANGUL).map(e => escapeRe(e[0])).join('|')})`, 'gu')

/** The places a text names in Chinese, Japanese or Korean, as the gazetteer spells them, at most two, in the order named */
export function cjkPlaces(text: string): string[] {
  if (!text || !CJK.test(text)) return []
  const found: Array<{ at: number; name: string }> = []
  for (const [re, notAfter, notBefore] of [[HAN_RE, HAN_NOT_AFTER, HAN_NOT_BEFORE], [HANGUL_RE, HANGUL_NOT_AFTER, HANGUL_NOT_BEFORE]] as const) {
    for (const m of text.matchAll(re)) {
      const word = m[1]!
      const at = m.index ?? 0
      const rest = text.slice(at + word.length)
      if ((notAfter[word] ?? []).some(after => rest.startsWith(after))) continue
      if ((notBefore[word] ?? []).some(before => text.slice(0, at).endsWith(before))) continue
      const name = NAMES.get(word)
      if (name) found.push({ at, name })
    }
  }
  const out: string[] = []
  for (const { name } of found.sort((a, b) => a.at - b.at)) {
    if (!out.includes(name)) out.push(name)
    if (out.length >= 2) break
  }
  return out
}

/** Every place of the lists, for the tests */
export const CJK_PLACE_NAMES: readonly string[] = [...new Set([...HAN, ...HANGUL].map(e => e[1]))]
