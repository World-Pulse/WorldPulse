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

export const CATEGORY_LANGUAGES: Readonly<Record<string, LanguageRules>> = { fr, es, pt, de }

/** A language's own topic words, or null for English and the languages without them */
export function languageRules(lang: string | null | undefined): LanguageRules | null {
  return (lang && CATEGORY_LANGUAGES[lang]) || null
}
