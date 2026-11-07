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
    ['Kairo', 'Cairo'], ['Algier', 'Algiers'], ['Teheran', 'Tehran'], ['Bagdad', 'Baghdad'], ['Dschidda', 'Jeddah'],
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
    ['Zurigo', 'Zurich'], ['Monaco\\s+di\\s+Baviera', 'Munich'], ['Torino', 'Turin'], ['Venezia', 'Venice'], ['Firenze', 'Florence'],
    ['Napoli', 'Naples'], ['Genova', 'Genoa'], ['Siviglia', 'Seville'], ['Barcellona', 'Barcelona'],
    ['Città\\s+del\\s+Messico', 'Mexico City'], ["L['’]Avana", 'Havana'], ['Filadelfia', 'Philadelphia'], ['Cisgiordania', 'West Bank'],
    ['Bassora', 'Basra'], ['Sebastopoli', 'Sevastopol'], ['Nuova\\s+Delhi', 'New Delhi'], ['Hormuz|Ormuz', 'Hormuz'],
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
  r(`${AL}اردن${PEOPLE}`, 'Jordanian'), r(`${AL}اربد`, 'Irbid'), r(`${AL_ONLY}عقب[ةه]`, 'Aqaba'),
  r(`${AL}سوري(?:ا|[ةه]|ون|ين)?`, 'Syria'), r(`${AL}دمشق`, 'Damascus'), r(`${AL}حلب`, 'Aleppo'), r(`${AL}حمص`, 'Homs'),
  r(`${AL}ادلب`, 'Idlib'), r(`${AL_ONLY}لاذقي[ةه]`, 'Latakia'), r(`${AL}درعا`, 'Daraa'), r(`${AL_ONLY}حسك[ةه]`, 'Hasakah'),
  r(`${AL}دير\\s+الزور`, 'Deir ez-Zor'), r(`${AL_ONLY}سويداء`, 'Suwayda'), r(`${AL}طرطوس`, 'Tartus'),
  r(`${AL}بحرين${PEOPLE}`, 'Bahrain'), r(`${AL_ONLY}منام[ةه]`, 'Manama'), r(`${AL_ONLY}محرق`, 'Muharraq'), r(`${AL_ONLY}رفاع`, 'Riffa'),
  r(`${AL}عراق${PEOPLE}`, 'Iraq'), r(`${AL}بغداد`, 'Baghdad'), r(`${AL_ONLY}بصر[ةه]`, 'Basra'), r(`${AL_ONLY}موصل`, 'Mosul'),
  r(`${AL}اربيل`, 'Erbil'), r(`${AL}لبنان${PEOPLE}`, 'Lebanon'), r(`${AL}بيروت`, 'Beirut'), r(`${AL}مصر${PEOPLE}`, 'Egypt'),
  r(`${AL_ONLY}قاهر[ةه]`, 'Cairo'), r(`${AL}سعودي[ةه]?`, 'Saudi Arabia'), r(`${AL}مك[ةه]\\s+المكرم[ةه]|${AL}مك[ةه]`, 'Makkah'),
  r(`${AL}فلسطين${PEOPLE}`, 'Palestine'), r(`${AL}غز[ةه]`, 'Gaza'), r(`${AL_ONLY}ضف[ةه]\\s+(?:ال)?غربي[ةه]`, 'West Bank'),
  r(`${AL_ONLY}قدس`, 'Jerusalem'), r(`${AL}رام\\s+الله`, 'Ramallah'), r(`${AL}اسرائيل${PEOPLE}`, 'Israel'),
  r(`${AL}ايران${PEOPLE}`, 'Iran'), r(`${AL}طهران`, 'Tehran'), r(`${AL}تركيا|${AL}تركي[ةه]`, 'Turkey'), r(`${AL}انقر[ةه]`, 'Ankara'),
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
    ['Ormuz', 'Hormuz'],
    // Mexico City's Colonia Roma is a neighbourhood, not Rome
    ['(?<![Cc]olonia\\s|[Cc]ol\\.\\s)Roma(?![\\s-]+(?:Norte|Sur))', 'Rome'],
  ]),
]
const PORTUGUESE: Rule[] = [
  mask('usa|irão|peru|maduros?'),
  ...towns([
    ['Londres', 'London'], ['Moscovo|Moscou', 'Moscow'], ['Bruxelas', 'Brussels'], ['Pequim', 'Beijing'], ['Argel', 'Algiers'],
    ['Varsóvia|Varsovia', 'Warsaw'], ['Viena', 'Vienna'], ['Atenas', 'Athens'], ['Beirute', 'Beirut'], ['Teerão|Teerã|Teerao', 'Tehran'],
    ['Cabul', 'Kabul'], ['Bagdade|Bagdá', 'Baghdad'], ['Jidá', 'Jeddah'], ['Cidade\\s+do\\s+Cabo', 'Cape Town'],
    ['Copenhaga|Copenhague', 'Copenhagen'], ['Haia', 'The Hague'], ['Lisboa', 'Lisbon'], ['Edimburgo', 'Edinburgh'], ['Seul', 'Seoul'],
    ['Tóquio', 'Tokyo'], ['Nova\\s+(?:Iorque|York)', 'New York'], ['Berlim', 'Berlin'], ['Roma', 'Rome'], ['Genebra', 'Geneva'],
    ['Praga', 'Prague'], ['Budapeste', 'Budapest'], ['Bucareste', 'Bucharest'], ['Belgrado', 'Belgrade'], ['Ancara', 'Ankara'],
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
  ]),
]
/** French: no list until Nov 6, 2026, so Le Monde's "à Londres", "Moscou" or "Bruxelles" named no place */
const FRENCH: Rule[] = towns([
  ['Londres', 'London'], ['Moscou', 'Moscow'], ['Bruxelles', 'Brussels'], ['Pékin|Pekin', 'Beijing'], ['Caire', 'Cairo'], ['Alger', 'Algiers'],
  ['Varsovie', 'Warsaw'], ['(?<![Ll]a\\s|Haute-)Vienne(?!\\s+\\((?:Is[èe]re)\\))', 'Vienna'], ['Athènes|Athenes', 'Athens'],
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
])

export const LOCAL_NAMES: Record<string, Rule[]> = {
  de: GERMAN, it: ITALIAN, ca: CATALAN, da: DANISH, kl: DANISH, nl: DUTCH, ro: ROMANIAN, sl: SLOVENE,
  sr: MONTENEGRIN, cnr: MONTENEGRIN, sq: ALBANIAN, ms: MALAY, es: SPANISH, pt: PORTUGUESE, lt: LITHUANIAN,
  ar: ARABIC, ru: RUSSIAN, mn: MONGOLIAN, fr: FRENCH,
}

/** The text with its language's place names in English and its look-alike words blanked out, for finding its place */
export function withLocalNames(text: string, language: string | null | undefined): string {
  const rules = language ? LOCAL_NAMES[language.toLowerCase().split('-')[0]!] : undefined
  if (!rules || !text) return text
  let out = rules === ARABIC ? arabicPlain(text) : text
  for (const [pattern, as] of rules) out = out.replace(pattern, as)
  return out
}
