/**
 * The State Department's codes for places, as the scraper keeps each country's US travel advisory level
 * (apps/scraper/src/sources/travel-advisories.ts: osint:travel-us:<code> = "level|day", the code from the
 * advisory page's address: "irn", "xgz", "french-west-indies" on an older page) → ISO 3166-1 alpha-2.
 *
 * Until Nov 22, 2026 the API kept only two-letter keys and so found no levels at all: the travel advice
 * endpoint and the AI tool that asks it answered with an empty list. This table is a copy of the scraper's
 * (a test checks the two stay the same).
 */
export const US_TRAVEL_CODES: Record<string, string> = {
  abw: 'AW', afg: 'AF', ago: 'AO', aia: 'AI', alb: 'AL', and: 'AD', are: 'AE', arg: 'AR', arm: 'AM', ata: 'AQ',
  atg: 'AG', aus: 'AU', aut: 'AT', aze: 'AZ', bdi: 'BI', bel: 'BE', ben: 'BJ', bes: 'BQ', bfa: 'BF', bgd: 'BD',
  bgr: 'BG', bhr: 'BH', bhs: 'BS', bih: 'BA', blm: 'BL', blr: 'BY', blz: 'BZ', bmu: 'BM', bol: 'BO', bra: 'BR',
  brb: 'BB', brn: 'BN', btn: 'BT', bwa: 'BW', caf: 'CF', can: 'CA', che: 'CH', chl: 'CL', chn: 'CN', civ: 'CI',
  cmr: 'CM', cod: 'CD', cog: 'CG', col: 'CO', com: 'KM', cpv: 'CV', cri: 'CR', cub: 'CU', cuw: 'CW', cym: 'KY',
  cyp: 'CY', cze: 'CZ', deu: 'DE', dji: 'DJ', dma: 'DM', dnk: 'DK', dom: 'DO', dza: 'DZ', ecu: 'EC', egy: 'EG',
  eri: 'ER', esp: 'ES', est: 'EE', eth: 'ET', fin: 'FI', fji: 'FJ', fra: 'FR', fsm: 'FM', gab: 'GA', gbr: 'GB',
  geo: 'GE', gha: 'GH', gin: 'GN', glp: 'GP', gmb: 'GM', gnb: 'GW', gnq: 'GQ', grc: 'GR', grd: 'GD', grl: 'GL',
  gtm: 'GT', guf: 'GF', guy: 'GY', hkg: 'HK', hnd: 'HN', hrv: 'HR', hti: 'HT', hun: 'HU', idn: 'ID', ind: 'IN',
  irl: 'IE', irn: 'IR', irq: 'IQ', isl: 'IS', isr: 'IL', ita: 'IT', jam: 'JM', jor: 'JO', jpn: 'JP', kaz: 'KZ',
  ken: 'KE', kgz: 'KG', khm: 'KH', kir: 'KI', kna: 'KN', kor: 'KR', kwt: 'KW', lao: 'LA', lbn: 'LB', lbr: 'LR',
  lby: 'LY', lca: 'LC', lie: 'LI', lka: 'LK', lso: 'LS', ltu: 'LT', lux: 'LU', lva: 'LV', mac: 'MO', maf: 'MF',
  mar: 'MA', mda: 'MD', mdg: 'MG', mdv: 'MV', mex: 'MX', mhl: 'MH', mkd: 'MK', mli: 'ML', mlt: 'MT', mmr: 'MM',
  mne: 'ME', mng: 'MN', moz: 'MZ', mrt: 'MR', msr: 'MS', mtq: 'MQ', mus: 'MU', mwi: 'MW', mys: 'MY', nam: 'NA',
  ncl: 'NC', ner: 'NE', nga: 'NG', nic: 'NI', nld: 'NL', nor: 'NO', npl: 'NP', nru: 'NR', nzl: 'NZ', omn: 'OM',
  pak: 'PK', pan: 'PA', per: 'PE', phl: 'PH', plw: 'PW', png: 'PG', pol: 'PL', prk: 'KP', prt: 'PT', pry: 'PY',
  pyf: 'PF', qat: 'QA', rou: 'RO', rus: 'RU', rwa: 'RW', sau: 'SA', sdn: 'SD', sen: 'SN', sgp: 'SG', slb: 'SB',
  sle: 'SL', slv: 'SV', som: 'SO', srb: 'RS', ssd: 'SS', stp: 'ST', sur: 'SR', svk: 'SK', svn: 'SI', swe: 'SE',
  swz: 'SZ', sxm: 'SX', syc: 'SC', syr: 'SY', tca: 'TC', tcd: 'TD', tgo: 'TG', tha: 'TH', tjk: 'TJ', tkm: 'TM',
  tls: 'TL', ton: 'TO', tto: 'TT', tun: 'TN', tur: 'TR', tuv: 'TV', twn: 'TW', tza: 'TZ', uga: 'UG', ukr: 'UA',
  ury: 'UY', uzb: 'UZ', vct: 'VC', ven: 'VE', vgb: 'VG', vnm: 'VN', vut: 'VU', wsm: 'WS', yem: 'YE', zaf: 'ZA',
  zmb: 'ZM', zwe: 'ZW',
  xgz: 'PS', xwb: 'PS', xks: 'XK', xqx: 'BQ',
  // an older page names the place in its address
  'french-west-indies': 'GP',
}

/** The two-letter country for a kept key's code ("irn" → "IR"); null for a code the table doesn't have */
export function usTravelCountry(code: string): string | null {
  return US_TRAVEL_CODES[code.trim().toLowerCase()] ?? null
}
