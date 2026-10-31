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
  r('tiran(?:a|[ëe]s?|[ëe]n)', 'Tirana'), r('beograd(?:i|it|in)?', 'Belgrade'), r('shkup(?:i|it|in)?', 'Skopje'),
  r('bruksel(?:i|it|in)?', 'Brussels'), r('mosk(?:va|[ëe]s?|[ëe]n)', 'Moscow'), r('uashington(?:i|it|in)?', 'Washington'),
  r('sht[ëe]pi(?:a|s[ëe])?\\s+e\\s+bardh[ëe]', 'White House'), r('kreml(?:in)?(?:i|it)?', 'Kremlin'),
  r('kanad(?:a|aja|as[ëe]|an[ëe])', 'Canada'), r('ruse|rus[ëe]t|rus[ëe]ve', 'Russian'),
  r('amerikan(?:e|[ëe]t|[ëe]ve|i|it)?', 'United States'), r('kinez(?:e|[ëe]t|[ëe]ve|i|it)?', 'Chinese'),
  r('ukrainas(?:e|i|it)?', 'Ukrainian'), r('izraelit(?:e|[ëe]t|[ëe]ve|i)?', 'Israeli'), r('gjerman(?:e|[ëe]t|[ëe]ve|i|it)?', 'German'),
  r('mali', '…'),
]

const MALAY: Rule[] = [
  r('amerika\\s+syarikat', 'United States'), r('korea\\s+selatan', 'South Korea'), r('korea\\s+utara', 'North Korea'),
  r('arab\\s+saudi', 'Saudi Arabia'), r('jepun', 'Japan'), r('cina', 'China'), r('filipina', 'Philippines'),
  r('perancis', 'France'), r('jerman', 'Germany'), r('belanda', 'Netherlands'), r('itali', 'Italy'),
  r('sepanyol', 'Spain'), r('mesir', 'Egypt'), r('turki', 'Turkey'), r('kemboja', 'Cambodia'), r('kanada', 'Canada'),
  r('rumah\\s+putih', 'White House'),
]

/** Words that only look like a place in the three languages the reader took before round 6 */
const SPANISH: Rule[] = [mask('usa|irán|chile|maduros?')]
const PORTUGUESE: Rule[] = [mask('usa|irão|peru|maduros?')]

export const LOCAL_NAMES: Record<string, Rule[]> = {
  de: GERMAN, it: ITALIAN, ca: CATALAN, da: DANISH, kl: DANISH, nl: DUTCH, ro: ROMANIAN, sl: SLOVENE,
  sr: MONTENEGRIN, cnr: MONTENEGRIN, sq: ALBANIAN, ms: MALAY, es: SPANISH, pt: PORTUGUESE,
}

/** The text with its language's place names in English and its look-alike words blanked out, for finding its place */
export function withLocalNames(text: string, language: string | null | undefined): string {
  const rules = language ? LOCAL_NAMES[language.toLowerCase().split('-')[0]!] : undefined
  if (!rules || !text) return text
  let out = text
  for (const [pattern, as] of rules) out = out.replace(pattern, as)
  return out
}
