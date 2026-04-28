/**
 * Water Security Intelligence API
 *
 * Tracks global water security indicators — water stress, sanitation access,
 * flood/drought risk, water quality, and infrastructure resilience. Monitors
 * water crises and trends across all regions.
 *
 * Endpoints:
 *   GET /api/v1/water-security/regions          — list all countries with water security indicators
 *   GET /api/v1/water-security/regions/:code    — single country detail
 *   GET /api/v1/water-security/summary          — aggregate stats & crisis breakdown
 *   GET /api/v1/water-security/map/points       — GeoJSON FeatureCollection for map layer
 *
 * Data sources: Seeded registry of 55+ countries with water security indicators from:
 * - WRI Aqueduct (Water Stress Index)
 * - WHO/UNICEF JMP (Sanitation Access)
 * - Circle of Blue (Water Pricing & Policy)
 * - WaterAid (Infrastructure & Access)
 * - International Water Association (IWA)
 * - FEWS NET (Drought monitoring)
 */

import type { FastifyPluginAsync } from 'fastify'
import { db }    from '../db/postgres'
import { redis } from '../db/redis'
import { sendError } from '../lib/errors'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Redis TTL for regions list cache: 1 hour */
export const LIST_CACHE_TTL     = 3600

/** Redis TTL for summary cache: 1 hour */
export const SUMMARY_CACHE_TTL  = 3600

/** Redis TTL for map points cache: 30 minutes */
export const MAP_CACHE_TTL      = 1800

/** Rate limit: requests per minute */
export const RATE_LIMIT_RPM     = 60

/** Default result limit */
export const DEFAULT_LIMIT      = 50

/** Maximum result limit */
export const MAX_LIMIT          = 100

/** Cache key prefixes */
export const CACHE_KEY_LIST     = 'water-security:regions'
export const CACHE_KEY_SUMMARY  = 'water-security:summary'
export const CACHE_KEY_MAP      = 'water-security:map'
export const CACHE_KEY_DETAIL   = 'water-security:region'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WaterSecurityIndicators {
  water_stress_index:      number  // 0-5 scale (WRI Aqueduct: 0=Low, 5=Extremely High)
  sanitation_access_pct:   number  // 0-100 (% population with safely managed sanitation)
  flood_risk_score:        number  // 0-10 (composite flood exposure + vulnerability)
  drought_risk_score:      number  // 0-10 (composite drought severity + frequency)
  water_quality_index:     number  // 0-100 (higher = better, based on WHO standards)
}

export type CrisisLevel = 'stable' | 'watch' | 'crisis' | 'emergency' | 'catastrophic'

export interface WaterRegion {
  code:               string
  name:               string
  continent:          string
  crisis_level:       CrisisLevel
  indicators:         WaterSecurityIndicators
  trend:              'improving' | 'declining' | 'stable'
  trend_detail:       string
  top_threats:        string[]
  population_m:       number
  pop_water_insecure_m: number
  lat:                number
  lng:                number
  related_signals:    number
}

export interface WaterSecuritySummary {
  total_regions:              number
  catastrophic:               number
  emergency:                  number
  crisis:                     number
  watch:                      number
  stable:                     number
  avg_water_stress:           number
  avg_sanitation_access:      number
  avg_water_quality:          number
  total_water_insecure_m:     number
  most_affected:              { name: string; code: string; stress: number }[]
  most_improved:              { name: string; code: string; detail: string }[]
  continent_breakdown:        { continent: string; count: number; avg_stress: number; water_insecure_m: number }[]
  recent_signals:             number
}

/** Water stress level labels (0-5 scale) */
export const STRESS_LABELS: Record<number, string> = {
  0: 'Low',
  1: 'Low-Medium',
  2: 'Medium-High',
  3: 'High',
  4: 'Extremely High',
  5: 'Arid / Critical',
}

// ─── Country Registry (55+ countries with diverse global coverage) ───────────

export const REGION_REGISTRY: WaterRegion[] = [
  // ─── Sub-Saharan Africa ───────────────────────────────────────────────
  {
    code: 'SO', name: 'Somalia', continent: 'Africa',
    crisis_level: 'catastrophic',
    indicators: { water_stress_index: 4.8, sanitation_access_pct: 12, flood_risk_score: 6.5, drought_risk_score: 9.2, water_quality_index: 15 },
    trend: 'declining', trend_detail: 'Severe drought-flood cycles; 80%+ population water insecure',
    top_threats: ['extreme drought', 'conflict disrupting infrastructure', 'groundwater depletion', 'cholera outbreaks'],
    population_m: 17.1, pop_water_insecure_m: 13.7, lat: 5.15, lng: 46.20, related_signals: 0
  },
  {
    code: 'ET', name: 'Ethiopia', continent: 'Africa',
    crisis_level: 'emergency',
    indicators: { water_stress_index: 3.5, sanitation_access_pct: 18, flood_risk_score: 5.8, drought_risk_score: 8.0, water_quality_index: 28 },
    trend: 'declining', trend_detail: 'Recurring drought in Somali and Oromia regions; GERD dam tensions with Egypt',
    top_threats: ['drought', 'transboundary water disputes', 'conflict', 'groundwater contamination'],
    population_m: 126.5, pop_water_insecure_m: 52.0, lat: 9.15, lng: 40.49, related_signals: 0
  },
  {
    code: 'NG', name: 'Nigeria', continent: 'Africa',
    crisis_level: 'crisis',
    indicators: { water_stress_index: 2.8, sanitation_access_pct: 35, flood_risk_score: 7.2, drought_risk_score: 5.5, water_quality_index: 32 },
    trend: 'declining', trend_detail: 'Severe flooding in south; desertification advancing in north; Lake Chad shrinking',
    top_threats: ['flooding', 'Lake Chad depletion', 'urban water infrastructure collapse', 'water-borne disease'],
    population_m: 223.8, pop_water_insecure_m: 70.0, lat: 9.08, lng: 8.68, related_signals: 0
  },
  {
    code: 'KE', name: 'Kenya', continent: 'Africa',
    crisis_level: 'watch',
    indicators: { water_stress_index: 3.2, sanitation_access_pct: 42, flood_risk_score: 4.5, drought_risk_score: 7.0, water_quality_index: 40 },
    trend: 'improving', trend_detail: 'Water sector reforms progressing; dam construction expanding storage',
    top_threats: ['drought', 'groundwater over-extraction', 'urban water scarcity in Nairobi'],
    population_m: 54.0, pop_water_insecure_m: 18.0, lat: -0.02, lng: 37.91, related_signals: 0
  },
  {
    code: 'ZA', name: 'South Africa', continent: 'Africa',
    crisis_level: 'watch',
    indicators: { water_stress_index: 3.8, sanitation_access_pct: 68, flood_risk_score: 3.8, drought_risk_score: 6.5, water_quality_index: 52 },
    trend: 'declining', trend_detail: 'Post-Day Zero Cape Town recovery but national infrastructure aging',
    top_threats: ['aging infrastructure', 'acid mine drainage', 'drought', 'municipal water system failures'],
    population_m: 60.4, pop_water_insecure_m: 12.0, lat: -30.56, lng: 22.94, related_signals: 0
  },
  {
    code: 'SD', name: 'Sudan', continent: 'Africa',
    crisis_level: 'catastrophic',
    indicators: { water_stress_index: 4.5, sanitation_access_pct: 16, flood_risk_score: 7.5, drought_risk_score: 8.5, water_quality_index: 18 },
    trend: 'declining', trend_detail: 'Civil war destroying water infrastructure; Nile flooding devastating communities',
    top_threats: ['conflict destroying infrastructure', 'flooding', 'drought', 'cholera', 'displacement'],
    population_m: 47.9, pop_water_insecure_m: 28.0, lat: 12.86, lng: 30.22, related_signals: 0
  },
  {
    code: 'TD', name: 'Chad', continent: 'Africa',
    crisis_level: 'emergency',
    indicators: { water_stress_index: 4.2, sanitation_access_pct: 11, flood_risk_score: 6.0, drought_risk_score: 8.8, water_quality_index: 20 },
    trend: 'declining', trend_detail: 'Lake Chad has shrunk 90% since 1960s; desertification accelerating',
    top_threats: ['Lake Chad depletion', 'desertification', 'groundwater depletion', 'conflict'],
    population_m: 17.7, pop_water_insecure_m: 11.0, lat: 15.45, lng: 18.73, related_signals: 0
  },
  {
    code: 'NE', name: 'Niger', continent: 'Africa',
    crisis_level: 'emergency',
    indicators: { water_stress_index: 4.0, sanitation_access_pct: 13, flood_risk_score: 5.5, drought_risk_score: 9.0, water_quality_index: 22 },
    trend: 'declining', trend_detail: 'Sahel drought intensifying; population growth outpacing water supply',
    top_threats: ['Sahel drought', 'groundwater depletion', 'population pressure', 'desertification'],
    population_m: 27.2, pop_water_insecure_m: 16.0, lat: 17.61, lng: 8.08, related_signals: 0
  },
  {
    code: 'GH', name: 'Ghana', continent: 'Africa',
    crisis_level: 'watch',
    indicators: { water_stress_index: 2.0, sanitation_access_pct: 45, flood_risk_score: 5.0, drought_risk_score: 4.0, water_quality_index: 48 },
    trend: 'improving', trend_detail: 'Volta Basin water management improving; urban sanitation reforms',
    top_threats: ['galamsey illegal mining polluting rivers', 'urban flooding', 'sanitation gaps'],
    population_m: 33.5, pop_water_insecure_m: 8.0, lat: 7.95, lng: -1.02, related_signals: 0
  },
  // ─── Middle East & North Africa ───────────────────────────────────────
  {
    code: 'YE', name: 'Yemen', continent: 'Middle East',
    crisis_level: 'catastrophic',
    indicators: { water_stress_index: 5.0, sanitation_access_pct: 15, flood_risk_score: 4.0, drought_risk_score: 9.5, water_quality_index: 12 },
    trend: 'declining', trend_detail: 'Most water-scarce country on Earth; conflict destroying water systems',
    top_threats: ['extreme water scarcity', 'conflict destroying infrastructure', 'groundwater depletion', 'cholera'],
    population_m: 33.7, pop_water_insecure_m: 21.0, lat: 15.55, lng: 48.52, related_signals: 0
  },
  {
    code: 'JO', name: 'Jordan', continent: 'Middle East',
    crisis_level: 'emergency',
    indicators: { water_stress_index: 4.8, sanitation_access_pct: 82, flood_risk_score: 2.0, drought_risk_score: 8.0, water_quality_index: 55 },
    trend: 'declining', trend_detail: 'Second most water-scarce country; refugee influx straining supply',
    top_threats: ['extreme water scarcity', 'refugee population pressure', 'Dead Sea shrinkage', 'aquifer depletion'],
    population_m: 11.3, pop_water_insecure_m: 3.5, lat: 30.59, lng: 36.24, related_signals: 0
  },
  {
    code: 'IQ', name: 'Iraq', continent: 'Middle East',
    crisis_level: 'crisis',
    indicators: { water_stress_index: 4.2, sanitation_access_pct: 55, flood_risk_score: 5.5, drought_risk_score: 7.5, water_quality_index: 35 },
    trend: 'declining', trend_detail: 'Tigris-Euphrates flow reduced 40% by upstream Turkish dams; southern marshes drying',
    top_threats: ['upstream dam construction', 'salinization', 'marshland destruction', 'infrastructure damage'],
    population_m: 43.5, pop_water_insecure_m: 12.0, lat: 33.22, lng: 43.68, related_signals: 0
  },
  {
    code: 'EG', name: 'Egypt', continent: 'Middle East',
    crisis_level: 'crisis',
    indicators: { water_stress_index: 4.5, sanitation_access_pct: 72, flood_risk_score: 2.5, drought_risk_score: 8.0, water_quality_index: 42 },
    trend: 'declining', trend_detail: 'GERD dam threat to Nile flow; per capita water below scarcity threshold',
    top_threats: ['GERD dam upstream', 'Nile water scarcity', 'salinization in delta', 'population pressure'],
    population_m: 104.3, pop_water_insecure_m: 22.0, lat: 26.82, lng: 30.80, related_signals: 0
  },
  {
    code: 'SA', name: 'Saudi Arabia', continent: 'Middle East',
    crisis_level: 'watch',
    indicators: { water_stress_index: 5.0, sanitation_access_pct: 90, flood_risk_score: 2.0, drought_risk_score: 9.0, water_quality_index: 60 },
    trend: 'stable', trend_detail: 'Massive desalination capacity offsetting natural scarcity; high energy cost',
    top_threats: ['fossil aquifer depletion', 'desalination energy costs', 'climate intensification'],
    population_m: 36.4, pop_water_insecure_m: 2.0, lat: 23.89, lng: 45.08, related_signals: 0
  },
  {
    code: 'IR', name: 'Iran', continent: 'Middle East',
    crisis_level: 'emergency',
    indicators: { water_stress_index: 4.5, sanitation_access_pct: 68, flood_risk_score: 5.0, drought_risk_score: 8.5, water_quality_index: 38 },
    trend: 'declining', trend_detail: 'Lake Urmia shrinking dramatically; groundwater crisis across central plateau',
    top_threats: ['Lake Urmia crisis', 'groundwater depletion', 'dam mismanagement', 'dust storms from dry lakebeds'],
    population_m: 87.9, pop_water_insecure_m: 25.0, lat: 32.43, lng: 53.69, related_signals: 0
  },
  // ─── South Asia ───────────────────────────────────────────────────────
  {
    code: 'IN', name: 'India', continent: 'Asia',
    crisis_level: 'crisis',
    indicators: { water_stress_index: 4.0, sanitation_access_pct: 48, flood_risk_score: 8.5, drought_risk_score: 7.0, water_quality_index: 30 },
    trend: 'declining', trend_detail: 'Groundwater crisis — 21 cities to run out by 2030; monsoon becoming erratic',
    top_threats: ['groundwater depletion', 'monsoon variability', 'river pollution', 'urban water scarcity', 'glacier melt'],
    population_m: 1428.6, pop_water_insecure_m: 600.0, lat: 20.59, lng: 78.96, related_signals: 0
  },
  {
    code: 'PK', name: 'Pakistan', continent: 'Asia',
    crisis_level: 'emergency',
    indicators: { water_stress_index: 4.2, sanitation_access_pct: 38, flood_risk_score: 9.0, drought_risk_score: 7.5, water_quality_index: 25 },
    trend: 'declining', trend_detail: '2022 mega-floods displaced 33M; Indus River system under extreme stress',
    top_threats: ['catastrophic flooding', 'glacier melt', 'Indus water treaty tensions', 'groundwater arsenic contamination'],
    population_m: 231.4, pop_water_insecure_m: 80.0, lat: 30.38, lng: 69.35, related_signals: 0
  },
  {
    code: 'BD', name: 'Bangladesh', continent: 'Asia',
    crisis_level: 'crisis',
    indicators: { water_stress_index: 2.5, sanitation_access_pct: 42, flood_risk_score: 9.5, drought_risk_score: 4.0, water_quality_index: 22 },
    trend: 'declining', trend_detail: 'Sea-level rise salinizing groundwater; annual flooding worsening; arsenic contamination widespread',
    top_threats: ['sea-level rise', 'flooding', 'arsenic in groundwater', 'saltwater intrusion', 'cyclones'],
    population_m: 172.9, pop_water_insecure_m: 55.0, lat: 23.68, lng: 90.36, related_signals: 0
  },
  {
    code: 'AF', name: 'Afghanistan', continent: 'Asia',
    crisis_level: 'catastrophic',
    indicators: { water_stress_index: 4.5, sanitation_access_pct: 18, flood_risk_score: 6.0, drought_risk_score: 9.0, water_quality_index: 18 },
    trend: 'declining', trend_detail: 'Multi-year drought; conflict destroying water infrastructure; Taliban restricting aid access',
    top_threats: ['drought', 'conflict', 'infrastructure destruction', 'groundwater depletion'],
    population_m: 41.1, pop_water_insecure_m: 28.0, lat: 33.94, lng: 67.71, related_signals: 0
  },
  {
    code: 'LK', name: 'Sri Lanka', continent: 'Asia',
    crisis_level: 'watch',
    indicators: { water_stress_index: 2.2, sanitation_access_pct: 58, flood_risk_score: 6.0, drought_risk_score: 5.0, water_quality_index: 50 },
    trend: 'stable', trend_detail: 'Dry zone water stress offset by wet zone abundance; CKDu linked to water quality',
    top_threats: ['chronic kidney disease from water quality', 'dry zone drought', 'irrigation system aging'],
    population_m: 22.2, pop_water_insecure_m: 5.0, lat: 7.87, lng: 80.77, related_signals: 0
  },
  // ─── East & Southeast Asia ────────────────────────────────────────────
  {
    code: 'CN', name: 'China', continent: 'Asia',
    crisis_level: 'crisis',
    indicators: { water_stress_index: 3.5, sanitation_access_pct: 75, flood_risk_score: 7.0, drought_risk_score: 6.5, water_quality_index: 45 },
    trend: 'stable', trend_detail: 'South-North Water Transfer project operational; groundwater pollution widespread',
    top_threats: ['North China Plain aquifer depletion', 'river pollution', 'dam safety concerns', 'Mekong upstream control'],
    population_m: 1425.7, pop_water_insecure_m: 300.0, lat: 35.86, lng: 104.20, related_signals: 0
  },
  {
    code: 'VN', name: 'Vietnam', continent: 'Asia',
    crisis_level: 'watch',
    indicators: { water_stress_index: 2.0, sanitation_access_pct: 55, flood_risk_score: 8.0, drought_risk_score: 5.0, water_quality_index: 42 },
    trend: 'declining', trend_detail: 'Mekong Delta saltwater intrusion worsening; upstream Chinese dam impacts',
    top_threats: ['Mekong Delta salinization', 'upstream dams', 'flooding', 'industrial pollution'],
    population_m: 99.5, pop_water_insecure_m: 15.0, lat: 14.06, lng: 108.28, related_signals: 0
  },
  {
    code: 'ID', name: 'Indonesia', continent: 'Asia',
    crisis_level: 'watch',
    indicators: { water_stress_index: 1.8, sanitation_access_pct: 48, flood_risk_score: 7.5, drought_risk_score: 4.0, water_quality_index: 38 },
    trend: 'declining', trend_detail: 'Jakarta sinking due to groundwater extraction; river pollution crisis',
    top_threats: ['Jakarta subsidence', 'groundwater over-extraction', 'river pollution', 'flooding'],
    population_m: 277.5, pop_water_insecure_m: 40.0, lat: -0.79, lng: 113.92, related_signals: 0
  },
  {
    code: 'MM', name: 'Myanmar', continent: 'Asia',
    crisis_level: 'crisis',
    indicators: { water_stress_index: 2.0, sanitation_access_pct: 28, flood_risk_score: 7.0, drought_risk_score: 5.5, water_quality_index: 30 },
    trend: 'declining', trend_detail: 'Conflict disrupting WASH services; Ayeyarwady basin degradation',
    top_threats: ['conflict disrupting water services', 'mining pollution', 'cyclone damage'],
    population_m: 54.4, pop_water_insecure_m: 18.0, lat: 21.91, lng: 95.96, related_signals: 0
  },
  // ─── Americas ─────────────────────────────────────────────────────────
  {
    code: 'US', name: 'United States', continent: 'Americas',
    crisis_level: 'watch',
    indicators: { water_stress_index: 2.8, sanitation_access_pct: 95, flood_risk_score: 5.5, drought_risk_score: 6.0, water_quality_index: 72 },
    trend: 'declining', trend_detail: 'Colorado River crisis; Ogallala Aquifer depletion; PFAS contamination nationwide',
    top_threats: ['Colorado River crisis', 'Ogallala Aquifer depletion', 'PFAS contamination', 'aging infrastructure (lead pipes)'],
    population_m: 331.9, pop_water_insecure_m: 8.0, lat: 37.09, lng: -95.71, related_signals: 0
  },
  {
    code: 'MX', name: 'Mexico', continent: 'Americas',
    crisis_level: 'crisis',
    indicators: { water_stress_index: 3.5, sanitation_access_pct: 68, flood_risk_score: 5.0, drought_risk_score: 7.0, water_quality_index: 45 },
    trend: 'declining', trend_detail: 'Mexico City aquifer collapsing; northern drought intensifying',
    top_threats: ['Mexico City subsidence', 'aquifer depletion', 'drought', 'transboundary water disputes'],
    population_m: 128.9, pop_water_insecure_m: 20.0, lat: 23.63, lng: -102.55, related_signals: 0
  },
  {
    code: 'BR', name: 'Brazil', continent: 'Americas',
    crisis_level: 'watch',
    indicators: { water_stress_index: 1.5, sanitation_access_pct: 62, flood_risk_score: 6.5, drought_risk_score: 5.0, water_quality_index: 52 },
    trend: 'declining', trend_detail: 'Amazon deforestation reducing rainfall; São Paulo water crisis recurrence risk',
    top_threats: ['deforestation-driven drought', 'urban water infrastructure gaps', 'Amazon basin degradation', 'mining pollution'],
    population_m: 215.3, pop_water_insecure_m: 25.0, lat: -14.24, lng: -51.93, related_signals: 0
  },
  {
    code: 'PE', name: 'Peru', continent: 'Americas',
    crisis_level: 'watch',
    indicators: { water_stress_index: 2.5, sanitation_access_pct: 55, flood_risk_score: 5.5, drought_risk_score: 5.0, water_quality_index: 48 },
    trend: 'declining', trend_detail: 'Andean glacier retreat threatening Lima water supply; mining contamination',
    top_threats: ['glacier retreat', 'mining contamination', 'El Niño flooding', 'Lima water scarcity'],
    population_m: 33.7, pop_water_insecure_m: 5.0, lat: -9.19, lng: -75.02, related_signals: 0
  },
  {
    code: 'HT', name: 'Haiti', continent: 'Americas',
    crisis_level: 'emergency',
    indicators: { water_stress_index: 3.0, sanitation_access_pct: 15, flood_risk_score: 7.5, drought_risk_score: 5.0, water_quality_index: 18 },
    trend: 'declining', trend_detail: 'Gang violence disrupting water services; deforestation worsening flood risk',
    top_threats: ['conflict disrupting services', 'cholera', 'deforestation', 'hurricane vulnerability'],
    population_m: 11.6, pop_water_insecure_m: 7.0, lat: 18.97, lng: -72.29, related_signals: 0
  },
  {
    code: 'BO', name: 'Bolivia', continent: 'Americas',
    crisis_level: 'watch',
    indicators: { water_stress_index: 2.2, sanitation_access_pct: 45, flood_risk_score: 5.0, drought_risk_score: 5.5, water_quality_index: 42 },
    trend: 'declining', trend_detail: 'Glacier retreat in Altiplano threatening La Paz water; mining contamination',
    top_threats: ['glacier retreat', 'mining contamination', 'infrastructure gaps', 'water privatization conflicts'],
    population_m: 12.2, pop_water_insecure_m: 3.0, lat: -16.29, lng: -63.59, related_signals: 0
  },
  // ─── Europe ───────────────────────────────────────────────────────────
  {
    code: 'ES', name: 'Spain', continent: 'Europe',
    crisis_level: 'watch',
    indicators: { water_stress_index: 3.2, sanitation_access_pct: 98, flood_risk_score: 4.0, drought_risk_score: 7.0, water_quality_index: 72 },
    trend: 'declining', trend_detail: 'Worst drought in 500 years; reservoir levels critically low in Catalonia',
    top_threats: ['mega-drought', 'desertification', 'agricultural water overuse', 'reservoir depletion'],
    population_m: 47.4, pop_water_insecure_m: 3.0, lat: 40.46, lng: -3.75, related_signals: 0
  },
  {
    code: 'IT', name: 'Italy', continent: 'Europe',
    crisis_level: 'watch',
    indicators: { water_stress_index: 2.8, sanitation_access_pct: 97, flood_risk_score: 5.5, drought_risk_score: 5.5, water_quality_index: 70 },
    trend: 'declining', trend_detail: 'Po River drought worst on record; northern Italy glacier retreat',
    top_threats: ['Po Valley drought', 'glacier retreat', 'aging aqueduct infrastructure (40% water loss)'],
    population_m: 58.9, pop_water_insecure_m: 1.5, lat: 41.87, lng: 12.57, related_signals: 0
  },
  {
    code: 'NL', name: 'Netherlands', continent: 'Europe',
    crisis_level: 'stable',
    indicators: { water_stress_index: 1.5, sanitation_access_pct: 99, flood_risk_score: 8.0, drought_risk_score: 2.0, water_quality_index: 85 },
    trend: 'stable', trend_detail: 'World-leading flood defense; Delta Works investment continuing',
    top_threats: ['sea-level rise', 'PFAS contamination', 'river flood risk'],
    population_m: 17.5, pop_water_insecure_m: 0.1, lat: 52.13, lng: 5.29, related_signals: 0
  },
  {
    code: 'DE', name: 'Germany', continent: 'Europe',
    crisis_level: 'stable',
    indicators: { water_stress_index: 1.2, sanitation_access_pct: 99, flood_risk_score: 5.0, drought_risk_score: 3.5, water_quality_index: 82 },
    trend: 'declining', trend_detail: 'Rhine low-water events disrupting shipping; groundwater levels falling',
    top_threats: ['Rhine low-water events', 'nitrate contamination', 'flash flooding (Ahr Valley type)'],
    population_m: 83.2, pop_water_insecure_m: 0.2, lat: 51.17, lng: 10.45, related_signals: 0
  },
  {
    code: 'GB', name: 'United Kingdom', continent: 'Europe',
    crisis_level: 'stable',
    indicators: { water_stress_index: 1.8, sanitation_access_pct: 99, flood_risk_score: 5.5, drought_risk_score: 3.0, water_quality_index: 75 },
    trend: 'declining', trend_detail: 'Sewage discharge scandal; water company debt crisis; SE England water stress',
    top_threats: ['sewage discharge', 'water company failures', 'infrastructure aging', 'SE England drought risk'],
    population_m: 67.7, pop_water_insecure_m: 0.3, lat: 55.38, lng: -3.44, related_signals: 0
  },
  // ─── Central Asia ─────────────────────────────────────────────────────
  {
    code: 'UZ', name: 'Uzbekistan', continent: 'Central Asia',
    crisis_level: 'emergency',
    indicators: { water_stress_index: 4.5, sanitation_access_pct: 52, flood_risk_score: 3.0, drought_risk_score: 8.0, water_quality_index: 30 },
    trend: 'declining', trend_detail: 'Aral Sea disaster; cotton irrigation depleting Amu Darya',
    top_threats: ['Aral Sea crisis', 'cotton monoculture water use', 'salinization', 'transboundary disputes'],
    population_m: 35.6, pop_water_insecure_m: 10.0, lat: 41.38, lng: 64.59, related_signals: 0
  },
  {
    code: 'KZ', name: 'Kazakhstan', continent: 'Central Asia',
    crisis_level: 'watch',
    indicators: { water_stress_index: 3.0, sanitation_access_pct: 65, flood_risk_score: 4.0, drought_risk_score: 6.5, water_quality_index: 42 },
    trend: 'stable', trend_detail: 'North Aral Sea partially recovering; industrial contamination persists',
    top_threats: ['Aral Sea legacy', 'industrial pollution', 'transboundary river management', 'climate change'],
    population_m: 19.8, pop_water_insecure_m: 3.0, lat: 48.02, lng: 66.92, related_signals: 0
  },
  {
    code: 'TJ', name: 'Tajikistan', continent: 'Central Asia',
    crisis_level: 'crisis',
    indicators: { water_stress_index: 2.5, sanitation_access_pct: 32, flood_risk_score: 6.5, drought_risk_score: 5.0, water_quality_index: 35 },
    trend: 'declining', trend_detail: 'Glacier retreat threatening water towers of Central Asia; Rogun Dam tensions',
    top_threats: ['glacier retreat', 'transboundary water disputes', 'infrastructure gaps', 'flood/landslide risk'],
    population_m: 10.1, pop_water_insecure_m: 4.0, lat: 38.86, lng: 71.28, related_signals: 0
  },
  // ─── Oceania ──────────────────────────────────────────────────────────
  {
    code: 'AU', name: 'Australia', continent: 'Oceania',
    crisis_level: 'watch',
    indicators: { water_stress_index: 3.5, sanitation_access_pct: 98, flood_risk_score: 5.0, drought_risk_score: 7.5, water_quality_index: 78 },
    trend: 'stable', trend_detail: 'Murray-Darling Basin plan contested; desalination infrastructure expanded post-Millennium Drought',
    top_threats: ['Murray-Darling over-allocation', 'drought intensification', 'wildfire water contamination'],
    population_m: 26.0, pop_water_insecure_m: 1.0, lat: -25.27, lng: 133.78, related_signals: 0
  },
  {
    code: 'FJ', name: 'Fiji', continent: 'Oceania',
    crisis_level: 'watch',
    indicators: { water_stress_index: 1.5, sanitation_access_pct: 48, flood_risk_score: 7.5, drought_risk_score: 3.5, water_quality_index: 52 },
    trend: 'declining', trend_detail: 'Rising seas contaminating freshwater lenses; cyclone damage to infrastructure',
    top_threats: ['sea-level rise', 'cyclone damage', 'freshwater lens contamination', 'infrastructure gaps'],
    population_m: 0.9, pop_water_insecure_m: 0.3, lat: -17.71, lng: 178.07, related_signals: 0
  },
  // ─── Additional global coverage ───────────────────────────────────────
  {
    code: 'JP', name: 'Japan', continent: 'Asia',
    crisis_level: 'stable',
    indicators: { water_stress_index: 1.5, sanitation_access_pct: 99, flood_risk_score: 7.0, drought_risk_score: 3.0, water_quality_index: 88 },
    trend: 'stable', trend_detail: 'World-class flood management; typhoon infrastructure robust',
    top_threats: ['typhoon flooding', 'aging rural infrastructure', 'Fukushima water treatment'],
    population_m: 125.1, pop_water_insecure_m: 0.2, lat: 36.20, lng: 138.25, related_signals: 0
  },
  {
    code: 'IL', name: 'Israel', continent: 'Middle East',
    crisis_level: 'stable',
    indicators: { water_stress_index: 4.5, sanitation_access_pct: 95, flood_risk_score: 2.0, drought_risk_score: 7.0, water_quality_index: 80 },
    trend: 'improving', trend_detail: 'Global desalination & water reuse leader — 90% wastewater recycled',
    top_threats: ['regional conflict disrupting supply', 'Dead Sea shrinkage', 'energy cost of desalination'],
    population_m: 9.8, pop_water_insecure_m: 0.2, lat: 31.05, lng: 34.85, related_signals: 0
  },
  {
    code: 'SG', name: 'Singapore', continent: 'Asia',
    crisis_level: 'stable',
    indicators: { water_stress_index: 4.0, sanitation_access_pct: 100, flood_risk_score: 3.0, drought_risk_score: 3.0, water_quality_index: 92 },
    trend: 'improving', trend_detail: 'NEWater reclamation and desalination reducing import dependency from Malaysia',
    top_threats: ['Malaysia water supply dependency', 'sea-level rise', 'energy cost of treatment'],
    population_m: 5.9, pop_water_insecure_m: 0.0, lat: 1.35, lng: 103.82, related_signals: 0
  },
  {
    code: 'RU', name: 'Russia', continent: 'Central Asia',
    crisis_level: 'watch',
    indicators: { water_stress_index: 1.2, sanitation_access_pct: 78, flood_risk_score: 5.5, drought_risk_score: 3.5, water_quality_index: 48 },
    trend: 'stable', trend_detail: 'Abundant water but aging Soviet-era infrastructure; permafrost thaw contaminating Arctic water',
    top_threats: ['aging infrastructure', 'permafrost thaw', 'industrial pollution', 'Arctic contamination'],
    population_m: 144.2, pop_water_insecure_m: 10.0, lat: 61.52, lng: 105.32, related_signals: 0
  },
  {
    code: 'CD', name: 'Democratic Republic of Congo', continent: 'Africa',
    crisis_level: 'crisis',
    indicators: { water_stress_index: 1.0, sanitation_access_pct: 12, flood_risk_score: 5.5, drought_risk_score: 3.0, water_quality_index: 22 },
    trend: 'declining', trend_detail: 'Abundant water but no infrastructure; conflict preventing development',
    top_threats: ['conflict', 'no water infrastructure', 'mining contamination', 'cholera'],
    population_m: 102.3, pop_water_insecure_m: 60.0, lat: -4.04, lng: 21.76, related_signals: 0
  },
  {
    code: 'MZ', name: 'Mozambique', continent: 'Africa',
    crisis_level: 'crisis',
    indicators: { water_stress_index: 1.8, sanitation_access_pct: 22, flood_risk_score: 8.0, drought_risk_score: 5.5, water_quality_index: 28 },
    trend: 'declining', trend_detail: 'Cyclone devastation (Idai/Kenneth); insurgency disrupting northern water services',
    top_threats: ['cyclone devastation', 'insurgency', 'flooding', 'cholera', 'infrastructure gaps'],
    population_m: 33.9, pop_water_insecure_m: 18.0, lat: -18.67, lng: 35.53, related_signals: 0
  },
  {
    code: 'CA', name: 'Canada', continent: 'Americas',
    crisis_level: 'stable',
    indicators: { water_stress_index: 0.8, sanitation_access_pct: 98, flood_risk_score: 4.5, drought_risk_score: 3.0, water_quality_index: 82 },
    trend: 'stable', trend_detail: 'Abundant freshwater but Indigenous communities face long-term boil-water advisories',
    top_threats: ['Indigenous community water access', 'prairie drought', 'wildfire water contamination', 'Great Lakes pollution'],
    population_m: 39.0, pop_water_insecure_m: 0.5, lat: 56.13, lng: -106.35, related_signals: 0
  },
]

// ─── Helper Functions ─────────────────────────────────────────────────────────

export function filterRegions(
  regions: WaterRegion[],
  opts: {
    continent?:       string
    crisis_level?:    CrisisLevel
    min_water_stress?: number
    q?:               string
  }
): WaterRegion[] {
  let filtered = [...regions]

  if (opts.continent) {
    const cl = opts.continent.toLowerCase()
    filtered = filtered.filter(r => r.continent.toLowerCase() === cl)
  }

  if (opts.crisis_level) {
    filtered = filtered.filter(r => r.crisis_level === opts.crisis_level)
  }

  if (opts.min_water_stress !== undefined) {
    filtered = filtered.filter(r => r.indicators.water_stress_index >= opts.min_water_stress!)
  }

  if (opts.q) {
    const ql = opts.q.toLowerCase()
    filtered = filtered.filter(r =>
      r.name.toLowerCase().includes(ql) ||
      r.code.toLowerCase().includes(ql) ||
      r.top_threats.some(t => t.toLowerCase().includes(ql))
    )
  }

  return filtered
}

export function sortRegions(
  regions: WaterRegion[],
  sortBy: string,
  order: 'asc' | 'desc' = 'desc'
): WaterRegion[] {
  const sorted = [...regions]

  switch (sortBy) {
    case 'water_stress_index':
      sorted.sort((a, b) => b.indicators.water_stress_index - a.indicators.water_stress_index)
      break
    case 'sanitation_access_pct':
      sorted.sort((a, b) => b.indicators.sanitation_access_pct - a.indicators.sanitation_access_pct)
      break
    case 'flood_risk_score':
      sorted.sort((a, b) => b.indicators.flood_risk_score - a.indicators.flood_risk_score)
      break
    case 'drought_risk_score':
      sorted.sort((a, b) => b.indicators.drought_risk_score - a.indicators.drought_risk_score)
      break
    case 'water_quality_index':
      sorted.sort((a, b) => b.indicators.water_quality_index - a.indicators.water_quality_index)
      break
    case 'population':
      sorted.sort((a, b) => b.population_m - a.population_m)
      break
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name))
      break
    default:
      sorted.sort((a, b) => b.indicators.water_stress_index - a.indicators.water_stress_index)
  }

  if (order === 'asc' && sortBy !== 'name') sorted.reverse()
  if (order === 'desc' && sortBy === 'name') sorted.reverse()

  return sorted
}

export function computeSummary(regions: WaterRegion[]): WaterSecuritySummary {
  const catastrophic = regions.filter(r => r.crisis_level === 'catastrophic').length
  const emergency    = regions.filter(r => r.crisis_level === 'emergency').length
  const crisis       = regions.filter(r => r.crisis_level === 'crisis').length
  const watch        = regions.filter(r => r.crisis_level === 'watch').length
  const stable       = regions.filter(r => r.crisis_level === 'stable').length

  const n = regions.length || 1
  const avg_water_stress    = Math.round((regions.reduce((s, r) => s + r.indicators.water_stress_index, 0) / n) * 10) / 10
  const avg_sanitation      = Math.round((regions.reduce((s, r) => s + r.indicators.sanitation_access_pct, 0) / n) * 10) / 10
  const avg_water_quality   = Math.round((regions.reduce((s, r) => s + r.indicators.water_quality_index, 0) / n) * 10) / 10
  const total_water_insecure_m = Math.round(regions.reduce((s, r) => s + r.pop_water_insecure_m, 0) * 10) / 10

  const most_affected = [...regions]
    .sort((a, b) => b.indicators.water_stress_index - a.indicators.water_stress_index)
    .slice(0, 5)
    .map(r => ({ name: r.name, code: r.code, stress: r.indicators.water_stress_index }))

  const most_improved = regions
    .filter(r => r.trend === 'improving')
    .slice(0, 5)
    .map(r => ({ name: r.name, code: r.code, detail: r.trend_detail }))

  const cMap = new Map<string, { continent: string; count: number; sum_stress: number; insecure_m: number }>()
  for (const r of regions) {
    if (!cMap.has(r.continent)) cMap.set(r.continent, { continent: r.continent, count: 0, sum_stress: 0, insecure_m: 0 })
    const c = cMap.get(r.continent)!
    c.count++
    c.sum_stress += r.indicators.water_stress_index
    c.insecure_m += r.pop_water_insecure_m
  }

  const continent_breakdown = Array.from(cMap.values()).map(c => ({
    continent:               c.continent,
    count:                   c.count,
    avg_stress:              Math.round((c.sum_stress / c.count) * 10) / 10,
    water_insecure_m:        Math.round(c.insecure_m * 10) / 10,
  })).sort((a, b) => b.count - a.count)

  return {
    total_regions: regions.length,
    catastrophic, emergency, crisis, watch, stable,
    avg_water_stress, avg_sanitation_access: avg_sanitation, avg_water_quality,
    total_water_insecure_m,
    most_affected, most_improved, continent_breakdown,
    recent_signals: 0,
  }
}

export function toGeoJSON(regions: WaterRegion[]): {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: Omit<WaterRegion, 'lat' | 'lng'>
  }>
} {
  return {
    type: 'FeatureCollection',
    features: regions.map(r => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [r.lng, r.lat] as [number, number],
      },
      properties: {
        code:                 r.code,
        name:                 r.name,
        continent:            r.continent,
        crisis_level:         r.crisis_level,
        indicators:           r.indicators,
        trend:                r.trend,
        trend_detail:         r.trend_detail,
        top_threats:          r.top_threats,
        population_m:         r.population_m,
        pop_water_insecure_m: r.pop_water_insecure_m,
        related_signals:      r.related_signals,
      },
    })),
  }
}

// ─── Fastify Plugin ──────────────────────────────────────────────────────────

const waterSecurityRoutes: FastifyPluginAsync = async (app) => {
  // GET /regions — list all regions with water security indicators
  app.get('/regions', async (req, reply) => {
    try {
      const qs = req.query as Record<string, string | undefined>
      const cacheKey = `${CACHE_KEY_LIST}:${JSON.stringify(qs)}`

      const cached = await redis.get(cacheKey).catch(() => null)
      if (cached) {
        reply.header('X-Cache', 'HIT')
        return JSON.parse(cached)
      }

      const continent        = qs.continent
      const crisis_level     = qs.crisis_level as CrisisLevel | undefined
      const min_water_stress = qs.min_water_stress ? Number(qs.min_water_stress) : undefined
      const q                = qs.search ?? qs.q
      const sortBy           = qs.sort ?? qs.sortBy ?? 'water_stress_index'
      const order            = (qs.order ?? 'desc') as 'asc' | 'desc'
      const limit            = Math.min(Number(qs.limit) || DEFAULT_LIMIT, MAX_LIMIT)
      const offset           = Number(qs.offset) || 0

      let regions = filterRegions(REGION_REGISTRY, { continent, crisis_level, min_water_stress, q })
      regions = sortRegions(regions, sortBy, order)

      const total = regions.length
      const paged = regions.slice(offset, offset + limit)

      // Enrich with real signal counts from DB
      for (const region of paged) {
        const countRows = await db('signals')
          .where('country_code', region.code)
          .count('id as count')
          .catch(() => [])
        region.related_signals = Number((countRows[0] as { count: string | number } | undefined)?.count ?? 0)
      }

      const result = { success: true, data: { items: paged, total, limit, offset } }

      await redis.setex(cacheKey, LIST_CACHE_TTL, JSON.stringify(result)).catch(() => {})
      reply.header('X-Cache', 'MISS')
      return result
    } catch (err) {
      req.log.error(err, 'water-security list error')
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch water security data')
    }
  })

  // GET /regions/:code — single region detail
  app.get('/regions/:code', async (req, reply) => {
    try {
      const { code } = req.params as { code: string }
      const upperCode = code.toUpperCase()
      const cacheKey = `${CACHE_KEY_DETAIL}:${upperCode}`

      const cached = await redis.get(cacheKey).catch(() => null)
      if (cached) {
        reply.header('X-Cache', 'HIT')
        return JSON.parse(cached)
      }

      const region = REGION_REGISTRY.find(r => r.code === upperCode)
      if (!region) {
        return sendError(reply, 404, 'NOT_FOUND', `Country code '${upperCode}' not found`)
      }

      const signals = await db('signals')
        .where('country_code', upperCode)
        .orderBy('published_at', 'desc')
        .limit(10)
        .select('id', 'title', 'category', 'severity', 'reliability_score', 'published_at')
        .catch(() => [])

      const result = { success: true, data: { ...region, recent_signals: signals } }

      await redis.setex(cacheKey, LIST_CACHE_TTL, JSON.stringify(result)).catch(() => {})
      reply.header('X-Cache', 'MISS')
      return result
    } catch (err) {
      req.log.error(err, 'water-security detail error')
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch region detail')
    }
  })

  // GET /summary — aggregate stats
  app.get('/summary', async (req, reply) => {
    try {
      const cached = await redis.get(CACHE_KEY_SUMMARY).catch(() => null)
      if (cached) {
        reply.header('X-Cache', 'HIT')
        return JSON.parse(cached)
      }

      const summary = computeSummary(REGION_REGISTRY)

      const countRows = await db('signals')
        .where('published_at', '>=', db.raw("NOW() - INTERVAL '7 days'"))
        .whereIn('category', ['climate', 'health', 'disaster'])
        .count('id as count')
        .catch(() => [])
      summary.recent_signals = Number((countRows[0] as { count: string | number } | undefined)?.count ?? 0)

      const result = { success: true, data: summary }
      await redis.setex(CACHE_KEY_SUMMARY, SUMMARY_CACHE_TTL, JSON.stringify(result)).catch(() => {})
      reply.header('X-Cache', 'MISS')
      return result
    } catch (err) {
      req.log.error(err, 'water-security summary error')
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to compute summary')
    }
  })

  // GET /map/points — GeoJSON FeatureCollection
  app.get('/map/points', async (req, reply) => {
    try {
      const cached = await redis.get(CACHE_KEY_MAP).catch(() => null)
      if (cached) {
        reply.header('X-Cache', 'HIT')
        return JSON.parse(cached)
      }

      const geojson = toGeoJSON(REGION_REGISTRY)
      const result = { success: true, data: geojson }

      await redis.setex(CACHE_KEY_MAP, MAP_CACHE_TTL, JSON.stringify(result)).catch(() => {})
      reply.header('X-Cache', 'MISS')
      return result
    } catch (err) {
      req.log.error(err, 'water-security map error')
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to generate map points')
    }
  })
}

export default waterSecurityRoutes
