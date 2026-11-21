/**
 * The second outlet (plan 0s3; Devon, Oct 22, 2026: "PROCEED WITH: Find the
 * second outlet. Search GDELT, a free index of over 100,000 news outlets, for
 * every medium-or-higher report with only one source").
 *
 * Most reports stay pending with one outlet because WorldPulse reads a few
 * hundred feeds, not because no one else carried the story: of the 100
 * newest medium reports on Oct 22, 93 had one outlet, and the share of
 * reports verified by 2+ outlets was 12%. GDELT reads far more outlets, and
 * every 15 minutes publishes, free, the list of the articles it read
 * (gdelt-articles.ts). Every 15 minutes this reads the new list and holds the
 * last 8 hours of it in memory (about 50,000 English articles), and each
 * medium, high or critical news report in English with one outlet, from the
 * last 30 hours, is compared with it: with the articles new since the last
 * time, or, for a report new since then, with all 8 hours. An article counts
 * as another outlet when
 *  - it shares two or more of the report's headline words (not only words of
 *    a kind of event: "killed", "police"),
 *  - it is on another website (sister sites of one owner are one: en. and
 *    www.protothema.gr, frontline.thehindu.com and thehindu.com),
 *  - the website is a newsroom, not an aggregator, a press-release wire, a
 *    blog platform or a known AI content farm (NOT_OUTLETS),
 *  - its headline passes the test an article merged into a report passes
 *    (correlate.ts: isSameStory, and no names the other lacks), within 24
 *    hours of the report,
 *  - and it isn't a copy (the same address slug, or the same headline word
 *    for word as the report or as another outlet found: one wire story on
 *    twenty papers is one outlet).
 * Up to 3 join the report: their links are listed with it, its outlet count
 * goes up, it turns verified the way a merged article verifies it
 * (confirmMergedArticle), and its page says so ("Also reported by …").
 * Claude's cross-check reads the first CROSSCHECKS_A_DAY reports a day this
 * verifies (100: a few cents; by 1:35 PM on Oct 22 the day's 2,087 AI calls,
 * 1,092 of them cross-checks, had cost 48 cents), the rest stand on the
 * headline test, as merged articles did before the cross-check existed.
 *
 * First built on GDELT's search API (one search per report): live on Oct 22
 * it answered "Please limit requests to one every 5 seconds" after 5 to 8
 * requests even at one every 6 seconds, and tells heavy users to use its
 * files. The files have no such limit and cover every article, not 75 a
 * search. After a restart the last hour of files is read again.
 *
 * Since Nov 10, 2026 (Devon, 12:10 PM: "yes" to "let that search also check the quiet places' everyday stories,
 * and read French and German reports"): the quiet places' everyday (low) reports are searched too, those of the
 * thinly covered places whose reports were verified fewer than QUIET_VERIFIED times in 7 days (Dominica, Burundi,
 * Liechtenstein...; about 4 in 5 of their waiting reports are low), matched by the headline test only (the
 * cross-check stays the serious reports'); and French and German reports are compared with the French and German
 * articles of GDELT's translated list (gdelt-articles.ts), held 8 hours like the English ones; Spanish and
 * Portuguese ones too since that afternoon.
 *
 * Since Nov 21, 2026, on trial (Devon, 10:39 AM: "Proceed" with looking for a second outlet on everyday reports too,
 * run "for a few hours without confirming anything", 100 matches checked by hand with a 95% bar before it is switched
 * on): the other places' everyday (low) reports, about 5 in 6 of those waiting, are read as they come in and compared
 * with GDELT's articles the same way for EVERYDAY_HOLD_MS; what would join them is only written down
 * (second-outlet:trial, GET /api/v1/public/second-outlets?trial=1). No outlet is added, no report turns verified.
 *
 * Daily counts: second-outlet:day:<date> (GET /api/v1/public/second-outlets);
 * the latest matches, for reading by hand: second-outlet:recent. Off with
 * SECOND_OUTLET=off.
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { FUNCTION_WORDS, confirmMergedArticle, foldAccents, isSameStory, namesDiffer, otherScriptWords, thinPlaceCodes, westernDigits, type CorrelationCandidate } from './correlate'
import { isEventTemplateTitle } from './event-titles'
import { isCopyOf } from './independence'
import { hostOf, sourceKey } from './signal-columns'
import { cleanUrl } from './text'
import { fetchArticles, fetchNewestStamp, fetchNewestTranslationStamp, fetchTranslatedArticles, filesToRead, siteOf, stampDate, type GdeltArticle } from './gdelt-articles'
import { queueReindex } from './reindex'
import { serbianLatin } from './severity-languages'
import { readPulse, recordPulse } from './gkg-pulse'

export { siteOf, articleTitle } from './gdelt-articles'

/** GDELT publishes a file every 15 minutes; a few minutes after, it is read */
export const CYCLE_MS = 15 * 60_000
const LOCK_KEY = 'second-outlet:lock'
const LOCK_S = 6 * 60
export const DAY_KEY = (day: string) => `second-outlet:day:${day}`
export const RECENT_KEY = 'second-outlet:recent'
export const LAST_CYCLE_KEY = 'second-outlet:last-cycle'
const KEEP_S = 40 * 86_400

const HOUR = 3_600_000
/** How much of GDELT's list is held: 8 hours, about 50,000 English articles */
export const WINDOW_KEEP_MS = 8 * HOUR
/** Files read in one cycle: after a restart the last hour, after a gap at most 2 hours */
const WARM_FILES = 4
const MAX_FILES = 8
/**
 * A file GDELT lists but doesn't serve yet (or a moment's error) is read on the next cycle: the cycle stops
 * there, so the window never moves past it. On Oct 22-23 one file in four was lost when the file after it
 * read fine in the same cycle. A file still missing an hour after a newer one is listed is one GDELT
 * skipped: the cycle goes past it.
 */
const GIVE_UP_MS = HOUR
/** Reports compared: from the last 30 hours, settled for 20 minutes (intake may still add outlets) */
const LOOKBACK_MS = 30 * HOUR
const SETTLE_MS = 20 * 60_000
export const MAX_ADDED = 3
/** The articles a report is compared with in one cycle, the most words shared first */
const MAX_CANDIDATES = 40
const CROSSCHECKS_A_DAY = Number(process.env.SECOND_OUTLET_CROSSCHECKS) || 100

/** The other places' everyday reports (Nov 21, 2026): on trial, written down only; 'off' leaves them out */
export const EVERYDAY: 'trial' | 'off' = 'trial'
/** How long an everyday report on trial is compared with the articles that come in: most outlets carry a story within hours */
export const EVERYDAY_HOLD_MS = 6 * HOUR
/** At most this many held at once (about 6 hours of them), the oldest let go first */
export const EVERYDAY_MAX_HELD = 10_000
/** New everyday reports read in one cycle, oldest first; after a restart those of the last EVERYDAY_WARM_MS */
export const EVERYDAY_READ = 4_000
const EVERYDAY_WARM_MS = 2 * HOUR
export const TRIAL_KEY = 'second-outlet:trial'
const TRIAL_KEEP = 1_000

// ─── Headline words ──────────────────────────────────────────────────────────

/** Words that don't say which story it is */
const PLAIN = new Set([
  'about', 'above', 'according', 'across', 'after', 'again', 'against', 'ahead', 'all', 'allegedly', 'also', 'amid',
  'among', 'and', 'another', 'any', 'are', 'around', 'away', 'back', 'been', 'before', 'behind', 'being', 'below',
  'between', 'beyond', 'both', 'breaking', 'but', 'call', 'called', 'calls', 'can', 'claim', 'claims', 'could',
  'despite', 'did', 'does', 'down', 'during', 'each', 'even', 'every', 'exclusive', 'explainer', 'first', 'for',
  'from', 'get', 'gets', 'give', 'gives', 'had', 'has', 'have', 'her', 'here', 'his', 'how', 'into', 'its', 'just',
  'know', 'last', 'latest', 'live', 'made', 'make', 'makes', 'many', 'may', 'media', 'more', 'most', 'much', 'must',
  'near', 'new', 'news', 'next', 'not', 'now', 'off', 'official', 'officials', 'once', 'one', 'only', 'onto', 'other',
  'our', 'out', 'over', 'photos', 'report', 'reported', 'reportedly', 'reports', 'said', 'says', 'second', 'she',
  'should', 'since', 'some', 'source', 'sources', 'spokesman', 'spokesperson', 'spokeswoman', 'still', 'such',
  'take', 'takes', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'third', 'this',
  'those', 'through', 'today', 'told', 'tells', 'tonight', 'took', 'toward', 'towards', 'two', 'under', 'until',
  'update', 'updates', 'upon', 'very', 'video', 'videos', 'want', 'wants', 'was', 'watch', 'way', 'week', 'were',
  'what', 'when', 'where', 'which', 'while', 'who', 'why', 'will', 'with', 'within', 'without', 'would', 'year',
  'years', 'yesterday', 'you', 'your',
  'ago', 'ask', 'big', 'end', 'far', 'few', 'got', 'key', 'let', 'lot', 'old', 'own', 'per', 'put', 'say', 'see', 'set',
  'top', 'use', 'via', 'yet',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
])

/** Words of a kind of event or its usual actors: many stories share them */
const EVENTISH = new Set([
  'attack', 'attacks', 'army', 'case', 'cases', 'country', 'court', 'crash', 'dead', 'deal', 'death', 'deaths', 'die',
  'died', 'dies', 'election', 'fire', 'fires', 'flood', 'floods', 'forces', 'government', 'injured', 'injures', 'kill',
  'killed', 'killing', 'kills', 'market', 'markets', 'military', 'minister', 'nation', 'national', 'outbreak', 'people',
  'police', 'president', 'price', 'prices', 'protest', 'protests', 'rain', 'rains', 'state', 'storm', 'strike',
  'strikes', 'talks', 'troops', 'war', 'world',
  // counts in words: shared by many stories
  'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'dozen', 'dozens', 'hundreds', 'thousands',
  // in French and German (Nov 10, 2026), without accents, as storyTokens keeps those languages' words
  'tue', 'tues', 'tuee', 'tuees', 'mort', 'morts', 'blesse', 'blesses', 'attaque', 'attaques', 'attentat', 'gouvernement',
  'president', 'presidente', 'ministre', 'election', 'elections', 'armee', 'guerre', 'incendie', 'inondations',
  'manifestation', 'manifestations', 'greve', 'tribunal', 'proces', 'accident', 'pays', 'nationale', 'prix', 'deux', 'trois',
  'getotet', 'tote', 'toten', 'verletzte', 'verletzt', 'angriff', 'anschlag', 'polizei', 'regierung', 'prasident',
  'minister', 'ministerin', 'wahl', 'wahlen', 'krieg', 'brand', 'feuer', 'hochwasser', 'unfall', 'gericht',
  'prozess', 'land', 'landes', 'streik', 'demonstration', 'preise', 'zwei', 'drei',
  // ...and Spanish and Portuguese (Nov 10, 2026, afternoon)
  'muerto', 'muertos', 'muerta', 'muertas', 'herido', 'heridos', 'ataques', 'atentado', 'policia', 'gobierno',
  'eleccion', 'elecciones', 'ejercito', 'inundaciones', 'protesta', 'protestas', 'huelga', 'accidente', 'pais', 'nacional',
  'precio', 'precios', 'dos', 'tres', 'morto', 'mortos', 'morta', 'mortas', 'ferido', 'feridos', 'governo', 'eleicao',
  'eleicoes', 'exercito', 'inundacoes', 'protesto', 'protestos', 'acidente', 'preco', 'precos', 'dois',
  // ...and Albanian and Serbian (Nov 11, 2026), without accents, Serbian in Latin letters; with the places' own names
  // in these languages ("Kosovës", "Srbije"), which nearly every story of theirs shares
  'vdekur', 'vrare', 'plagosur', 'aksident', 'aksidenti', 'sulm', 'sulmi', 'sulmet', 'policia', 'policise', 'policine',
  'qeveria', 'qeverise', 'qeverine', 'zgjedhjet', 'zgjedhjeve', 'zjarr', 'zjarri', 'protesta', 'protestat', 'gjykata',
  'gjykates', 'kryeministri', 'kryeministrit', 'presidenti', 'presidentja', 'ministri', 'ministrja', 'ministria',
  'kuvendi', 'kuvendit', 'njerez', 'persona', 'vendi', 'vendit', 'shteti', 'shtetit', 'ushtria', 'lufta', 'luften',
  'cmimet', 'cmimeve', 'arrestohet', 'arrestimi', 'tre', 'kater', 'pese', 'dhjetera', 'qindra', 'mijera',
  'kosova', 'kosoves', 'kosove', 'kosoven', 'prishtina', 'prishtine', 'prishtines', 'shqiperi', 'shqiperia', 'shqiperise',
  'poginulo', 'poginuo', 'poginula', 'poginuli', 'mrtvih', 'ubijen', 'ubijena', 'povredeno', 'povredjeno', 'povreden',
  'povredjen', 'povrijedeno', 'napad', 'napada', 'napadu', 'policija', 'policije', 'policiji', 'vlada', 'vlade', 'vladi',
  'izbori', 'izbora', 'nesreca', 'nesreci', 'nesrece', 'saobracajna', 'pozar', 'pozara', 'protesti', 'suda', 'sudu',
  'predsednik', 'predsednika', 'predsjednik', 'predsjednika', 'premijer', 'premijera', 'ministar', 'ministra', 'ministarstvo',
  'drzava', 'drzave', 'gradani', 'gradjani', 'ljudi', 'osoba', 'vojska', 'vojske', 'rata', 'cene', 'cijene', 'uhapsen',
  'uhapseni', 'dva', 'dve', 'tri', 'cetiri', 'deset', 'desetine', 'stotine', 'hiljade',
  'srbija', 'srbije', 'srbiji', 'srbiju', 'beograd', 'beogradu',
])

/**
 * Russian and Arabic event words (Nov 10, 2026, evening), in the one form storyWords gives them (correlate.ts
 * otherScriptWords: "погибли" and "погибших" are one word, "الحكومة" and "حكومة" another)
 */
for (const word of otherScriptWords(foldAccents(
  'погибли погиб погибших погибшие убиты убит убиты ранены раненых пострадали нападение напали атака атаки армия армии ' +
  'войска полиция полиции милиция правительство правительства президент президента министр министра министерство выборы ' +
  'выборов пожар пожара авария аварии дтп протест протесты митинг суд суда люди человек жители страна страны город ' +
  'города власти депутаты парламент закон закона задержан задержали арестован взрыв удар удары обстрел ' +
  'مقتل قتلى قتيل جرحى اصابة اصابات هجوم هجمات الجيش جيش قوات الشرطة الحكومة حكومة الرئيس رئيس وزير وزارة انتخابات حريق ' +
  'حادث احتجاجات مظاهرات محكمة البلاد مواطنين اشخاص شخص المدينة مدينة البرلمان مجلس قانون اعتقال القبض انفجار قصف غارة غارات',
))) if (!word.startsWith('@') && !word.startsWith('#')) EVENTISH.add(word)

/**
 * The languages read in their own script (Nov 10, 2026): their words as storyWords reads them (Persian, Urdu, Greek and
 * Korean from Nov 18; Ukrainian, Bulgarian, Macedonian, the languages of India's own scripts and Amharic from Nov 19)
 */
const OTHER_SCRIPT_LANGUAGES = new Set([
  'ru', 'ar', 'fa', 'ur', 'el', 'ko', 'ja', 'zh', 'th', 'uk', 'bg', 'mk',
  'hi', 'mr', 'ne', 'bn', 'as', 'pa', 'gu', 'or', 'ta', 'te', 'kn', 'ml', 'si', 'am',
  // Nov 19, 2026, night: Armenian and Kazakh
  'hy', 'kk',
])

/** A headline's text as it is compared: Serbian, written in both scripts, in Latin letters ("Погинуло", "Poginulo") */
const comparable = (title: string, lang: string) => (lang === 'sr' ? serbianLatin(title) : title)

/**
 * Albanian and Serbian names change their endings with their place in a sentence ("Prishtinë", "Prishtinës";
 * "Bugarska", "Bugarskoj"), so the names test (correlate.ts namesDiffer) reads their words by their first five letters
 * (Nov 11, 2026); Croatian, Bosnian, Slovene, Polish, Ukrainian, Bulgarian and Macedonian too (Nov 19: "Warszawa",
 * "Warszawie"; "Київ", "Києві"); Czech, Slovak, Hungarian, Finnish, Estonian, Lithuanian and Latvian too (Nov 19, evening:
 * "Budapest", "Budapesten"; "Helsinki", "Helsingissä")
 */
// (and Armenian, Uzbek, Kazakh and Azerbaijani, Nov 19, night: "Երևան", "Երևանում"; "Toshkent", "Toshkentda"; "Астана", "Астанада")
const INFLECTED = new Set(['sq', 'sr', 'hr', 'bs', 'sl', 'pl', 'uk', 'bg', 'mk', 'cs', 'sk', 'hu', 'fi', 'et', 'lt', 'lv', 'hy', 'uz', 'kk', 'az'])
const namesForm = (title: string, lang: string) =>
  (INFLECTED.has(lang) ? title.replace(/\p{L}+/gu, w => Array.from(w).slice(0, 5).join('')) : title)

/**
 * Small words of French, German, Spanish and Portuguese headlines that correlate.ts's FUNCTION_WORDS leaves out
 * because they are English words or names too ("die", "son", "pas", "era"): read as small words in those languages'
 * headlines only (Nov 10, 2026)
 */
const FOREIGN_PLAIN = new Set([
  'pas', 'son', 'ces', 'cet', 'dit', 'peut', 'doit', 'veut', 'face', 'suite', 'mise', 'quoi', 'comment', 'pourquoi',
  'faut', 'deja', 'ainsi', 'entre', 'leurs', 'notre', 'votre', 'quand',
  'die', 'fur', 'mit', 'dem', 'aus', 'uber', 'unter', 'durch', 'wegen', 'nun', 'jetzt', 'soll', 'will', 'kann', 'muss',
  'gibt', 'wieder', 'alle', 'immer', 'ohne', 'zwischen', 'diese', 'dieser', 'dieses', 'sie', 'wir', 'was', 'wer', 'warum',
  'erst', 'bis', 'als', 'man', 'hat', 'war', 'sei', 'mehr', 'viele', 'neu',
  'era', 'mas', 'menos', 'ano', 'anos', 'dia', 'dias', 'ahora', 'aqui', 'asi', 'cada', 'casi', 'como',
  'nao', 'ate', 'aos', 'num', 'numa', 'pode', 'podem', 'vai', 'vao', 'agora', 'assim', 'muito',
])

/** Indonesian's and Malay's small words (Nov 19, 2026), one list for both */
const INDONESIAN_PLAIN = new Set([
  'yang', 'dan', 'dengan', 'untuk', 'dari', 'pada', 'dalam', 'akan', 'tidak', 'ini', 'itu', 'ada', 'juga', 'oleh',
  'karena', 'kepada', 'bagi', 'atas', 'sudah', 'telah', 'masih', 'bisa', 'dapat', 'harus', 'lebih', 'saat', 'setelah',
  'sebelum', 'hingga', 'sampai', 'antara', 'tentang', 'seperti', 'para', 'jadi', 'menjadi', 'kata', 'ujar', 'sebut',
  'menurut', 'baru', 'hari', 'tahun', 'bulan', 'kini', 'begini', 'begitu', 'apa', 'siapa', 'kenapa', 'mengapa', 'bagaimana',
  'kapan', 'mana', 'soal', 'terkait', 'usai', 'jelang', 'agar', 'demi', 'tapi', 'namun', 'atau', 'kami', 'kita', 'mereka',
  'dia', 'ia', 'nya', 'lagi', 'sejumlah', 'resmi', 'viral', 'video', 'foto', 'berita', 'terkini', 'ternyata',
  'yg', 'tak', 'pun', 'lah', 'kah', 'sangat', 'banyak', 'semua', 'beberapa', 'sebagai', 'adalah', 'yakni', 'bakal',
  'dgn', 'utk', 'kerana', 'selepas', 'ialah', 'iaitu',
])
/** Norwegian's small words (Bokmål as 'no' and 'nb'), without accents */
const NORWEGIAN_PLAIN = new Set([
  'var', 'blir', 'ble', 'har', 'hadde', 'som', 'det', 'den', 'til', 'fra', 'med', 'for', 'ikke', 'men', 'eller',
  'ogsa', 'bare', 'etter', 'mellom', 'over', 'under', 'nye', 'nytt', 'aret', 'dag', 'sier', 'kan', 'skal', 'vil',
  'video', 'bilder', 'hvorfor', 'hvordan', 'hva', 'hvem', 'hvor', 'nar',
])
/** Serbian's small words (Nov 11, 2026), without accents; Croatian's and Bosnian's too */
const SERBIAN_PLAIN = new Set([
  'kako', 'gde', 'gdje', 'zasto', 'ali', 'jer', 'ako', 'dok', 'sada', 'samo', 'jos', 'kada', 'kad', 'posle', 'poslije',
  'pre', 'prije', 'iako', 'ovo', 'ova', 'ove', 'ovaj', 'ovog', 'ovom', 'taj', 'tog', 'toga', 'tom', 'ima', 'imaju',
  'bio', 'bili', 'bude', 'budu', 'nisu', 'treba', 'mogu', 'moze', 'hoce', 'nece', 'evo', 'njegov', 'njegova',
  'njegove', 'njen', 'njena', 'njihov', 'njihova', 'svoj', 'svoje', 'svoju', 'nas', 'vas', 'njih', 'oni', 'ona',
  'ono', 'sam', 'smo', 'ste', 'kroz', 'medu', 'medju', 'izmedu', 'iza', 'ispod', 'iznad', 'pored', 'osim', 'nova',
  'novo', 'novih', 'novog', 'novu', 'godine', 'godina', 'godini', 'dana', 'rekao', 'rekla', 'kaze', 'kazao', 'navodi',
  'tvrdi', 'izjavio', 'jedan', 'jedna', 'jedno', 'jednog', 'kojem', 'kojoj', 'kojima', 'kojih', 'cak',
])
/** Small words of one language's headlines only (Nov 11, 2026): Albanian and Serbian, without accents */
const PLAIN_IN: Readonly<Record<string, ReadonlySet<string>>> = {
  // Nov 19, 2026 (Devon, 5:33 PM: "Proceed with 1-3"): Vietnamese, Indonesian and Malay, Turkish and Polish, without
  // their accents as storyTokens reads them (a Vietnamese word is its syllables)
  vi: new Set([
    'cua', 'cho', 'voi', 'nhung', 'mot', 'cac', 'trong', 'tren', 'duoi', 'sau', 'truoc', 'khi', 'neu', 'thi', 'nhu',
    'nay', 'theo', 'duoc', 'dang', 'cung', 'van', 'rat', 'nhieu', 'hon', 'nhat', 'ngay', 'thang', 'gio', 'moi', 'khong',
    'chua', 'the', 'sao', 'nao', 'dau', 'nen', 'hay', 'hoac', 'den', 'vao', 'len', 'xuong', 'lai', 'con', 'boi', 'nhan',
    'clip', 'video', 'truc', 'tiep', 'tin', 'tuc', 'hom', 'qua', 'dieu', 'viec', 'nguoi', 'chi',
  ]),
  id: INDONESIAN_PLAIN,
  ms: INDONESIAN_PLAIN,
  // Nov 19, 2026, evening: Hungarian, Czech, Slovak, Finnish, Estonian, Lithuanian, Latvian, Norwegian and Swahili, without
  // their accents as storyTokens reads them
  hu: new Set([
    'egy', 'hogy', 'nem', 'van', 'volt', 'lesz', 'mar', 'meg', 'csak', 'mint', 'mert', 'fel', 'utan', 'elott', 'kozott',
    'alatt', 'felett', 'miatt', 'szerint', 'ujabb', 'nagy', 'tobb', 'minden', 'ezt', 'azt', 'ezek', 'azok', 'itt', 'ott',
    'most', 'tegnap', 'holnap', 'evi', 'eves', 'kiderult', 'video', 'fotok', 'ilyen', 'olyan', 'amely', 'aki', 'ami',
    'mely', 'miert', 'hogyan', 'mikor', 'mit', 'kik', 'neki', 'nekik', 'vele', 'veluk', 'sem', 'pedig', 'vagy', 'illetve',
    'tovabba', 'lett', 'lehet', 'kell', 'fog', 'fognak', 'nincs', 'sincs', 'jon', 'megint', 'mondta', 'szerda', 'csutortok',
  ]),
  cs: new Set([
    'jak', 'uz', 'jen', 'take', 'ale', 'nebo', 'ten', 'tento', 'tato', 'toto', 'ktere', 'ktery', 'ktera', 'jsou', 'byl',
    'byla', 'bylo', 'byli', 'bude', 'budou', 'maji', 'neni', 'nove', 'novy', 'nova', 'roku', 'let', 'dnes', 'vcera',
    'zitra', 'proc', 'kdy', 'kde', 'kdo', 'jake', 'video', 'foto', 'muze', 'mohou', 'chce', 'rekl', 'uvedl', 'podle',
    'pred', 'mezi', 'pres', 'kvuli', 'behem', 'vice', 'nejen', 'vsak', 'tak', 'jako', 'nez', 'aby', 'pro', 'pri',
  ]),
  sk: new Set([
    'ako', 'uz', 'len', 'tiez', 'ale', 'alebo', 'ten', 'tento', 'tato', 'toto', 'ktore', 'ktory', 'ktora', 'bol', 'bola',
    'bolo', 'boli', 'bude', 'budu', 'maju', 'nie', 'nove', 'novy', 'nova', 'roku', 'rokov', 'dnes', 'vcera', 'zajtra',
    'preco', 'kedy', 'kde', 'kto', 'ake', 'video', 'foto', 'moze', 'mozu', 'chce', 'povedal', 'uviedol', 'podla', 'pred',
    'medzi', 'cez', 'kvoli', 'pocas', 'viac', 'vsak', 'tak', 'nez', 'aby', 'pre', 'pri',
  ]),
  fi: new Set([
    'oli', 'ovat', 'olla', 'kun', 'jos', 'etta', 'mutta', 'tai', 'myos', 'nyt', 'vain', 'viela', 'kaikki', 'tama',
    'tassa', 'nain', 'sen', 'sita', 'siita', 'joka', 'jotka', 'mika', 'miksi', 'miten', 'missa', 'milloin', 'kuka', 'uusi',
    'uuden', 'vuoden', 'vuonna', 'paivan', 'tanaan', 'eilen', 'huomenna', 'video', 'kuvat', 'mukaan', 'jalkeen', 'ennen',
    'aikana', 'yli', 'alle', 'noin', 'lahes', 'kertoo', 'sanoo', 'voi', 'pitaa', 'tulee', 'ei',
  ]),
  et: new Set([
    'oli', 'see', 'kui', 'aga', 'voi', 'veel', 'juba', 'ainult', 'koik', 'mis', 'kes', 'miks', 'kuidas', 'kus', 'millal',
    'uus', 'uue', 'aasta', 'tana', 'eile', 'homme', 'video', 'fotod', 'parast', 'enne', 'vahel', 'ule', 'umbes',
    'peaaegu', 'utleb', 'saab', 'peab', 'tuleb', 'pole',
  ]),
  lt: new Set([
    'yra', 'buvo', 'bus', 'kad', 'kai', 'jei', 'bet', 'taip', 'pat', 'dar', 'jau', 'tik', 'visi', 'visos', 'kuris',
    'kuri', 'kurie', 'kas', 'kodel', 'kaip', 'kur', 'kada', 'naujas', 'nauja', 'metu', 'siandien', 'vakar', 'rytoj',
    'video', 'nuotraukos', 'pagal', 'pries', 'tarp', 'per', 'apie', 'del', 'daugiau', 'sako', 'teigia', 'gali', 'turi',
  ]),
  lv: new Set([
    'bija', 'bus', 'kad', 'bet', 'vai', 'ari', 'vel', 'jau', 'tikai', 'visi', 'kas', 'kurs', 'kura', 'kuri', 'kapec',
    'kur', 'jauns', 'jauna', 'gada', 'sodien', 'vakar', 'rit', 'video', 'foto', 'pec', 'pirms', 'starp', 'par', 'del',
    'vairak', 'saka', 'var', 'nav',
  ]),
  no: NORWEGIAN_PLAIN,
  nb: NORWEGIAN_PLAIN,
  sw: new Set([
    'katika', 'kuwa', 'huku', 'hiyo', 'hii', 'hizi', 'hayo', 'huo', 'yake', 'wake', 'zake', 'yao', 'wao', 'sasa', 'leo',
    'jana', 'kesho', 'mpya', 'zaidi', 'baada', 'kabla', 'kati', 'juu', 'chini', 'dhidi', 'kama', 'lakini', 'pia', 'bado',
    'kuhusu', 'video', 'picha', 'asema', 'alisema', 'amesema', 'wasema', 'kwa',
  ]),
  tr: new Set([
    'icin', 'bir', 'gibi', 'kadar', 'sonra', 'once', 'olan', 'olarak', 'oldu', 'olmak', 'daha', 'cok', 'nasil', 'neden',
    'kim', 'hangi', 'her', 'tum', 'butun', 'ama', 'ancak', 'fakat', 'veya', 'yeni', 'son', 'ilk', 'iki', 'dedi', 'acikladi',
    'aciklama', 'iddia', 'haberi', 'haber', 'canli', 'video', 'foto', 'galeri', 'sicak', 'gelisme', 'gundem', 'bugun',
    'dun', 'yarin', 'karsi', 'uzere', 'diye', 'artik', 'hala', 'bile', 'sadece', 'bunu', 'buna', 'bunun', 'sey', 'var',
    'yok', 'geldi', 'etti', 'edildi', 'yapti', 'yapildi', 'verdi', 'aldi', 'ile', 'icinde', 'uzerine', 'hakkinda', 'gore',
    'tarafindan', 'dakika', 'flas', 'aciklandi', 'belli', 'oldugu', 'olacak', 'oluyor',
  ]),
  pl: new Set([
    'jest', 'nie', 'sie', 'dla', 'oraz', 'jak', 'jako', 'ale', 'czy', 'tak', 'juz', 'jeszcze', 'tylko', 'przez', 'przy',
    'pod', 'nad', 'bez', 'ten', 'tego', 'tej', 'tym', 'ktory', 'ktora', 'ktore', 'ktorzy', 'jego', 'jej', 'ich', 'byl',
    'byla', 'bylo', 'byli', 'bedzie', 'moze', 'maja', 'mial', 'teraz', 'dzis', 'wczoraj', 'jutro', 'nowy', 'nowa', 'nowe',
    'roku', 'lat', 'lata', 'dni', 'powiedzial', 'mowi', 'twierdzi', 'wiadomosci', 'relacja', 'wideo', 'zdjecia', 'kiedy',
    'gdzie', 'dlaczego', 'kto', 'wiecej', 'bardzo', 'pierwszy', 'pierwsza', 'sobie', 'swoje', 'swoj', 'jednak', 'nawet',
    'po', 'przed', 'miedzy', 'wobec', 'podczas', 'wsrod', 'okolo', 'ponad', 'prawie', 'wszystko', 'wszyscy', 'zostal',
    'zostala', 'zostalo', 'zostali', 'beda', 'tez', 'takze', 'chce', 'trzeba', 'pilne', 'oto',
  ]),
  sq: new Set([
    'per', 'nga', 'ndaj', 'gjate', 'sipas', 'kane', 'kemi', 'keni', 'jemi', 'jeni', 'kishte', 'ishin', 'qene', 'tij',
    'saj', 'tyre', 'atij', 'asaj', 'atyre', 'ketij', 'kesaj', 'keto', 'ato', 'ata', 'ajo', 'cila', 'cili', 'cilat',
    'cfare', 'pse', 'kush', 'kur', 'ende', 'vetem', 'tani', 'shume', 'mund', 'duhet', 'thote', 'tha', 'behet', 'rreth',
    'drejt', 'permes', 'prej', 'tek', 'mes', 'midis', 'kunder', 'dje', 'neser', 'por', 'apo', 'nese', 'sepse', 'ndersa',
    'pasi', 'pra', 'gjithe', 'cdo', 'disa', 'tjeter', 'tjera', 'reja', 'tona', 'tone', 'juaj', 'tuaj',
  ]),
  sr: SERBIAN_PLAIN,
  // Croatian and Bosnian (Nov 19, 2026, night): Serbian's small words
  hr: SERBIAN_PLAIN,
  bs: SERBIAN_PLAIN,
  // Nov 19, 2026, night: Swedish, Azerbaijani and Uzbek, without accents and apostrophes as storyTokens reads them
  sv: new Set([
    'och', 'att', 'det', 'som', 'den', 'till', 'for', 'med', 'fran', 'efter', 'under', 'over', 'mot', 'inte', 'har', 'hade',
    'var', 'blir', 'blev', 'kan', 'ska', 'vill', 'nya', 'nytt', 'aret', 'dag', 'idag', 'igar', 'sager', 'enligt', 'video',
    'bilder', 'hur', 'varfor', 'vad', 'vem', 'nar', 'dar', 'alla', 'mer', 'manga', 'inga', 'men', 'eller', 'ocksa', 'bara',
    'mellan', 'kommer', 'gor', 'far', 'fick', 'finns', 'stor', 'stora', 'forsta', 'han', 'hon',
  ]),
  az: new Set([
    'ilə', 'ucun', 'olan', 'olub', 'edib', 'bir', 'daha', 'artiq', 'sonra', 'əvvəl', 'barədə', 'gorə', 'kimi', 'yeni', 'gun',
    'bugun', 'dunən', 'necə', 'niyə', 'video', 'foto', 'dedi', 'bildirib', 'aciqlayib', 'deyib', 'olacaq', 'edəcək', 'isə',
    'həm', 'amma', 'lakin', 'cox', 'hər', 'onun', 'onlar', 'biz', 'siz', 'xəbər', 'xəbərlər',
  ]),
  uz: new Set([
    'bilan', 'uchun', 'esa', 'ham', 'shu', 'bir', 'yangi', 'yil', 'kun', 'bugun', 'kecha', 'qanday', 'nima', 'nega', 'qachon',
    'emas', 'bor', 'yoq', 'haqida', 'boyicha', 'keyin', 'oldin', 'orqali', 'kabi', 'yana', 'endi', 'hali', 'barcha', 'koplab',
    'video', 'foto', 'dedi', 'aytdi', 'malum', 'qildi', 'boldi', 'etdi', 'mumkin', 'kerak', 'uning', 'ular', 'biz', 'siz',
  ]),
}

/**
 * A headline's words that can tie it to another outlet's: lower case, 3 or more letters or digits, no plain words.
 * A French or German headline's (Nov 10, 2026) without their accents ("hausse", "hausse"; "prasident"), and without
 * those languages' small words too (correlate.ts FUNCTION_WORDS, FOREIGN_PLAIN): "les", "pour", "das", "und". An
 * Albanian or Serbian one's the same way (Nov 11, 2026; PLAIN_IN), a Serbian one in Latin letters
 */
export function storyTokens(title: string, lang = 'en'): string[] {
  const foreign = lang !== 'en'
  const out = new Set<string>()
  if (OTHER_SCRIPT_LANGUAGES.has(lang)) {
    // A Russian or Arabic headline (Nov 10, 2026): its words in storyWords' one form, without the little words
    // and the countries; its numbers and Latin words as an English headline's
    const folded = foldAccents(westernDigits(title))
    for (const word of otherScriptWords(folded)) if (!word.startsWith('@') && !word.startsWith('#')) out.add(word)
    for (const raw of folded.split(/[^a-z0-9]+/)) if (raw.length >= 3 && !PLAIN.has(raw)) out.add(raw)
    return [...out]
  }
  // (Uzbek's o‘ and g‘ with any of their marks, Nov 19, 2026: "O‘zbekiston", "Oʻzbekiston", "O'zbekiston")
  const text = comparable(title, lang).replace(/[‘’ʻʼ`]/g, "'")
  const plainHere = PLAIN_IN[lang]
  for (const raw of (foreign ? foldAccents(text) : text.toLowerCase()).split(/[^\p{L}\p{N}']+/u)) {
    // (a French elision is no word of its own: "l'armée", "d'Iran", "qu'il")
    const word = foreign ? raw.replace(/^(?:[a-z]|qu|jusqu|lorsqu|puisqu)'/, '').replace(/'/g, '') : raw.replace(/'s$/, '').replace(/'/g, '')
    if (word.length < 3 || PLAIN.has(word)) continue
    if (foreign && (FUNCTION_WORDS.has(word) || FOREIGN_PLAIN.has(word) || plainHere?.has(word))) continue
    out.add(word)
  }
  return [...out]
}

/**
 * For each report, the articles that share two or more of its words, one at
 * least not a word of a kind of event, the most shared first
 */
export function candidatePairs(reports: Array<{ tokens: string[] }>, articles: Array<{ tokens: string[] }>): Map<number, number[]> {
  const index = new Map<string, number[]>()
  reports.forEach((r, i) => { for (const t of r.tokens) { const list = index.get(t); if (list) list.push(i); else index.set(t, [i]) } })
  const out = new Map<number, Array<{ a: number; n: number }>>()
  articles.forEach((article, a) => {
    const shared = new Map<number, { n: number; telling: boolean }>()
    for (const t of article.tokens) {
      const list = index.get(t)
      if (!list) continue
      const telling = !EVENTISH.has(t)
      for (const r of list) {
        const s = shared.get(r)
        if (s) { s.n++; s.telling ||= telling } else shared.set(r, { n: 1, telling })
      }
    }
    for (const [r, s] of shared) {
      if (s.n < 2 || !s.telling) continue
      const list = out.get(r)
      if (list) list.push({ a, n: s.n }); else out.set(r, [{ a, n: s.n }])
    }
  })
  return new Map([...out].map(([r, list]) => [r, list.sort((x, y) => y.n - x.n).map(x => x.a)]))
}

// ─── Which articles are other outlets ────────────────────────────────────────

/**
 * Websites whose articles aren't another newsroom's reporting: readers and
 * aggregators that carry other outlets' articles, press-release wires, social
 * and blog platforms, and the known AI content farms (the list in
 * packages/types/src/ai-content-farms.ts)
 */
export const NOT_OUTLETS = new Set([
  'aol.com', 'archive.org', 'archive.ph', 'bignewsnetwork.com', 'dailyhunt.in', 'devdiscourse.com', 'dnyuz.com',
  'flipboard.com', 'google.com', 'ground.news', 'headtopics.com', 'inkl.com', 'latestly.com', 'menafn.com', 'msn.com',
  'newsbreak.com', 'newsnow.co.uk', 'pressreader.com', 'theworldnews.net', 'yahoo.com', 'zawya.com',
  'accesswire.com', 'businesswire.com', 'einpresswire.com', 'globenewswire.com', 'newswire.com', 'openpr.com',
  'prnewswire.com', 'prweb.com', 'csrwire.com', '3blmedia.com', 'einnews.com', 'finanznachrichten.de', 'pr-inside.com',
  'prlog.org',
  // republishers seen in GDELT's list on Oct 22: other outlets' articles under their own name
  'allafrica.com', 'aol.co.uk', 'cedarnews.net', 'ghanamma.com', 'hawaiitelegraph.com', 'iheart.com', 'indiagazette.com',
  'heraldglobe.com', 'kenyastar.com', 'netscape.com', 'newjerseytelegraph.com', 'nigerianeye.com', 'romaniapress.com',
  'russiaherald.com', 'wn.com', 'zerohedge.com',
  'blogspot.com', 'facebook.com', 'medium.com', 'reddit.com', 'substack.com', 'tumblr.com', 'twitter.com',
  'wordpress.com', 'x.com', 'youtube.com',
  'allnewsupdate.net', 'breakingnewsreporter.com', 'currentnewspaper.net', 'dailynewspulse.net', 'dailytrendingnews.net',
  'fastbreaking.news', 'flashbulletinnews.com', 'globalheadlines24.net', 'headlineinsider.com', 'justintrendstoday.com',
  'morningtidings.com', 'nationalnewsbrief.com', 'newsbreakfeed.co', 'newsnow24.co', 'politicswatch24.com',
  'realclearnewsfeed.com', 'theamericas24.com', 'thenewsglobe.net', 'thepoliticsnews.com', 'trendingreporters.com',
  'urgentdispatch.net', 'usadailytimes.com', 'usanewsflash.com', 'worldnewsdaily24.com', 'worldpresswire.io',
])

/**
 * One owner's websites count as one: its papers share stories (in the dry run
 * of Oct 22, Torstar's Spectator and Niagara Falls Review, Reach's Express and
 * Daily Star, Newsquest's Northwich Guardian and Messenger "confirmed" each
 * other). The big chains whose papers GDELT reads most; any other website is
 * its own owner.
 */
const OWNER_GROUPS: Record<string, string[]> = {
  bbc: ['bbc.co.uk', 'bbc.com'],
  aol: ['aol.com', 'aol.co.uk'],
  guardian: ['theguardian.com', 'guardian.co.uk'],
  reach: ['express.co.uk', 'dailystar.co.uk', 'mirror.co.uk', 'themirror.com', 'dailyrecord.co.uk', 'chroniclelive.co.uk',
    'manchestereveningnews.co.uk', 'liverpoolecho.co.uk', 'walesonline.co.uk', 'birminghammail.co.uk', 'irishmirror.ie',
    'belfastlive.co.uk', 'bristolpost.co.uk', 'nottinghampost.com', 'leicestermercury.co.uk', 'hulldailymail.co.uk',
    'devonlive.com', 'cornwalllive.com', 'kentlive.news', 'mylondon.news', 'examinerlive.co.uk', 'lancs.live',
    'gloucestershirelive.co.uk', 'stokesentinel.co.uk', 'derbytelegraph.co.uk', 'coventrytelegraph.net', 'glasgowlive.co.uk',
    'edinburghlive.co.uk', 'dailypost.co.uk', 'hertfordshiremercury.co.uk', 'getsurrey.co.uk', 'irishstar.com', 'ok.co.uk'],
  newsquest: ['thenorthernecho.co.uk', 'glasgowtimes.co.uk', 'heraldscotland.com', 'thenational.scot', 'bournemouthecho.co.uk',
    'dailyecho.co.uk', 'theargus.co.uk', 'oxfordmail.co.uk', 'yorkpress.co.uk', 'thetelegraphandargus.co.uk',
    'lancashiretelegraph.co.uk', 'theboltonnews.co.uk', 'southwalesargus.co.uk', 'messengernewspapers.co.uk',
    'northwichguardian.co.uk', 'thecomet.net', 'edp24.co.uk', 'eveningnews24.co.uk', 'ipswichstar.co.uk', 'eadt.co.uk',
    'newsandstar.co.uk', 'nwemail.co.uk', 'hexham-courant.co.uk', 'thenorthernecho.co.uk', 'worcesternews.co.uk',
    'swindonadvertiser.co.uk', 'wiltshiretimes.co.uk', 'gazetteandherald.co.uk', 'dorsetecho.co.uk', 'eastlondonadvertiser.co.uk'],
  nationalworld: ['scotsman.com', 'yorkshirepost.co.uk', 'yorkshireeveningpost.co.uk', 'sunderlandecho.com', 'shieldsgazette.com',
    'lep.co.uk', 'thestar.co.uk', 'newsletter.co.uk', 'nationalworld.com', 'edinburghnews.scotsman.com'],
  postmedia: ['nationalpost.com', 'financialpost.com', 'calgaryherald.com', 'calgarysun.com', 'edmontonjournal.com', 'edmontonsun.com',
    'vancouversun.com', 'theprovince.com', 'ottawacitizen.com', 'ottawasun.com', 'montrealgazette.com', 'torontosun.com',
    'winnipegsun.com', 'leaderpost.com', 'thestarphoenix.com', 'windsorstar.com', 'lfpress.com', 'thewhig.com', 'canada.com'],
  torstar: ['thestar.com', 'thespec.com', 'niagarafallsreview.ca', 'wellandtribune.ca', 'stcatharinesstandard.ca', 'therecord.com',
    'guelphmercury.com', 'simcoe.com', 'durhamregion.com', 'insidehalton.com', 'thepeterboroughexaminer.com'],
  gannett: ['usatoday.com', 'cincinnati.com', 'freep.com', 'jsonline.com', 'indystar.com', 'azcentral.com', 'tennessean.com',
    'desmoinesregister.com', 'courier-journal.com', 'democratandchronicle.com', 'northjersey.com', 'app.com', 'lohud.com',
    'detroitnews.com', 'commercialappeal.com', 'statesman.com', 'palmbeachpost.com', 'jacksonville.com', 'dispatch.com'],
  alden: ['chicagotribune.com', 'nydailynews.com', 'baltimoresun.com', 'orlandosentinel.com', 'sun-sentinel.com', 'courant.com',
    'mcall.com', 'dailypress.com', 'pilotonline.com', 'mercurynews.com', 'eastbaytimes.com', 'denverpost.com', 'ocregister.com',
    'presstelegram.com', 'dailynews.com', 'twincities.com', 'bostonherald.com', 'sbsun.com', 'dailybulletin.com', 'pe.com'],
  mcclatchy: ['miamiherald.com', 'kansascity.com', 'sacbee.com', 'star-telegram.com', 'newsobserver.com', 'charlotteobserver.com',
    'kentucky.com', 'thestate.com', 'idahostatesman.com', 'fresnobee.com', 'bnd.com', 'thenewstribune.com', 'heraldsun.com'],
  hearst: ['sfchronicle.com', 'sfgate.com', 'houstonchronicle.com', 'chron.com', 'timesunion.com', 'ctpost.com', 'nhregister.com',
    'expressnews.com', 'mysanantonio.com', 'seattlepi.com', 'stamfordadvocate.com', 'greenwichtime.com'],
  lee: ['tucson.com', 'stltoday.com', 'omaha.com', 'richmond.com', 'buffalonews.com', 'journalstar.com', 'madison.com',
    'wcfcourier.com', 'qctimes.com', 'roanoke.com', 'pantagraph.com', 'nwitimes.com'],
  cox: ['wokv.com', 'krmg.com', 'wsbradio.com', 'whio.com', 'wftv.com'],
}
const OWNERS = new Map(Object.entries(OWNER_GROUPS).flatMap(([group, sites]) => sites.map(site => [site, group] as const)))
export const ownerOf = (site: string): string => OWNERS.get(site) ?? site

/** Pieces about a story, not reports of it: a factbox, an explainer, a live page, an opinion */
export const FEATURE_RE = /^(?:factbox|fact\s?check|explainer|analysis|timeline|opinion|editorial|letter|live|watch|q&a|quiz|podcast|in pictures|photos?)\b|^(?:who|what|why|how)\s+(?:is|are|was|were|to|do|does|did)\b/i

/**
 * Whether one headline is another's copy with a little added or cut: 85% or
 * more of the shorter one's words (5 or more) in the longer one ("Nigeria:
 * Kaduna Journalist Granted Bail ..." on a republisher, a wire story's
 * headline reworded on a member paper, "... - ICIJ"). One wire story on
 * several papers is one source. In French or German (Nov 10, 2026) by their
 * headline words without the small words, 4 or more: "de", "du" and "la" made
 * RFI's "hausse de 20 % du prix du carburant à Bujumbura" a copy of "le prix du
 * carburant augmente de 20 % à Bujumbura"
 */
export function nearCopy(a: string, b: string, lang = 'en'): boolean {
  // (a Russian or Arabic headline by its words as written, accents folded: one form of each word made a rewording
  // with the same words, "зарплаты учителей вырастут" for "о повышении зарплат учителям", a copy; Nov 10, 2026)
  const foreign = lang !== 'en' && !OTHER_SCRIPT_LANGUAGES.has(lang)
  const words = (t: string) => foreign
    ? storyTokens(t, lang)
    : (OTHER_SCRIPT_LANGUAGES.has(lang) ? foldAccents(t) : t.toLowerCase()).replace(/[\u2018\u2019']/g, '').split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1)
  const [wa, wb] = [words(a), words(b)]
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  if (short.length < (foreign ? 4 : 5)) return false
  const inLong = new Set(long)
  return short.filter(w => inLong.has(w)).length / short.length >= 0.85
}

/** A report waiting for a second outlet */
export interface HeldReport {
  id: string
  title: string
  category: string
  severity: string
  published_at: Date | string
  original_urls: string[]
  source_ids: string[]
  location_name: string | null
  lat: number | null
  lng: number | null
  tags: string[]
  /** Its language: 'en' (the default), 'fr', 'de', 'es', 'pt', 'ru', 'ar' (Nov 10, 2026), 'sq' or 'sr' (Nov 11) */
  language?: string
}

export interface FoundOutlet { url: string; title: string; site: string; at: Date }

/**
 * The articles that are other outlets' reports of this report's story, at
 * most `max`, in the order given (the most words shared first)
 */
export function otherOutlets(report: HeldReport, articles: GdeltArticle[], now = new Date(), max = MAX_ADDED): FoundOutlet[] {
  const lang = report.language || 'en'
  const held: CorrelationCandidate = {
    id: report.id,
    // a Serbian headline in Latin letters, as its articles are compared (Nov 11, 2026)
    title: comparable(report.title, lang),
    category: report.category,
    severity: report.severity,
    source_id: sourceKey(report.source_ids, report.original_urls, report.id),
    location_name: report.location_name,
    lat: report.lat,
    lng: report.lng,
    published_at: report.published_at,
    reliability_score: 0,
    tags: [],
    url: report.original_urls[0] ?? null,
  }
  const sites = new Set(report.original_urls.map(u => ownerOf(siteOf(hostOf(u)))).filter(Boolean))
  const found: FoundOutlet[] = []
  for (const { url, title, site, at, lang: articleLang } of articles) {
    if (found.length >= max) break
    // a French report with French articles, a German one with German articles, an English one with the English list's
    if ((articleLang || 'en') !== lang) continue
    if (!site || sites.has(ownerOf(site)) || NOT_OUTLETS.has(site)) continue
    if (at.getTime() > now.getTime() + 10 * 60_000) continue
    if (FEATURE_RE.test(title)) continue
    const other: CorrelationCandidate = { ...held, id: 'gdelt', title: comparable(title, lang), source_id: site, published_at: at, url, lat: null, lng: null }
    // (German capitalises every noun, so there the names test is strict: a German report finds fewer matches, never looser ones)
    if (!isSameStory(held, other) || namesDiffer(namesForm(held.title, lang), namesForm(other.title, lang))) continue
    if (isCopyOf({ url, title }, { urls: report.original_urls, title: report.title }) || nearCopy(title, report.title, lang)) continue
    if (found.some(f => isCopyOf({ url, title }, { urls: [f.url], title: f.title }) || nearCopy(title, f.title, lang))) continue
    sites.add(ownerOf(site))
    found.push({ url: cleanUrl(url), title, site, at })
  }
  return found
}

/** Whether a report is news another outlet could carry: not a machine feed's (aircraft, fires, quakes), not a template headline */
export function searchable(report: Pick<HeldReport, 'title' | 'tags' | 'language'>): boolean {
  const tags = new Set(report.tags.map(t => String(t).toLowerCase()))
  if (tags.has('osint') && !tags.has('gdelt')) return false
  if (isEventTemplateTitle(report.title)) return false
  return storyTokens(report.title, report.language || 'en').length >= 3
}

// ─── The articles held ───────────────────────────────────────────────────────

type HeldArticle = GdeltArticle & { tokens: string[] }

/** GDELT's files of the last 8 hours, a batch a file */
export class ArticleWindow {
  private batches: Array<{ stamp: string; articles: HeldArticle[] }> = []

  add(stamp: string, articles: GdeltArticle[]): void {
    if (this.batches.some(b => b.stamp === stamp)) return
    this.batches.push({ stamp, articles: articles.map(a => ({ ...a, tokens: storyTokens(a.title, a.lang || 'en') })) })
    this.batches.sort((a, b) => a.stamp.localeCompare(b.stamp))
  }

  /** Drop the files older than `keepMs` before `now` */
  evict(now: Date, keepMs = WINDOW_KEEP_MS): void {
    this.batches = this.batches.filter(b => stampDate(b.stamp).getTime() >= now.getTime() - keepMs)
  }

  newest(): string | null {
    return this.batches.length ? this.batches[this.batches.length - 1]!.stamp : null
  }

  /** The articles of the files after `stamp` (all with null) */
  after(stamp: string | null): HeldArticle[] {
    return this.batches.filter(b => stamp === null || b.stamp > stamp).flatMap(b => b.articles)
  }

  get size(): number {
    return this.batches.reduce((n, b) => n + b.articles.length, 0)
  }
}

/** What a cycle keeps for the next: the articles held, and how far each report has been compared */
export interface FinderState {
  window: ArticleWindow
  /** The newest file each report was compared with */
  compared: Map<string, string>
  /** The translated list's French and German articles, and how far each French or German report was compared (Nov 10, 2026) */
  translated: ArticleWindow
  comparedTranslated: Map<string, string>
  /** The everyday reports on trial (Nov 21, 2026) */
  everyday: EverydayState
}

/** The everyday reports on trial: those held, read up to `since` (their newest created_at), how far each was compared, those written down */
export interface EverydayState {
  held: Map<string, { report: HeldReport; readAt: number }>
  since: string | null
  compared: Map<string, string>
  comparedTranslated: Map<string, string>
  noted: Set<string>
}

const newEveryday = (): EverydayState => ({ held: new Map(), since: null, compared: new Map(), comparedTranslated: new Map(), noted: new Set() })

export const newState = (): FinderState => ({ window: new ArticleWindow(), compared: new Map(), translated: new ArticleWindow(), comparedTranslated: new Map(), everyday: newEveryday() })

// ─── A cycle ─────────────────────────────────────────────────────────────────

export interface CycleStats {
  files: number
  articles: number
  reports: number
  pairs: number
  matched: number
  outlets: number
  promoted: number
  crosschecked: number
  errors: number
  /** Of the reports matched, the quiet places' everyday (low) ones (Nov 10, 2026) */
  everyday: number
  /** The other places' everyday reports on trial (Nov 21, 2026): read this cycle, articles compared, matched, outlets they would get */
  trial_read: number
  trial_pairs: number
  trial_matched: number
  trial_outlets: number
}

export interface SecondOutletDeps {
  newestStamp(): Promise<string | null>
  fetchArticles(stamp: string): Promise<GdeltArticle[] | null>
  /** The translated list (Nov 10, 2026): its newest file, and one file's French and German articles; none, none read */
  newestTranslatedStamp?(): Promise<string | null>
  fetchTranslated?(stamp: string): Promise<GdeltArticle[] | null>
  /** The reports waiting for a second outlet now */
  waiting(now: Date): Promise<HeldReport[]>
  /** Add the outlets; true when the report turned verified */
  add(report: HeldReport, found: FoundOutlet[], crossCheck: boolean): Promise<boolean>
  crossChecksToday(day: string): Promise<number>
  lock(): Promise<boolean>
  unlock(): Promise<void>
  count(day: string, stats: CycleStats): Promise<void>
  remember(entry: Record<string, unknown>): Promise<void>
  /** The last cycle's files and counts, kept for reading */
  trace(entry: Record<string, unknown>): Promise<void>
  clock(): number
  /** On trial (Nov 21, 2026): the other places' everyday reports created after `since` (or lately), oldest first */
  everydayNew?(since: string | null, now: Date): Promise<Array<HeldReport & { created_at: string }>>
  /** Of these reports, those still waiting (pending, one outlet) */
  stillWaiting?(ids: string[]): Promise<Set<string>>
  /** Write down what the trial found */
  note?(entry: Record<string, unknown>): Promise<void>
}

/** What the last cycle read, for GET /api/v1/public/second-outlets (second-outlet:last-cycle) */
let lastTrace: Record<string, unknown> | null = null

const emptyStats = (): CycleStats => ({
  files: 0, articles: 0, reports: 0, pairs: 0, matched: 0, outlets: 0, promoted: 0, crosschecked: 0, errors: 0, everyday: 0,
  trial_read: 0, trial_pairs: 0, trial_matched: 0, trial_outlets: 0,
})

type FileTrace = { newest: string | null; read: Array<[string, number]>; missing: string[]; failed: Array<[string, string]> }

/** One list's new files into its window: the English list's, or the translated list's French and German (Nov 10, 2026) */
async function readNewFiles(
  window: ArticleWindow,
  newestStamp: () => Promise<string | null>,
  fetchFile: (stamp: string) => Promise<GdeltArticle[] | null>,
  stats: CycleStats,
  list: string,
): Promise<FileTrace> {
  const newest = await newestStamp().catch(err => { stats.errors++; logger.warn({ err, list }, 'Second outlet: GDELT file list unreadable'); return null })
  const trace: FileTrace = { newest, read: [], missing: [], failed: [] }
  if (!newest) return trace
  const held = window.newest()
  // With a window held, a file not read yet stops the cycle (GIVE_UP_MS); after a restart nothing is lost
  const waitFor = (stamp: string) => held !== null && stampDate(newest).getTime() - stampDate(stamp).getTime() < GIVE_UP_MS
  for (const stamp of filesToRead(newest, held, held ? MAX_FILES : WARM_FILES)) {
    let articles: GdeltArticle[] | null = null
    try {
      articles = await fetchFile(stamp)
    } catch (err) {
      stats.errors++
      trace.failed.push([stamp, String((err as Error)?.message || err).slice(0, 120)])
      logger.warn({ err, stamp, list }, 'Second outlet: GDELT file unreadable')
      if (waitFor(stamp)) break
      continue
    }
    if (!articles) { trace.missing.push(stamp); if (waitFor(stamp)) break; continue }
    window.add(stamp, articles)
    stats.files++
    stats.articles += articles.length
    trace.read.push([stamp, articles.length])
  }
  return trace
}

/** One cycle: GDELT's new files in, every waiting report compared with what it hasn't been compared with */
export async function runSecondOutlets(state: FinderState, deps: SecondOutletDeps = liveDeps): Promise<CycleStats> {
  const stats = emptyStats()
  if (!(await deps.lock())) return stats
  const now = new Date(deps.clock())
  const day = now.toISOString().slice(0, 10)
  try {
    // 1. GDELT's new files: the English list's, and the translated list's French and German articles
    const trace = await readNewFiles(state.window, () => deps.newestStamp(), stamp => deps.fetchArticles(stamp), stats, 'english')
    const { newestTranslatedStamp, fetchTranslated } = deps
    const translated = newestTranslatedStamp && fetchTranslated
      ? await readNewFiles(state.translated, () => newestTranslatedStamp.call(deps), stamp => fetchTranslated.call(deps, stamp), stats, 'translated')
      : null
    lastTrace = { at: now.toISOString(), ...trace, ...(translated ? { translated } : {}) }
    state.window.evict(now)
    state.translated.evict(now)
    const streams = [
      { window: state.window, compared: state.compared, latest: state.window.newest(), foreign: false },
      { window: state.translated, compared: state.comparedTranslated, latest: state.translated.newest(), foreign: true },
    ]
    if (!streams.some(s => s.latest)) return stats

    // 2. The reports, each compared with the files of its language's list it hasn't been compared with
    const reports = (await deps.waiting(now)).filter(searchable)
    stats.reports = reports.length
    const found = new Map<string, { report: HeldReport; outlets: FoundOutlet[] }>()
    for (const stream of streams) stats.pairs += await compareReports(reports, stream, found, now)

    // 3. The outlets found join their reports
    let crossChecks = await deps.crossChecksToday(day).catch(() => CROSSCHECKS_A_DAY)
    for (const { report, outlets } of found.values()) {
      // the day's cross-checks are the serious reports': a quiet place's everyday story stands on the headline test
      const everyday = report.severity === 'low'
      const crossCheck = !everyday && crossChecks < CROSSCHECKS_A_DAY
      try {
        const promoted = await deps.add(report, outlets, crossCheck)
        stats.matched++
        if (everyday) stats.everyday++
        stats.outlets += outlets.length
        if (promoted) {
          stats.promoted++
          if (crossCheck) { stats.crosschecked++; crossChecks++ }
        }
        await deps.remember({
          at: new Date(deps.clock()).toISOString(),
          id: report.id,
          severity: report.severity,
          language: report.language || 'en',
          title: report.title.slice(0, 140),
          promoted,
          found: outlets.map(f => ({ site: f.site, title: f.title.slice(0, 140), url: f.url })),
        })
      } catch (err) {
        stats.errors++
        logger.warn({ err, id: report.id }, 'Second outlet: outlets not added')
      }
    }

    // 4. On trial (Nov 21, 2026): the other places' everyday reports, written down only
    if (EVERYDAY === 'trial' && deps.everydayNew) {
      await everydayTrial(state, deps, now, stats).catch(err => { stats.errors++; logger.warn({ err }, 'Second outlet: everyday trial failed (non-fatal)') })
    }
  } finally {
    await deps.count(day, stats).catch(err => logger.warn({ err }, 'Second outlet: counts not saved'))
    if (lastTrace) {
      await deps.trace({ ...lastTrace, held: state.window.size, held_translated: state.translated.size, everyday_held: state.everyday.held.size, stats }).catch(() => {})
    }
    await deps.unlock().catch(() => {})
  }
  return stats
}

type Stream = { window: ArticleWindow; compared: Map<string, string>; latest: string | null; foreign: boolean }

/**
 * The reports of one list's languages, each compared with the articles of its language it hasn't been compared
 * with; the other outlets found go into `found`. The articles compared, counted.
 */
async function compareReports(reports: HeldReport[], stream: Stream, found: Map<string, { report: HeldReport; outlets: FoundOutlet[] }>, now: Date): Promise<number> {
  const mine = reports.filter(r => ((r.language || 'en') !== 'en') === stream.foreign)
  if (!stream.latest) return 0
  let compared = 0
  const groups = new Map<string, { since: string | null; lang: string; reports: HeldReport[] }>()
  for (const r of mine) {
    const since = stream.compared.get(r.id) ?? null
    if (since === stream.latest) continue
    const lang = r.language || 'en'
    const key = `${since ?? ''}|${lang}`
    const group = groups.get(key)
    if (group) group.reports.push(r); else groups.set(key, { since, lang, reports: [r] })
  }
  for (const { since, lang, reports: group } of groups.values()) {
    const articles = stream.window.after(since).filter(a => (a.lang || 'en') === lang)
    const pairs = candidatePairs(group.map(r => ({ tokens: storyTokens(r.title, lang) })), articles)
    let n = 0
    for (const [i, list] of pairs) {
      const report = group[i]!
      const best = list.slice(0, MAX_CANDIDATES)
      compared += best.length
      const outlets = otherOutlets(report, best.map(a => articles[a]!), now)
      if (outlets.length) found.set(report.id, { report, outlets })
      // room for the scraper's other work between reports
      if (++n % 100 === 0) await new Promise(resolve => setImmediate(resolve))
    }
  }
  for (const r of mine) stream.compared.set(r.id, stream.latest)
  const live = new Set(mine.map(r => r.id))
  for (const id of stream.compared.keys()) if (!live.has(id)) stream.compared.delete(id)
  return compared
}

/**
 * The trial (Nov 21, 2026): the everyday reports new since the last cycle join those held; each held one is compared
 * with the articles it hasn't been compared with, like the reports above; one that would get an outlet and is still
 * waiting is written down once and let go. Nothing is added to any report.
 */
async function everydayTrial(state: FinderState, deps: SecondOutletDeps, now: Date, stats: CycleStats): Promise<void> {
  const ev = state.everyday
  const fresh = await deps.everydayNew!(ev.since, now)
  stats.trial_read += fresh.length
  for (const r of fresh) {
    if (!ev.since || r.created_at > ev.since) ev.since = r.created_at
    if (ev.held.has(r.id) || ev.noted.has(r.id) || !searchable(r)) continue
    ev.held.set(r.id, { report: r, readAt: now.getTime() })
  }
  for (const [id, h] of ev.held) if (now.getTime() - h.readAt > EVERYDAY_HOLD_MS) ev.held.delete(id)
  // (a Map keeps the order its keys came in: the first are the oldest)
  for (const id of ev.held.keys()) { if (ev.held.size <= EVERYDAY_MAX_HELD) break; ev.held.delete(id) }
  const held = [...ev.held.values()].map(h => h.report)
  const found = new Map<string, { report: HeldReport; outlets: FoundOutlet[] }>()
  const streams: Stream[] = [
    { window: state.window, compared: ev.compared, latest: state.window.newest(), foreign: false },
    { window: state.translated, compared: ev.comparedTranslated, latest: state.translated.newest(), foreign: true },
  ]
  for (const stream of streams) stats.trial_pairs += await compareReports(held, stream, found, now)
  if (!found.size) return
  const ids = [...found.keys()]
  const waiting = deps.stillWaiting ? await deps.stillWaiting(ids) : new Set(ids)
  for (const id of ids) {
    const { report, outlets } = found.get(id)!
    ev.held.delete(id)
    // one of our own outlets, or the search above, got there first
    if (!waiting.has(id)) continue
    ev.noted.add(id)
    stats.trial_matched++
    stats.trial_outlets += outlets.length
    await deps.note?.({
      at: new Date(deps.clock()).toISOString(),
      id: report.id,
      severity: report.severity,
      language: report.language || 'en',
      category: report.category,
      title: report.title.slice(0, 160),
      found: outlets.map(f => ({ site: f.site, title: f.title.slice(0, 160), url: f.url })),
    })
  }
  // those written down are remembered only as long as a report can be held
  if (ev.noted.size > 4 * EVERYDAY_MAX_HELD) ev.noted = new Set([...ev.noted].slice(-2 * EVERYDAY_MAX_HELD))
}

// ─── The live parts ──────────────────────────────────────────────────────────

/**
 * The quiet places (Nov 10, 2026): of the thinly covered places (correlate.ts thinPlaceCodes, those with few feeds of
 * their own), those whose reports were verified fewer than QUIET_VERIFIED times in the last 7 days, or rarely
 * (QUIET_SHARE, Nov 11); their outlets' everyday (low) reports are searched too. On Nov 10 the 8 with none (Burundi, Comoros, Dominica, Liechtenstein,
 * Mongolia, Nauru, Seychelles, Tuvalu) had 4 in 5 of their waiting reports low.
 */
export const QUIET_VERIFIED = 5
/**
 * ...and those whose reports, QUIET_MIN_REPORTS or more in the 7 days, were verified less than QUIET_SHARE of the time
 * (Nov 11, 2026): Kosovo's 722 reports of the week before, nearly all Lajmi.net's, had 19 verified (2.6%)
 */
export const QUIET_SHARE = 0.05
export const QUIET_MIN_REPORTS = 50
const QUIET_DAYS = 7
const QUIET_REFRESH_MS = HOUR

/**
 * The quiet places' tags (lower-case codes, as each feed tags its items) from the thin places, their verified counts
 * and their counts of reports (`totals`)
 */
export function quietFrom(thin: readonly string[], verified: ReadonlyMap<string, number>, min = QUIET_VERIFIED, totals: ReadonlyMap<string, number> = new Map()): string[] {
  return thin.filter(code => {
    const n = verified.get(code.toUpperCase()) ?? 0
    const total = totals.get(code.toUpperCase()) ?? 0
    return n < min || (total >= QUIET_MIN_REPORTS && n < QUIET_SHARE * total)
  }).map(code => code.toLowerCase())
}

let quietCache: { at: number; codes: string[] } | null = null

/** The quiet places now, counted at most once an hour */
async function quietPlaces(now: Date): Promise<string[]> {
  if (quietCache && now.getTime() - quietCache.at < QUIET_REFRESH_MS) return quietCache.codes
  const thin = thinPlaceCodes()
  // none until the news reader has listed its feeds (news-rss.ts setThinPlaces): asked again next cycle
  if (!thin.length) return []
  const { rows } = await db.raw(
    `SELECT country_code AS code, COUNT(*) FILTER (WHERE status = 'verified')::int AS n, COUNT(*)::int AS total
       FROM signals
      WHERE created_at > ?::timestamptz AND country_code = ANY(?::text[])
      GROUP BY country_code`,
    [new Date(now.getTime() - QUIET_DAYS * 86_400_000).toISOString(), thin],
  ) as { rows: Array<{ code: string; n: number; total: number }> }
  const codes = quietFrom(
    thin,
    new Map(rows.map(r => [String(r.code).toUpperCase(), Number(r.n)])),
    QUIET_VERIFIED,
    new Map(rows.map(r => [String(r.code).toUpperCase(), Number(r.total)])),
  )
  quietCache = { at: now.getTime(), codes }
  return codes
}

/**
 * The reports waiting for a second outlet: pending, one outlet, settled, from the last 30 hours, in English, French,
 * German, Spanish, Portuguese, Russian, Arabic, Albanian or Serbian (Nov 11, 2026), Japanese, Chinese, Korean, Greek,
 * Persian, Urdu or Thai (Nov 18), medium or above, or low from a quiet place's own outlets (each feed
 * tags its items with its country)
 */
/**
 * The languages whose waiting reports are searched for: the English list's, and the translated list's (gdelt-articles.ts
 * TRANSLATED_LANGUAGES). Nov 19, 2026: Hindi, Bengali, Marathi, Tamil, Telugu, Kannada, Malayalam, Gujarati, Punjabi,
 * Vietnamese, Indonesian, Malay, Turkish, Italian, Polish, Dutch, Romanian, Ukrainian, Danish, Croatian, Bosnian,
 * Slovenian, Bulgarian and Macedonian too; Hungarian, Czech, Slovak, Finnish, Estonian, Lithuanian, Latvian, Norwegian and
 * Swahili from that evening
 */
export const SEARCHED_LANGUAGES = [
  'en', 'fr', 'de', 'es', 'pt', 'ru', 'ar', 'sq', 'sr', 'ja', 'zh', 'ko', 'el', 'fa', 'ur', 'th',
  'hi', 'bn', 'mr', 'ta', 'te', 'kn', 'ml', 'gu', 'pa', 'vi', 'id', 'ms', 'tr', 'it', 'pl', 'nl', 'ro', 'uk', 'da', 'hr',
  'bs', 'sl', 'bg', 'mk',
  // Nov 19, evening
  'hu', 'cs', 'sk', 'fi', 'et', 'lt', 'lv', 'no', 'nb', 'sw',
  // Nov 19, night: Nepali, Armenian and Swedish (GDELT's translated list has them)
  'ne', 'hy', 'sv',
] as const

export function waitingQuery(quiet: readonly string[], now: Date): { sql: string; bindings: unknown[] } {
  return {
    sql: `SELECT id, title, category, severity, language, source_ids, original_urls, location_name, tags,
              COALESCE(event_time, created_at) AS published_at,
              ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
         FROM signals
        WHERE status = 'pending' AND COALESCE(source_count, 1) <= 1
          AND (severity IN ('medium', 'high', 'critical') OR (severity = 'low' AND tags && ?::text[]))
          AND language IN (${SEARCHED_LANGUAGES.map(l => `'${l}'`).join(', ')})
          AND cardinality(original_urls) >= 1
          AND created_at > ?::timestamptz AND created_at < ?::timestamptz
        ORDER BY created_at DESC
        LIMIT 20000`,
    bindings: [[...quiet], new Date(now.getTime() - LOOKBACK_MS).toISOString(), new Date(now.getTime() - SETTLE_MS).toISOString()],
  }
}

/**
 * The everyday reports on trial (Nov 21, 2026): low, pending, one outlet, in the searched languages, not a quiet place's
 * (those are searched above), created after `since` (or in the last EVERYDAY_WARM_MS) and settled, oldest first. Each
 * cycle reads only the new ones: a few hundred rows, not the 30 hours of them.
 */
export function everydayQuery(quiet: readonly string[], since: string | null, now: Date): { sql: string; bindings: unknown[] } {
  return {
    sql: `SELECT id, title, category, severity, language, source_ids, original_urls, location_name, tags,
              COALESCE(event_time, created_at) AS published_at, created_at,
              ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
         FROM signals
        WHERE status = 'pending' AND COALESCE(source_count, 1) <= 1
          AND severity = 'low' AND NOT (COALESCE(tags, '{}'::text[]) && ?::text[])
          AND language IN (${SEARCHED_LANGUAGES.map(l => `'${l}'`).join(', ')})
          AND cardinality(original_urls) >= 1
          AND created_at > ?::timestamptz AND created_at < ?::timestamptz
        ORDER BY created_at
        LIMIT ${EVERYDAY_READ}`,
    bindings: [
      [...quiet],
      since ?? new Date(now.getTime() - EVERYDAY_WARM_MS).toISOString(),
      new Date(now.getTime() - SETTLE_MS).toISOString(),
    ],
  }
}

interface ReportRow {
  id: string
  title: string | null
  category: string | null
  severity: string | null
  source_ids: unknown
  original_urls: unknown
  location_name: string | null
  lat: number | string | null
  lng: number | string | null
  tags: unknown
  published_at: Date | string
  language?: string | null
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

function toHeld(r: ReportRow): HeldReport {
  return {
    id: String(r.id),
    title: String(r.title ?? ''),
    category: String(r.category ?? ''),
    severity: String(r.severity ?? ''),
    published_at: r.published_at,
    original_urls: strings(r.original_urls),
    source_ids: strings(r.source_ids),
    location_name: r.location_name ?? null,
    lat: num(r.lat),
    lng: num(r.lng),
    tags: strings(r.tags),
    language: String(r.language || 'en'),
  }
}

export const liveDeps: SecondOutletDeps = {
  newestStamp: fetchNewestStamp,
  // each file read also adds to the world's press counts (gkg-pulse.ts)
  fetchArticles: (stamp) => fetchArticles(stamp, (s, text) => recordPulse(s, readPulse(text))),

  newestTranslatedStamp: fetchNewestTranslationStamp,
  fetchTranslated: fetchTranslatedArticles,

  async waiting(now) {
    // Pending, one outlet, medium or above (or low from a quiet place), in English, French or German, settled
    const quiet = await quietPlaces(now).catch(err => { logger.warn({ err }, 'Second outlet: the quiet places not counted'); return [] as string[] })
    const { sql, bindings } = waitingQuery(quiet, now)
    const { rows } = await db.raw(sql, bindings as never[]) as { rows: ReportRow[] }
    return rows.map(toHeld)
  },

  async add(report, found, crossCheck) {
    // Still waiting? (an outlet may have joined since it was read)
    const now = await db('signals').where('id', report.id).first('status', 'source_count') as { status?: string; source_count?: number } | undefined
    if (!now || now.status !== 'pending' || Number(now.source_count ?? 1) > 1) return false
    // The links and the count, as a merged article adds them (index.ts storeArticleGroup)
    for (const f of found) {
      await db('signals').where('id', report.id).update({
        source_count:  db.raw('COALESCE(source_count, 1) + 1'),
        original_urls: db.raw('array_append(original_urls, ?)', [f.url]),
        last_updated:  new Date(),
      })
    }
    for (const f of found) {
      await confirmMergedArticle(report.id, { title: f.title, source_id: f.site, published_at: f.at }, { crossCheck })
        .catch(err => logger.warn({ err, id: report.id }, 'Second outlet: merged-article check failed (non-fatal)'))
    }
    // A line on the report's page (only the table's first columns: the later ones come from a migration production may not have run)
    await db('verification_log').insert({
      signal_id:  report.id,
      check_type: 'corroboration',
      result:     'confirmed',
      confidence: 0.8,
      notes:      `Also reported by ${found.map(f => f.site).join(', ')} (found in GDELT's list of news articles)`,
    }).catch(err => logger.warn({ err, id: report.id }, 'Second outlet: not logged on the report page'))
    const row = await db('signals').where('id', report.id).first('status') as { status?: string } | undefined
    // the search index still has it as it came: pending, one outlet (reindex.ts)
    await queueReindex([report.id]).catch(err => logger.warn({ err, id: report.id }, 'Second outlet: search re-index not queued'))
    return row?.status === 'verified'
  },

  async crossChecksToday(day) {
    return Number(await redis.hget(DAY_KEY(day), 'crosschecked')) || 0
  },

  async lock() {
    // 6 minutes: a cycle takes one or two; a restart that killed one mid-cycle
    // cost the next cycle while the old lock held (14 minutes until Oct 22)
    return await redis.set(LOCK_KEY, '1', 'EX', LOCK_S, 'NX') === 'OK'
  },

  async unlock() {
    await redis.del(LOCK_KEY)
  },

  async count(day, stats) {
    const multi = redis.multi()
    let any = false
    for (const [k, v] of Object.entries(stats)) {
      if (!v || k === 'reports') continue
      multi.hincrby(DAY_KEY(day), k, v)
      any = true
    }
    // the reports waiting at the latest cycle (a count, not a sum)
    multi.hset(DAY_KEY(day), 'waiting', stats.reports)
    multi.expire(DAY_KEY(day), KEEP_S)
    if (any || stats.reports) await multi.exec()
  },

  async remember(entry) {
    await redis.multi().lpush(RECENT_KEY, JSON.stringify(entry)).ltrim(RECENT_KEY, 0, 99).expire(RECENT_KEY, 7 * 86_400).exec()
  },

  async trace(entry) {
    await redis.set(LAST_CYCLE_KEY, JSON.stringify(entry), 'EX', 2 * 86_400)
  },

  clock: () => Date.now(),

  async everydayNew(since, now) {
    const quiet = await quietPlaces(now).catch(() => [] as string[])
    const { sql, bindings } = everydayQuery(quiet, since, now)
    const { rows } = await db.raw(sql, bindings as never[]) as { rows: Array<ReportRow & { created_at: Date | string }> }
    return rows.map(r => ({ ...toHeld(r), created_at: new Date(r.created_at).toISOString() }))
  },

  async stillWaiting(ids) {
    const rows = await db('signals').whereIn('id', ids).select('id', 'status', 'source_count') as Array<{ id: string; status?: string; source_count?: number | null }>
    return new Set(rows.filter(r => r.status === 'pending' && Number(r.source_count ?? 1) <= 1).map(r => String(r.id)))
  },

  async note(entry) {
    await redis.multi().lpush(TRIAL_KEY, JSON.stringify(entry)).ltrim(TRIAL_KEY, 0, TRIAL_KEEP - 1).expire(TRIAL_KEY, 7 * 86_400).exec()
  },
}

/** Every 15 minutes, a few minutes after GDELT publishes (off with SECOND_OUTLET=off) */
export function startSecondOutlets(): void {
  if ((process.env.SECOND_OUTLET || 'on').toLowerCase() === 'off') {
    logger.info('Second outlet off (SECOND_OUTLET=off)')
    return
  }
  const state = newState()
  // One scraper runs at a time: a lock left by the process this one replaced is stale
  redis.del(LOCK_KEY).catch(() => {})
  const run = () => {
    runSecondOutlets(state)
      .then(s => logger.info({ ...s, held: state.window.size }, 'Second outlet cycle'))
      .catch(err => logger.warn({ err }, 'Second outlet cycle failed (non-fatal)'))
  }
  // GDELT's files come at :00, :15, :30 and :45, listed a few minutes later
  const now = Date.now()
  const nextSlot = Math.ceil((now - 7 * 60_000) / CYCLE_MS) * CYCLE_MS + 7 * 60_000
  setTimeout(() => { run(); setInterval(run, CYCLE_MS) }, Math.max(60_000, nextSlot - now))
}
