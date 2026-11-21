/**
 * Topic words in French, Spanish, Portuguese and German (Nov 10, 2026), beside categories.ts's English ones. Those
 * read English only, so a report in these languages kept its outlet's own topic, mostly "geopolitics" (the map's
 * "Politics"): a Colombian bombing, a Senegalese shipwreck and a Bundesliga match all sat under Politics, out of the
 * Conflict, Disaster and Sports filters. They also read some of these languages' words as English ones: a German
 * "war" ("was") and "Siege" ("victories") as conflict, a French "j'ai" as AI and its "inauguration" (of a school or a
 * road) as an election.
 *
 * Each language's words are filed under the English rules' topics and tried just before them, in their order
 * (sports first, culture last; "care", the hospital words, in headlines only), on a report in that language only
 * (its feed's). The English words still apply ("Champions League", "Hamas", "tsunami"), except the false friends.
 * Words are whole (an accented letter is a letter) and of any case, except "IA", "KI" and "AI" (a Portuguese "ia"
 * is "went"). Left out as too often something else: French "acteurs" (stakeholders), "traité" (treated), "bourse"
 * (a scholarship), "climat" ("climat politique"), "émissions" (programmes), "combat" ("le combat contre la
 * corruption"); Spanish "partido" (a match, and a party), "paro" (a strike, and unemployment), "INE" (Mexico's
 * electoral body, and other countries' statistics office), "actores armados"; Portuguese "combate" ("combate à
 * pobreza"), "investigadores" (the police's too); German "Spiel", "Tor", "Botschaft" (also a message), "Vertrag"
 * (a player's contract), "Steuer" ("am Steuer", at the wheel), "Sturm" (SK Sturm Graz).
 */

/** The English rules' topics, in their order (categories.ts) */
export type Slot =
  | 'sports' | 'science' | 'health' | 'disaster' | 'elections' | 'economy' | 'space' | 'technology' | 'climate'
  | 'cyber' | 'animal' | 'geopolitics' | 'conflict' | 'security' | 'care' | 'culture'

export interface LanguageRules {
  /** Each topic's words, tried just before the English ones, on the text as written */
  slots: Partial<Record<Slot, RegExp[]>>
  /** Words the English rules mistake, taken out before they read this language's text */
  falseFriends?: RegExp
}

const B = String.raw`(?<![\p{L}\p{N}])`
const E = String.raw`(?![\p{L}\p{N}])`
const AP = `['’]`
/** Whole words of any case ('iu': "É" is "é", and an accented letter is a letter) */
const words = (alts: string) => new RegExp(`${B}(?:${alts})${E}`, 'iu')
/** Whole words as written: "IA" is AI, "ia" a verb */
const asWritten = (alts: string) => new RegExp(`${B}(?:${alts})${E}`, 'u')
const unwords = (alts: string) => new RegExp(`${B}(?:${alts})${E}`, 'giu')

const fr: LanguageRules = {
  slots: {
    sports: [words(String.raw`foot(?:ball)?|navétanes|vs\.?\s.{1,60}(?:en\s+)?direct|ligue\s+[12]|ligue\s+des\s+champions|coupe\s+du\s+monde|coupe\s+d${AP}afrique|can\s+20\d\d|(?:le|au|du)\s+mondial(?!\s+de\s+l${AP}auto)|jeux\s+olympiques|jo\s+20\d\d|joj|olympiques?|mercato|sélectionneur|entraîneur|entraineur|buteurs?|matchs?|championnats?|tennis|rugby|cyclisme|basket(?:-?ball)?|handball|volley(?:-?ball)?|athlétisme|formule\s+1|lions\s+de\s+la\s+teranga|lions\s+indomptables|lions\s+de\s+l${AP}atlas|aigles\s+de\s+carthage|super\s+eagles|sport(?:s|ifs?|ives?)?`)],
    science: [words(String.raw`scientifiques|(?<!enseignants?-)chercheu(?:r|rs|se|ses)|selon\s+une\s+étude|une\s+(?:nouvelle\s+)?étude\s+(?:révèle|montre|suggère|publiée)|essais?\s+cliniques?|génome|archéolog(?:ue|ues|ie|ique|iques)|fossiles?|paléontolog\p{L}*`)],
    health: [words(String.raw`épidémies?|pandémies?|ebola|choléra|paludisme|vaccins?|vaccination|mpox|variole(?:\s+du\s+singe)?|dengue|sida|vih|rougeole|grippe(?:\s+aviaire)?|virus|maladies?|cancers?|santé\s+publique|oms|tuberculose|méningite|diabète|crise\s+sanitaire|alerte\s+sanitaire|urgence\s+sanitaire`)],
    disaster: [words(String.raw`séismes?|tremblements?\s+de\s+terre|ouragans?|cyclones?|typhons?|tornades?|inondations?|inondé(?:e|es|s)?|crues?|incendies?|feux\s+de\s+(?:forêt|brousse)|éruptions?\s+volcaniques?|volcans?|sécheresses?|glissements?\s+de\s+terrain|éboulements?|tempêtes?|intempéries|pluies\s+diluviennes|fortes\s+pluies|naufrages?|chavir(?:é|ée|és|ées|age|ement)|catastrophes?\s+naturelles?|accidents?|crash|déraillement|noyades?|explosions?\s+(?:dans|d${AP}une?)\s+(?:usine|mine|raffinerie|dépôt|entrepôt|citerne|camion-citerne)`)],
    elections: [words(String.raw`élections?|électora(?:l|le|les|ux)|électeurs?|électrices?|scrutins?|votes?|voter|(?<!(?:concours|recrutement)[^.]{0,60})candidat(?:e|s|es)?(?!\s+(?:au|aux|à\s+l${AP})\s*(?:bac|baccalauréat|bepc|cepe|concours|examens?|brevet))|candidatures?|référendum|(?:les|aux|des)\s+(?:législatives|municipales|sénatoriales|présidentielles)|(?:la|une)\s+présidentielle|bureaux?\s+de\s+vote|urnes|ceni|investiture`)],
    economy: [words(String.raw`économie|(?:crise|croissance|relance|reprise|situation|politique|conjoncture|récession|activité|forum|zones?|secteurs?|réformes?|performances?|indicateurs?|sanctions?)\s+économiques?|pib|banque\s+centrale|bceao|beac|banque\s+mondiale|fmi|taux\s+d${AP}intérêt|taux\s+directeurs?|chômage|dette\s+(?:publique|extérieure|intérieure|souveraine)|dettes?\s+de\s+l${AP}état|restructuration\s+de\s+(?:la\s+)?dette|exportations?|importations?|droits\s+de\s+douane|guerre\s+commerciale|accords?\s+commerciaux|accord\s+commercial|commerce\s+(?:extérieur|international|mondial)|prix\s+du\s+(?:carburant|pétrole|riz|pain|gaz|sucre)|cours\s+du\s+(?:pétrole|cacao|café|coton|brut)|carburants?|pétrole|pétroli(?:er|ère|ers|ères)|impôts?|réforme\s+fiscale|recettes\s+fiscales|franc\s+cfa|devises?|cryptomonnaies?|faillites?|cacao|anacarde|inflation|récession|bourse\s+de\s+\p{L}+|marchés\s+financiers`)],
    space: [words(String.raw`spatia(?:l|le|les|ux)|fusées?|astronautes?|satellites?`)],
    technology: [words(String.raw`intelligence\s+artificielle|chatgpt|semi-?conducteurs?|numérique|start-?ups?|internet|5g|télécommunications?|télécoms?`), asWritten('IA|AI')],
    climate: [words(String.raw`climatiques?|réchauffement|émissions\s+de\s+(?:gaz|co2|carbone|méthane)|gaz\s+à\s+effet\s+de\s+serre|carbone|cop\s?\d+|énergies?\s+renouvelables?|déforestation|biodiversité`)],
    cyber: [words(String.raw`cyberattaques?|cybercriminalité|cybercriminels?|cybersécurité|rançongiciels?|piratage\s+informatique|pirates?\s+informatiques?|hackers?`)],
    geopolitics: [words(String.raw`sommets?|traité\s+de\s+(?:paix|non-prolifération|libre-échange)|diplomat(?:e|es|ie|ique|iques)|ministres?\s+des\s+affaires\s+étrangères|ambassadeurs?|ambassadrices?|ambassades?|conseil\s+de\s+sécurité|bilatéra(?:l|le|les|ux)|multilatéra(?:l|le|les|ux|lisme)|pourparlers|visite\s+(?:officielle|d${AP}état|de\s+travail)|accords?\s+de\s+paix|processus\s+de\s+paix|négociations\s+de\s+paix|coopération`)],
    conflict: [words(String.raw`guerres?|(?<!général\s+d${AP})armées?|militaires?|soldats?|frappes|frappes?\s+(?:aériennes?|de\s+drones?|de\s+missiles?|israéliennes?|russes?|ukrainiennes?|américaines?)|bombardements?|bombardé(?:e|es|s)?|attaques?(?!\s+(?:de\s+|d${AP})(?:requins?|chiens?|ours|crocodiles?|serpents?|loups?|abeilles?|guêpes?|éléphants?|hippopotames?))|(?<!menaces?\s+d${AP})attentats?(?!\s+à\s+la\s+pudeur)|combats|affrontements?|rebelles?|jihadistes?|djihadistes?|missiles?|roquettes?|obus|drones?|offensive(?!\s+(?:de\s+charme|diplomatique|commerciale|de\s+conquête))|cessez-le-feu|trêve|otages|massacres?|tué(?:e|es|s)?|fusillades?|coups?\s+de\s+feu|tirs(?!\s+au\s+but)|groupes?\s+armés?|hommes\s+armés|insurgés|milices?|miliciens|m23|adf|jnim|eigs|boko\s+haram|shebabs?|chebabs?|wagner|africa\s+corps|kamikazes?`)],
    security: [words(String.raw`espionnage|espions?|espionnes?|assassinée?s?|assassinats?|féminicides?|menaces?\s+d${AP}attentats?|(?:fausses?\s+)?alertes?\s+à\s+la\s+bombe|services?\s+de\s+renseignements?|renseignement\s+(?:militaire|intérieur|extérieur|généraux)|terrorisme|terroristes?|antiterroris(?:me|tes?)|radicalisation|armes?\s+nucléaires?|essais?\s+nucléaires?`)],
    care: [words(String.raw`hôpita(?:l|ux)|hospitali(?:er|ère|ers|ères|sé|sée|sés|sées)|médecins?|patients?|infirmi(?:er|ère|ers|ères)|cliniques?|médicaments?|santé|centres?\s+de\s+santé|chu|maternités?|soins`)],
    culture: [words(String.raw`films?|cinéma|musique|musicien(?:ne)?s?|albums?|festivals?|concerts?|expositions?(?!\s+(?:à|aux|au)\s)|musées?|chanteu(?:r|rs|se|ses)|actrices?|romanci(?:er|ers|ère|ères)|théâtre(?!\s+(?:de|d${AP}|des|du))|artistes?|fespaco|masa|littérature|littéraires?|prix\s+goncourt|séries?\s+(?:télé|tv|télévisées?)|danse`)],
  },
  // "j'ai" (AI), "militants" (activists), "sanction" (a penalty), "inauguration" (of a school), "intelligence"
  // (wit; spies are "renseignement"), "anime" ("il anime": he hosts), "shooting" (a photo shoot), "les Lions"
  // (Senegal's footballers), a watchmaking or a literary "Grand Prix\"
  falseFriends: unwords(String.raw`ai|militants?|sanction|inauguration|intelligence|anime|shooting|lions|grand\s+prix\s+(?:d${AP}horlogerie|du\s+roman|de\s+(?:littérature|la\s+francophonie|poésie|l${AP}académie)|littéraire)`),
}

const es: LanguageRules = {
  slots: {
    sports: [words(String.raw`fútbol|futbol|liga\s+mx|laliga|primera\s+división|copa\s+(?:libertadores|sudamericana|del\s+rey|oro)|champions|(?:el|del|al)\s+mundial|mundial\s+(?:de\s+clubes|sub-?\d+|20\d\d)|juegos\s+olímpicos|olímpic(?:o|a|os|as)|olimpiadas?|jjoo|gol(?:es)?|golazo|entrenador(?:es|a)?|director\s+técnico|selección\s+(?:nacional|de\s+fútbol|argentina|mexicana|colombiana|chilena|peruana|uruguaya|paraguaya|venezolana|española|ecuatoriana|boliviana|cubana|hondureña|guatemalteca|salvadoreña|costarricense|panameña|dominicana|nicaragüense)|la\s+albiceleste|la\s+vinotinto|fichajes?|fichó|delanteros?|porteros?|arqueros?|tenis(?!\s+(?:de|para)\s+(?!mesa))|béisbol|beisbol|baloncesto|básquet(?:bol)?|boxeo|ciclismo|fórmula\s+1|partidos?\s+(?:de\s+fútbol|amistosos?)|deportes?|deportiv(?:o|a|os|as)|torneos?|campeonatos?|jugador(?:es|as)?|medallas?\s+de\s+(?:oro|plata|bronce)|atletismo`)],
    science: [words(String.raw`científic(?:o|a|os|as)|(?:un|según\s+un)\s+(?:nuevo\s+)?estudio|ensayos?\s+clínicos?|genoma|arqueólog(?:o|a|os|as)|arqueológic(?:o|a|os|as)|fósil(?:es)?|paleontólog\p{L}*`)],
    health: [words(String.raw`epidemias?|pandemias?|ébola|cólera|dengue|chikungunya|vacunas?|vacunación|sarampión|rabia\s+(?:humana|canina)|casos?\s+de\s+rabia|gripe(?:\s+aviar)?|influenza|virus|enfermedad(?:es)?|cáncer|salud\s+pública|oms|ops|minsa|brotes?\s+de\s+(?!violencia)\p{L}+|contagios?|vih|sida|tuberculosis|diabetes`)],
    disaster: [words(String.raw`terremotos?|sismos?|temblor(?:es)?|huracán|huracanes|ciclón|ciclones|tifón|tormentas?(?:\s+tropical(?:es)?)?|inundaci(?:ón|ones)|inundad(?:o|a|os|as)|lluvias\s+(?:torrenciales|intensas|fuertes)|fuertes\s+lluvias|incendios?(?:\s+forestal(?:es)?)?|erupci(?:ón|ones)|volcán|volcanes|sequías?|deslizamientos?(?:\s+de\s+tierra)?|derrumbes?|alud(?:es)?|desastres?\s+natural(?:es)?|naufragios?|accidentes?|volcadura|explosi(?:ón|ones)\s+(?:en|de)\s+(?:una?\s+)?(?:fábrica|planta|mina|refinería|pipa|polvorín|pirotecnia|gasoducto|ducto|depósito)|ahogad(?:o|a|os|as)|deslave|damnificados`)],
    elections: [words(String.raw`elecciones|elección|electoral(?:es)?|votación|votos?|votar|votantes|electores|(?<!concurso[^.]{0,60})candidat(?:o|a|os|as)|candidatura|referéndum|comicios|sufragio|balotaje|segunda\s+vuelta|primera\s+vuelta|las\s+primarias|cne|jne|tse|registraduría|urnas|escrutinio|jornada\s+electoral`)],
    economy: [words(String.raw`economía|(?:crisis|crecimiento|recuperación|reactivación|situación|política|desaceleración|recesión|actividad|foro|zonas?|sector(?:es)?|rescate|hundimiento|colapso|bloqueo|paquete|plan|modelo|reformas?|indicadores?|emergencia|sanciones)\s+económic(?:o|a|os|as)|inflación|pib|banco\s+central|banco\s+mundial|fmi|tasas?\s+de\s+interés|tipos?\s+de\s+interés|desempleo|bolsa\s+de\s+valores|deuda\s+(?:pública|externa|interna|soberana)|reestructuración\s+de\s+(?:la\s+)?deuda|exportaci(?:ón|ones)|importaci(?:ón|ones)|aranceles|guerra\s+comercial|acuerdos?\s+comercial(?:es)?|petróleo|petroler(?:o|a|os|as)|tipo\s+de\s+cambio|precio\s+del\s+dólar|devaluación|salario\s+mínimo|impuestos?|(?:la|una|reforma)\s+tributaria|remesas|canasta\s+básica|gasolina|combustibles?|t-?mec|tlc|recesión|quiebras?|criptomonedas?|comercio\s+(?:exterior|internacional)`)],
    space: [words(String.raw`espacial(?:es)?|cohetes?|satélites?|astronautas?`)],
    technology: [words(String.raw`inteligencia\s+artificial|chatgpt|semiconductores|tecnológic(?:o|a|os|as)|startups?|internet|5g|telecomunicaciones`), asWritten('IA|AI')],
    climate: [words(String.raw`cambio\s+climático|crisis\s+climática|emergencia\s+climática|calentamiento\s+global|climátic(?:o|a|os|as)|emisiones\s+de\s+(?:gases|co2|carbono|metano)|gases\s+de\s+efecto\s+invernadero|carbono|cop\s?\d+|energías?\s+renovables?|deforestación|biodiversidad`)],
    cyber: [words(String.raw`ciberataques?|ciberseguridad|ciberdelincuen\p{L}*|hackers?|hackeo|hackear(?:on)?|hackeó|hackead(?:o|a|os|as)`)],
    geopolitics: [words(String.raw`cumbres?|tratado\s+de\s+(?:paz|libre\s+comercio)|diplomátic(?:o|a|os|as)|diplomacia|canciller(?:es)?|cancillería|embajador(?:a|es|as)?|embajadas?|consejo\s+de\s+seguridad|bilateral(?:es)?|multilateral(?:es)?|visita\s+(?:oficial|de\s+estado)|acuerdo\s+de\s+paz|proceso\s+de\s+paz|diálogos?\s+de\s+paz|negociaci(?:ón|ones)\s+de\s+paz|relaciones\s+(?:diplomáticas|bilaterales|exteriores)`)],
    conflict: [words(String.raw`guerras?|ejércitos?|militar(?:es)?|soldados|bombardeos?|bombardead(?:o|a|os|as)|ataques?(?!\s+(?:cardíacos?|cardiacos?|al\s+corazón|de\s+(?:pánico|ansiedad|tiburón|tiburones|perros?|abejas|cocodrilos?)))|(?<!(?:amenazas?|alertas?)\s+de\s+(?:posibles?\s+)?)atentados?|combates|enfrentamientos?|rebeldes|guerrilla|guerrilleros?|disidencias|eln|farc|clan\s+del\s+golfo|misil(?:es)?|dron(?:es)?|drones|ofensiva|alto\s+el\s+fuego|cese\s+al\s+fuego|rehenes|masacres?|balaceras?|tiroteos?|disparos|sicarios?|explosivos?|(?<!amenazas?\s+de\s+)bombas?(?!\s+de\s+(?:agua|gasolina|calor|insulina))|(?:coche|carro|camión)\s+bomba|francotirador(?:es)?|grupos?\s+armados?|hombres\s+armados|paramilitares`)],
    security: [words(String.raw`espionaje|espías?|asesinad(?:o|a|os|as)|asesinatos?|feminicidios?|(?:falsas?\s+)?amenazas?\s+de\s+(?:bomba|atentado)|alertas?\s+de\s+(?:posibles?\s+)?atentado|servicios?\s+de\s+inteligencia|agencias?\s+de\s+inteligencia|inteligencia\s+militar|terrorismo|terroristas?|antiterroris(?:mo|ta|tas)|narcotráfico|narcotraficantes?|cártel(?:es)?|cartel(?:es)?\s+(?:de|del)\s+\p{L}+|crimen\s+organizado|armas?\s+nucleares?|ensayos?\s+nucleares?`)],
    care: [words(String.raw`hospital(?:es)?|hospitalari(?:o|a|os|as)|médic(?:o|a|os|as)|pacientes?|enfermer(?:o|a|os|as)|clínicas?|medicamentos?|salud|ips|eps|imss|issste|essalud`)],
    culture: [words(String.raw`películas?|cine|música|músic(?:o|a|os|as)|álbum(?:es)?|festival(?:es)?|conciertos?|exposici(?:ón|ones)(?!\s+(?:a|al)\s)|museos?|cantantes?|actriz|actores\s+de\s+(?:cine|teatro|televisión)|libros?|novelas?|telenovelas?|teatro|artistas?|series?\s+de\s+(?:tv|televisión)|premios?\s+(?:grammy|óscar|oscar|goya)|literatura|literari(?:o|a|os|as)|feria\s+del\s+libro|carnaval(?:es)?|reguetón|reggaetón|salsa|cumbia|bachata|vallenato|patrimonio\s+(?:cultural|de\s+la\s+humanidad)`)],
  },
  // a horror film's "terror" is no terrorism; "esa" (that) isn't the ESA, nor a "lunar" (a mole) the Moon's
  falseFriends: new RegExp(String.raw`(?<=(?:pel[ií]culas?|cine|filmes?|s[ée]ries?|g[ée]nero|novelas?|historias?|cuentos?)\s+de\s+)terror${E}|${B}(?:esa|lunar(?:es)?)${E}`, 'giu'),
}

const pt: LanguageRules = {
  slots: {
    sports: [words(String.raw`futebol|brasileirão|campeonato\s+(?:brasileiro|português|nacional|mundial|carioca|paulista|angolano|moçambicano)|liga\s+portugal|primeira\s+liga|girabola|moçambola|libertadores|champions|copa\s+do\s+(?:mundo|brasil)|taça\s+de\s+portugal|mundial\s+(?:de\s+clubes|20\d\d)|(?:o|no|do|ao)\s+mundial|jogos\s+olímpicos|olímpic(?:o|a|os|as)|golos?|gols?|treinador(?:es|a)?|seleção(?!\s+de\s+(?:candidatos|projetos|pessoal|propostas))|craques?|ténis|tênis|basquete(?:bol)?|andebol|handebol|vôlei|voleibol|atletismo|fórmula\s+1|ciclismo|benfica|sporting|fc\s+porto|flamengo|palmeiras|corinthians|fluminense|botafogo|grêmio|jogador(?:es|as)?|desporto|desportiv(?:o|a|os|as)|esportes?|esportiv(?:o|a|os|as)|medalhas?\s+de\s+(?:ouro|prata|bronze)|torneios?|campeão|campeões|campeã|campeonatos?`)],
    science: [words(String.raw`cientistas|pesquisadores|(?:um|segundo\s+um)\s+(?:novo\s+)?estudo|estudo\s+(?:revela|mostra|aponta|indica)|ensaios?\s+clínicos?|genoma|arqueólog(?:o|a|os|as)|arqueológic(?:o|a|os|as)|fósseis|fóssil|paleontólog\p{L}*`)],
    health: [words(String.raw`epidemias?|pandemias?|ébola|ebola|cólera|dengue|chikungunya|vacinas?|vacinação|sarampo|raiva\s+humana|casos?\s+de\s+raiva|gripe(?:\s+aviária)?|vírus|doenças?|cancro|câncer|saúde\s+pública|oms|surtos?\s+de\s+(?!violência)\p{L}+|malária|paludismo|tuberculose|hiv|sida|aids|diabetes|covid`)],
    disaster: [words(String.raw`sismos?|terramotos?|terremotos?|furacão|furacões|ciclones?|tufão|tempestades?(?:\s+tropica(?:l|is))?|inundações|inundação|inundad(?:o|a|os|as)|cheias|chuvas\s+(?:fortes|intensas|torrenciais)|fortes\s+chuvas|incêndios?(?:\s+florestais?)?|erupção|vulcão|vulcões|seca\s+(?:extrema|severa)|estiagem|deslizamentos?(?:\s+de\s+terra)?|desabamentos?|derrocadas?|desastres?\s+natura(?:l|is)|naufrágios?|acidentes?|atropelad(?:o|a|os|as)|atropelamentos?|afogad(?:o|a|os|as)|afogamentos?|capotamento|capotou|desalojados|desabrigados`)],
    elections: [words(String.raw`eleições|eleição|eleitora(?:l|is)|eleitores|votação|votos?|votar|(?<!concurso[^.]{0,60})candidat(?:o|a|os|as)(?!\s+(?:qualificados|aprovados|às?\s+vagas))|candidatura|referendo|pleito|segundo\s+turno|primeiro\s+turno|segunda\s+volta|primeira\s+volta|cne|tse|urnas|boletins?\s+de\s+voto|autárquicas|(?:as|às|nas)\s+legislativas|legislativas\s+(?:antecipadas|de\s+20\d\d)|presidenciais`)],
    economy: [words(String.raw`economia|(?:crise|crescimento|recuperação|situação|política|desaceleração|recessão|atividade|actividade|fórum|zonas?|setor(?:es)?|sector(?:es)?|pacote|plano|modelo|reformas?|indicadores?|emergência|sanções)\s+(?:económic|econômic)(?:o|a|os|as)|inflação|pib|banco\s+central|bna|banco\s+mundial|fmi|taxas?\s+de\s+juros?|selic|juros|desemprego|bolsa\s+de\s+valores|ibovespa|bovespa|dívida\s+(?:pública|externa|interna|soberana)|reestruturação\s+da\s+dívida|exportaç(?:ão|ões)|importaç(?:ão|ões)|tarifas|tarifaço|guerra\s+comercial|acordos?\s+comerciais|acordo\s+comercial|petróleo|petrolífer(?:o|a|os|as)|salário\s+mínimo|impostos?|kwanza|metical|meticais|câmbio|combustíve(?:l|is)|cesta\s+básica|recessão|falências?|criptomoedas?`)],
    space: [words(String.raw`espacia(?:l|is)|foguetes?|satélites?|astronautas?`)],
    technology: [words(String.raw`inteligência\s+artificial|chatgpt|semicondutores|tecnológic(?:o|a|os|as)|startups?|internet|5g|telecomunicações`), asWritten('IA|AI')],
    climate: [words(String.raw`alterações\s+climáticas|mudanças?\s+climáticas?|crise\s+climática|aquecimento\s+global|climátic(?:o|a|os|as)|emissões\s+de\s+(?:gases|co2|carbono|metano)|gases\s+(?:de|com)\s+efeito\s+(?:de\s+)?estufa|carbono|cop\s?\d+|energias?\s+renováve(?:l|is)|desmatamento|desflorestação|biodiversidade`)],
    cyber: [words(String.raw`ciberataques?|cibersegurança|hackers?|ataques?\s+informáticos?|ataques?\s+hacker`)],
    geopolitics: [words(String.raw`cimeiras?|cúpulas?|tratado\s+de\s+(?:paz|livre\s+comércio)|diplomátic(?:o|a|os|as)|diplomacia|chanceler|itamaraty|embaixador(?:a|es|as)?|embaixadas?|conselho\s+de\s+segurança|bilatera(?:l|is)|multilatera(?:l|is)|visita\s+(?:oficial|de\s+estado)|acordo\s+de\s+paz|processo\s+de\s+paz|negociações\s+de\s+paz|cplp`)],
    conflict: [words(String.raw`guerras?|exércitos?|militar(?:es)?|soldados|bombardeamentos?|bombardeios?|bombardead(?:o|a|os|as)|ataques?(?!\s+(?:cardíacos?|de\s+(?:pânico|ansiedade|tubarão|tubarões|cães|cão|abelhas|crocodilos?)|informáticos?|hacker))|(?<!ameaças?\s+de\s+)atentados?|combates|confrontos?|rebeldes|insurgentes|insurgência|jihadistas|mísseis|míssil|drones?|ofensiva|cessar-fogo|trégua|reféns|massacres?|tiroteios?|balead(?:o|a|os|as)|disparos|homens\s+armados|grupos?\s+armados?|milícias?|milicianos|al-?shabab|estado\s+islâmico|matam|mataram`)],
    security: [words(String.raw`espionagem|espiões|espião|assassinad(?:o|a|os|as)|assassinatos?|feminicídios?|ameaças?\s+de\s+(?:bomba|atentado)|serviços?\s+de\s+(?:inteligência|informações)|terrorismo|terroristas?|antiterroris(?:mo|ta|tas)|armas?\s+nucleares?|ensaios?\s+nucleares?|narcotráfico|crime\s+organizado`)],
    care: [words(String.raw`hospita(?:l|is)|hospitalar(?:es)?|médic(?:o|a|os|as)|pacientes|doentes|enfermeir(?:o|a|os|as)|clínicas?|medicamentos?|saúde|sns|sus|urgências|maternidades?`)],
    culture: [words(String.raw`filmes?|cinema|música|músic(?:o|a|os|as)|álbuns?|álbum|festiva(?:l|is)|concertos?|shows?|exposiç(?:ão|ões)(?!\s+(?:a|à|ao|aos|às)\s)|museus?|cantor(?:a|es|as)?|ator|atriz|livros?|romances?|teatro|artistas?|novelas?|carnaval|samba|fado|kizomba|semba|marrabenta|kuduro|literatura|literári(?:o|a|os|as)|património\s+(?:mundial|cultural)|patrimônio\s+(?:mundial|cultural)|bienal`)],
  },
  // a horror film's "terror"; "manga", the fruit; "tornado público" (made public)
  falseFriends: new RegExp(String.raw`(?<=(?:filmes?|s[ée]ries?|g[êé]nero|livros?|histórias?|contos?)\s+de\s+)terror${E}|${B}manga${E}|(?<=(?:foi|foram|ser|sido|será|seria|é|são|está|estão)\s+)tornad[oa]s?${E}`, 'giu'),
}

const de: LanguageRules = {
  slots: {
    sports: [words(String.raw`fu(?:ß|ss)ball\p{L}*|(?:bundes|regional|ober|landes|national)liga|super\s+league|challenge\s+league|champions\s+league|dfb|öfb|sfv|nationalmannschaft|nationalteam|nati|weltmeisterschaft|europameisterschaft|wm|em|olympische(?:n)?\s+spiele|olympia\p{L}*|olympisch\p{L}*|trainer(?:in)?|tennis|eishockey|handball|formel\s+1|skispringen|ski\s+alpin|weltcup|radsport|torhüter(?:in)?|torwart|stürmer(?:in)?|fc|bvb|hsv|rb\s+leipzig|eintracht\s+frankfurt|bayern\s+münchen|meisterschaft(?:en)?|weltmeister(?:in)?|europameister(?:in)?|olympiasieger(?:in)?|sport\p{L}*`)],
    science: [words(String.raw`wissenschaftler(?:in|innen)?|forscher(?:in|innen)?|forschende|studie|klinische(?:n)?\s+studien?|genom|archäolog\p{L}*|fossil(?:ien)?|paläontolog\p{L}*`)],
    health: [words(String.raw`epidemie|pandemie|ebola|cholera|impf\p{L}*|masern|grippe|virus|viren|krankheit(?:en)?|krebs\p{L}*|gesundheitswesen|who|weltgesundheitsorganisation|aids|hiv|diabetes|demenz|alzheimer|corona\p{L}*|covid`)],
    disaster: [words(String.raw`erdbeben|tsunami|hurrikan(?:e)?|zyklon|taifun|überschwemmung(?:en)?|hochwasser|waldbr(?:and|ände|änden)|(?<!russell\s)brand|brände|feuer|vulkanausbruch|vulkan|dürre|erdrutsch|murgang|murenabgang|unwetter|orkan|sturmflut|lawinen?\p{L}*|naturkatastrophe(?:n)?|unfall|unfälle|unfällen|verkehrsunfall|zugunglück|unglück|absturz|abgestürzt|entgleist|entgleisung|einsturz|eingestürzt|ertrunken`)],
    elections: [words(String.raw`wahl(?:en)?|wahlkampf\p{L}*|wahlergebnis(?:se)?|wahlbeteiligung|wahllokale?|wahlsieg(?:er|erin)?|wähler(?:innen)?|wählen|(?:landtags|bundestags|nationalrats|gemeinderats|kommunal|präsidentschafts|parlaments|europa|regional|stadtrats|kantonsrats|regierungsrats|ständerats|bürgermeister|stich|neu|ersatz)wahl(?:en)?|(?<!in\s)abstimmung(?:en)?|volksabstimmung(?:en)?|volksinitiative(?:n)?|referendum|kandidat(?:in|en|innen)?|kandidatur`)],
    economy: [words(String.raw`wirtschaft|wirtschafts(?:krise|wachstum|lage|leistung|politik|flaute|minister(?:in|ium)?|standort)|konjunktur\p{L}*|inflation|wachstum|bip|zentralbank|notenbank|nationalbank|snb|ezb|bundesbank|weltbank|iwf|leitzins(?:en)?|zinsen|zinssenkung|zinserhöhung|arbeitslos\p{L}*|börse(?:n)?|dax|smi|atx|staatsschulden|schuldenbremse|schuldenkrise|neuverschuldung|exporte?|importe?|zölle|zoll|handelskrieg|handelsabkommen|freihandelsabkommen|ölpreis(?:e)?|strompreis(?:e)?|energiepreise|gaspreis(?:e)?|steuererhöhung(?:en)?|steuersenkung(?:en)?|steuerreform|mehrwertsteuer|einkommensteuer|rezession|insolvenz(?:en)?|pleite|stellenabbau|jobabbau|kurzarbeit|mindestlohn|krypto\p{L}*`)],
    space: [words(String.raw`raumfahrt\p{L}*|raumstation|satellit(?:en)?|astronaut(?:in|en|innen)?|mondlandung|marsmission|raumsonde`)],
    technology: [words(String.raw`künstliche(?:n|r)?\s+intelligenz|chatgpt|halbleiter\p{L}*|digitalisierung|start-?ups?|internet|5g`), asWritten('KI|AI')],
    climate: [words(String.raw`klimawandel|klimaschutz\p{L}*|klimakrise|klimaziele?|klimapolitik|klimagipfel|klimakonferenz|klimaaktivist(?:en|in|innen)?|klimakleber|klimaneutral\p{L}*|klimaerwärmung|erderwärmung|emissionen|co2|treibhausgas\p{L}*|cop\s?\d+|erneuerbare(?:n)?\s+energien|energiewende|biodiversität|artenvielfalt|artensterben|gletscher\p{L}*`)],
    cyber: [words(String.raw`cyberangriff(?:e|en)?|cyberattacke(?:n)?|hackerangriff(?:e|en)?|hacker(?:in|innen)?|cyberkriminalität|datenleck`)],
    geopolitics: [words(String.raw`gipfel\p{L}*|friedensvertrag|diplomat(?:en|in|innen)?|diplomatie|diplomatisch\p{L}*|au(?:ß|ss)enminister(?:in|ium)?|botschafter(?:in)?|sicherheitsrat|bilateral\p{L}*|staatsbesuch|friedensgespräche|friedensverhandlungen|friedensplan|friedensprozess`)],
    conflict: [words(String.raw`krieg(?:e|es|en)?|kriegs\p{L}+|armee|militär\p{L}*|bundeswehr|bundesheer|soldat(?:en|in|innen)?|luftangriff(?:e|en)?|angriff(?:e|en)?|anschlag|anschläge|anschlägen|kämpfe|gefechte(?:n)?|rebellen|islamisten|dschihadisten|raketen\p{L}*|drohnen\p{L}*|offensive|waffenstillstand|waffenruhe|geiseln|massaker|getötet|tötete(?:n)?|erschossen|schüsse|schießerei|hisbollah|huthi(?:s)?|terrormiliz|is-miliz|bomben?|einmarsch`)],
    security: [words(String.raw`spionage|spion(?:e|in|innen)?|geheimdienst\p{L}*|nachrichtendienst\p{L}*|verfassungsschutz|terror\p{L}*|bombendrohung(?:en)?|anschlagsdrohung(?:en)?|atomwaffen\p{L}*|atomtests?|nuklearwaffen|extremist(?:en|in|innen)?|rechtsextrem\p{L}*|linksextrem\p{L}*|islamistisch\p{L}*`)],
    care: [words(String.raw`krankenhaus|krankenhäuser(?:n)?|spital|spitäler(?:n)?|klinik(?:en|um)?|ärzte(?:n)?|ärztin(?:nen)?|arzt|hausärzt\p{L}*|patient(?:en|in|innen)?|pflege\p{L}*|medikament(?:e|en)?|gesundheit\p{L}*|notaufnahme|krankenkasse(?:n)?`)],
    culture: [words(String.raw`film(?:e|en)?|kino\p{L}*|musik\p{L}*|album|alben|festival(?:s)?|konzert(?:e|en)?|ausstellung(?:en)?|museum|museen|sänger(?:in|innen)?|schauspieler(?:in|innen)?|buch|bücher(?:n)?|roman(?:e|en)?|theater|künstler(?:in|innen)?|oper(?:n|nhaus)?|literatur\p{L}*|fernsehserie|netflix|biennale|eurovision|esc`)],
  },
  // "war" (was), "Siege" (victories), "Shooting" (a photo shoot), "Hack" (minced meat)
  falseFriends: unwords('war|siege|shooting|hack'),
}

// Arabic and Russian (Nov 21, 2026): a football match, a TV series or an Apple assistant from a Yemeni, Egyptian or
// Kazakh outlet sat under the outlet's own "Politics". Only the plain topics (sports, culture, technology, science,
// health, space); no conflict or politics words, which the outlets' own topic already says. Arabic's one-letter
// prefixes (the "al-", "wa-", "bi-") are read before a word.
const AR = String.raw`(?:[وبلكف]?ال|[وبلكف])?`

const ar: LanguageRules = {
  slots: {
    sports: [words(`${AR}(?:كرة\\s+القدم|دوري\\s+(?:أبطال|الأبطال|المحترفين|الدرجة|روشن|نجوم|الخليج|السعودي|الإنجليزي|الإسباني|الإيطالي|الألماني|الفرنسي|المصري|الممتاز|المغربي|الأوروبي)|ليغا|كأس\\s+العالم|ركلات?\\s+(?:ال)?جزاء|مباراة(?!\\s+(?:التوظيف|ولوج))|مباريات|لاعب(?:ين|و)?|ريال\\s+مدريد|برشلونة|ليفربول|مانشستر|أرسنال|تشيلسي|يوفنتوس|رونالدو|ميسي|تنس|هدافين?)`)],
    science: [words(`${AR}(?:ثقب\\s+أسود|ثقوب\\s+سوداء|حفريات|حفرية|علماء\\s+(?:فلك|آثار|الفلك|الآثار))`)],
    health: [words(`${AR}(?:وباء|أوبئة|فيروس|فيروسات|لقاح|لقاحات|سرطان|كوليرا|حصبة|سكري)`)],
    space: [words(`${AR}(?:رائد\\s+فضاء|رواد\\s+الفضاء|ناسا|سبيس\\s+إكس)`)],
    technology: [words(`${AR}(?:ذكاء\\s+اصطناعي|ذكاء\\s+الاصطناعي|آبل|أبل|غوغل|جوجل|مايكروسوفت|شات\\s*جي\\s*بي\\s*تي|أشباه\\s+الموصلات|هواتف?\\s+الذكية|آيفون|ايفون|سامسونج|سامسونغ|إنفيديا|انفيديا|تسلا)`)],
    culture: [words(`${AR}(?:فيلم|أفلام|مسلسل|مسلسلات|فنان|فنانة|ألبوم|أغنية|أغاني|مغني|مغنية|سينما|متحف|الأوسكار|أوسكار|نتفليكس|مهرجان\\s+(?:ال)?(?:سينما|موسيقى|أفلام))`)],
  },
}

const ru: LanguageRules = {
  slots: {
    sports: [words(String.raw`футбол\p{L}*|хоккей\p{L}*|хоккеист\p{L}*|теннис\p{L}*|биатлон\p{L}*|чемпионат\p{L}*|матч\p{L}*|олимпийск\p{L}*|олимпиад\p{L}*|сборн(?:ая|ой|ую|ые|ых)|лига\s+чемпионов|тренер\p{L}*|спортсмен\p{L}*|Роналду|Месси`)],
    health: [words(String.raw`вирус\p{L}*|вакцин\p{L}*|эпидеми\p{L}*|пандеми\p{L}*|онколог\p{L}*|холер\p{L}*|корь|диабет\p{L}*`), asWritten('ВОЗ')],
    space: [words(String.raw`космос\p{L}*|космонавт\p{L}*|астронавт\p{L}*`), asWritten('НАСА')],
    technology: [words(String.raw`искусственн(?:ый|ого|ому|ым|ом)\s+интеллект\p{L}*|нейросет\p{L}*|смартфон\p{L}*|айфон\p{L}*|ChatGPT|чатбот\p{L}*|полупроводник\p{L}*|Apple|Google|Samsung|Nvidia`)],
    culture: [words(String.raw`фильм\p{L}*|сериал\p{L}*|кинотеатр\p{L}*|кинофестивал\p{L}*|певиц\p{L}*|певец|актёр\p{L}*|актер\p{L}*|актрис\p{L}*|концерт(?:а|е|у|ом|ы|ов|ах)?|альбом\p{L}*|музе(?:й|я|е|ев|ями)|выставк\p{L}*|театр(?!\s+(?:военных|боевых))\p{L}*|писател\p{L}*`)],
  },
}

// Ten more languages (Nov 21, 2026; Devon, 10:39 AM: "Proceed", with topic words for the languages that have none):
// 63% of the day's reports (30,198 of 47,941) were filed as Politics, the outlet's own topic when no word fits: a
// Murakami lecture in Kyoto counted as Politics in Kyoto. Chinese, Greek, Hindi, Ukrainian,
// Turkish, Indonesian, Korean, Italian, Tamil and Telugu, about a quarter of the reports: as for Arabic and Russian, the
// plain topics (sports, culture, technology, science, health, space), and disasters by their own words (earthquakes,
// floods, storms, landslides, eruptions); no politics, conflict or economy words, which the outlet's topic already
// says. Chinese is read without word boundaries (it has none); Korean, Tamil and Telugu from a word's start, as their
// endings and particles are written on ("축구는", "சென்னையில்"). Left out as too often something else: Chinese "比赛"
// (any contest) and "手机" (a phone scam is no technology story); Korean "경기" (a match, and the economy), "암" (cancer,
// one syllable), "배우" (an actor, and "to learn"); Italian "partita" (a match, and a political "game"), "influenza"
// (also influence), "mostra" (also "shows"); Greek "ΠΟΥ" (the WHO, and "that"); rockets everywhere (Gaza's and North
// Korea's are no space story); Turkish "aşırı" (excessive) beside "aşı" (vaccine), "çığlık" (a scream) beside "çığ"
// (avalanche); Ukrainian "театр бойових дій" (the theatre of war), "супутник" (also a companion), and fires, which in
// Ukraine are mostly from strikes; Telugu's "flood of lies" (అబద్ధాల వరద).
// Hand-checked on the day's headlines: of 100 changed, 83 right; with the war, market and crime guards and the fixes
// below, 89 of the next 100; of 100 that change a stored topic, 85 (the stored one was right for 10); of a fourth 100
// such, 91 to 93 (two were borderline), and 6 of the 9 doubtful are fixed (a marathon runner called a "scientist",
// house prices, a flood of lies, a research ship in the sea dispute, sanctions on athletes, an AI in a president's
// mouth). On the day: 776 of 13,064 headlines change.
const within = (alts: string) => new RegExp(`(?:${alts})`, 'u')
const starts = (alts: string) => new RegExp(`${B}(?:${alts})`, 'iu')
/** The words, unless the headline also says `guard`: a museum hit by a drone is the war's story, not culture's */
const unless = (guard: string, re: RegExp) => new RegExp(`^(?![\\s\\S]*(?:${guard}))[\\s\\S]*?(?:${re.source})`, re.flags)
/** Chinese: a chip, a rocket or a "tsunami" on the stock market is the market's story ("台股遭綠海嘯", "芯片ETF") */
const ZH_MARKET = String.raw`股|指数|指數|ETF|基金|大盘|大盤|涨停|漲停|跌停|公告|营收|營收|财报|財報|获利|獲利|EPS|\d{6}\.S[HZ]`
/** Greek: fires after an attack, a concert in a murder plot, are the war's and the crime's stories */
const EL_WAR = 'επίθεσ|πόλεμ|ρωσικ|drone|πύραυλ|βομβαρδ|δολοφον|εκτελ|συνελήφθ|σύλληψ|ένοπλ|τρομοκρατ'
/** Greek: a court case is the court's story, whatever the illness */
const EL_COURT = 'δικαστ|εδώλιο|στρατοδικ|δίκη'
/** Greek: a research ship in the Turkish-Libyan zone is the sea dispute's story */
const EL_SEA = 'Navtex|ΑΟΖ|τουρκολιβυκ|υφαλοκρηπ'
/** Italian: an AI in a president's mouth is politics */
const IT_POLITICS = String.raw`Trump|Putin|Xi\s+Jinping|Teheran|Pechino|Cremlino|Casa\s+Bianca|dazi`
/** Turkish: an earthquake on the stock market, a singer's murder */
const TR_MARKET = 'borsa|bitcoin|kripto|dolar|piyasa|hisse'
const TR_CRIME = 'cinayet|öldür|tutukla|gözaltı|saldırı'
/** Hindi: a fight at a cricket match is the police's story */
const HI_CRIME = 'FIR|मारपीट|हत्या|गिरफ्तार'

const zh: LanguageRules = {
  slots: {
    sports: [within('足球|篮球|籃球|网球|網球|排球|乒乓|羽毛球|奥运|奧運|冬奥|冬奧|世界杯|世界盃|欧冠|歐冠|英超|西甲|意甲|德甲|中超|NBA|联赛|聯賽|进球|進球|球员(?!兼裁判)|球員(?!兼裁判)|国足|國足|马拉松|馬拉松|F1(?![0-9])|大满贯|大滿貫|桌球')],
    science: [within('科学家|科學家|研究人员|研究人員|研究团队|研究團隊|考古|黑洞')],
    health: [within('疫苗|病毒|疫情|流感|癌症|糖尿病|登革热|登革熱|麻疹|结核|結核|艾滋|愛滋|世卫|世衛')],
    disaster: [unless(ZH_MARKET, within('地震|洪水|洪灾|洪災|(?<![一两兩几幾每])台风|颱風|暴雨|山火|森林火灾|森林火災|泥石流|土石流|山体滑坡|山崩|火山喷发|火山爆發|火山噴發|雪崩|龙卷风|龍捲風'))],
    space: [unless(ZH_MARKET, within('航天|航太|太空|宇航员|宇航員|航天员|航天員|太空人|空间站|太空站|卫星发射|衛星發射|探月|嫦娥|神舟|火箭(?!弹|彈|军|軍|炮)'))],
    technology: [unless(ZH_MARKET, within('人工智能|人工智慧|芯片|晶片|半导体|半導體|智能手机|智慧型手機|ChatGPT|大模型|机器人|機器人'))],
    culture: [unless('投票|选举|選舉|罢免|罷免|公投|大选|大選|立委|议员|議員', within('电影|電影|电视剧|電視劇|影视|影視|演唱会|演唱會|歌手|专辑|專輯|博物馆|博物館|展览|展覽|票房|艺人|藝人|演员|演員|导演|導演|综艺|綜藝|小说|小說|作家|音乐|音樂|话剧|話劇|金马|金馬'))],
  },
}

const el: LanguageRules = {
  slots: {
    sports: [words(String.raw`ποδ[οό]σφαιρ\p{L}*|μπ[αά]σκετ|τ[εέ]νις|ολυμπιακ(?:ός|ού|όν|ος|ου|ον|οί\s+αγ[ωώ]νες|ών\s+αγ[ωώ]νων)|ολυμπιακ[οό](?!\s+(?:ιππικ|κ[εέ]ντρ|στ[αά]δι|ακ[ιί]νητ))|παναθηνα[ιϊ]κ\p{L}*|ΠΑΟΚ|ΑΕΚ|champions\s+league|euroleague|μουντι[αά]λ|προπονητ\p{L}*|γκολ|πρωτ[αά]θλημα|superleague|βόλεϊ|βολε[ιϊ]|μαραθ[ωώ]νι\p{L}*`)],
    science: [unless(EL_SEA, words(String.raw`επιστ[ηή]μον\p{L}*|ερευνητ\p{L}*|απολ[ιί]θωμα\p{L}*|αρχαιολ[οό]γ\p{L}*`))],
    health: [unless(EL_COURT, words(String.raw`εμβ[οό]λι\p{L}*|καρκ[ιί]ν\p{L}*|πανδημ[ιί]\p{L}*|επιδημ[ιί]\p{L}*|γρ[ιί]πη\p{L}*|διαβ[ηή]τη\p{L}*|ιλαρ[αά]`))],
    disaster: [unless(EL_WAR, words(String.raw`σεισμ(?:ός|ού|ό|οί|ών|ούς|ος|ου|ο|οι|ων|ους)|σεισμικ(?:ή|η)\s+δ[οό]νηση|πλημμ[υύ]ρ\p{L}*|πυρκαγι\p{L}*|κακοκαιρ[ιί]\p{L}*|κατολ[ιί]σθη\p{L}*|ηφαιστει\p{L}*|ηφαίστει\p{L}*|τσουν[αά]μι|χιονοθ[υύ]ελλ\p{L}*`))],
    space: [words(String.raw`διαστημ\p{L}*|αστροναύτ\p{L}*|αστροναυτ\p{L}*|NASA|spacex`)],
    technology: [words(String.raw`τεχνητ[ηή]ς?\s+νοημοσ[υύ]νη\p{L}*|chatgpt|ημιαγωγ\p{L}*|smartphone`)],
    culture: [unless(EL_WAR, words(String.raw`ταιν[ιί]\p{L}*|σινεμ[αά]|κινηματογρ[αά]φ(?:ος|ου|ο)|ηθοποι[οό]\p{L}*|τραγουδ\p{L}*|συναυλ[ιί]\p{L}*|[αά]λμπουμ|μουσε[ιί]\p{L}*|θ[εέ]ατρ\p{L}*|netflix|eurovision|γιουροβίζιον`))],
  },
}

const hi: LanguageRules = {
  slots: {
    sports: [unless(HI_CRIME, starts('क्रिकेट|फुटबॉल|फ़ुटबॉल|हॉकी|टेनिस|बैडमिंटन|ओलंपिक|विश्व कप|वर्ल्ड कप|आईपीएल|टेस्ट मैच|वनडे|टी20|बल्लेबाज|गेंदबाज|कबड्डी|पहलवान|कुश्ती|खिलाड़ी')), unless(HI_CRIME, words('IPL|ODI|IND\\s+vs'))],
    science: [starts('वैज्ञानिक|शोधकर्ता|वैज्ञानिकों')],
    health: [starts('वैक्सीन|वायरस|कैंसर|डेंगू|मलेरिया|डायबिटीज|मधुमेह|महामारी|टीबी|खसरा')],
    disaster: [starts('भूकंप|(?<!की\\s)बाढ़|चक्रवात|भूस्खलन|बादल फट|सुनामी|ज्वालामुखी|भीषण आग|आंधी-तूफान')],
    space: [starts('इसरो|अंतरिक्ष|उपग्रह|सैटेलाइट|चंद्रयान|गगनयान|नासा')],
    technology: [starts('आर्टिफिशियल इंटेलिजेंस|एआई|स्मार्टफोन|सेमीकंडक्टर|चैटजीपीटी'), asWritten('AI')],
    culture: [starts('फिल्म|फ़िल्म|बॉलीवुड|अभिनेता|अभिनेत्री|गायक|गायिका|बॉक्स ऑफिस|वेब सीरीज|संग्रहालय|एक्टर|एक्ट्रेस|सिंगर')],
  },
}

/** Ukrainian: the war's words; with them, a museum, a film studio or an AI is the war's story */
const UK_WAR = String.raw`атак|обстріл|удар(?:и|ів|ом|ами)?(?![\p{L}])|дрон|ракет|знищ|окупант|ЗСУ|фронт|війн|бомб|вибух|зґвалт|вбив|убив|арешт`
/** Korean: an AI or a chip in politics or the stock market is their story */
const KO_NOT_TECH = '트럼프|푸틴|시진핑|의회|국회|증시|주가|코스피|코스닥|나스닥|물가|특구|도시공사|집값|부동산|아파트'

const uk: LanguageRules = {
  slots: {
    sports: [unless('санкці', words(String.raw`футбол\p{L}*|хокей\p{L}*|теніс\p{L}*|біатлон\p{L}*|чемпіонат\p{L}*|матч\p{L}*|олімпійськ\p{L}*|олімпіад\p{L}*|збірн(?:а|ої|у|ій)|ліга\s+чемпіонів|тренер\p{L}*|спортсмен\p{L}*|боксер\p{L}*|Усик\p{L}*|Ломаченк\p{L}*`))],
    science: [unless(UK_WAR, words(String.raw`науковц\p{L}*|вчені|дослідник\p{L}*|археолог\p{L}*|палеонтолог\p{L}*`))],
    health: [words(String.raw`вірус\p{L}*|вакцин\p{L}*|епідемі\p{L}*|пандемі\p{L}*|онколог\p{L}*|грип\p{L}*|діабет\p{L}*`), asWritten('ВООЗ')],
    disaster: [words(String.raw`землетрус\p{L}*|повін\p{L}*|повен\p{L}*|ураган\p{L}*|буревій\p{L}*|зсув\p{L}*\s+ґрунту|сніговій\p{L}*`)],
    space: [unless(String.raw`${UK_WAR}|навіть\s+з\s+космосу`, words(String.raw`космос\p{L}*|космічн\p{L}*|астронавт\p{L}*|космонавт\p{L}*`)), unless(UK_WAR, asWritten('NASA|НАСА'))],
    technology: [unless(UK_WAR, words(String.raw`штучн(?:ий|ого|ому|им|ім)\s+інтелект\p{L}*|смартфон\p{L}*|чатбот\p{L}*|ChatGPT|напівпровідник\p{L}*`)), unless(UK_WAR, asWritten('ШІ'))],
    culture: [unless(UK_WAR, words(String.raw`фільм\p{L}*|серіал\p{L}*|кінофестивал\p{L}*|співак\p{L}*|співачк\p{L}*|актор\p{L}*|акторк\p{L}*|концерт\p{L}*|альбом\p{L}*|музе(?:й|ю|ї|їв|ях)|виставк\p{L}*|театр(?!\s+(?:бойових|воєнних))\p{L}*|письменни\p{L}*|Євробачен\p{L}*`))],
  },
}

const tr: LanguageRules = {
  slots: {
    sports: [words(String.raw`futbol\p{L}*|basketbol\p{L}*|voleybol\p{L}*|tenis\p{L}*|olimpiyat\p{L}*|dünya\s+kupası\p{L}*|süper\s+lig\p{L}*|şampiyonlar\s+ligi\p{L}*|teknik\s+direktör\p{L}*|maç(?:ı|ta|tan|a|ın|lar\p{L}*|ında)?|gol(?:ü|cü\p{L}*|ler\p{L}*|leri)?|galatasaray\p{L}*|fenerbahçe\p{L}*|trabzonspor\p{L}*|milli\s+takım\p{L}*`)],
    science: [words(String.raw`bilim\s+insan\p{L}*|bilim\s+adam\p{L}*|araştırmacı\p{L}*|fosil\p{L}*|arkeolog\p{L}*`)],
    health: [words(String.raw`aşı(?:sı|lar\p{L}*|lama\p{L}*|nın|yı)?|virüs\p{L}*|kanser\p{L}*|salgın\p{L}*|grip\p{L}*|diyabet\p{L}*|kızamık\p{L}*`), asWritten('DSÖ')],
    disaster: [unless(TR_MARKET, words(String.raw`deprem\p{L}*|sel(?:de|den|e|i|in|ler\p{L}*|felaket\p{L}*)|orman\s+yangın\p{L}*|heyelan\p{L}*|kasırga\p{L}*|fırtına\p{L}*|tsunami\p{L}*|yanardağ\p{L}*`))],
    space: [words(String.raw`uzay\p{L}*|astronot\p{L}*|uydu\p{L}*|NASA|SpaceX`)],
    technology: [words(String.raw`yapay\s+zeka\p{L}*|yapay\s+zekâ\p{L}*|akıllı\s+telefon\p{L}*|yarı\s+iletken\p{L}*|chatgpt`)],
    culture: [unless(TR_CRIME, words(String.raw`film\p{L}*|dizi(?:si|de|nin|ler\p{L}*|nde)?|sinema\p{L}*|konser\p{L}*|albüm\p{L}*|şarkı\p{L}*|müze\p{L}*|sergi\p{L}*|festival\p{L}*|tiyatro\p{L}*|roman(?:ı|ları|cı\p{L}*)|netflix`))],
  },
}

const id: LanguageRules = {
  slots: {
    sports: [words(String.raw`sepak\s?bola|liga\s+1|timnas|bulu\s+tangkis|badminton|motogp|piala\s+(?:dunia|asia|aff)|pelatih|persib|persija|futsal|voli`)],
    science: [words(String.raw`ilmuwan|peneliti|fosil|arkeolog\p{L}*`)],
    health: [words(String.raw`vaksin\p{L}*|virus|kanker|demam\s+berdarah|dbd|diabetes|tbc|wabah|campak`)],
    disaster: [words(String.raw`gempa(?:\s+bumi)?|banjir|tanah\s+longsor|longsor|erupsi|gunung\s+(?:meletus|api)|kebakaran\s+hutan|puting\s+beliung|tsunami|angin\s+kencang`)],
    space: [words(String.raw`antariksa|astronot|satelit|nasa`)],
    technology: [words(String.raw`kecerdasan\s+buatan|semikonduktor|chatgpt|ponsel\s+pintar`), asWritten('AI')],
    culture: [words(String.raw`film|sinetron|konser|musisi|penyanyi|album|aktor|aktris|museum|pameran|festival|drakor|drama\s+korea|netflix`)],
  },
}

const ko: LanguageRules = {
  slots: {
    sports: [starts('축구|야구|농구|배구|골프|올림픽|월드컵|프로야구|K리그|손흥민|이강인|김하성|오타니|챔피언스리그|프리미어리그|홈런|국가대표팀')],
    science: [starts('과학자|연구진|연구팀|화석|고고학')],
    health: [unless('토마토|작물|농작물|농가', starts('백신|바이러스|독감|감염병|당뇨|홍역|결핵'))],
    disaster: [starts('지진|태풍|홍수|산불|폭우|산사태|화산|쓰나미|폭설')],
    space: [starts('우주|위성|누리호|다누리|우주인')],
    technology: [unless(KO_NOT_TECH, starts('인공지능|반도체|스마트폰|챗GPT|챗봇')), unless(KO_NOT_TECH, asWritten('AI'))],
    culture: [starts('영화|드라마|가수|콘서트|앨범|박물관|전시회|뮤지컬|아이돌|K팝|케이팝|넷플릭스|BTS|블랙핑크')],
  },
}

const it: LanguageRules = {
  slots: {
    sports: [words(String.raw`calcio|serie\s+[ab]|champions(?:\s+league)?|europa\s+league|conference\s+league|mondiali|olimpiadi|olimpic\p{L}*|tennis|sinner|formula\s+1|f1|motogp|allenatore|gol|scudetto|juventus|juve|nerazzurri|rossoneri|bianconeri|giallorossi|azzurri|pallavolo|basket|ciclismo|giro\s+d${AP}italia`)],
    science: [words(String.raw`scienziat\p{L}*|ricercator\p{L}*|fossil\p{L}*|archeolog\p{L}*`)],
    health: [words(String.raw`vaccin\p{L}*|virus|tumor[ei]|cancro|epidemia|pandemia|diabete|morbillo|oms`)],
    disaster: [words(String.raw`terremot[oi]|sisma|scossa\s+di\s+terremoto|alluvion[ei]|fran[ae]|esondazion\p{L}*|maltempo|nubifragi[oi]|tromba\s+d${AP}aria|eruzion[ei]|valangh?[ae]`)],
    space: [words(String.raw`spazial[ei]|astronaut\p{L}*|satellit\p{L}*|nasa`)],
    technology: [unless(IT_POLITICS, words(String.raw`intelligenza\s+artificiale|chatgpt|semicondutt\p{L}*|smartphone`)), unless(IT_POLITICS, asWritten('IA|AI'))],
    culture: [words(String.raw`film|cinema|attor[ei]|attric[ei]|cantant[ei]|album|concert[oi]|festival|sanremo|muse[oi]|teatro|romanzo|serie\s+tv|netflix|oscar`)],
  },
}

const ta: LanguageRules = {
  slots: {
    sports: [starts('கிரிக்கெட்|கால்பந்து|ஒலிம்பிக்|டென்னிஸ்|ஹாக்கி|கபடி|உலகக் கோப்பை|ஐபிஎல்|பேட்ஸ்மேன்|பவுலர்'), words('IPL|IND\\s+vs')],
    science: [starts('விஞ்ஞானிகள்|ஆராய்ச்சியாளர்கள்')],
    health: [starts('தடுப்பூசி|வைரஸ்|புற்றுநோய்|டெங்கு|நீரிழிவு')],
    disaster: [starts('நிலநடுக்கம்|வெள்ளம்|வெள்ளத்|புயல்|நிலச்சரிவு|கனமழை|சுனாமி')],
    space: [starts('இஸ்ரோ|விண்வெளி|செயற்கைக்கோள்')],
    technology: [starts('செயற்கை நுண்ணறிவு|ஸ்மார்ட்போன்'), asWritten('AI')],
    culture: [starts('திரைப்பட|சினிமா|நடிகர்|நடிகை|பாடகர்|இசையமைப்பாளர்|பாக்ஸ் ஆபிஸ்')],
  },
}

const te: LanguageRules = {
  slots: {
    sports: [starts('క్రికెట్|ఫుట్‌బాల్|ఫుట్బాల్|ఒలింపిక్|టెన్నిస్|హాకీ|కబడ్డీ|సెంచరీ|ఐపీఎల్|ప్రపంచ కప్|బ్యాటర్|బౌలర్'), words('IPL|IND\\s+vs')],
    science: [starts('శాస్త్రవేత్త')],
    health: [starts('వ్యాక్సిన్|వైరస్|క్యాన్సర్|డెంగ్యూ|మధుమేహ')],
    disaster: [starts('భూకంప|(?<!(?:అబద్ధాల|హామీల|విమర్శల)\\s)వరద|తుపాను|తుఫాన్|కొండచరియలు|భారీ వర్ష')],
    space: [starts('ఇస్రో|అంతరిక్ష|ఉపగ్రహ')],
    technology: [starts('కృత్రిమ మేధ|స్మార్ట్‌ఫోన్|స్మార్ట్ ఫోన్'), asWritten('AI')],
    culture: [starts('సినిమా|నటుడు|బాక్సాఫీస్|టాలీవుడ్|బాలీవుడ్|సంగీత దర్శకు|హీరోయిన్')],
  },
}

export const CATEGORY_LANGUAGES: Readonly<Record<string, LanguageRules>> = { fr, es, pt, de, ar, ru, zh, el, hi, uk, tr, id, ko, it, ta, te }

/** A language's own topic words, or null for English and the languages without them */
export function languageRules(lang: string | null | undefined): LanguageRules | null {
  return (lang && CATEGORY_LANGUAGES[lang]) || null
}
