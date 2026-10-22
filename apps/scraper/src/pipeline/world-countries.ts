/**
 * The countries geo.ts didn't know: the words that name each one, and its
 * capital (where a country-level story is pinned). geo.ts started with 34
 * countries, so a story "in Panama", "Vanuatu" or "Slovenia" named no country
 * at all, and an RSS story fell back to its outlet's home: on Oct 11, 2026 the
 * GDACS alerts for the Panama earthquakes were pinned to Ispra, Italy (GDACS's
 * office), and "Traumatised Panamanians begin recovery" to Singapore.
 *
 * Patterns are whole words, case-insensitive. Words that are also common
 * names or other places are left out or narrowed: "Georgia" (the US state),
 * "Jordan" and "Chad" (first names; "in Chad" only when no surname follows,
 * so "in Chad Daybell's trial" is not the country), "Guinea pig", "Benin City" and the
 * "Niger Delta" (both in Nigeria), "Polish", "Spanish" and "Portuguese"
 * (also languages or verbs), "Houthi" (their attacks are often elsewhere).
 */

export interface CountryEntry {
  /** ISO 3166-1 alpha-2 */
  code: string
  name: string
  pattern: RegExp
  capital: string
  lat: number
  lng: number
}

const c = (code: string, name: string, pattern: RegExp, capital: string, lat: number, lng: number): CountryEntry =>
  ({ code, name, pattern, capital, lat, lng })

export const MORE_COUNTRIES: CountryEntry[] = [
  // Europe
  c('AL', 'Albania', /\b(?:albania|albanian)\b/i, 'Tirana', 41.33, 19.82),
  c('AD', 'Andorra', /\bandorra\b/i, 'Andorra la Vella', 42.51, 1.52),
  c('AT', 'Austria', /\b(?:austria|austrian)\b/i, 'Vienna', 48.21, 16.37),
  c('BY', 'Belarus', /\b(?:belarus|belarusian)\b/i, 'Minsk', 53.90, 27.57),
  c('BE', 'Belgium', /\b(?:belgium|belgian)\b/i, 'Brussels', 50.85, 4.35),
  c('BA', 'Bosnia and Herzegovina', /\b(?:bosnia|bosnian|herzegovina)\b/i, 'Sarajevo', 43.86, 18.41),
  c('BG', 'Bulgaria', /\b(?:bulgaria|bulgarian)\b/i, 'Sofia', 42.70, 23.32),
  c('HR', 'Croatia', /\b(?:croatia|croatian)\b/i, 'Zagreb', 45.81, 15.98),
  c('CY', 'Cyprus', /\b(?:cyprus|cypriot)\b/i, 'Nicosia', 35.17, 33.36),
  c('CZ', 'Czechia', /\b(?:czechia|czech)\b/i, 'Prague', 50.08, 14.44),
  c('DK', 'Denmark', /\b(?:denmark|danish)\b/i, 'Copenhagen', 55.68, 12.57),
  c('EE', 'Estonia', /\b(?:estonia|estonian)\b/i, 'Tallinn', 59.44, 24.75),
  c('FI', 'Finland', /\b(?:finland|finnish)\b/i, 'Helsinki', 60.17, 24.94),
  c('GR', 'Greece', /\b(?:greece|greek)\b/i, 'Athens', 37.98, 23.73),
  c('HU', 'Hungary', /\b(?:hungary|hungarian)\b/i, 'Budapest', 47.50, 19.04),
  c('IS', 'Iceland', /\b(?:iceland|icelandic)\b/i, 'Reykjavik', 64.15, -21.94),
  c('IE', 'Ireland', /\b(?:(?<!northern )ireland|irish)\b/i, 'Dublin', 53.35, -6.26),
  c('IT', 'Italy', /\b(?:italy|italian)\b/i, 'Rome', 41.90, 12.50),
  c('XK', 'Kosovo', /\b(?:kosovo|kosovar)\b/i, 'Pristina', 42.66, 21.17),
  c('LV', 'Latvia', /\b(?:latvia|latvian)\b/i, 'Riga', 56.95, 24.11),
  c('LI', 'Liechtenstein', /\bliechtenstein\b/i, 'Vaduz', 47.14, 9.52),
  c('LT', 'Lithuania', /\b(?:lithuania|lithuanian)\b/i, 'Vilnius', 54.69, 25.28),
  c('LU', 'Luxembourg', /\bluxembourg\b/i, 'Luxembourg', 49.61, 6.13),
  c('MT', 'Malta', /\b(?:malta|maltese)\b/i, 'Valletta', 35.90, 14.51),
  c('MD', 'Moldova', /\b(?:moldova|moldovan)\b/i, 'Chișinău', 47.01, 28.86),
  c('MC', 'Monaco', /\bmonaco\b/i, 'Monaco', 43.73, 7.42),
  c('ME', 'Montenegro', /\b(?:montenegro|montenegrin)\b/i, 'Podgorica', 42.44, 19.26),
  c('NL', 'Netherlands', /\b(?:netherlands|dutch|holland)\b/i, 'Amsterdam', 52.37, 4.90),
  c('MK', 'North Macedonia', /\b(?:north macedonia|macedonia|macedonian)\b/i, 'Skopje', 42.00, 21.43),
  c('NO', 'Norway', /\b(?:norway|norwegian)\b/i, 'Oslo', 59.91, 10.75),
  c('PL', 'Poland', /\bpoland\b/i, 'Warsaw', 52.23, 21.01),
  c('PT', 'Portugal', /\bportugal\b/i, 'Lisbon', 38.72, -9.14),
  c('RO', 'Romania', /\b(?:romania|romanian)\b/i, 'Bucharest', 44.43, 26.10),
  c('SM', 'San Marino', /\bsan marino\b/i, 'San Marino', 43.94, 12.45),
  c('RS', 'Serbia', /\b(?:serbia|serbian)\b/i, 'Belgrade', 44.79, 20.45),
  c('SK', 'Slovakia', /\b(?:slovakia|slovak)\b/i, 'Bratislava', 48.15, 17.11),
  c('SI', 'Slovenia', /\b(?:slovenia|slovenian|slovene)\b/i, 'Ljubljana', 46.06, 14.51),
  c('ES', 'Spain', /\bspain\b/i, 'Madrid', 40.42, -3.70),
  c('SE', 'Sweden', /\b(?:sweden|swedish)\b/i, 'Stockholm', 59.33, 18.07),
  c('CH', 'Switzerland', /\b(?:switzerland|swiss)\b/i, 'Bern', 46.95, 7.45),
  c('VA', 'Vatican City', /\b(?:vatican|holy see)\b/i, 'Vatican City', 41.90, 12.45),
  c('GE', 'Georgia', /\b(?:republic of georgia|georgian dream|tbilisi)\b/i, 'Tbilisi', 41.72, 44.79),
  c('AM', 'Armenia', /\b(?:armenia|armenian)\b/i, 'Yerevan', 40.18, 44.51),
  c('AZ', 'Azerbaijan', /\b(?:azerbaijan|azerbaijani|azeri)\b/i, 'Baku', 40.41, 49.87),
  c('GL', 'Greenland', /\bgreenland\b/i, 'Nuuk', 64.18, -51.72),

  // Middle East and North Africa
  c('BH', 'Bahrain', /\b(?:bahrain|bahraini)\b/i, 'Manama', 26.23, 50.59),
  c('EG', 'Egypt', /\b(?:egypt|egyptian)\b/i, 'Cairo', 30.04, 31.24),
  c('JO', 'Jordan', /\b(?:jordanian|king of jordan|in jordan|jordan['’]s (?:king|queen|foreign|government|army|prime))\b/i, 'Amman', 31.95, 35.93),
  c('KW', 'Kuwait', /\b(?:kuwait|kuwaiti)\b/i, 'Kuwait City', 29.38, 47.99),
  c('LB', 'Lebanon', /\b(?:lebanon|lebanese)\b/i, 'Beirut', 33.89, 35.50),
  c('OM', 'Oman', /\b(?:oman|omani)\b/i, 'Muscat', 23.59, 58.41),
  c('PS', 'Palestine', /\b(?:palestine|palestinian)\b/i, 'Gaza', 31.50, 34.47),
  c('QA', 'Qatar', /\b(?:qatar|qatari)\b/i, 'Doha', 25.29, 51.53),
  c('AE', 'United Arab Emirates', /\b(?:united arab emirates|uae|emirati)\b/i, 'Abu Dhabi', 24.45, 54.38),
  c('YE', 'Yemen', /\b(?:yemen|yemeni)\b/i, 'Sanaa', 15.37, 44.19),
  c('DZ', 'Algeria', /\b(?:algeria|algerian)\b/i, 'Algiers', 36.75, 3.06),
  c('LY', 'Libya', /\b(?:libya|libyan)\b/i, 'Tripoli', 32.89, 13.19),
  c('MA', 'Morocco', /\b(?:morocco|moroccan)\b/i, 'Rabat', 34.02, -6.84),
  c('TN', 'Tunisia', /\b(?:tunisia|tunisian)\b/i, 'Tunis', 36.81, 10.18),

  // Sub-Saharan Africa
  c('AO', 'Angola', /\b(?:angola|angolan)\b/i, 'Luanda', -8.84, 13.23),
  c('BJ', 'Benin', /\b(?:benin(?!\s+city)|beninese)\b/i, 'Porto-Novo', 6.50, 2.60),
  c('BW', 'Botswana', /\bbotswana\b/i, 'Gaborone', -24.65, 25.91),
  c('BF', 'Burkina Faso', /\b(?:burkina faso|burkina|burkinabe)\b/i, 'Ouagadougou', 12.37, -1.52),
  c('BI', 'Burundi', /\b(?:burundi|burundian)\b/i, 'Gitega', -3.43, 29.93),
  c('CV', 'Cabo Verde', /\b(?:cabo verde|cape verde)\b/i, 'Praia', 14.93, -23.51),
  c('CM', 'Cameroon', /\b(?:cameroon|cameroonian)\b/i, 'Yaoundé', 3.85, 11.50),
  c('CF', 'Central African Republic', /\bcentral african republic\b/i, 'Bangui', 4.39, 18.56),
  c('TD', 'Chad', /\b(?:[Cc]hadian|[Ii]n [Cc]had(?!\s+[A-Z][a-z])|CHADIAN|IN CHAD|N['’][Dd]jamena|N['’]DJAMENA)\b/, "N'Djamena", 12.13, 15.06),
  // French "Comores" and the islands too (round 4, Oct 20, 2026: 15 of HZK-Presse's 20 items found no place)
  c('KM', 'Comoros', /\b(?:comoros|comores|comorian|comorien(?:ne)?|anjouan|moh[eé]li)\b/i, 'Moroni', -11.70, 43.26),
  // French, Spanish and Portuguese "République du Congo" too: it read as DR Congo (round 5, Oct 21, 2026)
  c('CG', 'Republic of the Congo', /\b(?:(?<!democratic )republic of the congo|r[ée]publique du congo|rep[uú]blica del? congo|rep[uú]blica do congo|congo[-\s]brazzaville|brazzaville)\b/i, 'Brazzaville', -4.27, 15.28),
  c('CD', 'DR Congo', /\b(?:democratic republic of (?:the )?congo|dr congo|drc|congolese|(?<!republic of the |r[ée]publique du |rep[uú]blica del? |rep[uú]blica do )congo(?![-\s]brazzaville))\b/i, 'Kinshasa', -4.44, 15.27),
  c('CI', "Côte d'Ivoire", /\b(?:ivory coast|c[oô]te d['’]ivoire|ivorian)\b/i, 'Abidjan', 5.36, -4.01),
  c('DJ', 'Djibouti', /\bdjibouti\b/i, 'Djibouti', 11.59, 43.15),
  // (Spanish "Guinea Ecuatorial" too: it read as Guinea, Oct 20, 2026)
  c('GQ', 'Equatorial Guinea', /\bequatorial guinea\b|\bguinea ecuatorial\b/i, 'Malabo', 3.75, 8.78),
  c('ER', 'Eritrea', /\b(?:eritrea|eritrean)\b/i, 'Asmara', 15.32, 38.93),
  c('SZ', 'Eswatini', /\b(?:eswatini|swaziland)\b/i, 'Mbabane', -26.31, 31.14),
  c('GA', 'Gabon', /\b(?:gabon|gabonese)\b/i, 'Libreville', 0.39, 9.45),
  c('GM', 'Gambia', /\b(?:gambia|gambian)\b/i, 'Banjul', 13.45, -16.58),
  c('GH', 'Ghana', /\b(?:ghana|ghanaian)\b/i, 'Accra', 5.60, -0.19),
  c('GW', 'Guinea-Bissau', /\bguinea[-\s]bissau\b/i, 'Bissau', 11.86, -15.60),
  c('GN', 'Guinea', /\b(?:(?<!(?:new|equatorial|papua) )guinea(?![-\s](?:bissau|pigs?|ecuatorial)\b)|guinean)\b/i, 'Conakry', 9.64, -13.58),
  c('LS', 'Lesotho', /\blesotho\b/i, 'Maseru', -29.31, 27.48),
  c('LR', 'Liberia', /\b(?:liberia|liberian)\b/i, 'Monrovia', 6.30, -10.80),
  c('MG', 'Madagascar', /\b(?:madagascar|malagasy)\b/i, 'Antananarivo', -18.88, 47.51),
  c('MW', 'Malawi', /\b(?:malawi|malawian)\b/i, 'Lilongwe', -13.96, 33.79),
  c('ML', 'Mali', /\b(?:mali|malian)\b/i, 'Bamako', 12.64, -8.00),
  c('MR', 'Mauritania', /\b(?:mauritania|mauritanian)\b/i, 'Nouakchott', 18.08, -15.98),
  c('MU', 'Mauritius', /\b(?:mauritius|mauritian)\b/i, 'Port Louis', -20.16, 57.50),
  c('MZ', 'Mozambique', /\b(?:mozambique|mozambican)\b/i, 'Maputo', -25.97, 32.57),
  c('NA', 'Namibia', /\b(?:namibia|namibian)\b/i, 'Windhoek', -22.56, 17.08),
  c('NE', 'Niger', /\b(?:niger(?![\s-](?:delta|state|river)\b)|nigerien)\b/i, 'Niamey', 13.51, 2.11),
  c('RW', 'Rwanda', /\b(?:rwanda|rwandan)\b/i, 'Kigali', -1.94, 30.06),
  // (no \b after "é": without the u flag \b doesn't count it as a letter, so
  // "São Tomé" with its accent never matched until Oct 20, 2026)
  c('ST', 'São Tomé and Príncipe', /\bs[aã]o tom[eé](?![a-zà-ÿ])/i, 'São Tomé', 0.34, 6.73),
  c('SN', 'Senegal', /\b(?:senegal|senegalese)\b/i, 'Dakar', 14.72, -17.47),
  c('SC', 'Seychelles', /\bseychelles\b/i, 'Victoria', -4.62, 55.45),
  c('SL', 'Sierra Leone', /\bsierra leone(?:an)?\b/i, 'Freetown', 8.48, -13.23),
  c('SO', 'Somalia', /\b(?:somalia|somali)\b/i, 'Mogadishu', 2.05, 45.32),
  c('SS', 'South Sudan', /\bsouth sudan(?:ese)?\b/i, 'Juba', 4.85, 31.58),
  c('SD', 'Sudan', /\b(?<!south )sudan(?:ese)?\b/i, 'Khartoum', 15.50, 32.56),
  c('TZ', 'Tanzania', /\b(?:tanzania|tanzanian)\b/i, 'Dodoma', -6.16, 35.75),
  c('TG', 'Togo', /\b(?:togo|togolese)\b/i, 'Lomé', 6.13, 1.22),
  c('UG', 'Uganda', /\b(?:uganda|ugandan)\b/i, 'Kampala', 0.35, 32.58),
  c('ZM', 'Zambia', /\b(?:zambia|zambian)\b/i, 'Lusaka', -15.39, 28.32),
  c('ZW', 'Zimbabwe', /\b(?:zimbabwe|zimbabwean)\b/i, 'Harare', -17.83, 31.05),

  // Asia
  c('BD', 'Bangladesh', /\b(?:bangladesh|bangladeshi)\b/i, 'Dhaka', 23.81, 90.41),
  c('BT', 'Bhutan', /\b(?:bhutan|bhutanese)\b/i, 'Thimphu', 27.47, 89.64),
  c('BN', 'Brunei', /\bbrunei\b/i, 'Bandar Seri Begawan', 4.90, 114.94),
  c('KH', 'Cambodia', /\b(?:cambodia|cambodian)\b/i, 'Phnom Penh', 11.56, 104.92),
  c('TL', 'Timor-Leste', /\b(?:timor[-\s]leste|east timor(?:ese)?)\b/i, 'Dili', -8.56, 125.57),
  c('HK', 'Hong Kong', /\bhong kong\b/i, 'Hong Kong', 22.32, 114.17),
  c('MO', 'Macau', /\bmaca[uo]\b/i, 'Macau', 22.20, 113.54),
  c('TW', 'Taiwan', /\b(?:taiwan|taiwanese)\b/i, 'Taipei', 25.03, 121.57),
  c('KZ', 'Kazakhstan', /\b(?:kazakhstan|kazakh)\b/i, 'Astana', 51.17, 71.45),
  c('KG', 'Kyrgyzstan', /\b(?:kyrgyzstan|kyrgyz)\b/i, 'Bishkek', 42.87, 74.59),
  c('LA', 'Laos', /\b(?:laos|laotian)\b/i, 'Vientiane', 17.98, 102.63),
  c('MV', 'Maldives', /\b(?:maldives|maldivian)\b/i, 'Malé', 4.18, 73.51),
  c('MN', 'Mongolia', /\b(?:mongolia|mongolian)\b/i, 'Ulaanbaatar', 47.89, 106.91),
  c('MM', 'Myanmar', /\b(?:myanmar|burma|burmese)\b/i, 'Naypyidaw', 19.76, 96.08),
  c('NP', 'Nepal', /\b(?:nepal|nepalese|nepali)\b/i, 'Kathmandu', 27.72, 85.32),
  c('SG', 'Singapore', /\bsingapore(?:an)?\b/i, 'Singapore', 1.35, 103.82),
  c('LK', 'Sri Lanka', /\bsri lanka(?:n)?\b/i, 'Colombo', 6.93, 79.86),
  c('TJ', 'Tajikistan', /\b(?:tajikistan|tajik)\b/i, 'Dushanbe', 38.56, 68.79),
  c('TM', 'Turkmenistan', /\b(?:turkmenistan|turkmen)\b/i, 'Ashgabat', 37.96, 58.33),
  c('UZ', 'Uzbekistan', /\b(?:uzbekistan|uzbek)\b/i, 'Tashkent', 41.30, 69.24),

  // Americas
  c('AG', 'Antigua and Barbuda', /\bantigua\b/i, "St. John's", 17.12, -61.85),
  c('BS', 'Bahamas', /\b(?:bahamas|bahamian)\b/i, 'Nassau', 25.05, -77.35),
  c('BB', 'Barbados', /\b(?:barbados|barbadian)\b/i, 'Bridgetown', 13.10, -59.62),
  c('BZ', 'Belize', /\bbelize(?:an)?\b/i, 'Belmopan', 17.25, -88.77),
  c('BO', 'Bolivia', /\b(?:bolivia|bolivian)\b/i, 'La Paz', -16.50, -68.15),
  c('CL', 'Chile', /\b(?:chile|chilean)\b/i, 'Santiago', -33.45, -70.67),
  c('CR', 'Costa Rica', /\bcosta rica(?:n)?\b/i, 'San José', 9.93, -84.08),
  c('CU', 'Cuba', /\b(?:cuba|cuban)\b/i, 'Havana', 23.11, -82.37),
  c('DM', 'Dominica', /\bdominica\b/i, 'Roseau', 15.30, -61.39),
  c('DO', 'Dominican Republic', /\bdominican republic\b/i, 'Santo Domingo', 18.49, -69.93),
  c('EC', 'Ecuador', /\b(?:ecuador|ecuadorian|ecuadorean)\b/i, 'Quito', -0.18, -78.47),
  c('SV', 'El Salvador', /\b(?:el salvador|salvadoran|salvadorean)\b/i, 'San Salvador', 13.69, -89.22),
  c('GD', 'Grenada', /\bgrenada\b/i, "St. George's", 12.06, -61.75),
  c('GT', 'Guatemala', /\bguatemala(?:n)?\b/i, 'Guatemala City', 14.63, -90.51),
  c('GY', 'Guyana', /\b(?:guyana|guyanese)\b/i, 'Georgetown', 6.80, -58.16),
  c('HT', 'Haiti', /\b(?:haiti|haitian)\b/i, 'Port-au-Prince', 18.54, -72.34),
  c('HN', 'Honduras', /\b(?:honduras|honduran)\b/i, 'Tegucigalpa', 14.07, -87.19),
  c('JM', 'Jamaica', /\bjamaica(?:n)?\b/i, 'Kingston', 17.97, -76.79),
  c('NI', 'Nicaragua', /\bnicaragua(?:n)?\b/i, 'Managua', 12.11, -86.24),
  c('PA', 'Panama', /\bpanama(?:nians?)?\b/i, 'Panama City', 8.98, -79.52),
  c('PY', 'Paraguay', /\bparaguay(?:an)?\b/i, 'Asunción', -25.26, -57.58),
  c('PE', 'Peru', /\b(?:peru|peruvian)\b/i, 'Lima', -12.05, -77.04),
  c('PR', 'Puerto Rico', /\bpuerto ric(?:o|an)\b/i, 'San Juan', 18.47, -66.11),
  c('LC', 'Saint Lucia', /\b(?:saint|st\.?) lucia\b/i, 'Castries', 14.01, -60.99),
  c('SR', 'Suriname', /\b(?:suriname|surinamese)\b/i, 'Paramaribo', 5.85, -55.20),
  c('TT', 'Trinidad and Tobago', /\b(?:trinidad|trinidadian)\b/i, 'Port of Spain', 10.65, -61.51),
  c('UY', 'Uruguay', /\buruguay(?:an)?\b/i, 'Montevideo', -34.90, -56.16),
  c('VE', 'Venezuela', /\bvenezuela(?:n)?\b/i, 'Caracas', 10.49, -66.88),

  // Oceania
  c('FJ', 'Fiji', /\bfiji(?:an)?\b/i, 'Suva', -18.14, 178.44),
  c('KI', 'Kiribati', /\bkiribati\b/i, 'Tarawa', 1.33, 172.98),
  c('MH', 'Marshall Islands', /\bmarshall islands\b/i, 'Majuro', 7.09, 171.38),
  c('FM', 'Micronesia', /\bmicronesia\b/i, 'Palikir', 6.92, 158.16),
  c('NR', 'Nauru', /\bnauru\b/i, 'Yaren', -0.55, 166.92),
  c('NZ', 'New Zealand', /\bnew zealand(?:ers?)?\b/i, 'Wellington', -41.29, 174.78),
  c('PW', 'Palau', /\bpalau\b/i, 'Ngerulmud', 7.50, 134.62),
  c('PG', 'Papua New Guinea', /\bpapua new guinea(?:n)?\b/i, 'Port Moresby', -9.44, 147.18),
  c('WS', 'Samoa', /\bsamoa(?:n)?\b/i, 'Apia', -13.83, -171.76),
  c('SB', 'Solomon Islands', /\bsolomon islands?\b/i, 'Honiara', -9.43, 159.95),
  c('TO', 'Tonga', /\btonga(?:n)?\b/i, "Nuku'alofa", -21.14, -175.20),
  c('TV', 'Tuvalu', /\btuvalu\b/i, 'Funafuti', -8.52, 179.20),
  c('VU', 'Vanuatu', /\bvanuatu\b/i, 'Port Vila', -17.73, 168.32),
  c('NC', 'New Caledonia', /\bnew caledonia(?:n)?\b/i, 'Nouméa', -22.27, 166.44),
]

/** Names of the countries geo.ts already had patterns or capitals for */
export const KNOWN_COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', GB: 'United Kingdom', CN: 'China', RU: 'Russia', FR: 'France', DE: 'Germany',
  JP: 'Japan', IN: 'India', BR: 'Brazil', CA: 'Canada', AU: 'Australia', IL: 'Israel', IR: 'Iran',
  KP: 'North Korea', KR: 'South Korea', PK: 'Pakistan', AF: 'Afghanistan', SY: 'Syria', IQ: 'Iraq',
  SA: 'Saudi Arabia', TR: 'Turkey', UA: 'Ukraine', MX: 'Mexico', AR: 'Argentina', CO: 'Colombia',
  NG: 'Nigeria', ZA: 'South Africa', KE: 'Kenya', ET: 'Ethiopia', ID: 'Indonesia', PH: 'Philippines',
  VN: 'Vietnam', TH: 'Thailand', MY: 'Malaysia',
}

/** A country's name from its code ("PA" → "Panama"), or undefined */
export function countryNameOf(code: string | null | undefined): string | undefined {
  if (!code) return undefined
  return KNOWN_COUNTRY_NAMES[code] ?? MORE_COUNTRIES.find(entry => entry.code === code)?.name
}

/**
 * "US" and "UK" in capitals ("US says it disabled a cargo vessel"); the
 * lowercase words are too common to count.
 */
export const ABBREVIATED_COUNTRIES: Array<[RegExp, string]> = [
  // Not "US$" or "US $": Zimbabwe prices things in US dollars, so its stories went to the US (round 4, Oct 20, 2026)
  [/\bUS\b(?!\s?\$)/, 'US'],
  [/\bUK\b/, 'GB'],
]

/**
 * US states, pinned at their capitals like countries (a story "in
 * Pennsylvania" had no place at all). Georgia is left out (the country) and so
 * is Washington state ("Washington" is the capital city in the gazetteer).
 */
export const US_STATES: Record<string, { lat: number; lng: number; country: string; name: string }> = Object.fromEntries(([
  ['Alabama', 32.38, -86.30], ['Alaska', 58.30, -134.42], ['Arizona', 33.45, -112.07], ['Arkansas', 34.75, -92.29],
  ['California', 38.58, -121.49], ['Colorado', 39.74, -104.99], ['Connecticut', 41.76, -72.68], ['Delaware', 39.16, -75.52],
  ['Florida', 30.44, -84.28], ['Hawaii', 21.31, -157.86], ['Idaho', 43.62, -116.20], ['Illinois', 39.80, -89.65],
  ['Indiana', 39.77, -86.16], ['Iowa', 41.59, -93.62], ['Kansas', 39.05, -95.68], ['Kentucky', 38.20, -84.87],
  ['Louisiana', 30.45, -91.19], ['Maine', 44.31, -69.78], ['Maryland', 38.98, -76.49], ['Massachusetts', 42.36, -71.06],
  ['Michigan', 42.73, -84.56], ['Minnesota', 44.95, -93.09], ['Mississippi', 32.30, -90.18], ['Missouri', 38.58, -92.17],
  ['Montana', 46.59, -112.04], ['Nebraska', 40.81, -96.70], ['Nevada', 39.16, -119.77], ['New Hampshire', 43.21, -71.54],
  ['New Jersey', 40.22, -74.76], ['New Mexico', 35.69, -105.94], ['North Carolina', 35.78, -78.64], ['North Dakota', 46.81, -100.78],
  ['Ohio', 39.96, -83.00], ['Oklahoma', 35.47, -97.52], ['Oregon', 44.94, -123.04], ['Pennsylvania', 40.27, -76.88],
  ['Rhode Island', 41.82, -71.41], ['South Carolina', 34.00, -81.03], ['South Dakota', 44.37, -100.35], ['Tennessee', 36.16, -86.78],
  ['Texas', 30.27, -97.74], ['Utah', 40.76, -111.89], ['Vermont', 44.26, -72.58], ['Virginia', 37.54, -77.44],
  ['West Virginia', 38.35, -81.63], ['Wisconsin', 43.07, -89.40], ['Wyoming', 41.14, -104.82],
] as Array<[string, number, number]>).map(([name, lat, lng]) => [name.toLowerCase(), { lat, lng, country: 'US', name }]))
