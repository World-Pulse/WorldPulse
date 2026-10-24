/**
 * WorldPulse OSINT Signal Sources
 *
 * Aggregates real-time global intelligence feeds beyond RSS/news scraping:
 *   - GDELT Project — geopolitical conflict event database (15-min updates)
 *   - OpenSky Network ADS-B — aviation emergency squawk codes (5-min polls)
 *   - aisstream.io AIS — maritime vessel distress signals (real-time WS, optional)
 *   - USGS Seismic — earthquake events magnitude >= 4.5 (5-min polls)
 *   - NASA FIRMS — active fire hotspots via VIIRS satellite (30-min polls)
 *   - NOAA SWPC — space weather alerts: geomagnetic/solar/radio (10-min polls)
 *   - GPS/GNSS Jamming Intelligence — multi-source jamming detection with military/spoofing/civilian classification (30-min polls)
 *   - Georgia Tech IODA — internet outage alerts by country/ASN (10-min polls)
 *   - CelesTrak — switched off Oct 21, 2026 (see below)
 *   - US Navy CSG Tracker — all 11 carrier strike groups via USNI News RSS (30-min polls)
 *   - WHO Disease Outbreak News — official WHO disease outbreak notifications (30-min polls)
 *   - IAEA Nuclear Events — nuclear safety incidents & radiation events (30-min polls)
 *   - Market Intelligence — VIX, S&P 500, NASDAQ, BTC, Crude Oil via Yahoo Finance (15-min polls)
 *
 *   - ACLED Conflict & Protest — armed conflict, protests, riots, political violence (30-min polls)
 *   - Safecast Radiation — crowdsourced environmental radiation monitoring (30-min polls)
 *   - CISA KEV Cybersecurity — actively exploited vulnerabilities catalog (30-min polls)
 *   - OFAC Sanctions — US Treasury sanctions designations & SDN updates (30-min polls)
 *   - UN ReliefWeb — humanitarian crises, disasters & emergencies (30-min polls)
 *
 *   - NWS Severe Weather — NOAA National Weather Service CAP alerts (10-min polls)
 *   - AlienVault OTX — community cyber threat intelligence pulses (30-min polls)
 *   - USGS/GVP Volcanic Activity — eruptions, unrest, and volcanic hazards (30-min polls)
 *
 *   - EU CFSP Sanctions — European Council sanctions regimes & designations (60-min polls)
 *   - Power Grid Outages — US power disruptions via crowdsourced monitoring (30-min polls)
 *   - Aviation Safety Incidents — aircraft accidents/incidents via ASN (60-min polls)
 *
 *   - UNHCR Population Displacement — refugee situations and forced displacement (60-min polls)
 *   - NOAA Tsunami Warnings — Pacific/Atlantic tsunami bulletins from NTWC/PTWC (10-min polls)
 *   - Interpol Red Notices — international wanted persons and law enforcement alerts (60-min polls)
 *   - UN Comtrade Commodity Flows — strategic commodity trade flows: oil, uranium, arms, semiconductors (60-min polls)
 *   - USPTO PatentsView — defense & dual-use patent grants: weapons, nuclear, cyber, autonomous systems (60-min polls)
 *   - USDA Weekly Export Sales — US farm exports by commodity and buyer country, weekly (3-hour polls)
 *   - CFTC Commitments of Traders — hedge funds' positions in 23 futures markets, weekly (2-hour polls)
 *   - Lloyd's List headlines — the free feed it offers websites, credited, no AI (30-min polls)
 *   - World Bank World Development Indicators — country economics, CC BY 4.0 (daily)
 *
 * 29 OSINT feeds + 25 global news RSS feeds (54 total).
 *
 * Usage:
 *   const stopOsint = startOsintPollers(db, redis, producer)
 *   // later:
 *   stopOsint()
 */

import type { Knex } from 'knex'
import type Redis from 'ioredis'
import type { Producer } from 'kafkajs'
import { logger } from '../lib/logger'
import { createOsintWatchdog } from '../lib/osint-watchdog'
import { startGdeltPoller } from './gdelt'
import { startAdsbPoller } from './adsb'
import { startAisPoller } from './ais'
import { startSeismicPoller } from './seismic'
import { startFirmsPoller } from './firms'
import { startSpaceWeatherPoller } from './spaceweather'
import { startGpsJammingPoller } from './gps-jamming'
// Migrated from gpsjam.ts → gps-jamming.ts (enhanced multi-source replacement).
// gps-jamming.ts adds military/spoofing/civilian classification, known hotspot
// enrichment, configurable thresholds, and 4-hour dedup TTL.
// Dedup key prefix shared (`gpsjam:dedup:`) to prevent duplicate signals.
import { startIodaPoller } from './ioda'
import { startCarrierStrikeGroupPoller } from './carrier-strike-groups'
import { startWhoPoller } from './who'
import { startIaeaPoller } from './iaea'
import { startMarketPoller } from './market'
import { startAcledPoller } from './acled'
import { startSafecastPoller } from './safecast'
import { startCisaKevPoller } from './cisa-kev'
import { startOfacSanctionsPoller } from './ofac-sanctions'
import { startReliefWebPoller } from './reliefweb'
import { startNwsAlertsPoller } from './nws-alerts'
import { startOtxPoller, otxEnabled } from './otx-threats'
import { startGvpVolcanoPoller } from './gvp-volcano'
import { startEuSanctionsPoller } from './eu-sanctions'
import { startTsunamiWarningPoller } from './tsunami-warnings'
import { startInterpolNoticesPoller } from './interpol-notices'
import { startComtradePoller } from './comtrade'
import { startUsdaExportSalesPoller } from './usda-export-sales'
import { startCftcCotPoller } from './cftc-cot'
import { startUsdaPsdPoller } from './usda-psd'
import { startWorldBankPricesPoller } from './worldbank-prices'
import { startBaciTradePoller } from './baci-trade'
import { startLloydsListPoller } from './lloyds-list'
import { startWorldBankWdiPoller } from './worldbank-wdi'
import { startCommodityWatch } from '../commodity/watch'
import { startNewsRssPoller, NEWS_SOURCE_REGISTRY } from './news-rss'

export type OsintCleanupFn = () => void

/**
 * Start all OSINT signal pollers.
 * Returns a cleanup function that stops all pollers.
 */
export function startOsintPollers(
  db: Knex,
  redis: Redis,
  producer?: Producer | null,
): OsintCleanupFn {
  logger.info('🛰️  Starting signal pollers (54 feeds: 29 OSINT + 25 global news RSS outlets)')

  // ── OSINT Heartbeat Watchdog ─────────────────────────────────────────────────
  // Fixes stability tracker blind spot: sources that poll but find 0 new signals
  // (dedup cache hits / quiet monitoring periods) never call insertAndCorrelate,
  // so their last_seen goes stale and may fail the 70% quorum check.
  // The watchdog writes a recordPollHeartbeat every 4 minutes for any source
  // whose last_seen is > 8 minutes old, keeping all 29 sources visible.
  const watchdog = createOsintWatchdog(redis)

  const cleanups: OsintCleanupFn[] = []

  try {
    cleanups.push(startGdeltPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start GDELT poller')
  }

  try {
    cleanups.push(startAdsbPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start ADS-B poller')
  }

  try {
    cleanups.push(startAisPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start AIS poller')
  }

  try {
    cleanups.push(startSeismicPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start Seismic poller')
  }

  try {
    cleanups.push(startFirmsPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start FIRMS poller')
  }

  try {
    cleanups.push(startSpaceWeatherPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start Space Weather poller')
  }

  try {
    cleanups.push(startGpsJammingPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start GPS Jamming poller')
  }

  try {
    cleanups.push(startIodaPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start IODA internet outage poller')
  }

  try {
    cleanups.push(startCarrierStrikeGroupPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start Carrier Strike Group poller')
  }

  try {
    cleanups.push(startWhoPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start WHO Disease Outbreak poller')
  }

  try {
    cleanups.push(startIaeaPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start IAEA nuclear events poller')
  }

  try {
    cleanups.push(startMarketPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start Market Intelligence poller')
  }

  try {
    cleanups.push(startAcledPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start ACLED conflict/protest poller')
  }

  try {
    cleanups.push(startSafecastPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start Safecast radiation poller')
  }

  try {
    cleanups.push(startCisaKevPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start CISA KEV cybersecurity poller')
  }

  try {
    cleanups.push(startOfacSanctionsPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start OFAC Sanctions poller')
  }

  try {
    cleanups.push(startReliefWebPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start ReliefWeb humanitarian poller')
  }

  try {
    cleanups.push(startNwsAlertsPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start NWS severe weather poller')
  }

  try {
    cleanups.push(startOtxPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start AlienVault OTX threat poller')
  }

  try {
    cleanups.push(startGvpVolcanoPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start GVP/USGS volcano alert poller')
  }

  try {
    cleanups.push(startEuSanctionsPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start EU CFSP Sanctions poller')
  }

  try {
    cleanups.push(startTsunamiWarningPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start Tsunami Warning poller')
  }

  try {
    cleanups.push(startInterpolNoticesPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start Interpol Notices poller')
  }

  try {
    cleanups.push(startComtradePoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start UN Comtrade commodity flows poller')
  }

  // USDA's Weekly Export Sales (Oct 23, 2026): public files, no key
  try {
    cleanups.push(startUsdaExportSalesPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start USDA export sales poller')
  }

  // CFTC Commitments of Traders (Oct 23, 2026): the regulator's weekly positions in CME's and
  // ICE's markets, free to reuse (CME's own data needs a licence)
  try {
    cleanups.push(startCftcCotPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start CFTC Commitments of Traders poller')
  }

  // The commodity watch's data (Oct 23, 2026): USDA's world crop forecasts (every crop and country)
  // and the World Bank's monthly prices, both free to reuse; kept in Redis, no reports of their own
  try {
    cleanups.push(startUsdaPsdPoller(redis))
  } catch (err) {
    logger.error({ err }, 'Failed to start USDA PSD poller')
  }

  try {
    cleanups.push(startWorldBankPricesPoller(redis))
  } catch (err) {
    logger.error({ err }, 'Failed to start World Bank prices poller')
  }

  // Trade partners (Oct 23, 2026): CEPII's BACI, every country's farm trade with every other, yearly
  try {
    cleanups.push(startBaciTradePoller(redis))
  } catch (err) {
    logger.error({ err }, 'Failed to start BACI trade partners poller')
  }

  // Lloyd's List's headlines (Oct 23, 2026): the free feed it offers websites, shown credited with a
  // link to each article; never summarized, classified or stored as signals
  try {
    cleanups.push(startLloydsListPoller(redis))
  } catch (err) {
    logger.error({ err }, "Failed to start Lloyd's List headlines poller")
  }

  // Country economics (Oct 23, 2026): the World Bank's World Development Indicators (CC BY 4.0), daily
  try {
    cleanups.push(startWorldBankWdiPoller(redis))
  } catch (err) {
    logger.error({ err }, 'Failed to start World Bank country economics poller')
  }

  // The commodity watch (Oct 23, 2026): weather over every crop region, a card per commodity and
  // country, a flag in the feed when a supply risk isn't in the news, and its calls against USDA's
  try {
    cleanups.push(startCommodityWatch(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start the commodity watch')
  }

  // Switched off (October 2026) because their APIs no longer answer; the code
  // stays so they can come back once there is a working source:
  //   power-outage        PowerOutage.us's JSON needs a paid key now (HTTP 401)
  //   unhcr-displacement  api.unhcr.org has no /situations endpoint (HTTP 404)
  //   uspto-patents       PatentsView's API paused on March 20, 2026 while it
  //                       moves to the USPTO Open Data Portal (needs a key)
  //   aviation-incidents  aviation-safety.net answers every feed request with a
  //                       Cloudflare browser check (HTTP 403)
  //   celestrak           (Oct 21, 2026) downloaded CelesTrak's whole catalogue
  //                       every 30 minutes, where CelesTrak asks for no more
  //                       than once every 2 hours, for an hourly count of
  //                       satellites as a signal; the server's requests to
  //                       celestrak.org now time out. The World Map's
  //                       Satellites layer asks CelesTrak itself
  //                       (apps/web/src/lib/map-satellites.ts)

  // ── Global News RSS (25 international outlets) ──────────────────────────
  try {
    cleanups.push(startNewsRssPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start Global News RSS poller')
  }

  logger.info(`✅ ${cleanups.length} signal poller(s) active (OSINT + news RSS)`)

  // ── Register all 54 signal sources with the watchdog ───────────────────────
  // Each entry: (sourceId, humanName, slug) — sourceId must match the value
  // passed to insertAndCorrelate's meta.sourceId in each source file.
  const OSINT_REGISTRY: Array<[string, string, string]> = [
    ['gdelt',              'GDELT 2.0 Events',               'gdelt'],
    ['adsb',               'ADS-B Aviation',                 'adsb'],
    ['ais',                'AIS Maritime',                   'ais'],
    ['seismic',            'USGS Seismic',                   'seismic'],
    ['firms',              'NASA FIRMS Fire',                'firms'],
    ['spaceweather',       'NOAA Space Weather',             'spaceweather'],
    ['gps-jamming',        'GPS/GNSS Jamming Intelligence',   'gps-jamming'],
    ['ioda',               'IODA Internet Outages',          'ioda'],
    ['carrier-strike-groups', 'US Navy CSG Tracker',        'carrier-strike-groups'],
    ['who',                'WHO Disease Outbreak',           'who'],
    ['iaea',               'IAEA Nuclear Events',            'iaea'],
    ['market',             'Market Intelligence',            'market'],
    ['acled',              'ACLED Conflict & Protest',       'acled'],
    ['safecast',           'Safecast Radiation',             'safecast'],
    ['cisa-kev',           'CISA KEV Cybersecurity',         'cisa-kev'],
    ['ofac-sanctions',     'OFAC Sanctions',                 'ofac-sanctions'],
    ['reliefweb',          'UN ReliefWeb',                   'reliefweb'],
    ['nws-alerts',         'NWS Severe Weather',             'nws-alerts'],
    ['gvp-volcano',        'GVP/USGS Volcano',               'gvp-volcano'],
    ['eu-sanctions',       'EU CFSP Sanctions',              'eu-sanctions'],
    ['tsunami-warnings',   'NOAA Tsunami Warnings',          'tsunami-warnings'],
    ['interpol-notices',   'Interpol Red Notices',           'interpol-notices'],
    ['comtrade',           'UN Comtrade Commodity Flows',    'comtrade'],
    ['usda-export-sales',  'USDA Weekly Export Sales',       'usda-export-sales'],
    ['cftc-cot',           'CFTC Commitments of Traders',    'cftc-cot'],
    ['commodity-watch',    'WorldPulse commodity watch',     'commodity-watch'],
    // OTX only runs with an API key, so it is only watched with one
    ...(otxEnabled() ? [['otx-threats', 'AlienVault OTX', 'otx-threats'] as [string, string, string]] : []),
  ]

  // Register all 25 news RSS sources from the registry dynamically
  const NEWS_REGISTRY: Array<[string, string, string]> = NEWS_SOURCE_REGISTRY.map(
    src => [src.id, src.name, src.id],
  )

  const ALL_SOURCES_REGISTRY = [...OSINT_REGISTRY, ...NEWS_REGISTRY]

  for (const [id, name, slug] of ALL_SOURCES_REGISTRY) {
    watchdog.register(id, name, slug)
  }

  // Start the watchdog cron — fires every 4 minutes, heartbeats any source
  // whose last_seen is >8 min stale (22-min buffer before the 30-min stale cutoff)
  const stopWatchdog = watchdog.start()
  cleanups.push(stopWatchdog)

  return () => {
    cleanups.forEach(fn => fn())
    logger.info('All signal pollers stopped (OSINT + news RSS)')
  }
}

export { startGdeltPoller } from './gdelt'
export { startAdsbPoller } from './adsb'
export { startAisPoller } from './ais'
export { startSeismicPoller } from './seismic'
export { startFirmsPoller } from './firms'
export { startSpaceWeatherPoller } from './spaceweather'
export { startGpsJammingPoller } from './gps-jamming'
export { startIodaPoller } from './ioda'
export { startCelesTrakPoller } from './celestrak'
export { startCarrierStrikeGroupPoller } from './carrier-strike-groups'
export { startWhoPoller } from './who'
export { startIaeaPoller } from './iaea'
export { startMarketPoller } from './market'
export { startAcledPoller } from './acled'
export { startSafecastPoller } from './safecast'
export { startCisaKevPoller } from './cisa-kev'
export { startOfacSanctionsPoller } from './ofac-sanctions'
export { startReliefWebPoller } from './reliefweb'
export { startNwsAlertsPoller } from './nws-alerts'
export { startOtxPoller } from './otx-threats'
export { startGvpVolcanoPoller } from './gvp-volcano'
export { startEuSanctionsPoller } from './eu-sanctions'
export { startPowerOutagePoller } from './power-outage'
export { startAviationIncidentPoller } from './aviation-incidents'
export { startUnhcrDisplacementPoller } from './unhcr-displacement'
export { startTsunamiWarningPoller } from './tsunami-warnings'
export { startInterpolNoticesPoller } from './interpol-notices'
export { startComtradePoller } from './comtrade'
export { startUsdaExportSalesPoller } from './usda-export-sales'
export { startCftcCotPoller } from './cftc-cot'
export { startUsdaPsdPoller } from './usda-psd'
export { startWorldBankPricesPoller } from './worldbank-prices'
export { startBaciTradePoller } from './baci-trade'
export { startLloydsListPoller } from './lloyds-list'
export { startWorldBankWdiPoller } from './worldbank-wdi'
export { startPatentsPoller } from './patents'
export { startNewsRssPoller, NEWS_SOURCE_REGISTRY } from './news-rss'
