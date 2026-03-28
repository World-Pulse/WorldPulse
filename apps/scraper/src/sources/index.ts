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
 *   - GPSJam.org — GPS jamming hotspots (15-min polls, crowdsourced ADS-B anomaly)
 *   - Georgia Tech IODA — internet outage alerts by country/ASN (10-min polls)
 *   - CelesTrak — active satellite catalog, launches & re-entries (30-min polls)
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
 *
 * 27 OSINT feeds total. Full parity with Crucix's 27-feed advantage achieved.
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
import { startGdeltPoller } from './gdelt'
import { startAdsbPoller } from './adsb'
import { startAisPoller } from './ais'
import { startSeismicPoller } from './seismic'
import { startFirmsPoller } from './firms'
import { startSpaceWeatherPoller } from './spaceweather'
import { startGpsJamPoller } from './gpsjam'
import { startIodaPoller } from './ioda'
import { startCelesTrakPoller } from './celestrak'
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
import { startOtxPoller } from './otx-threats'
import { startGvpVolcanoPoller } from './gvp-volcano'
import { startEuSanctionsPoller } from './eu-sanctions'
import { startPowerOutagePoller } from './power-outage'
import { startAviationIncidentPoller } from './aviation-incidents'
import { startUnhcrDisplacementPoller } from './unhcr-displacement'
import { startTsunamiWarningPoller } from './tsunami-warnings'
import { startInterpolNoticesPoller } from './interpol-notices'

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
  logger.info('🛰️  Starting OSINT signal pollers (27 feeds: GDELT + ADS-B + AIS + Seismic + FIRMS + Space Weather + GPS Jamming + IODA + CelesTrak + CSG + WHO + IAEA + Market + ACLED + Safecast + CISA KEV + OFAC Sanctions + ReliefWeb + NWS Weather + OTX Threats + GVP Volcano + EU Sanctions + Power Grid + Aviation Safety + UNHCR Displacement + Tsunami Warnings + Interpol Notices)')

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
    cleanups.push(startGpsJamPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start GPS Jamming poller')
  }

  try {
    cleanups.push(startIodaPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start IODA internet outage poller')
  }

  try {
    cleanups.push(startCelesTrakPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start CelesTrak satellite poller')
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
    cleanups.push(startPowerOutagePoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start Power Grid Outage poller')
  }

  try {
    cleanups.push(startAviationIncidentPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start Aviation Safety Incident poller')
  }

  try {
    cleanups.push(startUnhcrDisplacementPoller(db, redis, producer))
  } catch (err) {
    logger.error({ err }, 'Failed to start UNHCR Displacement poller')
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

  logger.info(`✅ ${cleanups.length} OSINT poller(s) active`)

  return () => {
    cleanups.forEach(fn => fn())
    logger.info('All OSINT pollers stopped')
  }
}

export { startGdeltPoller } from './gdelt'
export { startAdsbPoller } from './adsb'
export { startAisPoller } from './ais'
export { startSeismicPoller } from './seismic'
export { startFirmsPoller } from './firms'
export { startSpaceWeatherPoller } from './spaceweather'
export { startGpsJamPoller } from './gpsjam'
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
