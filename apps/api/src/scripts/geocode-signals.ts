/**
 * Geocode Backfill Script
 *
 * One-time script to populate PostGIS location geometry for signals
 * that have a location_name but no location point.
 *
 * Usage:
 *   DATABASE_URL=<postgres_url> npx ts-node --project tsconfig.json apps/api/src/scripts/geocode-signals.ts
 *
 * Rate limited to 1 req/s to comply with Nominatim ToS.
 */

import { Pool } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required')
  process.exit(1)
}

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org'
const USER_AGENT = 'WorldPulse/1.0 (geocode-backfill; contact: admin@worldpulse.io)'
const BATCH_SIZE = 100
const RATE_LIMIT_MS = 1100 // slightly over 1s per Nominatim ToS

interface SignalRow {
  id: string
  location_name: string
}

interface NominatimResult {
  lat: string
  lon: string
  display_name: string
  address?: {
    country_code?: string
    state?: string
    region?: string
  }
}

let lastNominatimCall = 0

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function throttle(): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastNominatimCall
  if (elapsed < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - elapsed)
  }
  lastNominatimCall = Date.now()
}

async function geocode(locationName: string): Promise<{ lat: number; lon: number; countryCode?: string } | null> {
  await throttle()

  const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(locationName)}&format=json&limit=1&addressdetails=1`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en',
      },
    })

    if (!res.ok) {
      console.warn(`  [geocode] Nominatim HTTP ${res.status} for "${locationName}"`)
      return null
    }

    const results = await res.json() as NominatimResult[]
    if (!results || results.length === 0) {
      return null
    }

    const r = results[0]
    return {
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      countryCode: r.address?.country_code?.toUpperCase(),
    }
  } catch (err) {
    console.warn(`  [geocode] fetch error for "${locationName}":`, err)
    return null
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL })

  try {
    // Count total signals needing geocoding
    const countRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM signals
       WHERE location IS NULL
         AND location_name IS NOT NULL
         AND location_name <> ''`
    )
    const total = parseInt(countRes.rows[0].count, 10)
    console.log(`\n🌍 WorldPulse Geocode Backfill`)
    console.log(`   Signals needing geocoding: ${total}`)

    if (total === 0) {
      console.log('   Nothing to do — all signals already geocoded.')
      return
    }

    let processed = 0
    let geocoded  = 0
    let failed    = 0
    let offset    = 0

    while (true) {
      // Fetch next batch
      const batchRes = await pool.query<SignalRow>(
        `SELECT id, location_name FROM signals
         WHERE location IS NULL
           AND location_name IS NOT NULL
           AND location_name <> ''
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [BATCH_SIZE, offset]
      )

      const rows = batchRes.rows
      if (rows.length === 0) break

      for (const row of rows) {
        processed++

        const result = await geocode(row.location_name)

        if (result) {
          await pool.query(
            `UPDATE signals
             SET location     = ST_SetSRID(ST_MakePoint($1, $2), 4326),
                 country_code = COALESCE(country_code, $3),
                 updated_at   = NOW()
             WHERE id = $4`,
            [result.lon, result.lat, result.countryCode ?? null, row.id]
          )
          geocoded++

          if (processed % 10 === 0) {
            const pct = Math.round((processed / total) * 100)
            console.log(`   [${pct}%] ${processed}/${total} processed — ${geocoded} geocoded, ${failed} failed`)
          }
        } else {
          failed++
          if (processed % 10 === 0) {
            const pct = Math.round((processed / total) * 100)
            console.log(`   [${pct}%] ${processed}/${total} processed — ${geocoded} geocoded, ${failed} failed`)
          }
        }
      }

      // If batch was smaller than BATCH_SIZE, we're done
      if (rows.length < BATCH_SIZE) break

      // Offset stays at 0 since we're updating rows and they fall out of the WHERE clause
      // If some rows failed to geocode, we need to advance offset to avoid infinite loop
      offset += failed  // Only advance by the number that remain un-geocoded (failed rows stay in set)
    }

    console.log(`\n✅ Done!`)
    console.log(`   Total processed : ${processed}`)
    console.log(`   Geocoded        : ${geocoded}`)
    console.log(`   Could not find  : ${failed}`)
    console.log(`\n   Map at https://world-pulse.io/map should now show ${geocoded} new signals.`)

  } finally {
    await pool.end()
  }
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
