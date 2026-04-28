/**
 * Food Security Intelligence API
 *
 * Tracks global food security conditions — hunger indices, crop production,
 * food price inflation, supply chain disruptions, and crisis alerts.
 * Monitors food insecurity across regions using data from FAO, FEWS NET,
 * IFPRI, WFP, and other authoritative sources.
 *
 * Endpoints:
 *   GET /api/v1/food-security/regions          — list all monitored regions with indicators
 *   GET /api/v1/food-security/regions/:code    — single region detail with recent signals
 *   GET /api/v1/food-security/summary          — aggregate stats & crisis breakdown
 *   GET /api/v1/food-security/map/points       — GeoJSON PointCollection for map layer
 *
 * Data sources:
 * - FAO Food Price Index (baseline 100)
 * - Global Hunger Index (0-100, lower is better)
 * - IPC Phase Classification (1-5)
 * - FEWS NET Outlook classifications
 * - WFP food security monitoring
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
export const CACHE_KEY_LIST     = 'food-security:regions'
export const CACHE_KEY_SUMMARY  = 'food-security:summary'
export const CACHE_KEY_MAP      = 'food-security:map'
export const CACHE_KEY_DETAIL   = 'food-security:region'

// ─── Types ────────────────────────────────────────────────────────────────────

/** IPC Phase Classification (Integrated Food Security Phase Classification) */
export type IPCPhase = 1 | 2 | 3 | 4 | 5

export const IPC_LABELS: Record<IPCPhase, string> = {
  1: 'Minimal',
  2: 'Stressed',
  3: 'Crisis',
  4: 'Emergency',
  5: 'Famine',
}

export interface FoodSecurityIndicators {
  hunger_index:          number   // 0-100, Global Hunger Index (lower is better)
  food_price_index:      number   // FAO Food Price Index (baseline 100)
  ipc_phase:             IPCPhase // 1-5, highest active phase in region
  cropland_stress_pct:   number   // 0-100, % of cropland under drought/flood stress
  population_food_insecure_m: number // millions of people food insecure
}

export type CrisisLevel = 'stable' | 'watch' | 'crisis' | 'emergency' | 'famine'
export type Trend = 'improving' | 'declining' | 'stable'

export interface FoodSecurityRegion {
  code:                  string
  name:                  string
  continent:             string
  crisis_level:          CrisisLevel
  indicators:            FoodSecurityIndicators
  trend:                 Trend
  trend_detail:          string   // e.g. "Hunger index -2.1 from last quarter"
  top_threats:           string[] // e.g. ["drought", "conflict", "locust"]
  population_m:          number   // total population in millions
  related_signals:       number
}

export interface FoodSecuritySummary {
  total_regions:         number
  stable:                number
  watch:                 number
  crisis:                number
  emergency:             number
  famine:                number
  total_food_insecure_m: number
  avg_hunger_index:      number
  avg_food_price_index:  number
  most_affected:         Array<{ code: string; name: string; crisis_level: CrisisLevel; hunger_index: number }>
  most_improved:         Array<{ code: string; name: string; trend: Trend; trend_detail: string }>
  continent_breakdown:   Array<{ continent: string; regions: number; avg_hunger_index: number; food_insecure_m: number }>
}

// ─── Registry: 60 regions/countries with food security data ──────────────────

export const FOOD_SECURITY_REGISTRY: FoodSecurityRegion[] = [
  // ── Sub-Saharan Africa (highest food insecurity region globally) ──
  { code: 'ET', name: 'Ethiopia', continent: 'Africa', crisis_level: 'emergency',
    indicators: { hunger_index: 53.2, food_price_index: 178, ipc_phase: 4, cropland_stress_pct: 62, population_food_insecure_m: 20.4 },
    trend: 'declining', trend_detail: 'Hunger index +3.8 from last quarter due to drought', top_threats: ['drought', 'conflict', 'displacement'],
    population_m: 126.5, related_signals: 0 },
  { code: 'SO', name: 'Somalia', continent: 'Africa', crisis_level: 'famine',
    indicators: { hunger_index: 71.8, food_price_index: 215, ipc_phase: 5, cropland_stress_pct: 78, population_food_insecure_m: 6.9 },
    trend: 'declining', trend_detail: 'IPC Phase 5 in Bay and Bakool regions', top_threats: ['drought', 'conflict', 'al-Shabaab disruption'],
    population_m: 18.1, related_signals: 0 },
  { code: 'SD', name: 'Sudan', continent: 'Africa', crisis_level: 'emergency',
    indicators: { hunger_index: 58.4, food_price_index: 312, ipc_phase: 4, cropland_stress_pct: 55, population_food_insecure_m: 18.3 },
    trend: 'declining', trend_detail: 'Civil war disrupting supply chains across Darfur', top_threats: ['conflict', 'displacement', 'supply chain collapse'],
    population_m: 47.9, related_signals: 0 },
  { code: 'SS', name: 'South Sudan', continent: 'Africa', crisis_level: 'emergency',
    indicators: { hunger_index: 64.2, food_price_index: 245, ipc_phase: 4, cropland_stress_pct: 60, population_food_insecure_m: 7.8 },
    trend: 'declining', trend_detail: 'Flooding + conflict compound food crisis', top_threats: ['conflict', 'flooding', 'economic collapse'],
    population_m: 11.4, related_signals: 0 },
  { code: 'CD', name: 'DR Congo', continent: 'Africa', crisis_level: 'emergency',
    indicators: { hunger_index: 49.8, food_price_index: 189, ipc_phase: 4, cropland_stress_pct: 42, population_food_insecure_m: 25.6 },
    trend: 'declining', trend_detail: 'Eastern DRC conflict displacing farming communities', top_threats: ['conflict', 'displacement', 'disease outbreak'],
    population_m: 102.3, related_signals: 0 },
  { code: 'NG', name: 'Nigeria', continent: 'Africa', crisis_level: 'crisis',
    indicators: { hunger_index: 38.9, food_price_index: 192, ipc_phase: 3, cropland_stress_pct: 35, population_food_insecure_m: 26.5 },
    trend: 'declining', trend_detail: 'Food inflation >30% year-on-year in northern states', top_threats: ['inflation', 'Boko Haram', 'flooding'],
    population_m: 223.8, related_signals: 0 },
  { code: 'MG', name: 'Madagascar', continent: 'Africa', crisis_level: 'crisis',
    indicators: { hunger_index: 46.1, food_price_index: 165, ipc_phase: 3, cropland_stress_pct: 58, population_food_insecure_m: 3.1 },
    trend: 'stable', trend_detail: 'Grand Sud drought persists but aid scaling up', top_threats: ['drought', 'cyclone season', 'deforestation'],
    population_m: 30.3, related_signals: 0 },
  { code: 'ML', name: 'Mali', continent: 'Africa', crisis_level: 'crisis',
    indicators: { hunger_index: 42.3, food_price_index: 174, ipc_phase: 3, cropland_stress_pct: 40, population_food_insecure_m: 4.8 },
    trend: 'declining', trend_detail: 'Sahel insecurity disrupting farming + trade routes', top_threats: ['conflict', 'drought', 'governance collapse'],
    population_m: 22.6, related_signals: 0 },
  { code: 'BF', name: 'Burkina Faso', continent: 'Africa', crisis_level: 'emergency',
    indicators: { hunger_index: 45.7, food_price_index: 168, ipc_phase: 4, cropland_stress_pct: 48, population_food_insecure_m: 3.5 },
    trend: 'declining', trend_detail: 'Jihadist blockades cutting food supply to north', top_threats: ['conflict', 'displacement', 'drought'],
    population_m: 22.7, related_signals: 0 },
  { code: 'NE', name: 'Niger', continent: 'Africa', crisis_level: 'crisis',
    indicators: { hunger_index: 44.1, food_price_index: 159, ipc_phase: 3, cropland_stress_pct: 52, population_food_insecure_m: 4.4 },
    trend: 'stable', trend_detail: 'Aid deliveries partially offsetting crop failure', top_threats: ['drought', 'locust', 'governance instability'],
    population_m: 26.2, related_signals: 0 },
  { code: 'KE', name: 'Kenya', continent: 'Africa', crisis_level: 'watch',
    indicators: { hunger_index: 23.5, food_price_index: 142, ipc_phase: 2, cropland_stress_pct: 28, population_food_insecure_m: 5.4 },
    trend: 'improving', trend_detail: 'Good rains in pastoral areas, food prices stabilizing', top_threats: ['drought risk', 'inflation', 'locust residual'],
    population_m: 55.1, related_signals: 0 },
  { code: 'MZ', name: 'Mozambique', continent: 'Africa', crisis_level: 'crisis',
    indicators: { hunger_index: 39.4, food_price_index: 155, ipc_phase: 3, cropland_stress_pct: 44, population_food_insecure_m: 3.3 },
    trend: 'declining', trend_detail: 'Cabo Delgado insurgency + cyclone recovery ongoing', top_threats: ['conflict', 'cyclone', 'displacement'],
    population_m: 33.9, related_signals: 0 },
  { code: 'ZW', name: 'Zimbabwe', continent: 'Africa', crisis_level: 'crisis',
    indicators: { hunger_index: 36.8, food_price_index: 188, ipc_phase: 3, cropland_stress_pct: 38, population_food_insecure_m: 5.3 },
    trend: 'stable', trend_detail: 'El Niño effects waning but economic crisis persists', top_threats: ['economic crisis', 'drought', 'currency collapse'],
    population_m: 16.7, related_signals: 0 },
  { code: 'TZ', name: 'Tanzania', continent: 'Africa', crisis_level: 'watch',
    indicators: { hunger_index: 25.3, food_price_index: 132, ipc_phase: 2, cropland_stress_pct: 22, population_food_insecure_m: 3.8 },
    trend: 'improving', trend_detail: 'Improved harvest + government subsidy program', top_threats: ['climate variability', 'aflatoxin', 'post-harvest loss'],
    population_m: 65.5, related_signals: 0 },
  { code: 'UG', name: 'Uganda', continent: 'Africa', crisis_level: 'watch',
    indicators: { hunger_index: 27.1, food_price_index: 138, ipc_phase: 2, cropland_stress_pct: 20, population_food_insecure_m: 4.2 },
    trend: 'stable', trend_detail: 'Refugee hosting strains food system in Karamoja', top_threats: ['refugee burden', 'locust residual', 'flooding'],
    population_m: 48.6, related_signals: 0 },
  { code: 'CM', name: 'Cameroon', continent: 'Africa', crisis_level: 'crisis',
    indicators: { hunger_index: 33.2, food_price_index: 151, ipc_phase: 3, cropland_stress_pct: 30, population_food_insecure_m: 4.7 },
    trend: 'declining', trend_detail: 'Anglophone crisis + Boko Haram in Far North', top_threats: ['conflict', 'displacement', 'flooding'],
    population_m: 28.6, related_signals: 0 },

  // ── Middle East & North Africa ──
  { code: 'YE', name: 'Yemen', continent: 'Middle East', crisis_level: 'famine',
    indicators: { hunger_index: 68.3, food_price_index: 280, ipc_phase: 5, cropland_stress_pct: 72, population_food_insecure_m: 17.4 },
    trend: 'declining', trend_detail: 'Ongoing conflict devastating food imports + agriculture', top_threats: ['conflict', 'economic collapse', 'port blockade'],
    population_m: 34.4, related_signals: 0 },
  { code: 'SY', name: 'Syria', continent: 'Middle East', crisis_level: 'emergency',
    indicators: { hunger_index: 52.1, food_price_index: 245, ipc_phase: 4, cropland_stress_pct: 55, population_food_insecure_m: 12.1 },
    trend: 'stable', trend_detail: 'Partial stabilization but wheat production at 40% of pre-war', top_threats: ['conflict legacy', 'economic sanctions', 'drought'],
    population_m: 22.1, related_signals: 0 },
  { code: 'PS', name: 'Palestine', continent: 'Middle East', crisis_level: 'famine',
    indicators: { hunger_index: 72.5, food_price_index: 340, ipc_phase: 5, cropland_stress_pct: 85, population_food_insecure_m: 2.2 },
    trend: 'declining', trend_detail: 'Gaza crisis: near-total food system collapse', top_threats: ['conflict', 'siege', 'infrastructure destruction'],
    population_m: 5.4, related_signals: 0 },
  { code: 'LB', name: 'Lebanon', continent: 'Middle East', crisis_level: 'crisis',
    indicators: { hunger_index: 29.8, food_price_index: 220, ipc_phase: 3, cropland_stress_pct: 25, population_food_insecure_m: 2.1 },
    trend: 'stable', trend_detail: 'Currency collapse stabilized but food poverty persists', top_threats: ['economic crisis', 'refugee burden', 'infrastructure decay'],
    population_m: 5.5, related_signals: 0 },
  { code: 'IQ', name: 'Iraq', continent: 'Middle East', crisis_level: 'watch',
    indicators: { hunger_index: 21.4, food_price_index: 148, ipc_phase: 2, cropland_stress_pct: 35, population_food_insecure_m: 2.4 },
    trend: 'improving', trend_detail: 'Oil revenues funding food ration system', top_threats: ['water scarcity', 'climate change', 'ISIS remnants'],
    population_m: 44.5, related_signals: 0 },

  // ── South Asia ──
  { code: 'AF', name: 'Afghanistan', continent: 'Asia', crisis_level: 'emergency',
    indicators: { hunger_index: 56.8, food_price_index: 198, ipc_phase: 4, cropland_stress_pct: 58, population_food_insecure_m: 19.9 },
    trend: 'stable', trend_detail: 'Taliban governance limits aid access; drought ongoing', top_threats: ['drought', 'economic collapse', 'aid restrictions'],
    population_m: 42.2, related_signals: 0 },
  { code: 'PK', name: 'Pakistan', continent: 'Asia', crisis_level: 'crisis',
    indicators: { hunger_index: 34.2, food_price_index: 172, ipc_phase: 3, cropland_stress_pct: 32, population_food_insecure_m: 36.5 },
    trend: 'stable', trend_detail: 'Post-flood recovery in Sindh/Balochistan continues', top_threats: ['flooding', 'inflation', 'climate change'],
    population_m: 240.5, related_signals: 0 },
  { code: 'BD', name: 'Bangladesh', continent: 'Asia', crisis_level: 'watch',
    indicators: { hunger_index: 24.8, food_price_index: 145, ipc_phase: 2, cropland_stress_pct: 22, population_food_insecure_m: 11.3 },
    trend: 'improving', trend_detail: 'Rice production strong but Rohingya camps strained', top_threats: ['flooding', 'cyclone', 'salinity intrusion'],
    population_m: 172.9, related_signals: 0 },
  { code: 'NP', name: 'Nepal', continent: 'Asia', crisis_level: 'watch',
    indicators: { hunger_index: 22.1, food_price_index: 135, ipc_phase: 2, cropland_stress_pct: 18, population_food_insecure_m: 4.1 },
    trend: 'improving', trend_detail: 'Government food security programs showing results', top_threats: ['landslide', 'climate change', 'trade dependency'],
    population_m: 30.9, related_signals: 0 },
  { code: 'LK', name: 'Sri Lanka', continent: 'Asia', crisis_level: 'watch',
    indicators: { hunger_index: 19.3, food_price_index: 162, ipc_phase: 2, cropland_stress_pct: 15, population_food_insecure_m: 6.3 },
    trend: 'improving', trend_detail: 'Post-economic crisis recovery; fertilizer imports resumed', top_threats: ['economic recovery', 'debt crisis', 'climate variability'],
    population_m: 22.2, related_signals: 0 },
  { code: 'MM', name: 'Myanmar', continent: 'Asia', crisis_level: 'emergency',
    indicators: { hunger_index: 41.5, food_price_index: 185, ipc_phase: 4, cropland_stress_pct: 40, population_food_insecure_m: 15.2 },
    trend: 'declining', trend_detail: 'Civil war destroying rice belt production', top_threats: ['conflict', 'displacement', 'sanctions'],
    population_m: 54.4, related_signals: 0 },

  // ── Central America & Caribbean ──
  { code: 'HT', name: 'Haiti', continent: 'Americas', crisis_level: 'emergency',
    indicators: { hunger_index: 55.3, food_price_index: 210, ipc_phase: 4, cropland_stress_pct: 50, population_food_insecure_m: 5.2 },
    trend: 'declining', trend_detail: 'Gang violence blocking food distribution in Port-au-Prince', top_threats: ['gang violence', 'governance collapse', 'hurricane season'],
    population_m: 11.7, related_signals: 0 },
  { code: 'GT', name: 'Guatemala', continent: 'Americas', crisis_level: 'crisis',
    indicators: { hunger_index: 29.5, food_price_index: 152, ipc_phase: 3, cropland_stress_pct: 28, population_food_insecure_m: 4.6 },
    trend: 'stable', trend_detail: 'Dry Corridor chronic malnutrition persists', top_threats: ['drought', 'poverty', 'climate change'],
    population_m: 18.1, related_signals: 0 },
  { code: 'HN', name: 'Honduras', continent: 'Americas', crisis_level: 'watch',
    indicators: { hunger_index: 22.5, food_price_index: 140, ipc_phase: 2, cropland_stress_pct: 22, population_food_insecure_m: 2.8 },
    trend: 'stable', trend_detail: 'Dry Corridor vulnerable; social programs helping', top_threats: ['drought', 'hurricane risk', 'poverty'],
    population_m: 10.4, related_signals: 0 },
  { code: 'SV', name: 'El Salvador', continent: 'Americas', crisis_level: 'watch',
    indicators: { hunger_index: 18.4, food_price_index: 135, ipc_phase: 2, cropland_stress_pct: 18, population_food_insecure_m: 1.1 },
    trend: 'improving', trend_detail: 'Security improvements enabling agricultural recovery', top_threats: ['climate change', 'economic inequality', 'drought risk'],
    population_m: 6.3, related_signals: 0 },
  { code: 'NI', name: 'Nicaragua', continent: 'Americas', crisis_level: 'watch',
    indicators: { hunger_index: 20.2, food_price_index: 138, ipc_phase: 2, cropland_stress_pct: 20, population_food_insecure_m: 1.4 },
    trend: 'stable', trend_detail: 'Political isolation affecting food trade; subsistence OK', top_threats: ['political isolation', 'hurricane risk', 'poverty'],
    population_m: 7.0, related_signals: 0 },
  { code: 'CU', name: 'Cuba', continent: 'Americas', crisis_level: 'crisis',
    indicators: { hunger_index: 26.8, food_price_index: 195, ipc_phase: 3, cropland_stress_pct: 30, population_food_insecure_m: 3.8 },
    trend: 'declining', trend_detail: 'Worst food shortage in 30 years; ration system failing', top_threats: ['economic sanctions', 'energy crisis', 'agricultural collapse'],
    population_m: 11.1, related_signals: 0 },
  { code: 'VE', name: 'Venezuela', continent: 'Americas', crisis_level: 'crisis',
    indicators: { hunger_index: 31.5, food_price_index: 205, ipc_phase: 3, cropland_stress_pct: 28, population_food_insecure_m: 9.3 },
    trend: 'stable', trend_detail: 'Hyperinflation easing but food access still limited', top_threats: ['economic crisis', 'sanctions', 'agricultural decline'],
    population_m: 28.4, related_signals: 0 },

  // ── Global producers & stable reference points ──
  { code: 'IN', name: 'India', continent: 'Asia', crisis_level: 'watch',
    indicators: { hunger_index: 27.3, food_price_index: 138, ipc_phase: 2, cropland_stress_pct: 18, population_food_insecure_m: 189.2 },
    trend: 'improving', trend_detail: 'Record wheat harvest; NFSA coverage expanding', top_threats: ['heat waves', 'groundwater depletion', 'inequality'],
    population_m: 1441.7, related_signals: 0 },
  { code: 'CN', name: 'China', continent: 'Asia', crisis_level: 'stable',
    indicators: { hunger_index: 6.4, food_price_index: 112, ipc_phase: 1, cropland_stress_pct: 8, population_food_insecure_m: 15.8 },
    trend: 'stable', trend_detail: 'Strategic grain reserves at capacity; pork cycle normalizing', top_threats: ['trade dependency', 'arable land loss', 'water stress'],
    population_m: 1425.2, related_signals: 0 },
  { code: 'US', name: 'United States', continent: 'Americas', crisis_level: 'stable',
    indicators: { hunger_index: 4.2, food_price_index: 108, ipc_phase: 1, cropland_stress_pct: 5, population_food_insecure_m: 44.2 },
    trend: 'stable', trend_detail: 'SNAP benefits supporting 42M; food bank demand elevated', top_threats: ['inequality', 'climate extreme events', 'supply chain concentration'],
    population_m: 340.1, related_signals: 0 },
  { code: 'BR', name: 'Brazil', continent: 'Americas', crisis_level: 'stable',
    indicators: { hunger_index: 9.1, food_price_index: 118, ipc_phase: 1, cropland_stress_pct: 10, population_food_insecure_m: 33.1 },
    trend: 'improving', trend_detail: 'Record soybean/corn exports; Bolsa Família expansion', top_threats: ['deforestation', 'Amazon drought', 'inequality'],
    population_m: 216.4, related_signals: 0 },
  { code: 'ID', name: 'Indonesia', continent: 'Asia', crisis_level: 'watch',
    indicators: { hunger_index: 18.2, food_price_index: 128, ipc_phase: 2, cropland_stress_pct: 14, population_food_insecure_m: 21.5 },
    trend: 'improving', trend_detail: 'Rice self-sufficiency program on track', top_threats: ['El Niño', 'palm oil dependency', 'rice import vulnerability'],
    population_m: 277.5, related_signals: 0 },
  { code: 'UA', name: 'Ukraine', continent: 'Europe', crisis_level: 'crisis',
    indicators: { hunger_index: 15.8, food_price_index: 165, ipc_phase: 3, cropland_stress_pct: 35, population_food_insecure_m: 5.9 },
    trend: 'stable', trend_detail: 'Grain exports resumed via corridor; frontline areas food insecure', top_threats: ['conflict', 'mine contamination', 'infrastructure damage'],
    population_m: 37.0, related_signals: 0 },
  { code: 'EG', name: 'Egypt', continent: 'Africa', crisis_level: 'watch',
    indicators: { hunger_index: 16.5, food_price_index: 175, ipc_phase: 2, cropland_stress_pct: 12, population_food_insecure_m: 18.5 },
    trend: 'stable', trend_detail: 'Wheat import dependency remains; bread subsidy program vital', top_threats: ['import dependency', 'currency devaluation', 'Nile water stress'],
    population_m: 112.7, related_signals: 0 },
  { code: 'TD', name: 'Chad', continent: 'Africa', crisis_level: 'emergency',
    indicators: { hunger_index: 48.5, food_price_index: 172, ipc_phase: 4, cropland_stress_pct: 55, population_food_insecure_m: 6.9 },
    trend: 'declining', trend_detail: 'Sudanese refugees straining food system in east', top_threats: ['refugee influx', 'drought', 'Lake Chad shrinkage'],
    population_m: 18.3, related_signals: 0 },
  { code: 'CF', name: 'Central African Republic', continent: 'Africa', crisis_level: 'emergency',
    indicators: { hunger_index: 52.3, food_price_index: 182, ipc_phase: 4, cropland_stress_pct: 42, population_food_insecure_m: 2.9 },
    trend: 'stable', trend_detail: 'Chronic conflict + limited aid access', top_threats: ['conflict', 'governance collapse', 'displacement'],
    population_m: 5.5, related_signals: 0 },

  // ── East Asia & Pacific ──
  { code: 'KP', name: 'North Korea', continent: 'Asia', crisis_level: 'crisis',
    indicators: { hunger_index: 39.8, food_price_index: 190, ipc_phase: 3, cropland_stress_pct: 42, population_food_insecure_m: 11.0 },
    trend: 'stable', trend_detail: 'Chronic food deficit; limited data transparency', top_threats: ['isolation', 'climate', 'agricultural inefficiency'],
    population_m: 26.1, related_signals: 0 },
  { code: 'TL', name: 'Timor-Leste', continent: 'Asia', crisis_level: 'crisis',
    indicators: { hunger_index: 37.6, food_price_index: 148, ipc_phase: 3, cropland_stress_pct: 32, population_food_insecure_m: 0.5 },
    trend: 'improving', trend_detail: 'Agricultural modernization programs showing results', top_threats: ['rice import dependency', 'El Niño', 'malnutrition'],
    population_m: 1.4, related_signals: 0 },
  { code: 'PG', name: 'Papua New Guinea', continent: 'Oceania', crisis_level: 'watch',
    indicators: { hunger_index: 28.4, food_price_index: 140, ipc_phase: 2, cropland_stress_pct: 18, population_food_insecure_m: 2.8 },
    trend: 'stable', trend_detail: 'Subsistence agriculture vulnerable to El Niño', top_threats: ['El Niño', 'remoteness', 'infrastructure gap'],
    population_m: 10.1, related_signals: 0 },

  // ── Global producer/trade reference ──
  { code: 'RU', name: 'Russia', continent: 'Europe', crisis_level: 'stable',
    indicators: { hunger_index: 7.8, food_price_index: 115, ipc_phase: 1, cropland_stress_pct: 6, population_food_insecure_m: 4.2 },
    trend: 'stable', trend_detail: 'Major wheat exporter; domestic food supply secure', top_threats: ['sanctions impact', 'logistics', 'climate variability'],
    population_m: 144.2, related_signals: 0 },
  { code: 'AU', name: 'Australia', continent: 'Oceania', crisis_level: 'stable',
    indicators: { hunger_index: 3.8, food_price_index: 105, ipc_phase: 1, cropland_stress_pct: 8, population_food_insecure_m: 3.1 },
    trend: 'stable', trend_detail: 'Major grain exporter; climate-resilient agricultural sector', top_threats: ['drought risk', 'bushfire', 'export dependency'],
    population_m: 26.5, related_signals: 0 },
  { code: 'AR', name: 'Argentina', continent: 'Americas', crisis_level: 'watch',
    indicators: { hunger_index: 11.2, food_price_index: 145, ipc_phase: 2, cropland_stress_pct: 12, population_food_insecure_m: 10.5 },
    trend: 'improving', trend_detail: 'Economic reform reducing food inflation from peak', top_threats: ['economic volatility', 'drought', 'Paraná River levels'],
    population_m: 46.3, related_signals: 0 },
  { code: 'TH', name: 'Thailand', continent: 'Asia', crisis_level: 'stable',
    indicators: { hunger_index: 8.5, food_price_index: 112, ipc_phase: 1, cropland_stress_pct: 10, population_food_insecure_m: 3.2 },
    trend: 'stable', trend_detail: 'Rice exporter; government price support for farmers', top_threats: ['water management', 'aging farmers', 'climate change'],
    population_m: 71.8, related_signals: 0 },
  { code: 'VN', name: 'Vietnam', continent: 'Asia', crisis_level: 'stable',
    indicators: { hunger_index: 9.2, food_price_index: 110, ipc_phase: 1, cropland_stress_pct: 8, population_food_insecure_m: 4.1 },
    trend: 'improving', trend_detail: '2nd largest rice exporter; Mekong Delta productive', top_threats: ['Mekong dam impact', 'salinity intrusion', 'urbanization'],
    population_m: 99.5, related_signals: 0 },
  { code: 'PH', name: 'Philippines', continent: 'Asia', crisis_level: 'watch',
    indicators: { hunger_index: 19.8, food_price_index: 135, ipc_phase: 2, cropland_stress_pct: 16, population_food_insecure_m: 12.8 },
    trend: 'stable', trend_detail: 'Rice tariffication improving imports; typhoon vulnerability', top_threats: ['typhoon', 'rice import dependency', 'inflation'],
    population_m: 117.3, related_signals: 0 },
  { code: 'MX', name: 'Mexico', continent: 'Americas', crisis_level: 'watch',
    indicators: { hunger_index: 12.4, food_price_index: 128, ipc_phase: 2, cropland_stress_pct: 14, population_food_insecure_m: 20.8 },
    trend: 'stable', trend_detail: 'SEGALMEX subsidy program; corn self-sufficiency push', top_threats: ['drought', 'trade policy', 'inequality'],
    population_m: 128.9, related_signals: 0 },

  // ── Europe (stable references with food poverty pockets) ──
  { code: 'FR', name: 'France', continent: 'Europe', crisis_level: 'stable',
    indicators: { hunger_index: 3.1, food_price_index: 106, ipc_phase: 1, cropland_stress_pct: 4, population_food_insecure_m: 8.0 },
    trend: 'stable', trend_detail: 'EU CAP support; food bank demand elevated post-pandemic', top_threats: ['climate change', 'farm labor shortage', 'input costs'],
    population_m: 68.2, related_signals: 0 },
  { code: 'DE', name: 'Germany', continent: 'Europe', crisis_level: 'stable',
    indicators: { hunger_index: 3.5, food_price_index: 108, ipc_phase: 1, cropland_stress_pct: 5, population_food_insecure_m: 5.6 },
    trend: 'stable', trend_detail: 'Food poverty among refugees; agricultural sector efficient', top_threats: ['energy costs', 'food poverty', 'import dependency'],
    population_m: 84.5, related_signals: 0 },
]

// ─── Filter Helpers ──────────────────────────────────────────────────────────

export function filterRegions(
  regions: FoodSecurityRegion[],
  opts: { continent?: string; crisis_level?: CrisisLevel; min_hunger_index?: number; search?: string },
): FoodSecurityRegion[] {
  let result = [...regions]

  if (opts.continent) {
    const c = opts.continent.toLowerCase()
    result = result.filter(r => r.continent.toLowerCase() === c)
  }
  if (opts.crisis_level) {
    result = result.filter(r => r.crisis_level === opts.crisis_level)
  }
  if (opts.min_hunger_index !== undefined && !isNaN(opts.min_hunger_index)) {
    result = result.filter(r => r.indicators.hunger_index >= opts.min_hunger_index!)
  }
  if (opts.search) {
    const q = opts.search.toLowerCase()
    result = result.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.code.toLowerCase() === q ||
      r.continent.toLowerCase().includes(q) ||
      r.top_threats.some(t => t.toLowerCase().includes(q)),
    )
  }

  return result
}

export function sortRegions(
  regions: FoodSecurityRegion[],
  sortBy: string = 'hunger_index',
  order: 'asc' | 'desc' = 'desc',
): FoodSecurityRegion[] {
  const sorted = [...regions]
  sorted.sort((a, b) => {
    let va: number, vb: number
    switch (sortBy) {
      case 'hunger_index':
        va = a.indicators.hunger_index; vb = b.indicators.hunger_index; break
      case 'food_price_index':
        va = a.indicators.food_price_index; vb = b.indicators.food_price_index; break
      case 'ipc_phase':
        va = a.indicators.ipc_phase; vb = b.indicators.ipc_phase; break
      case 'population_food_insecure':
        va = a.indicators.population_food_insecure_m; vb = b.indicators.population_food_insecure_m; break
      case 'name':
        return order === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
      default:
        va = a.indicators.hunger_index; vb = b.indicators.hunger_index
    }
    return order === 'asc' ? va - vb : vb - va
  })
  return sorted
}

export function computeSummary(regions: FoodSecurityRegion[]): FoodSecuritySummary {
  const levels = { stable: 0, watch: 0, crisis: 0, emergency: 0, famine: 0 }
  let totalHunger = 0
  let totalFPI = 0
  let totalInsecure = 0
  const continentMap = new Map<string, { regions: number; hungerSum: number; insecureSum: number }>()

  for (const r of regions) {
    levels[r.crisis_level]++
    totalHunger += r.indicators.hunger_index
    totalFPI += r.indicators.food_price_index
    totalInsecure += r.indicators.population_food_insecure_m

    const cm = continentMap.get(r.continent) ?? { regions: 0, hungerSum: 0, insecureSum: 0 }
    cm.regions++
    cm.hungerSum += r.indicators.hunger_index
    cm.insecureSum += r.indicators.population_food_insecure_m
    continentMap.set(r.continent, cm)
  }

  const n = regions.length || 1

  // Most affected: top 5 by hunger index
  const mostAffected = [...regions]
    .sort((a, b) => b.indicators.hunger_index - a.indicators.hunger_index)
    .slice(0, 5)
    .map(r => ({ code: r.code, name: r.name, crisis_level: r.crisis_level, hunger_index: r.indicators.hunger_index }))

  // Most improved: regions with 'improving' trend
  const mostImproved = regions
    .filter(r => r.trend === 'improving')
    .slice(0, 5)
    .map(r => ({ code: r.code, name: r.name, trend: r.trend, trend_detail: r.trend_detail }))

  const continent_breakdown = Array.from(continentMap.entries()).map(([continent, data]) => ({
    continent,
    regions: data.regions,
    avg_hunger_index: Math.round((data.hungerSum / data.regions) * 10) / 10,
    food_insecure_m: Math.round(data.insecureSum * 10) / 10,
  })).sort((a, b) => b.avg_hunger_index - a.avg_hunger_index)

  return {
    total_regions: regions.length,
    ...levels,
    total_food_insecure_m: Math.round(totalInsecure * 10) / 10,
    avg_hunger_index: Math.round((totalHunger / n) * 10) / 10,
    avg_food_price_index: Math.round((totalFPI / n) * 10) / 10,
    most_affected: mostAffected,
    most_improved: mostImproved,
    continent_breakdown,
  }
}

export function toGeoJSON(regions: FoodSecurityRegion[]): GeoJSON.FeatureCollection {
  // Country centroid coordinates (approximate)
  const centroids: Record<string, [number, number]> = {
    ET: [9.1, 40.5], SO: [5.2, 46.2], SD: [15.5, 32.5], SS: [7.9, 29.9],
    CD: [-4.0, 21.8], NG: [9.1, 8.7], MG: [-18.8, 46.9], ML: [17.6, -4.0],
    BF: [12.4, -1.5], NE: [17.6, 8.1], KE: [-0.0, 37.9], MZ: [-18.7, 35.5],
    ZW: [-20.0, 30.0], TZ: [-6.4, 34.9], UG: [1.4, 32.3], CM: [7.4, 12.4],
    YE: [15.6, 48.5], SY: [35.0, 38.0], PS: [31.9, 35.2], LB: [33.9, 35.8],
    IQ: [33.2, 43.7], AF: [33.9, 67.7], PK: [30.4, 69.3], BD: [23.7, 90.4],
    NP: [28.2, 84.3], LK: [7.9, 80.8], MM: [21.9, 96.0], HT: [19.0, -72.3],
    GT: [15.8, -90.2], HN: [15.2, -86.2], SV: [13.8, -88.9], NI: [12.9, -85.2],
    CU: [21.5, -79.0], VE: [6.4, -66.6], IN: [20.6, 78.0], CN: [35.9, 104.2],
    US: [37.1, -95.7], BR: [-14.2, -51.9], ID: [-0.8, 113.9], UA: [48.4, 31.2],
    EG: [26.8, 30.8], TD: [15.5, 18.7], CF: [6.6, 20.9], KP: [40.3, 127.5],
    TL: [-8.9, 125.7], PG: [-6.3, 143.9], RU: [61.5, 105.3], AU: [-25.3, 133.8],
    AR: [-38.4, -63.6], TH: [15.9, 100.9], VN: [14.1, 108.3], PH: [12.9, 121.8],
    MX: [23.6, -102.6], FR: [46.2, 2.2], DE: [51.2, 10.5],
  }

  const features: GeoJSON.Feature[] = regions
    .filter(r => centroids[r.code])
    .map(r => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [centroids[r.code]![1], centroids[r.code]![0]],
      },
      properties: {
        code: r.code,
        name: r.name,
        crisis_level: r.crisis_level,
        hunger_index: r.indicators.hunger_index,
        ipc_phase: r.indicators.ipc_phase,
        food_insecure_m: r.indicators.population_food_insecure_m,
        trend: r.trend,
      },
    }))

  return { type: 'FeatureCollection' as const, features }
}

// ─── Route Plugin ────────────────────────────────────────────────────────────

const foodSecurityPlugin: FastifyPluginAsync = async (app) => {

  // GET /regions — list all monitored regions with food security indicators
  app.get('/regions', async (req, reply) => {
    try {
      const qs = req.query as Record<string, string | undefined>
      const cacheKey = `${CACHE_KEY_LIST}:${JSON.stringify(qs)}`

      // Check cache
      const cached = await redis.get(cacheKey).catch(() => null)
      if (cached) {
        reply.header('X-Cache', 'HIT')
        return JSON.parse(cached)
      }

      let regions = filterRegions(FOOD_SECURITY_REGISTRY, {
        continent: qs.continent,
        crisis_level: qs.crisis_level as CrisisLevel | undefined,
        min_hunger_index: qs.min_hunger_index ? Number(qs.min_hunger_index) : undefined,
        search: qs.search,
      })

      regions = sortRegions(regions, qs.sort_by, (qs.order as 'asc' | 'desc') ?? 'desc')

      const limit = Math.min(Math.max(Number(qs.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
      const offset = Math.max(Number(qs.offset) || 0, 0)
      const paged = regions.slice(offset, offset + limit)

      // Enrich with DB signal counts
      const enriched = await Promise.all(paged.map(async (r) => {
        try {
          const countRows = await db('signals')
            .where('location_name', 'ilike', `%${r.name}%`)
            .whereRaw("category IN ('health', 'climate', 'disaster', 'economy')")
            .count('id as count')
          const count = (countRows[0] as { count: string | number } | undefined)?.count ?? 0
          return { ...r, related_signals: Number(count) }
        } catch {
          return r
        }
      }))

      const result = { success: true, data: enriched, total: regions.length, limit, offset }
      await redis.setex(cacheKey, LIST_CACHE_TTL, JSON.stringify(result)).catch(() => {})
      reply.header('X-Cache', 'MISS')
      return result
    } catch (err) {
      return sendError(reply, 500, 'FOOD_SECURITY_LIST_ERROR', 'Failed to fetch food security regions')
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

      const region = FOOD_SECURITY_REGISTRY.find(r => r.code === upperCode)
      if (!region) {
        return sendError(reply, 404, 'REGION_NOT_FOUND', `No food security data for region code: ${upperCode}`)
      }

      // Fetch recent signals from DB
      let recentSignals: unknown[] = []
      try {
        recentSignals = await db('signals')
          .where('location_name', 'ilike', `%${region.name}%`)
          .whereRaw("category IN ('health', 'climate', 'disaster', 'economy')")
          .orderBy('published_at', 'desc')
          .limit(10)
          .select('id', 'title', 'category', 'severity', 'reliability_score', 'published_at', 'source_url')
      } catch {
        // DB unavailable — continue without signals
      }

      const result = { success: true, data: { ...region, recent_signals: recentSignals } }
      await redis.setex(cacheKey, LIST_CACHE_TTL, JSON.stringify(result)).catch(() => {})
      reply.header('X-Cache', 'MISS')
      return result
    } catch (err) {
      return sendError(reply, 500, 'FOOD_SECURITY_DETAIL_ERROR', 'Failed to fetch region detail')
    }
  })

  // GET /summary — aggregate food security stats
  app.get('/summary', async (req, reply) => {
    try {
      const cached = await redis.get(CACHE_KEY_SUMMARY).catch(() => null)
      if (cached) {
        reply.header('X-Cache', 'HIT')
        return JSON.parse(cached)
      }

      const summary = computeSummary(FOOD_SECURITY_REGISTRY)
      const result = { success: true, data: summary }
      await redis.setex(CACHE_KEY_SUMMARY, SUMMARY_CACHE_TTL, JSON.stringify(result)).catch(() => {})
      reply.header('X-Cache', 'MISS')
      return result
    } catch (err) {
      return sendError(reply, 500, 'FOOD_SECURITY_SUMMARY_ERROR', 'Failed to compute food security summary')
    }
  })

  // GET /map/points — GeoJSON FeatureCollection for map layer
  app.get('/map/points', async (req, reply) => {
    try {
      const cached = await redis.get(CACHE_KEY_MAP).catch(() => null)
      if (cached) {
        reply.header('X-Cache', 'HIT')
        return JSON.parse(cached)
      }

      const geojson = toGeoJSON(FOOD_SECURITY_REGISTRY)
      const result = { success: true, data: geojson }
      await redis.setex(CACHE_KEY_MAP, MAP_CACHE_TTL, JSON.stringify(result)).catch(() => {})
      reply.header('X-Cache', 'MISS')
      return result
    } catch (err) {
      return sendError(reply, 500, 'FOOD_SECURITY_MAP_ERROR', 'Failed to generate food security map data')
    }
  })
}

export default foodSecurityPlugin
