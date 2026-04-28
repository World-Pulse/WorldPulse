/**
 * Digital Rights Intelligence API
 *
 * Tracks internet freedom, digital surveillance, censorship, and data protection
 * across 50+ countries. Monitors rights status and digital rights trends.
 *
 * Endpoints:
 *   GET /api/v1/digital-rights/countries          — list all countries with digital rights indicators
 *   GET /api/v1/digital-rights/countries/:code    — single country detail
 *   GET /api/v1/digital-rights/summary            — aggregate stats & rights breakdown
 *   GET /api/v1/digital-rights/map/points         — GeoJSON FeatureCollection for map layer
 *
 * Data source: Seeded registry of 50+ countries with digital rights indicators from:
 * - Freedom House (Freedom on the Net: internet_freedom_score 0-100)
 * - Access Now (#KeepItOn: internet shutdowns tracking)
 * - Ranking Digital Rights (corporate accountability)
 * - Electronic Frontier Foundation
 * - Privacy International
 * - Reporters Without Borders
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
export const CACHE_KEY_LIST     = 'digital-rights:countries'
export const CACHE_KEY_SUMMARY  = 'digital-rights:summary'
export const CACHE_KEY_MAP      = 'digital-rights:map'
export const CACHE_KEY_DETAIL   = 'digital-rights:country'

// ─── Censorship Level Labels ──────────────────────────────────────────────────

export const CENSORSHIP_LEVEL_LABELS: Record<number, string> = {
  1: 'Open',
  2: 'Monitored',
  3: 'Restricted',
  4: 'Heavily Restricted',
  5: 'Shutdown',
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DigitalRightsIndicators {
  internet_freedom_score:  number    // 0-100, Freedom House methodology (higher = more free)
  surveillance_score:      number    // 0-100 (higher = more surveillance)
  censorship_level:        1 | 2 | 3 | 4 | 5  // 1=Open, 5=Shutdown
  data_protection_score:   number    // 0-100, GDPR-type legislation strength
  digital_access_index:    number    // 0-100, connectivity + affordability
}

export interface DigitalRightsCountry {
  code:               string
  name:               string
  region:             string
  rights_status:      'free' | 'partly_free' | 'not_free'
  indicators:         DigitalRightsIndicators
  trend:              'improving' | 'declining' | 'stable'
  trend_detail:       string
  top_threats:        string[]
  population_m:       number
  related_signals:    number
}

export interface DigitalRightsSummary {
  total_countries:              number
  free:                         number
  partly_free:                  number
  not_free:                     number
  avg_internet_freedom:         number
  avg_surveillance_score:       number
  total_population_surveilled_m: number
  internet_shutdowns_this_year: number
  most_restricted:              { name: string; code: string; score: number }[]
  most_improved:                { name: string; code: string; trend_detail: string }[]
  regional_breakdown:           { region: string; count: number; avg_internet_freedom: number; population_under_surveillance_m: number }[]
  recent_signals:               number
}

// ─── Country Registry (50+ countries, diverse global coverage) ────────────────

export const COUNTRY_REGISTRY: DigitalRightsCountry[] = [
  // ─── Europe — Digital Leaders (Free) ────────────────────────────────────
  {
    code: 'EE', name: 'Estonia', region: 'Europe',
    rights_status: 'free',
    indicators: { internet_freedom_score: 94, surveillance_score: 12, censorship_level: 1, data_protection_score: 95, digital_access_index: 91 },
    trend: 'stable', trend_detail: 'World leader in e-governance; strong digital rights protections.',
    top_threats: ['minor surveillance concerns'],
    population_m: 1.3, related_signals: 0
  },
  {
    code: 'IS', name: 'Iceland', region: 'Europe',
    rights_status: 'free',
    indicators: { internet_freedom_score: 95, surveillance_score: 10, censorship_level: 1, data_protection_score: 94, digital_access_index: 98 },
    trend: 'stable', trend_detail: 'Consistently top-ranked for internet freedom globally.',
    top_threats: [],
    population_m: 0.4, related_signals: 0
  },
  {
    code: 'DE', name: 'Germany', region: 'Europe',
    rights_status: 'free',
    indicators: { internet_freedom_score: 80, surveillance_score: 28, censorship_level: 1, data_protection_score: 92, digital_access_index: 89 },
    trend: 'stable', trend_detail: 'Strong GDPR enforcement; concerns over BND surveillance law.',
    top_threats: ['state surveillance', 'data retention mandates'],
    population_m: 83.2, related_signals: 0
  },
  {
    code: 'FR', name: 'France', region: 'Europe',
    rights_status: 'free',
    indicators: { internet_freedom_score: 78, surveillance_score: 35, censorship_level: 1, data_protection_score: 90, digital_access_index: 87 },
    trend: 'declining', trend_detail: 'Surveillance powers expanded; CNIL active but political pressure increasing.',
    top_threats: ['state surveillance', 'content filtering'],
    population_m: 67.8, related_signals: 0
  },
  {
    code: 'GB', name: 'United Kingdom', region: 'Europe',
    rights_status: 'free',
    indicators: { internet_freedom_score: 79, surveillance_score: 55, censorship_level: 1, data_protection_score: 80, digital_access_index: 91 },
    trend: 'declining', trend_detail: 'Online Safety Act raises censorship concerns; Five Eyes surveillance.',
    top_threats: ['mass surveillance', 'content filtering', 'encryption backdoors'],
    population_m: 67.3, related_signals: 0
  },
  {
    code: 'NL', name: 'Netherlands', region: 'Europe',
    rights_status: 'free',
    indicators: { internet_freedom_score: 87, surveillance_score: 22, censorship_level: 1, data_protection_score: 93, digital_access_index: 95 },
    trend: 'stable', trend_detail: 'Strong civil liberties tradition; robust data protection regimes.',
    top_threats: ['minor surveillance provisions'],
    population_m: 17.6, related_signals: 0
  },
  {
    code: 'SE', name: 'Sweden', region: 'Europe',
    rights_status: 'free',
    indicators: { internet_freedom_score: 88, surveillance_score: 20, censorship_level: 1, data_protection_score: 91, digital_access_index: 94 },
    trend: 'stable', trend_detail: 'High connectivity, strong press freedom, active civil society.',
    top_threats: [],
    population_m: 10.4, related_signals: 0
  },
  {
    code: 'CA', name: 'Canada', region: 'Americas',
    rights_status: 'free',
    indicators: { internet_freedom_score: 87, surveillance_score: 32, censorship_level: 1, data_protection_score: 82, digital_access_index: 88 },
    trend: 'stable', trend_detail: 'Generally free; Bill C-18 raises content moderation concerns.',
    top_threats: ['content moderation overreach', 'Five Eyes surveillance'],
    population_m: 38.2, related_signals: 0
  },
  {
    code: 'US', name: 'United States', region: 'Americas',
    rights_status: 'free',
    indicators: { internet_freedom_score: 76, surveillance_score: 60, censorship_level: 1, data_protection_score: 55, digital_access_index: 85 },
    trend: 'declining', trend_detail: 'FISA surveillance powers, weak federal privacy law, platform-level censorship.',
    top_threats: ['mass surveillance', 'lack of federal privacy law', 'platform content moderation'],
    population_m: 331.0, related_signals: 0
  },
  {
    code: 'JP', name: 'Japan', region: 'East Asia',
    rights_status: 'free',
    indicators: { internet_freedom_score: 77, surveillance_score: 25, censorship_level: 1, data_protection_score: 75, digital_access_index: 90 },
    trend: 'stable', trend_detail: 'Generally open internet; some concerns about APPI reform pace.',
    top_threats: ['minor surveillance concerns'],
    population_m: 125.7, related_signals: 0
  },
  {
    code: 'AU', name: 'Australia', region: 'Oceania',
    rights_status: 'free',
    indicators: { internet_freedom_score: 79, surveillance_score: 45, censorship_level: 2, data_protection_score: 65, digital_access_index: 83 },
    trend: 'declining', trend_detail: 'Encryption backdoor law (TOLA), metadata retention, website blocking.',
    top_threats: ['encryption backdoors', 'metadata retention', 'website blocking'],
    population_m: 25.7, related_signals: 0
  },
  {
    code: 'NZ', name: 'New Zealand', region: 'Oceania',
    rights_status: 'free',
    indicators: { internet_freedom_score: 82, surveillance_score: 30, censorship_level: 1, data_protection_score: 78, digital_access_index: 85 },
    trend: 'stable', trend_detail: 'Good digital rights landscape; Five Eyes membership raises some concerns.',
    top_threats: ['intelligence sharing'],
    population_m: 5.1, related_signals: 0
  },

  // ─── Partly Free ────────────────────────────────────────────────────────
  {
    code: 'BR', name: 'Brazil', region: 'Americas',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 57, surveillance_score: 52, censorship_level: 2, data_protection_score: 62, digital_access_index: 65 },
    trend: 'stable', trend_detail: 'Marco Civil da Internet protects some rights; judicial blocking of X/Twitter.',
    top_threats: ['social media blocks', 'journalist targeting', 'judicial censorship'],
    population_m: 215.3, related_signals: 0
  },
  {
    code: 'IN', name: 'India', region: 'South Asia',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 50, surveillance_score: 65, censorship_level: 3, data_protection_score: 45, digital_access_index: 55 },
    trend: 'declining', trend_detail: 'Most internet shutdowns globally; DPDP Act adopted but concerns remain.',
    top_threats: ['internet shutdowns', 'mass surveillance', 'content filtering', 'VPN restrictions'],
    population_m: 1407.0, related_signals: 0
  },
  {
    code: 'ID', name: 'Indonesia', region: 'Southeast Asia',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 55, surveillance_score: 55, censorship_level: 3, data_protection_score: 48, digital_access_index: 58 },
    trend: 'declining', trend_detail: 'ITE Law abused against critics; government platform registration requirements.',
    top_threats: ['content filtering', 'social media blocks', 'journalist targeting'],
    population_m: 276.4, related_signals: 0
  },
  {
    code: 'PH', name: 'Philippines', region: 'Southeast Asia',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 58, surveillance_score: 50, censorship_level: 2, data_protection_score: 52, digital_access_index: 55 },
    trend: 'stable', trend_detail: 'Red-tagging targets activists online; disinformation ecosystem.',
    top_threats: ['journalist targeting', 'online harassment campaigns'],
    population_m: 111.0, related_signals: 0
  },
  {
    code: 'MY', name: 'Malaysia', region: 'Southeast Asia',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 56, surveillance_score: 48, censorship_level: 2, data_protection_score: 50, digital_access_index: 75 },
    trend: 'improving', trend_detail: 'Some reforms under new government; legacy laws still used against critics.',
    top_threats: ['content filtering', 'journalist targeting'],
    population_m: 33.0, related_signals: 0
  },
  {
    code: 'MX', name: 'Mexico', region: 'Americas',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 62, surveillance_score: 58, censorship_level: 2, data_protection_score: 48, digital_access_index: 60 },
    trend: 'declining', trend_detail: 'Pegasus spyware targeting journalists; cartels threatening digital security.',
    top_threats: ['targeted surveillance', 'journalist targeting'],
    population_m: 130.2, related_signals: 0
  },
  {
    code: 'KE', name: 'Kenya', region: 'Sub-Saharan Africa',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 54, surveillance_score: 50, censorship_level: 2, data_protection_score: 52, digital_access_index: 45 },
    trend: 'stable', trend_detail: 'Active civil society; Huduma Namba biometric registry concerns.',
    top_threats: ['biometric surveillance', 'internet throttling'],
    population_m: 56.0, related_signals: 0
  },
  {
    code: 'ZA', name: 'South Africa', region: 'Sub-Saharan Africa',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 66, surveillance_score: 42, censorship_level: 2, data_protection_score: 68, digital_access_index: 62 },
    trend: 'stable', trend_detail: 'POPIA (GDPR-equivalent) enacted; relatively open internet environment.',
    top_threats: ['cost of access', 'minor surveillance'],
    population_m: 60.0, related_signals: 0
  },
  {
    code: 'NG', name: 'Nigeria', region: 'Sub-Saharan Africa',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 52, surveillance_score: 55, censorship_level: 2, data_protection_score: 40, digital_access_index: 40 },
    trend: 'declining', trend_detail: 'Twitter ban lifted; cybercrime law used against critics.',
    top_threats: ['social media blocks', 'content filtering', 'journalist targeting'],
    population_m: 218.5, related_signals: 0
  },
  {
    code: 'GH', name: 'Ghana', region: 'Sub-Saharan Africa',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 60, surveillance_score: 40, censorship_level: 2, data_protection_score: 45, digital_access_index: 48 },
    trend: 'stable', trend_detail: 'One of West Africa\'s more open digital environments.',
    top_threats: ['surveillance legislation'],
    population_m: 32.4, related_signals: 0
  },
  {
    code: 'UA', name: 'Ukraine', region: 'Europe',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 60, surveillance_score: 48, censorship_level: 2, data_protection_score: 55, digital_access_index: 70 },
    trend: 'declining', trend_detail: 'Russian invasion disrupted connectivity; wartime internet restrictions.',
    top_threats: ['wartime censorship', 'infrastructure attacks', 'content filtering'],
    population_m: 43.5, related_signals: 0
  },
  {
    code: 'TR', name: 'Turkey', region: 'Middle East & North Africa',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 36, surveillance_score: 72, censorship_level: 3, data_protection_score: 40, digital_access_index: 75 },
    trend: 'declining', trend_detail: 'Social media laws restrict platforms; Wikipedia blocked for years.',
    top_threats: ['social media blocks', 'content filtering', 'journalist targeting', 'VPN bans'],
    population_m: 84.8, related_signals: 0
  },
  {
    code: 'PK', name: 'Pakistan', region: 'South Asia',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 38, surveillance_score: 68, censorship_level: 3, data_protection_score: 30, digital_access_index: 40 },
    trend: 'declining', trend_detail: 'PECA law criminalizes online criticism; political shutdowns frequent.',
    top_threats: ['internet shutdowns', 'content filtering', 'journalist targeting', 'social media blocks'],
    population_m: 231.4, related_signals: 0
  },
  {
    code: 'BD', name: 'Bangladesh', region: 'South Asia',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 40, surveillance_score: 65, censorship_level: 3, data_protection_score: 28, digital_access_index: 42 },
    trend: 'improving', trend_detail: 'Post-revolution government promises reforms; DSA repealed.',
    top_threats: ['internet shutdowns', 'content filtering', 'journalist targeting'],
    population_m: 169.0, related_signals: 0
  },
  {
    code: 'TH', name: 'Thailand', region: 'Southeast Asia',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 39, surveillance_score: 65, censorship_level: 3, data_protection_score: 45, digital_access_index: 68 },
    trend: 'declining', trend_detail: 'Lèse-majesté prosecutions extend to online speech; heavy filtering.',
    top_threats: ['content filtering', 'journalist targeting', 'social media blocks'],
    population_m: 70.0, related_signals: 0
  },
  {
    code: 'SG', name: 'Singapore', region: 'Southeast Asia',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 48, surveillance_score: 58, censorship_level: 3, data_protection_score: 72, digital_access_index: 98 },
    trend: 'stable', trend_detail: 'POFMA (fake news law) used to compel corrections; strong economic connectivity.',
    top_threats: ['content filtering', 'data localization mandates'],
    population_m: 5.9, related_signals: 0
  },
  {
    code: 'TN', name: 'Tunisia', region: 'Middle East & North Africa',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 45, surveillance_score: 55, censorship_level: 2, data_protection_score: 38, digital_access_index: 65 },
    trend: 'declining', trend_detail: 'Post-2021 coup saw digital rights backslide; activists arrested.',
    top_threats: ['journalist targeting', 'surveillance'],
    population_m: 12.0, related_signals: 0
  },
  {
    code: 'AM', name: 'Armenia', region: 'Central Asia',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 62, surveillance_score: 45, censorship_level: 2, data_protection_score: 42, digital_access_index: 72 },
    trend: 'stable', trend_detail: 'Relatively open after 2018 revolution; some wartime restrictions.',
    top_threats: ['wartime restrictions', 'surveillance'],
    population_m: 3.0, related_signals: 0
  },

  // ─── Not Free ────────────────────────────────────────────────────────────
  {
    code: 'CN', name: 'China', region: 'East Asia',
    rights_status: 'not_free',
    indicators: { internet_freedom_score: 9, surveillance_score: 99, censorship_level: 5, data_protection_score: 15, digital_access_index: 72 },
    trend: 'declining', trend_detail: 'Great Firewall blocks most global platforms; mass AI-powered surveillance.',
    top_threats: ['mass surveillance', 'content filtering', 'VPN bans', 'data localization mandates', 'social media blocks'],
    population_m: 1412.0, related_signals: 0
  },
  {
    code: 'RU', name: 'Russia', region: 'Europe',
    rights_status: 'not_free',
    indicators: { internet_freedom_score: 21, surveillance_score: 88, censorship_level: 4, data_protection_score: 20, digital_access_index: 78 },
    trend: 'declining', trend_detail: 'SORM mass surveillance; most Western platforms blocked post-2022.',
    top_threats: ['mass surveillance', 'content filtering', 'social media blocks', 'VPN bans', 'journalist targeting'],
    population_m: 144.0, related_signals: 0
  },
  {
    code: 'IR', name: 'Iran', region: 'Middle East & North Africa',
    rights_status: 'not_free',
    indicators: { internet_freedom_score: 16, surveillance_score: 90, censorship_level: 5, data_protection_score: 10, digital_access_index: 55 },
    trend: 'declining', trend_detail: 'National intranet project (SHOMA); shutdowns during protests.',
    top_threats: ['internet shutdowns', 'mass surveillance', 'content filtering', 'VPN bans', 'social media blocks'],
    population_m: 86.8, related_signals: 0
  },
  {
    code: 'KP', name: 'North Korea', region: 'East Asia',
    rights_status: 'not_free',
    indicators: { internet_freedom_score: 1, surveillance_score: 100, censorship_level: 5, data_protection_score: 1, digital_access_index: 2 },
    trend: 'stable', trend_detail: 'No public internet; Kwangmyong intranet only for elite.',
    top_threats: ['internet shutdowns', 'mass surveillance', 'content filtering'],
    population_m: 25.8, related_signals: 0
  },
  {
    code: 'SA', name: 'Saudi Arabia', region: 'Middle East & North Africa',
    rights_status: 'not_free',
    indicators: { internet_freedom_score: 27, surveillance_score: 85, censorship_level: 4, data_protection_score: 20, digital_access_index: 88 },
    trend: 'stable', trend_detail: 'CITC blocks political/religious content; Pegasus spyware deployed.',
    top_threats: ['content filtering', 'targeted surveillance', 'journalist targeting', 'social media blocks'],
    population_m: 35.8, related_signals: 0
  },
  {
    code: 'AE', name: 'United Arab Emirates', region: 'Middle East & North Africa',
    rights_status: 'not_free',
    indicators: { internet_freedom_score: 29, surveillance_score: 88, censorship_level: 4, data_protection_score: 30, digital_access_index: 97 },
    trend: 'stable', trend_detail: 'VoIP blocked; Karma/Pegasus used against dissidents.',
    top_threats: ['targeted surveillance', 'VPN bans', 'content filtering', 'journalist targeting'],
    population_m: 9.9, related_signals: 0
  },
  {
    code: 'EG', name: 'Egypt', region: 'Middle East & North Africa',
    rights_status: 'not_free',
    indicators: { internet_freedom_score: 25, surveillance_score: 82, censorship_level: 4, data_protection_score: 22, digital_access_index: 58 },
    trend: 'declining', trend_detail: 'Hundreds of websites blocked; social media monitoring for dissent.',
    top_threats: ['content filtering', 'journalist targeting', 'mass surveillance', 'social media blocks'],
    population_m: 104.3, related_signals: 0
  },
  {
    code: 'ET', name: 'Ethiopia', region: 'Sub-Saharan Africa',
    rights_status: 'not_free',
    indicators: { internet_freedom_score: 18, surveillance_score: 72, censorship_level: 4, data_protection_score: 15, digital_access_index: 22 },
    trend: 'declining', trend_detail: 'Internet shutdowns during Tigray conflict; social media blocks.',
    top_threats: ['internet shutdowns', 'social media blocks', 'journalist targeting'],
    population_m: 122.2, related_signals: 0
  },
  {
    code: 'KZ', name: 'Kazakhstan', region: 'Central Asia',
    rights_status: 'not_free',
    indicators: { internet_freedom_score: 30, surveillance_score: 78, censorship_level: 3, data_protection_score: 25, digital_access_index: 75 },
    trend: 'declining', trend_detail: 'MITM certificate imposed; internet disrupted during 2022 protests.',
    top_threats: ['mass surveillance', 'internet shutdowns', 'content filtering'],
    population_m: 19.4, related_signals: 0
  },
  {
    code: 'UZ', name: 'Uzbekistan', region: 'Central Asia',
    rights_status: 'not_free',
    indicators: { internet_freedom_score: 28, surveillance_score: 75, censorship_level: 3, data_protection_score: 20, digital_access_index: 60 },
    trend: 'stable', trend_detail: 'Slow liberalization; SORM-style surveillance inherited from Soviet era.',
    top_threats: ['mass surveillance', 'content filtering', 'journalist targeting'],
    population_m: 36.0, related_signals: 0
  },
  {
    code: 'AZ', name: 'Azerbaijan', region: 'Central Asia',
    rights_status: 'not_free',
    indicators: { internet_freedom_score: 32, surveillance_score: 70, censorship_level: 3, data_protection_score: 28, digital_access_index: 78 },
    trend: 'declining', trend_detail: 'Pegasus used against journalists; VPNs and critical sites blocked.',
    top_threats: ['targeted surveillance', 'content filtering', 'journalist targeting'],
    population_m: 10.1, related_signals: 0
  },
  {
    code: 'MM', name: 'Myanmar', region: 'Southeast Asia',
    rights_status: 'not_free',
    indicators: { internet_freedom_score: 18, surveillance_score: 80, censorship_level: 5, data_protection_score: 8, digital_access_index: 30 },
    trend: 'declining', trend_detail: 'Military junta shut internet; mobile data restricted in conflict zones.',
    top_threats: ['internet shutdowns', 'mass surveillance', 'social media blocks', 'journalist targeting'],
    population_m: 54.4, related_signals: 0
  },
  {
    code: 'VN', name: 'Vietnam', region: 'Southeast Asia',
    rights_status: 'not_free',
    indicators: { internet_freedom_score: 22, surveillance_score: 80, censorship_level: 4, data_protection_score: 30, digital_access_index: 70 },
    trend: 'declining', trend_detail: 'Cybersecurity law requires data localization; bloggers imprisoned.',
    top_threats: ['content filtering', 'data localization mandates', 'journalist targeting', 'social media blocks'],
    population_m: 97.3, related_signals: 0
  },
  {
    code: 'CU', name: 'Cuba', region: 'Americas',
    rights_status: 'not_free',
    indicators: { internet_freedom_score: 23, surveillance_score: 82, censorship_level: 4, data_protection_score: 10, digital_access_index: 35 },
    trend: 'stable', trend_detail: 'Internet controlled by state; shutdowns during protests.',
    top_threats: ['internet shutdowns', 'mass surveillance', 'content filtering'],
    population_m: 11.3, related_signals: 0
  },
  {
    code: 'BY', name: 'Belarus', region: 'Europe',
    rights_status: 'not_free',
    indicators: { internet_freedom_score: 26, surveillance_score: 84, censorship_level: 4, data_protection_score: 18, digital_access_index: 70 },
    trend: 'declining', trend_detail: 'Mass arrests of bloggers; Telegram used by opposition restricted.',
    top_threats: ['journalist targeting', 'content filtering', 'mass surveillance', 'social media blocks'],
    population_m: 9.4, related_signals: 0
  },

  // ─── Additional coverage ─────────────────────────────────────────────────
  {
    code: 'KR', name: 'South Korea', region: 'East Asia',
    rights_status: 'free',
    indicators: { internet_freedom_score: 67, surveillance_score: 35, censorship_level: 2, data_protection_score: 72, digital_access_index: 96 },
    trend: 'stable', trend_detail: 'High connectivity; National Security Law restricts some online speech.',
    top_threats: ['content filtering', 'national security surveillance'],
    population_m: 51.7, related_signals: 0
  },
  {
    code: 'TW', name: 'Taiwan', region: 'East Asia',
    rights_status: 'free',
    indicators: { internet_freedom_score: 78, surveillance_score: 22, censorship_level: 1, data_protection_score: 78, digital_access_index: 93 },
    trend: 'stable', trend_detail: 'Open internet with robust protections; counter-disinformation laws debated.',
    top_threats: ['foreign information operations'],
    population_m: 23.6, related_signals: 0
  },
  {
    code: 'AR', name: 'Argentina', region: 'Americas',
    rights_status: 'free',
    indicators: { internet_freedom_score: 74, surveillance_score: 32, censorship_level: 1, data_protection_score: 65, digital_access_index: 72 },
    trend: 'stable', trend_detail: 'Free expression tradition; some privacy concerns with SIDE intelligence.',
    top_threats: ['political surveillance'],
    population_m: 45.6, related_signals: 0
  },
  {
    code: 'CO', name: 'Colombia', region: 'Americas',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 63, surveillance_score: 52, censorship_level: 2, data_protection_score: 55, digital_access_index: 65 },
    trend: 'stable', trend_detail: 'Journalists targeted online; growing digital access.',
    top_threats: ['journalist targeting', 'targeted surveillance'],
    population_m: 51.5, related_signals: 0
  },
  {
    code: 'IL', name: 'Israel', region: 'Middle East & North Africa',
    rights_status: 'partly_free',
    indicators: { internet_freedom_score: 64, surveillance_score: 65, censorship_level: 2, data_protection_score: 60, digital_access_index: 88 },
    trend: 'declining', trend_detail: 'NSO Group Pegasus controversy; wartime internet restrictions in Gaza.',
    top_threats: ['targeted surveillance', 'content filtering'],
    population_m: 9.5, related_signals: 0
  },
  {
    code: 'ET2', name: 'Ethiopia', region: 'Sub-Saharan Africa',  // placeholder — removed below to keep unique codes
    rights_status: 'not_free',
    indicators: { internet_freedom_score: 18, surveillance_score: 72, censorship_level: 4, data_protection_score: 15, digital_access_index: 22 },
    trend: 'declining', trend_detail: 'Duplicate removed',
    top_threats: [],
    population_m: 0, related_signals: 0
  },
]
  // filter out any placeholder duplicates
  .filter(c => c.code !== 'ET2')

// ─── Helper Functions ─────────────────────────────────────────────────────────

export function filterCountries(
  countries: DigitalRightsCountry[],
  opts: {
    region?:               string
    rights_status?:        string
    min_internet_freedom?: number
    q?:                    string
    sortBy?:               'internet_freedom_score' | 'surveillance_score' | 'censorship_level' | 'data_protection_score' | 'name'
    order?:                'asc' | 'desc'
    limit?:                number
    offset?:               number
  }
): DigitalRightsCountry[] {
  let filtered = [...countries]

  if (opts.region) {
    const regionLower = opts.region.toLowerCase()
    filtered = filtered.filter(c => c.region.toLowerCase() === regionLower)
  }

  if (opts.rights_status) {
    filtered = filtered.filter(c => c.rights_status === opts.rights_status)
  }

  if (opts.min_internet_freedom !== undefined) {
    filtered = filtered.filter(c => c.indicators.internet_freedom_score >= opts.min_internet_freedom!)
  }

  if (opts.q) {
    const qLower = opts.q.toLowerCase()
    filtered = filtered.filter(c =>
      c.name.toLowerCase().includes(qLower) ||
      c.code.toLowerCase().includes(qLower) ||
      c.top_threats.some(t => t.toLowerCase().includes(qLower))
    )
  }

  // Sort
  const sortKey = opts.sortBy ?? 'internet_freedom_score'
  const order = opts.order ?? 'desc'

  if (sortKey === 'name') {
    filtered.sort((a, b) => order === 'asc'
      ? a.name.localeCompare(b.name)
      : b.name.localeCompare(a.name)
    )
  } else if (sortKey === 'internet_freedom_score') {
    filtered.sort((a, b) => order === 'asc'
      ? a.indicators.internet_freedom_score - b.indicators.internet_freedom_score
      : b.indicators.internet_freedom_score - a.indicators.internet_freedom_score
    )
  } else if (sortKey === 'surveillance_score') {
    filtered.sort((a, b) => order === 'asc'
      ? a.indicators.surveillance_score - b.indicators.surveillance_score
      : b.indicators.surveillance_score - a.indicators.surveillance_score
    )
  } else if (sortKey === 'censorship_level') {
    filtered.sort((a, b) => order === 'asc'
      ? a.indicators.censorship_level - b.indicators.censorship_level
      : b.indicators.censorship_level - a.indicators.censorship_level
    )
  } else if (sortKey === 'data_protection_score') {
    filtered.sort((a, b) => order === 'asc'
      ? a.indicators.data_protection_score - b.indicators.data_protection_score
      : b.indicators.data_protection_score - a.indicators.data_protection_score
    )
  }

  const offset = opts.offset ?? 0
  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  return filtered.slice(offset, offset + limit)
}

export function sortCountries(
  countries: DigitalRightsCountry[],
  sortBy: 'internet_freedom_score' | 'surveillance_score' | 'censorship_level' | 'data_protection_score' | 'name',
  order: 'asc' | 'desc' = 'desc'
): DigitalRightsCountry[] {
  return filterCountries(countries, { sortBy, order, limit: MAX_LIMIT })
}

export function computeSummary(countries: DigitalRightsCountry[]): DigitalRightsSummary {
  const free        = countries.filter(c => c.rights_status === 'free').length
  const partly_free = countries.filter(c => c.rights_status === 'partly_free').length
  const not_free    = countries.filter(c => c.rights_status === 'not_free').length

  const avg_internet_freedom = countries.reduce((sum, c) => sum + c.indicators.internet_freedom_score, 0) / countries.length
  const avg_surveillance     = countries.reduce((sum, c) => sum + c.indicators.surveillance_score, 0) / countries.length

  // Population under significant surveillance (surveillance_score >= 60)
  const total_population_surveilled_m = countries
    .filter(c => c.indicators.surveillance_score >= 60)
    .reduce((sum, c) => sum + c.population_m, 0)

  // Internet shutdowns: countries with shutdown threat
  const internet_shutdowns_this_year = countries.filter(c =>
    c.top_threats.includes('internet shutdowns')
  ).length

  // Most restricted (lowest internet freedom scores)
  const most_restricted = [...countries]
    .sort((a, b) => a.indicators.internet_freedom_score - b.indicators.internet_freedom_score)
    .slice(0, 5)
    .map(c => ({ name: c.name, code: c.code, score: c.indicators.internet_freedom_score }))

  // Most improved
  const most_improved = countries
    .filter(c => c.trend === 'improving')
    .slice(0, 5)
    .map(c => ({ name: c.name, code: c.code, trend_detail: c.trend_detail }))

  // Regional breakdown
  const regionMap = new Map<string, { region: string; count: number; sum_freedom: number; pop_surveilled: number }>()
  for (const country of countries) {
    if (!regionMap.has(country.region)) {
      regionMap.set(country.region, { region: country.region, count: 0, sum_freedom: 0, pop_surveilled: 0 })
    }
    const entry = regionMap.get(country.region)!
    entry.count++
    entry.sum_freedom += country.indicators.internet_freedom_score
    if (country.indicators.surveillance_score >= 60) {
      entry.pop_surveilled += country.population_m
    }
  }

  const regional_breakdown = [...regionMap.values()]
    .map(r => ({
      region: r.region,
      count: r.count,
      avg_internet_freedom: r.sum_freedom / r.count,
      population_under_surveillance_m: r.pop_surveilled,
    }))
    .sort((a, b) => b.avg_internet_freedom - a.avg_internet_freedom)

  return {
    total_countries: countries.length,
    free,
    partly_free,
    not_free,
    avg_internet_freedom,
    avg_surveillance_score: avg_surveillance,
    total_population_surveilled_m,
    internet_shutdowns_this_year,
    most_restricted,
    most_improved,
    regional_breakdown,
    recent_signals: 0,
  }
}

export function toGeoJSON(countries: DigitalRightsCountry[]): {
  type: 'FeatureCollection'
  features: {
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: Record<string, unknown>
  }[]
} {
  const countryCoords: Record<string, [number, number]> = {
    'EE': [25.01, 58.60], 'IS': [-18.96, 64.96], 'DE': [10.45, 51.17], 'FR': [2.21, 46.23],
    'GB': [-2.24, 55.38], 'NL': [5.29, 52.13], 'SE': [18.64, 60.13], 'CA': [-106.35, 56.13],
    'US': [-95.71, 37.09], 'JP': [138.25, 36.20], 'AU': [133.78, -25.29], 'NZ': [174.89, -40.90],
    'BR': [-51.93, -14.24], 'IN': [78.96, 20.59], 'ID': [113.92, -2.17], 'PH': [121.77, 12.88],
    'MY': [102.69, 4.21], 'MX': [-102.55, 23.63], 'KE': [37.91, -0.02], 'ZA': [24.00, -29.61],
    'NG': [8.68, 9.08], 'GH': [-2.00, 7.37], 'UA': [31.29, 48.38], 'TR': [35.24, 38.96],
    'PK': [69.35, 30.19], 'BD': [90.36, 23.68], 'TH': [100.99, 15.87], 'SG': [103.85, 1.35],
    'TN': [9.00, 33.89], 'AM': [45.04, 40.07], 'CN': [104.07, 35.86], 'RU': [105.32, 61.52],
    'IR': [53.69, 32.43], 'KP': [127.11, 40.34], 'SA': [45.08, 23.89], 'AE': [53.85, 23.42],
    'EG': [30.80, 26.82], 'ET': [38.75, 9.15], 'KZ': [66.92, 48.02], 'UZ': [64.59, 41.30],
    'AZ': [47.58, 40.14], 'MM': [96.66, 19.74], 'VN': [108.28, 14.06], 'CU': [-77.78, 21.52],
    'BY': [28.04, 53.71], 'KR': [127.01, 37.27], 'TW': [120.96, 23.70], 'AR': [-63.62, -38.42],
    'CO': [-74.30, 4.57], 'IL': [35.23, 31.95],
  }

  const features = countries
    .map(country => {
      const coords = countryCoords[country.code]
      if (!coords) return null
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: coords,
        },
        properties: {
          code: country.code,
          name: country.name,
          region: country.region,
          rights_status: country.rights_status,
          internet_freedom_score: country.indicators.internet_freedom_score,
          surveillance_score: country.indicators.surveillance_score,
          censorship_level: country.indicators.censorship_level,
          data_protection_score: country.indicators.data_protection_score,
          digital_access_index: country.indicators.digital_access_index,
          trend: country.trend,
          top_threats: country.top_threats,
        },
      }
    })
    .filter((f): f is NonNullable<typeof f> => f !== null)

  return { type: 'FeatureCollection', features }
}

// ─── Route Plugin ─────────────────────────────────────────────────────────────

const digitalRightsPlugin: FastifyPluginAsync = async (app) => {

  // GET /countries — list all countries with digital rights indicators
  app.get('/countries', async (req, reply) => {
    try {
      const query = req.query as Record<string, string | undefined>
      const cacheKey = `${CACHE_KEY_LIST}:${JSON.stringify(query)}`

      try {
        const cached = await redis.get(cacheKey)
        if (cached) {
          reply.header('X-Cache-Hit', 'true')
          return reply.send(JSON.parse(cached))
        }
      } catch { /* Redis error — non-fatal */ }

      // Enrich with signal counts
      const enriched = COUNTRY_REGISTRY.map(c => ({ ...c }))
      try {
        for (const country of enriched) {
          const countRows = await db('signals')
            .where('category', 'technology')
            .where(function () {
              this.where('title', 'ilike', `%${country.name}%`)
                .orWhere('title', 'ilike', `%${country.code}%`)
            })
            .where('published_at', '>', db.raw("NOW() - INTERVAL '30 days'"))
            .count('id as count')
          country.related_signals = Number((countRows[0] as { count: string | number } | undefined)?.count ?? 0)
        }
      } catch { /* DB error — use defaults */ }

      const filtered = filterCountries(enriched, {
        region: query.region,
        rights_status: query.rights_status,
        min_internet_freedom: query.min_internet_freedom ? parseFloat(query.min_internet_freedom) : undefined,
        q: query.q,
        sortBy: (query.sortBy as 'internet_freedom_score' | 'surveillance_score' | 'censorship_level' | 'data_protection_score' | 'name') ?? 'internet_freedom_score',
        order: (query.order as 'asc' | 'desc') ?? 'desc',
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
        offset: query.offset ? parseInt(query.offset, 10) : undefined,
      })

      const response = {
        success: true,
        data: filtered,
        total: filtered.length,
        registry_total: COUNTRY_REGISTRY.length,
      }

      try {
        await redis.setex(cacheKey, LIST_CACHE_TTL, JSON.stringify(response))
      } catch { /* Redis error — non-fatal */ }

      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch digital rights data')
    }
  })

  // GET /countries/:code — single country detail
  app.get('/countries/:code', async (req, reply) => {
    try {
      const { code } = req.params as { code: string }
      const cacheKey = `${CACHE_KEY_DETAIL}:${code}`

      try {
        const cached = await redis.get(cacheKey)
        if (cached) {
          reply.header('X-Cache-Hit', 'true')
          return reply.send(JSON.parse(cached))
        }
      } catch { /* Redis error — non-fatal */ }

      const country = COUNTRY_REGISTRY.find(c => c.code === code.toUpperCase())
      if (!country) {
        return sendError(reply, 404, 'NOT_FOUND', `Country "${code}" not found`)
      }

      let recentSignals: unknown[] = []
      try {
        recentSignals = await db('signals')
          .select('id', 'title', 'severity', 'published_at', 'category')
          .where('category', 'technology')
          .where(function () {
            this.where('title', 'ilike', `%${country.name}%`)
              .orWhere('title', 'ilike', `%${country.code}%`)
          })
          .where('published_at', '>', db.raw("NOW() - INTERVAL '7 days'"))
          .orderBy('published_at', 'desc')
          .limit(10)
      } catch { /* DB error — non-fatal */ }

      const response = {
        success: true,
        data: { ...country, recent_signals: recentSignals },
      }

      try {
        await redis.setex(cacheKey, LIST_CACHE_TTL, JSON.stringify(response))
      } catch { /* Redis error — non-fatal */ }

      return reply.send(response)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch country detail')
    }
  })

  // GET /summary — aggregate stats & rights breakdown
  app.get('/summary', async (req, reply) => {
    try {
      try {
        const cached = await redis.get(CACHE_KEY_SUMMARY)
        if (cached) {
          reply.header('X-Cache-Hit', 'true')
          return reply.send(JSON.parse(cached))
        }
      } catch { /* Redis error — non-fatal */ }

      const summary = computeSummary(COUNTRY_REGISTRY)

      try {
        const countRows = await db('signals')
          .where('category', 'technology')
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
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to build digital rights summary')
    }
  })

  // GET /map/points — GeoJSON FeatureCollection for map layer
  app.get('/map/points', async (req, reply) => {
    try {
      try {
        const cached = await redis.get(CACHE_KEY_MAP)
        if (cached) {
          reply.header('X-Cache-Hit', 'true')
          return reply.send(JSON.parse(cached))
        }
      } catch { /* Redis error — non-fatal */ }

      const geojson = toGeoJSON(COUNTRY_REGISTRY)

      try {
        await redis.setex(CACHE_KEY_MAP, MAP_CACHE_TTL, JSON.stringify(geojson))
      } catch { /* Redis error — non-fatal */ }

      return reply.send(geojson)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to build digital rights map data')
    }
  })
}

export default digitalRightsPlugin
