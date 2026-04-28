/**
 * Labor Rights Intelligence API
 *
 * Tracks global labor rights conditions — worker protections, union freedoms,
 * wage adequacy, workplace safety, forced labor risk, and labor dispute alerts.
 * Monitors labor rights across countries using data from ILO, ITUC, IndustriALL,
 * Equal Times, Clean Clothes Campaign, and other authoritative sources.
 *
 * Endpoints:
 *   GET /api/v1/labor-rights/countries          — list all monitored countries with indicators
 *   GET /api/v1/labor-rights/countries/:code    — single country detail with recent signals
 *   GET /api/v1/labor-rights/summary            — aggregate stats & rights violation breakdown
 *   GET /api/v1/labor-rights/map/points         — GeoJSON PointCollection for map layer
 *
 * Data sources:
 * - ITUC Global Rights Index (1-5+, lower is better)
 * - ILO Labour Standards Ratification
 * - Global Slavery Index (forced labor prevalence)
 * - Workplace fatality rates (ILO STAT)
 * - Minimum wage adequacy (% of living wage)
 */

import type { FastifyPluginAsync } from 'fastify'
import { db }    from '../db/postgres'
import { redis } from '../db/redis'
import { sendError } from '../lib/errors'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Redis TTL for countries list cache: 1 hour */
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
export const CACHE_KEY_LIST     = 'labor-rights:countries'
export const CACHE_KEY_SUMMARY  = 'labor-rights:summary'
export const CACHE_KEY_MAP      = 'labor-rights:map'
export const CACHE_KEY_DETAIL   = 'labor-rights:country'

// ─── Types ────────────────────────────────────────────────────────────────────

/** ITUC Global Rights Index rating (1 = best, 5+ = worst) */
export type ITUCRating = 1 | 2 | 3 | 4 | 5

export const ITUC_LABELS: Record<ITUCRating, string> = {
  1: 'Irregular Violations',
  2: 'Repeated Violations',
  3: 'Regular Violations',
  4: 'Systematic Violations',
  5: 'No Guarantee of Rights',
}

export interface LaborRightsIndicators {
  ituc_rating:            ITUCRating  // 1-5, ITUC Global Rights Index
  union_density_pct:      number      // 0-100, % of workers in unions
  min_wage_adequacy_pct:  number      // 0-100+, min wage as % of living wage
  workplace_fatality_rate: number     // deaths per 100K workers/year
  forced_labor_prevalence: number     // victims per 1,000 population (Global Slavery Index)
}

export type RightsLevel = 'strong' | 'moderate' | 'weak' | 'poor' | 'critical'
export type Trend = 'improving' | 'declining' | 'stable'

export interface LaborRightsCountry {
  code:                  string
  name:                  string
  continent:             string
  rights_level:          RightsLevel
  indicators:            LaborRightsIndicators
  trend:                 Trend
  trend_detail:          string   // e.g. "Union density +2.1% after new legislation"
  top_issues:            string[] // e.g. ["forced labor", "union suppression"]
  population_m:          number   // total population in millions
  workforce_m:           number   // labor force in millions
  related_signals:       number
}

export interface LaborRightsSummary {
  total_countries:       number
  strong:                number
  moderate:              number
  weak:                  number
  poor:                  number
  critical:              number
  total_workforce_m:     number
  avg_ituc_rating:       number
  avg_union_density:     number
  most_at_risk:          Array<{ code: string; name: string; rights_level: RightsLevel; ituc_rating: ITUCRating }>
  most_improved:         Array<{ code: string; name: string; trend: Trend; trend_detail: string }>
  continent_breakdown:   Array<{ continent: string; countries: number; avg_ituc_rating: number; workforce_m: number }>
}

// ─── Registry: 50+ countries with labor rights data ───────────────────────────

export const LABOR_RIGHTS_REGISTRY: LaborRightsCountry[] = [
  // ── Northern Europe (strongest labor rights globally) ──
  { code: 'DK', name: 'Denmark', continent: 'Europe', rights_level: 'strong',
    indicators: { ituc_rating: 1, union_density_pct: 67, min_wage_adequacy_pct: 95, workplace_fatality_rate: 0.9, forced_labor_prevalence: 0.7 },
    trend: 'stable', trend_detail: 'Flexicurity model remains gold standard; sectoral bargaining covers 80%+', top_issues: ['migrant worker exploitation', 'gig economy gaps'],
    population_m: 5.9, workforce_m: 3.0, related_signals: 0 },
  { code: 'SE', name: 'Sweden', continent: 'Europe', rights_level: 'strong',
    indicators: { ituc_rating: 1, union_density_pct: 65, min_wage_adequacy_pct: 92, workplace_fatality_rate: 1.1, forced_labor_prevalence: 0.5 },
    trend: 'stable', trend_detail: 'Strong collective bargaining; debate on EU minimum wage directive', top_issues: ['platform worker classification', 'berry picker exploitation'],
    population_m: 10.5, workforce_m: 5.5, related_signals: 0 },
  { code: 'NO', name: 'Norway', continent: 'Europe', rights_level: 'strong',
    indicators: { ituc_rating: 1, union_density_pct: 50, min_wage_adequacy_pct: 88, workplace_fatality_rate: 1.0, forced_labor_prevalence: 0.6 },
    trend: 'stable', trend_detail: 'Tripartite model stable; supply chain due diligence law enacted', top_issues: ['seafood industry labor', 'construction safety'],
    population_m: 5.5, workforce_m: 2.8, related_signals: 0 },
  { code: 'FI', name: 'Finland', continent: 'Europe', rights_level: 'strong',
    indicators: { ituc_rating: 1, union_density_pct: 58, min_wage_adequacy_pct: 90, workplace_fatality_rate: 0.8, forced_labor_prevalence: 0.5 },
    trend: 'declining', trend_detail: 'Government proposed collective bargaining restrictions in 2024-25', top_issues: ['bargaining rights erosion', 'austerity measures'],
    population_m: 5.6, workforce_m: 2.7, related_signals: 0 },

  // ── Western Europe ──
  { code: 'DE', name: 'Germany', continent: 'Europe', rights_level: 'strong',
    indicators: { ituc_rating: 2, union_density_pct: 16, min_wage_adequacy_pct: 72, workplace_fatality_rate: 0.7, forced_labor_prevalence: 1.0 },
    trend: 'improving', trend_detail: 'Supply Chain Due Diligence Act (LkSG) in effect since 2023; minimum wage raised', top_issues: ['meatpacking conditions', 'subcontractor chains', 'platform work'],
    population_m: 84.5, workforce_m: 45.6, related_signals: 0 },
  { code: 'FR', name: 'France', continent: 'Europe', rights_level: 'moderate',
    indicators: { ituc_rating: 2, union_density_pct: 10, min_wage_adequacy_pct: 78, workplace_fatality_rate: 2.7, forced_labor_prevalence: 1.1 },
    trend: 'declining', trend_detail: 'Pension reform protests; labor code flexibilization continues', top_issues: ['retirement age', 'platform economy', 'workplace fatalities'],
    population_m: 68.1, workforce_m: 30.5, related_signals: 0 },
  { code: 'GB', name: 'United Kingdom', continent: 'Europe', rights_level: 'moderate',
    indicators: { ituc_rating: 3, union_density_pct: 22, min_wage_adequacy_pct: 68, workplace_fatality_rate: 0.4, forced_labor_prevalence: 2.1 },
    trend: 'improving', trend_detail: 'New Employment Rights Bill strengthening day-one rights', top_issues: ['modern slavery', 'zero-hours contracts', 'fire and rehire'],
    population_m: 67.7, workforce_m: 33.8, related_signals: 0 },
  { code: 'IT', name: 'Italy', continent: 'Europe', rights_level: 'moderate',
    indicators: { ituc_rating: 2, union_density_pct: 32, min_wage_adequacy_pct: 65, workplace_fatality_rate: 2.2, forced_labor_prevalence: 1.5 },
    trend: 'stable', trend_detail: 'Agriculture and construction exploitation persist; EU directive pending', top_issues: ['caporalato (farm labor)', 'workplace deaths', 'irregular employment'],
    population_m: 58.9, workforce_m: 25.3, related_signals: 0 },
  { code: 'ES', name: 'Spain', continent: 'Europe', rights_level: 'moderate',
    indicators: { ituc_rating: 2, union_density_pct: 13, min_wage_adequacy_pct: 70, workplace_fatality_rate: 2.5, forced_labor_prevalence: 1.2 },
    trend: 'improving', trend_detail: '2022 labor reform reducing precarious contracts; rider law enacted', top_issues: ['temporary contracts', 'youth unemployment', 'agricultural labor'],
    population_m: 47.8, workforce_m: 23.5, related_signals: 0 },

  // ── Americas ──
  { code: 'US', name: 'United States', continent: 'Americas', rights_level: 'weak',
    indicators: { ituc_rating: 4, union_density_pct: 10, min_wage_adequacy_pct: 42, workplace_fatality_rate: 3.7, forced_labor_prevalence: 1.5 },
    trend: 'stable', trend_detail: 'NLRB activism contested; Amazon/Starbucks unionization wave ongoing', top_issues: ['right-to-work laws', 'gig economy', 'warehouse safety', 'child labor resurgence'],
    population_m: 334.9, workforce_m: 164.5, related_signals: 0 },
  { code: 'CA', name: 'Canada', continent: 'Americas', rights_level: 'moderate',
    indicators: { ituc_rating: 2, union_density_pct: 29, min_wage_adequacy_pct: 65, workplace_fatality_rate: 1.8, forced_labor_prevalence: 0.9 },
    trend: 'stable', trend_detail: 'Forced labor supply chain bill (S-211) reporting now mandatory', top_issues: ['temporary foreign worker program', 'gig work', 'supply chain transparency'],
    population_m: 40.1, workforce_m: 20.8, related_signals: 0 },
  { code: 'MX', name: 'Mexico', continent: 'Americas', rights_level: 'weak',
    indicators: { ituc_rating: 4, union_density_pct: 12, min_wage_adequacy_pct: 55, workplace_fatality_rate: 3.9, forced_labor_prevalence: 3.4 },
    trend: 'improving', trend_detail: 'USMCA labor chapter driving union democratization reforms', top_issues: ['maquiladora conditions', 'protection contracts', 'forced labor in agriculture'],
    population_m: 130.2, workforce_m: 58.4, related_signals: 0 },
  { code: 'BR', name: 'Brazil', continent: 'Americas', rights_level: 'weak',
    indicators: { ituc_rating: 4, union_density_pct: 11, min_wage_adequacy_pct: 48, workplace_fatality_rate: 5.2, forced_labor_prevalence: 2.8 },
    trend: 'improving', trend_detail: 'Dirty list of slave labor employers restored; new app-worker protections', top_issues: ['slave labor in agriculture', 'informality', 'deforestation supply chains'],
    population_m: 216.4, workforce_m: 107.8, related_signals: 0 },
  { code: 'CO', name: 'Colombia', continent: 'Americas', rights_level: 'poor',
    indicators: { ituc_rating: 5, union_density_pct: 4, min_wage_adequacy_pct: 45, workplace_fatality_rate: 6.1, forced_labor_prevalence: 2.5 },
    trend: 'stable', trend_detail: 'Violence against unionists continues; ILO monitoring', top_issues: ['trade unionist murders', 'informality', 'mining conditions'],
    population_m: 52.1, workforce_m: 25.5, related_signals: 0 },
  { code: 'GT', name: 'Guatemala', continent: 'Americas', rights_level: 'poor',
    indicators: { ituc_rating: 5, union_density_pct: 2, min_wage_adequacy_pct: 38, workplace_fatality_rate: 5.8, forced_labor_prevalence: 3.2 },
    trend: 'declining', trend_detail: 'Anti-union violence persists; agriculture exploitation endemic', top_issues: ['anti-union violence', 'child labor', 'palm oil/sugar plantations'],
    population_m: 17.6, workforce_m: 7.2, related_signals: 0 },
  { code: 'HN', name: 'Honduras', continent: 'Americas', rights_level: 'poor',
    indicators: { ituc_rating: 5, union_density_pct: 5, min_wage_adequacy_pct: 40, workplace_fatality_rate: 4.9, forced_labor_prevalence: 2.8 },
    trend: 'stable', trend_detail: 'Garment sector under scrutiny; ILO Better Work program expanding', top_issues: ['garment factory conditions', 'anti-union discrimination', 'informal economy'],
    population_m: 10.4, workforce_m: 4.3, related_signals: 0 },

  // ── Middle East ──
  { code: 'QA', name: 'Qatar', continent: 'Middle East', rights_level: 'poor',
    indicators: { ituc_rating: 5, union_density_pct: 0, min_wage_adequacy_pct: 35, workplace_fatality_rate: 8.2, forced_labor_prevalence: 6.5 },
    trend: 'improving', trend_detail: 'Post-World Cup reforms: kafala partially dismantled, min wage introduced', top_issues: ['kafala remnants', 'migrant worker deaths', 'wage theft'],
    population_m: 2.7, workforce_m: 2.1, related_signals: 0 },
  { code: 'SA', name: 'Saudi Arabia', continent: 'Middle East', rights_level: 'critical',
    indicators: { ituc_rating: 5, union_density_pct: 0, min_wage_adequacy_pct: 30, workplace_fatality_rate: 9.5, forced_labor_prevalence: 7.1 },
    trend: 'stable', trend_detail: 'Unions illegal; NEOM construction worker conditions under scrutiny', top_issues: ['no right to organize', 'kafala system', 'NEOM megaproject abuses', 'domestic worker exploitation'],
    population_m: 36.9, workforce_m: 16.5, related_signals: 0 },
  { code: 'AE', name: 'UAE', continent: 'Middle East', rights_level: 'poor',
    indicators: { ituc_rating: 5, union_density_pct: 0, min_wage_adequacy_pct: 32, workplace_fatality_rate: 7.8, forced_labor_prevalence: 5.8 },
    trend: 'stable', trend_detail: 'Wage Protection System improved but enforcement gaps remain', top_issues: ['construction worker safety', 'domestic worker rights', 'kafala vestiges'],
    population_m: 10.0, workforce_m: 7.5, related_signals: 0 },
  { code: 'BH', name: 'Bahrain', continent: 'Middle East', rights_level: 'poor',
    indicators: { ituc_rating: 5, union_density_pct: 8, min_wage_adequacy_pct: 38, workplace_fatality_rate: 5.5, forced_labor_prevalence: 4.2 },
    trend: 'stable', trend_detail: 'Some union rights exist but strikes severely restricted', top_issues: ['migrant worker conditions', 'restricted strike rights', 'wage theft'],
    population_m: 1.5, workforce_m: 0.8, related_signals: 0 },

  // ── South & Southeast Asia ──
  { code: 'BD', name: 'Bangladesh', continent: 'Asia', rights_level: 'poor',
    indicators: { ituc_rating: 5, union_density_pct: 3, min_wage_adequacy_pct: 28, workplace_fatality_rate: 11.2, forced_labor_prevalence: 3.5 },
    trend: 'improving', trend_detail: 'International Accord renewed; minimum wage raised in garment sector', top_issues: ['garment factory safety', 'union suppression', 'wage theft', 'child labor'],
    population_m: 172.9, workforce_m: 73.4, related_signals: 0 },
  { code: 'IN', name: 'India', continent: 'Asia', rights_level: 'poor',
    indicators: { ituc_rating: 5, union_density_pct: 5, min_wage_adequacy_pct: 32, workplace_fatality_rate: 11.9, forced_labor_prevalence: 6.1 },
    trend: 'declining', trend_detail: 'Four new labor codes consolidating 29 laws face worker opposition', top_issues: ['bonded labor', 'informal sector', 'construction deaths', 'e-waste recycling'],
    population_m: 1428.6, workforce_m: 523.5, related_signals: 0 },
  { code: 'PK', name: 'Pakistan', continent: 'Asia', rights_level: 'poor',
    indicators: { ituc_rating: 5, union_density_pct: 2, min_wage_adequacy_pct: 25, workplace_fatality_rate: 14.3, forced_labor_prevalence: 8.6 },
    trend: 'stable', trend_detail: 'Brick kiln bonded labor persists; textile factory conditions poor', top_issues: ['bonded labor', 'brick kiln slavery', 'child labor', 'textile exploitation'],
    population_m: 240.5, workforce_m: 76.3, related_signals: 0 },
  { code: 'MM', name: 'Myanmar', continent: 'Asia', rights_level: 'critical',
    indicators: { ituc_rating: 5, union_density_pct: 1, min_wage_adequacy_pct: 20, workplace_fatality_rate: 15.8, forced_labor_prevalence: 7.9 },
    trend: 'declining', trend_detail: 'Post-coup military junta banned unions; forced labor in military supply chains', top_issues: ['military forced labor', 'union ban', 'garment sector collapse', 'jade mining'],
    population_m: 54.4, workforce_m: 22.8, related_signals: 0 },
  { code: 'KH', name: 'Cambodia', continent: 'Asia', rights_level: 'poor',
    indicators: { ituc_rating: 5, union_density_pct: 9, min_wage_adequacy_pct: 42, workplace_fatality_rate: 6.3, forced_labor_prevalence: 6.7 },
    trend: 'stable', trend_detail: 'Garment unions tolerated but independent organizers harassed', top_issues: ['garment sector', 'construction safety', 'fishing industry', 'brick kilns'],
    population_m: 17.0, workforce_m: 9.1, related_signals: 0 },
  { code: 'VN', name: 'Vietnam', continent: 'Asia', rights_level: 'weak',
    indicators: { ituc_rating: 5, union_density_pct: 25, min_wage_adequacy_pct: 48, workplace_fatality_rate: 5.5, forced_labor_prevalence: 3.1 },
    trend: 'improving', trend_detail: 'CPTPP labor chapter driving independent union pilot programs', top_issues: ['state-controlled unions', 'electronics factory conditions', 'forced overtime'],
    population_m: 99.5, workforce_m: 55.5, related_signals: 0 },
  { code: 'TH', name: 'Thailand', continent: 'Asia', rights_level: 'weak',
    indicators: { ituc_rating: 4, union_density_pct: 3, min_wage_adequacy_pct: 52, workplace_fatality_rate: 7.1, forced_labor_prevalence: 4.8 },
    trend: 'stable', trend_detail: 'Fishing industry reforms ongoing but migrant worker exploitation persists', top_issues: ['fishing industry slavery', 'migrant worker rights', 'construction safety'],
    population_m: 71.8, workforce_m: 39.2, related_signals: 0 },
  { code: 'ID', name: 'Indonesia', continent: 'Asia', rights_level: 'weak',
    indicators: { ituc_rating: 4, union_density_pct: 7, min_wage_adequacy_pct: 55, workplace_fatality_rate: 5.8, forced_labor_prevalence: 2.5 },
    trend: 'declining', trend_detail: 'Omnibus Job Creation Law weakening protections despite mass protests', top_issues: ['palm oil labor', 'mining conditions', 'Omnibus Law rollbacks', 'domestic workers'],
    population_m: 277.5, workforce_m: 140.2, related_signals: 0 },
  { code: 'PH', name: 'Philippines', continent: 'Asia', rights_level: 'poor',
    indicators: { ituc_rating: 5, union_density_pct: 8, min_wage_adequacy_pct: 45, workplace_fatality_rate: 6.8, forced_labor_prevalence: 3.9 },
    trend: 'stable', trend_detail: 'Trade unionists face harassment and red-tagging', top_issues: ['red-tagging of unionists', 'contractualization', 'overseas worker exploitation'],
    population_m: 117.3, workforce_m: 49.1, related_signals: 0 },
  { code: 'CN', name: 'China', continent: 'Asia', rights_level: 'critical',
    indicators: { ituc_rating: 5, union_density_pct: 44, min_wage_adequacy_pct: 40, workplace_fatality_rate: 4.8, forced_labor_prevalence: 3.8 },
    trend: 'declining', trend_detail: 'ACFTU is sole legal union (state-controlled); Xinjiang forced labor sanctions', top_issues: ['Xinjiang forced labor', 'state-controlled unions', '996 tech overwork', 'construction safety'],
    population_m: 1425.9, workforce_m: 779.8, related_signals: 0 },

  // ── Africa ──
  { code: 'ZA', name: 'South Africa', continent: 'Africa', rights_level: 'moderate',
    indicators: { ituc_rating: 3, union_density_pct: 25, min_wage_adequacy_pct: 52, workplace_fatality_rate: 4.5, forced_labor_prevalence: 1.8 },
    trend: 'stable', trend_detail: 'Strong labor law framework but enforcement gaps in informal sector', top_issues: ['mining safety', 'farm worker exploitation', 'informal economy', 'Marikana legacy'],
    population_m: 60.4, workforce_m: 23.7, related_signals: 0 },
  { code: 'NG', name: 'Nigeria', continent: 'Africa', rights_level: 'weak',
    indicators: { ituc_rating: 4, union_density_pct: 7, min_wage_adequacy_pct: 30, workplace_fatality_rate: 8.5, forced_labor_prevalence: 5.3 },
    trend: 'stable', trend_detail: 'New minimum wage enacted but enforcement weak in private sector', top_issues: ['child labor in mining', 'oil sector exploitation', 'informal economy'],
    population_m: 223.8, workforce_m: 70.5, related_signals: 0 },
  { code: 'ET', name: 'Ethiopia', continent: 'Africa', rights_level: 'poor',
    indicators: { ituc_rating: 4, union_density_pct: 3, min_wage_adequacy_pct: 22, workplace_fatality_rate: 10.2, forced_labor_prevalence: 5.5 },
    trend: 'declining', trend_detail: 'Industrial park wages among lowest globally; conflict disrupting labor market', top_issues: ['industrial park conditions', 'no minimum wage', 'conflict displacement'],
    population_m: 126.5, workforce_m: 55.8, related_signals: 0 },
  { code: 'KE', name: 'Kenya', continent: 'Africa', rights_level: 'weak',
    indicators: { ituc_rating: 3, union_density_pct: 12, min_wage_adequacy_pct: 38, workplace_fatality_rate: 7.2, forced_labor_prevalence: 3.2 },
    trend: 'stable', trend_detail: 'Tea and flower sector unions active but casual workers unprotected', top_issues: ['flower farm conditions', 'tea plantation labor', 'EPZ worker rights'],
    population_m: 55.1, workforce_m: 22.6, related_signals: 0 },
  { code: 'EG', name: 'Egypt', continent: 'Africa', rights_level: 'poor',
    indicators: { ituc_rating: 5, union_density_pct: 7, min_wage_adequacy_pct: 35, workplace_fatality_rate: 8.8, forced_labor_prevalence: 3.5 },
    trend: 'stable', trend_detail: 'Independent unions face repression; government-controlled ETUF dominates', top_issues: ['union suppression', 'construction worker deaths', 'child labor in agriculture'],
    population_m: 112.7, workforce_m: 30.2, related_signals: 0 },
  { code: 'GH', name: 'Ghana', continent: 'Africa', rights_level: 'weak',
    indicators: { ituc_rating: 3, union_density_pct: 15, min_wage_adequacy_pct: 42, workplace_fatality_rate: 6.5, forced_labor_prevalence: 3.8 },
    trend: 'improving', trend_detail: 'ILO Decent Work Programme gaining traction; cocoa sector reforms', top_issues: ['cocoa child labor', 'galamsey mining', 'fishing industry'],
    population_m: 33.5, workforce_m: 14.6, related_signals: 0 },

  // ── Central & Eastern Europe ──
  { code: 'PL', name: 'Poland', continent: 'Europe', rights_level: 'moderate',
    indicators: { ituc_rating: 3, union_density_pct: 11, min_wage_adequacy_pct: 62, workplace_fatality_rate: 2.1, forced_labor_prevalence: 1.3 },
    trend: 'improving', trend_detail: 'Minimum wage raised significantly; Ukrainian refugee worker protections debated', top_issues: ['migrant worker exploitation', 'temporary agency work', 'construction safety'],
    population_m: 37.7, workforce_m: 17.4, related_signals: 0 },
  { code: 'TR', name: 'Turkey', continent: 'Europe', rights_level: 'poor',
    indicators: { ituc_rating: 5, union_density_pct: 8, min_wage_adequacy_pct: 45, workplace_fatality_rate: 12.1, forced_labor_prevalence: 2.5 },
    trend: 'declining', trend_detail: 'Workplace deaths among highest in world; union restrictions tightened', top_issues: ['workplace fatalities', 'mining disasters', 'Syrian refugee exploitation', 'strike restrictions'],
    population_m: 85.8, workforce_m: 33.5, related_signals: 0 },
  { code: 'HU', name: 'Hungary', continent: 'Europe', rights_level: 'weak',
    indicators: { ituc_rating: 3, union_density_pct: 7, min_wage_adequacy_pct: 55, workplace_fatality_rate: 2.3, forced_labor_prevalence: 1.4 },
    trend: 'declining', trend_detail: 'Slave law (overtime law) still contested; union influence declining', top_issues: ['overtime law', 'auto factory conditions', 'declining union power'],
    population_m: 9.6, workforce_m: 4.7, related_signals: 0 },

  // ── East Asia ──
  { code: 'JP', name: 'Japan', continent: 'Asia', rights_level: 'moderate',
    indicators: { ituc_rating: 2, union_density_pct: 16, min_wage_adequacy_pct: 58, workplace_fatality_rate: 1.4, forced_labor_prevalence: 1.0 },
    trend: 'improving', trend_detail: 'Karoshi prevention law strengthened; technical intern program reformed', top_issues: ['karoshi (overwork deaths)', 'technical intern exploitation', 'gender pay gap'],
    population_m: 123.3, workforce_m: 69.2, related_signals: 0 },
  { code: 'KR', name: 'South Korea', continent: 'Asia', rights_level: 'moderate',
    indicators: { ituc_rating: 3, union_density_pct: 14, min_wage_adequacy_pct: 60, workplace_fatality_rate: 3.8, forced_labor_prevalence: 1.1 },
    trend: 'improving', trend_detail: 'ILO core conventions ratified 2022; workplace safety law strengthened after Itaewon', top_issues: ['industrial accident rate', 'irregular workers', 'platform labor'],
    population_m: 51.7, workforce_m: 28.6, related_signals: 0 },

  // ── Oceania ──
  { code: 'AU', name: 'Australia', continent: 'Oceania', rights_level: 'moderate',
    indicators: { ituc_rating: 3, union_density_pct: 12, min_wage_adequacy_pct: 75, workplace_fatality_rate: 1.5, forced_labor_prevalence: 1.3 },
    trend: 'improving', trend_detail: 'Closing Loopholes Act addressing gig economy and labor hire', top_issues: ['gig economy regulation', 'agricultural visa workers', 'wage theft'],
    population_m: 26.4, workforce_m: 14.0, related_signals: 0 },
  { code: 'NZ', name: 'New Zealand', continent: 'Oceania', rights_level: 'strong',
    indicators: { ituc_rating: 1, union_density_pct: 17, min_wage_adequacy_pct: 72, workplace_fatality_rate: 1.2, forced_labor_prevalence: 0.8 },
    trend: 'stable', trend_detail: 'Fair Pay Agreements Act repealed 2024; debate ongoing', top_issues: ['migrant worker exploitation', 'seasonal worker conditions', 'Fair Pay repeal'],
    population_m: 5.2, workforce_m: 2.8, related_signals: 0 },

  // ── Additional high-impact countries ──
  { code: 'RU', name: 'Russia', continent: 'Europe', rights_level: 'critical',
    indicators: { ituc_rating: 5, union_density_pct: 15, min_wage_adequacy_pct: 35, workplace_fatality_rate: 6.2, forced_labor_prevalence: 4.5 },
    trend: 'declining', trend_detail: 'Wartime labor mobilization; independent unions suppressed', top_issues: ['wartime forced labor', 'independent union suppression', 'migrant worker exploitation'],
    population_m: 144.1, workforce_m: 74.8, related_signals: 0 },
  { code: 'BY', name: 'Belarus', continent: 'Europe', rights_level: 'critical',
    indicators: { ituc_rating: 5, union_density_pct: 28, min_wage_adequacy_pct: 30, workplace_fatality_rate: 4.1, forced_labor_prevalence: 3.2 },
    trend: 'declining', trend_detail: 'Independent union leaders imprisoned post-2020; forced subbotnik labor', top_issues: ['union leader imprisonment', 'state-forced labor', 'political repression of workers'],
    population_m: 9.2, workforce_m: 4.3, related_signals: 0 },
  { code: 'IR', name: 'Iran', continent: 'Middle East', rights_level: 'critical',
    indicators: { ituc_rating: 5, union_density_pct: 2, min_wage_adequacy_pct: 25, workplace_fatality_rate: 13.5, forced_labor_prevalence: 4.8 },
    trend: 'declining', trend_detail: 'Teacher and bus driver union leaders imprisoned; strikes criminalized', top_issues: ['union leader imprisonment', 'child labor', 'workplace deaths', 'wage arrears'],
    population_m: 88.6, workforce_m: 27.2, related_signals: 0 },
  { code: 'LY', name: 'Libya', continent: 'Africa', rights_level: 'critical',
    indicators: { ituc_rating: 5, union_density_pct: 1, min_wage_adequacy_pct: 20, workplace_fatality_rate: 16.5, forced_labor_prevalence: 9.2 },
    trend: 'declining', trend_detail: 'Migrant worker enslavement documented by IOM and UN panels', top_issues: ['migrant enslavement', 'militia-controlled labor', 'no functioning labor law'],
    population_m: 7.0, workforce_m: 2.3, related_signals: 0 },
  { code: 'ER', name: 'Eritrea', continent: 'Africa', rights_level: 'critical',
    indicators: { ituc_rating: 5, union_density_pct: 0, min_wage_adequacy_pct: 15, workplace_fatality_rate: 18.0, forced_labor_prevalence: 12.3 },
    trend: 'stable', trend_detail: 'Indefinite national service constitutes state-imposed forced labor per UN', top_issues: ['indefinite conscription/forced labor', 'no union rights', 'mining exploitation'],
    population_m: 3.7, workforce_m: 1.8, related_signals: 0 },
  { code: 'KP', name: 'North Korea', continent: 'Asia', rights_level: 'critical',
    indicators: { ituc_rating: 5, union_density_pct: 0, min_wage_adequacy_pct: 5, workplace_fatality_rate: 22.0, forced_labor_prevalence: 15.0 },
    trend: 'stable', trend_detail: 'State-imposed forced labor system; overseas workers exploited for regime revenue', top_issues: ['state forced labor system', 'overseas worker exploitation', 'political prison camps'],
    population_m: 26.1, workforce_m: 14.0, related_signals: 0 },
]

// ─── Coordinates for map layer ────────────────────────────────────────────────

const COORDS: Record<string, [number, number]> = {
  DK: [55.68, 12.57], SE: [59.33, 18.07], NO: [59.91, 10.75], FI: [60.17, 24.94],
  DE: [52.52, 13.41], FR: [48.86, 2.35], GB: [51.51, -0.13], IT: [41.90, 12.50],
  ES: [40.42, -3.70], US: [38.91, -77.04], CA: [45.42, -75.70], MX: [19.43, -99.13],
  BR: [-15.79, -47.88], CO: [4.71, -74.07], GT: [14.63, -90.51], HN: [14.07, -87.22],
  QA: [25.29, 51.53], SA: [24.71, 46.68], AE: [25.20, 55.27], BH: [26.23, 50.59],
  BD: [23.81, 90.41], IN: [28.61, 77.21], PK: [33.69, 73.04], MM: [16.87, 96.20],
  KH: [11.56, 104.92], VN: [21.03, 105.85], TH: [13.76, 100.50], ID: [-6.21, 106.85],
  PH: [14.60, 120.98], CN: [39.91, 116.39], ZA: [-33.92, 18.42], NG: [9.06, 7.49],
  ET: [9.02, 38.75], KE: [-1.29, 36.82], EG: [30.04, 31.24], GH: [5.56, -0.19],
  PL: [52.23, 21.01], TR: [39.93, 32.86], HU: [47.50, 19.04], JP: [35.68, 139.69],
  KR: [37.57, 126.98], AU: [-33.87, 151.21], NZ: [-41.29, 174.78],
  RU: [55.76, 37.62], BY: [53.90, 27.57], IR: [35.69, 51.39], LY: [32.90, 13.18],
  ER: [15.34, 38.93], KP: [39.02, 125.75],
}

// ─── Helper functions ─────────────────────────────────────────────────────────

export function filterCountries(
  countries: LaborRightsCountry[],
  opts: {
    continent?: string
    rights_level?: RightsLevel
    max_ituc_rating?: number
    search?: string
  },
): LaborRightsCountry[] {
  let result = countries

  if (opts.continent) {
    const c = opts.continent.toLowerCase()
    result = result.filter(r => r.continent.toLowerCase() === c)
  }

  if (opts.rights_level) {
    result = result.filter(r => r.rights_level === opts.rights_level)
  }

  if (opts.max_ituc_rating !== undefined) {
    result = result.filter(r => r.indicators.ituc_rating <= (opts.max_ituc_rating as number))
  }

  if (opts.search) {
    const s = opts.search.toLowerCase()
    result = result.filter(r =>
      r.name.toLowerCase().includes(s) ||
      r.code.toLowerCase().includes(s) ||
      r.top_issues.some(t => t.toLowerCase().includes(s)),
    )
  }

  return result
}

type SortField = 'ituc_rating' | 'union_density_pct' | 'min_wage_adequacy_pct' |
                 'workplace_fatality_rate' | 'forced_labor_prevalence' |
                 'workforce_m' | 'name'

export function sortCountries(
  countries: LaborRightsCountry[],
  field: SortField = 'ituc_rating',
  order: 'asc' | 'desc' = 'desc',
): LaborRightsCountry[] {
  const sorted = [...countries]
  sorted.sort((a, b) => {
    let va: number | string
    let vb: number | string

    switch (field) {
      case 'ituc_rating':               va = a.indicators.ituc_rating; vb = b.indicators.ituc_rating; break
      case 'union_density_pct':         va = a.indicators.union_density_pct; vb = b.indicators.union_density_pct; break
      case 'min_wage_adequacy_pct':     va = a.indicators.min_wage_adequacy_pct; vb = b.indicators.min_wage_adequacy_pct; break
      case 'workplace_fatality_rate':   va = a.indicators.workplace_fatality_rate; vb = b.indicators.workplace_fatality_rate; break
      case 'forced_labor_prevalence':   va = a.indicators.forced_labor_prevalence; vb = b.indicators.forced_labor_prevalence; break
      case 'workforce_m':              va = a.workforce_m; vb = b.workforce_m; break
      case 'name':                     va = a.name; vb = b.name; break
      default:                         va = a.indicators.ituc_rating; vb = b.indicators.ituc_rating; break
    }

    if (typeof va === 'string' && typeof vb === 'string') {
      return order === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
    }
    return order === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number)
  })

  return sorted
}

export function computeSummary(countries: LaborRightsCountry[]): LaborRightsSummary {
  const total = countries.length
  const strong   = countries.filter(c => c.rights_level === 'strong').length
  const moderate = countries.filter(c => c.rights_level === 'moderate').length
  const weak     = countries.filter(c => c.rights_level === 'weak').length
  const poor     = countries.filter(c => c.rights_level === 'poor').length
  const critical = countries.filter(c => c.rights_level === 'critical').length

  const total_workforce_m = countries.reduce((s, c) => s + c.workforce_m, 0)
  const avg_ituc_rating   = total > 0 ? countries.reduce((s, c) => s + c.indicators.ituc_rating, 0) / total : 0
  const avg_union_density = total > 0 ? countries.reduce((s, c) => s + c.indicators.union_density_pct, 0) / total : 0

  const most_at_risk = [...countries]
    .sort((a, b) => b.indicators.ituc_rating - a.indicators.ituc_rating ||
                    b.indicators.forced_labor_prevalence - a.indicators.forced_labor_prevalence)
    .slice(0, 10)
    .map(c => ({ code: c.code, name: c.name, rights_level: c.rights_level, ituc_rating: c.indicators.ituc_rating }))

  const most_improved = countries
    .filter(c => c.trend === 'improving')
    .map(c => ({ code: c.code, name: c.name, trend: c.trend, trend_detail: c.trend_detail }))

  const continentMap = new Map<string, { countries: number; ituc_sum: number; workforce_m: number }>()
  for (const c of countries) {
    const entry = continentMap.get(c.continent) ?? { countries: 0, ituc_sum: 0, workforce_m: 0 }
    entry.countries++
    entry.ituc_sum += c.indicators.ituc_rating
    entry.workforce_m += c.workforce_m
    continentMap.set(c.continent, entry)
  }

  const continent_breakdown = Array.from(continentMap.entries())
    .map(([continent, d]) => ({
      continent,
      countries: d.countries,
      avg_ituc_rating: Math.round((d.ituc_sum / d.countries) * 10) / 10,
      workforce_m: Math.round(d.workforce_m * 10) / 10,
    }))
    .sort((a, b) => b.avg_ituc_rating - a.avg_ituc_rating)

  return {
    total_countries: total,
    strong,
    moderate,
    weak,
    poor,
    critical,
    total_workforce_m: Math.round(total_workforce_m * 10) / 10,
    avg_ituc_rating: Math.round(avg_ituc_rating * 100) / 100,
    avg_union_density: Math.round(avg_union_density * 10) / 10,
    most_at_risk,
    most_improved,
    continent_breakdown,
  }
}

export function toGeoJSON(countries: LaborRightsCountry[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: countries
      .filter(c => COORDS[c.code])
      .map(c => {
        const [lat, lng] = COORDS[c.code] as [number, number]
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [lng, lat] },
          properties: {
            code: c.code,
            name: c.name,
            rights_level: c.rights_level,
            ituc_rating: c.indicators.ituc_rating,
            union_density_pct: c.indicators.union_density_pct,
            forced_labor_prevalence: c.indicators.forced_labor_prevalence,
            trend: c.trend,
          },
        }
      }),
  }
}

// ─── Fastify Plugin ───────────────────────────────────────────────────────────

const laborRightsPlugin: FastifyPluginAsync = async (app) => {

  // GET /countries — list all monitored countries with indicators
  app.get('/countries', async (req, reply) => {
    try {
      const q = req.query as Record<string, string | undefined>

      // Check cache
      const cacheKey = `${CACHE_KEY_LIST}:${JSON.stringify(q)}`
      try {
        const cached = await redis.get(cacheKey)
        if (cached) return reply.send(JSON.parse(cached))
      } catch { /* Redis miss */ }

      let countries = filterCountries(LABOR_RIGHTS_REGISTRY, {
        continent: q.continent,
        rights_level: q.rights_level as RightsLevel | undefined,
        max_ituc_rating: q.max_ituc_rating ? Number(q.max_ituc_rating) : undefined,
        search: q.search,
      })

      const sortField = (q.sort ?? 'ituc_rating') as SortField
      const sortOrder = (q.order ?? 'desc') as 'asc' | 'desc'
      countries = sortCountries(countries, sortField, sortOrder)

      const limit  = Math.min(Number(q.limit) || DEFAULT_LIMIT, MAX_LIMIT)
      const offset = Number(q.offset) || 0

      const response = {
        success: true,
        data: countries.slice(offset, offset + limit),
        total: countries.length,
        limit,
        offset,
      }

      try { await redis.setex(cacheKey, LIST_CACHE_TTL, JSON.stringify(response)) } catch { /* ignore */ }

      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'LABOR_RIGHTS_LIST_ERROR', (err as Error).message)
    }
  })

  // GET /countries/:code — single country detail with recent signals
  app.get('/countries/:code', async (req, reply) => {
    try {
      const { code } = req.params as { code: string }
      const upper = code.toUpperCase()

      const detailKey = `${CACHE_KEY_DETAIL}:${upper}`
      try {
        const cached = await redis.get(detailKey)
        if (cached) return reply.send(JSON.parse(cached))
      } catch { /* Redis miss */ }

      const country = LABOR_RIGHTS_REGISTRY.find(c => c.code === upper)
      if (!country) {
        return sendError(reply, 404, 'COUNTRY_NOT_FOUND', `Country code ${upper} not found`)
      }

      // Fetch recent signals from DB
      let recentSignals: unknown[] = []
      try {
        recentSignals = await db('signals')
          .select('id', 'title', 'category', 'severity', 'reliability_score', 'published_at')
          .where(function (this: ReturnType<typeof db>) {
            this.whereRaw("title ILIKE ? OR content ILIKE ?", [`%${country.name}%`, `%${country.name}%`])
              .andWhere(function (this: ReturnType<typeof db>) {
                this.whereRaw("title ILIKE '%labor%' OR title ILIKE '%labour%' OR title ILIKE '%worker%' OR title ILIKE '%union%' OR title ILIKE '%wage%' OR content ILIKE '%labor%' OR content ILIKE '%labour%' OR content ILIKE '%worker%' OR content ILIKE '%union%' OR content ILIKE '%wage%'")
              })
          })
          .orderBy('published_at', 'desc')
          .limit(20)
      } catch { /* DB may not have signals table in dev */ }

      const response = {
        success: true,
        data: { ...country, recent_signals: recentSignals },
      }

      try { await redis.setex(detailKey, LIST_CACHE_TTL, JSON.stringify(response)) } catch { /* ignore */ }

      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'LABOR_RIGHTS_DETAIL_ERROR', (err as Error).message)
    }
  })

  // GET /summary — aggregate stats & rights violation breakdown
  app.get('/summary', async (req, reply) => {
    try {
      try {
        const cached = await redis.get(CACHE_KEY_SUMMARY)
        if (cached) return reply.send(JSON.parse(cached))
      } catch { /* Redis miss */ }

      const summary = computeSummary(LABOR_RIGHTS_REGISTRY)

      const response = { success: true, data: summary }

      try { await redis.setex(CACHE_KEY_SUMMARY, SUMMARY_CACHE_TTL, JSON.stringify(response)) } catch { /* ignore */ }

      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'LABOR_RIGHTS_SUMMARY_ERROR', (err as Error).message)
    }
  })

  // GET /map/points — GeoJSON FeatureCollection for map layer
  app.get('/map/points', async (req, reply) => {
    try {
      try {
        const cached = await redis.get(CACHE_KEY_MAP)
        if (cached) return reply.send(JSON.parse(cached))
      } catch { /* Redis miss */ }

      const geojson = toGeoJSON(LABOR_RIGHTS_REGISTRY)

      const response = { success: true, data: geojson }

      try { await redis.setex(CACHE_KEY_MAP, MAP_CACHE_TTL, JSON.stringify(response)) } catch { /* ignore */ }

      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'LABOR_RIGHTS_MAP_ERROR', (err as Error).message)
    }
  })
}

export default laborRightsPlugin
