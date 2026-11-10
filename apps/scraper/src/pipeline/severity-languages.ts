/**
 * Severity words in the other languages most feeds are read in (Nov 10, 2026): French, Spanish, Portuguese and
 * German. The rules of severity.ts were English only, so "12 morts", "deja 12 muertos", "12 mortos" or "12 Tote"
 * rated a story low: of 2,494 recent reports in these languages, 86% were low, and a serious one was never
 * searched for a second outlet (second-outlet.ts takes medium and above) or shown as serious on the map. These
 * are the same rules in each language: the dead and injured it counts, the words of a death, and the kinds of
 * event (high: strikes, bombings, coups, massacres, hostages, emergencies, major quakes and storms; medium:
 * attacks, fighting, protests, arrests, disasters, elections). Applied to a report in that language only (its
 * feed's), so English text never meets a German "Tote" ("tote bag") or a Spanish "mata".
 *
 * Words are matched whole, letters with accents included: \b doesn't see "é" as a letter, so the patterns use
 * their own edges (B, E) with the u flag.
 */

import type { SignalSeverity } from '@worldpulse/types'

const B = String.raw`(?<![\p{L}\p{N}])`
const E = String.raw`(?![\p{L}\p{N}])`
const words = (alts: string) => new RegExp(`${B}(?:${alts})${E}`, 'iu')

/** Counts in words a headline gives instead of digits: "dozens", "hundreds" */
const COUNT_WORDS: Record<string, number> = {
  dizaines: 24, centaines: 200, milliers: 2000, decenas: 24, centenares: 200, cientos: 200, miles: 2000,
  dezenas: 24, centenas: 200, milhares: 2000, dutzende: 24, hunderte: 200, tausende: 2000,
  deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, vingt: 20,
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12, veinte: 20,
  dois: 2, duas: 2, 'três': 3, quatro: 4, sete: 7, oito: 8, nove: 9, dez: 10, doze: 12, vinte: 20,
  zwei: 2, drei: 3, vier: 4, 'fünf': 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, zwölf: 12, zwanzig: 20,
  // Russian and Arabic (Nov 10, 2026; Arabic in arabicForm's letters)
  'двое': 2, 'два': 2, 'две': 2, 'трое': 3, 'три': 3, 'четверо': 4, 'четыре': 4, 'пятеро': 5, 'пять': 5, 'шестеро': 6,
  'шесть': 6, 'семеро': 7, 'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10, 'десятки': 24, 'десятков': 24, 'сотни': 200,
  'сотен': 200, 'тысячи': 2000,
  'اثنين': 2, 'اثنان': 2, 'ثلاثه': 3, 'اربعه': 4, 'خمسه': 5, 'سته': 6, 'سبعه': 7, 'ثمانيه': 8, 'تسعه': 9, 'عشره': 10,
  'عشرات': 24, 'مئات': 200, 'الاف': 2000,
}
/** A count: digits ("1.200" and "1 200" are a thousand two hundred, as these languages write it) or a word */
const COUNT = String.raw`(\d{1,3}(?:[.\u00a0\u202f ]\d{3})+|\d+|${Object.keys(COUNT_WORDS).join('|')})`

export function foreignNumber(raw: string): number {
  const clean = raw.trim().toLowerCase()
  if (Object.hasOwn(COUNT_WORDS, clean)) return COUNT_WORDS[clean]!
  const digits = clean.replace(/[.\u00a0\u202f ]/g, '')
  return /^\d+$/.test(digits) ? Number(digits) : 0
}

/** "at least", "more than", "nearly" before a count */
const ABOUT = String.raw`(?:(?:au\s+moins|plus\s+de|près\s+de|environ|quelque|al\s+menos|más\s+de|casi|unos|unas|cerca\s+de|pelo\s+menos|mais\s+de|quase|cerca\s+de|mindestens|mehr\s+als|fast|rund|etwa|über|не\s+менее|по\s+меньшей\s+мере|более|свыше|около|почти|порядка|نحو|حوالي|قرابه|اكثر\s+من|ما\s+لا\s+يقل\s+عن|ما\s+يزيد\s+عن|ما\s+يقارب)\s+)?`

export interface LanguageRules {
  /** "12 morts", "12 personnes tuées": the count is the first group */
  deadAfter: RegExp
  /** "tue 12", "mata a 12": the count is the first group */
  deadBefore: RegExp
  injuredAfter: RegExp
  /** "ранены 12", "إصابة 12": the count is the first group (Russian and Arabic) */
  injuredBefore?: RegExp
  /** A death without a number */
  death: RegExp
  /** The kind of event, most serious first */
  events: Array<[RegExp, SignalSeverity]>
  /** Opinion and analysis rather than news (never above medium) */
  opinion: RegExp
}

/** A count, perhaps the people counted, perhaps "have been", then the words */
const after = (people: string, been: string, what: string, flags = 'giu') =>
  new RegExp(`${B}${ABOUT}${COUNT}(?:\\s+(?:${people}))?(?:\\s+(?:${been}))?\\s+(?:${what})${E}`, flags)
const before = (what: string) => new RegExp(`${B}(?:${what})\\s+(?:a\\s+)?${ABOUT}${COUNT}${E}`, 'giu')
/** Arabic joins "و" (and) to the count it starts: "54 قتيلا و147 جريحا" */
const afterAr = (people: string, what: string) =>
  new RegExp(`${B}و?${ABOUT}${COUNT}(?:\\s+(?:${people}))?(?:\\s+على\\s+الاقل)?\\s+(?:${what})${E}`, 'giu')
/** An Arabic word with "و" (and), "ف" (so), "ب" (by), "ل" (for) or the article joined to it: "بمقتل", "والجيش" */
const AR = '(?:و|ف|ب|ل|وب|ول|فب|وال|بال|فال|لل|ال)?'

export const LANGUAGE_RULES: Readonly<Record<string, LanguageRules>> = {
  fr: {
    deadAfter: after(
      'personnes|civils|soldats|militaires|enfants|élèves|policiers|gendarmes|migrants|passagers|habitants|villageois|manifestants|jihadistes|djihadistes|terroristes|rebelles|ouvriers|mineurs|pêcheurs|fidèles',
      'ont\\s+été|sont|auraient\\s+été|seraient',
      'morts?|tués?|tuées?|décès|décédés?|noyés?|meurent|sont\\s+mort(?:e|s|es)?|ont\\s+péri|ont\\s+perdu\\s+la\\s+vie'),
    deadBefore: before('tue|tuent|a\\s+tué|ont\\s+tué|bilan\\s+(?:s\'alourdit|passe|monte|grimpe)\\s+à'),
    injuredAfter: after('personnes|civils|soldats|enfants|élèves|policiers|passagers|manifestants', 'ont\\s+été|sont', 'blessés?|blessées?'),
    death: words('tués?|tuées?|tue|tuent|morts?|meurt|meurent|décès|décédés?|décédées?|assassinés?|assassinées?|assassinat|abattus?|abattues?|noyés?|tuerie|périt|périssent'),
    events: [
      [words('frappes?\\s+aériennes?|bombardements?|(?<!menaces?\\s+d[\'’])attentats?|kamikazes?|explosions?|coup\\s+d\'[ée]tat|putsch|massacres?|prise\\s+d\'otages|otages|état\\s+d\'urgence|loi\\s+martiale|famine|séisme\\s+de\\s+magnitude\\s+[6-9]|tsunami|ouragans?|cyclones?|typhons?|éruptions?'), 'high'],
      [words('attaques?|attaqués?|attaquées?|affrontements?|combats?|offensive|armée|militaires|drones?|missiles?|rebelles?|jihadistes|djihadistes|terroristes?|terrorisme|manifestations?|manifestants|émeutes?|grève|couvre-feu|arrestations?|arrêtés?|interpellés?|enlèvements?|enlevés?|exécutions?|fusillades?|séismes?|tremblement\\s+de\\s+terre|inondations?|crues|incendies?|glissements?\\s+de\\s+terrain|tempêtes?|sécheresse|épidémie|choléra|ebola|mpox|cyberattaques?|évacu\\p{L}*|naufrage|déraillement|effondrement|élections?|référendum|destitution|démission|démissionne|cessez-le-feu|trêve|pourparlers\\s+de\\s+paix|sommet|sanctions|droits\\s+de\\s+douane'), 'medium'],
    ],
    opinion: words('éditorial|editorial|tribune|chronique|analyse|opinion|point\\s+de\\s+vue|décryptage'),
  },
  es: {
    deadAfter: after(
      'personas|civiles|soldados|militares|niños|niñas|menores|policías|agentes|migrantes|pasajeros|mineros|pescadores|presos|reos|manifestantes|guerrilleros|disidentes',
      'fueron|han\\s+sido|son|habrían\\s+sido',
      'muertos?|muertas?|fallecidos?|fallecidas?|asesinados?|asesinadas?|víctimas\\s+mortales|ahogados?|mueren|murieron|fallecen|fallecieron|pierden\\s+la\\s+vida|perdieron\\s+la\\s+vida'),
    deadBefore: before('mata|matan|mató|mataron|asesinan|asesina|cifra\\s+de\\s+(?:muertos|fallecidos)\\s+(?:sube|asciende|aumenta|llega)\\s+a'),
    injuredAfter: after('personas|civiles|soldados|niños|policías|agentes|pasajeros|manifestantes', 'fueron|han\\s+sido|son', 'heridos?|heridas?|lesionados?|lesionadas?'),
    // not a bare "mata" (Juan Mata): "mata a 12" is read by its count
    death: words('muere|mueren|murió|murieron|muertos?|muertas?|muerte|fallece|fallecen|falleció|fallecieron|asesinados?|asesinadas?|asesinato|asesinan|matan|mató|mataron|homicidios?|feminicidio|ahogados?|ahogadas?|masacre'),
    events: [
      [words('bombardeos?|ataques?\\s+aéreos?|(?<!(?:amenazas?|alerta)\\s+de\\s+(?:un\\s+|posibles?\\s+)?)atentados?|explosión|explosiones|golpe\\s+de\\s+estado|masacres?|rehenes|estado\\s+de\\s+(?:excepción|emergencia|sitio)|ley\\s+marcial|hambruna|terremoto\\s+de\\s+magnitud\\s+[6-9]|sismo\\s+de\\s+magnitud\\s+[6-9]|tsunami|huracán|huracanes|tifón|ciclón|erupción'), 'high'],
      [words('ataques?|atacan|atacó|enfrentamientos?|combates?|ofensiva|ejército|militares|drones?|misiles?|guerrilla|rebeldes|disidencias|protestas?|manifestaciones?|manifestantes|disturbios|saqueos|huelga|paro\\s+(?:nacional|armado)|toque\\s+de\\s+queda|detenidos?|detenidas?|arrestos?|arrestados?|capturados?|secuestros?|secuestrados?|secuestradas?|ejecuciones?|terroristas?|terrorismo|tiroteos?|balaceras?|sicarios?|narcotráfico|terremotos?|sismos?|inundaciones|incendios?|deslizamientos?|tormentas?|sequía|brotes?|epidemia|dengue|cólera|ciberataques?|evac[uú]\\p{L}*|choque|naufragio|descarrilamiento|derrumbes?|elecciones|referéndum|juicio\\s+político|destitución|renuncia|dimisión|alto\\s+el\\s+fuego|tregua|diálogos?\\s+de\\s+paz|cumbre|sanciones|aranceles'), 'medium'],
    ],
    opinion: words('opinión|editorial|columna|análisis|tribuna|columnista'),
  },
  pt: {
    deadAfter: after(
      'pessoas|civis|soldados|militares|crianças|menores|polícias|policiais|agentes|migrantes|passageiros|mineiros|pescadores|presos|reclusos|manifestantes',
      'foram|são|terão\\s+sido',
      'mortos?|mortas?|mortes|óbitos|vítimas\\s+mortais|vítimas\\s+fatais|afogados?|morrem|morreram|perdem\\s+a\\s+vida|perderam\\s+a\\s+vida'),
    deadBefore: before('mata|matam|matou|mataram|número\\s+de\\s+mortos\\s+(?:sobe|aumenta|chega)\\s+(?:para|a)'),
    injuredAfter: after('pessoas|civis|soldados|crianças|polícias|policiais|passageiros|manifestantes', 'foram|são', 'feridos?|feridas?'),
    // not a bare "mata" (the Mata Atlântica, a forest)
    death: words('morre|morrem|morreu|morreram|mortos?|mortas?|morte|mortes|óbitos?|assassinados?|assassinadas?|assassinato|matam|matou|mataram|homicídios?|feminicídio|afogados?|afogadas?|massacre|chacina'),
    events: [
      [words('bombardeamentos?|bombardeios?|ataques?\\s+aéreos?|(?<!ameaças?\\s+de\\s+)atentados?|explosão|explosões|golpe\\s+de\\s+estado|massacres?|reféns|estado\\s+de\\s+(?:emergência|sítio)|lei\\s+marcial|fome\\s+generalizada|sismo\\s+de\\s+magnitude\\s+[6-9]|terramoto\\s+de\\s+magnitude\\s+[6-9]|tsunami|furacão|furacões|tufão|ciclone|erupção'), 'high'],
      [words('ataques?|atacam|atacou|confrontos?|combates?|ofensiva|exército|militares|drones?|mísseis|míssil|rebeldes|insurgentes|jihadistas|terroristas?|terrorismo|protestos?|manifestações|manifestantes|tumultos|greve|recolher\\s+obrigatório|detidos?|detidas?|presos?|sequestros?|raptos?|raptados?|execuções|tiroteios?|sismos?|terramotos?|terremotos?|inundações|cheias|incêndios?|deslizamentos?|tempestades?|seca|surtos?|epidemia|cólera|ciberataques?|evac[uú]\\p{L}*|naufrágio|descarrilamento|desabamento|eleições|referendo|destituição|renúncia|demissão|cessar-fogo|trégua|negociações\\s+de\\s+paz|cimeira|cúpula|sanções|tarifas'), 'medium'],
    ],
    opinion: words('opinião|editorial|coluna|análise|crónica|crônica|colunista'),
  },
  de: {
    // as written: German capitalises its nouns, so "12 Tote" are the dead and "1.236 tote Schweine" dead pigs
    deadAfter: after(
      'Menschen|Personen|Zivilisten|Soldaten|Kinder|Schüler|Polizisten|Migranten|Passagiere|Bergleute|Demonstranten',
      'wurden|sind|seien',
      'Tote|Toten|Todesopfer|getötet|ums\\s+Leben\\s+gekommen|sterben|starben|gestorben|ertrunken', 'gu'),
    deadBefore: before('tötet|töten|tötete|töteten|zahl\\s+der\\s+(?:toten|todesopfer)\\s+(?:steigt|stieg)\\s+auf'),
    injuredAfter: after('menschen|personen|zivilisten|soldaten|kinder|polizisten|passagiere|demonstranten', 'wurden|sind', 'verletzte|verletzten|verletzt|schwerverletzte'),
    death: new RegExp(`${B}(?:tot|Tote|Toten|Todesopfer|getötet|tötet|töten|tötete|stirbt|sterben|starb|starben|ermordet|Mord|ertrunken|erschossen|Leiche)${E}`, 'u'),
    events: [
      [words('luftangriffe?|luftangriffen|raketenangriffe?|drohnenangriffe?|bombenanschlag|anschlag|anschläge|anschlägen|explosion|explosionen|putsch|staatsstreich|massaker|geiseln|geiselnahme|ausnahmezustand|kriegsrecht|hungersnot|erdbeben\\s+der\\s+stärke\\s+[6-9]|tsunami|hurrikan|taifun|zyklon|vulkanausbruch'), 'high'],
      [words('angriffe?|angriffen|angegriffen|gefechte|kämpfe|offensive|militär|armee|truppen|drohnen?|raketen|rebellen|islamisten|terroristen|terror|proteste?|demonstrationen?|krawalle|ausschreitungen|streik|ausgangssperre|festnahmen?|festgenommen|verhaftet|entführung|entführt|hinrichtungen?|schüsse|schießerei|messerangriff|erdbeben|überschwemmungen?|hochwasser|waldbrände?|erdrutsch|unwetter|dürre|epidemie|cholera|cyberangriff|hackerangriff|evakuiert|evakuierung|zugunglück|entgleisung|einsturz|wahlen?|referendum|volksabstimmung|amtsenthebung|rücktritt|waffenstillstand|waffenruhe|friedensgespräche|gipfel|sanktionen|zölle'), 'medium'],
    ],
    opinion: words('kommentar|leitartikel|analyse|meinung|kolumne|gastbeitrag'),
  },  ru: {
    deadAfter: after(
      'человек|человека|мирных\\s+жителей|жителей|военных|военнослужащих|солдат|детей|пассажиров|горняков|шахтеров|полицейских|силовиков|боевиков|мигрантов|рабочих|туристов',
      'были|было',
      'погибли|погибло|погибших|погибшие|убиты|убито|убитых|мертвы|скончались|утонули|жертв'),
    deadBefore: before('погибли|погибло|погиб|погибла|убиты|убито|убили|убил|жертвами\\s+стали|число\\s+(?:погибших|жертв)\\s+(?:возросло|выросло|увеличилось|достигло)\\s+до'),
    injuredAfter: after('человек|человека|мирных\\s+жителей|детей|пассажиров|полицейских|военных', 'были|было', 'ранены|ранено|раненых|раненые|пострадали|пострадавших|пострадавшие|госпитализированы'),
    injuredBefore: before('ранены|ранено|пострадали|госпитализированы|число\\s+пострадавших\\s+(?:возросло|выросло|достигло)\\s+до'),
    death: words('погиб\\p{L}*|гибел\\p{L}*|убит\\p{L}*|убийств\\p{L}*|убил\\p{L}*|скончал\\p{L}*|утонул\\p{L}*|застрел\\p{L}*|расстрел\\p{L}*|трупы?|тело\\s+(?:мужчины|женщины|ребенка)'),
    events: [
      [words('авиаудар\\p{L}*|бомбардировк\\p{L}*|бомбежк\\p{L}*|(?<!угроз\\p{L}*\\s)теракт\\p{L}*|взрыв\\p{L}*|смертник\\p{L}*|переворот\\p{L}*|резн\\p{L}*|массов\\p{L}*\\s+убийств\\p{L}*|заложник\\p{L}*|чрезвычайн\\p{L}*\\s+положени\\p{L}*|режим\\s+чс|военн\\p{L}*\\s+положени\\p{L}*|голод|землетрясени\\p{L}*\\s+магнитудой\\s+[6-9]|цунами|ураган\\p{L}*|тайфун\\p{L}*|извержени\\p{L}*'), 'high'],
      [words('напад\\p{L}*|атак\\p{L}*|обстрел\\p{L}*|бо(?:и|ев|ях)|боевые\\s+действия|столкновени\\p{L}*|арми[яию]|войск\\p{L}*|дрон\\p{L}*|беспилотник\\p{L}*|ракет(?:а|ы|ой|у|ами)?|ракетн\\p{L}*|боевик\\p{L}*|террорист\\p{L}*|терроризм\\p{L}*|протест\\p{L}*|митинг\\p{L}*|беспорядк\\p{L}*|забастовк\\p{L}*|комендантск\\p{L}*\\s+час|задержан\\p{L}*|задержал\\p{L}*|арестован\\p{L}*|арест\\p{L}*|похищ\\p{L}*|казн\\p{L}*|стрельб\\p{L}*|перестрелк\\p{L}*|землетрясени\\p{L}*|наводнени\\p{L}*|паводк\\p{L}*|пожар\\p{L}*|оползн\\p{L}*|шторм\\p{L}*|засух\\p{L}*|эпидеми\\p{L}*|холер\\p{L}*|кибератак\\p{L}*|эвакуац\\p{L}*|эвакуир\\p{L}*|крушени\\p{L}*|авари\\p{L}*|дтп|обрушени\\p{L}*|выбор(?:ы|ов|ах|ам)|референдум\\p{L}*|отставк\\p{L}*|импичмент\\p{L}*|перемири\\p{L}*|прекращени\\p{L}*\\s+огня|переговор\\p{L}*|саммит\\p{L}*|санкци\\p{L}*|пошлин\\p{L}*'), 'medium'],
    ],
    opinion: words('мнени\\p{L}*|колонк\\p{L}*|аналитик\\p{L}*|точка\\s+зрения|блог'),
  },
  // Arabic, read with its letters made one form (arabicForm: no vowel marks, "ا" for أ إ آ, "ه" for ة, "ي" for
  // ى), and with "و" (and), "ب" (by), "ل" (for) and "ف" joined to a word
  ar: {
    deadAfter: afterAr('اشخاص|شخصا|مدنيين|مدنيا|جنود|جنديا|اطفال|طفلا|مهاجرين|ركاب|عمال', 'قتيلا|قتلي|شهيدا|شهداء|ضحيه|ضحايا|وفيات|حالات\\s+وفاه'),
    deadBefore: before(`${AR}(?:مقتل|قتل|استشهاد|وفاه|مصرع|سقوط|ارتفاع\\s+حصيله\\s+(?:القتلي|الضحايا|الشهداء)\\s+الي|حصيله\\s+(?:القتلي|الضحايا)\\s+الي)`),
    injuredAfter: afterAr('اشخاص|شخصا|مدنيين|مدنيا|جنود|اطفال|طفلا|ركاب', 'جريحا|جرحي|مصابا|مصابين|اصابات'),
    injuredBefore: before(`${AR}(?:اصابه|جرح|مقتل\\s+واصابه|قتل\\s+واصابه)`),
    death: words(`${AR}(?:مقتل|قتل|قتيل|قتلي|استشهاد|شهيد|شهداء|وفاه|مصرع|اغتيال|اعدام|جثه|جثث)`),
    events: [
      [words(`${AR}(?:غارات|غاره|غاره\\s+جويه|قصف|تفجير|تفجيرات|انفجار|انفجارات|انتحاري|انتحاريه|انقلاب|مجزره|مجازر|ضربات\\s+جويه|ضربه\\s+جويه|رهائن|حاله\\s+الطوارئ|الاحكام\\s+العرفيه|مجاعه|زلزال\\s+بقوه\\s+[6-9]|تسونامي|اعصار|اعاصير)`), 'high'],
      [words(`(?<!الاعلي\\s)${AR}(?:هجوم|هجمات|اعتداء|اعتداءات|استهداف|ضربات|اعتراض\\s+(?:صاروخ|صواريخ|طائره|مسيره|وتدمير)|باليستي|باليستيه|صاروخين|اشتباكات|معارك|عمليه\\s+عسكريه|عمليات\\s+عسكريه|جيش|الجيش|قوات|طائره\\s+مسيره|طائرات\\s+مسيره|مسيرات|صواريخ|صاروخ|مسلحين|مسلحون|ميليشيا|ميليشيات|ارهابي|ارهابيه|ارهاب|احتجاجات|مظاهرات|تظاهرات|اضراب|حظر\\s+التجول|اعتقال|اعتقالات|القبض|اختطاف|خطف|اعدام|اطلاق\\s+نار|زلزال|فيضانات|سيول|حريق|حرائق|انهيار|عاصفه|جفاف|وباء|كوليرا|هجوم\\s+سيبراني|اجلاء|غرق|تحطم|حادث|انتخابات|استفتاء|استقاله|وقف\\s+اطلاق\\s+النار|هدنه|مفاوضات\\s+(?:السلام|وقف|التهدئه|الهدنه|نوويه)|محادثات\\s+السلام|عقوبات\\s+(?:امريكيه|اوروبيه|دوليه|غربيه|جديده|اقتصاديه)|فرض\\s+عقوبات|رسوم\\s+جمركيه)`), 'medium'],
    ],
    opinion: words(`${AR}(?:مقال|راي|تحليل|افتتاحيه|وجهه\\s+نظر)`),
  },
}

/** The largest count a pattern finds (years and money aren't people) */
function largestCount(text: string, re: RegExp): number {
  let max = 0
  re.lastIndex = 0
  for (const m of text.matchAll(re)) {
    const n = foreignNumber(m[1] ?? '')
    if (n > max && n < 1_000_000 && !(n >= 1900 && n <= 2100)) max = n
  }
  return max
}

/**
 * Arabic in one form (Nov 10, 2026), as its rules are written: no vowel marks or tatweel, "ا" for أ إ آ, "ه" for ة
 * and "ي" for ى ("إصابة" and "اصابه" are one word)
 */
export function arabicForm(text: string): string {
  return text.replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
}

/** A text as its language's rules read it: digits in Western form ("١٢" is 12), Arabic in one form, "ё" as "е" */
function formOf(text: string, lang: string): string {
  const digits = text.replace(/[٠-٩۰-۹]/g, d => String(d.charCodeAt(0) & 0xf))
  if (lang === 'ar') return arabicForm(digits)
  if (lang === 'ru') return digits.replace(/ё/g, 'е').replace(/Ё/g, 'Е')
  return digits
}

/** The dead and injured a text in one of these languages reports, and whether it tells of a death */
export function foreignCasualties(raw: string, lang: string): { dead: number; injured: number; deathsNamed: boolean } | null {
  const rules = LANGUAGE_RULES[lang]
  if (!rules) return null
  const text = formOf(raw, lang)
  const dead = Math.max(largestCount(text, rules.deadAfter), largestCount(text, rules.deadBefore))
  const injured = Math.max(largestCount(text, rules.injuredAfter), rules.injuredBefore ? largestCount(text, rules.injuredBefore) : 0)
  return { dead, injured, deathsNamed: dead > 0 || rules.death.test(text) }
}

/** The most serious kind of event a text in one of these languages names, or null */
export function foreignEvent(text: string, lang: string): SignalSeverity | null {
  const rules = LANGUAGE_RULES[lang]
  if (!rules) return null
  const form = formOf(text, lang)
  for (const [re, severity] of rules.events) if (re.test(form)) return severity
  return null
}

/** Whether a headline in one of these languages is opinion or analysis */
export function foreignOpinion(headline: string, lang: string): boolean {
  return LANGUAGE_RULES[lang]?.opinion.test(formOf(headline, lang)) ?? false
}
