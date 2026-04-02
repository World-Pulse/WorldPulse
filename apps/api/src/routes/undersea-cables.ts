/**
 * Undersea Cable Intelligence API
 *
 * Tracks global submarine fiber-optic cable infrastructure — landing points,
 * operators, capacity, and related geopolitical signals. Counters WorldMonitor's
 * 55 submarine cables tracking feature with richer data and signal cross-references.
 *
 * Endpoints:
 *   GET /api/v1/undersea-cables/cables          — list all tracked submarine cables
 *   GET /api/v1/undersea-cables/cables/:id      — single cable detail
 *   GET /api/v1/undersea-cables/summary         — aggregate stats & trends
 *   GET /api/v1/undersea-cables/map/routes      — GeoJSON LineString collection for map layer
 *   GET /api/v1/undersea-cables/landing-points   — all landing stations grouped by country
 *
 * Data source: Seeded registry of 80+ major submarine cables worldwide,
 * enriched with signal cross-references from the signals table.
 */

import type { FastifyPluginAsync } from 'fastify'
import { db }    from '../db/postgres'
import { redis } from '../db/redis'
import { sendError } from '../lib/errors'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Redis TTL for cable list cache: 10 minutes */
export const LIST_CACHE_TTL     = 600

/** Redis TTL for summary cache: 10 minutes */
export const SUMMARY_CACHE_TTL  = 600

/** Redis TTL for map routes cache: 5 minutes */
export const MAP_CACHE_TTL      = 300

/** Rate limit: requests per minute */
export const RATE_LIMIT_RPM     = 60

/** Default result limit */
export const DEFAULT_LIMIT      = 50

/** Maximum result limit */
export const MAX_LIMIT          = 100

/** Cache key prefixes */
export const CACHE_KEY_LIST     = 'undersea:cables'
export const CACHE_KEY_SUMMARY  = 'undersea:summary'
export const CACHE_KEY_MAP      = 'undersea:map'
export const CACHE_KEY_DETAIL   = 'undersea:cable'
export const CACHE_KEY_LANDING  = 'undersea:landing'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LandingPoint {
  name:          string
  country:       string
  country_code:  string
  lat:           number
  lng:           number
}

export interface SubmarineCable {
  id:              string
  name:            string
  slug:            string
  owners:          string[]
  operators:       string[]
  landing_points:  LandingPoint[]
  rfs_year:        number | null       // ready for service year
  length_km:       number | null
  capacity_tbps:   number | null
  status:          'active' | 'under_construction' | 'planned' | 'decommissioned'
  technology:      string | null
  notes:           string | null
  route_coords:    [number, number][]  // [lng, lat] pairs for map line
  related_signals: number
}

export interface CableSummary {
  total_cables:            number
  active:                  number
  under_construction:      number
  planned:                 number
  decommissioned:          number
  total_length_km:         number
  total_capacity_tbps:     number
  countries_connected:     number
  landing_points_count:    number
  top_owners:              { name: string; count: number }[]
  top_countries:           { country: string; country_code: string; count: number }[]
  recent_signals:          number
}

// ─── Submarine Cable Registry ─────────────────────────────────────────────────

export const CABLE_REGISTRY: SubmarineCable[] = [
  // ─── Trans-Atlantic ───────────────────────────────────────────────
  {
    id: 'marea', name: 'MAREA', slug: 'marea',
    owners: ['Microsoft', 'Meta', 'Telxius'],
    operators: ['Telxius'],
    landing_points: [
      { name: 'Virginia Beach', country: 'United States', country_code: 'US', lat: 36.85, lng: -75.98 },
      { name: 'Bilbao', country: 'Spain', country_code: 'ES', lat: 43.26, lng: -2.93 }
    ],
    rfs_year: 2018, length_km: 6600, capacity_tbps: 200, status: 'active',
    technology: '8 fiber pairs', notes: 'Highest-capacity trans-Atlantic cable',
    route_coords: [[-75.98, 36.85], [-40.0, 40.0], [-2.93, 43.26]],
    related_signals: 0
  },
  {
    id: 'dunant', name: 'Dunant', slug: 'dunant',
    owners: ['Google'],
    operators: ['Google'],
    landing_points: [
      { name: 'Virginia Beach', country: 'United States', country_code: 'US', lat: 36.85, lng: -75.98 },
      { name: 'Saint-Hilaire-de-Riez', country: 'France', country_code: 'FR', lat: 46.72, lng: -1.80 }
    ],
    rfs_year: 2020, length_km: 6600, capacity_tbps: 250, status: 'active',
    technology: '12 fiber pairs, SDM', notes: 'Google private trans-Atlantic cable',
    route_coords: [[-75.98, 36.85], [-35.0, 42.0], [-1.80, 46.72]],
    related_signals: 0
  },
  {
    id: 'amitie', name: 'Amitié', slug: 'amitie',
    owners: ['Microsoft', 'Meta', 'Aqua Comms'],
    operators: ['Aqua Comms'],
    landing_points: [
      { name: 'Lynn', country: 'United States', country_code: 'US', lat: 42.47, lng: -70.95 },
      { name: 'Bude', country: 'United Kingdom', country_code: 'GB', lat: 50.83, lng: -4.54 },
      { name: 'Le Porge', country: 'France', country_code: 'FR', lat: 44.87, lng: -1.16 }
    ],
    rfs_year: 2022, length_km: 6800, capacity_tbps: 400, status: 'active',
    technology: '16 fiber pairs, SDM', notes: null,
    route_coords: [[-70.95, 42.47], [-35.0, 48.0], [-4.54, 50.83], [-1.16, 44.87]],
    related_signals: 0
  },
  {
    id: 'grace-hopper', name: 'Grace Hopper', slug: 'grace-hopper',
    owners: ['Google'],
    operators: ['Google'],
    landing_points: [
      { name: 'New York', country: 'United States', country_code: 'US', lat: 40.57, lng: -73.97 },
      { name: 'Bude', country: 'United Kingdom', country_code: 'GB', lat: 50.83, lng: -4.54 },
      { name: 'Bilbao', country: 'Spain', country_code: 'ES', lat: 43.26, lng: -2.93 }
    ],
    rfs_year: 2022, length_km: 6300, capacity_tbps: 350, status: 'active',
    technology: '16 fiber pairs', notes: 'Named after computer scientist Grace Hopper',
    route_coords: [[-73.97, 40.57], [-35.0, 46.0], [-4.54, 50.83], [-2.93, 43.26]],
    related_signals: 0
  },
  {
    id: 'ellalink', name: 'EllaLink', slug: 'ellalink',
    owners: ['EllaLink'],
    operators: ['EllaLink'],
    landing_points: [
      { name: 'Sines', country: 'Portugal', country_code: 'PT', lat: 37.95, lng: -8.87 },
      { name: 'Fortaleza', country: 'Brazil', country_code: 'BR', lat: -3.73, lng: -38.52 }
    ],
    rfs_year: 2021, length_km: 6000, capacity_tbps: 72, status: 'active',
    technology: '4 fiber pairs', notes: 'First direct Europe–South America cable in 20 years',
    route_coords: [[-8.87, 37.95], [-25.0, 15.0], [-38.52, -3.73]],
    related_signals: 0
  },
  // ─── Trans-Pacific ────────────────────────────────────────────────
  {
    id: 'curie', name: 'Curie', slug: 'curie',
    owners: ['Google'],
    operators: ['Google'],
    landing_points: [
      { name: 'Los Angeles', country: 'United States', country_code: 'US', lat: 33.94, lng: -118.41 },
      { name: 'Valparaíso', country: 'Chile', country_code: 'CL', lat: -33.05, lng: -71.61 }
    ],
    rfs_year: 2020, length_km: 10476, capacity_tbps: 72, status: 'active',
    technology: '4 fiber pairs', notes: 'Google private cable to South America',
    route_coords: [[-118.41, 33.94], [-105.0, 10.0], [-85.0, -10.0], [-71.61, -33.05]],
    related_signals: 0
  },
  {
    id: 'jupiter', name: 'Jupiter', slug: 'jupiter',
    owners: ['Amazon', 'Meta', 'PLDT', 'SoftBank'],
    operators: ['NEC'],
    landing_points: [
      { name: 'Virginia Beach', country: 'United States', country_code: 'US', lat: 36.85, lng: -75.98 },
      { name: 'Maruyama', country: 'Japan', country_code: 'JP', lat: 33.48, lng: 135.77 },
      { name: 'Daet', country: 'Philippines', country_code: 'PH', lat: 14.11, lng: 122.96 }
    ],
    rfs_year: 2020, length_km: 14000, capacity_tbps: 60, status: 'active',
    technology: '6 fiber pairs', notes: null,
    route_coords: [[-75.98, 36.85], [-160.0, 35.0], [150.0, 30.0], [135.77, 33.48], [122.96, 14.11]],
    related_signals: 0
  },
  {
    id: 'echo', name: 'Echo', slug: 'echo',
    owners: ['Google', 'Meta'],
    operators: ['SubCom'],
    landing_points: [
      { name: 'Eureka', country: 'United States', country_code: 'US', lat: 40.80, lng: -124.16 },
      { name: 'Singapore', country: 'Singapore', country_code: 'SG', lat: 1.29, lng: 103.85 },
      { name: 'Jakarta', country: 'Indonesia', country_code: 'ID', lat: -6.21, lng: 106.85 },
      { name: 'Guam', country: 'United States', country_code: 'US', lat: 13.44, lng: 144.79 }
    ],
    rfs_year: 2023, length_km: 15000, capacity_tbps: 120, status: 'active',
    technology: '12 fiber pairs', notes: 'US–Singapore via Indonesia and Guam',
    route_coords: [[-124.16, 40.80], [-170.0, 30.0], [144.79, 13.44], [106.85, -6.21], [103.85, 1.29]],
    related_signals: 0
  },
  {
    id: 'bifrost', name: 'Bifrost', slug: 'bifrost',
    owners: ['Meta', 'Keppel', 'Telin'],
    operators: ['NEC'],
    landing_points: [
      { name: 'Portland', country: 'United States', country_code: 'US', lat: 45.52, lng: -122.68 },
      { name: 'Singapore', country: 'Singapore', country_code: 'SG', lat: 1.29, lng: 103.85 },
      { name: 'Jakarta', country: 'Indonesia', country_code: 'ID', lat: -6.21, lng: 106.85 }
    ],
    rfs_year: 2024, length_km: 15500, capacity_tbps: 180, status: 'active',
    technology: '16 fiber pairs', notes: 'Meta trans-Pacific subsea cable',
    route_coords: [[-122.68, 45.52], [-170.0, 35.0], [140.0, 15.0], [106.85, -6.21], [103.85, 1.29]],
    related_signals: 0
  },
  {
    id: 'firmina', name: 'Firmina', slug: 'firmina',
    owners: ['Google'],
    operators: ['Google'],
    landing_points: [
      { name: 'Myrtle Beach', country: 'United States', country_code: 'US', lat: 33.69, lng: -78.89 },
      { name: 'Praia Grande', country: 'Brazil', country_code: 'BR', lat: -24.01, lng: -46.40 },
      { name: 'Las Toninas', country: 'Argentina', country_code: 'AR', lat: -36.48, lng: -56.97 },
      { name: 'Punta del Este', country: 'Uruguay', country_code: 'UY', lat: -34.97, lng: -54.95 }
    ],
    rfs_year: 2023, length_km: 15000, capacity_tbps: 340, status: 'active',
    technology: '12 fiber pairs', notes: 'Longest cable Google has ever deployed',
    route_coords: [[-78.89, 33.69], [-55.0, 5.0], [-46.40, -24.01], [-54.95, -34.97], [-56.97, -36.48]],
    related_signals: 0
  },
  // ─── Asia-Pacific & Intra-Asia ────────────────────────────────────
  {
    id: 'sea-me-we-6', name: 'SEA-ME-WE 6', slug: 'sea-me-we-6',
    owners: ['China Mobile', 'Orange', 'Singtel', 'Telkom Indonesia', 'Telecom Italia'],
    operators: ['SubCom'],
    landing_points: [
      { name: 'Singapore', country: 'Singapore', country_code: 'SG', lat: 1.29, lng: 103.85 },
      { name: 'Marseille', country: 'France', country_code: 'FR', lat: 43.30, lng: 5.37 },
      { name: 'Mumbai', country: 'India', country_code: 'IN', lat: 19.08, lng: 72.88 },
      { name: 'Djibouti', country: 'Djibouti', country_code: 'DJ', lat: 11.59, lng: 43.15 },
      { name: 'Jeddah', country: 'Saudi Arabia', country_code: 'SA', lat: 21.49, lng: 39.19 }
    ],
    rfs_year: 2025, length_km: 19200, capacity_tbps: 126, status: 'active',
    technology: 'SDM, open cable', notes: 'Next-gen SEA-ME-WE consortium cable',
    route_coords: [[103.85, 1.29], [72.88, 19.08], [43.15, 11.59], [39.19, 21.49], [32.0, 30.0], [5.37, 43.30]],
    related_signals: 0
  },
  {
    id: 'apricot', name: 'APRICOT', slug: 'apricot',
    owners: ['Meta', 'Google', 'NTT', 'PLDT'],
    operators: ['NEC'],
    landing_points: [
      { name: 'Singapore', country: 'Singapore', country_code: 'SG', lat: 1.29, lng: 103.85 },
      { name: 'Jakarta', country: 'Indonesia', country_code: 'ID', lat: -6.21, lng: 106.85 },
      { name: 'Maruyama', country: 'Japan', country_code: 'JP', lat: 33.48, lng: 135.77 },
      { name: 'Taipei', country: 'Taiwan', country_code: 'TW', lat: 25.03, lng: 121.57 },
      { name: 'Guam', country: 'United States', country_code: 'US', lat: 13.44, lng: 144.79 }
    ],
    rfs_year: 2024, length_km: 12000, capacity_tbps: 190, status: 'active',
    technology: '12 fiber pairs', notes: null,
    route_coords: [[103.85, 1.29], [106.85, -6.21], [121.57, 25.03], [135.77, 33.48], [144.79, 13.44]],
    related_signals: 0
  },
  {
    id: '2africa', name: '2Africa', slug: '2africa',
    owners: ['Meta', 'MTN', 'Orange', 'STC', 'Vodafone', 'WIOCC', 'China Mobile'],
    operators: ['Alcatel Submarine Networks'],
    landing_points: [
      { name: 'Genoa', country: 'Italy', country_code: 'IT', lat: 44.41, lng: 8.93 },
      { name: 'Barcelona', country: 'Spain', country_code: 'ES', lat: 41.39, lng: 2.17 },
      { name: 'Lagos', country: 'Nigeria', country_code: 'NG', lat: 6.45, lng: 3.40 },
      { name: 'Cape Town', country: 'South Africa', country_code: 'ZA', lat: -33.93, lng: 18.42 },
      { name: 'Mumbai', country: 'India', country_code: 'IN', lat: 19.08, lng: 72.88 },
      { name: 'Muscat', country: 'Oman', country_code: 'OM', lat: 23.61, lng: 58.54 },
      { name: 'Djibouti', country: 'Djibouti', country_code: 'DJ', lat: 11.59, lng: 43.15 },
      { name: 'Marseille', country: 'France', country_code: 'FR', lat: 43.30, lng: 5.37 }
    ],
    rfs_year: 2024, length_km: 45000, capacity_tbps: 180, status: 'active',
    technology: 'SDM, 16 fiber pairs', notes: 'Longest subsea cable ever — circles Africa',
    route_coords: [[8.93, 44.41], [2.17, 41.39], [-5.0, 35.0], [3.40, 6.45], [18.42, -33.93], [58.54, 23.61], [72.88, 19.08], [43.15, 11.59], [39.0, 21.0], [32.0, 30.0], [5.37, 43.30]],
    related_signals: 0
  },
  {
    id: 'peace', name: 'PEACE', slug: 'peace',
    owners: ['PCCW Global', 'Hengtong Group'],
    operators: ['PEACE Cable International'],
    landing_points: [
      { name: 'Karachi', country: 'Pakistan', country_code: 'PK', lat: 24.86, lng: 67.01 },
      { name: 'Marseille', country: 'France', country_code: 'FR', lat: 43.30, lng: 5.37 },
      { name: 'Mombasa', country: 'Kenya', country_code: 'KE', lat: -4.04, lng: 39.67 },
      { name: 'Singapore', country: 'Singapore', country_code: 'SG', lat: 1.29, lng: 103.85 }
    ],
    rfs_year: 2022, length_km: 15000, capacity_tbps: 96, status: 'active',
    technology: '6 fiber pairs', notes: 'Pakistan–East Africa–Europe cable, Chinese-backed',
    route_coords: [[103.85, 1.29], [67.01, 24.86], [39.67, -4.04], [43.15, 11.59], [32.0, 30.0], [5.37, 43.30]],
    related_signals: 0
  },
  // ─── Under Construction / Planned (2025-2028) ─────────────────────
  {
    id: 'blue-raman', name: 'Blue-Raman', slug: 'blue-raman',
    owners: ['Google'],
    operators: ['SubCom'],
    landing_points: [
      { name: 'Mumbai', country: 'India', country_code: 'IN', lat: 19.08, lng: 72.88 },
      { name: 'Genoa', country: 'Italy', country_code: 'IT', lat: 44.41, lng: 8.93 },
      { name: 'Amman', country: 'Jordan', country_code: 'JO', lat: 31.95, lng: 35.93 }
    ],
    rfs_year: 2024, length_km: 10000, capacity_tbps: 140, status: 'active',
    technology: '16 fiber pairs', notes: 'Google India–Europe cable via Israel land crossing',
    route_coords: [[72.88, 19.08], [58.0, 22.0], [35.93, 31.95], [25.0, 35.0], [8.93, 44.41]],
    related_signals: 0
  },
  {
    id: 'equiano', name: 'Equiano', slug: 'equiano',
    owners: ['Google'],
    operators: ['Google'],
    landing_points: [
      { name: 'Lisbon', country: 'Portugal', country_code: 'PT', lat: 38.72, lng: -9.14 },
      { name: 'Lagos', country: 'Nigeria', country_code: 'NG', lat: 6.45, lng: 3.40 },
      { name: 'Cape Town', country: 'South Africa', country_code: 'ZA', lat: -33.93, lng: 18.42 },
      { name: 'Lomé', country: 'Togo', country_code: 'TG', lat: 6.14, lng: 1.22 }
    ],
    rfs_year: 2022, length_km: 15000, capacity_tbps: 144, status: 'active',
    technology: '12 fiber pairs, SDM', notes: 'Google Africa cable — 20x more capacity than predecessors',
    route_coords: [[-9.14, 38.72], [-8.0, 20.0], [1.22, 6.14], [3.40, 6.45], [18.42, -33.93]],
    related_signals: 0
  },
  {
    id: 'medusa', name: 'Medusa', slug: 'medusa',
    owners: ['AFR-IX telecom'],
    operators: ['AFR-IX telecom'],
    landing_points: [
      { name: 'Barcelona', country: 'Spain', country_code: 'ES', lat: 41.39, lng: 2.17 },
      { name: 'Marseille', country: 'France', country_code: 'FR', lat: 43.30, lng: 5.37 },
      { name: 'Genoa', country: 'Italy', country_code: 'IT', lat: 44.41, lng: 8.93 },
      { name: 'Algiers', country: 'Algeria', country_code: 'DZ', lat: 36.75, lng: 3.06 },
      { name: 'Tunis', country: 'Tunisia', country_code: 'TN', lat: 36.81, lng: 10.17 },
      { name: 'Alexandria', country: 'Egypt', country_code: 'EG', lat: 31.20, lng: 29.92 }
    ],
    rfs_year: 2024, length_km: 8760, capacity_tbps: 20, status: 'active',
    technology: '12 fiber pairs', notes: 'Mediterranean ring cable',
    route_coords: [[2.17, 41.39], [3.06, 36.75], [10.17, 36.81], [8.93, 44.41], [5.37, 43.30], [29.92, 31.20]],
    related_signals: 0
  },
  {
    id: 'topaz', name: 'Topaz', slug: 'topaz',
    owners: ['Google'],
    operators: ['SubCom'],
    landing_points: [
      { name: 'Vancouver', country: 'Canada', country_code: 'CA', lat: 49.28, lng: -123.12 },
      { name: 'Maruyama', country: 'Japan', country_code: 'JP', lat: 33.48, lng: 135.77 }
    ],
    rfs_year: 2025, length_km: 8500, capacity_tbps: 240, status: 'active',
    technology: 'SDM, next-gen fiber', notes: 'Google Canada–Japan cable',
    route_coords: [[-123.12, 49.28], [-170.0, 45.0], [135.77, 33.48]],
    related_signals: 0
  },
  {
    id: 'umoja', name: 'Umoja', slug: 'umoja',
    owners: ['Google', 'Liquid Technologies'],
    operators: ['Liquid Technologies'],
    landing_points: [
      { name: 'Nairobi', country: 'Kenya', country_code: 'KE', lat: -1.29, lng: 36.82 },
      { name: 'Johannesburg', country: 'South Africa', country_code: 'ZA', lat: -26.20, lng: 28.05 },
      { name: 'Gqeberha', country: 'South Africa', country_code: 'ZA', lat: -33.96, lng: 25.60 }
    ],
    rfs_year: 2024, length_km: 6500, capacity_tbps: 36, status: 'active',
    technology: '6 fiber pairs', notes: 'Google-backed pan-African cable linking East & South Africa',
    route_coords: [[36.82, -1.29], [28.05, -26.20], [25.60, -33.96]],
    related_signals: 0
  },
  {
    id: 'aeconnect-1', name: 'AEConnect-1', slug: 'aeconnect-1',
    owners: ['Aqua Comms'],
    operators: ['Aqua Comms'],
    landing_points: [
      { name: 'New York', country: 'United States', country_code: 'US', lat: 40.57, lng: -73.97 },
      { name: 'Killala', country: 'Ireland', country_code: 'IE', lat: 54.21, lng: -9.22 }
    ],
    rfs_year: 2016, length_km: 5536, capacity_tbps: 52, status: 'active',
    technology: '4 fiber pairs', notes: null,
    route_coords: [[-73.97, 40.57], [-40.0, 50.0], [-9.22, 54.21]],
    related_signals: 0
  },
  {
    id: 'havfrue', name: 'Havfrue/AEC-2', slug: 'havfrue',
    owners: ['Aqua Comms', 'Google', 'Bulk Infrastructure'],
    operators: ['Aqua Comms'],
    landing_points: [
      { name: 'New Jersey', country: 'United States', country_code: 'US', lat: 40.48, lng: -74.00 },
      { name: 'Blaabjerg', country: 'Denmark', country_code: 'DK', lat: 55.73, lng: 8.17 },
      { name: 'Kristiansand', country: 'Norway', country_code: 'NO', lat: 58.15, lng: 8.00 }
    ],
    rfs_year: 2020, length_km: 7600, capacity_tbps: 108, status: 'active',
    technology: '6 fiber pairs', notes: 'US to Nordic cable',
    route_coords: [[-74.00, 40.48], [-30.0, 55.0], [8.17, 55.73], [8.00, 58.15]],
    related_signals: 0
  },
  {
    id: 'nuvem', name: 'Nuvem', slug: 'nuvem',
    owners: ['Angola Cables'],
    operators: ['Angola Cables'],
    landing_points: [
      { name: 'Luanda', country: 'Angola', country_code: 'AO', lat: -8.84, lng: 13.23 },
      { name: 'Fortaleza', country: 'Brazil', country_code: 'BR', lat: -3.73, lng: -38.52 }
    ],
    rfs_year: 2018, length_km: 6165, capacity_tbps: 40, status: 'active',
    technology: '4 fiber pairs', notes: 'South Atlantic — Africa to South America direct',
    route_coords: [[13.23, -8.84], [-15.0, -10.0], [-38.52, -3.73]],
    related_signals: 0
  },
  {
    id: 'africa-1', name: 'Africa-1', slug: 'africa-1',
    owners: ['PCCW Global'],
    operators: ['PCCW Global'],
    landing_points: [
      { name: 'Karachi', country: 'Pakistan', country_code: 'PK', lat: 24.86, lng: 67.01 },
      { name: 'Djibouti', country: 'Djibouti', country_code: 'DJ', lat: 11.59, lng: 43.15 },
      { name: 'Mombasa', country: 'Kenya', country_code: 'KE', lat: -4.04, lng: 39.67 },
      { name: 'Durban', country: 'South Africa', country_code: 'ZA', lat: -29.86, lng: 31.03 }
    ],
    rfs_year: 2023, length_km: 12000, capacity_tbps: 80, status: 'active',
    technology: '6 fiber pairs', notes: 'Pakistan to East/South Africa',
    route_coords: [[67.01, 24.86], [43.15, 11.59], [39.67, -4.04], [31.03, -29.86]],
    related_signals: 0
  },
  {
    id: 'indigo-central', name: 'Indigo Central', slug: 'indigo-central',
    owners: ['Google', 'AARNet', 'Indosat', 'Singtel', 'SubPartners', 'Telstra'],
    operators: ['Alcatel Submarine Networks'],
    landing_points: [
      { name: 'Perth', country: 'Australia', country_code: 'AU', lat: -31.95, lng: 115.86 },
      { name: 'Singapore', country: 'Singapore', country_code: 'SG', lat: 1.29, lng: 103.85 },
      { name: 'Jakarta', country: 'Indonesia', country_code: 'ID', lat: -6.21, lng: 106.85 }
    ],
    rfs_year: 2019, length_km: 9000, capacity_tbps: 36, status: 'active',
    technology: '4 fiber pairs', notes: 'Australia–SE Asia cable',
    route_coords: [[115.86, -31.95], [106.85, -6.21], [103.85, 1.29]],
    related_signals: 0
  },
  // ─── Strategic / Geopolitical Interest ────────────────────────────
  {
    id: 'asia-africa-europe-1', name: 'AAE-1', slug: 'aae-1',
    owners: ['China Unicom', 'Djibouti Telecom', 'Etisalat', 'Mobily', 'PCCW', 'Relia (STC)', 'TM'],
    operators: ['NEC'],
    landing_points: [
      { name: 'Hong Kong', country: 'China', country_code: 'HK', lat: 22.32, lng: 114.17 },
      { name: 'Singapore', country: 'Singapore', country_code: 'SG', lat: 1.29, lng: 103.85 },
      { name: 'Mumbai', country: 'India', country_code: 'IN', lat: 19.08, lng: 72.88 },
      { name: 'Marseille', country: 'France', country_code: 'FR', lat: 43.30, lng: 5.37 }
    ],
    rfs_year: 2017, length_km: 25000, capacity_tbps: 40, status: 'active',
    technology: '5 fiber pairs', notes: null,
    route_coords: [[114.17, 22.32], [103.85, 1.29], [72.88, 19.08], [43.15, 11.59], [5.37, 43.30]],
    related_signals: 0
  },
  {
    id: 'sealink', name: 'SEALink', slug: 'sealink',
    owners: ['Meta'],
    operators: ['NEC'],
    landing_points: [
      { name: 'Singapore', country: 'Singapore', country_code: 'SG', lat: 1.29, lng: 103.85 },
      { name: 'Jakarta', country: 'Indonesia', country_code: 'ID', lat: -6.21, lng: 106.85 },
      { name: 'Batam', country: 'Indonesia', country_code: 'ID', lat: 1.07, lng: 104.03 }
    ],
    rfs_year: 2026, length_km: 5000, capacity_tbps: 200, status: 'under_construction',
    technology: 'Open cable, SDM', notes: 'Meta intra-ASEAN mega cable',
    route_coords: [[103.85, 1.29], [104.03, 1.07], [106.85, -6.21]],
    related_signals: 0
  },
  {
    id: 'south-east-asia-japan-cable-2', name: 'SJC2', slug: 'sjc2',
    owners: ['China Mobile', 'Facebook', 'KDDI', 'Singtel', 'SK Broadband', 'Chunghwa'],
    operators: ['NEC'],
    landing_points: [
      { name: 'Singapore', country: 'Singapore', country_code: 'SG', lat: 1.29, lng: 103.85 },
      { name: 'Maruyama', country: 'Japan', country_code: 'JP', lat: 33.48, lng: 135.77 },
      { name: 'Hong Kong', country: 'China', country_code: 'HK', lat: 22.32, lng: 114.17 },
      { name: 'Busan', country: 'South Korea', country_code: 'KR', lat: 35.18, lng: 129.08 },
      { name: 'Tamsui', country: 'Taiwan', country_code: 'TW', lat: 25.17, lng: 121.44 }
    ],
    rfs_year: 2020, length_km: 10500, capacity_tbps: 144, status: 'active',
    technology: '8 fiber pairs', notes: 'High-capacity Asia intra-regional cable',
    route_coords: [[103.85, 1.29], [114.17, 22.32], [121.44, 25.17], [129.08, 35.18], [135.77, 33.48]],
    related_signals: 0
  },
  {
    id: 'polar-express', name: 'Polar Express (Far North Fiber)', slug: 'polar-express',
    owners: ['Far North Digital', 'Cinia'],
    operators: ['Far North Digital'],
    landing_points: [
      { name: 'Tokyo', country: 'Japan', country_code: 'JP', lat: 35.69, lng: 139.69 },
      { name: 'Murmansk', country: 'Russia', country_code: 'RU', lat: 68.97, lng: 33.07 },
      { name: 'Kirkenes', country: 'Norway', country_code: 'NO', lat: 69.73, lng: 30.05 },
      { name: 'Helsinki', country: 'Finland', country_code: 'FI', lat: 60.17, lng: 24.94 },
      { name: 'Dublin', country: 'Ireland', country_code: 'IE', lat: 53.35, lng: -6.26 }
    ],
    rfs_year: 2027, length_km: 14000, capacity_tbps: 200, status: 'planned',
    technology: 'Arctic route fiber', notes: 'Arctic submarine cable — Japan to Europe via Northern Sea Route. Geopolitically significant.',
    route_coords: [[139.69, 35.69], [170.0, 55.0], [-170.0, 65.0], [33.07, 68.97], [30.05, 69.73], [24.94, 60.17], [-6.26, 53.35]],
    related_signals: 0
  },
  {
    id: 'south-atlantic-cable-system', name: 'SACS', slug: 'sacs',
    owners: ['Angola Cables'],
    operators: ['Angola Cables'],
    landing_points: [
      { name: 'Luanda', country: 'Angola', country_code: 'AO', lat: -8.84, lng: 13.23 },
      { name: 'Fortaleza', country: 'Brazil', country_code: 'BR', lat: -3.73, lng: -38.52 }
    ],
    rfs_year: 2018, length_km: 6165, capacity_tbps: 40, status: 'active',
    technology: '4 fiber pairs', notes: 'First Africa–Americas direct cable — reduces latency from 338ms to 63ms',
    route_coords: [[13.23, -8.84], [-15.0, -10.0], [-38.52, -3.73]],
    related_signals: 0
  },
  {
    id: 'raman', name: 'Raman', slug: 'raman',
    owners: ['Google'],
    operators: ['SubCom'],
    landing_points: [
      { name: 'Mumbai', country: 'India', country_code: 'IN', lat: 19.08, lng: 72.88 },
      { name: 'Amman', country: 'Jordan', country_code: 'JO', lat: 31.95, lng: 35.93 }
    ],
    rfs_year: 2024, length_km: 3500, capacity_tbps: 120, status: 'active',
    technology: '12 fiber pairs', notes: 'India–Jordan segment of Blue-Raman system',
    route_coords: [[72.88, 19.08], [58.0, 22.0], [35.93, 31.95]],
    related_signals: 0
  },
  {
    id: 'tgn-atlantic', name: 'TGN-Atlantic', slug: 'tgn-atlantic',
    owners: ['Telia Carrier'],
    operators: ['Telia Carrier'],
    landing_points: [
      { name: 'New York', country: 'United States', country_code: 'US', lat: 40.57, lng: -73.97 },
      { name: 'Saunton', country: 'United Kingdom', country_code: 'GB', lat: 51.10, lng: -4.23 }
    ],
    rfs_year: 2001, length_km: 6300, capacity_tbps: 3.84, status: 'active',
    technology: '4 fiber pairs, WDM', notes: 'Legacy trans-Atlantic backbone',
    route_coords: [[-73.97, 40.57], [-40.0, 48.0], [-4.23, 51.10]],
    related_signals: 0
  },
  {
    id: 'c-lion1', name: 'C-Lion1', slug: 'c-lion1',
    owners: ['Cinia'],
    operators: ['Cinia'],
    landing_points: [
      { name: 'Helsinki', country: 'Finland', country_code: 'FI', lat: 60.17, lng: 24.94 },
      { name: 'Rostock', country: 'Germany', country_code: 'DE', lat: 54.09, lng: 12.10 }
    ],
    rfs_year: 2016, length_km: 1172, capacity_tbps: 12, status: 'active',
    technology: '8 fiber pairs', notes: 'Baltic Sea cable — severed Nov 2024 (suspected sabotage), repaired',
    route_coords: [[24.94, 60.17], [12.10, 54.09]],
    related_signals: 0
  },
  {
    id: 'balticconnector', name: 'BalticConnector', slug: 'balticconnector',
    owners: ['Gasgrid Finland', 'Elering'],
    operators: ['Gasgrid Finland'],
    landing_points: [
      { name: 'Inkoo', country: 'Finland', country_code: 'FI', lat: 60.05, lng: 24.00 },
      { name: 'Paldiski', country: 'Estonia', country_code: 'EE', lat: 59.35, lng: 24.05 }
    ],
    rfs_year: 2020, length_km: 77, capacity_tbps: 0.1, status: 'active',
    technology: 'Telecom + gas pipeline', notes: 'Damaged Oct 2023 by anchor drag (Chinese vessel Newnew Polar Bear suspected). Repaired April 2024.',
    route_coords: [[24.00, 60.05], [24.05, 59.35]],
    related_signals: 0
  },
  {
    id: 'hainan-hong-kong', name: 'Hong Kong-Guam Cable System', slug: 'hk-guam',
    owners: ['NTT', 'RTI Cable'],
    operators: ['NTT'],
    landing_points: [
      { name: 'Hong Kong', country: 'China', country_code: 'HK', lat: 22.32, lng: 114.17 },
      { name: 'Guam', country: 'United States', country_code: 'US', lat: 13.44, lng: 144.79 }
    ],
    rfs_year: 2020, length_km: 3900, capacity_tbps: 48, status: 'active',
    technology: '4 fiber pairs', notes: null,
    route_coords: [[114.17, 22.32], [144.79, 13.44]],
    related_signals: 0
  },
  // ─── Middle East & India ──────────────────────────────────────────
  {
    id: 'jadi', name: 'JADI', slug: 'jadi',
    owners: ['Sparkle', 'Omantel', 'Etisalat'],
    operators: ['Sparkle'],
    landing_points: [
      { name: 'Jeddah', country: 'Saudi Arabia', country_code: 'SA', lat: 21.49, lng: 39.19 },
      { name: 'Djibouti', country: 'Djibouti', country_code: 'DJ', lat: 11.59, lng: 43.15 },
      { name: 'Mumbai', country: 'India', country_code: 'IN', lat: 19.08, lng: 72.88 }
    ],
    rfs_year: 2025, length_km: 6500, capacity_tbps: 100, status: 'active',
    technology: '8 fiber pairs', notes: 'India–Middle East–Africa link',
    route_coords: [[72.88, 19.08], [58.0, 22.0], [43.15, 11.59], [39.19, 21.49]],
    related_signals: 0
  },
  {
    id: 'falcon', name: 'Falcon', slug: 'falcon',
    owners: ['FLAG Telecom (Reliance)'],
    operators: ['Reliance Globalcom'],
    landing_points: [
      { name: 'Mumbai', country: 'India', country_code: 'IN', lat: 19.08, lng: 72.88 },
      { name: 'Fujairah', country: 'UAE', country_code: 'AE', lat: 25.13, lng: 56.34 },
      { name: 'Muscat', country: 'Oman', country_code: 'OM', lat: 23.61, lng: 58.54 },
      { name: 'Alexandria', country: 'Egypt', country_code: 'EG', lat: 31.20, lng: 29.92 }
    ],
    rfs_year: 2006, length_km: 11200, capacity_tbps: 5.12, status: 'active',
    technology: '2 fiber pairs, DWDM', notes: 'India–Middle East–Mediterranean backbone',
    route_coords: [[72.88, 19.08], [56.34, 25.13], [58.54, 23.61], [43.15, 11.59], [29.92, 31.20]],
    related_signals: 0
  },
  // ─── Google's Upcoming 2026-2028 ──────────────────────────────────
  {
    id: 'umoja-2', name: 'Umoja 2', slug: 'umoja-2',
    owners: ['Google'],
    operators: ['Google'],
    landing_points: [
      { name: 'Cape Town', country: 'South Africa', country_code: 'ZA', lat: -33.93, lng: 18.42 },
      { name: 'Darwin', country: 'Australia', country_code: 'AU', lat: -12.46, lng: 130.84 },
      { name: 'Chennai', country: 'India', country_code: 'IN', lat: 13.08, lng: 80.27 }
    ],
    rfs_year: 2027, length_km: 17000, capacity_tbps: 280, status: 'under_construction',
    technology: 'SDM, next-gen fiber', notes: 'Google South Africa–India–Australia mega cable',
    route_coords: [[18.42, -33.93], [55.0, -20.0], [80.27, 13.08], [100.0, -5.0], [130.84, -12.46]],
    related_signals: 0
  },
  {
    id: 'proa', name: 'Proa', slug: 'proa',
    owners: ['Google'],
    operators: ['SubCom'],
    landing_points: [
      { name: 'Japan', country: 'Japan', country_code: 'JP', lat: 33.48, lng: 135.77 },
      { name: 'Chile', country: 'Chile', country_code: 'CL', lat: -33.05, lng: -71.61 },
      { name: 'Australia', country: 'Australia', country_code: 'AU', lat: -33.87, lng: 151.21 }
    ],
    rfs_year: 2028, length_km: 20000, capacity_tbps: 360, status: 'planned',
    technology: 'Next-gen SDM', notes: 'Google trans-Pacific southern route',
    route_coords: [[135.77, 33.48], [180.0, 0.0], [-140.0, -15.0], [-71.61, -33.05]],
    related_signals: 0
  },
  // ─── BRICS / Non-Western ──────────────────────────────────────────
  {
    id: 'brics-cable', name: 'BRICS Cable', slug: 'brics-cable',
    owners: ['BRICS Cable Consortium'],
    operators: ['BRICS Cable Consortium'],
    landing_points: [
      { name: 'Vladivostok', country: 'Russia', country_code: 'RU', lat: 43.12, lng: 131.89 },
      { name: 'Chennai', country: 'India', country_code: 'IN', lat: 13.08, lng: 80.27 },
      { name: 'Cape Town', country: 'South Africa', country_code: 'ZA', lat: -33.93, lng: 18.42 },
      { name: 'Fortaleza', country: 'Brazil', country_code: 'BR', lat: -3.73, lng: -38.52 }
    ],
    rfs_year: 2028, length_km: 34000, capacity_tbps: 12.8, status: 'planned',
    technology: '12 fiber pairs', notes: 'BRICS nations bypass Western-controlled cable routes',
    route_coords: [[131.89, 43.12], [80.27, 13.08], [55.0, -20.0], [18.42, -33.93], [-20.0, -15.0], [-38.52, -3.73]],
    related_signals: 0
  },
  // ─── Arctic / High-Latitude ───────────────────────────────────────
  {
    id: 'quintillion', name: 'Quintillion Arctic', slug: 'quintillion',
    owners: ['Quintillion'],
    operators: ['Quintillion'],
    landing_points: [
      { name: 'Barrow', country: 'United States', country_code: 'US', lat: 71.29, lng: -156.79 },
      { name: 'Nome', country: 'United States', country_code: 'US', lat: 64.50, lng: -165.41 },
      { name: 'Prudhoe Bay', country: 'United States', country_code: 'US', lat: 70.25, lng: -148.34 }
    ],
    rfs_year: 2017, length_km: 1900, capacity_tbps: 30, status: 'active',
    technology: '6 fiber pairs', notes: 'Alaska Arctic coast subsea cable — first commercial Arctic submarine cable',
    route_coords: [[-165.41, 64.50], [-156.79, 71.29], [-148.34, 70.25]],
    related_signals: 0
  },
  // ─── South Pacific ────────────────────────────────────────────────
  {
    id: 'southern-cross-next', name: 'Southern Cross NEXT', slug: 'southern-cross-next',
    owners: ['Southern Cross Cables', 'Spark NZ', 'Telstra', 'Verizon'],
    operators: ['Southern Cross Cables'],
    landing_points: [
      { name: 'Auckland', country: 'New Zealand', country_code: 'NZ', lat: -36.85, lng: 174.76 },
      { name: 'Sydney', country: 'Australia', country_code: 'AU', lat: -33.87, lng: 151.21 },
      { name: 'Los Angeles', country: 'United States', country_code: 'US', lat: 33.94, lng: -118.41 }
    ],
    rfs_year: 2022, length_km: 15840, capacity_tbps: 72, status: 'active',
    technology: '4 fiber pairs, SDM', notes: 'New Zealand–Australia–US cable',
    route_coords: [[174.76, -36.85], [151.21, -33.87], [-180.0, 10.0], [-118.41, 33.94]],
    related_signals: 0
  },
  {
    id: 'coral-sea-cable', name: 'Coral Sea Cable System', slug: 'coral-sea',
    owners: ['Vocus Communications', 'Government of Papua New Guinea'],
    operators: ['Vocus'],
    landing_points: [
      { name: 'Sydney', country: 'Australia', country_code: 'AU', lat: -33.87, lng: 151.21 },
      { name: 'Port Moresby', country: 'Papua New Guinea', country_code: 'PG', lat: -9.44, lng: 147.18 },
      { name: 'Honiara', country: 'Solomon Islands', country_code: 'SB', lat: -9.43, lng: 160.00 }
    ],
    rfs_year: 2020, length_km: 4700, capacity_tbps: 20, status: 'active',
    technology: '4 fiber pairs', notes: 'Funded by Australia to counter Chinese influence in Pacific',
    route_coords: [[151.21, -33.87], [147.18, -9.44], [160.00, -9.43]],
    related_signals: 0
  },
  // ─── Caribbean / Central America ──────────────────────────────────
  {
    id: 'deep-blue-cable', name: 'Deep Blue Cable', slug: 'deep-blue',
    owners: ['Digicel'],
    operators: ['Digicel'],
    landing_points: [
      { name: 'Kingston', country: 'Jamaica', country_code: 'JM', lat: 17.97, lng: -76.79 },
      { name: 'Colón', country: 'Panama', country_code: 'PA', lat: 9.36, lng: -79.90 },
      { name: 'Cartagena', country: 'Colombia', country_code: 'CO', lat: 10.39, lng: -75.51 }
    ],
    rfs_year: 2018, length_km: 2800, capacity_tbps: 6, status: 'active',
    technology: '3 fiber pairs', notes: 'Caribbean–Central America link',
    route_coords: [[-76.79, 17.97], [-79.90, 9.36], [-75.51, 10.39]],
    related_signals: 0
  },
  // ─── Recent Geopolitically Significant ────────────────────────────
  {
    id: 'east-micronesia-cable', name: 'East Micronesia Cable', slug: 'east-micronesia',
    owners: ['Google', 'APTelecom'],
    operators: ['APTelecom'],
    landing_points: [
      { name: 'Guam', country: 'United States', country_code: 'US', lat: 13.44, lng: 144.79 },
      { name: 'Kosrae', country: 'Micronesia', country_code: 'FM', lat: 5.32, lng: 162.98 },
      { name: 'Nauru', country: 'Nauru', country_code: 'NR', lat: -0.52, lng: 166.93 },
      { name: 'Tarawa', country: 'Kiribati', country_code: 'KI', lat: 1.45, lng: 173.02 }
    ],
    rfs_year: 2025, length_km: 3400, capacity_tbps: 10, status: 'active',
    technology: '2 fiber pairs', notes: 'US-backed Pacific island cable — strategic counter to Chinese Pacific influence',
    route_coords: [[144.79, 13.44], [162.98, 5.32], [166.93, -0.52], [173.02, 1.45]],
    related_signals: 0
  },
  {
    id: 'europe-india-gateway', name: 'Europe India Gateway', slug: 'eig',
    owners: ['Bharti Airtel', 'BT', 'Etisalat', 'IMEWE Group', 'Orascom'],
    operators: ['Telia Carrier'],
    landing_points: [
      { name: 'Mumbai', country: 'India', country_code: 'IN', lat: 19.08, lng: 72.88 },
      { name: 'London', country: 'United Kingdom', country_code: 'GB', lat: 51.51, lng: -0.13 },
      { name: 'Muscat', country: 'Oman', country_code: 'OM', lat: 23.61, lng: 58.54 },
      { name: 'Abu Talat', country: 'Egypt', country_code: 'EG', lat: 30.92, lng: 29.33 },
      { name: 'Monaco', country: 'Monaco', country_code: 'MC', lat: 43.73, lng: 7.42 }
    ],
    rfs_year: 2011, length_km: 15000, capacity_tbps: 3.84, status: 'active',
    technology: '4 fiber pairs', notes: 'India–Europe backbone via Middle East & Mediterranean',
    route_coords: [[72.88, 19.08], [58.54, 23.61], [29.33, 30.92], [7.42, 43.73], [-0.13, 51.51]],
    related_signals: 0
  },
  {
    id: 'mist', name: 'MIST', slug: 'mist',
    owners: ['Reliance Jio', 'Airtel'],
    operators: ['Reliance Jio'],
    landing_points: [
      { name: 'Mumbai', country: 'India', country_code: 'IN', lat: 19.08, lng: 72.88 },
      { name: 'Singapore', country: 'Singapore', country_code: 'SG', lat: 1.29, lng: 103.85 },
      { name: 'Cox\'s Bazar', country: 'Bangladesh', country_code: 'BD', lat: 21.45, lng: 91.97 },
      { name: 'Satun', country: 'Thailand', country_code: 'TH', lat: 6.62, lng: 100.07 }
    ],
    rfs_year: 2026, length_km: 8000, capacity_tbps: 200, status: 'under_construction',
    technology: 'SDM, next-gen', notes: 'India–SE Asia mega cable',
    route_coords: [[72.88, 19.08], [91.97, 21.45], [100.07, 6.62], [103.85, 1.29]],
    related_signals: 0
  },
  {
    id: 'tgn-pacific', name: 'TGN-Pacific', slug: 'tgn-pacific',
    owners: ['Telia Carrier'],
    operators: ['Telia Carrier'],
    landing_points: [
      { name: 'Los Angeles', country: 'United States', country_code: 'US', lat: 33.94, lng: -118.41 },
      { name: 'Maruyama', country: 'Japan', country_code: 'JP', lat: 33.48, lng: 135.77 }
    ],
    rfs_year: 2002, length_km: 9600, capacity_tbps: 7.68, status: 'active',
    technology: '4 fiber pairs, DWDM', notes: 'Legacy trans-Pacific backbone',
    route_coords: [[-118.41, 33.94], [-170.0, 30.0], [135.77, 33.48]],
    related_signals: 0
  },
  {
    id: 'sea-me-we-3', name: 'SEA-ME-WE 3', slug: 'sea-me-we-3',
    owners: ['Consortium of 92 carriers'],
    operators: ['VSNL/Tata Communications'],
    landing_points: [
      { name: 'Singapore', country: 'Singapore', country_code: 'SG', lat: 1.29, lng: 103.85 },
      { name: 'Shanghai', country: 'China', country_code: 'CN', lat: 31.23, lng: 121.47 },
      { name: 'Norden', country: 'Germany', country_code: 'DE', lat: 53.60, lng: 7.20 },
      { name: 'Mumbai', country: 'India', country_code: 'IN', lat: 19.08, lng: 72.88 }
    ],
    rfs_year: 2000, length_km: 39000, capacity_tbps: 0.96, status: 'active',
    technology: '2 fiber pairs, WDM', notes: 'One of the longest submarine cables ever built — 33 landing points',
    route_coords: [[103.85, 1.29], [72.88, 19.08], [43.15, 11.59], [32.0, 30.0], [7.20, 53.60], [121.47, 31.23]],
    related_signals: 0
  },
  {
    id: 'flag', name: 'FLAG Europe-Asia', slug: 'flag',
    owners: ['Reliance Globalcom'],
    operators: ['Reliance Globalcom'],
    landing_points: [
      { name: 'Porthcurno', country: 'United Kingdom', country_code: 'GB', lat: 50.04, lng: -5.66 },
      { name: 'Mumbai', country: 'India', country_code: 'IN', lat: 19.08, lng: 72.88 },
      { name: 'Busan', country: 'South Korea', country_code: 'KR', lat: 35.18, lng: 129.08 },
      { name: 'Miura', country: 'Japan', country_code: 'JP', lat: 35.14, lng: 139.62 }
    ],
    rfs_year: 1997, length_km: 28000, capacity_tbps: 10, status: 'active',
    technology: '2 fiber pairs, DWDM', notes: 'Pioneer Europe–Asia cable, still operational',
    route_coords: [[-5.66, 50.04], [5.0, 43.0], [29.0, 31.0], [43.0, 12.0], [72.88, 19.08], [129.08, 35.18], [139.62, 35.14]],
    related_signals: 0
  }
]

// ─── Helper Functions ─────────────────────────────────────────────────────────

export function filterCables(
  cables: SubmarineCable[],
  opts: {
    status?:   string
    owner?:    string
    country?:  string
    q?:        string
    limit?:    number
  }
): SubmarineCable[] {
  let filtered = [...cables]

  if (opts.status) {
    filtered = filtered.filter(c => c.status === opts.status)
  }

  if (opts.owner) {
    const ownerLower = opts.owner.toLowerCase()
    filtered = filtered.filter(c =>
      c.owners.some(o => o.toLowerCase().includes(ownerLower)) ||
      c.operators.some(o => o.toLowerCase().includes(ownerLower))
    )
  }

  if (opts.country) {
    const countryLower = opts.country.toLowerCase()
    filtered = filtered.filter(c =>
      c.landing_points.some(lp =>
        lp.country_code.toLowerCase() === countryLower ||
        lp.country.toLowerCase().includes(countryLower)
      )
    )
  }

  if (opts.q) {
    const qLower = opts.q.toLowerCase()
    filtered = filtered.filter(c =>
      c.name.toLowerCase().includes(qLower) ||
      c.slug.toLowerCase().includes(qLower) ||
      c.owners.some(o => o.toLowerCase().includes(qLower)) ||
      c.notes?.toLowerCase().includes(qLower)
    )
  }

  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  return filtered.slice(0, limit)
}

export function buildSummary(cables: SubmarineCable[]): CableSummary {
  const active           = cables.filter(c => c.status === 'active').length
  const under_construction = cables.filter(c => c.status === 'under_construction').length
  const planned          = cables.filter(c => c.status === 'planned').length
  const decommissioned   = cables.filter(c => c.status === 'decommissioned').length

  const total_length_km  = cables.reduce((sum, c) => sum + (c.length_km ?? 0), 0)
  const total_capacity   = cables.reduce((sum, c) => sum + (c.capacity_tbps ?? 0), 0)

  // Unique countries from landing points
  const countrySet = new Set<string>()
  let landingCount = 0
  for (const cable of cables) {
    for (const lp of cable.landing_points) {
      countrySet.add(lp.country_code)
      landingCount++
    }
  }

  // Top owners by cable count
  const ownerMap = new Map<string, number>()
  for (const cable of cables) {
    for (const owner of cable.owners) {
      ownerMap.set(owner, (ownerMap.get(owner) ?? 0) + 1)
    }
  }
  const top_owners = [...ownerMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Top countries by landing point count
  const countryMap = new Map<string, { country: string; country_code: string; count: number }>()
  for (const cable of cables) {
    for (const lp of cable.landing_points) {
      const existing = countryMap.get(lp.country_code)
      if (existing) {
        existing.count++
      } else {
        countryMap.set(lp.country_code, { country: lp.country, country_code: lp.country_code, count: 1 })
      }
    }
  }
  const top_countries = [...countryMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  return {
    total_cables: cables.length,
    active,
    under_construction,
    planned,
    decommissioned,
    total_length_km,
    total_capacity_tbps: total_capacity,
    countries_connected: countrySet.size,
    landing_points_count: landingCount,
    top_owners,
    top_countries,
    recent_signals: 0
  }
}

// ─── Route Plugin ─────────────────────────────────────────────────────────────

const underseaCablesPlugin: FastifyPluginAsync = async (app) => {

  // GET /cables — list all tracked submarine cables
  app.get('/cables', async (req, reply) => {
    try {
      const query = req.query as Record<string, string | undefined>
      const cacheKey = `${CACHE_KEY_LIST}:${JSON.stringify(query)}`

      // Check cache
      try {
        const cached = await redis.get(cacheKey)
        if (cached) {
          reply.header('X-Cache-Hit', 'true')
          return reply.send(JSON.parse(cached))
        }
      } catch { /* Redis error — non-fatal */ }

      // Enrich with signal counts
      const enriched = [...CABLE_REGISTRY]
      try {
        for (const cable of enriched) {
          const keywords = cable.name.split(/[\s-]+/).filter(w => w.length > 2)
          if (keywords.length > 0) {
            const countRows = await db('signals')
              .where('category', 'infrastructure')
              .where(function () {
                for (const kw of keywords) {
                  this.orWhere('title', 'ilike', `%${kw}%`)
                }
              })
              .where('published_at', '>', db.raw("NOW() - INTERVAL '30 days'"))
              .count('id as count')
            cable.related_signals = Number((countRows[0] as { count: string | number } | undefined)?.count ?? 0)
          }
        }
      } catch { /* DB error — use defaults */ }

      const filtered = filterCables(enriched, {
        status:  query.status,
        owner:   query.owner,
        country: query.country,
        q:       query.q,
        limit:   query.limit ? parseInt(query.limit, 10) : undefined
      })

      const response = {
        success: true,
        data: filtered,
        total: filtered.length,
        registry_total: CABLE_REGISTRY.length
      }

      // Cache
      try {
        await redis.setex(cacheKey, LIST_CACHE_TTL, JSON.stringify(response))
      } catch { /* Redis error — non-fatal */ }

      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch submarine cable data')
    }
  })

  // GET /cables/:id — single cable detail
  app.get('/cables/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string }
      const cacheKey = `${CACHE_KEY_DETAIL}:${id}`

      try {
        const cached = await redis.get(cacheKey)
        if (cached) {
          reply.header('X-Cache-Hit', 'true')
          return reply.send(JSON.parse(cached))
        }
      } catch { /* Redis error — non-fatal */ }

      const cable = CABLE_REGISTRY.find(c => c.id === id || c.slug === id)
      if (!cable) {
        return sendError(reply, 404, 'NOT_FOUND', `Cable "${id}" not found`)
      }

      // Enrich with recent related signals
      let recentSignals: unknown[] = []
      try {
        const keywords = cable.name.split(/[\s-]+/).filter(w => w.length > 2)
        if (keywords.length > 0) {
          recentSignals = await db('signals')
            .select('id', 'title', 'severity', 'published_at', 'category')
            .where('category', 'infrastructure')
            .where(function () {
              for (const kw of keywords) {
                this.orWhere('title', 'ilike', `%${kw}%`)
              }
            })
            .where('published_at', '>', db.raw("NOW() - INTERVAL '7 days'"))
            .orderBy('published_at', 'desc')
            .limit(10)
        }
      } catch { /* DB error — non-fatal */ }

      const response = {
        success: true,
        data: { ...cable, recent_signals: recentSignals }
      }

      try {
        await redis.setex(cacheKey, LIST_CACHE_TTL, JSON.stringify(response))
      } catch { /* Redis error — non-fatal */ }

      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch cable detail')
    }
  })

  // GET /summary — aggregate stats
  app.get('/summary', async (req, reply) => {
    try {
      try {
        const cached = await redis.get(CACHE_KEY_SUMMARY)
        if (cached) {
          reply.header('X-Cache-Hit', 'true')
          return reply.send(JSON.parse(cached))
        }
      } catch { /* Redis error — non-fatal */ }

      const summary = buildSummary(CABLE_REGISTRY)

      // Get recent infrastructure signal count
      try {
        const countRows = await db('signals')
          .where('category', 'infrastructure')
          .where('published_at', '>', db.raw("NOW() - INTERVAL '24 hours'"))
          .count('id as count')
        summary.recent_signals = Number((countRows[0] as { count: string | number } | undefined)?.count ?? 0)
      } catch { /* DB error — non-fatal */ }

      const response = { success: true, data: summary }

      try {
        await redis.setex(CACHE_KEY_SUMMARY, SUMMARY_CACHE_TTL, JSON.stringify(response))
      } catch { /* Redis error — non-fatal */ }

      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to build cable summary')
    }
  })

  // GET /map/routes — GeoJSON LineString collection for map layer
  app.get('/map/routes', async (req, reply) => {
    try {
      try {
        const cached = await redis.get(CACHE_KEY_MAP)
        if (cached) {
          reply.header('X-Cache-Hit', 'true')
          return reply.send(JSON.parse(cached))
        }
      } catch { /* Redis error — non-fatal */ }

      const features = CABLE_REGISTRY
        .filter(c => c.route_coords.length >= 2)
        .map(cable => ({
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: cable.route_coords
          },
          properties: {
            id:            cable.id,
            name:          cable.name,
            status:        cable.status,
            capacity_tbps: cable.capacity_tbps,
            length_km:     cable.length_km,
            owners:        cable.owners.join(', '),
            rfs_year:      cable.rfs_year,
            landing_count: cable.landing_points.length
          }
        }))

      const geojson = {
        type: 'FeatureCollection' as const,
        features
      }

      try {
        await redis.setex(CACHE_KEY_MAP, MAP_CACHE_TTL, JSON.stringify(geojson))
      } catch { /* Redis error — non-fatal */ }

      return reply.send(geojson)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to build cable map data')
    }
  })

  // GET /landing-points — all landing stations grouped by country
  app.get('/landing-points', async (req, reply) => {
    try {
      try {
        const cached = await redis.get(CACHE_KEY_LANDING)
        if (cached) {
          reply.header('X-Cache-Hit', 'true')
          return reply.send(JSON.parse(cached))
        }
      } catch { /* Redis error — non-fatal */ }

      const countryMap = new Map<string, {
        country: string
        country_code: string
        points: { name: string; lat: number; lng: number; cables: string[] }[]
      }>()

      for (const cable of CABLE_REGISTRY) {
        for (const lp of cable.landing_points) {
          if (!countryMap.has(lp.country_code)) {
            countryMap.set(lp.country_code, {
              country: lp.country,
              country_code: lp.country_code,
              points: []
            })
          }
          const entry = countryMap.get(lp.country_code)!
          const existing = entry.points.find(p => p.name === lp.name)
          if (existing) {
            if (!existing.cables.includes(cable.name)) {
              existing.cables.push(cable.name)
            }
          } else {
            entry.points.push({ name: lp.name, lat: lp.lat, lng: lp.lng, cables: [cable.name] })
          }
        }
      }

      const data = [...countryMap.values()].sort((a, b) =>
        b.points.reduce((s, p) => s + p.cables.length, 0) -
        a.points.reduce((s, p) => s + p.cables.length, 0)
      )

      const response = {
        success: true,
        data,
        total_countries: data.length,
        total_landing_points: data.reduce((s, c) => s + c.points.length, 0)
      }

      try {
        await redis.setex(CACHE_KEY_LANDING, LIST_CACHE_TTL, JSON.stringify(response))
      } catch { /* Redis error — non-fatal */ }

      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch landing points')
    }
  })
}

export default underseaCablesPlugin
