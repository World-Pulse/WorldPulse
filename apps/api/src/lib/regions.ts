/**
 * The world's regions as the AI tools and GET /api/v1/stories?region= name them (Nov 10, 2026): the UN's
 * continents, with the Middle East apart (from Egypt, Iran and Turkey to Yemen; Egypt is in Africa too), the
 * Caucasus in Asia, and Russia and Cyprus in Europe. Two-letter codes as the reports carry them (Kosovo is XK).
 */
export const REGIONS = {
  africa: {
    label: 'Africa',
    countries: 'DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW',
  },
  americas: {
    label: 'the Americas',
    countries: 'AI AG AR AW BS BB BZ BM BO BQ BR VG CA KY CL CO CR CU CW DM DO EC SV FK GF GL GD GP GT GY HT HN JM MQ MX MS NI PA PY PE PR BL KN LC MF PM VC SX SR TT TC US UY VE VI',
  },
  asia: {
    label: 'Asia',
    countries: 'AF AM AZ BD BT BN KH CN GE HK IN ID JP KZ KP KR KG LA MO MY MV MN MM NP PK PH SG LK TW TJ TH TL TM UZ VN',
  },
  europe: {
    label: 'Europe',
    countries: 'AX AL AD AT BY BE BA BG HR CY CZ DK EE FO FI FR DE GI GR GG HU IS IE IM IT JE XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB VA',
  },
  'middle-east': {
    label: 'the Middle East',
    countries: 'BH EG IR IQ IL JO KW LB OM PS QA SA SY TR AE YE',
  },
  oceania: {
    label: 'Oceania',
    countries: 'AS AU CK FJ PF GU KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV VU WF',
  },
} as const

export type RegionId = keyof typeof REGIONS
export const REGION_IDS = Object.keys(REGIONS) as RegionId[]

/** A region's two-letter country codes */
export function regionCountries(id: RegionId): string[] {
  return REGIONS[id].countries.split(' ')
}

/** Every country code the regions name, each once */
export function allRegionCountries(): string[] {
  return [...new Set(REGION_IDS.flatMap(regionCountries))]
}
