/**
 * Country economics (Oct 23, 2026; Devon: "Add ... the Lloyd's Bank like data and layers to the map").
 *
 * The Lloyds Bank International Trade Portal's country profiles are for its users only; the same kind
 * of figures come from the World Bank's World Development Indicators, licensed CC BY 4.0 (commercial
 * use allowed with credit; the API may serve them to another site): GDP, growth, GDP per person,
 * inflation, unemployment, trade, exports and imports, the current account and population, each
 * country's latest year. (The IMF's World Economic Outlook asks for permission before commercial reuse
 * and bans automated bulk download, so it isn't used.)
 *   https://api.worldbank.org/v2/country/all/indicator/<code>?format=json&mrnev=1
 *
 * Read daily (11 small requests); an indicator that fails keeps its last values.
 */

import type Redis from 'ioredis'
import { logger as rootLogger } from '../lib/logger'
import { countryName } from '../commodity/countries'

const log = rootLogger.child({ module: 'worldbank-wdi' })

export const SOURCE_ID = 'worldbank-wdi'
export const ECONOMICS_KEY = 'country:economics:latest'
const API = 'https://api.worldbank.org/v2'
const POLL_INTERVAL_MS = 24 * 3_600_000
const USER_AGENT = 'WorldPulse/1.0 (https://world-pulse.io; country economics)'
export const CREDIT = 'World Bank, World Development Indicators'
export const LICENCE = 'CC BY 4.0'
export const LINK = 'https://data.worldbank.org'

export type Unit = 'usd' | 'pct' | 'pct_gdp' | 'people'
export interface Indicator { key: string; code: string; name: string; unit: Unit }

export const INDICATORS: Indicator[] = [
  { key: 'gdp', code: 'NY.GDP.MKTP.CD', name: 'GDP', unit: 'usd' },
  { key: 'growth', code: 'NY.GDP.MKTP.KD.ZG', name: 'GDP growth', unit: 'pct' },
  { key: 'gdp_per_person', code: 'NY.GDP.PCAP.CD', name: 'GDP per person', unit: 'usd' },
  { key: 'inflation', code: 'FP.CPI.TOTL.ZG', name: 'Inflation', unit: 'pct' },
  { key: 'unemployment', code: 'SL.UEM.TOTL.ZS', name: 'Unemployment', unit: 'pct' },
  { key: 'trade', code: 'NE.TRD.GNFS.ZS', name: 'Trade (exports plus imports)', unit: 'pct_gdp' },
  { key: 'exports', code: 'NE.EXP.GNFS.CD', name: 'Exports of goods and services', unit: 'usd' },
  { key: 'imports', code: 'NE.IMP.GNFS.CD', name: 'Imports of goods and services', unit: 'usd' },
  { key: 'current_account', code: 'BN.CAB.XOKA.GD.ZS', name: 'Current account balance', unit: 'pct_gdp' },
  { key: 'population', code: 'SP.POP.TOTL', name: 'Population', unit: 'people' },
]

export interface Reading { value: number; year: number }
export interface CountryEconomics {
  name: string
  region: string | null
  income: string | null
  values: Record<string, Reading>
}
export interface EconomicsSnapshot {
  updated_at: string
  source: typeof CREDIT
  licence: typeof LICENCE
  link: typeof LINK
  indicators: Indicator[]
  countries: Record<string, CountryEconomics>
}

export interface WdiCountry { iso2: string; name: string; region: string | null; income: string | null }

/** The World Bank's own short forms ("Egypt, Arab Rep.") in plain names */
const NAMES: Record<string, string> = {
  EG: 'Egypt', IR: 'Iran', KR: 'South Korea', KP: 'North Korea', CD: 'DR Congo', CG: 'Congo', VE: 'Venezuela',
  YE: 'Yemen', GM: 'Gambia', BS: 'Bahamas', LA: 'Laos', KG: 'Kyrgyzstan', SK: 'Slovakia', RU: 'Russia', VN: 'Vietnam',
  SY: 'Syria', FM: 'Micronesia', HK: 'Hong Kong', MO: 'Macau', PS: 'Palestine', CV: 'Cape Verde', TR: 'Turkey',
  CZ: 'Czechia', LC: 'Saint Lucia', VC: 'Saint Vincent and the Grenadines', KN: 'Saint Kitts and Nevis', MF: 'Saint Martin',
  SX: 'Sint Maarten', VI: 'US Virgin Islands', ST: 'São Tomé and Príncipe', CI: "Côte d'Ivoire", CW: 'Curaçao', TW: 'Taiwan',
}

/** The World Bank's countries (aggregates such as "World" and "Euro area" left out), by their ISO alpha-3 code */
export function readCountries(json: unknown): Map<string, WdiCountry> {
  const out = new Map<string, WdiCountry>()
  const rows = Array.isArray(json) && Array.isArray(json[1]) ? json[1] as Array<Record<string, unknown>> : []
  for (const r of rows) {
    const iso3 = String(r.id ?? ''), iso2 = String(r.iso2Code ?? '')
    const region = (r.region ?? {}) as { value?: string; id?: string }
    if (!/^[A-Z]{3}$/.test(iso3) || !/^[A-Z]{2}$/.test(iso2) || /aggregates/i.test(region.value ?? '') || region.id === 'NA') continue
    const income = (r.incomeLevel ?? {}) as { value?: string }
    out.set(iso3, {
      iso2,
      name: NAMES[iso2] ?? countryName(iso2, String(r.name ?? iso2).trim()),
      region: region.value?.trim() || null,
      income: income.value?.trim() && income.value.trim() !== 'Not classified' ? income.value.trim() : null,
    })
  }
  return out
}

/** An indicator's latest value per country (ISO alpha-2), from the API's "most recent non-empty value" answer */
export function readIndicator(json: unknown, countries: ReadonlyMap<string, WdiCountry>): Map<string, Reading> {
  const out = new Map<string, Reading>()
  const rows = Array.isArray(json) && Array.isArray(json[1]) ? json[1] as Array<Record<string, unknown>> : []
  for (const r of rows) {
    const c = countries.get(String(r.countryiso3code ?? ''))
    const value = r.value, year = Number(r.date)
    if (!c || typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(year)) continue
    out.set(c.iso2, { value: Math.round(value * 1000) / 1000, year })
  }
  return out
}

/** The readings into one snapshot, keeping an indicator's stored values when it couldn't be read */
export function buildSnapshot(
  countries: ReadonlyMap<string, WdiCountry>,
  readings: ReadonlyMap<string, Map<string, Reading> | null>,
  previous: EconomicsSnapshot | null,
  now = new Date(),
): EconomicsSnapshot {
  const out: Record<string, CountryEconomics> = {}
  for (const c of countries.values()) out[c.iso2] = { name: c.name, region: c.region, income: c.income, values: {} }
  for (const ind of INDICATORS) {
    const fresh = readings.get(ind.key)
    for (const [iso, entry] of Object.entries(out)) {
      const r = fresh ? fresh.get(iso) : previous?.countries[iso]?.values[ind.key]
      if (r) entry.values[ind.key] = r
    }
  }
  for (const [iso, entry] of Object.entries(out)) if (!Object.keys(entry.values).length) delete out[iso]
  return { updated_at: now.toISOString(), source: CREDIT, licence: LICENCE, link: LINK, indicators: INDICATORS, countries: out }
}

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) })
      // The API answers some errors with an XML page and a 200
      const text = await res.text()
      if (res.ok && /^\s*\[/.test(text)) return JSON.parse(text)
      log.warn({ status: res.status, url, start: text.slice(0, 80) }, 'World Bank: unexpected answer')
    } catch (err) {
      log.warn({ err, url }, 'World Bank: request failed')
    }
    await new Promise(r => setTimeout(r, 5_000))
  }
  return null
}

export function startWorldBankWdiPoller(redis: Redis): () => void {
  let running = false

  async function poll(): Promise<void> {
    if (running) return
    running = true
    try {
      const countries = readCountries(await getJson(`${API}/country?format=json&per_page=400`))
      if (countries.size < 150) { log.warn({ countries: countries.size }, 'World Bank: country list not read'); return }
      const readings = new Map<string, Map<string, Reading> | null>()
      for (const ind of INDICATORS) {
        const json = await getJson(`${API}/country/all/indicator/${encodeURIComponent(ind.code)}?format=json&mrnev=1&per_page=500`)
        const values = json ? readIndicator(json, countries) : null
        readings.set(ind.key, values && values.size >= 100 ? values : null)
        await new Promise(r => setTimeout(r, 1_500))
      }
      const raw = await redis.get(ECONOMICS_KEY)
      let previous: EconomicsSnapshot | null = null
      try { previous = raw ? JSON.parse(raw) as EconomicsSnapshot : null } catch { previous = null }
      const snapshot = buildSnapshot(countries, readings, previous)
      const failed = [...readings].filter(([, v]) => !v).map(([k]) => k)
      if (Object.keys(snapshot.countries).length < 150) { log.warn({ failed }, 'World Bank: too few countries; keeping the last snapshot'); return }
      await redis.set(ECONOMICS_KEY, JSON.stringify(snapshot))
      log.info({ countries: Object.keys(snapshot.countries).length, failed }, 'World Bank: country economics read')
    } catch (err) {
      log.error({ err }, 'World Bank country economics poll error')
    } finally {
      running = false
    }
  }

  const first = setTimeout(() => { void poll() }, 6 * 60_000)
  const timer = setInterval(() => { void poll() }, POLL_INTERVAL_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
    log.info('World Bank country economics poller stopped')
  }
}
