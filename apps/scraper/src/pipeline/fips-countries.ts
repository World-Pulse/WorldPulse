/**
 * GDELT's country codes are FIPS 10-4, not ISO 3166 (Oct 20, 2026; plan Q3,
 * handoff H-0022). GDELT's ActionGeo_CountryCode is the US government's FIPS
 * 10-4 code, and gdelt.ts stored it as the story's ISO country code, so
 * Nigerian stories carried NI (Nicaragua's ISO code; Nigeria is NG) and Irish
 * ones EI (no ISO country at all). Most codes agree, but many collide with a
 * different country: Austria is AU in FIPS (Australia in ISO), Germany GM
 * (Gambia), China CH (Switzerland), Israel IS (Iceland), Russia RS (Serbia),
 * Niger NG (Nigeria), Chad CD (DR Congo), Senegal SG (Singapore), Sweden SW,
 * Seychelles SE (Sweden), Kiribati KR (South Korea), Comoros CN (China).
 *
 * FIPS_TO_ISO: every FIPS 10-4 country code GDELT uses → [ISO 3166-1
 * alpha-2, the country's name as GDELT writes it at the end of a place name].
 * Places with no ISO code of their own (the Paracel and Spratly islands,
 * the old Netherlands Antilles, GDELT's "OS" for the oceans) are left out,
 * so they get no country rather than a wrong one.
 */

export const FIPS_TO_ISO: Readonly<Record<string, readonly [string, string]>> = {
  // Europe
  UK: ['GB', 'United Kingdom'], EI: ['IE', 'Ireland'], FR: ['FR', 'France'], BE: ['BE', 'Belgium'],
  NL: ['NL', 'Netherlands'], LU: ['LU', 'Luxembourg'], GM: ['DE', 'Germany'], AU: ['AT', 'Austria'],
  SZ: ['CH', 'Switzerland'], LS: ['LI', 'Liechtenstein'], IT: ['IT', 'Italy'], VT: ['VA', 'Vatican City'],
  SM: ['SM', 'San Marino'], MN: ['MC', 'Monaco'], AN: ['AD', 'Andorra'], SP: ['ES', 'Spain'],
  PO: ['PT', 'Portugal'], GI: ['GI', 'Gibraltar'], MT: ['MT', 'Malta'], DA: ['DK', 'Denmark'],
  NO: ['NO', 'Norway'], SW: ['SE', 'Sweden'], FI: ['FI', 'Finland'], IC: ['IS', 'Iceland'],
  FO: ['FO', 'Faroe Islands'], EN: ['EE', 'Estonia'], LG: ['LV', 'Latvia'], LH: ['LT', 'Lithuania'],
  PL: ['PL', 'Poland'], EZ: ['CZ', 'Czech Republic'], LO: ['SK', 'Slovakia'], HU: ['HU', 'Hungary'],
  SI: ['SI', 'Slovenia'], HR: ['HR', 'Croatia'], BK: ['BA', 'Bosnia and Herzegovina'], RI: ['RS', 'Serbia'],
  MJ: ['ME', 'Montenegro'], KV: ['XK', 'Kosovo'], MK: ['MK', 'Macedonia'], AL: ['AL', 'Albania'],
  GR: ['GR', 'Greece'], BU: ['BG', 'Bulgaria'], RO: ['RO', 'Romania'], MD: ['MD', 'Moldova'],
  UP: ['UA', 'Ukraine'], BO: ['BY', 'Belarus'], RS: ['RU', 'Russia'], CY: ['CY', 'Cyprus'],
  GK: ['GG', 'Guernsey'], JE: ['JE', 'Jersey'], IM: ['IM', 'Isle of Man'], SV: ['SJ', 'Svalbard'],
  JN: ['SJ', 'Jan Mayen'],
  // Middle East and the Caucasus
  TU: ['TR', 'Turkey'], SY: ['SY', 'Syria'], LE: ['LB', 'Lebanon'], IS: ['IL', 'Israel'],
  WE: ['PS', 'West Bank'], GZ: ['PS', 'Gaza Strip'], JO: ['JO', 'Jordan'], IZ: ['IQ', 'Iraq'],
  IR: ['IR', 'Iran'], KU: ['KW', 'Kuwait'], SA: ['SA', 'Saudi Arabia'], BA: ['BH', 'Bahrain'],
  QA: ['QA', 'Qatar'], AE: ['AE', 'United Arab Emirates'], MU: ['OM', 'Oman'], YM: ['YE', 'Yemen'],
  AJ: ['AZ', 'Azerbaijan'], AM: ['AM', 'Armenia'], GG: ['GE', 'Georgia'],
  // Asia
  AF: ['AF', 'Afghanistan'], PK: ['PK', 'Pakistan'], IN: ['IN', 'India'], BG: ['BD', 'Bangladesh'],
  CE: ['LK', 'Sri Lanka'], NP: ['NP', 'Nepal'], BT: ['BT', 'Bhutan'], MV: ['MV', 'Maldives'],
  CH: ['CN', 'China'], TW: ['TW', 'Taiwan'], HK: ['HK', 'Hong Kong'], MC: ['MO', 'Macau'],
  MG: ['MN', 'Mongolia'], KN: ['KP', 'North Korea'], KS: ['KR', 'South Korea'], JA: ['JP', 'Japan'],
  RP: ['PH', 'Philippines'], VM: ['VN', 'Vietnam'], LA: ['LA', 'Laos'], CB: ['KH', 'Cambodia'],
  TH: ['TH', 'Thailand'], BM: ['MM', 'Burma'], MY: ['MY', 'Malaysia'], SN: ['SG', 'Singapore'],
  BX: ['BN', 'Brunei'], ID: ['ID', 'Indonesia'], TT: ['TL', 'Timor-Leste'], KZ: ['KZ', 'Kazakhstan'],
  KG: ['KG', 'Kyrgyzstan'], TI: ['TJ', 'Tajikistan'], TX: ['TM', 'Turkmenistan'], UZ: ['UZ', 'Uzbekistan'],
  // Africa
  EG: ['EG', 'Egypt'], LY: ['LY', 'Libya'], TS: ['TN', 'Tunisia'], AG: ['DZ', 'Algeria'],
  MO: ['MA', 'Morocco'], WI: ['EH', 'Western Sahara'], MR: ['MR', 'Mauritania'], ML: ['ML', 'Mali'],
  NG: ['NE', 'Niger'], CD: ['TD', 'Chad'], SU: ['SD', 'Sudan'], OD: ['SS', 'South Sudan'],
  ET: ['ET', 'Ethiopia'], ER: ['ER', 'Eritrea'], DJ: ['DJ', 'Djibouti'], SO: ['SO', 'Somalia'],
  KE: ['KE', 'Kenya'], UG: ['UG', 'Uganda'], RW: ['RW', 'Rwanda'], BY: ['BI', 'Burundi'],
  TZ: ['TZ', 'Tanzania'], CG: ['CD', 'Congo (Kinshasa)'], CF: ['CG', 'Congo (Brazzaville)'],
  CT: ['CF', 'Central African Republic'], CM: ['CM', 'Cameroon'], GB: ['GA', 'Gabon'],
  EK: ['GQ', 'Equatorial Guinea'], TP: ['ST', 'Sao Tome and Principe'], NI: ['NG', 'Nigeria'],
  BN: ['BJ', 'Benin'], TO: ['TG', 'Togo'], GH: ['GH', 'Ghana'], IV: ['CI', "Cote d'Ivoire"],
  LI: ['LR', 'Liberia'], SL: ['SL', 'Sierra Leone'], GV: ['GN', 'Guinea'], PU: ['GW', 'Guinea-Bissau'],
  SG: ['SN', 'Senegal'], GA: ['GM', 'Gambia'], CV: ['CV', 'Cape Verde'], UV: ['BF', 'Burkina Faso'],
  AO: ['AO', 'Angola'], ZA: ['ZM', 'Zambia'], ZI: ['ZW', 'Zimbabwe'], MI: ['MW', 'Malawi'],
  MZ: ['MZ', 'Mozambique'], WA: ['NA', 'Namibia'], BC: ['BW', 'Botswana'], SF: ['ZA', 'South Africa'],
  LT: ['LS', 'Lesotho'], WZ: ['SZ', 'Swaziland'], MA: ['MG', 'Madagascar'], MP: ['MU', 'Mauritius'],
  SE: ['SC', 'Seychelles'], CN: ['KM', 'Comoros'], RE: ['RE', 'Reunion'], MF: ['YT', 'Mayotte'],
  SH: ['SH', 'Saint Helena'],
  // The Americas
  US: ['US', 'United States'], CA: ['CA', 'Canada'], MX: ['MX', 'Mexico'], GL: ['GL', 'Greenland'],
  GT: ['GT', 'Guatemala'], BH: ['BZ', 'Belize'], HO: ['HN', 'Honduras'], ES: ['SV', 'El Salvador'],
  NU: ['NI', 'Nicaragua'], CS: ['CR', 'Costa Rica'], PM: ['PA', 'Panama'], CU: ['CU', 'Cuba'],
  HA: ['HT', 'Haiti'], DR: ['DO', 'Dominican Republic'], JM: ['JM', 'Jamaica'], BF: ['BS', 'Bahamas'],
  BB: ['BB', 'Barbados'], TD: ['TT', 'Trinidad and Tobago'], GJ: ['GD', 'Grenada'], DO: ['DM', 'Dominica'],
  ST: ['LC', 'Saint Lucia'], VC: ['VC', 'Saint Vincent and the Grenadines'], SC: ['KN', 'Saint Kitts and Nevis'],
  AC: ['AG', 'Antigua and Barbuda'], AA: ['AW', 'Aruba'], UC: ['CW', 'Curacao'], NN: ['SX', 'Sint Maarten'],
  RN: ['MF', 'Saint Martin'], TB: ['BL', 'Saint Barthelemy'], AV: ['AI', 'Anguilla'], MH: ['MS', 'Montserrat'],
  VI: ['VG', 'British Virgin Islands'], VQ: ['VI', 'Virgin Islands'], RQ: ['PR', 'Puerto Rico'],
  CJ: ['KY', 'Cayman Islands'], TK: ['TC', 'Turks and Caicos Islands'], BD: ['BM', 'Bermuda'],
  MB: ['MQ', 'Martinique'], GP: ['GP', 'Guadeloupe'], SB: ['PM', 'Saint Pierre and Miquelon'],
  CO: ['CO', 'Colombia'], VE: ['VE', 'Venezuela'], GY: ['GY', 'Guyana'], NS: ['SR', 'Suriname'],
  FG: ['GF', 'French Guiana'], EC: ['EC', 'Ecuador'], PE: ['PE', 'Peru'], BR: ['BR', 'Brazil'],
  BL: ['BO', 'Bolivia'], PA: ['PY', 'Paraguay'], UY: ['UY', 'Uruguay'], AR: ['AR', 'Argentina'],
  CI: ['CL', 'Chile'], FK: ['FK', 'Falkland Islands'], SX: ['GS', 'South Georgia'],
  // Oceania
  AS: ['AU', 'Australia'], NZ: ['NZ', 'New Zealand'], PP: ['PG', 'Papua New Guinea'], FJ: ['FJ', 'Fiji'],
  BP: ['SB', 'Solomon Islands'], NH: ['VU', 'Vanuatu'], NC: ['NC', 'New Caledonia'], FP: ['PF', 'French Polynesia'],
  WS: ['WS', 'Samoa'], AQ: ['AS', 'American Samoa'], TN: ['TO', 'Tonga'], KR: ['KI', 'Kiribati'],
  TV: ['TV', 'Tuvalu'], NR: ['NR', 'Nauru'], RM: ['MH', 'Marshall Islands'], FM: ['FM', 'Micronesia'],
  PS: ['PW', 'Palau'], GQ: ['GU', 'Guam'], CQ: ['MP', 'Northern Mariana Islands'], WF: ['WF', 'Wallis and Futuna'],
  NF: ['NF', 'Norfolk Island'], CW: ['CK', 'Cook Islands'], NE: ['NU', 'Niue'], TL: ['TK', 'Tokelau'],
  PC: ['PN', 'Pitcairn Islands'], KT: ['CX', 'Christmas Island'], CK: ['CC', 'Cocos (Keeling) Islands'],
  // Polar and remote territories
  AY: ['AQ', 'Antarctica'], BV: ['BV', 'Bouvet Island'], HM: ['HM', 'Heard Island and McDonald Islands'],
  FS: ['TF', 'French Southern and Antarctic Lands'], IO: ['IO', 'British Indian Ocean Territory'],
}

/** The ISO 3166-1 alpha-2 code for a GDELT (FIPS 10-4) country code, or null when it has none */
export function isoFromFips(code: string | null | undefined): string | null {
  const key = String(code ?? '').trim().toUpperCase()
  return FIPS_TO_ISO[key]?.[0] ?? null
}

const plainName = (s: string): string => s
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/^the\s+/, '').replace(/[^a-z]+/g, ' ').trim()

/**
 * For a story stored with a GDELT FIPS code as its country (rows written
 * before this fix): the ISO code it should have, when its place name ends
 * with that country's name ("Lagos, Nigeria" with NI → NG), else null. A
 * place named for the ISO meaning of the same letters ("Managua, Nicaragua"
 * with NI, from the article's own text) is right as it is.
 * `isoName(code)` gives a country's name for its ISO code (world-countries.ts).
 */
export function isoForStoredFips(
  storedCode: string | null | undefined,
  placeName: string | null | undefined,
  isoName: (code: string) => string | undefined,
): string | null {
  const code = String(storedCode ?? '').trim().toUpperCase()
  const entry = FIPS_TO_ISO[code]
  if (!entry || entry[0] === code || !placeName) return null
  const last = plainName(placeName.split(',').at(-1) ?? '')
  if (!last) return null
  const meant = [entry[1], isoName(entry[0]) ?? ''].map(plainName).filter(Boolean)
  return meant.includes(last) ? entry[0] : null
}
