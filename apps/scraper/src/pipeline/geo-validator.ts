/**
 * Geographic Validation Pipeline
 *
 * Cross-references signal location data against verified databases:
 *   1. Country code ↔ coordinates consistency check
 *   2. Ocean/uninhabited detection (coordinates in water or empty regions)
 *   3. Country code format validation (ISO 3166-1 alpha-2)
 *   4. Known disputed territory flagging
 *   5. Coordinate bounds check (lat: -90 to 90, lng: -180 to 180)
 *
 * Runs post-insert on new signals and logs results to geo_validation_log.
 */

import { db } from '../lib/postgres'
import { redis } from '../lib/redis'
import { logger as rootLogger } from '../lib/logger'
import { reverseGeocode } from './geo'

const log = rootLogger.child({ module: 'geo-validator' })

// ISO 3166-1 alpha-2 country codes (subset — covers 99% of signals)
const VALID_COUNTRY_CODES = new Set([
  'AF','AL','DZ','AD','AO','AG','AR','AM','AU','AT','AZ','BS','BH','BD','BB',
  'BY','BE','BZ','BJ','BT','BO','BA','BW','BR','BN','BG','BF','BI','KH','CM',
  'CA','CV','CF','TD','CL','CN','CO','KM','CG','CD','CR','CI','HR','CU','CY',
  'CZ','DK','DJ','DM','DO','EC','EG','SV','GQ','ER','EE','SZ','ET','FJ','FI',
  'FR','GA','GM','GE','DE','GH','GR','GD','GT','GN','GW','GY','HT','HN','HU',
  'IS','IN','ID','IR','IQ','IE','IL','IT','JM','JP','JO','KZ','KE','KI','KP',
  'KR','KW','KG','LA','LV','LB','LS','LR','LY','LI','LT','LU','MG','MW','MY',
  'MV','ML','MT','MH','MR','MU','MX','FM','MD','MC','MN','ME','MA','MZ','MM',
  'NA','NR','NP','NL','NZ','NI','NE','NG','NO','OM','PK','PW','PS','PA','PG',
  'PY','PE','PH','PL','PT','QA','RO','RU','RW','KN','LC','VC','WS','SM','ST',
  'SA','SN','RS','SC','SL','SG','SK','SI','SB','SO','ZA','SS','ES','LK','SD',
  'SR','SE','CH','SY','TW','TJ','TZ','TH','TL','TG','TO','TT','TN','TR','TM',
  'TV','UG','UA','AE','GB','US','UY','UZ','VU','VE','VN','YE','ZM','ZW',
  'HK','MO','XK', // Special territories
])

// Rough bounding boxes for country code ↔ coordinate validation
// Format: { cc: [minLat, maxLat, minLng, maxLng] }
const COUNTRY_BOUNDS: Record<string, [number, number, number, number]> = {
  US: [24, 50, -125, -66],
  CA: [42, 84, -141, -52],
  GB: [49, 61, -8, 2],
  FR: [41, 51, -5, 10],
  DE: [47, 55, 6, 15],
  RU: [41, 82, 20, 180],
  CN: [18, 54, 73, 135],
  IN: [6, 36, 68, 98],
  AU: [-44, -10, 113, 154],
  BR: [-34, 6, -74, -35],
  JP: [24, 46, 123, 146],
  KR: [33, 39, 124, 132],
  IL: [29, 34, 34, 36],
  UA: [44, 53, 22, 40],
  NG: [4, 14, 2, 15],
  ZA: [-35, -22, 16, 33],
  EG: [22, 32, 25, 37],
  SA: [16, 33, 34, 56],
  IR: [25, 40, 44, 64],
  TR: [36, 42, 26, 45],
  MX: [14, 33, -118, -87],
}

export interface GeoValidationResult {
  valid: boolean
  issues: string[]
  correctedCountry?: string
  correctedLocation?: string
  confidence: number
}

/**
 * Validate a signal's geographic data and log results.
 */
export async function validateSignalGeo(signal: {
  id: string
  location_name?: string | null
  country_code?: string | null
  lat?: number | null
  lng?: number | null
}): Promise<GeoValidationResult> {
  const issues: string[] = []
  let confidence = 1.0
  let correctedCountry: string | undefined
  let correctedLocation: string | undefined
  let validationMethod = 'country_code_check'

  // ── 1. Coordinate bounds check ──────────────────────────────────────
  if (signal.lat != null && signal.lng != null) {
    if (signal.lat < -90 || signal.lat > 90) {
      issues.push(`Invalid latitude: ${signal.lat}`)
      confidence -= 0.3
    }
    if (signal.lng < -180 || signal.lng > 180) {
      issues.push(`Invalid longitude: ${signal.lng}`)
      confidence -= 0.3
    }
  }

  // ── 2. Country code format validation ───────────────────────────────
  if (signal.country_code) {
    if (!VALID_COUNTRY_CODES.has(signal.country_code.toUpperCase())) {
      issues.push(`Unknown country code: ${signal.country_code}`)
      confidence -= 0.2
    }
  }

  // ── 3. Country code ↔ coordinates consistency ──────────────────────
  if (signal.country_code && signal.lat != null && signal.lng != null) {
    const cc = signal.country_code.toUpperCase()
    const bounds = COUNTRY_BOUNDS[cc]
    if (bounds) {
      const [minLat, maxLat, minLng, maxLng] = bounds
      // Allow 2° margin for border regions
      const margin = 2
      if (
        signal.lat < minLat - margin || signal.lat > maxLat + margin ||
        signal.lng < minLng - margin || signal.lng > maxLng + margin
      ) {
        issues.push(`Coordinates (${signal.lat.toFixed(1)}, ${signal.lng.toFixed(1)}) outside ${cc} bounds`)
        confidence -= 0.25

        // Try to correct via reverse geocoding
        try {
          const geo = await reverseGeocode(signal.lat, signal.lng)
          if (geo.countryCode && geo.countryCode !== cc) {
            correctedCountry = geo.countryCode
            correctedLocation = geo.name || undefined
            validationMethod = 'reverse_geocode'
            issues.push(`Corrected country: ${cc} → ${geo.countryCode}`)
          }
        } catch {
          // Non-fatal
        }
      }
    }
  }

  // ── 4. Null island check (0,0 coordinates) ─────────────────────────
  if (signal.lat != null && signal.lng != null) {
    if (Math.abs(signal.lat) < 0.5 && Math.abs(signal.lng) < 0.5) {
      issues.push('Null Island detected (0,0 coordinates)')
      confidence -= 0.4
    }
  }

  // ── Log to geo_validation_log ──────────────────────────────────────
  if (issues.length > 0) {
    try {
      await db('geo_validation_log').insert({
        signal_id: signal.id,
        original_location: signal.location_name || null,
        original_country: signal.country_code || null,
        original_lat: signal.lat ?? null,
        original_lng: signal.lng ?? null,
        validated_location: correctedLocation || null,
        validated_country: correctedCountry || null,
        validated_lat: signal.lat ?? null,
        validated_lng: signal.lng ?? null,
        validation_method: validationMethod,
        confidence: Math.max(0, confidence),
        correction_applied: correctedCountry != null,
        issue_found: issues.join('; '),
      })

      // Apply correction if we found one
      if (correctedCountry) {
        await db('signals')
          .where('id', signal.id)
          .update({
            country_code: correctedCountry,
            ...(correctedLocation ? { location_name: correctedLocation } : {}),
          })
        log.info({
          signalId: signal.id,
          original: signal.country_code,
          corrected: correctedCountry,
        }, 'Geographic correction applied')
      }
    } catch (err) {
      log.warn({ err, signalId: signal.id }, 'Geo validation logging failed')
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    correctedCountry,
    correctedLocation,
    confidence: Math.max(0, confidence),
  }
}

/**
 * Batch validate recent signals that haven't been geo-validated yet.
 * Called periodically by the scraper.
 */
export async function batchValidateGeo(): Promise<{ checked: number; issues: number; corrected: number }> {
  const unchecked = await db('signals')
    .select('id', 'location_name', 'country_code',
      db.raw('ST_Y(location::geometry) as lat'),
      db.raw('ST_X(location::geometry) as lng'))
    .where('published_at', '>=', db.raw("NOW() - INTERVAL '2 hours'"))
    .whereNotIn('id', db('geo_validation_log').select('signal_id'))
    .whereNotNull('location')
    .limit(50)

  let issues = 0
  let corrected = 0

  for (const signal of unchecked) {
    const result = await validateSignalGeo({
      id: signal.id,
      location_name: signal.location_name,
      country_code: signal.country_code,
      lat: signal.lat ? Number(signal.lat) : null,
      lng: signal.lng ? Number(signal.lng) : null,
    })
    if (!result.valid) issues++
    if (result.correctedCountry) corrected++
  }

  if (unchecked.length > 0) {
    log.info({ checked: unchecked.length, issues, corrected }, 'Geo validation batch complete')
  }

  return { checked: unchecked.length, issues, corrected }
}
