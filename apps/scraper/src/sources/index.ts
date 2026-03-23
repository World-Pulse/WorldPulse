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
 * 13 OSINT feeds total. Counters Crucix's 27-feed advantage.
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
  logger.info('🛰️  Starting OSINT signal pollers (GDELT + ADS-B + AIS + Seismic + FIRMS + Space Weather + GPS Jamming + IODA + CelesTrak + CSG + WHO + IAEA + Market Intelligence)')

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
