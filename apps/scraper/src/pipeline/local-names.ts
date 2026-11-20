/**
 * Place names in the languages the reader added on Oct 31, 2026 (sources round 6), and words in the
 * reader's languages that only look like a place.
 *
 * The 18 countries that had no outlet of their own publish in German (Austria, Liechtenstein), Slovene,
 * Romanian (Moldova), Montenegrin, Albanian (Kosovo), Catalan (Andorra), Italian (San Marino), Danish
 * (Greenland), Dutch (Suriname) and Malay (Brunei), or in English. The place-finder knows places by their
 * English names, and French, Spanish and Portuguese country names (country-names-intl.ts), so a headline
 * about "Deutschland", "Rusija" or "SHBA" named no place, and a national outlet's story about another
 * country would have been pinned at the outlet's home.
 *
 * withLocalNames() rewrites a headline or summary from a feed in one of these languages into the English
 * names the place-finder knows ("Wien" → "Vienna", "Mali i Zi" → "Montenegro", "Weißes Haus" → "White
 * House"), for finding its place only: the story keeps its own words. Each language has its own list, so a
 * word that is a place in one language and a name or a word in another ("Francia" is France in Italian
 * and a first name in Spanish, "Island" is Iceland in Danish and German) counts only in the first. Endings
 * cover the cases these languages decline names in ("Rusiji", "Shqipërisë", "Deutschlands").
 *
 * Masks: words a feed's language uses every day that the English names would read as a place. In Italian,
 * Slovene, Montenegrin and Albanian "mali" (ills, small, the mountain) is not Mali; in Italian, Spanish,
 * Portuguese, Catalan and Romanian "usa" (uses, a door) is not the USA; Italian "modi" (ways) is not
 * Narendra Modi; Spanish "irán" and Portuguese "irão" (they will go), Spanish "chile" (a pepper),
 * Portuguese "peru" (a turkey) and lowercase "maduro" (ripe) are none of those places or people. Masks
 * match lowercase only: the place itself is written with a capital ("Mali", "USA", "Irán", "Modi").
 * In Slovene, Montenegrin and Albanian "Mali" is blanked out in any case, since a headline can start with
 * it ("Mali broj turista", few tourists), and the country there mostly goes by its other cases ("u Maliju").
 */

const B = '(?<![\\p{L}\\p{N}])'
const E = '(?![\\p{L}\\p{N}])'

type Rule = [RegExp, string]

/** Any case: "deutschland", "Deutschland", "DEUTSCHLAND" */
const r = (alts: string, as: string): Rule => [new RegExp(`${B}(?:${alts})${E}`, 'giu'), as]
/** As written: "SAD" is the United States in Montenegrin, "sad" is "now" */
const cs = (alts: string, as: string): Rule => [new RegExp(`${B}(?:${alts})${E}`, 'gu'), as]
/** A word that only looks like a place: blanked out, as written (lowercase) */
const mask = (alts: string): Rule => cs(alts, '…')
/**
 * World cities by a language's own names, as written (Nov 6, 2026: Spanish, Portuguese, Italian and German missed most
 * capitals, "Pekín", "Pequim", "Lisbona", "Kairo"; French had none): with their capital, since several are words or
 * names in lower case ("damas", "colonia"). Not Mecca: "ein Mekka für Surfer", "la meca del cine" are figures of speech.
 */
const towns = (pairs: Array<[string, string]>): Rule[] => pairs.map(([alts, as]) => cs(alts, as))

const GERMAN: Rule[] = [
  r('vereinigte[nr]?\\s+arabische[nr]?\\s+emirate[n]?', 'United Arab Emirates'),
  r('vereinigte[nr]?\\s+staaten(?:\\s+von\\s+amerika)?', 'United States'),
  r('vereinigte[ns]?\\s+k[öo]nigreichs?|gro[ßs]britanniens?', 'United Kingdom'),
  r('deutschlands?', 'Germany'), r('[öo]sterreichs?', 'Austria'), r('schweiz', 'Switzerland'),
  r('frankreichs?', 'France'), r('italiens?', 'Italy'), r('spaniens?', 'Spain'), r('portugals', 'Portugal'),
  r('ru(?:ss|ß)lands?', 'Russia'), r('wei(?:ss|ß)ru(?:ss|ß)lands?', 'Belarus'), r('t[üu]rkei', 'Turkey'),
  r('griechenlands?', 'Greece'), r('niederlanden?', 'Netherlands'), r('belgiens?', 'Belgium'),
  r('luxemburgs?', 'Luxembourg'), r('d[äa]nemarks?', 'Denmark'), r('schwedens?', 'Sweden'), r('norwegens?', 'Norway'),
  r('finnlands?', 'Finland'), r('irlands?', 'Ireland'), cs('Islands?', 'Iceland'), r('polens?', 'Poland'),
  r('ungarns?', 'Hungary'), r('tschechiens?|tschechische[nr]?\\s+republik', 'Czechia'), r('slowakei', 'Slovakia'),
  r('sloweniens?', 'Slovenia'), r('kroatiens?', 'Croatia'), r('serbiens?', 'Serbia'),
  r('bosnien(?:[-\\s]+(?:und\\s+)?herzegowina)?', 'Bosnia'), r('albaniens?', 'Albania'),
  r('nordmazedoniens?', 'North Macedonia'), r('rum[äa]niens?', 'Romania'), r('bulgariens?', 'Bulgaria'),
  r('republik\\s+moldau|moldaus?|moldawiens?', 'Moldova'), r('litauens?', 'Lithuania'), r('lettlands?', 'Latvia'),
  r('estlands?', 'Estonia'), r('georgiens?', 'Republic of Georgia'), r('armeniens?', 'Armenia'),
  r('aserbaidschans?', 'Azerbaijan'), r('kasachstans?', 'Kazakhstan'), r('usbekistans?', 'Uzbekistan'),
  r('pal[äa]stinas?', 'Palestine'), r('syriens?', 'Syria'), r('libanons?', 'Lebanon'), r('jordaniens?', 'Jordanian'),
  r('[äa]gyptens?', 'Egypt'), r('saudi[-\\s]arabiens?', 'Saudi Arabia'), r('jemens?', 'Yemen'), r('katars?', 'Qatar'),
  r('indiens?', 'India'), r('nordkoreas?', 'North Korea'), r('s[üu]dkoreas?', 'South Korea'),
  r('indonesiens?', 'Indonesia'), r('philippinen', 'Philippines'), r('australiens?', 'Australia'),
  r('neuseelands?', 'New Zealand'), r('kanadas?', 'Canada'), r('mexikos?', 'Mexico'), r('brasiliens?', 'Brazil'),
  r('argentiniens?', 'Argentina'), r('kolumbiens?', 'Colombia'), r('kubas?', 'Cuba'), r('s[üu]dafrikas?', 'South Africa'),
  r('marokkos?', 'Morocco'), r('algeriens?', 'Algeria'), r('tunesiens?', 'Tunisia'), r('libyens?', 'Libya'),
  r('[äa]thiopiens?', 'Ethiopia'), r('tschads?', 'Chadian'), r('gr[öo]nlands?', 'Greenland'), r('vatikans?', 'Vatican'),
  r('wiens?', 'Vienna'), r('m[üu]nchens?', 'Munich'), r('br[üu]ssels?', 'Brussels'), r('moskaus?', 'Moscow'),
  r('pekings?', 'Beijing'), r('kiews?', 'Kyiv'), r('warschaus?', 'Warsaw'), r('prags?', 'Prague'),
  r('belgrads?', 'Belgrade'), r('roms?', 'Rome'), r('athens?', 'Athens'), r('wei(?:ss|ß)e[ns]?\\s+haus(?:es)?', 'White House'),
  r('kreml', 'Kremlin'),
  // adjectives, as English "Russian" or "Chinese" count ("nordkoreanische Hacker", "russische Drohnen")
  r('russische[nrsm]?', 'Russian'), r('ukrainische[nrsm]?', 'Ukrainian'), r('amerikanische[nrsm]?', 'United States'),
  r('chinesische[nrsm]?', 'Chinese'), r('nordkoreanische[nrsm]?', 'North Korea'), r('s[üu]dkoreanische[nrsm]?', 'South Korea'),
  r('israelische[nrsm]?', 'Israeli'), r('iranische[nrsm]?', 'Iranian'), r('t[üu]rkische[nrsm]?', 'Turkish'),
  r('franz[öo]sische[nrsm]?', 'French'), r('italienische[nrsm]?', 'Italian'), r('britische[nrsm]?', 'United Kingdom'),
  r('japanische[nrsm]?', 'Japanese'), r('indische[nrsm]?', 'Indian'), r('ungarische[nrsm]?', 'Hungary'),
  r('tschechische[nrsm]?', 'Czech'), r('slowenische[nrsm]?', 'Slovenian'), r('kroatische[nrsm]?', 'Croatian'),
  r('serbische[nrsm]?', 'Serbian'), r('schweizer(?:ische[nrsm]?)?', 'Swiss'), r('syrische[nrsm]?', 'Syrian'),
  r('pal[äa]stinensische[nrsm]?', 'Palestinian'), r('griechische[nrsm]?', 'Greece'), r('rum[äa]nische[nrsm]?', 'Romanian'),
  r('deutsche[nrsm]?', 'German'), r('[öo]sterreichische[nrsm]?', 'Austria'),
  ...towns([
    ['Kairo', 'Cairo'], ['Krakau', 'Krakow'], ['Algier', 'Algiers'], ['Teheran', 'Tehran'], ['Bagdad', 'Baghdad'], ['Dschidda', 'Jeddah'],
    ['Kapstadt', 'Cape Town'], ['Kopenhagen', 'Copenhagen'], ['Den\\s+Haag', 'The Hague'], ['Lissabon', 'Lisbon'], ['Tokio', 'Tokyo'],
    ['Genf', 'Geneva'], ['Bukarest', 'Bucharest'], ['Damaskus', 'Damascus'], ['Riad', 'Riyadh'], ['Tripolis', 'Tripoli'],
    ['Khartum', 'Khartoum'], ['Addis\\s+Abeba', 'Addis Ababa'], ['Schanghai', 'Shanghai'], ['Taipeh', 'Taipei'], ['Kalkutta', 'Kolkata'],
    ['Karatschi', 'Karachi'], ['Sankt\\s+Petersburg', 'Saint Petersburg'], ['Mailand', 'Milan'], ['Venedig', 'Venice'],
    ['Florenz', 'Florence'], ['Neapel', 'Naples'], ['Genua', 'Genoa'], ['Havanna', 'Havana'], ['Westjordanland', 'West Bank'],
    ['Mossul', 'Mosul'], ['Charkiw', 'Kharkiv'], ['Cherson', 'Kherson'], ['Donezk', 'Donetsk'], ['Saporischschja', 'Zaporizhzhia'],
    ['Krim', 'Crimea'], ['Sewastopol', 'Sevastopol'], ['Neu-Delhi', 'New Delhi'], ['Mexiko-Stadt', 'Mexico City'],
    ['Hongkong', 'Hong Kong'], ['Köln', 'Cologne'], ['Nürnberg', 'Nuremberg'], ['Lüttich', 'Liège'], ['Antwerpen', 'Antwerp'],
    ['Brügge', 'Bruges'], ['Stra(?:ß|ss)burg', 'Strasbourg'], ['Hormus|Ormus', 'Hormuz'],
  ]),
]

const ITALIAN: Rule[] = [
  r('stati\\s+uniti(?:\\s+d[\'’]america)?', 'United States'),
  r('regno\\s+unito|gran\\s+bretagna|inghilterra', 'United Kingdom'),
  r('emirati\\s+arabi(?:\\s+uniti)?', 'United Arab Emirates'),
  r('corea\\s+del\\s+nord', 'North Korea'), r('corea\\s+del\\s+sud', 'South Korea'),
  r('citt[àa]\\s+del\\s+vaticano|santa\\s+sede', 'Vatican'), r('nuova\\s+zelanda', 'New Zealand'),
  r('francia', 'France'), r('germania', 'Germany'), r('spagna', 'Spain'), r('portogallo', 'Portugal'),
  r('svizzera', 'Switzerland'), r('turchia', 'Turkey'), r('ungheria', 'Hungary'), r('croazia', 'Croatia'),
  r('moldavia', 'Moldova'), r('ucraina', 'Ukraine'), r('bielorussia', 'Belarus'), r('belgio', 'Belgium'),
  r('paesi\\s+bassi|olanda', 'Netherlands'), r('lussemburgo', 'Luxembourg'), r('svezia', 'Sweden'),
  r('norvegia', 'Norway'), r('islanda', 'Iceland'), r('cina', 'China'), r('giappone', 'Japan'), r('siria', 'Syria'),
  r('israele', 'Israel'), r('giordania', 'Jordanian'), r('egitto', 'Egypt'), r('marocco', 'Morocco'),
  r('brasile', 'Brazil'), r('messico', 'Mexico'), r('groenlandia', 'Greenland'),
  r('mosca', 'Moscow'), r('pechino', 'Beijing'), r('bruxelles', 'Brussels'), r('londra', 'London'), r('parigi', 'Paris'),
  r('berlino', 'Berlin'), r('gerusalemme', 'Jerusalem'), r('varsavia', 'Warsaw'), r('atene', 'Athens'),
  r('belgrado', 'Belgrade'), r('lubiana', 'Ljubljana'), r('zagabria', 'Zagreb'), r('bucarest', 'Bucharest'),
  r('praga', 'Prague'), r('roma', 'Rome'), r('milano', 'Milan'), r('casa\\s+bianca', 'White House'),
  r('cremlino', 'Kremlin'),
  mask('mali|usa|modi'),
  ...towns([
    ['Algeri', 'Algiers'], ['Teheran', 'Tehran'], ['Gedda', 'Jeddah'], ['Città\\s+del\\s+Capo', 'Cape Town'],
    ['Copenaghen', 'Copenhagen'], ["L['’]Aia", 'The Hague'], ['Lisbona', 'Lisbon'], ['Edimburgo', 'Edinburgh'], ['Seul', 'Seoul'],
    ['Ginevra', 'Geneva'], ['Damasco', 'Damascus'], ['Riad', 'Riyadh'], ['Tunisi', 'Tunis'], ['Khartum', 'Khartoum'],
    ['Addis\\s+Abeba', 'Addis Ababa'], ['Giacarta', 'Jakarta'], ['San\\s+Pietroburgo', 'Saint Petersburg'], ['Stoccolma', 'Stockholm'],
    ['Dublino', 'Dublin'], ['Anversa', 'Antwerp'], ['Francoforte', 'Frankfurt'], ['Amburgo', 'Hamburg'], ['Colonia', 'Cologne'],
    ['Zurigo', 'Zurich'], ['Losanna', 'Lausanne'], ['Basilea', 'Basel'], ['Lucerna', 'Lucerne'], ['Berna', 'Bern'],
    ['Monaco\\s+di\\s+Baviera', 'Munich'], ['Torino', 'Turin'], ['Venezia', 'Venice'], ['Firenze', 'Florence'],
    ['Napoli', 'Naples'], ['Genova', 'Genoa'], ['Siviglia', 'Seville'], ['Barcellona', 'Barcelona'],
    ['Città\\s+del\\s+Messico', 'Mexico City'], ["L['’]Avana", 'Havana'], ['Filadelfia', 'Philadelphia'], ['Cisgiordania', 'West Bank'],
    ['Bassora', 'Basra'], ['Sebastopoli', 'Sevastopol'], ['Nuova\\s+Delhi', 'New Delhi'], ['Hormuz|Ormuz', 'Hormuz'], ['Cracovia', 'Krakow'],
  ]),
]

const CATALAN: Rule[] = [
  r('estats\\s+units', 'United States'), r('regne\\s+unit|gran\\s+bretanya', 'United Kingdom'),
  r('espanya', 'Spain'), r('alemanya', 'Germany'), r('it[àa]lia', 'Italy'), r('su[ïi]ssa', 'Switzerland'),
  r('b[èe]lgica', 'Belgium'), r('pa[ïi]sos\\s+baixos|holanda', 'Netherlands'), r('ucra[ïi]na', 'Ukraine'),
  r('xina', 'China'), r('jap[óo]', 'Japan'), r('marroc', 'Morocco'), r('alg[èe]ria', 'Algeria'), r('gr[èe]cia', 'Greece'),
  r('egipte', 'Egypt'), r('l[íi]ban', 'Lebanon'), r('m[èe]xic', 'Mexico'), r('vene[çc]uela', 'Venezuela'),
  r('col[òo]mbia', 'Colombia'), r('xile', 'Chile'),
  r('moscou', 'Moscow'), r('pequ[íi]n', 'Beijing'), r('brussel[·.]?les', 'Brussels'), r('londres', 'London'),
  r('par[íi]s', 'Paris'), r('casa\\s+blanca', 'White House'),
  r('escaldes(?:[-\\s]engordany)?', 'Escaldes-Engordany'), r('sant\\s+juli[àa]\\s+de\\s+l[òo]ria', 'Sant Julia de Loria'),
  mask('usa'),
]

const DANISH: Rule[] = [
  r('gr[øo]nlands?|kalaallit\\s+nunaat', 'Greenland'), r('danmarks?', 'Denmark'), r('tysklands?', 'Germany'),
  r('sveriges?', 'Sweden'), r('norges?', 'Norway'), cs('Islands?', 'Iceland'), r('storbritanniens?', 'United Kingdom'),
  r('ruslands?', 'Russia'), r('hviderus?lands?', 'Belarus'), r('kinas?', 'China'), r('frankrigs?', 'France'),
  r('spaniens?', 'Spain'), r('italiens?', 'Italy'), r('nederlandenes?', 'Netherlands'), r('polens?', 'Poland'),
  r('[øo]strigs?', 'Austria'), r('schweiz', 'Switzerland'), r('belgiens?', 'Belgium'), r('tyrkiets?', 'Turkey'),
  r('gr[æa]kenlands?', 'Greece'), r('syriens?', 'Syria'), r('egyptens?', 'Egypt'), r('libanons?', 'Lebanon'),
  r('pal[æa]stinas?', 'Palestine'), r('nordkoreas?', 'North Korea'), r('sydkoreas?', 'South Korea'),
  r('indiens?', 'India'), r('brasiliens?', 'Brazil'), r('australiens?', 'Australia'), r('sydafrikas?', 'South Africa'),
  r('estlands?', 'Estonia'), r('letlands?', 'Latvia'), r('litauens?', 'Lithuania'), r('ungarns?', 'Hungary'),
  r('tjekkiets?', 'Czechia'), r('rum[æa]niens?', 'Romania'),
  r('k[øo]benhavns?', 'Copenhagen'), r('moskvas?', 'Moscow'), r('bruxelles', 'Brussels'), r('kiev|kyjiv', 'Kyiv'),
  r('det\\s+hvide\\s+hus', 'White House'), r('kreml', 'Kremlin'),
  // Sermitsiaq.AG (Nov 9, 2026) takes world news from the wires, which named no place: "Amerikanske aktiemarkeder
  // stabiliserer sig" (adjectives, as English "Russian" counts), "Alaskas valgmyndighed" (a name spelled as in English,
  // with the genitive s) and other countries' Danish names. Not the Nordic neighbours' adjectives ("norske", "svenske",
  // "færøske"), common in Greenland's own news
  r('amerikansk[e]?', 'United States'), r('russisk[e]?', 'Russian'), r('ukrainsk[e]?', 'Ukrainian'),
  r('kinesisk[e]?', 'Chinese'), r('israelsk[e]?', 'Israeli'), r('iransk[e]?', 'Iranian'), r('tyrkisk[e]?', 'Turkish'),
  r('britisk[e]?', 'United Kingdom'), r('japansk[e]?', 'Japanese'), r('indisk[e]?', 'Indian'), r('tysk[e]?', 'German'),
  r('syrisk[e]?', 'Syrian'), r('pal[æa]stinensisk[e]?', 'Palestinian'), r('nordkoreansk[e]?', 'North Korea'),
  r('sydkoreansk[e]?', 'South Korea'), r('gr[øo]nlandsk[e]?', 'Greenland'),
  r('alaskas', 'Alaska'), r('ukraines', 'Ukraine'), r('israels', 'Israel'), r('irans', 'Iran'), r('iraks?', 'Iraq'),
  r('japans', 'Japan'), r('canadas', 'Canada'), r('mexicos', 'Mexico'), r('venezuelas', 'Venezuela'), r('gazas', 'Gaza'),
  r('saudi-arabiens?', 'Saudi Arabia'), r('irlands?', 'Ireland'), r('skotlands?', 'Scotland'), r('cyperns?', 'Cyprus'),
  r('kroatiens?', 'Croatia'), r('serbiens?', 'Serbia'), r('indonesiens?', 'Indonesia'), r('filippinerne', 'Philippines'),
  r('marokkos?', 'Morocco'), r('algeriets?', 'Algeria'), r('libyens?', 'Libya'), r('etiopiens?', 'Ethiopia'),
  r('f[æa]r[øo]erne', 'Faroe Islands'),
  r('(?:[øo]st|vest|syd|nord|nordvest|nord[øo]st|sydvest|syd[øo]st|midt)gr[øo]nlands?', 'Greenland'),
  // "i" (in) and "besøger" (visits) put what follows them where the story is, as in English: "Amerikanske politikere
  // besøger Grønland" is Greenland's, "Valg i USA" the United States'
  cs('i', 'in'), r('bes[øo]g(?:er|te|e)', 'visits'),
  // an envoy's country is not where the story is (geo.ts withoutEnvoyCountries): "Ny amerikansk konsul" is Nuuk's
  r('ambassad[øo]r(?:en|er|erne)?', 'ambassador'), r('ambassade(?:n|r|rne)?', 'embassy'),
  r('konsulat(?:et|er|erne)?', 'consulate'), r('konsul(?:en|er|erne)?', 'consul'),
  ...towns([
    ['Peking', 'Beijing'], ['Athen', 'Athens'], ['Lissabon', 'Lisbon'], ['Haag', 'The Hague'], ['Kairo', 'Cairo'],
    ['Teheran', 'Tehran'], ['Bagdad', 'Baghdad'], ['Damaskus', 'Damascus'], ['Warszawa', 'Warsaw'], ['Prag', 'Prague'],
    ['Wien', 'Vienna'], ['Genève', 'Geneva'], ['Hamborg', 'Hamburg'], ['München', 'Munich'], ['Gøteborg', 'Gothenburg'],
    ['Vestbredden', 'West Bank'],
  ]),
]

const DUTCH: Rule[] = [
  r('verenigde\\s+staten', 'United States'), r('verenigd\\s+koninkrijk|groot[-\\s]brittanni[ëe]', 'United Kingdom'),
  r('zuid[-\\s]afrika', 'South Africa'), r('noord[-\\s]korea', 'North Korea'), r('zuid[-\\s]korea', 'South Korea'),
  // (French Guiana is not Guyana, nor France's capital)
  r('frans[-\\s]guyana', '…'),
  r('nederlandse?', 'Netherlands'), r('nederland', 'Netherlands'), r('duitsland', 'Germany'), r('frankrijk', 'France'),
  r('belgi[ëe]', 'Belgium'), r('spanje', 'Spain'), r('itali[ëe]', 'Italy'), r('rusland', 'Russia'),
  r('oekra[ïi]ne', 'Ukraine'), r('turkije', 'Turkey'), r('marokko', 'Morocco'), r('syri[ëe]', 'Syria'),
  r('zwitserland', 'Switzerland'), r('oostenrijk', 'Austria'), r('polen', 'Poland'), r('griekenland', 'Greece'),
  r('zweden', 'Sweden'), r('noorwegen', 'Norway'), r('denemarken', 'Denmark'), r('brazili[ëe]', 'Brazil'),
  r('indonesi[ëe]', 'Indonesia'),
  r('nieuw[-\\s]nickerie', 'Nickerie'), r('den\\s+haag', 'The Hague'), r('brussel', 'Brussels'), r('moskou', 'Moscow'),
  r('peking', 'Beijing'), r('kiev', 'Kyiv'), r('witte\\s+huis', 'White House'),
]

const ROMANIAN: Rule[] = [
  r('statele\\s+unite(?:\\s+ale\\s+americii)?', 'United States'), cs('SUA', 'United States'),
  r('marea\\s+britanie|regatul\\s+unit', 'United Kingdom'), r('[țţt][ăa]rile\\s+de\\s+jos|olanda', 'Netherlands'),
  r('transnistri(?:a|ei)|st[âa]nga\\s+nistrului', 'Transnistria'), r('g[ăa]g[ăa]uzi(?:a|ei)', 'Gagauzia'),
  r('moldovei', 'Moldova'), r('rom[âa]ni(?:a|ei)', 'Romania'), r('ucrain(?:a|ei)', 'Ukraine'), r('rusi(?:a|ei)', 'Russia'),
  r('germani(?:a|ei)', 'Germany'), r('fran[țţt](?:a|ei)', 'France'), r('itali(?:a|ei)', 'Italy'),
  r('spani(?:a|ei)', 'Spain'), r('chin(?:a|ei)', 'China'), r('japoni(?:a|ei)', 'Japan'), r('turci(?:a|ei)', 'Turkey'),
  r('ungari(?:a|ei)', 'Hungary'), r('bulgariei', 'Bulgaria'), r('poloni(?:a|ei)', 'Poland'), r('greci(?:a|ei)', 'Greece'),
  r('serbiei', 'Serbia'), r('austriei', 'Austria'), r('elve[țţt]i(?:a|ei)', 'Switzerland'), r('belgi(?:a|ei)', 'Belgium'),
  r('israelului', 'Israel'), r('iranului', 'Iran'), r('siri(?:a|ei)', 'Syria'),
  r('chi[șşs]in[ăa]u(?:lui)?', 'Chisinau'), r('tiraspol(?:ul|ului)', 'Tiraspol'), r('bucure[șşs]ti(?:ului)?', 'Bucharest'), r('moscova', 'Moscow'),
  r('bruxelles', 'Brussels'), r('londra', 'London'), r('kiev(?:ul|ului)?', 'Kyiv'), r('casa\\s+alb[ăa]', 'White House'),
  r('kremlin(?:ul|ului)', 'Kremlin'),
  r('rus(?:ă|a|esc|ească|easca|ești|eşti|esti|ii|ilor)', 'Russian'), r('ucrainean(?:ă|a|ul|ului|ii|ilor|ca|e)?', 'Ukrainian'),
  r('american(?:ă|a|ul|ului|ii|ilor|ca|e)?', 'United States'), r('chinez(?:ă|a|ul|ii|e|esc|ească)?', 'Chinese'),
  r('israelian(?:ă|a|ul|ii|e)?', 'Israeli'), r('turc(?:ă|a|ul|ii|e|esc|ească)?', 'Turkish'),
  r('francez(?:ă|a|ul|ii|e)?', 'French'), r('britanic(?:ă|a|ul|ii|e)?', 'United Kingdom'),
  mask('usa'),
]

const SLOVENE: Rule[] = [
  // Slovene "in" is "and" ("ZDA in Kitajska", the US and China), not where something happens
  r('in', 'and'),
  r('bosn[aeio]\\s+in\\s+hercegovin[aeio]', 'Bosnia'), r('[čc]rn[aeio]\\s+gor[aeio]', 'Montenegro'),
  r('severn[aeio]\\s+makedonij[aeio]|makedonij[aeio]', 'North Macedonia'),
  r('velik[aeio]\\s+britanij[aeio]|zdru[žz]en[aeo]\\s+kraljestv[aou]', 'United Kingdom'), cs('ZDA', 'United States'),
  r('slovenij[aeio]', 'Slovenia'), r('hrva[šs]k[aeio]', 'Croatia'), r('avstrij[aeio]', 'Austria'),
  r('italij[aeio]', 'Italy'), r('mad[žz]arsk[aeio]', 'Hungary'), r('nem[čc]ij[aeio]', 'Germany'),
  r('francij[aeio]', 'France'), r('[šs]panij[aeio]', 'Spain'), r('rusij[aeio]', 'Russia'), r('ukrajin[aeio]', 'Ukraine'),
  r('kitajsk(?:a|e|i|o|ega|emu|em|im|ih|imi|ima)', 'China'), r('japonsk[aeio]', 'Japan'), r('srbij[aeio]', 'Serbia'), r('albanij[aeio]', 'Albania'),
  r('gr[čc]ij[aeio]', 'Greece'), r('tur[čc]ij[aeio]', 'Turkey'), r('izrael(?:a|u|om)?', 'Israel'),
  r('poljsk(?:a|e|i|o|em)', 'Poland'), r('var[šs]av[aeio]', 'Warsaw'), r('[čc]e[šs]k[aeio]', 'Czechia'), r('slova[šs]k[aeio]', 'Slovakia'),
  r('romunij[aeio]', 'Romania'), r('bolgarij[aeio]', 'Bulgaria'), r('[šs]vic[aeio]', 'Switzerland'),
  r('belgij[aeio]', 'Belgium'), r('nizozemsk[aeio]', 'Netherlands'), r('[šs]vedsk[aeio]', 'Sweden'),
  r('norve[šs]k[aeio]', 'Norway'), r('kanad[aeio]', 'Canada'), r('mehik[aeio]', 'Mexico'),
  r('brazilij[aeio]', 'Brazil'), r('indij[aeio]', 'India'), r('irana|iranu', 'Iran'), r('sirij[aeio]', 'Syria'),
  r('egipt(?:a|u|om)', 'Egypt'),
  r('ljubljan[aeio]', 'Ljubljana'), r('maribor(?:u|a|om)', 'Maribor'), r('celj[eau]', 'Celje'),
  r('koper|kopr(?:u|a)', 'Slovenia'), r('kranj(?:u|a)', 'Kranj'), r('nov(?:o|em)\\s+mest(?:o|u)', 'Novo Mesto'),
  r('nov[aeio]\\s+goric[aeio]', 'Nova Gorica'), r('velenj[eau]', 'Velenje'), r('ptuj(?:u|a)', 'Ptuj'),
  r('dunaj(?:u|a)?', 'Vienna'), r('trst(?:u|a)?', 'Trieste'), r('zagreb(?:u|a)', 'Zagreb'),
  r('beograd(?:u|a)?', 'Belgrade'), r('bruselj|brusl(?:ju|ja)', 'Brussels'), r('moskv[aeio]', 'Moscow'),
  r('kijev(?:u|a)?', 'Kyiv'), r('peking(?:u|a)', 'Beijing'), r('bel[aeio]\\s+hi[šs][aeio]', 'White House'),
  r('kremelj|kremlj[aeu]', 'Kremlin'),
  r('rusk(?:i|a|o|e|ega|emu|em|im|ih|imi|ima)', 'Russian'), r('ukrajinsk(?:i|a|o|e|ega|emu|em|im|ih|imi|ima)', 'Ukrainian'),
  r('ameri[šs]k(?:i|a|o|e|ega|emu|em|im|ih|imi|ima)', 'United States'), r('izraelsk(?:i|a|o|e|ega|emu|em|im|ih|imi|ima)', 'Israeli'),
  r('nem[šs]k(?:i|a|o|e|ega|emu|em|im|ih|imi|ima)', 'German'), r('italijansk(?:i|a|o|e|ega|emu|em|im|ih|imi|ima)', 'Italian'),
  r('francosk(?:i|a|o|e|ega|emu|em|im|ih|imi|ima)', 'French'), r('britansk(?:i|a|o|e|ega|emu|em|im|ih|imi|ima)', 'United Kingdom'),
  r('srbsk(?:i|a|o|e|ega|emu|em|im|ih|imi|ima)', 'Serbian'),
  r('mali', '…'),
]

const MONTENEGRIN: Rule[] = [
  r('crn(?:a|e|oj|u|om)\\s+gor(?:a|e|i|u|om)', 'Montenegro'),
  r('bosn(?:a|e|i|u)\\s+i\\s+hercegovin(?:a|e|i|u)', 'Bosnia'),
  r('sjedinjen(?:e|ih|im)\\s+(?:ameri[čc]k(?:e|ih|im)\\s+)?dr[žz]av(?:e|a|ama)', 'United States'), cs('SAD', 'United States'),
  r('velik(?:a|e|oj|u)\\s+britanij(?:a|e|i|u)', 'United Kingdom'),
  r('(?:sjevern(?:a|e|oj|u)\\s+)?makedonij(?:a|e|i|u|om)', 'North Macedonia'),
  r('srbij(?:a|e|i|u|om)', 'Serbia'), r('hrvatsk(?:a|e|oj|u|om)', 'Croatia'), r('albanij(?:a|e|i|u|om)', 'Albania'),
  r('kosov(?:a|u|om)', 'Kosovo'), r('njema[čc]k(?:a|e|i|o|oj|u|om|og|oga|ih|im|ima)', 'Germany'), r('francusk(?:a|e|oj|u|om)', 'France'),
  r('italij(?:a|e|i|u|om)', 'Italy'), r('rusij(?:a|e|i|u|om)', 'Russia'), r('ukrajin(?:a|e|i|u|om)', 'Ukraine'),
  cs('Kin(?:a|e|i|u|om)', 'China'), r('tursk(?:a|e|i|o|oj|u|om|og|oga|ih|im|ima)', 'Turkey'), r('gr[čc]k(?:a|e|oj|u|om)', 'Greece'),
  r('austrij(?:a|e|i|u|om)', 'Austria'), r('ma[đd]arsk(?:a|e|oj|u|om)', 'Hungary'), r('slovenij(?:a|e|i|u|om)', 'Slovenia'),
  r('izrael(?:a|u|om)?', 'Israel'), r('poljsk(?:a|e|oj|u|om)', 'Poland'), r('[čc]e[šs]k(?:a|e|oj|u|om)', 'Czechia'),
  r('slova[čc]k(?:a|e|oj|u|om)', 'Slovakia'), r('rumunij(?:a|e|i|u|om)', 'Romania'), r('bugarsk(?:a|e|oj|u|om)', 'Bulgaria'),
  r('[šs]vajcarsk(?:a|e|oj|u|om)', 'Switzerland'), r('belgij(?:a|e|i|u|om)', 'Belgium'),
  r('holandij(?:a|e|i|u|om)|nizozemsk(?:a|e|oj|u)', 'Netherlands'), r('[šs]vedsk(?:a|e|oj|u|om)', 'Sweden'),
  r('kanad(?:a|e|i|u|om)', 'Canada'), r('japan(?:a|u|om)', 'Japan'), r('indij(?:a|e|i|u|om)', 'India'),
  r('iran(?:a|u|om)', 'Iran'), r('sirij(?:a|e|i|u|om)', 'Syria'), r('egipt(?:a|u|om)', 'Egypt'),
  r('krakov(?:a|u|om)', 'Krakow'), r('istanbul(?:a|u|om)', 'Istanbul'),
  r('podgoric(?:a|e|i|u|om)', 'Podgorica'), r('nik[šs]i[ćc](?:a|u|em)?', 'Niksic'), r('budv(?:a|e|i|u|om)', 'Budva'),
  r('herceg[-\\s]nov(?:i|og|om)', 'Herceg Novi'), r('cetinj(?:e|a|u|em)', 'Cetinje'),
  r('bijel(?:o|og|om)\\s+polj(?:e|a|u)', 'Bijelo Polje'), r('pljevlj(?:a|ima)', 'Pljevlja'), r('ulcinj(?:a|u|em)?', 'Ulcinj'),
  r('kotor(?:a|u|om)?', 'Kotor'), r('tivt(?:a|u|om)|tivat', 'Tivat'), r('beranama', 'Berane'),
  r('beograd(?:a|u|om)?', 'Belgrade'), r('zagreb(?:a|u|om)', 'Zagreb'), r('sarajev(?:a|u|om)', 'Sarajevo'),
  r('pri[šs]tin(?:a|e|i|u|om)', 'Pristina'), r('brisel(?:a|u|om)?', 'Brussels'), r('moskv(?:a|e|i|u|om)', 'Moscow'),
  r('va[šs]ington(?:a|u|om)?', 'Washington'), r('kijev(?:a|u|om)?', 'Kyiv'), r('peking(?:a|u|om)', 'Beijing'),
  r('bijel(?:a|e|oj|u)\\s+ku[ćc](?:a|e|i|u)', 'White House'), r('kremlj(?:a|u|om)?', 'Kremlin'),
  r('rusk(?:i|a|o|e|og|oga|om|omu|oj|u|ih|im|ima)', 'Russian'), r('ukrajinsk(?:i|a|o|e|og|oga|om|omu|oj|u|ih|im|ima)', 'Ukrainian'),
  r('ameri[čc]k(?:i|a|o|e|og|oga|om|omu|oj|u|ih|im|ima)', 'United States'), r('kinesk(?:i|a|o|e|og|oga|om|omu|oj|u|ih|im|ima)', 'Chinese'),
  r('izraelsk(?:i|a|o|e|og|oga|om|omu|oj|u|ih|im|ima)', 'Israeli'),
  // Bosnian and Serbian towns in the cases a sentence puts them in ("u Zenici", "u Tuzli"), which no gazetteer lists
  r('zenic(?:a|e|i|u|om)', 'Zenica'), r('tuzl(?:a|e|i|u|om)', 'Tuzla'), r('mostar(?:a|u|om)?', 'Mostar'),
  r('banj(?:a|e|oj|u)\\s+luk(?:a|e|i|u|om)|banj(?:a|e|oj|u)\\s+luc(?:i)|banjaluk(?:a|e|i|u|om)', 'Banja Luka'),
  r('biha[ćc](?:a|u|em)?', 'Bihac'), r('bijeljin(?:a|e|i|u|om)', 'Bijeljina'), r('travnik(?:a|u|om)?', 'Travnik'),
  r('novog\\s+sada|novom\\s+sadu', 'Novi Sad'), r('kragujevc(?:a|u|em)|kragujevac', 'Kragujevac'),
  // Montenegro's other towns and Sofia in their cases (Nov 14: Aktuelno's "zaobilaznica oko Bara" and "konferenciji u Sofiji" sat at
  // Podgorica); Bar, Plav and Sofija are also a word, a colour and a given name, so they are read capitalised after a place preposition
  cs('(?<=(?:^|[^\\p{L}])(?:u|iz|oko|kod|do|za|na|sa|prema|blizu)\\s)Bar(?:a|u|om)', 'Bar, Montenegro'), cs('(?<=(?:^|[^\\p{L}])(?:u|iz|oko|kod|do|za|na|sa|prema|blizu)\\s)Sofij(?:i|e|u)', 'Sofia'),
  r('kola[šs]in(?:a|u|om)?', 'Kolasin'), r('[žz]abljak(?:a|u|om)?', 'Zabljak'), r('mojkovc(?:a|u|em)|mojkovac', 'Mojkovac'),
  r('danilovgrad(?:a|u|om)?', 'Danilovgrad'), r('ro[žz]aj(?:e|a|ama)', 'Rozaje'), r('andrijevic(?:a|e|i|u|om)', 'Andrijevica'),
  // Foreign capitals in their cases (Nov 16: Portal Analitika's "Podrška evropskih liberala u Dablinu" and "Drakić na Bečkom ekonomskom forumu"
  // sat at Podgorica, the outlet's home)
  r('dablin(?:a|u|om)?', 'Dublin'), r('be[čc](?:a|u|om|kom|ki|kog|koj|kim)', 'Vienna'), r('pariz(?:a|u|om)?', 'Paris'),
  r('berlin(?:a|u|om)', 'Berlin'), r('london(?:a|u|om)', 'London'), r('budimpe[šs]t(?:a|e|i|u|om)', 'Budapest'),
  r('var[šs]av(?:a|e|i|u|om)', 'Warsaw'), r('lisabon(?:a|u|om)?', 'Lisbon'), r('madrid(?:a|u|om)', 'Madrid'),
  r('mali', '…'),
]

const ALBANIAN: Rule[] = [
  // "Mali i Zi" (the Black Mountain) is Montenegro, before "mali" (the mountain) is blanked out
  r('mal(?:i|it|in)\\s+(?:i|t[ëe]|e)\\s+zi', 'Montenegro'),
  r('shtetet\\s+e\\s+bashkuara(?:\\s+t[ëe]\\s+amerik[ëe]s)?', 'United States'), cs('SHBA(?:-?(?:ja|t[ëe]|s[ëe]|n[ëe]))?', 'United States'),
  r('mbret[ëe]ri(?:a|s[ëe]|n[ëe])?\\s+e\\s+bashkuar|britani(?:a|s[ëe]|n[ëe])?\\s+e\\s+madhe', 'United Kingdom'),
  r('maqedoni(?:a|s[ëe]|n[ëe])?(?:\\s+e\\s+veriut)?', 'North Macedonia'),
  r('bosnj(?:a|[ëe]s?|[ëe]n)(?:\\s+dhe\\s+hercegovin(?:a|[ëe]s?|[ëe]n))?', 'Bosnia'),
  r('shqip[ëe]ri(?:a|s[ëe]|n[ëe])?', 'Albania'), r('kosov(?:a|[ëe]s?|[ëe]n)', 'Kosovo'), r('serbi(?:a|s[ëe]|n[ëe])?', 'Serbia'),
  r('greqi(?:a|s[ëe]|n[ëe])?', 'Greece'), r('turqi(?:a|s[ëe]|n[ëe])?', 'Turkey'), r('itali(?:a|s[ëe]|n[ëe])?', 'Italy'),
  r('gjermani(?:a|s[ëe]|n[ëe])?', 'Germany'), r('franc(?:a|[ëe]s?|[ëe]n)', 'France'),
  r('zvic(?:[ëe]r|ra|r[ëe]s|r[ëe]n)', 'Switzerland'), r('austri(?:a|s[ëe]|n[ëe])?', 'Austria'),
  r('kroaci(?:a|s[ëe]|n[ëe])?', 'Croatia'), r('slloveni(?:a|s[ëe]|n[ëe])?', 'Slovenia'), r('hungari(?:a|s[ëe]|n[ëe])?', 'Hungary'),
  r('bullgari(?:a|s[ëe]|n[ëe])?', 'Bulgaria'), r('rumani(?:a|s[ëe]|n[ëe])?', 'Romania'), r('rusi(?:a|s[ëe]|n[ëe])?', 'Russia'),
  r('ukrain(?:a|[ëe]s?|[ëe]n)', 'Ukraine'), cs('Kin(?:a|[ëe]s?|[ëe]n)', 'China'), r('japoni(?:a|s[ëe]|n[ëe])?', 'Japan'),
  r('izrael(?:i|it|in)?', 'Israel'), r('iran(?:i|it|in)', 'Iran'), r('siri(?:a|s[ëe]|n[ëe])?', 'Syria'),
  r('egjipt(?:i|it|in)?', 'Egypt'), r('spanj(?:a|[ëe]s?|[ëe]n)', 'Spain'), r('poloni(?:a|s[ëe]|n[ëe])?', 'Poland'),
  r('belgjik(?:a|[ëe]s?|[ëe]n)', 'Belgium'), r('holand(?:a|[ëe]s?|[ëe]n)', 'Netherlands'),
  r('prisht(?:ina|in[ëe]s?|in[ëe]n)', 'Pristina'), r('prizren(?:i|it|in)', 'Prizren'), r('mitrovic(?:a|[ëe]s?|[ëe]n)', 'Mitrovica'),
  r('pej(?:a|[ëe]s?|[ëe]n)', 'Peja'), r('gjakov(?:a|[ëe]s?|[ëe]n)', 'Gjakova'), r('ferizaj(?:i|t|n)', 'Ferizaj'),
  r('gjilan(?:i|it|in)', 'Gjilan'), r('podujev(?:a|[ëe]s?|[ëe]n)', 'Podujeva'), r('vushtrri(?:a|s[ëe]|n[ëe])', 'Vushtrri'),
  // Kosovo's smaller towns by their Albanian names (Nov 16: an Albanian outlet's "Han i Elezit" story sat at Skopje, the outlet's home)
  r('han(?:i)?\\s+i\\s+elezit', 'Hani i Elezit'), r('ka[çc]anik(?:u|ut)?', 'Kacanik'), r('lipjan(?:i|it|in)?', 'Lipljan'),
  r('fush[ëe]\\s+kosov(?:a|[ëe]s?|[ëe]n)', 'Kosovo Polje'), r('malishev(?:a|[ëe]s?|[ëe]n)', 'Malisevo'),
  r('rahovec(?:i|it|in)?', 'Orahovac'), r('suhar(?:ek[ëe]|ek[ëe]s|ek[ëe]n)', 'Suva Reka'), r('de[çc]an(?:i|it|in)?', 'Decani'),
  r('tiran(?:a|[ëe]s?|[ëe]n)', 'Tirana'), r('beograd(?:i|it|in)?', 'Belgrade'), r('shkup(?:i|it|in)?', 'Skopje'),
  r('bruksel(?:i|it|in)?', 'Brussels'), r('mosk(?:va|[ëe]s?|[ëe]n)', 'Moscow'), r('uashington(?:i|it|in)?', 'Washington'),
  r('kiev(?:i|it|in)?', 'Kyiv'),
  // North Macedonia's, Serbia's and Montenegro's Albanian-speaking towns by their own names (Nov 8, 2026: Portalb's "Në
  // Kumanovë u shënua 81-vjetori i Ansamblit" sat in Skopje). Not "Dibër", also Albania's own county
  r('kumanov(?:a|[ëe]s?|[ëe]n)', 'Kumanovo'), r('tetov(?:a|[ëe]s?|[ëe]n)', 'Tetovo'), r('gostivar(?:i|it|in)?', 'Gostivar'),
  r('strug(?:a|[ëe]s?|[ëe]n)', 'Struga'), r('k[ëe]r[çc]ov(?:a|[ëe]s?|[ëe]n)', 'Kicevo'), r('oh[ëe]r|ohr(?:i|it|in)', 'Ohrid'),
  r('presh(?:eva|ev[ëe]s?|ev[ëe]n)', 'Presevo'), r('bujanoc(?:i|it|in)?', 'Bujanovac'), r('ulqin(?:i|it|in)?', 'Ulcinj'),
  r('sht[ëe]pi(?:a|s[ëe])?\\s+e\\s+bardh[ëe]', 'White House'), r('kreml(?:in)?(?:i|it)?', 'Kremlin'),
  r('kanad(?:a|aja|as[ëe]|an[ëe])', 'Canada'), r('ruse|rus[ëe]t|rus[ëe]ve', 'Russian'),
  r('amerikan(?:e|[ëe]t|[ëe]ve|i|it)?', 'United States'), r('kinez(?:e|[ëe]t|[ëe]ve|i|it)?', 'Chinese'),
  r('ukrainas(?:e|i|it)?', 'Ukrainian'), r('izraelit(?:e|[ëe]t|[ëe]ve|i)?', 'Israeli'), r('gjerman(?:e|[ëe]t|[ëe]ve|i|it)?', 'German'),
  r('mali', '…'),
  // "Beni" before a surname is a man's first name, not the Congo's Beni (Nov 9, 2026: Portalb's "Beni Shaqiri u bë
  // këshilltar i Gjorgjievskit" sat in Beni)
  cs('Beni(?=\\s+\\p{Lu})', '…'),
]

const MALAY: Rule[] = [
  r('amerika\\s+syarikat', 'United States'), r('korea\\s+selatan', 'South Korea'), r('korea\\s+utara', 'North Korea'),
  r('arab\\s+saudi', 'Saudi Arabia'), r('jepun', 'Japan'), r('cina', 'China'), r('filipina', 'Philippines'),
  r('perancis', 'France'), r('jerman', 'Germany'), r('belanda', 'Netherlands'), r('itali', 'Italy'),
  r('sepanyol', 'Spain'), r('mesir', 'Egypt'), r('turki', 'Turkey'), r('kemboja', 'Cambodia'), r('kanada', 'Canada'),
  r('rumah\\s+putih', 'White House'),
]

/**
 * Lithuanian (Nov 6, 2026): Lithuania's own names only. Its feeds are Lithuania's own news (15min less its world
 * section, LRT's "In Lithuania"), so a story that names a neighbour in passing ("pasienyje su Baltarusija", at the
 * border with Belarus) stays at home rather than going abroad. "palaužė" (broke down) read as Palau: the
 * place-finder took "Palau" before a letter it doesn't know as a word's end (seen in LRT's sports headlines).
 */
const LITHUANIAN: Rule[] = [
  r('lietuv(?:a|os|ai|ą|oje)', 'Lithuania'), r('viln(?:ius|iaus|iui|ių|iuje)', 'Vilnius'),
  r('kaun(?:as|o|ui|ą|e)', 'Kaunas'), r('klaip[ėe]d(?:a|os|ai|ą|oje)', 'Klaipeda'),
  r('[šs]iaul(?:iai|ių|iams|ius|iuose)', 'Siauliai'), mask('palauž\\p{L}*'),
]

/**
 * Arabic (Nov 6, 2026; the Arabic press of Jordan, and later Syria and Bahrain): the places their headlines name most,
 * with the article and the little words joined to a name ("الأردن", "بالأردن", "للأردن", "والعراق"), and the peoples'
 * adjectives ("الأردنية", "سوريون"). The text's vowel marks and hamzas are dropped first (arabicPlain), so "الأُرْدُنِّ"
 * and "الاردن" read alike. Left out: names that are everyday words or names too ("عمان" is Amman and Oman, "الرياض" also
 * gardens, "جدة" a grandmother, "الزرقاء" blue, "تركي" a first name, "هند" without its article a woman's name).
 */
const AL = '(?:[وف]?[بلك]?ال|[وف]?لل|[وف]?[بلك]|[وف])?'   // the article, "and", "in", "to", "as" before a name
const AL_ONLY = '(?:[وف]?[بلك]?ال|[وف]?لل)'                 // the article itself, required
const PEOPLE = '(?:ي|ي[ةه]|يون|يين)?'                         // the people's adjective and plural
// The rules are written with the letters as spelled ("إسرائيل", "الجزائر") and read as arabicPlain leaves the text
// (Nov 6, 2026: "اسرائيل" with its ئ never matched the plain "اسراييل", so "الحكومة الإسرائيلية" named no place)
const ARABIC: Rule[] = ([
  // clubs named after a city, before the city (a Real Madrid or PSG story is sport, not Madrid's or Paris's news)
  r(`${AL}ريال\\s+مدريد|${AL}اتلتيكو\\s+مدريد|${AL}باريس\\s+سان\\s+جيرمان`, '…'),
  // ...and a league is its country's (Nov 8, 2026: Al-Watan's "البايرن ودورتموند يصران على الصدارة في البوندسليغا",
  // Bayern and Dortmund stay top of the Bundesliga, sat in Damascus, the outlet's home)
  r(`${AL}بوندسليغا|${AL}بوندسليجا`, 'Germany'), r(`${AL}ليغا|${AL}ليجا`, 'Spain'),
  r(`${AL}بريميرليغ|${AL}بريمرليغ`, 'England'), r(`${AL}كالتشيو`, 'Italy'),
  r(`${AL}اردن${PEOPLE}`, 'Jordanian'), r(`${AL}اربد`, 'Irbid'), r(`${AL_ONLY}عقب[ةه]`, 'Aqaba'),
  // Nov 15, 2026: Jordan's other governorate towns (Roya's Hamoud church verdict story named "بالكرك" and sat unpinned)
  r(`${AL}كرك`, 'Karak'), r(`${AL_ONLY}زرقاء`, 'Az Zarqa'), r(`${AL_ONLY}مفرق`, 'Mafraq'), r(`${AL}جرش`, 'Jerash'),
  r(`${AL}مادبا`, 'Madaba'), r(`${AL_ONLY}طفيل[ةه]`, 'Tafilah'), r(`${AL}عجلون`, 'Ajloun'),
  r(`${AL}سوري(?:ا|[ةه]|ون|ين)?`, 'Syria'), r(`${AL}دمشق`, 'Damascus'), r(`${AL}حلب`, 'Aleppo'), r(`${AL}حمص`, 'Homs'),
  r(`${AL}ادلب`, 'Idlib'), r(`${AL_ONLY}لاذقي[ةه]`, 'Latakia'), r(`${AL}درعا`, 'Daraa'), r(`${AL_ONLY}حسك[ةه]`, 'Hasakah'),
  r(`${AL}دير\\s+الزور`, 'Deir ez-Zor'), r(`${AL_ONLY}سويداء`, 'Suwayda'), r(`${AL}طرطوس`, 'Tartus'),
  r(`${AL}بحرين${PEOPLE}`, 'Bahrain'), r(`${AL_ONLY}منام[ةه]`, 'Manama'), r(`${AL_ONLY}محرق`, 'Muharraq'), r(`${AL_ONLY}رفاع`, 'Riffa'),
  r(`${AL}عراق${PEOPLE}`, 'Iraq'), r(`${AL}بغداد`, 'Baghdad'), r(`${AL_ONLY}بصر[ةه]`, 'Basra'), r(`${AL_ONLY}موصل`, 'Mosul'),
  r(`${AL}اربيل`, 'Erbil'), r(`${AL}لبنان${PEOPLE}`, 'Lebanon'), r(`${AL}بيروت`, 'Beirut'), r(`${AL}مصر${PEOPLE}`, 'Egypt'),
  r(`${AL_ONLY}قاهر[ةه]`, 'Cairo'), r(`${AL}سعودي[ةه]?`, 'Saudi Arabia'), r(`${AL}مك[ةه]\\s+المكرم[ةه]|${AL}مك[ةه]`, 'Makkah'),
  r(`${AL}فلسطين${PEOPLE}`, 'Palestine'), r(`${AL}غز[ةه]`, 'Gaza'), r(`${AL_ONLY}ضف[ةه]\\s+(?:ال)?غربي[ةه]`, 'West Bank'),
  r(`${AL_ONLY}قدس`, 'Jerusalem'), r(`${AL}رام\\s+الله`, 'Ramallah'), r(`${AL}اسرائيل${PEOPLE}`, 'Israel'),
  r(`${AL}ايران${PEOPLE}`, 'Iran'), r(`${AL}طهران`, 'Tehran'), r(`${AL}قشم`, 'Qeshm'), r(`${AL}هرمز`, 'Hormuz'), r(`${AL}تركيا|${AL}تركي[ةه]`, 'Turkey'), r(`${AL}انقر[ةه]`, 'Ankara'),
  r(`${AL}اسطنبول`, 'Istanbul'), r(`${AL}قطر${PEOPLE}`, 'Qatar'), r(`${AL_ONLY}دوح[ةه]`, 'Doha'),
  r(`${AL}امارات${PEOPLE}`, 'United Arab Emirates'), r(`${AL}دبي`, 'Dubai'), r(`${AL}ابو\\s?ظبي`, 'Abu Dhabi'),
  r(`${AL}كويت${PEOPLE}`, 'Kuwait'), r(`سلطن[ةه]\\s+عمان`, 'Oman'), r(`${AL_ONLY}يمن${PEOPLE}|${AL}يمني(?:[ةه]|ون|ين)?`, 'Yemen'),
  r(`${AL}صنعاء`, 'Sanaa'), r(`${AL}الولايات\\s+المتحد[ةه](?:\\s+الامريكي[ةه]|\\s+الاميركي[ةه])?`, 'United States'),
  r(`${AL}(?:امريكا|اميركا|امريكي|اميركي)(?:[ةه]|ون|ين)?`, 'United States'), r(`${AL}واشنطن`, 'Washington'),
  r(`${AL}روسيا|${AL}روسي(?:[ةه]|ون|ين)?`, 'Russia'), r(`${AL}موسكو`, 'Moscow'), r(`${AL}كرملين`, 'Moscow'),
  r(`${AL}اوكرانيا|${AL}اوكراني(?:[ةه]|ون|ين)?`, 'Ukraine'), r(`${AL}كييف`, 'Kyiv'), r(`${AL_ONLY}صين|${AL}صيني(?:[ةه]|ون|ين)?`, 'China'),
  r(`${AL}بكين`, 'Beijing'), r(`${AL}بريطانيا|${AL}بريطاني(?:[ةه]|ون|ين)?`, 'United Kingdom'), r(`${AL}لندن`, 'London'),
  r(`${AL}فرنسا|${AL}فرنسي(?:[ةه]|ون|ين)?`, 'France'), r(`${AL}باريس`, 'Paris'), r(`${AL}المانيا|${AL}الماني(?:[ةه]|ون|ين)?`, 'Germany'),
  r(`${AL}برلين`, 'Berlin'), r(`${AL}كازاخستان`, 'Kazakhstan'), r(`${AL}استانا`, 'Astana'), r(`${AL}استونيا`, 'Estonia'),
  r(`${AL}اندونيسيا`, 'Indonesia'), r(`${AL}هولندا`, 'Netherlands'), r(`${AL_ONLY}سويد`, 'Sweden'), r(`${AL}بيرو`, 'Peru'),
  r(`${AL_ONLY}يابان|${AL}ياباني(?:[ةه]|ون|ين)?`, 'Japan'), r(`${AL_ONLY}هند|${AL}هندي(?:[ةه])?`, 'India'),
  r(`${AL}باكستان${PEOPLE}`, 'Pakistan'), r(`${AL}افغانستان`, 'Afghanistan'),
  // Nov 6, 2026, 2 PM, with Syria's and Bahrain's Arabic press: Syria's other cities ("ريف حماة", "بالرقة"), and the
  // countries and cities their world news names. Left out: "حماة" without a place word before it (also protectors:
  // "حماة الوطن"), "تدمر" (also destroys), "سيول" (also floods), "كابل" (a cable), "كوبا" (a cup), "روما" (mostly the
  // football club), "رومانيا"'s adjective (also Roman: "المدرج الروماني"), "الكندي" (a family name), "اوسلو" (mostly
  // the Oslo Accords), "طرابلس" (Libya's and Lebanon's), "صور" (also pictures), "الباب" (also the door), "دوما" (also
  // the Duma), "جورجيا" (also the US state)
  r(`(?<=(?:ريف|محافظ[ةه]|مدين[ةه]|ريفي|في|من|الى)\\s)حما[ةه]|[وب]حما[ةه]`, 'Hama'), r(`${AL_ONLY}قنيطر[ةه]`, 'Quneitra'),
  r(`${AL_ONLY}رق[ةه]`, 'Raqqa'), r(`${AL_ONLY}قامشلي|${AL}قامشلو`, 'Qamishli'), r(`${AL}عفرين`, 'Afrin'),
  r(`${AL}منبج`, 'Manbij'), r(`${AL_ONLY}بوكمال|${AL}ابو\\s?كمال`, 'Abu Kamal'), r(`${AL}جسر\\s+الشغور`, 'Jisr al-Shughur'),
  r(`${AL}اقليم\\s+كردستان(?:\\s+العراق)?|${AL}كردستان\\s+العراق`, 'Iraqi Kurdistan'), r(`${AL}كركوك`, 'Kirkuk'),
  r(`${AL_ONLY}نجف`, 'Najaf'), r(`${AL}كربلاء`, 'Karbala'),
  // Sulaymaniyah only after a place word or a joined "in" ("التكية السليمانية" is the Sulaymaniyya Takiyya in Damascus)
  r(`(?<=(?:في|محافظ[ةه]|مدين[ةه]|من|الى)\\s)السليماني[ةه]|[وب]السليماني[ةه]|للسليماني[ةه]`, 'Sulaymaniyah'),
  r(`${AL_ONLY}فلوج[ةه]`, 'Fallujah'), r(`${AL}حيفا`, 'Haifa'), r(`${AL}تل\\s?ابيب`, 'Tel Aviv'), r(`${AL}نابلس`, 'Nablus'),
  r(`${AL}رفح`, 'Rafah'), r(`${AL}خان\\s+يونس`, 'Khan Younis'), r(`[وف]?[بل]?جنين`, 'Jenin'), r(`${AL}صيدا`, 'Sidon'),
  r(`${AL}بعلبك`, 'Baalbek'), r(`${AL}بنغازي`, 'Benghazi'), r(`${AL}مصرات[ةه]`, 'Misrata'), r(`${AL_ONLY}خرطوم`, 'Khartoum'),
  r(`${AL}ام\\s?درمان`, 'Omdurman'), r(`${AL_ONLY}فاشر`, 'El Fasher'), r(`${AL}دارفور`, 'Darfur'),
  r(`${AL}بور\\s?سودان`, 'Port Sudan'), r(`${AL_ONLY}دار\\s+البيضاء`, 'Casablanca'), r(`${AL_ONLY}رباط`, 'Rabat'),
  r(`${AL}مراكش`, 'Marrakech'), r(`${AL}نواكشوط`, 'Nouakchott'), r(`${AL}مقديشو`, 'Mogadishu'),
  r(`${AL}اديس\\s+ابابا`, 'Addis Ababa'), r(`${AL_ONLY}حديد[ةه]`, 'Hodeidah'), r(`${AL}عدن`, 'Aden'), r(`${AL}تعز`, 'Taiz'),
  r(`${AL_ONLY}شارق[ةه]`, 'Sharjah'), r(`${AL_ONLY}مدين[ةه]\\s+المنور[ةه]`, 'Medina'), r(`${AL_ONLY}بيت\\s+الابيض`, 'White House'),
  r(`${AL}فاتيكان`, 'Vatican'), r(`${AL}نيويورك`, 'New York'), r(`${AL}ديترويت`, 'Detroit'),
  r(`${AL}لوس\\s+انجلوس|${AL}لوس\\s+انجليس`, 'Los Angeles'), r(`${AL}شيكاغو`, 'Chicago'), r(`${AL}تورنتو|${AL}تورونتو`, 'Toronto'),
  r(`${AL}براغ`, 'Prague'), r(`${AL}مدريد`, 'Madrid'), r(`${AL}بروكسل`, 'Brussels'), r(`${AL}جنيف`, 'Geneva'),
  r(`${AL}فيينا`, 'Vienna'), r(`${AL}اثينا`, 'Athens'), r(`${AL}ستوكهولم`, 'Stockholm'), r(`${AL}كوبنهاغن|${AL}كوبنهاجن`, 'Copenhagen'),
  r(`${AL}وارسو`, 'Warsaw'), r(`${AL}بودابست`, 'Budapest'), r(`${AL}بوخارست`, 'Bucharest'), r(`${AL}مينسك`, 'Minsk'),
  r(`${AL}طوكيو`, 'Tokyo'), r(`${AL}نيودلهي|${AL}نيو\\s+دلهي`, 'New Delhi'), r(`${AL}اسلام\\s?اباد`, 'Islamabad'),
  r(`${AL}كراتشي`, 'Karachi'), r(`${AL}مومباي`, 'Mumbai'), r(`${AL}جاكرتا`, 'Jakarta'), r(`${AL}كوالالمبور`, 'Kuala Lumpur'),
  r(`${AL}بانكوك`, 'Bangkok'), r(`${AL}هانوي`, 'Hanoi'), r(`${AL}مانيلا`, 'Manila'), r(`${AL}سنغافور[ةه]`, 'Singapore'),
  r(`${AL}هونغ\\s?كونغ|${AL}هونج\\s?كونج`, 'Hong Kong'), r(`${AL}شنغهاي`, 'Shanghai'), r(`${AL}تايبيه`, 'Taipei'),
  r(`${AL}باكو`, 'Baku'), r(`${AL}يريفان`, 'Yerevan'), r(`${AL}تبليسي`, 'Tbilisi'),
  r(`${AL}جنوب\\s+السودان`, 'South Sudan'), r(`${AL_ONLY}سودان${PEOPLE}`, 'Sudan'), r(`${AL_ONLY}مغرب${PEOPLE}|${AL}مغربي(?:[ةه]|ون|ين)?`, 'Morocco'),
  r(`${AL_ONLY}جزائر${PEOPLE}`, 'Algeria'), r(`${AL}تونس${PEOPLE}`, 'Tunisia'), r(`${AL}ليبيا|${AL}ليبي(?:[ةه]|ون|ين)?`, 'Libya'),
  r(`${AL}موريتانيا|${AL}موريتاني(?:[ةه]|ون|ين)?`, 'Mauritania'), r(`${AL_ONLY}صومال${PEOPLE}`, 'Somalia'),
  r(`${AL}جيبوتي`, 'Djibouti'), r(`${AL}اثيوبيا|${AL}اثيوبي(?:[ةه]|ون|ين)?`, 'Ethiopia'), r(`${AL}اريتريا`, 'Eritrea'),
  r(`${AL}كينيا`, 'Kenya'), r(`${AL}نيجيريا`, 'Nigeria'), r(`${AL}تشاد`, 'Chadian'),
  r(`${AL}اسبانيا|${AL}اسباني(?:[ةه]|ون|ين)?`, 'Spain'), r(`${AL_ONLY}برتغال${PEOPLE}`, 'Portugal'),
  r(`${AL}انجلترا|${AL}انكلترا`, 'England'),
  r(`${AL}ايطاليا|${AL}ايطالي(?:[ةه]|ون|ين)?`, 'Italy'), r(`${AL_ONLY}يونان${PEOPLE}`, 'Greece'), r(`${AL}قبرص${PEOPLE}`, 'Cyprus'),
  r(`${AL}بلجيكا|${AL}بلجيكي(?:[ةه]|ون|ين)?`, 'Belgium'), r(`${AL}سويسرا|${AL}سويسري(?:[ةه]|ون|ين)?`, 'Switzerland'),
  r(`${AL_ONLY}نمسا|${AL}نمساوي(?:[ةه]|ون|ين)?`, 'Austria'), r(`${AL}بولندا|${AL}بولندي(?:[ةه]|ون|ين)?`, 'Poland'),
  r(`${AL_ONLY}مجر${PEOPLE}`, 'Hungary'), r(`${AL_ONLY}تشيك${PEOPLE}`, 'Czechia'), r(`${AL}رومانيا`, 'Romania'),
  r(`${AL}بلغاريا`, 'Bulgaria'), r(`${AL}صربيا|${AL}صربي(?:[ةه]|ون|ين)?`, 'Serbia'), r(`${AL}كرواتيا`, 'Croatia'),
  r(`${AL}البانيا`, 'Albania'), r(`${AL}مالطا`, 'Malta'), r(`${AL_ONLY}دنمارك${PEOPLE}`, 'Denmark'),
  r(`${AL_ONLY}نرويج${PEOPLE}`, 'Norway'), r(`${AL}فنلندا`, 'Finland'), r(`${AL}ايرلندا|${AL}ايرلندي(?:[ةه]|ون|ين)?`, 'Ireland'),
  r(`${AL}كندا|${AL}كندي(?:[ةه]|ون|ين)`, 'Canada'), r(`${AL_ONLY}مكسيك${PEOPLE}`, 'Mexico'), r(`${AL_ONLY}برازيل${PEOPLE}`, 'Brazil'),
  r(`${AL_ONLY}ارجنتين${PEOPLE}`, 'Argentina'), r(`${AL}فنزويلا|${AL}فنزويلي(?:[ةه]|ون|ين)?`, 'Venezuela'),
  r(`${AL}كولومبيا`, 'Colombia'), r(`${AL}تشيلي`, 'Chile'), r(`${AL}استراليا|${AL}استرالي(?:[ةه]|ون|ين)?`, 'Australia'),
  r(`${AL}كوريا\\s+الشمالي[ةه]`, 'North Korea'), r(`${AL}كوريا\\s+الجنوبي[ةه]`, 'South Korea'), r(`${AL}تايوان`, 'Taiwan'),
  r(`${AL}ماليزيا`, 'Malaysia'), r(`${AL_ONLY}فلبين`, 'Philippines'), r(`${AL}فيتنام`, 'Vietnam'), r(`${AL}تايلاند`, 'Thailand'),
  r(`${AL}بنغلاديش`, 'Bangladesh'), r(`${AL}ميانمار`, 'Myanmar'), r(`${AL}سريلانكا`, 'Sri Lanka'),
  r(`${AL}اذربيجان`, 'Azerbaijan'), r(`${AL}ارمينيا`, 'Armenia'), r(`${AL}اوزبكستان`, 'Uzbekistan'),
  r(`${AL}قيرغيزستان|${AL}قرغيزستان`, 'Kyrgyzstan'), r(`${AL}طاجيكستان`, 'Tajikistan'), r(`${AL}تركمانستان`, 'Turkmenistan'),
  r(`${AL}منغوليا`, 'Mongolia'),
  // Nov 6, 2026, 8:44 PM QA: Syria TV's "Paraguay's Senate impeaches President Peña" was pinned in Damascus because the
  // Latin American, African and other countries below had no Arabic name here. Left out as also everyday words: "كوبا"
  // (Cuba, also a cup), "مالي" (Mali, also financial), "اكرا" (Accra), "دكا" (Dhaka), "سيول", "روما", "جورجيا"
  r(`${AL}باراغواي|${AL}باراجواي`, 'Paraguay'), r(`${AL}اوروغواي|${AL}اوروجواي`, 'Uruguay'), r(`${AL}بوليفيا`, 'Bolivia'),
  r(`${AL_ONLY}اكوادور`, 'Ecuador'), r(`${AL}بنما`, 'Panama'), r(`${AL}غواتيمالا|${AL}جواتيمالا`, 'Guatemala'),
  r(`${AL}هندوراس`, 'Honduras'), r(`${AL}نيكاراغوا|${AL}نيكاراجوا`, 'Nicaragua'), r(`${AL}كوستاريكا`, 'Costa Rica'),
  r(`${AL_ONLY}سلفادور`, 'El Salvador'), r(`${AL}هايتي`, 'Haiti'), r(`${AL}دومينيكان`, 'Dominican Republic'),
  r(`${AL}غانا`, 'Ghana'), r(`${AL_ONLY}سنغال`, 'Senegal'), r(`${AL}اوغندا|${AL}اوجندا`, 'Uganda'), r(`${AL}تنزانيا`, 'Tanzania'),
  r(`${AL}جنوب\\s+افريقيا`, 'South Africa'), r(`${AL}زيمبابوي`, 'Zimbabwe'), r(`${AL}انغولا|${AL}انجولا`, 'Angola'),
  r(`${AL_ONLY}نيجر`, 'Niger'), r(`${AL_ONLY}كاميرون`, 'Cameroon'), r(`${AL}رواندا`, 'Rwanda'), r(`${AL}موزمبيق`, 'Mozambique'),
  r(`${AL}زامبيا`, 'Zambia'), r(`${AL}مدغشقر`, 'Madagascar'), r(`${AL}نيبال`, 'Nepal'), r(`${AL}كمبوديا`, 'Cambodia'),
  r(`${AL}ايسلندا`, 'Iceland'), r(`${AL}لاتفيا`, 'Latvia'), r(`${AL}ليتوانيا`, 'Lithuania'), r(`${AL}بيلاروس(?:يا)?`, 'Belarus'),
  r(`${AL}سلوفاكيا`, 'Slovakia'), r(`${AL}سلوفينيا`, 'Slovenia'), r(`${AL}بوسن[ةه]`, 'Bosnia'), r(`${AL}مولدوفا`, 'Moldova'),
  r(`${AL}نيوزيلند[ا]?`, 'New Zealand'), r(`${AL}لوكسمبورغ`, 'Luxembourg'),
  r(`${AL}ليما`, 'Lima'), r(`${AL}بوينس\\s+ايرس|${AL}بيونس\\s+ايرس`, 'Buenos Aires'), r(`${AL}بوغوتا|${AL}بوجوتا`, 'Bogota'),
  r(`${AL}هافانا`, 'Havana'), r(`${AL}برازيليا`, 'Brasilia'), r(`${AL}مونتفيديو`, 'Montevideo'), r(`${AL}كاراكاس`, 'Caracas'),
  r(`${AL}اسونسيون`, 'Asuncion'), r(`${AL}كيتو`, 'Quito'), r(`${AL}مكسيكو\\s+سيتي`, 'Mexico City'),
  r(`${AL}ساو\\s+باولو`, 'Sao Paulo'), r(`${AL}بريتوريا`, 'Pretoria'), r(`${AL}نيروبي`, 'Nairobi'), r(`${AL}كمبالا`, 'Kampala'),
  r(`${AL}كينشاسا`, 'Kinshasa'), r(`${AL}كانبيرا`, 'Canberra'), r(`${AL}اوتاوا`, 'Ottawa'), r(`${AL}لشبونة`, 'Lisbon'),
  r(`${AL}هلسنكي`, 'Helsinki'), r(`${AL}كاتماندو`, 'Kathmandu'),
] as Rule[]).map(([pattern, as]): Rule => [new RegExp(arabicPlain(pattern.source), pattern.flags), as])

/** Arabic text without its vowel marks, hamzas (أ إ آ are ا) and tatweel, for the rules above to read */
export function arabicPlain(text: string): string {
  return text.normalize('NFD').replace(/[ً-ٰٟـ]/g, '').normalize('NFC')
}

/**
 * Russian (Nov 6, 2026; Kyrgyzstan's Russian-language press): Kyrgyzstan's places and its neighbours, with the endings
 * Russian declines names in ("в Бишкеке", "из России", "Кыргызстана"), and the adjectives of its provinces ("в Ошской
 * области"). Their stories are mostly Kyrgyzstan's own, so the rest stay at home.
 */
const RUSSIAN: Rule[] = [
  r('кыргызстан(?:а|е|у|ом)?|киргизи(?:я|и|ю|ей)|кыргызск\\p{L}*|кыргызстанц\\p{L}*', 'Kyrgyzstan'),
  r('бишкек(?:а|е|у|ом)?|бишкекск\\p{L}*', 'Bishkek'), r('ош(?:а|е|у|ом)?|ошск\\p{L}*', 'Osh'),
  r('джалал-абад(?:а|е|у|ом)?|джалал-абадск\\p{L}*', 'Jalal-Abad'), r('каракол(?:а|е|у|ом)?', 'Karakol'),
  r('иссык-кул(?:ь|я|е|ю|ем)|иссык-кульск\\p{L}*', 'Issyk-Kul'), r('нарын(?:а|е|у|ом)?|нарынск\\p{L}*', 'Naryn'),
  r('баткен(?:а|е|у|ом)?|баткенск\\p{L}*', 'Batken'), r('токмок(?:а|е|у|ом)?', 'Tokmok'),
  r('росси(?:я|и|ю|ей)|российск\\p{L}*', 'Russia'), cs('РФ', 'Russia'), r('москв(?:а|ы|е|у|ой)', 'Moscow'),
  r('казахстан(?:а|е|у|ом)?|казахстанск\\p{L}*', 'Kazakhstan'), r('астан(?:а|ы|е|у|ой)', 'Astana'), r('алмат(?:ы|е)', 'Almaty'),
  r('узбекистан(?:а|е|у|ом)?', 'Uzbekistan'), r('ташкент(?:а|е|у|ом)?', 'Tashkent'),
  r('таджикистан(?:а|е|у|ом)?', 'Tajikistan'), r('душанбе', 'Dushanbe'), r('туркменистан(?:а|е|у|ом)?', 'Turkmenistan'),
  r('кита(?:й|я|е|ю|ем)', 'China'), r('пекин(?:а|е|у|ом)?', 'Beijing'), cs('США', 'United States'),
  r('вашингтон(?:а|е|у|ом)?', 'Washington'), r('украин(?:а|ы|е|у|ой)', 'Ukraine'), r('киев(?:а|е|у|ом)?', 'Kyiv'),
  r('беларус(?:ь|и|ью)', 'Belarus'), r('минск(?:а|е|у|ом)?', 'Minsk'), r('турци(?:я|и|ю|ей)', 'Turkey'),
  r('иран(?:а|е|у|ом)?', 'Iran'), r('афганистан(?:а|е|у|ом)?', 'Afghanistan'), r('германи(?:я|и|ю|ей)', 'Germany'),
  r('франци(?:я|и|ю|ей)', 'France'), r('великобритани(?:я|и|ю|ей)', 'United Kingdom'), r('япони(?:я|и|ю|ей)', 'Japan'),
  r('инди(?:я|и|ю|ей)', 'India'), r('монголи(?:я|и|ю|ей)', 'Mongolia'), r('сальвадор(?:а|е|у|ом)?', 'El Salvador'),
]

/**
 * Mongolian (Nov 6, 2026; Ikon.mn): Mongolia's provinces and towns, and the countries and capitals its world news names,
 * with the endings Mongolian adds to a name ("Хятадын", "Орост", "Японоос", "АНУ-ын", "Улаанбаатарт"). Its stories are
 * mostly Mongolia's own, so the rest stay at home, and a province named beside a donor keeps the story there ("Японы
 * ЗГ-ын буцалтгүй тусламжаар Булган аймгийн ..." is Bulgan's: a province is a place, Japan only a country). A country's
 * language is not the country ("орос хэлний багш", a Russian teacher). As written with a capital only, being everyday
 * words too: "Булган" (sable), "Өлгий" (a cradle), "Дархан" (a craftsman), "Бутан" (butane), "Орхон", "Эрдэнэт",
 * "Эрээн" (motley), and
 * "Дорнод" (eastern; not before Asia or Europe). Sükhbaatar (also the hero, and Ulaanbaatar's square and district) and
 * Töv (centre) only before "аймаг"; English (Англи) left out, mostly the language or the Premier League.
 */
const MN_END = '(?:-?(?:гийн|ийн|ын|йн|ий|ы|н|гийг|ийг|ыг|йг|г|ад|эд|од|өд|даа|дээ|доо|дөө|таа|тээ|тоо|төө|д|т|гаас|гээс|иас|аас|ээс|оос|өөс|ас|гаар|гээр|иар|аар|ээр|оор|өөр|ар|эр|тай|тэй|той|төй|ууд|үүд|чууд))?'
const NOT_LANGUAGE = '(?!\\s+хэл(?:ний|ээр|ийг|ийн|ээс|тэй)?(?!\\p{L}))'
const AIMAG = '\\s+айм(?:аг|агт|агтай|гийн|гаас|гийг|гаар)'   // "аймаг" (province), "аймгийн" (of the province), ...
const mn = (stem: string, as: string): Rule => r(`(?:${stem})${MN_END}${NOT_LANGUAGE}`, as)
const mnAsWritten = (stem: string, as: string): Rule => cs(`(?:${stem})${MN_END}`, as)
const MONGOLIAN: Rule[] = [
  mn('өвөр\\s+монгол', 'Inner Mongolia'), mn('монгол(?:\\s+улс)?', 'Mongolia'), mn('улаанбаатар', 'Ulaanbaatar'),
  mnAsWritten('УБ', 'Ulaanbaatar'), mnAsWritten('Дархан(?:-Уул)?', 'Darkhan'), mnAsWritten('Эрдэнэт', 'Erdenet'),
  mnAsWritten('Орхон', 'Orkhon'), mn('архангай', 'Arkhangai'), mn('баян-өлгий', 'Bayan-Olgii'), mnAsWritten('Өлгий', 'Olgii'),
  mn('баянхонгор', 'Bayankhongor'), mnAsWritten('Булган', 'Bulgan'), mn('говь-алтай', 'Govi-Altai'), mn('говьсүмбэр', 'Govisumber'),
  mn('дорноговь', 'Dornogovi'), cs(`Дорнод${MN_END}(?!\\s+(?:Ази|Европ|Сибир))`, 'Dornod'), mn('дундговь', 'Dundgovi'),
  mn('завхан', 'Zavkhan'), mn('өвөрхангай', 'Uvurkhangai'), mn('өмнөговь', 'Umnugovi'), r(`сүхбаатар${AIMAG}`, 'Sukhbaatar Province'),
  mn('сэлэнгэ', 'Selenge'), r(`төв${AIMAG}`, 'Tov Province'), mn('увс', 'Uvs Province'), mn('ховд', 'Khovd'),
  mn('хөвсгөл', 'Khuvsgul'), mn('хэнтий', 'Khentii'), mn('замын-үүд', 'Zamiin-Uud'),
  mn('хятад', 'China'), mnAsWritten('БНХАУ', 'China'), mn('орос', 'Russia'), mnAsWritten('ОХУ', 'Russia'), mn('япон', 'Japan'),
  mnAsWritten('АНУ', 'United States'), mn('америк', 'United States'), mn('өмнөд\\s+солонгос', 'South Korea'),
  mn('хойд\\s+солонгос', 'North Korea'), mnAsWritten('БНСУ', 'South Korea'), mnAsWritten('БНАСАУ|КНДР', 'North Korea'),
  mn('солонгос', 'South Korea'), mn('казахстан|хасагстан', 'Kazakhstan'), mn('кыргызстан|киргиз', 'Kyrgyzstan'),
  mn('узбекистан', 'Uzbekistan'), mn('герман', 'Germany'), mn('франц', 'France'), mn('их\\s+британи', 'United Kingdom'),
  mn('энэтхэг', 'India'), mn('турк', 'Turkey'), mn('украин', 'Ukraine'), mn('беларусь', 'Belarus'), mn('иран', 'Iran'),
  mn('израиль|израил', 'Israel'), mn('саудын\\s+араб', 'Saudi Arabia'), mn('испани', 'Spain'), mn('итали', 'Italy'),
  mn('канад', 'Canada'), mn('австрали', 'Australia'), mn('австри', 'Austria'), mn('вьетнам', 'Vietnam'), mn('тайланд', 'Thailand'),
  mn('сингапур', 'Singapore'), mn('тайвань|тайван', 'Taiwan'), mn('хонконг', 'Hong Kong'), mn('польш', 'Poland'),
  mn('унгар', 'Hungary'), mn('швейцари|швейцарь', 'Switzerland'), mn('швед', 'Sweden'), mn('норвеги', 'Norway'),
  mn('финланд', 'Finland'), mn('нидерланд|голланд', 'Netherlands'), mn('бельги', 'Belgium'), mn('грек', 'Greece'),
  mn('бразил', 'Brazil'), mn('аргентин', 'Argentina'), mn('мексик', 'Mexico'), mn('египет', 'Egypt'),
  mn('афганистан', 'Afghanistan'), mn('пакистан', 'Pakistan'), mn('ирак', 'Iraq'), mn('сири', 'Syria'), mn('ливан', 'Lebanon'),
  mn('катар', 'Qatar'), mn('палестин', 'Palestine'), mn('газын\\s+зурвас', 'Gaza'), mn('иордан', 'Jordanian'),
  mn('кувейт', 'Kuwait'), mn('бахрейн', 'Bahrain'), mn('оман', 'Oman'), mn('йемен', 'Yemen'),
  mnAsWritten('АНЭУ', 'United Arab Emirates'), mn('арабын\\s+нэгдсэн\\s+эмират', 'United Arab Emirates'),
  mn('тажикистан', 'Tajikistan'), mn('туркменистан', 'Turkmenistan'), mn('азербайжан', 'Azerbaijan'), mn('армени', 'Armenia'),
  mn('гүрж', 'Republic of Georgia'), mn('молдав', 'Moldova'), mn('румын', 'Romania'), mn('болгар', 'Bulgaria'),
  mn('серби', 'Serbia'), mn('хорват', 'Croatia'), mn('словак', 'Slovakia'), mn('словени', 'Slovenia'), mn('чех', 'Czechia'),
  mn('эстони', 'Estonia'), mn('латви', 'Latvia'), mn('литва', 'Lithuania'), mn('дани', 'Denmark'), mn('ирланд', 'Ireland'),
  mn('исланд', 'Iceland'), mn('португал', 'Portugal'), mn('шинэ\\s+зеланд', 'New Zealand'), mn('ватикан', 'Vatican'),
  mn('индонез', 'Indonesia'), mn('малайз', 'Malaysia'), mn('филиппин', 'Philippines'), mn('камбож', 'Cambodia'),
  mn('лаос', 'Laos'), mn('мьянмар', 'Myanmar'), mn('бангладеш', 'Bangladesh'), mn('шри[-\\s]ланк(?:а)?', 'Sri Lanka'),
  mn('непал', 'Nepal'), mnAsWritten('Бутан', 'Bhutan'), mn('өмнөд\\s+африк', 'South Africa'), mn('нигери', 'Nigeria'),
  mn('кени', 'Kenya'), mn('этиоп', 'Ethiopia'), mn('өмнөд\\s+судан', 'South Sudan'), mn('судан', 'Sudan'), mn('ливи', 'Libya'), mn('тунис', 'Tunisia'), mn('алжир', 'Algeria'),
  mn('марокко', 'Morocco'), mn('парагвай', 'Paraguay'), mn('уругвай', 'Uruguay'), mn('чили', 'Chile'), mn('перу', 'Peru'),
  mn('колумби', 'Colombia'), mn('венесуэл', 'Venezuela'), mn('куба', 'Cuba'), mn('эквадор', 'Ecuador'), mn('боливи', 'Bolivia'),
  mn('бээжин', 'Beijing'), mn('москва', 'Moscow'),
  mn('токио', 'Tokyo'), mn('сөүл', 'Seoul'), mn('вашингтон', 'Washington'), mn('лондон', 'London'), mn('парис', 'Paris'),
  mn('берлин', 'Berlin'), r('цагаан\\s+орд(?:он|ны|онд|оноос|ныг)', 'White House'), mn('кремль|кремл', 'Kremlin'),
  mn('хөх\\s+хот', 'Hohhot'), mnAsWritten('Эрээн', 'Inner Mongolia'),
]

/** Words that only look like a place in the three languages the reader took before round 6 */
const SPANISH: Rule[] = [
  mask('usa|irán|chile|maduros?'),
  ...towns([
    ['Londres', 'London'], ['Moscú|Moscu', 'Moscow'], ['Bruselas', 'Brussels'], ['Pekín|Pekin', 'Beijing'], ['Argel', 'Algiers'],
    ['Varsovia', 'Warsaw'], ['Viena', 'Vienna'], ['Atenas(?!\\s+de\\s+Alajuela)', 'Athens'], ['Teherán|Teheran', 'Tehran'],
    ['Bagdad', 'Baghdad'], ['Yeda', 'Jeddah'], ['Ciudad\\s+del\\s+Cabo', 'Cape Town'], ['Copenhague', 'Copenhagen'],
    ['La\\s+Haya', 'The Hague'], ['Lisboa', 'Lisbon'], ['Edimburgo', 'Edinburgh'], ['Jerusalén|Jerusalen', 'Jerusalem'], ['Seúl', 'Seoul'],
    ['Tokio', 'Tokyo'], ['Nueva\\s+York', 'New York'], ['Ginebra', 'Geneva'], ['Praga', 'Prague'], ['Bucarest', 'Bucharest'],
    ['Belgrado', 'Belgrade'], ['Estambul', 'Istanbul'], ['Damasco', 'Damascus'], ['Amán', 'Amman'], ['Riad', 'Riyadh'],
    ['Abu\\s+Dabi', 'Abu Dhabi'], ['Mascate', 'Muscat'], ['Saná', 'Sanaa'], ['Jartum', 'Khartoum'], ['Adís\\s+Abeba|Addis\\s+Abeba', 'Addis Ababa'],
    ['Johannesburgo', 'Johannesburg'], ['Yakarta', 'Jakarta'], ['Bombay', 'Mumbai'], ['Calcuta', 'Kolkata'], ['Daca', 'Dhaka'],
    ['San\\s+Petersburgo', 'Saint Petersburg'], ['Estocolmo', 'Stockholm'], ['Amberes', 'Antwerp'], ['Fráncfort|Francfort', 'Frankfurt'],
    ['Hamburgo', 'Hamburg'], ['Venecia', 'Venice'], ['Nápoles', 'Naples'], ['Génova', 'Genoa'], ['Sevilla', 'Seville'], ['Oporto', 'Porto'],
    ['Ciudad\\s+de\\s+M[ée]xico', 'Mexico City'], ['La\\s+Habana', 'Havana'], ['Puerto\\s+Príncipe', 'Port-au-Prince'],
    ['Nueva\\s+Orleans', 'New Orleans'], ['Filadelfia', 'Philadelphia'], ['Sídney', 'Sydney'], ['Cisjordania', 'West Bank'],
    ['Alepo', 'Aleppo'], ['Basora', 'Basra'], ['Járkov|Jarkov', 'Kharkiv'], ['Jersón|Jerson', 'Kherson'], ['Lugansk', 'Luhansk'],
    ['Mariúpol', 'Mariupol'], ['Zaporiyia|Zaporiyya', 'Zaporizhzhia'], ['Sebastopol', 'Sevastopol'], ['Nueva\\s+Delhi', 'New Delhi'],
    ['Ormuz', 'Hormuz'], ['Cracovia', 'Krakow'],
    // Mexico City's Colonia Roma is a neighbourhood, not Rome
    ['(?<![Cc]olonia\\s|[Cc]ol\\.\\s)Roma(?![\\s-]+(?:Norte|Sur))', 'Rome'],
  ]),
]
const PORTUGUESE: Rule[] = [
  mask('usa|irão|peru|maduros?'),
  ...towns([
    ['Londres', 'London'], ['Moscovo|Moscou', 'Moscow'], ['Bruxelas', 'Brussels'], ['Pequim', 'Beijing'], ['Argel', 'Algiers'],
    ['Varsóvia|Varsovia', 'Warsaw'], ['Cracóvia|Cracovia', 'Krakow'], ['Viena', 'Vienna'], ['Atenas', 'Athens'], ['Beirute', 'Beirut'], ['Teerão|Teerã|Teerao', 'Tehran'],
    ['Cabul', 'Kabul'], ['Bagdade|Bagdá', 'Baghdad'], ['Jidá', 'Jeddah'], ['Cidade\\s+do\\s+Cabo', 'Cape Town'],
    ['Copenhaga|Copenhague', 'Copenhagen'], ['Haia', 'The Hague'], ['Lisboa', 'Lisbon'], ['Edimburgo', 'Edinburgh'], ['Seul', 'Seoul'],
    ['Tóquio', 'Tokyo'], ['Nova\\s+(?:Iorque|York)', 'New York'], ['Berlim', 'Berlin'], ['Roma', 'Rome'], ['Genebra', 'Geneva'],
    // "praga" is also a pest (Nov 8, 2026: the Observador's "Praga devasta 90% da castanha na Terceira", a pest on the
    // Azores, sat in Prague): the city after "em", "de", "para"... or before a comma or a colon
    ['(?<=(?:^|[^\\p{L}])(?:em|de|para|a|à|até|desde|por|via|e)\\s+)Praga|Praga(?=\\s*(?:[,.;:)]|$))', 'Prague'],
    ['Budapeste', 'Budapest'], ['Bucareste', 'Bucharest'], ['Belgrado', 'Belgrade'], ['Ancara', 'Ankara'],
    ['Istambul', 'Istanbul'], ['Damasco', 'Damascus'], ['Amã', 'Amman'], ['Riade', 'Riyadh'], ['Mascate', 'Muscat'], ['Tunes', 'Tunis'],
    ['Dacar', 'Dakar'], ['Cartum', 'Khartoum'], ['Adis\\s+Abeba', 'Addis Ababa'], ['Joanesburgo', 'Johannesburg'], ['Xangai', 'Shanghai'],
    ['Taipé', 'Taipei'], ['Banguecoque', 'Bangkok'], ['Singapura', 'Singapore'], ['Jacarta', 'Jakarta'], ['Nova\\s+D[ée]lhi|Nova\\s+Deli', 'New Delhi'],
    ['Bombaim', 'Mumbai'], ['Calcutá', 'Kolkata'], ['Carachi', 'Karachi'], ['Islamabade', 'Islamabad'], ['Daca', 'Dhaka'],
    ['São\\s+Petersburgo', 'Saint Petersburg'], ['Estocolmo', 'Stockholm'], ['Helsínquia', 'Helsinki'], ['Amesterdão|Amsterdã', 'Amsterdam'],
    ['Antuérpia', 'Antwerp'], ['Munique', 'Munich'], ['Hamburgo', 'Hamburg'], ['Col[óô]nia(?!\\s+do\\s+Sacramento)', 'Cologne'],
    ['Zurique', 'Zurich'], ['Milão', 'Milan'], ['Turim', 'Turin'], ['Veneza', 'Venice'], ['Florença', 'Florence'], ['Nápoles', 'Naples'],
    ['G[ée]nova', 'Genoa'], ['Sevilha', 'Seville'], ['Cidade\\s+do\\s+México', 'Mexico City'], ['Montevideu', 'Montevideo'],
    ['Quebeque', 'Quebec'], ['Otava', 'Ottawa'], ['Nova\\s+Orle(?:ães|ans)', 'New Orleans'], ['Filadélfia', 'Philadelphia'],
    ['Cisjordânia', 'West Bank'], ['Telavive', 'Tel Aviv'], ['Alepo', 'Aleppo'], ['Mossul', 'Mosul'], ['Bassorá', 'Basra'],
    ['Zaporíjia', 'Zaporizhzhia'], ['Crimeia', 'Crimea'], ['Sebastopol', 'Sevastopol'], ['Lugansk', 'Luhansk'], ['Ormuz', 'Hormuz'],
    // Puerto Rico, not Porto (Nov 9, 2026: Notícias do Norte's "Armandina Cunha já se encontra no Porto Rico" sat in Portugal)
    ['Porto\\s+Rico', 'Puerto Rico'],
  ]),
]
/** French: no list until Nov 6, 2026, so Le Monde's "à Londres", "Moscou" or "Bruxelles" named no place */
const FRENCH: Rule[] = towns([
  ['Londres', 'London'], ['Moscou', 'Moscow'], ['Bruxelles', 'Brussels'], ['Pékin|Pekin', 'Beijing'], ['Caire', 'Cairo'], ['Alger', 'Algiers'],
  ['Varsovie', 'Warsaw'], ['Cracovie', 'Krakow'], ['(?<![Ll]a\\s|Haute-)Vienne(?!\\s+\\((?:Is[èe]re)\\))', 'Vienna'], ['Athènes|Athenes', 'Athens'],
  ['Beyrouth', 'Beirut'], ['Téhéran|Teheran', 'Tehran'], ['Kaboul', 'Kabul'], ['Bagdad', 'Baghdad'], ['Djeddah', 'Jeddah'],
  ['(?:Le|du|au)\\s+Cap(?![\\p{L}-])', 'Cape Town'], ['Copenhague', 'Copenhagen'], ['La\\s+Haye', 'The Hague'],
  ['Lisbonne', 'Lisbon'], ['Édimbourg|Edimbourg', 'Edinburgh'], ['Bucarest', 'Bucharest'], ['Damas', 'Damascus'], ['Riyad', 'Riyadh'],
  ['Abou\\s+Dhabi', 'Abu Dhabi'], ['Mascate', 'Muscat'], ['Addis[-\\s]+Abeba', 'Addis Ababa'], ['Djakarta', 'Jakarta'], ['Manille', 'Manila'],
  ['Bombay', 'Mumbai'], ['Calcutta', 'Kolkata'], ['Dacca', 'Dhaka'], ['Saint-Pétersbourg', 'Saint Petersburg'], ['Anvers', 'Antwerp'],
  ['Gand', 'Ghent'], ['Francfort', 'Frankfurt'], ['Hambourg', 'Hamburg'], ['Bâle', 'Basel'], ['Berne', 'Bern'], ['Venise', 'Venice'],
  ['Gênes', 'Genoa'], ['Barcelone', 'Barcelona'], ['La\\s+Havane', 'Havana'], ['Saint-Domingue', 'Santo Domingo'],
  ['La\\s+Nouvelle-Orléans', 'New Orleans'], ['Philadelphie', 'Philadelphia'], ['Cisjordanie', 'West Bank'],
  ['Jérusalem-Est', 'East Jerusalem'], ['Alep', 'Aleppo'], ['Mossoul', 'Mosul'], ['Bassora', 'Basra'], ['Ispahan', 'Isfahan'],
  ['Chiraz', 'Shiraz'], ['Louhansk', 'Luhansk'], ['Marioupol', 'Mariupol'], ['Zaporijjia|Zaporijia', 'Zaporizhzhia'], ['Crimée', 'Crimea'],
  ['Sébastopol', 'Sevastopol'], ['Koursk', 'Kursk'], ['Briansk', 'Bryansk'], ['Ormuz', 'Hormuz'], ['Nouvelle-Delhi', 'New Delhi'],
  ['Smyrne', 'Izmir'], ['Pyongyang', 'Pyongyang'],
  // countries and US states the place-finder doesn't know in French (Nov 7, 2026: "Élections au Chili" was no place); not
  // "Équateur" (also Congo's province), "Géorgie" (the country or the state), "Virginie" (a first name)
  ['Chili', 'Chile'], ['Suède', 'Sweden'], ['Écosse|Ecosse', 'Scotland'], ['Groenland', 'Greenland'], ['Népal', 'Nepal'],
  ['Bhoutan', 'Bhutan'], ['(?<=(?:[Aa]u|[Dd]u|[Ll]e)\\s)Salvador', 'El Salvador'], ['Floride', 'Florida'], ['Californie', 'California'],
  ['Louisiane', 'Louisiana'], ['Pennsylvanie', 'Pennsylvania'], ['Caroline\\s+du\\s+Nord', 'North Carolina'],
  ['Caroline\\s+du\\s+Sud', 'South Carolina'], ['Nouveau-Mexique', 'New Mexico'],
  // Haiti's central bank, whose daily rate Haitian outlets post as "Taux de référence de la BRH pour le 12 novembre" with no
  // place word (Nov 12, 2026: one such post sat in the United States, its sibling that said "Haïti" in Haiti)
  ['BRH', 'Haiti'],
])

/**
 * Turkish, Polish, Hungarian, Czech, Indonesian and Ukrainian (Nov 18, 2026; Devon: "Let's work in parallel on languages
 * as a priority"): the countries, capitals and towns their headlines name most, with the endings each language adds
 * to a name, and the peoples' adjectives, so a story from a feed in one of them finds its place as an English one does.
 * Turkish joins its endings to a name with an apostrophe ("Türkiye'de", "ABD'nin", "İstanbul'da"); Hungarian joins
 * them straight on ("Magyarországon", "Budapesten", "Kijevből"); Polish, Czech and Ukrainian decline ("w Polsce", "v
 * Praze", "у Києві"). Left out: names that are everyday words ("Fas" only as written: Morocco; Turkish "Çin" only with
 * its capital: China; Indonesian "AS" only in capitals: the United States, "as" is a word; Polish "Włochy" is Italy but
 * also a Warsaw district, kept since the country is far more common).
 */
const TR_END = "(?:['’]\\p{L}+)?"
const tr = (stem: string, as: string): Rule => r(`(?:${stem})${TR_END}`, as)
const trAsWritten = (stem: string, as: string): Rule => cs(`(?:${stem})${TR_END}`, as)
const TURKISH: Rule[] = [
  tr('türkiye|turkiye', 'Turkey'), trAsWritten('ABD', 'United States'), tr('amerika\\s+birleşik\\s+devletleri', 'United States'),
  tr('rusya', 'Russia'), tr('ukrayna', 'Ukraine'), trAsWritten('Çin', 'China'), tr('i̇ran|İran|iran', 'Iran'),
  tr('irak', 'Iraq'), tr('suriye', 'Syria'), tr('i̇srail|İsrail|israil', 'Israel'), tr('filistin', 'Palestine'),
  tr('gazze', 'Gaza'), tr('lübnan', 'Lebanon'), tr('mısır', 'Egypt'), tr('suudi\\s+arabistan', 'Saudi Arabia'),
  tr('katar', 'Qatar'), tr('birleşik\\s+arap\\s+emirlikleri', 'United Arab Emirates'), trAsWritten('BAE', 'United Arab Emirates'),
  tr('yunanistan', 'Greece'), tr('kıbrıs', 'Cyprus'), tr('almanya', 'Germany'), tr('fransa', 'France'),
  tr('i̇ngiltere|İngiltere|ingiltere|birleşik\\s+krallık', 'United Kingdom'), tr('i̇talya|İtalya|italya', 'Italy'),
  tr('i̇spanya|İspanya|ispanya', 'Spain'), tr('azerbaycan', 'Azerbaijan'), tr('ermenistan', 'Armenia'),
  tr('gürcistan', 'Republic of Georgia'), tr('hindistan', 'India'), tr('afganistan', 'Afghanistan'), tr('japonya', 'Japan'),
  tr('güney\\s+kore', 'South Korea'), tr('kuzey\\s+kore', 'North Korea'), tr('cezayir', 'Algeria'), trAsWritten('Fas', 'Morocco'),
  tr('tunus', 'Tunisia'), tr('ürdün', 'Jordanian'), tr('yemen', 'Yemen'), tr('libya', 'Libya'), tr('somali', 'Somalia'),
  tr('i̇stanbul|İstanbul|istanbul', 'Istanbul'), tr('i̇zmir|İzmir|izmir', 'Izmir'), tr('moskova', 'Moscow'),
  tr('brüksel', 'Brussels'), tr('tahran', 'Tehran'), trAsWritten('Şam', 'Damascus'), tr('bağdat', 'Baghdad'),
  tr('kahire', 'Cairo'), tr('atina', 'Athens'), tr('londra', 'London'), tr('pekin', 'Beijing'), tr('halep', 'Aleppo'),
  tr('kudüs', 'Jerusalem'), tr('beyaz\\s+saray', 'White House'),
  // adjectives and peoples ("Rus askerleri", "İsrailli yetkililer")
  cs('Rus', 'Russian'), tr('i̇srailli|İsrailli|israilli', 'Israeli'), tr('i̇ranlı|İranlı|iranlı', 'Iranian'), tr('çinli', 'Chinese'),
  tr('ukraynalı', 'Ukrainian'), tr('amerikan', 'United States'),
]

const POLISH: Rule[] = [
  r('polsk(?:a|i|ę|ą)|polsce', 'Poland'), r('warszaw(?:a|y|ie|ę|ą)', 'Warsaw'), r('krak(?:ów|owa|owie|owem)', 'Krakow'),
  r('gdańsk(?:a|u|iem)?', 'Gdansk'), r('wrocław(?:ia|iu|iem)?', 'Wroclaw'), r('pozna(?:ń|nia|niu)', 'Poznan'),
  r('łód(?:ź)|łodzi', 'Lodz'), r('lublin(?:a|ie)?', 'Lublin'), r('rosj(?:a|i|ę|ą)', 'Russia'), r('ukrain(?:a|y|ie|ę|ą)', 'Ukraine'),
  r('białoru(?:ś|si|sią)', 'Belarus'), r('niem(?:cy|iec|czech|com)', 'Germany'), r('francj(?:a|i|ę|ą)', 'France'),
  r('wielk(?:a|iej)\\s+brytani(?:a|i|ę|ą)', 'United Kingdom'), r('stan(?:y|ów|ach|ami)\\s+zjednoczon(?:e|ych|ymi)', 'United States'),
  cs('USA', 'United States'), r('chin(?:y|ach|om|ami)', 'China'), r('litw(?:a|y|ie|ę|ą)', 'Lithuania'),
  r('łotw(?:a|y|ie|ę|ą)', 'Latvia'), r('estoni(?:a|i|ę|ą)', 'Estonia'), r('czech(?:y|ach)', 'Czechia'),
  r('słowacj(?:a|i|ę|ą)', 'Slovakia'), r('węg(?:ry|ier|rzech)', 'Hungary'), r('izrael(?:a|u|em)?', 'Israel'),
  r('iran(?:u|ie|em)?', 'Iran'), r('turcj(?:a|i|ę|ą)', 'Turkey'), r('włoch(?:y)?', 'Italy'), r('hiszpani(?:a|i|ę|ą)', 'Spain'),
  r('szwecj(?:a|i|ę|ą)', 'Sweden'), r('norwegi(?:a|i|ę|ą)', 'Norway'), cs('Dani(?:a|i|ę|ą)', 'Denmark'),
  r('finlandi(?:a|i|ę|ą)', 'Finland'), r('rumuni(?:a|i|ę|ą)', 'Romania'), r('bułgari(?:a|i|ę|ą)', 'Bulgaria'),
  r('grecj(?:a|i|ę|ą)', 'Greece'), r('japoni(?:a|i|ę|ą)', 'Japan'), r('kore(?:a|i|ę)\\s+północn(?:a|ej|ą)', 'North Korea'),
  r('kore(?:a|i|ę)\\s+południow(?:a|ej|ą)', 'South Korea'), r('strefi?(?:a|e|ie)\\s+gazy', 'Gaza'),
  r('moskw(?:a|y|ie|ę|ą)', 'Moscow'), r('kij(?:ów|owa|owie|owem)', 'Kyiv'), r('bruksel(?:a|i|ę|ą)', 'Brussels'),
  r('waszyngton(?:ie|u)?', 'Washington'), r('biał(?:y|ego|ym)\\s+dom(?:u|em)?', 'White House'), r('krem(?:l|la|lu)', 'Kremlin'),
  r('rosyjsk\\p{L}*', 'Russian'), r('ukraińsk\\p{L}*', 'Ukrainian'), r('chińsk\\p{L}*', 'Chinese'),
  r('amerykańsk\\p{L}*', 'United States'), r('izraelsk\\p{L}*', 'Israeli'), r('irańsk\\p{L}*', 'Iranian'),
  r('białorusk\\p{L}*', 'Belarus'),
]

const HUNGARIAN: Rule[] = [
  r('magyarorsz[áa]g\\p{L}*', 'Hungary'), r('budapest\\p{L}*', 'Budapest'), r('debrecen\\p{L}*', 'Debrecen'),
  r('szeged\\p{L}*', 'Szeged'), r('miskolc\\p{L}*', 'Miskolc'), r('oroszorsz[áa]g\\p{L}*', 'Russia'),
  r('ukrajn[áa]\\p{L}*', 'Ukraine'), r('németorsz[áa]g\\p{L}*', 'Germany'), r('franciaorsz[áa]g\\p{L}*', 'France'),
  r('olaszorsz[áa]g\\p{L}*', 'Italy'), r('spanyolorsz[áa]g\\p{L}*', 'Spain'), r('lengyelorsz[áa]g\\p{L}*', 'Poland'),
  r('horvátorsz[áa]g\\p{L}*', 'Croatia'), r('csehorsz[áa]g\\p{L}*', 'Czechia'), r('törökorsz[áa]g\\p{L}*', 'Turkey'),
  r('görögorsz[áa]g\\p{L}*', 'Greece'), r('nagy-britanni\\p{L}*|egyesült\\s+királyság\\p{L}*', 'United Kingdom'),
  r('egyesült\\s+államok\\p{L}*', 'United States'), cs('USA\\p{L}*|USA-\\p{L}+', 'United States'),
  r('kín[áa](?:ban|ba|ból|nak|val|hoz|tól)?|kínai\\p{L}*', 'China'), r('izrael\\p{L}*', 'Israel'), r('ir[áa]n(?:ban|ba|ból|nal|i|nak)?', 'Iran'),
  r('szerbi[áa]\\p{L}*', 'Serbia'), r('románi[áa]\\p{L}*', 'Romania'), r('szlováki[áa]\\p{L}*', 'Slovakia'),
  r('ausztri[áa]\\p{L}*', 'Austria'), r('japán\\p{L}*', 'Japan'), r('brüsszel\\p{L}*', 'Brussels'),
  r('moszkv[áa]\\p{L}*', 'Moscow'), r('kijev\\p{L}*', 'Kyiv'), r('bécs\\p{L}*', 'Vienna'),
  r('fehér\\s+ház\\p{L}*', 'White House'), r('kreml\\p{L}*', 'Kremlin'),
  r('orosz\\p{L}*', 'Russian'), r('ukrán\\p{L}*', 'Ukrainian'), r('amerikai\\p{L}*', 'United States'),
]

const CZECH: Rule[] = [
  r('česk(?:o|a|u|em)|česk(?:á|é|ou)\\s+republi(?:ka|ky|ce|ku|kou)', 'Czechia'), r('prah(?:a|y|u|ou)|praze', 'Prague'),
  r('brn(?:o|a|ě|em)', 'Brno'), r('ostrav(?:a|y|ě|u|ou)', 'Ostrava'), r('plz(?:eň|ně|ni|ní)', 'Plzen'),
  r('slovensk(?:o|a|u|em)', 'Slovakia'), r('rusk(?:o|a|u|em)', 'Russia'), r('ukrajin(?:a|y|ě|u|ou)', 'Ukraine'),
  r('německ(?:o|a|u|em)', 'Germany'), r('rakousk(?:o|a|u|em)', 'Austria'), r('polsk(?:o|a|u|em)', 'Poland'),
  r('maďarsk(?:o|a|u|em)', 'Hungary'), r('franci(?:e|i)', 'France'), r('itáli(?:e|i)', 'Italy'),
  r('španělsk(?:o|a|u|em)', 'Spain'), r('(?:velk(?:á|é|ou)\\s+)?británi(?:e|i)', 'United Kingdom'),
  r('spojen(?:é|ých|ým)\\s+stát(?:y|ů|ech|ům)', 'United States'), cs('USA', 'United States'), r('čín(?:a|y|ě|u|ou)', 'China'),
  r('izrael(?:e|i|em)?', 'Israel'), r('írán(?:u|em)?', 'Iran'), r('moskv(?:a|y|ě|u|ou)', 'Moscow'),
  r('kyjev(?:a|ě|em)?', 'Kyiv'), r('brusel(?:u|em)?', 'Brussels'), r('bíl(?:ý|ého|ém)\\s+d(?:ům|omu|omě)', 'White House'),
  r('krem(?:l|lu)', 'Kremlin'), r('rusk(?:ý|á|é|ých|ou|ého|ému|ým|ými)', 'Russian'),
  r('ukrajinsk\\p{L}*', 'Ukrainian'), r('americk\\p{L}*', 'United States'), r('čínsk\\p{L}*', 'Chinese'),
  r('izraelsk\\p{L}*', 'Israeli'),
]

const INDONESIAN: Rule[] = [
  r('amerika\\s+serikat', 'United States'), cs('AS', 'United States'), r('tiongkok|cina', 'China'), r('jepang', 'Japan'),
  r('korea\\s+selatan', 'South Korea'), r('korea\\s+utara', 'North Korea'), r('rusia', 'Russia'), r('ukraina', 'Ukraine'),
  r('inggris', 'United Kingdom'), r('prancis', 'France'), r('jerman', 'Germany'), r('belanda', 'Netherlands'),
  r('italia', 'Italy'), r('spanyol', 'Spain'), r('arab\\s+saudi', 'Saudi Arabia'), r('mesir', 'Egypt'), r('turki', 'Turkey'),
  r('irak', 'Iraq'), r('suriah', 'Syria'), r('palestina', 'Palestine'), r('yordania', 'Jordanian'),
  r('uni\\s+emirat\\s+arab', 'United Arab Emirates'), r('filipina', 'Philippines'), r('singapura', 'Singapore'),
  r('kamboja', 'Cambodia'), r('selandia\\s+baru', 'New Zealand'), r('afganistan', 'Afghanistan'),
  r('gedung\\s+putih', 'White House'),
]

const UKRAINIAN: Rule[] = [
  r('україн(?:а|и|і|у|ою)', 'Ukraine'), r('ки(?:їв|єва|єву|єві|євом)|київщин\\p{L}*', 'Kyiv'), r('харк(?:ів|ова|ову|ові|овом)', 'Kharkiv'),
  r('одес(?:а|и|і|у|ою)', 'Odesa'), r('льв(?:ів|ова|ову|ові|овом)', 'Lviv'), r('дніпр(?:о|а|і|ом)', 'Dnipro'),
  r('запоріжж(?:я|і|ям)', 'Zaporizhzhia'), r('херсон(?:а|і|у|ом)?', 'Kherson'), r('донецьк(?:а|у|ом)?', 'Donetsk'),
  r('луганськ(?:а|у|ом)?', 'Luhansk'), r('донбас(?:у|і)?', 'Donbas'), r('крим(?:у|ом)?', 'Crimea'),
  r('маріупол(?:ь|я|і)', 'Mariupol'), r('микола(?:їв|єва|єву|єві|євом)', 'Mykolaiv'), cs('Сум(?:и|ах|ам)', 'Sumy'),
  r('черніг(?:ів|ова|ову|ові|овом)', 'Chernihiv'), r('полтав(?:а|и|і|у)', 'Poltava'), r('покровськ(?:а|у)?', 'Pokrovsk'),
  r('росі(?:я|ї|ю|єю)', 'Russia'), r('москв(?:а|и|і|у|ою)', 'Moscow'), r('білорус(?:ь|і|сю)', 'Belarus'),
  cs('США', 'United States'), r('польщ(?:а|і|у|ею)', 'Poland'), r('німеччин(?:а|и|і|у|ою)', 'Germany'),
  r('франці(?:я|ї|ю|єю)', 'France'), r('британі(?:я|ї|ю|єю)', 'United Kingdom'), r('кита(?:й|ю|ї|єм)', 'China'),
  r('туреччин(?:а|и|і|у|ою)', 'Turkey'), r('іран(?:у|і|ом)?', 'Iran'), r('ізра(?:їль|їлю|їлем)', 'Israel'),
  r('угорщин(?:а|и|і|у|ою)', 'Hungary'), r('румуні(?:я|ї|ю|єю)', 'Romania'), r('молдов(?:а|и|і|у|ою)', 'Moldova'),
  r('біл(?:ий|ого|ому)\\s+д(?:ім|ому|омі)', 'White House'), r('кремл(?:ь|я|і|ем)', 'Kremlin'),
  r('вашингтон(?:а|і|у|ом)?', 'Washington'), r('брюссел(?:ь|я|і|ем)', 'Brussels'),
  r('російськ\\p{L}*', 'Russian'), r('українськ\\p{L}*', 'Ukrainian'), r('американськ\\p{L}*', 'United States'),
]

/**
 * Greek, Korean, Urdu, Persian and Vietnamese (Nov 18, 2026; Devon: "we need to add more language coverage").
 *
 * Greek is read without its accents (greekPlain: "Ελλάδα", "ΕΛΛΑΔΑ" and "ελλαδα" are one word to these rules) and
 * declines its names ("της Ελλάδας", "στην Κύπρο", "του Κιέβου"). Left out: "Κάιρο" (Cairo; "καιρό" is the weather),
 * "Μακεδονία" alone (a Greek region; North Macedonia is "Βόρεια Μακεδονία" or "Σκόπια"); "Κίνα" only with its capital
 * ("κινά" is "moves"). Rhodes and Ioannina, which the place-finder doesn't know by name, count for Greece.
 */
const GREEK: Rule[] = [
  r('ελλαδ(?:α|ας|ος)|ελληνικ\\p{L}*', 'Greece'), r('αθην(?:α|ας|ων)', 'Athens'), r('θεσσαλονικ(?:η|ης)', 'Thessaloniki'),
  r('πειραι(?:ας|α|ως)', 'Piraeus'), r('πατρ(?:α|ας|ων)', 'Patras'), r('κρητ(?:η|ης)', 'Crete'), r('ροδο(?:ς|υ)?', 'Greece'),
  r('ηρακλει(?:ο|ου)', 'Heraklion'), r('λαρισ(?:α|ας|ης)', 'Larissa'), r('ιωαννιν(?:α|ων)', 'Greece'),
  r('λεσβο(?:ς|υ)?', 'Lesbos'), r('κερκυρ(?:α|ας)', 'Corfu'), r('σαντοριν(?:η|ης)', 'Santorini'),
  r('κυπρ(?:ος|ου|ο)|κυπριακ\\p{L}*', 'Cyprus'), r('λευκωσι(?:α|ας)', 'Nicosia'), r('λεμεσ(?:ος|ου|ο)', 'Limassol'),
  r('λαρνακ(?:α|ας)', 'Larnaca'), r('παφ(?:ος|ου|ο)', 'Paphos'), r('αμμοχωστ(?:ος|ου|ο)', 'Famagusta'),
  r('τουρκι(?:α|ας)|τουρκικ\\p{L}*|τουρκ(?:ος|οι|ων)', 'Turkey'), r('αγκυρ(?:α|ας)', 'Ankara'),
  r('κωνσταντινουπολ(?:η|ης)|ισταμπουλ', 'Istanbul'), r('ρωσι(?:α|ας)|ρωσικ\\p{L}*|ρωσ(?:οι|ων)', 'Russia'),
  r('μοσχ(?:α|ας)', 'Moscow'), r('κρεμλιν(?:ο|ου)', 'Kremlin'), r('ουκρανι(?:α|ας)|ουκρανικ\\p{L}*|ουκραν(?:οι|ων)', 'Ukraine'),
  r('κιεβ(?:ο|ου)', 'Kyiv'), r('ηπα', 'United States'), r('αμερικ(?:η|ης)|αμερικαν\\p{L}*', 'United States'),
  r('ουασιγκτον', 'Washington'), r('λευκ(?:ος|ου|ο)\\s+οικ(?:ος|ου|ο)', 'White House'),
  cs('Κιν(?:α|ας)|ΚΙΝ(?:Α|ΑΣ)', 'China'), r('κινεζ\\p{L}*', 'China'), r('πεκιν(?:ο|ου)', 'Beijing'),
  r('ισραηλ|ισραηλιν\\p{L}*', 'Israel'), r('ιερουσαλημ', 'Jerusalem'), r('τελ\\s+αβιβ', 'Tel Aviv'),
  r('ιραν|ιρανικ\\p{L}*|ιραν(?:οι|ων)', 'Iran'), r('τεχεραν(?:η|ης)?', 'Tehran'), r('γαζ(?:α|ας)', 'Gaza'),
  r('παλαιστιν(?:η|ης)', 'Palestine'), r('λιβαν(?:ος|ου|ο)', 'Lebanon'), r('συρι(?:α|ας)', 'Syria'),
  r('αιγυπτ(?:ος|ου|ο)', 'Egypt'), r('ιρακ', 'Iraq'), r('σαουδικ(?:η|ης)\\s+αραβι(?:α|ας)', 'Saudi Arabia'),
  r('ιορδανι(?:α|ας)', 'Jordanian'), r('λιβυ(?:η|ης)', 'Libya'), r('γερμανι(?:α|ας)|γερμανικ\\p{L}*', 'Germany'),
  r('βερολιν(?:ο|ου)', 'Berlin'), r('γαλλι(?:α|ας)|γαλλικ\\p{L}*', 'France'), r('παρισι(?:ου)?', 'Paris'),
  r('βρετανι(?:α|ας)|βρετανικ\\p{L}*|ηνωμενο\\s+βασιλειο', 'United Kingdom'), r('λονδιν(?:ο|ου)', 'London'),
  r('ιταλι(?:α|ας)', 'Italy'), r('ισπανι(?:α|ας)', 'Spain'), r('πολωνι(?:α|ας)', 'Poland'), r('σερβι(?:α|ας)', 'Serbia'),
  r('αλβανι(?:α|ας)', 'Albania'), r('βουλγαρι(?:α|ας)', 'Bulgaria'), r('ρουμανι(?:α|ας)', 'Romania'),
  r('βορει(?:α|ας)\\s+μακεδονι(?:α|ας)|σκοπι(?:α|ων)', 'North Macedonia'), r('βρυξελλ(?:ες|ων)', 'Brussels'),
  r('ιαπωνι(?:α|ας)', 'Japan'), r('ινδι(?:α|ας)', 'India'), r('βορει(?:α|ας)\\s+κορε(?:α|ας)', 'North Korea'),
  r('νοτι(?:α|ας)\\s+κορε(?:α|ας)', 'South Korea'), r('βενεζουελ(?:α|ας)', 'Venezuela'), r('αρμενι(?:α|ας)', 'Armenia'),
  r('αφγανισταν', 'Afghanistan'), r('πακισταν', 'Pakistan'),
]

/** Greek without its accents, for the rules above to read ("Ελλάδας" as "Ελλαδας") */
export function greekPlain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC')
}

/**
 * Korean joins its particles to the name ("미국의", of the US; "중국에서", in China; "북한은"), and its people ("미국인").
 * "가자" alone is "let's go": Gaza is "가자지구". "인도" is also the pavement and humane ("인도적", "인도주의"), blanked
 * first; Indonesia before India. Vietnamese "Ý" (Italy) only with its capital and not "Ý kiến" (opinion) and its kin.
 */
const KO_END = '(?:에서는|에서도|에게서|으로는|에서|에게|으로|까지|부터|과의|와의|에선|에도|은|는|이|가|을|를|의|에|로|와|과|도|만|인|산|측|발|군|정부)?'
const ko = (stem: string, as: string): Rule => r(`(?:${stem})${KO_END}`, as)
const KOREAN: Rule[] = [
  mask('인도적|인도주의\\p{L}*'), ko('인도네시아', 'Indonesia'),
  ko('한국|대한민국|남한', 'South Korea'), ko('북한', 'North Korea'), ko('미국', 'United States'), ko('중국', 'China'),
  ko('일본', 'Japan'), ko('러시아', 'Russia'), ko('우크라이나', 'Ukraine'), ko('이란', 'Iran'), ko('이스라엘', 'Israel'),
  ko('가자지구', 'Gaza'), ko('팔레스타인', 'Palestine'), ko('레바논', 'Lebanon'), ko('시리아', 'Syria'), ko('이라크', 'Iraq'),
  ko('사우디아라비아|사우디', 'Saudi Arabia'), ko('튀르키예|터키', 'Turkey'), ko('이집트', 'Egypt'), ko('카타르', 'Qatar'),
  ko('예멘', 'Yemen'), ko('독일', 'Germany'), ko('프랑스', 'France'), ko('영국', 'United Kingdom'), ko('이탈리아', 'Italy'),
  ko('스페인', 'Spain'), ko('폴란드', 'Poland'), ko('대만', 'Taiwan'), ko('베트남', 'Vietnam'), ko('태국', 'Thailand'),
  ko('필리핀', 'Philippines'), ko('인도', 'India'), ko('파키스탄', 'Pakistan'), ko('호주', 'Australia'), ko('캐나다', 'Canada'),
  ko('멕시코', 'Mexico'), ko('브라질', 'Brazil'), ko('베네수엘라', 'Venezuela'), ko('몽골', 'Mongolia'),
  ko('싱가포르', 'Singapore'), ko('말레이시아', 'Malaysia'),
  ko('서울', 'Seoul'), ko('부산', 'Busan'), ko('인천', 'Incheon'), ko('대구', 'Daegu'), ko('광주', 'Gwangju'),
  ko('대전', 'Daejeon'), ko('울산', 'Ulsan'), ko('제주', 'Jeju'), ko('평양', 'Pyongyang'), ko('베이징|북경', 'Beijing'),
  ko('상하이', 'Shanghai'), ko('홍콩', 'Hong Kong'), ko('도쿄', 'Tokyo'), ko('오사카', 'Osaka'), ko('워싱턴', 'Washington'),
  ko('백악관', 'White House'), ko('모스크바', 'Moscow'), ko('크렘린', 'Kremlin'), ko('키이우|키예프', 'Kyiv'),
  ko('예루살렘', 'Jerusalem'), ko('테헤란', 'Tehran'), ko('브뤼셀', 'Brussels'), ko('런던', 'London'), ko('베를린', 'Berlin'),
]

/**
 * Urdu and Persian are read like Arabic (arabicPlain: no vowel marks; آ as ا), with their own letters folded to one
 * spelling (urduPersianPlain: Arabic ي and ك as ی and ک, which some of their sites type). Urdu's little words stand
 * apart ("پاکستان میں", "امریکا کے"); its peoples end in ی ("پاکستانی", "بھارتی"). Left out: Urdu "شام" (Syria, also
 * evening), "چینی" (Chinese, also sugar) and "بے چین" (restless, not China); Persian "هند" is India.
 */
const URDU: Rule[] = ([
  mask('بے\\s?چین(?:ی)?|سکون\\s+و\\s+چین|چین\\s+و\\s+سکون'),
  r('پاکستان(?:ی)?', 'Pakistan'), r('اسلام\\s?آباد', 'Islamabad'), r('کراچی', 'Karachi'), r('لاہور', 'Lahore'),
  r('پشاور', 'Peshawar'), r('کوئٹہ', 'Quetta'), r('راولپنڈی', 'Rawalpindi'), r('ملتان', 'Multan'), r('فیصل\\s?آباد', 'Faisalabad'),
  r('گوادر', 'Gwadar'), r('بلوچستان', 'Balochistan'), r('خیبر\\s+پختونخوا', 'Khyber Pakhtunkhwa'), r('سندھ', 'Sindh'),
  r('گلگت(?:[-\\s]بلتستان)?', 'Gilgit'), r('بھارت(?:ی)?|ہندوستان(?:ی)?', 'India'),
  r('نئی\\s+دہلی|دہلی', 'New Delhi'), r('ممبئی', 'Mumbai'), r('افغانستان|افغان', 'Afghanistan'), r('کابل', 'Kabul'),
  r('ایران(?:ی)?', 'Iran'), r('تہران', 'Tehran'), r('چین', 'China'), r('بیجنگ', 'Beijing'),
  r('امریکا|امریکہ|امریکی', 'United States'), r('واشنگٹن', 'Washington'), r('وائٹ\\s+ہاؤس', 'White House'),
  r('روس(?:ی)?', 'Russia'), r('ماسکو', 'Moscow'), r('یوکرین(?:ی)?', 'Ukraine'), r('اسرائیل(?:ی)?', 'Israel'),
  r('غزہ', 'Gaza'), r('فلسطین(?:ی)?', 'Palestine'), r('سعودی\\s+عرب|سعودی', 'Saudi Arabia'), r('قطر', 'Qatar'),
  r('متحدہ\\s+عرب\\s+امارات', 'United Arab Emirates'), r('دبئی', 'Dubai'), r('ترکی', 'Turkey'), r('مصر', 'Egypt'),
  r('عراق', 'Iraq'), r('لبنان', 'Lebanon'), r('یمن', 'Yemen'), r('برطانیہ|برطانوی', 'United Kingdom'), r('لندن', 'London'),
  r('فرانس', 'France'), r('جرمنی', 'Germany'), r('جاپان', 'Japan'), r('بنگلہ\\s?دیش', 'Bangladesh'), r('ڈھاکہ', 'Dhaka'),
  r('سری\\s?لنکا', 'Sri Lanka'), r('نیپال', 'Nepal'),
] as Rule[]).map(([pattern, as]): Rule => [new RegExp(urduPersianPlain(pattern.source), pattern.flags), as])

const PERSIAN: Rule[] = ([
  r('ایران(?:ی)?', 'Iran'), r('تهران', 'Tehran'), r('اصفهان', 'Isfahan'), r('مشهد', 'Mashhad'), r('شیراز', 'Shiraz'),
  r('تبریز', 'Tabriz'), r('اهواز', 'Ahvaz'), r('کرمانشاه', 'Kermanshah'), r('بندر\\s?عباس', 'Bandar Abbas'),
  r('تنگه\\s+هرمز|هرمز', 'Hormuz'), r('آمریکا(?:یی)?|ایالات\\s+متحده', 'United States'), r('واشنگتن', 'Washington'),
  r('کاخ\\s+سفید', 'White House'), r('روسیه', 'Russia'), r('مسکو', 'Moscow'), r('کرملین', 'Kremlin'), r('چین', 'China'),
  r('پکن', 'Beijing'), r('اسرائیل(?:ی)?', 'Israel'), r('غزه', 'Gaza'), r('فلسطین(?:ی)?', 'Palestine'), r('لبنان', 'Lebanon'),
  r('بیروت', 'Beirut'), r('سوریه', 'Syria'), r('دمشق', 'Damascus'), r('عراق', 'Iraq'), r('بغداد', 'Baghdad'),
  r('عربستان(?:\\s+سعودی)?', 'Saudi Arabia'), r('ترکیه', 'Turkey'), r('آنکارا', 'Ankara'), r('افغانستان', 'Afghanistan'),
  r('کابل', 'Kabul'), r('هرات', 'Herat'), r('قندهار', 'Kandahar'), r('پاکستان', 'Pakistan'), r('هند', 'India'),
  r('اوکراین', 'Ukraine'), r('آلمان', 'Germany'), r('فرانسه', 'France'), r('انگلیس|بریتانیا', 'United Kingdom'),
  r('لندن', 'London'), r('پاریس', 'Paris'), r('ژاپن', 'Japan'), r('کره\\s+شمالی', 'North Korea'), r('کره\\s+جنوبی', 'South Korea'),
  r('یمن', 'Yemen'), r('قطر', 'Qatar'), r('امارات', 'United Arab Emirates'), r('بحرین', 'Bahrain'), r('کویت', 'Kuwait'),
  r('عمان', 'Oman'), r('مصر', 'Egypt'), r('جمهوری\\s+آذربایجان', 'Azerbaijan'), r('باکو', 'Baku'), r('ارمنستان', 'Armenia'),
] as Rule[]).map(([pattern, as]): Rule => [new RegExp(urduPersianPlain(pattern.source), pattern.flags), as])

/** Urdu and Persian as arabicPlain leaves them, with Arabic ي and ك as their ی and ک */
export function urduPersianPlain(text: string): string {
  return arabicPlain(text).replace(/ي/g, 'ی').replace(/ك/g, 'ک')
}

/**
 * Vietnamese writes most names in two syllables ("Trung Quốc", "Hàn Quốc"). The one-syllable names are everyday words
 * or people's names too, so: "Mỹ" (the United States) only with its capital and not in a place or a name ("Mỹ Đình",
 * "Mỹ Tho", "Mỹ Linh"); "Nga" (Russia) not after a woman's name ("Thị Nga"); "Pháp" (France) not in "Pháp luật" (law)
 * and its kin; "Đức" (Germany) and "Anh" (Britain) only where a country stands ("tại Đức", "Thủ tướng Anh"), both being
 * common names.
 */
const VI_BEFORE = '(?<=(?:nước|tại|ở|của|với|sang|từ|người|và|Thủ tướng|Tổng thống|Bộ trưởng|Ngoại trưởng|Đại sứ|chính phủ|Chính phủ|Mỹ,|Pháp,|Nga,|Đức,|Anh,)\\s)'
const VIETNAMESE: Rule[] = [
  r('việt\\s+nam', 'Vietnam'), r('hà\\s+nội', 'Hanoi'),
  r('tp\\.?\\s?hcm|tp\\.?\\s+hồ\\s+chí\\s+minh|thành\\s+phố\\s+hồ\\s+chí\\s+minh|sài\\s+gòn', 'Ho Chi Minh City'),
  r('đà\\s+nẵng', 'Da Nang'), r('hải\\s+phòng', 'Haiphong'), r('cần\\s+thơ', 'Can Tho'), cs('Huế', 'Vietnam'),
  r('nha\\s+trang', 'Nha Trang'), r('hạ\\s+long', 'Ha Long'), r('hoa\\s+kỳ', 'United States'),
  cs('Mỹ(?!\\s+(?:Đình|Tho|Linh|Tâm|Phước|Hào|Lộc|Hạnh|Xuyên|Lệ|Duyên|Hương|Ngọc|An|Hòa|Thuận))', 'United States'),
  r('trung\\s+quốc', 'China'), r('nhật\\s+bản', 'Japan'), r('hàn\\s+quốc', 'South Korea'), r('triều\\s+tiên', 'North Korea'),
  cs('(?<!(?:Thị|Thiên|Hằng|Quỳnh|Thúy|Thanh|Tuyết|Kim|Thu|Hồng|Lê|Nguyễn|Trần)\\s)Nga', 'Russia'),
  cs('Pháp(?!\\s+(?:luật|lý|chế|y|nhân|định|quyền|lệnh|môn|sư|hội|bảo|danh|trị|đình))', 'France'),
  cs(`${VI_BEFORE}Đức`, 'Germany'), r('cộng\\s+hòa\\s+liên\\s+bang\\s+đức', 'Germany'),
  cs(`${VI_BEFORE}Anh(?!\\s+(?:ấy|ta|em|chị|trai))`, 'United Kingdom'), r('vương\\s+quốc\\s+anh', 'United Kingdom'),
  r('ấn\\s+độ', 'India'), r('thái\\s+lan', 'Thailand'), r('campuchia', 'Cambodia'), cs('Lào', 'Laos'), cs('Úc', 'Australia'),
  r('ả\\s+rập\\s+xê\\s+út', 'Saudi Arabia'), r('thổ\\s+nhĩ\\s+kỳ', 'Turkey'), r('đài\\s+loan', 'Taiwan'),
  r('bắc\\s+kinh', 'Beijing'), r('mát-?xcơ-?va', 'Moscow'), r('nhà\\s+trắng', 'White House'), r('điện\\s+kremlin', 'Kremlin'),
  r('bình\\s+nhưỡng', 'Pyongyang'), r('hồng\\s+kông', 'Hong Kong'), r('thượng\\s+hải', 'Shanghai'), r('ai\\s+cập', 'Egypt'),
  r('i-?ran', 'Iran'), r('i-?xra-?en', 'Israel'), r('dải\\s+gaza', 'Gaza'), r('tây\\s+ban\\s+nha', 'Spain'),
  cs('Ý(?!\\s+(?:kiến|tưởng|nghĩa|định|chí|thức|muốn|tế))', 'Italy'),
]

/**
 * Hindi (Nov 18, 2026; Aaj Tak and Navbharat Times, added on Devon's word). Its little words stand apart ("भारत में",
 * "अमेरिका के"), and a word's vowel signs are marks, not letters, so a name ends only where no letter or mark follows:
 * "चीन" (China) is not "चीनी" (Chinese, also sugar), left out. Nukta spellings are read either way ("ग़ाज़ा", "गाजा").
 */
const HB = '(?<![\\p{L}\\p{M}\\p{N}])'
const HE = '(?![\\p{L}\\p{M}\\p{N}])'
const hi = (alts: string, as: string): Rule => [new RegExp(`${HB}(?:${alts})${HE}`, 'gu'), as]
const HINDI: Rule[] = [
  hi('भारत|भारतीय|हिंदुस्तान', 'India'), hi('दिल्ली|नई दिल्ली', 'New Delhi'), hi('मुंबई', 'Mumbai'), hi('कोलकाता', 'Kolkata'),
  hi('चेन्नई', 'Chennai'), hi('बेंगलुरु|बेंगलुरू', 'Bengaluru'), hi('हैदराबाद', 'India'), hi('लखनऊ', 'Lucknow'),
  hi('पटना', 'Patna'), hi('जयपुर', 'Jaipur'), hi('भोपाल', 'Bhopal'), hi('अहमदाबाद', 'Ahmedabad'), hi('पुणे', 'Pune'),
  hi('पाकिस्तान|पाकिस्तानी', 'Pakistan'), hi('इस्लामाबाद', 'Islamabad'), hi('बांग्लादेश|बांग्लादेशी', 'Bangladesh'),
  hi('ढाका', 'Dhaka'), hi('नेपाल', 'Nepal'), hi('श्रीलंका', 'Sri Lanka'), hi('अफगानिस्तान|अफ़ग़ानिस्तान', 'Afghanistan'),
  hi('चीन', 'China'), hi('बीजिंग', 'Beijing'), hi('अमेरिका|अमेरिकी', 'United States'), hi('वॉशिंगटन|वाशिंगटन', 'Washington'),
  hi('व्हाइट हाउस', 'White House'), hi('रूस|रूसी', 'Russia'), hi('मॉस्को|मास्को', 'Moscow'), hi('यूक्रेन', 'Ukraine'),
  hi('ईरान|ईरानी', 'Iran'), hi('इजरायल|इज़राइल|इजराइल|इस्राइल|इजरायली', 'Israel'), hi('गाजा|ग़ाज़ा|गाज़ा', 'Gaza'),
  hi('सऊदी अरब|सऊदी', 'Saudi Arabia'), hi('कतर|क़तर', 'Qatar'), hi('दुबई', 'Dubai'), hi('ब्रिटेन', 'United Kingdom'),
  hi('लंदन', 'London'), hi('फ्रांस', 'France'), hi('जर्मनी', 'Germany'), hi('जापान', 'Japan'), hi('उत्तर कोरिया', 'North Korea'),
  hi('दक्षिण कोरिया', 'South Korea'), hi('कनाडा', 'Canada'), hi('ऑस्ट्रेलिया', 'Australia'), hi('तुर्की', 'Turkey'),
]

/**
 * Japanese, Chinese and Thai (Nov 18, 2026; Devon: "Add ... Japanese, Chinese and Thai"). They write no spaces, so a
 * name is found wherever it stands, without word edges. Left out or narrowed: "米" alone (rice) — the United States
 * only in "米国", "米軍", "日米" and their kin; "美" alone (beautiful) — only "美国", "美軍", "中美"; Japanese "中国" in
 * "中国地方" (a region of Japan) and "中国電力"; "タイ" alone (a tie, a sea bream) — Thailand only as "タイ政府" and kin;
 * Thai "ลาว" (Laos) inside "ลาวา" (lava).
 */
// (the English name set apart by spaces, so the place-finder reads it as a word inside unspaced text)
const cjk = (alts: string, as: string): Rule => [new RegExp(`(?:${alts})`, 'gu'), ` ${as} `]
const cjkMask = (alts: string): Rule => [new RegExp(`(?:${alts})`, 'gu'), '…']
const JAPANESE: Rule[] = [
  cjkMask('中国地方|中国電力|中国新聞|中国自動車道'),
  cjk('米国|米軍|米政府|米大統領|米国務|米国防|米中|米露|米ロ|米朝|日米|対米|訪米|駐米|全米|米側|米紙|米兵|米財務|米連邦|ホワイトハウス|ワシントン', 'United States'),
  cjk('中国|中国政府|中国軍', 'China'), cjk('北京', 'Beijing'), cjk('上海', 'Shanghai'), cjk('深セン|深圳', 'Shenzhen'),
  cjk('香港', 'Hong Kong'), cjk('台湾', 'Taiwan'), cjk('台北', 'Taipei'), cjk('韓国', 'South Korea'), cjk('ソウル', 'Seoul'),
  cjk('北朝鮮', 'North Korea'), cjk('平壌', 'Pyongyang'), cjk('ロシア', 'Russia'), cjk('モスクワ', 'Moscow'), cjk('クレムリン', 'Kremlin'),
  cjk('ウクライナ', 'Ukraine'), cjk('キーウ|キエフ', 'Kyiv'), cjk('イスラエル', 'Israel'), cjk('ガザ', 'Gaza'), cjk('イラン', 'Iran'),
  cjk('サウジアラビア|サウジ', 'Saudi Arabia'), cjk('イエメン', 'Yemen'), cjk('レバノン', 'Lebanon'), cjk('シリア', 'Syria'),
  cjk('イギリス|英国|英政府', 'United Kingdom'), cjk('フランス', 'France'), cjk('ドイツ', 'Germany'), cjk('インド', 'India'),
  cjk('パキスタン', 'Pakistan'), cjk('フィリピン', 'Philippines'), cjk('ベトナム', 'Vietnam'), cjk('タイ政府|タイ王国|タイ首相|タイ国内|タイ・カンボジア', 'Thailand'),
  cjk('カンボジア', 'Cambodia'), cjk('ミャンマー', 'Myanmar'), cjk('インドネシア', 'Indonesia'), cjk('オーストラリア|豪州', 'Australia'),
  cjk('カナダ', 'Canada'), cjk('メキシコ', 'Mexico'), cjk('ブラジル', 'Brazil'), cjk('ベネズエラ', 'Venezuela'), cjk('トルコ', 'Turkey'),
  cjk('沖縄', 'Okinawa'), cjk('東京', 'Tokyo'), cjk('大阪', 'Osaka'), cjk('京都', 'Kyoto'), cjk('名古屋', 'Nagoya'), cjk('北海道|札幌', 'Sapporo'),
  cjk('福岡', 'Fukuoka'), cjk('広島', 'Hiroshima'), cjk('神戸', 'Kobe'), cjk('仙台', 'Sendai'), cjk('横浜', 'Yokohama'), cjk('日本|政府与党', 'Japan'),
]
const CHINESE: Rule[] = [
  cjk('美国|美國|美军|美軍|美方|中美|美中|访美|訪美|白宫|白宮|华盛顿|華盛頓|特朗普|川普', 'United States'),
  cjk('中国大陆|中國大陸|大陆|大陸|中国|中國|中共|解放军|解放軍', 'China'), cjk('北京', 'Beijing'), cjk('上海', 'Shanghai'), cjk('深圳', 'Shenzhen'),
  cjk('广州|廣州', 'Guangzhou'), cjk('香港', 'Hong Kong'), cjk('澳门|澳門', 'Macau'), cjk('台湾|台灣|臺灣', 'Taiwan'), cjk('台北|臺北', 'Taipei'),
  cjk('台中|臺中', 'Taichung'), cjk('台南|臺南', 'Tainan'), cjk('高雄', 'Kaohsiung'), cjk('日本', 'Japan'), cjk('东京|東京', 'Tokyo'),
  cjk('韩国|韓國|南韩|南韓', 'South Korea'), cjk('首尔|首爾', 'Seoul'), cjk('朝鲜|朝鮮|北韩|北韓', 'North Korea'), cjk('平壤', 'Pyongyang'),
  cjk('俄罗斯|俄羅斯|俄国|俄國|俄军|俄軍|俄乌|俄烏|普京|普丁', 'Russia'), cjk('莫斯科', 'Moscow'), cjk('克里姆林宫|克里姆林宮', 'Kremlin'),
  cjk('乌克兰|烏克蘭', 'Ukraine'), cjk('基辅|基輔', 'Kyiv'), cjk('以色列|以军|以軍', 'Israel'), cjk('加沙|加薩', 'Gaza'), cjk('伊朗', 'Iran'),
  cjk('沙特|沙乌地|沙烏地', 'Saudi Arabia'), cjk('也门|葉門', 'Yemen'), cjk('黎巴嫩', 'Lebanon'), cjk('叙利亚|敘利亞', 'Syria'),
  cjk('英国|英國', 'United Kingdom'), cjk('法国|法國', 'France'), cjk('德国|德國', 'Germany'), cjk('印度', 'India'),
  cjk('巴基斯坦', 'Pakistan'), cjk('菲律宾|菲律賓', 'Philippines'), cjk('越南', 'Vietnam'), cjk('泰国|泰國', 'Thailand'),
  cjk('柬埔寨', 'Cambodia'), cjk('缅甸|緬甸', 'Myanmar'), cjk('印尼|印度尼西亚', 'Indonesia'), cjk('马来西亚|馬來西亞', 'Malaysia'),
  cjk('新加坡', 'Singapore'), cjk('澳大利亚|澳洲', 'Australia'), cjk('加拿大', 'Canada'), cjk('墨西哥', 'Mexico'), cjk('巴西', 'Brazil'),
  cjk('委内瑞拉|委內瑞拉', 'Venezuela'), cjk('土耳其', 'Turkey'),
]
const THAI: Rule[] = [
  cjkMask('ลาวา'),
  cjk('ประเทศไทย|ไทย', 'Thailand'), cjk('กรุงเทพมหานคร|กรุงเทพฯ|กรุงเทพ|กทม\\.', 'Bangkok'), cjk('เชียงใหม่', 'Chiang Mai'),
  cjk('ภูเก็ต', 'Phuket'), cjk('พัทยา', 'Pattaya'), cjk('กัมพูชา', 'Cambodia'), cjk('เมียนมา|พม่า', 'Myanmar'), cjk('ลาว', 'Laos'),
  cjk('มาเลเซีย', 'Malaysia'), cjk('สหรัฐอเมริกา|สหรัฐฯ|สหรัฐ|ทำเนียบขาว|วอชิงตัน', 'United States'), cjk('จีน', 'China'),
  cjk('ปักกิ่ง', 'Beijing'), cjk('ญี่ปุ่น', 'Japan'), cjk('รัสเซีย', 'Russia'), cjk('ยูเครน', 'Ukraine'), cjk('อิสราเอล', 'Israel'),
  cjk('อิหร่าน', 'Iran'), cjk('กาซา', 'Gaza'), cjk('เวียดนาม', 'Vietnam'), cjk('อินเดีย', 'India'), cjk('อังกฤษ', 'United Kingdom'),
  cjk('ฝรั่งเศส', 'France'), cjk('เยอรมนี', 'Germany'), cjk('เกาหลีใต้', 'South Korea'), cjk('เกาหลีเหนือ', 'North Korea'),
  cjk('สิงคโปร์', 'Singapore'), cjk('อินโดนีเซีย', 'Indonesia'), cjk('ฟิลิปปินส์', 'Philippines'),
]

/** Swahili (Nov 18, 2026: HabariLEO, the list's first Swahili feed); East Africa's own place names are spelt as in English */
const SWAHILI: Rule[] = [
  r('ikulu\\s+ya\\s+marekani', 'White House'), r('marekani', 'United States'), r('uingereza', 'United Kingdom'),
  r('ufaransa', 'France'), r('ujerumani', 'Germany'), r('urusi', 'Russia'), r('japani', 'Japan'), r('uchina', 'China'),
  r('afrika\\s+kusini', 'South Africa'), r('sudan\\s+kusini', 'South Sudan'), r('misri', 'Egypt'), r('msumbiji', 'Mozambique'),
  r('jamhuri\\s+ya\\s+kidemokrasia\\s+ya\\s+kongo', 'Democratic Republic of the Congo'), r('uhindi', 'India'),
  r('israeli', 'Israel'), r('irani', 'Iran'), r('uturuki', 'Turkey'), r('ugiriki', 'Greece'), r('uholanzi', 'Netherlands'),
  r('uarabuni\\s+wa\\s+saudi|saudia', 'Saudi Arabia'), r('korea\\s+kusini', 'South Korea'), r('korea\\s+kaskazini', 'North Korea'),
]

/**
 * Bengali (Nov 19, 2026: Dainik Azadi of Chittagong, the list's first Bengali feed). Its case endings join the name
 * ("ঢাকায়" in Dhaka, "বাংলাদেশের" of Bangladesh, "চট্টগ্রামে" in Chittagong), so a name may carry one; its vowel signs are
 * marks, so "চীন" (China) is not "চীনা" (Chinese).
 */
const bn = (alts: string, as: string): Rule => [new RegExp(`${HB}(?:${alts})(?:ের|এর|য়|য়|ে|র|কে)?${HE}`, 'gu'), as]
const BENGALI: Rule[] = [
  bn('বাংলাদেশ', 'Bangladesh'), bn('ঢাকা', 'Dhaka'), bn('চট্টগ্রাম', 'Chittagong'), bn('সিলেট', 'Sylhet'), bn('খুলনা', 'Khulna'),
  bn('রাজশাহী', 'Rajshahi'), bn('বরিশাল', 'Barisal'), bn('রংপুর', 'Rangpur'), bn('কক্সবাজার', "Cox's Bazar"),
  bn('ময়মনসিংহ', 'Mymensingh'), bn('কুমিল্লা', 'Comilla'), bn('ভারত', 'India'), bn('কলকাতা', 'Kolkata'),
  bn('পশ্চিমবঙ্গ', 'West Bengal'), bn('মিয়ানমার|মায়ানমার', 'Myanmar'), bn('পাকিস্তান', 'Pakistan'), bn('নেপাল', 'Nepal'),
  bn('চীন', 'China'), bn('যুক্তরাষ্ট্র|মার্কিন যুক্তরাষ্ট্র', 'United States'), bn('রাশিয়া', 'Russia'), bn('ইউক্রেন', 'Ukraine'),
  bn('ইরান', 'Iran'), bn('ইসরায়েল|ইসরাইল', 'Israel'), bn('গাজা', 'Gaza'), bn('সৌদি আরব', 'Saudi Arabia'),
  bn('যুক্তরাজ্য|ব্রিটেন', 'United Kingdom'), bn('জাপান', 'Japan'),
]

/**
 * Hebrew (Nov 19, 2026: Bizportal, the list's first Hebrew feed). Its little words join the name as one letter
 * ("בישראל" in Israel, "לעזה" to Gaza, "מאיראן" from Iran, "והמצרים"), so a name may carry one or two of them.
 */
const he = (alts: string, as: string): Rule => [new RegExp(`${HB}(?:[ובלמהש]{0,2})(?:${alts})${HE}`, 'gu'), as]
const HEBREW: Rule[] = [
  he('ישראל', 'Israel'), he('תל אביב', 'Tel Aviv'), he('ירושלים', 'Jerusalem'), he('חיפה', 'Haifa'), he('עזה', 'Gaza'),
  he('ארה"ב|ארה״ב|ארצות הברית', 'United States'), he('איראן', 'Iran'), he('לבנון', 'Lebanon'), he('סוריה', 'Syria'),
  he('מצרים', 'Egypt'), he('ירדן', 'Jordanian'), he('רוסיה', 'Russia'), he('אוקראינה', 'Ukraine'), he('סין', 'China'),
  he('בריטניה', 'United Kingdom'), he('צרפת', 'France'), he('גרמניה', 'Germany'), he('יפן', 'Japan'),
]

/**
 * Slovak, Estonian and Latvian (Nov 19, 2026: the thin-countries round's first feeds in them). Their case endings join
 * the name ("v Rusku", "Venemaal", "Krievijā"), so the forms they take are listed; the adjectives ("ruský", "Vene",
 * "Krievijas" aside) are not places.
 */
const SLOVAK: Rule[] = [
  r('rusk[oua]|ruskom', 'Russia'), r('ukrajin[aeuy]|ukrajinou', 'Ukraine'), r('nemeck[oua]|nemeckom', 'Germany'),
  r('rak[uú]sk[oua]', 'Austria'), r('maďarsk[oua]', 'Hungary'), r('poľsk[oua]', 'Poland'), r('česk[oua]|česká republika|českej republike', 'Czech Republic'),
  r('francúzsk[oua]', 'France'), r('veľk[aá] británi[ae]|veľkej británii', 'United Kingdom'), r('čín[aeuy]|číne', 'China'),
  r('spojen[ée] štáty|spojených štátoch|usa', 'United States'), r('izrael[ia]?|izraeli', 'Israel'),
]
const ESTONIAN: Rule[] = [
  r('venemaa(?:l|le|lt|ga|st|sse|d)?', 'Russia'), r('ukraina(?:s|sse|st|l|le|lt|ga|t)?', 'Ukraine'), r('saksamaa(?:l|le|lt|ga|d)?', 'Germany'),
  r('soome(?:s|sse|st|ga)?', 'Finland'), r('läti(?:s|sse|st|ga)?', 'Latvia'), r('leedu(?:s|sse|st|ga)?', 'Lithuania'),
  r('rootsi(?:s|sse|st|ga)?', 'Sweden'), r('hiina(?:s|sse|st|ga)?', 'China'), r('prantsusmaa(?:l|le|lt|ga)?', 'France'),
  r('suurbritannia(?:s|sse|st|ga)?', 'United Kingdom'), r('ameerika ühendriigi(?:d|des|dega|dest)?|usa(?:s|sse|st|ga)?', 'United States'),
]
const LATVIAN: Rule[] = [
  r('krievij[aāsiu]|krievijā', 'Russia'), r('ukrain[aāsiu]|ukrainā', 'Ukraine'), r('vācij[aāsiu]|vācijā', 'Germany'),
  r('lietuv[aāsiu]|lietuvā', 'Lithuania'), r('igaunij[aāsiu]|igaunijā', 'Estonia'), r('polij[aāsiu]|polijā', 'Poland'),
  r('ķīn[aāsiu]|ķīnā', 'China'), r('francij[aāsiu]|francijā', 'France'), r('lielbritānij[aāsiu]|lielbritānijā', 'United Kingdom'),
  r('zviedrij[aāsiu]|zviedrijā', 'Sweden'), r('somij[aāsiu]|somijā', 'Finland'), r('asv', 'United States'),
]

/**
 * Bulgarian, Macedonian, Norwegian, Finnish and Icelandic (Nov 19, 2026: the push to 1,000's first feeds in them);
 * Croatian is read with the Montenegrin names, the same words. Finnish and Icelandic join their case endings to the
 * name ("Venäjällä", "Úkraínu"), so the forms they take are listed.
 */
const BULGARIAN: Rule[] = [
  r('русия', 'Russia'), r('украйна', 'Ukraine'), r('германия', 'Germany'), r('турция', 'Turkey'), r('гърция', 'Greece'),
  r('румъния', 'Romania'), r('сърбия', 'Serbia'), r('северна македония', 'North Macedonia'), r('сащ', 'United States'),
  r('китай', 'China'), r('франция', 'France'), r('великобритания', 'United Kingdom'), r('израел', 'Israel'), r('иран', 'Iran'),
]
const MACEDONIAN: Rule[] = [
  r('русија', 'Russia'), r('украина', 'Ukraine'), r('германија', 'Germany'), r('турција', 'Turkey'), r('грција', 'Greece'),
  r('бугарија', 'Bulgaria'), r('србија', 'Serbia'), r('албанија', 'Albania'), r('косово', 'Kosovo'), r('сад', 'United States'),
  r('кина', 'China'), r('франција', 'France'), r('израел', 'Israel'),
]
const NORWEGIAN: Rule[] = [
  r('russland', 'Russia'), r('ukraina', 'Ukraine'), r('tyskland', 'Germany'), r('sverige', 'Sweden'), r('danmark', 'Denmark'),
  r('finland', 'Finland'), r('kina', 'China'), r('frankrike', 'France'), r('storbritannia', 'United Kingdom'), r('usa', 'United States'),
  r('israel', 'Israel'), r('iran', 'Iran'), r('svalbard', 'Svalbard'),
]
const FINNISH: Rule[] = [
  r('venäjä(?:llä|lle|ltä|n|ä|stä|än)?|venäjää', 'Russia'), r('ukraina(?:n|ssa|an|sta|lle|lla)?|ukrainaa', 'Ukraine'),
  r('ruotsi(?:n|ssa|in|sta)?|ruotsia', 'Sweden'), r('saksa(?:n|ssa|an|sta)?|saksaa', 'Germany'), r('viro(?:n|ssa|on|sta)?|viroa', 'Estonia'),
  r('norja(?:n|ssa|an|sta)?|norjaa', 'Norway'), r('kiina(?:n|ssa|an|sta)?|kiinaa', 'China'), r('ranska(?:n|ssa|an|sta)?|ranskaa', 'France'),
  r('yhdysvallat|yhdysvaltojen|yhdysvalloissa|yhdysvaltoihin', 'United States'), r('israel(?:in|issa|iin)?', 'Israel'),
]
const ICELANDIC: Rule[] = [
  r('rússland(?:i|s)?', 'Russia'), r('úkraín(?:a|u|ar)', 'Ukraine'), r('bandaríkin|bandaríkjunum|bandaríkjanna', 'United States'),
  r('noreg(?:ur|i|s)', 'Norway'), r('danmörk(?:u)?|danmerkur', 'Denmark'), r('svíþjóð(?:ar)?', 'Sweden'), r('þýskaland(?:i|s)?', 'Germany'),
  r('bretland(?:i|s)?', 'United Kingdom'), r('grænland(?:i|s)?', 'Greenland'), r('kína', 'China'), r('ísrael', 'Israel'),
]

/**
 * Georgian and Somali (Nov 19, 2026: Netgazeti and Caasimada, the push to 1,000's first feeds in them). Georgian joins
 * its case endings to the name ("რუსეთში" in Russia, "უკრაინაში" in Ukraine), so a name may carry one.
 */
const ka = (alts: string, as: string): Rule => [new RegExp(`${HB}(?:${alts})(?:ში|ის|მა|ს|დან|თან|ზე)?${HE}`, 'gu'), as]
const GEORGIAN: Rule[] = [
  ka('საქართველო|საქართველოს|საქართველოში', 'Republic of Georgia'), ka('თბილის[ი]?', 'Tbilisi'), ka('ბათუმ[ი]?', 'Batumi'), ka('რუსეთ[ი]?', 'Russia'),
  ka('უკრაინა|უკრაინ', 'Ukraine'), ka('სომხეთ[ი]?', 'Armenia'),
  ka('აზერბაიჯან[ი]?', 'Azerbaijan'), ka('თურქეთ[ი]?', 'Turkey'), ka('აშშ', 'United States'),
]
const SOMALI: Rule[] = [
  r('muqdisho', 'Mogadishu'), r('soomaaliya', 'Somalia'), r('soomaaliland', 'Somaliland'), r('puntland|garoowe', 'Garowe'),
  r('hargeysa', 'Hargeisa'), r('kismaayo', 'Kismayo'), r('baydhabo', 'Baidoa'), r('gaalkacyo', 'Galkayo'), r('itoobiya', 'Ethiopia'),
  r('kenya', 'Kenya'), r('jabuuti', 'Djibouti'), r('imaaraadka', 'United Arab Emirates'), r('mareykanka', 'United States'),
]

/**
 * The languages of India's own scripts, Sindhi and Amharic (Nov 19, 2026; Devon, 5:33 PM: "more local language
 * coverage"): Tamil, Telugu, Kannada, Malayalam, Marathi, Gujarati, Odia and Assamese join their endings to a name
 * ("சென்னையில்", in Chennai; "हैदराबादमध्ये"; "ভাৰতত"), so a name is read from its start and the whole word taken;
 * Amharic puts its little words before it ("በአዲስ አበባ", in Addis Ababa). Hyderabad is read as Telangana (Pakistan
 * has one too), Sindhi's as Sindh. Left out: short names that begin other words (Tamil "காசா", Gaza, begins "காசாளர்",
 * a cashier; "சீன", Chinese, begins "சீனிவாசன்", a name).
 */
const ag = (alts: string, as: string): Rule => [new RegExp(`${HB}(?:${alts})[\\p{L}\\p{M}]*`, 'gu'), as]
const TAMIL: Rule[] = [
  ag('இந்திய', 'India'), ag('தமிழ்நாட|தமிழக', 'Tamil Nadu'), ag('சென்னை', 'Chennai'), ag('கோவை|கோயம்புத்தூ', 'Coimbatore'),
  ag('மதுரை', 'Madurai'), ag('புதுச்சேரி', 'Puducherry'), ag('கேரள', 'Kerala'), ag('கர்நாடக', 'Karnataka'),
  ag('டெல்லி|தில்லி', 'New Delhi'), ag('மும்பை', 'Mumbai'), ag('பெங்களூ', 'Bengaluru'), ag('இலங்கை', 'Sri Lanka'),
  ag('கொழும்ப', 'Colombo'), ag('யாழ்ப்பாண', 'Jaffna'), ag('பாகிஸ்தான', 'Pakistan'), ag('வங்கதேச', 'Bangladesh'),
  ag('நேபாள', 'Nepal'), ag('சீனா', 'China'), ag('அமெரிக்க', 'United States'), ag('ரஷ்ய', 'Russia'), ag('உக்ரைன', 'Ukraine'),
  ag('ஈரான', 'Iran'), ag('இஸ்ரேல', 'Israel'), ag('ஜப்பான', 'Japan'), ag('பிரிட்டன', 'United Kingdom'),
]
const TELUGU: Rule[] = [
  ag('భారత', 'India'), ag('తెలంగాణ', 'Telangana'), ag('హైదరాబాద', 'Telangana'), ag('ఆంధ్రప్రదేశ|ఏపీ', 'Andhra Pradesh'),
  ag('విజయవాడ', 'Vijayawada'), ag('విశాఖ', 'Visakhapatnam'), ag('తిరుపతి', 'Tirupati'), ag('వరంగల', 'Warangal'),
  ag('చెన్నై', 'Chennai'), ag('బెంగళూరు', 'Bengaluru'), ag('ఢిల్లీ', 'New Delhi'), ag('ముంబై', 'Mumbai'),
  ag('పాకిస్తాన|పాకిస్థాన', 'Pakistan'), ag('బంగ్లాదేశ', 'Bangladesh'), ag('శ్రీలంక', 'Sri Lanka'), ag('నేపాల', 'Nepal'),
  ag('చైనా', 'China'), ag('అమెరికా', 'United States'), ag('రష్యా', 'Russia'), ag('ఉక్రెయిన', 'Ukraine'), ag('ఇరాన', 'Iran'),
  ag('ఇజ్రాయెల', 'Israel'), ag('జపాన', 'Japan'), ag('బ్రిటన', 'United Kingdom'),
]
const KANNADA: Rule[] = [
  ag('ಭಾರತ', 'India'), ag('ಕರ್ನಾಟಕ', 'Karnataka'), ag('ಬೆಂಗಳೂರ', 'Bengaluru'), ag('ಮೈಸೂರ', 'Mysuru'), ag('ಮಂಗಳೂರ', 'Mangaluru'),
  ag('ಹುಬ್ಬಳ್ಳಿ', 'Karnataka'), ag('ಬೆಳಗಾವಿ', 'Belagavi'), ag('ಕೇರಳ', 'Kerala'), ag('ದೆಹಲಿ', 'New Delhi'), ag('ಮುಂಬೈ', 'Mumbai'),
  ag('ಚೆನ್ನೈ', 'Chennai'), ag('ಹೈದರಾಬಾದ', 'Telangana'), ag('ಪಾಕಿಸ್ತಾನ', 'Pakistan'), ag('ಬಾಂಗ್ಲಾದೇಶ', 'Bangladesh'),
  ag('ಶ್ರೀಲಂಕಾ', 'Sri Lanka'), ag('ನೇಪಾಳ', 'Nepal'), ag('ಚೀನಾ', 'China'), ag('ಅಮೆರಿಕ', 'United States'), ag('ರಷ್ಯಾ', 'Russia'),
  ag('ಉಕ್ರೇನ', 'Ukraine'), ag('ಇರಾನ', 'Iran'), ag('ಇಸ್ರೇಲ', 'Israel'), ag('ಜಪಾನ', 'Japan'),
]
const MALAYALAM: Rule[] = [
  ag('ഇന്ത്യ', 'India'), ag('കേരള', 'Kerala'), ag('തിരുവനന്തപുര', 'Thiruvananthapuram'), ag('കൊച്ചി', 'Kochi'),
  ag('കോഴിക്കോട', 'Kozhikode'), ag('തൃശ്ശൂ|തൃശൂ', 'Thrissur'), ag('കണ്ണൂ', 'Kannur'), ag('മലപ്പുറ', 'Malappuram'),
  ag('ഡൽഹി|ദില്ലി', 'New Delhi'), ag('മുംബൈ', 'Mumbai'), ag('ചെന്നൈ', 'Chennai'), ag('ബെംഗളൂരു|ബംഗളൂരു', 'Bengaluru'),
  ag('പാകിസ്ഥാ|പാക്കിസ്ഥാ', 'Pakistan'), ag('ചൈന', 'China'), ag('അമേരിക്ക', 'United States'), ag('റഷ്യ', 'Russia'),
  ag('യുക്രെയ്|യുക്രൈ', 'Ukraine'), ag('ഇറാ[നൻ]', 'Iran'), ag('ഇസ്രായേ|ഇസ്രയേ', 'Israel'), ag('ഗാസ', 'Gaza'),
  ag('സൗദി', 'Saudi Arabia'), ag('യുഎഇ', 'United Arab Emirates'), ag('ദുബായ', 'Dubai'), ag('ഖത്ത', 'Qatar'),
  ag('ശ്രീലങ്ക', 'Sri Lanka'), ag('ജപ്പാ', 'Japan'),
]
const MARATHI: Rule[] = [
  ag('भारत', 'India'), ag('महाराष्ट्र', 'Maharashtra'), ag('मुंबई', 'Mumbai'), ag('पुणे|पुण्या', 'Pune'), ag('नागपूर', 'Nagpur'),
  ag('नाशिक', 'Nashik'), ag('ठाणे|ठाण्या', 'Thane'), ag('कोल्हापूर', 'Kolhapur'),
  ag('दिल्ली', 'New Delhi'), ag('गुजरात', 'Gujarat'), ag('कर्नाटक', 'Karnataka'), ag('पाकिस्तान', 'Pakistan'),
  ag('बांगलादेश', 'Bangladesh'), ag('चीन', 'China'), ag('अमेरिके|अमेरिका', 'United States'), ag('रशिया', 'Russia'),
  ag('युक्रेन', 'Ukraine'), ag('इराण', 'Iran'), ag('इस्रायल', 'Israel'), ag('जपान', 'Japan'), ag('ब्रिटन', 'United Kingdom'),
]
const GUJARATI: Rule[] = [
  ag('ભારત', 'India'), ag('ગુજરાત', 'Gujarat'), ag('અમદાવાદ', 'Ahmedabad'), ag('સુરત', 'Surat'), ag('વડોદરા', 'Vadodara'),
  ag('રાજકોટ', 'Rajkot'), ag('ગાંધીનગર', 'Gandhinagar'), ag('મુંબઈ', 'Mumbai'), ag('દિલ્હી', 'New Delhi'),
  ag('પાકિસ્તાન', 'Pakistan'), ag('ચીન', 'China'), ag('અમેરિકા', 'United States'), ag('રશિયા', 'Russia'), ag('યુક્રેન', 'Ukraine'),
  ag('ઈરાન|ઇરાન', 'Iran'), ag('ઇઝરાયલ|ઈઝરાયેલ|ઇઝરાયેલ', 'Israel'), ag('બાંગ્લાદેશ', 'Bangladesh'), ag('જાપાન', 'Japan'),
]
const ODIA: Rule[] = [
  ag('ଭାରତ', 'India'), ag('ଓଡ଼ିଶା|ଓଡିଶା', 'Odisha'), ag('ଭୁବନେଶ୍ୱର', 'Bhubaneswar'), ag('କଟକ', 'Cuttack'),
  ag('ସମ୍ବଲପୁର', 'Sambalpur'), ag('ଦିଲ୍ଲୀ', 'New Delhi'), ag('ପାକିସ୍ତାନ', 'Pakistan'), ag('ଚୀନ', 'China'),
  ag('ଆମେରିକା', 'United States'), ag('ଋଷିଆ|ରୁଷିଆ', 'Russia'), ag('ୟୁକ୍ରେନ', 'Ukraine'), ag('ଇରାନ', 'Iran'), ag('ବାଂଲାଦେଶ', 'Bangladesh'),
]
const ASSAMESE: Rule[] = [
  ag('ভাৰত', 'India'), ag('অসম', 'Assam'), ag('গুৱাহাটী', 'Guwahati'), ag('ডিব্ৰুগড়', 'Dibrugarh'), ag('যোৰহাট', 'Assam'),
  ag('শিলচৰ', 'Silchar'), ag('মেঘালয়', 'Meghalaya'), ag('মণিপুৰ', 'Manipur'), ag('নাগালেণ্ড|নাগালেণ্ড', 'Nagaland'),
  ag('অৰুণাচল', 'Arunachal Pradesh'), ag('বাংলাদেশ', 'Bangladesh'), ag('দিল্লী', 'New Delhi'), ag('পাকিস্তান', 'Pakistan'),
  ag('চীন', 'China'), ag('আমেৰিকা', 'United States'), ag('ৰাছিয়া|ৰুছ', 'Russia'), ag('ইউক্ৰেইন', 'Ukraine'), ag('ইৰাণ|ইৰান', 'Iran'),
]
const SINDHI: Rule[] = [
  ag('پاڪستان|پاکستان', 'Pakistan'), ag('سنڌ', 'Sindh'), ag('حيدرآباد', 'Sindh'), ag('ڪراچي|کراچی', 'Karachi'),
  ag('لاڙڪاڻ', 'Larkana'), ag('سکر', 'Sukkur'), ag('اسلام آباد', 'Islamabad'), ag('لاهور', 'Lahore'), ag('ڪوئيٽا', 'Quetta'),
  ag('بلوچستان', 'Balochistan'), ag('ڀارت|بھارت', 'India'), ag('افغانستان', 'Afghanistan'), ag('ايران', 'Iran'),
  ag('آمريڪا|امريڪا', 'United States'), ag('چين', 'China'),
]
const am = (alts: string, as: string): Rule => [new RegExp(`${HB}(?:[በለየከ]|ከነ)?(?:${alts})[\\p{L}\\p{M}]*`, 'gu'), as]
const AMHARIC: Rule[] = [
  am('ኢትዮጵያ', 'Ethiopia'), am('አዲስ አበባ', 'Addis Ababa'), am('ትግራይ', 'Tigray'), am('ኦሮሚያ', 'Oromia'), am('ባሕር ዳር|ባህር ዳር', 'Bahir Dar'),
  am('መቀሌ', 'Mekelle'), am('ድሬዳዋ|ድሬ ዳዋ', 'Dire Dawa'), am('ጎንደር', 'Gondar'), am('ሀዋሳ|ሐዋሳ', 'Hawassa'), am('ኤርትራ', 'Eritrea'),
  am('ሱዳን', 'Sudan'), am('ሶማሊያ', 'Somalia'), am('ኬንያ', 'Kenya'), am('ግብፅ', 'Egypt'), am('ጅቡቲ', 'Djibouti'),
  am('አሜሪካ', 'United States'), am('ቻይና', 'China'), am('ሩሲያ', 'Russia'), am('እስራኤል', 'Israel'),
]

/**
 * Punjabi (Gurmukhi), Sinhala, Burmese and Filipino (Nov 19, 2026: the lists' first feeds in them). Punjabi and Sinhala
 * join their endings to a name like the Indian scripts above ("ලංකාවේ", in Lanka); Burmese writes no spaces between
 * its words, so its names are found anywhere, as Chinese and Thai ones are. Filipino shares most place names with
 * English; its own are its names for countries and Manila ("hapon", Japan, is also the afternoon: left out). Punjab is
 * read as India's (Pakistan has one too).
 */
const PUNJABI: Rule[] = [
  ag('ਭਾਰਤ', 'India'), ag('ਪੰਜਾਬ', 'Chandigarh'), ag('ਚੰਡੀਗੜ੍ਹ', 'Chandigarh'), ag('ਅੰਮ੍ਰਿਤਸਰ', 'Amritsar'), ag('ਲੁਧਿਆਣ', 'Ludhiana'),
  ag('ਜਲੰਧਰ', 'Jalandhar'), ag('ਪਟਿਆਲ', 'Patiala'), ag('ਦਿੱਲੀ', 'New Delhi'), ag('ਹਰਿਆਣ', 'Haryana'), ag('ਪਾਕਿਸਤਾਨ', 'Pakistan'),
  ag('ਲਾਹੌਰ', 'Lahore'), ag('ਕੈਨੇਡਾ', 'Canada'), ag('ਅਮਰੀਕ', 'United States'), ag('ਇੰਗਲੈਂਡ|ਬ੍ਰਿਟੇਨ', 'United Kingdom'),
  ag('ਆਸਟ੍ਰੇਲੀਆ', 'Australia'), ag('ਚੀਨ', 'China'), ag('ਰੂਸ', 'Russia'), ag('ਯੂਕਰੇਨ', 'Ukraine'), ag('ਇਜ਼ਰਾਈਲ|ਇਜ਼ਰਾਇਲ', 'Israel'),
  ag('ਈਰਾਨ', 'Iran'), ag('ਗ੍ਰੀਨਲੈਂਡ', 'Greenland'),
]
const SINHALA: Rule[] = [
  ag('ලංකා', 'Sri Lanka'), ag('කොළඹ', 'Colombo'), ag('මහනුවර', 'Kandy'), ag('ගාල්ල', 'Galle'), ag('යාපනය', 'Jaffna'),
  ag('ත්‍රිකුණාමල|ත්රිකුණාමල', 'Trincomalee'), ag('මඩකලපුව', 'Batticaloa'), ag('ඉන්දියා', 'India'), ag('චීන', 'China'),
  ag('ඇමරිකා', 'United States'), ag('රුසියා', 'Russia'), ag('යුක්රේන', 'Ukraine'), ag('ඊශ්‍රායල|ඊශ්රායල', 'Israel'), ag('ඉරාන', 'Iran'),
  ag('පකිස්තාන', 'Pakistan'), ag('මාලදිවයින', 'Maldives'), ag('බංග්ලාදේශ', 'Bangladesh'), ag('ජපාන', 'Japan'),
  ag('එංගලන්ත|බ්‍රිතාන්‍ය|බ්රිතාන්ය', 'United Kingdom'),
]
const BURMESE: Rule[] = [
  cjk('မြန်မာ', 'Myanmar'), cjk('ရန်ကုန်', 'Yangon'), cjk('နေပြည်တော်', 'Naypyidaw'), cjk('မန္တလေး', 'Mandalay'), cjk('ရခိုင်', 'Rakhine'),
  cjk('ကချင်', 'Kachin'), cjk('စစ်ကိုင်း', 'Sagaing'), cjk('တရုတ်', 'China'), cjk('ထိုင်း', 'Thailand'), cjk('အိန္ဒိယ', 'India'),
  cjk('ဘင်္ဂလားဒေ့ရှ်', 'Bangladesh'), cjk('အမေရိကန်', 'United States'), cjk('ရုရှား', 'Russia'), cjk('ဂျပန်', 'Japan'),
]
const FILIPINO: Rule[] = [
  r('pilipinas|pinas', 'Philippines'), r('maynila|kamaynilaan', 'Manila'), r('lungsod quezon', 'Quezon City'),
  r('estados unidos|amerika', 'United States'), r('tsina', 'China'), r('rusya', 'Russia'), r('ukranya', 'Ukraine'),
]

export const LOCAL_NAMES: Record<string, Rule[]> = {
  ja: JAPANESE, zh: CHINESE, th: THAI,
  hi: HINDI,
  de: GERMAN, it: ITALIAN, ca: CATALAN, da: DANISH, kl: DANISH, nl: DUTCH, ro: ROMANIAN, sl: SLOVENE,
  sr: MONTENEGRIN, cnr: MONTENEGRIN, sq: ALBANIAN, ms: MALAY, es: SPANISH, pt: PORTUGUESE, lt: LITHUANIAN,
  ar: ARABIC, ru: RUSSIAN, mn: MONGOLIAN, fr: FRENCH,
  tr: TURKISH, pl: POLISH, hu: HUNGARIAN, cs: CZECH, id: INDONESIAN, uk: UKRAINIAN,
  el: GREEK, ko: KOREAN, ur: URDU, fa: PERSIAN, vi: VIETNAMESE, sw: SWAHILI, bn: BENGALI, he: HEBREW, sk: SLOVAK, et: ESTONIAN, lv: LATVIAN,
  bg: BULGARIAN, mk: MACEDONIAN, no: NORWEGIAN, nb: NORWEGIAN, fi: FINNISH, is: ICELANDIC, hr: MONTENEGRIN, ka: GEORGIAN, so: SOMALI,
  ta: TAMIL, te: TELUGU, kn: KANNADA, ml: MALAYALAM, mr: MARATHI, gu: GUJARATI, or: ODIA, as: ASSAMESE, sd: SINDHI, am: AMHARIC,
  pa: PUNJABI, si: SINHALA, my: BURMESE, tl: FILIPINO, fil: FILIPINO,
}

/** The text with its language's place names in English and its look-alike words blanked out, for finding its place */
export function withLocalNames(text: string, language: string | null | undefined): string {
  const rules = language ? LOCAL_NAMES[language.toLowerCase().split('-')[0]!] : undefined
  if (!rules || !text) return text
  let out = rules === ARABIC ? arabicPlain(text)
    : rules === URDU || rules === PERSIAN ? urduPersianPlain(text)
      : rules === GREEK ? greekPlain(text) : text
  for (const [pattern, as] of rules) out = out.replace(pattern, as)
  return out
}
