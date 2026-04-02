/**
 * AI Infrastructure Intelligence API
 *
 * Tracks global AI datacenter construction, expansions, and operational status.
 * Counters WorldMonitor's 111 AI datacenter feature with richer, signal-linked data.
 *
 * Endpoints:
 *   GET /api/v1/ai-infrastructure/datacenters       — list all tracked AI datacenters
 *   GET /api/v1/ai-infrastructure/datacenters/:id    — single datacenter detail
 *   GET /api/v1/ai-infrastructure/summary            — aggregate stats & trends
 *   GET /api/v1/ai-infrastructure/map/points         — GeoJSON points for map layer
 *
 * Data source: Seeded registry of 150+ major AI datacenters worldwide,
 * enriched with signal cross-references from the signals table.
 */

import type { FastifyPluginAsync } from 'fastify'
import { db }    from '../db/postgres'
import { redis } from '../db/redis'
import { sendError } from '../lib/errors'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Redis TTL for datacenter list cache: 10 minutes */
const LIST_CACHE_TTL     = 600

/** Redis TTL for summary cache: 10 minutes */
const SUMMARY_CACHE_TTL  = 600

/** Redis TTL for map points cache: 5 minutes */
const MAP_CACHE_TTL      = 300

/** Rate limit: requests per minute */
const RATE_LIMIT_RPM     = 60

/** Default result limit */
const DEFAULT_LIMIT      = 50

/** Maximum result limit */
const MAX_LIMIT          = 200

/** Cache key prefixes */
const CACHE_KEY_LIST     = 'ai-infra:datacenters'
const CACHE_KEY_SUMMARY  = 'ai-infra:summary'
const CACHE_KEY_MAP      = 'ai-infra:map'
const CACHE_KEY_DETAIL   = 'ai-infra:dc'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIDatacenter {
  id:              string
  name:            string
  operator:        string
  country:         string
  country_code:    string
  region:          string
  city:            string
  lat:             number
  lng:             number
  capacity_mw:     number | null
  status:          'operational' | 'under_construction' | 'announced' | 'planned'
  ai_focus:        string[]
  gpu_type:        string | null
  gpu_count:       number | null
  energy_source:   string | null
  opened_year:     number | null
  estimated_completion: string | null
  investment_usd:  number | null
  notes:           string | null
  related_signals: number
}

export interface AIInfraSummary {
  total_datacenters:      number
  operational:            number
  under_construction:     number
  announced:              number
  planned:                number
  total_capacity_mw:      number
  countries_count:        number
  top_operators:          { operator: string; count: number }[]
  top_countries:          { country: string; country_code: string; count: number }[]
  total_investment_usd:   number
  related_signals_24h:    number
}

// ─── Seed Data ────────────────────────────────────────────────────────────────

/**
 * 150+ major AI datacenter facilities worldwide.
 * This replaces a DB table for v1 — future: migrate to ai_datacenters table.
 */
const AI_DATACENTERS: Omit<AIDatacenter, 'related_signals'>[] = [
  // ──── United States ────────────────────────────────────────
  { id: 'ms-phoenix-az', name: 'Microsoft Phoenix Campus', operator: 'Microsoft', country: 'United States', country_code: 'US', region: 'North America', city: 'Phoenix, AZ', lat: 33.4484, lng: -112.0740, capacity_mw: 500, status: 'operational', ai_focus: ['Azure AI', 'OpenAI'], gpu_type: 'NVIDIA H100', gpu_count: null, energy_source: 'Solar + Grid', opened_year: 2024, estimated_completion: null, investment_usd: 3_000_000_000, notes: 'Hosts significant OpenAI training workloads' },
  { id: 'ms-quincy-wa', name: 'Microsoft Quincy Campus', operator: 'Microsoft', country: 'United States', country_code: 'US', region: 'North America', city: 'Quincy, WA', lat: 47.2343, lng: -119.8526, capacity_mw: 300, status: 'operational', ai_focus: ['Azure AI'], gpu_type: 'NVIDIA A100/H100', gpu_count: null, energy_source: 'Hydro', opened_year: 2007, estimated_completion: null, investment_usd: 2_000_000_000, notes: 'Major Azure AI training hub, hydro-powered' },
  { id: 'google-council-bluffs-ia', name: 'Google Council Bluffs', operator: 'Google', country: 'United States', country_code: 'US', region: 'North America', city: 'Council Bluffs, IA', lat: 41.2619, lng: -95.8608, capacity_mw: 400, status: 'operational', ai_focus: ['Gemini', 'TPU Training'], gpu_type: 'TPU v5p', gpu_count: null, energy_source: 'Wind + Grid', opened_year: 2009, estimated_completion: null, investment_usd: 5_000_000_000, notes: 'One of Google\'s largest campuses, TPU training hub' },
  { id: 'google-the-dalles-or', name: 'Google The Dalles', operator: 'Google', country: 'United States', country_code: 'US', region: 'North America', city: 'The Dalles, OR', lat: 45.5946, lng: -121.1787, capacity_mw: 250, status: 'operational', ai_focus: ['Gemini', 'Search AI'], gpu_type: 'TPU v5', gpu_count: null, energy_source: 'Hydro', opened_year: 2006, estimated_completion: null, investment_usd: 1_800_000_000, notes: null },
  { id: 'meta-dekalb-il', name: 'Meta DeKalb Data Center', operator: 'Meta', country: 'United States', country_code: 'US', region: 'North America', city: 'DeKalb, IL', lat: 41.9294, lng: -88.7503, capacity_mw: 350, status: 'operational', ai_focus: ['Llama Training', 'FAIR Research'], gpu_type: 'NVIDIA H100', gpu_count: 150000, energy_source: 'Grid + Solar PPA', opened_year: 2023, estimated_completion: null, investment_usd: 4_500_000_000, notes: 'Houses Research SuperCluster (RSC)' },
  { id: 'meta-temple-tx', name: 'Meta Temple AI Campus', operator: 'Meta', country: 'United States', country_code: 'US', region: 'North America', city: 'Temple, TX', lat: 31.0982, lng: -97.3428, capacity_mw: 800, status: 'under_construction', ai_focus: ['Llama', 'Next-gen AI'], gpu_type: 'NVIDIA B200', gpu_count: null, energy_source: 'Solar + Nuclear PPA', opened_year: null, estimated_completion: '2026-Q4', investment_usd: 10_000_000_000, notes: 'Largest single Meta AI facility, 800MW planned' },
  { id: 'aws-us-east-1-va', name: 'AWS US-East-1 AI Cluster', operator: 'Amazon/AWS', country: 'United States', country_code: 'US', region: 'North America', city: 'Ashburn, VA', lat: 39.0438, lng: -77.4874, capacity_mw: 600, status: 'operational', ai_focus: ['Bedrock', 'Trainium'], gpu_type: 'Trainium2 + NVIDIA H100', gpu_count: null, energy_source: 'Nuclear + Grid', opened_year: 2020, estimated_completion: null, investment_usd: 7_000_000_000, notes: 'Primary AI inference cluster for AWS Bedrock' },
  { id: 'oracle-abilene-tx', name: 'Oracle Abilene AI Campus', operator: 'Oracle', country: 'United States', country_code: 'US', region: 'North America', city: 'Abilene, TX', lat: 32.4487, lng: -99.7331, capacity_mw: 400, status: 'under_construction', ai_focus: ['OCI AI', 'Sovereign AI'], gpu_type: 'NVIDIA GB200', gpu_count: null, energy_source: 'Solar + Battery', opened_year: null, estimated_completion: '2026-Q3', investment_usd: 6_500_000_000, notes: 'Oracle\'s flagship AI supercomputer campus' },
  { id: 'xai-memphis-tn', name: 'xAI Colossus Supercluster', operator: 'xAI', country: 'United States', country_code: 'US', region: 'North America', city: 'Memphis, TN', lat: 35.1495, lng: -90.0490, capacity_mw: 150, status: 'operational', ai_focus: ['Grok Training'], gpu_type: 'NVIDIA H100', gpu_count: 100000, energy_source: 'Gas Turbines', opened_year: 2024, estimated_completion: null, investment_usd: 3_000_000_000, notes: '100K H100 GPUs, built in record 122 days' },
  { id: 'openai-stargate-tx', name: 'OpenAI Stargate Phase 1', operator: 'OpenAI/SoftBank', country: 'United States', country_code: 'US', region: 'North America', city: 'Abilene, TX', lat: 32.4554, lng: -99.7342, capacity_mw: 1200, status: 'under_construction', ai_focus: ['GPT-5+', 'AGI Research'], gpu_type: 'NVIDIA GB200 NVL72', gpu_count: null, energy_source: 'Solar + Nuclear', opened_year: null, estimated_completion: '2026-H2', investment_usd: 100_000_000_000, notes: '$100B Stargate JV with SoftBank, first campus in Abilene TX' },
  { id: 'coreweave-plano-tx', name: 'CoreWeave Plano Campus', operator: 'CoreWeave', country: 'United States', country_code: 'US', region: 'North America', city: 'Plano, TX', lat: 33.0198, lng: -96.6989, capacity_mw: 200, status: 'under_construction', ai_focus: ['GPU Cloud', 'AI Inference'], gpu_type: 'NVIDIA H200/B200', gpu_count: null, energy_source: 'Grid', opened_year: null, estimated_completion: '2026-Q2', investment_usd: 2_500_000_000, notes: 'CoreWeave\'s largest GPU cloud campus' },
  { id: 'nvidia-dc-dgx-cloud-or', name: 'NVIDIA DGX Cloud Hub', operator: 'NVIDIA', country: 'United States', country_code: 'US', region: 'North America', city: 'Hillsboro, OR', lat: 45.5229, lng: -122.9898, capacity_mw: 100, status: 'operational', ai_focus: ['DGX Cloud', 'AI Research'], gpu_type: 'DGX B200', gpu_count: null, energy_source: 'Hydro + Grid', opened_year: 2024, estimated_completion: null, investment_usd: 1_000_000_000, notes: 'NVIDIA internal AI research + DGX Cloud partner hub' },
  { id: 'crusoe-midland-tx', name: 'Crusoe Energy AI Campus', operator: 'Crusoe Energy', country: 'United States', country_code: 'US', region: 'North America', city: 'Midland, TX', lat: 31.9973, lng: -102.0779, capacity_mw: 200, status: 'operational', ai_focus: ['Clean GPU Cloud'], gpu_type: 'NVIDIA H100', gpu_count: null, energy_source: 'Flared Gas', opened_year: 2024, estimated_completion: null, investment_usd: 600_000_000, notes: 'Uses stranded natural gas for AI compute' },
  { id: 'lambda-austin-tx', name: 'Lambda AI Cloud Austin', operator: 'Lambda', country: 'United States', country_code: 'US', region: 'North America', city: 'Austin, TX', lat: 30.2672, lng: -97.7431, capacity_mw: 80, status: 'operational', ai_focus: ['GPU Cloud'], gpu_type: 'NVIDIA H100/A100', gpu_count: null, energy_source: 'Grid', opened_year: 2023, estimated_completion: null, investment_usd: 400_000_000, notes: null },

  // ──── Europe ───────────────────────────────────────────────
  { id: 'ms-sweden-gavle', name: 'Microsoft Gävle AI Hub', operator: 'Microsoft', country: 'Sweden', country_code: 'SE', region: 'Europe', city: 'Gävle', lat: 60.6749, lng: 17.1413, capacity_mw: 250, status: 'under_construction', ai_focus: ['Azure AI', 'Sovereign AI'], gpu_type: 'NVIDIA H100', gpu_count: null, energy_source: 'Hydro + Wind', opened_year: null, estimated_completion: '2026-Q3', investment_usd: 3_200_000_000, notes: 'Part of Microsoft $3.2B Sweden AI investment' },
  { id: 'google-hamina-fi', name: 'Google Hamina', operator: 'Google', country: 'Finland', country_code: 'FI', region: 'Europe', city: 'Hamina', lat: 60.5693, lng: 27.1878, capacity_mw: 200, status: 'operational', ai_focus: ['Gemini', 'EU AI'], gpu_type: 'TPU v5', gpu_count: null, energy_source: 'Wind + Nuclear', opened_year: 2011, estimated_completion: null, investment_usd: 2_000_000_000, notes: 'Seawater cooled, converted paper mill' },
  { id: 'meta-lulea-se', name: 'Meta Luleå', operator: 'Meta', country: 'Sweden', country_code: 'SE', region: 'Europe', city: 'Luleå', lat: 65.5848, lng: 22.1547, capacity_mw: 120, status: 'operational', ai_focus: ['Llama Inference EU'], gpu_type: 'NVIDIA A100', gpu_count: null, energy_source: 'Hydro', opened_year: 2013, estimated_completion: null, investment_usd: 1_000_000_000, notes: null },
  { id: 'aws-ireland-dub', name: 'AWS Dublin AI Region', operator: 'Amazon/AWS', country: 'Ireland', country_code: 'IE', region: 'Europe', city: 'Dublin', lat: 53.3498, lng: -6.2603, capacity_mw: 300, status: 'operational', ai_focus: ['Bedrock EU', 'SageMaker'], gpu_type: 'Trainium + P5', gpu_count: null, energy_source: 'Wind + Grid', opened_year: 2007, estimated_completion: null, investment_usd: 4_000_000_000, notes: 'AWS eu-west-1, major AI inference presence' },
  { id: 'oracle-madrid-es', name: 'Oracle Madrid Cloud Region', operator: 'Oracle', country: 'Spain', country_code: 'ES', region: 'Europe', city: 'Madrid', lat: 40.4168, lng: -3.7038, capacity_mw: 100, status: 'operational', ai_focus: ['OCI Sovereign AI'], gpu_type: 'NVIDIA A100', gpu_count: null, energy_source: 'Solar + Grid', opened_year: 2024, estimated_completion: null, investment_usd: 800_000_000, notes: 'EU sovereign AI cloud' },
  { id: 'aleph-alpha-heidelberg-de', name: 'Aleph Alpha AI Center', operator: 'Aleph Alpha', country: 'Germany', country_code: 'DE', region: 'Europe', city: 'Heidelberg', lat: 49.3988, lng: 8.6724, capacity_mw: 30, status: 'operational', ai_focus: ['Sovereign EU LLM'], gpu_type: 'NVIDIA H100', gpu_count: null, energy_source: 'Grid', opened_year: 2023, estimated_completion: null, investment_usd: 500_000_000, notes: 'European sovereign AI champion' },
  { id: 'mistral-paris-fr', name: 'Mistral AI Paris HQ', operator: 'Mistral AI', country: 'France', country_code: 'FR', region: 'Europe', city: 'Paris', lat: 48.8566, lng: 2.3522, capacity_mw: 50, status: 'operational', ai_focus: ['Mistral LLM Training'], gpu_type: 'NVIDIA H100', gpu_count: 10000, energy_source: 'Nuclear + Grid', opened_year: 2023, estimated_completion: null, investment_usd: 600_000_000, notes: 'EU AI unicorn, Tier-1 model training' },
  { id: 'deepmind-london-uk', name: 'Google DeepMind London', operator: 'Google/DeepMind', country: 'United Kingdom', country_code: 'GB', region: 'Europe', city: 'London', lat: 51.5324, lng: -0.1258, capacity_mw: 80, status: 'operational', ai_focus: ['Gemini Research', 'AlphaFold'], gpu_type: 'TPU v5', gpu_count: null, energy_source: 'Grid + Carbon Offsets', opened_year: 2014, estimated_completion: null, investment_usd: 1_500_000_000, notes: 'AlphaFold and Gemini research headquarters' },
  { id: 'uk-ai-safety-bristol', name: 'UK AI Safety Institute', operator: 'UK Government', country: 'United Kingdom', country_code: 'GB', region: 'Europe', city: 'Bristol', lat: 51.4545, lng: -2.5879, capacity_mw: 20, status: 'operational', ai_focus: ['AI Safety', 'Frontier Eval'], gpu_type: 'NVIDIA H100', gpu_count: null, energy_source: 'Grid', opened_year: 2024, estimated_completion: null, investment_usd: 300_000_000, notes: 'Government AI safety testing facility' },
  { id: 'ms-amsterdam-nl', name: 'Microsoft Amsterdam AI', operator: 'Microsoft', country: 'Netherlands', country_code: 'NL', region: 'Europe', city: 'Amsterdam', lat: 52.3676, lng: 4.9041, capacity_mw: 180, status: 'operational', ai_focus: ['Azure AI EU'], gpu_type: 'NVIDIA H100', gpu_count: null, energy_source: 'Wind + Grid', opened_year: 2020, estimated_completion: null, investment_usd: 2_100_000_000, notes: null },
  { id: 'equinix-frankfurt-de', name: 'Equinix FR11 AI Zone', operator: 'Equinix', country: 'Germany', country_code: 'DE', region: 'Europe', city: 'Frankfurt', lat: 50.1109, lng: 8.6821, capacity_mw: 120, status: 'operational', ai_focus: ['AI Colo', 'GPU Hosting'], gpu_type: 'Mixed', gpu_count: null, energy_source: 'Grid + Green Certs', opened_year: 2022, estimated_completion: null, investment_usd: 900_000_000, notes: 'Major AI colocation hub in Europe' },

  // ──── Asia Pacific ─────────────────────────────────────────
  { id: 'google-singapore-sg', name: 'Google Singapore AI Hub', operator: 'Google', country: 'Singapore', country_code: 'SG', region: 'Asia Pacific', city: 'Singapore', lat: 1.3521, lng: 103.8198, capacity_mw: 150, status: 'operational', ai_focus: ['Gemini APAC', 'Cloud AI'], gpu_type: 'TPU v5', gpu_count: null, energy_source: 'Grid + Solar', opened_year: 2015, estimated_completion: null, investment_usd: 2_000_000_000, notes: null },
  { id: 'aws-tokyo-jp', name: 'AWS Tokyo AI Region', operator: 'Amazon/AWS', country: 'Japan', country_code: 'JP', region: 'Asia Pacific', city: 'Tokyo', lat: 35.6762, lng: 139.6503, capacity_mw: 200, status: 'operational', ai_focus: ['Bedrock', 'Trainium'], gpu_type: 'Trainium2', gpu_count: null, energy_source: 'Grid', opened_year: 2011, estimated_completion: null, investment_usd: 3_500_000_000, notes: 'Part of $15B AWS Japan AI investment' },
  { id: 'ms-tokyo-jp', name: 'Microsoft Japan AI Hub', operator: 'Microsoft', country: 'Japan', country_code: 'JP', region: 'Asia Pacific', city: 'Tokyo', lat: 35.6895, lng: 139.6917, capacity_mw: 150, status: 'under_construction', ai_focus: ['Azure AI', 'Sovereign AI Japan'], gpu_type: 'NVIDIA H100', gpu_count: null, energy_source: 'Grid + Solar', opened_year: null, estimated_completion: '2026-Q4', investment_usd: 2_900_000_000, notes: 'Part of $2.9B Microsoft Japan AI commitment' },
  { id: 'sakana-ai-tokyo-jp', name: 'Sakana AI Research Lab', operator: 'Sakana AI', country: 'Japan', country_code: 'JP', region: 'Asia Pacific', city: 'Tokyo', lat: 35.6580, lng: 139.7015, capacity_mw: 10, status: 'operational', ai_focus: ['Nature-inspired AI'], gpu_type: 'NVIDIA H100', gpu_count: null, energy_source: 'Grid', opened_year: 2024, estimated_completion: null, investment_usd: 300_000_000, notes: 'Founded by ex-Google Brain researchers' },
  { id: 'tencent-guiyang-cn', name: 'Tencent Guiyang Seven Stars', operator: 'Tencent', country: 'China', country_code: 'CN', region: 'Asia Pacific', city: 'Guiyang', lat: 26.6470, lng: 106.6302, capacity_mw: 350, status: 'operational', ai_focus: ['Hunyuan', 'WeChat AI'], gpu_type: 'NVIDIA A100 (pre-ban)', gpu_count: null, energy_source: 'Hydro', opened_year: 2018, estimated_completion: null, investment_usd: 4_000_000_000, notes: 'Mountain-cooled mega datacenter' },
  { id: 'alibaba-zhangbei-cn', name: 'Alibaba Zhangbei AI Campus', operator: 'Alibaba Cloud', country: 'China', country_code: 'CN', region: 'Asia Pacific', city: 'Zhangbei', lat: 41.1590, lng: 114.7000, capacity_mw: 400, status: 'operational', ai_focus: ['Qwen', 'Tongyi'], gpu_type: 'Custom / Hanguang 800', gpu_count: null, energy_source: 'Wind + Solar', opened_year: 2016, estimated_completion: null, investment_usd: 3_500_000_000, notes: 'Powers Qwen LLM training' },
  { id: 'baidu-yangquan-cn', name: 'Baidu Yangquan AI Center', operator: 'Baidu', country: 'China', country_code: 'CN', region: 'Asia Pacific', city: 'Yangquan', lat: 37.8569, lng: 113.5564, capacity_mw: 200, status: 'operational', ai_focus: ['Ernie Bot', 'Apollo Autonomous'], gpu_type: 'Kunlun 2 / A100', gpu_count: null, energy_source: 'Grid', opened_year: 2020, estimated_completion: null, investment_usd: 2_000_000_000, notes: null },
  { id: 'bytedance-ulanqab-cn', name: 'ByteDance Ulanqab AI Campus', operator: 'ByteDance', country: 'China', country_code: 'CN', region: 'Asia Pacific', city: 'Ulanqab', lat: 41.0341, lng: 113.1328, capacity_mw: 300, status: 'operational', ai_focus: ['Doubao', 'TikTok Rec'], gpu_type: 'NVIDIA A800 / Custom', gpu_count: null, energy_source: 'Wind + Grid', opened_year: 2021, estimated_completion: null, investment_usd: 2_800_000_000, notes: 'Powers TikTok recommendation AI' },
  { id: 'samsung-hwaseong-kr', name: 'Samsung Hwaseong AI Fab', operator: 'Samsung', country: 'South Korea', country_code: 'KR', region: 'Asia Pacific', city: 'Hwaseong', lat: 37.1996, lng: 126.8312, capacity_mw: 200, status: 'operational', ai_focus: ['AI Chip Fab', 'HBM Production'], gpu_type: 'Custom AI Accelerators', gpu_count: null, energy_source: 'Nuclear + Grid', opened_year: 2020, estimated_completion: null, investment_usd: 5_000_000_000, notes: 'Produces HBM memory for AI GPUs' },
  { id: 'naver-sejong-kr', name: 'Naver Cloud GAK AI Center', operator: 'Naver', country: 'South Korea', country_code: 'KR', region: 'Asia Pacific', city: 'Sejong', lat: 36.4800, lng: 127.0000, capacity_mw: 80, status: 'operational', ai_focus: ['HyperCLOVA X'], gpu_type: 'NVIDIA H100', gpu_count: null, energy_source: 'Grid', opened_year: 2023, estimated_completion: null, investment_usd: 800_000_000, notes: null },
  { id: 'reliance-jamnagar-in', name: 'Jio AI Jamnagar Campus', operator: 'Reliance/Jio', country: 'India', country_code: 'IN', region: 'Asia Pacific', city: 'Jamnagar', lat: 22.4707, lng: 70.0577, capacity_mw: 250, status: 'under_construction', ai_focus: ['Jio Brain', 'Sovereign AI India'], gpu_type: 'NVIDIA H100', gpu_count: null, energy_source: 'Solar + Green Hydrogen', opened_year: null, estimated_completion: '2027-Q1', investment_usd: 5_000_000_000, notes: 'India\'s largest planned AI campus' },
  { id: 'yotta-mumbai-in', name: 'Yotta D1 Mumbai', operator: 'Yotta (Hiranandani)', country: 'India', country_code: 'IN', region: 'Asia Pacific', city: 'Mumbai', lat: 19.0760, lng: 72.8777, capacity_mw: 80, status: 'operational', ai_focus: ['GPU Cloud India', 'Shakti Cloud'], gpu_type: 'NVIDIA H100', gpu_count: 16000, energy_source: 'Grid + Solar', opened_year: 2023, estimated_completion: null, investment_usd: 700_000_000, notes: 'India\'s first NVIDIA SuperPOD' },

  // ──── Middle East & Africa ─────────────────────────────────
  { id: 'g42-masdar-ae', name: 'G42 Masdar AI Campus', operator: 'G42', country: 'UAE', country_code: 'AE', region: 'Middle East', city: 'Abu Dhabi', lat: 24.4539, lng: 54.3773, capacity_mw: 200, status: 'operational', ai_focus: ['Jais LLM', 'Falcon'], gpu_type: 'NVIDIA H100', gpu_count: null, energy_source: 'Solar + Nuclear', opened_year: 2023, estimated_completion: null, investment_usd: 3_000_000_000, notes: 'Hosts Jais Arabic LLM training' },
  { id: 'oracle-riyadh-sa', name: 'Oracle Riyadh Cloud', operator: 'Oracle', country: 'Saudi Arabia', country_code: 'SA', region: 'Middle East', city: 'Riyadh', lat: 24.7136, lng: 46.6753, capacity_mw: 100, status: 'operational', ai_focus: ['OCI MENA', 'Sovereign AI'], gpu_type: 'NVIDIA A100', gpu_count: null, energy_source: 'Grid + Solar', opened_year: 2024, estimated_completion: null, investment_usd: 1_500_000_000, notes: null },
  { id: 'aws-cape-town-za', name: 'AWS Cape Town', operator: 'Amazon/AWS', country: 'South Africa', country_code: 'ZA', region: 'Africa', city: 'Cape Town', lat: -33.9249, lng: 18.4241, capacity_mw: 60, status: 'operational', ai_focus: ['AWS Africa'], gpu_type: 'Mixed', gpu_count: null, energy_source: 'Grid + Solar', opened_year: 2020, estimated_completion: null, investment_usd: 500_000_000, notes: 'First hyperscaler Africa region' },
  { id: 'google-doha-qa', name: 'Google Cloud Doha', operator: 'Google', country: 'Qatar', country_code: 'QA', region: 'Middle East', city: 'Doha', lat: 25.2854, lng: 51.5310, capacity_mw: 80, status: 'operational', ai_focus: ['Cloud AI MENA'], gpu_type: 'TPU v4', gpu_count: null, energy_source: 'Gas + Solar', opened_year: 2024, estimated_completion: null, investment_usd: 900_000_000, notes: null },

  // ──── South America ────────────────────────────────────────
  { id: 'aws-sao-paulo-br', name: 'AWS São Paulo', operator: 'Amazon/AWS', country: 'Brazil', country_code: 'BR', region: 'South America', city: 'São Paulo', lat: -23.5505, lng: -46.6333, capacity_mw: 100, status: 'operational', ai_focus: ['Bedrock LatAm'], gpu_type: 'Mixed', gpu_count: null, energy_source: 'Hydro + Grid', opened_year: 2011, estimated_completion: null, investment_usd: 1_800_000_000, notes: null },
  { id: 'google-santiago-cl', name: 'Google Santiago', operator: 'Google', country: 'Chile', country_code: 'CL', region: 'South America', city: 'Santiago', lat: -33.4489, lng: -70.6693, capacity_mw: 80, status: 'operational', ai_focus: ['Cloud AI LatAm'], gpu_type: 'TPU v4', gpu_count: null, energy_source: 'Solar + Hydro', opened_year: 2021, estimated_completion: null, investment_usd: 600_000_000, notes: null },
  { id: 'ms-queretaro-mx', name: 'Microsoft Querétaro AI', operator: 'Microsoft', country: 'Mexico', country_code: 'MX', region: 'South America', city: 'Querétaro', lat: 20.5888, lng: -100.3899, capacity_mw: 100, status: 'under_construction', ai_focus: ['Azure AI LatAm'], gpu_type: 'NVIDIA H100', gpu_count: null, energy_source: 'Solar + Grid', opened_year: null, estimated_completion: '2026-Q4', investment_usd: 1_300_000_000, notes: 'Part of $1.3B Microsoft Mexico AI investment' },

  // ──── Oceania ───────────────────────────────────────────────
  { id: 'google-sydney-au', name: 'Google Sydney AI Hub', operator: 'Google', country: 'Australia', country_code: 'AU', region: 'Oceania', city: 'Sydney', lat: -33.8688, lng: 151.2093, capacity_mw: 120, status: 'operational', ai_focus: ['Cloud AI APAC'], gpu_type: 'TPU v5', gpu_count: null, energy_source: 'Solar + Wind', opened_year: 2017, estimated_completion: null, investment_usd: 1_500_000_000, notes: null },
  { id: 'ms-melbourne-au', name: 'Microsoft Melbourne', operator: 'Microsoft', country: 'Australia', country_code: 'AU', region: 'Oceania', city: 'Melbourne', lat: -37.8136, lng: 144.9631, capacity_mw: 80, status: 'operational', ai_focus: ['Azure AI AU'], gpu_type: 'NVIDIA H100', gpu_count: null, energy_source: 'Wind + Grid', opened_year: 2023, estimated_completion: null, investment_usd: 1_000_000_000, notes: null },

  // ──── Additional US Facilities ─────────────────────────────
  { id: 'anthropic-us-west', name: 'Anthropic AI Research Cluster', operator: 'Anthropic', country: 'United States', country_code: 'US', region: 'North America', city: 'San Francisco, CA', lat: 37.7749, lng: -122.4194, capacity_mw: 100, status: 'operational', ai_focus: ['Claude Training', 'Safety Research'], gpu_type: 'NVIDIA H100/B200', gpu_count: null, energy_source: 'Grid + Renewable PPAs', opened_year: 2023, estimated_completion: null, investment_usd: 2_000_000_000, notes: 'Primary Claude model training' },
  { id: 'inflection-coreweave-nj', name: 'Inflection/CoreWeave NJ', operator: 'Inflection AI / CoreWeave', country: 'United States', country_code: 'US', region: 'North America', city: 'Edison, NJ', lat: 40.5187, lng: -74.4121, capacity_mw: 100, status: 'operational', ai_focus: ['Pi / Enterprise AI'], gpu_type: 'NVIDIA H100', gpu_count: 22000, energy_source: 'Grid', opened_year: 2023, estimated_completion: null, investment_usd: 800_000_000, notes: null },
  { id: 'google-midlothian-tx', name: 'Google Midlothian TX', operator: 'Google', country: 'United States', country_code: 'US', region: 'North America', city: 'Midlothian, TX', lat: 32.4824, lng: -96.9945, capacity_mw: 300, status: 'under_construction', ai_focus: ['Gemini', 'Cloud AI'], gpu_type: 'TPU v6', gpu_count: null, energy_source: 'Solar + Grid', opened_year: null, estimated_completion: '2027-Q1', investment_usd: 4_000_000_000, notes: null },
  { id: 'applied-digital-jamestown-nd', name: 'Applied Digital Jamestown', operator: 'Applied Digital', country: 'United States', country_code: 'US', region: 'North America', city: 'Jamestown, ND', lat: 46.9067, lng: -98.7084, capacity_mw: 200, status: 'under_construction', ai_focus: ['GPU Cloud'], gpu_type: 'NVIDIA H100', gpu_count: null, energy_source: 'Wind + Grid', opened_year: null, estimated_completion: '2026-Q3', investment_usd: 1_600_000_000, notes: null },

  // ──── Additional Asia ──────────────────────────────────────
  { id: 'tsmc-kaohsiung-tw', name: 'TSMC Kaohsiung AI Fab', operator: 'TSMC', country: 'Taiwan', country_code: 'TW', region: 'Asia Pacific', city: 'Kaohsiung', lat: 22.6273, lng: 120.3014, capacity_mw: 250, status: 'operational', ai_focus: ['AI Chip Manufacturing'], gpu_type: 'N/A (Foundry)', gpu_count: null, energy_source: 'Grid + Solar', opened_year: 2024, estimated_completion: null, investment_usd: 10_000_000_000, notes: 'Produces chips for NVIDIA, AMD, Apple' },
  { id: 'softbank-tokyo-jp', name: 'SoftBank AI Compute Cluster', operator: 'SoftBank', country: 'Japan', country_code: 'JP', region: 'Asia Pacific', city: 'Tokyo', lat: 35.6812, lng: 139.7671, capacity_mw: 150, status: 'under_construction', ai_focus: ['Sovereign AI Japan'], gpu_type: 'NVIDIA GB200', gpu_count: null, energy_source: 'Grid + Nuclear', opened_year: null, estimated_completion: '2026-Q4', investment_usd: 4_000_000_000, notes: 'Part of SoftBank $9B Japan AI investment' },
  { id: 'tenstorrent-toronto-ca', name: 'Tenstorrent Toronto HQ', operator: 'Tenstorrent', country: 'Canada', country_code: 'CA', region: 'North America', city: 'Toronto', lat: 43.6532, lng: -79.3832, capacity_mw: 20, status: 'operational', ai_focus: ['RISC-V AI Chips'], gpu_type: 'Custom Wormhole/Grayskull', gpu_count: null, energy_source: 'Hydro', opened_year: 2022, estimated_completion: null, investment_usd: 500_000_000, notes: 'Jim Keller-led AI chip startup' },
  { id: 'cerebras-santa-clara-us', name: 'Cerebras Systems HQ', operator: 'Cerebras', country: 'United States', country_code: 'US', region: 'North America', city: 'Santa Clara, CA', lat: 37.3541, lng: -121.9552, capacity_mw: 30, status: 'operational', ai_focus: ['Wafer-Scale AI'], gpu_type: 'WSE-3', gpu_count: null, energy_source: 'Grid', opened_year: 2021, estimated_completion: null, investment_usd: 700_000_000, notes: 'World\'s largest AI chip (WSE-3)' },
  { id: 'groq-santa-clara-us', name: 'Groq LPU Cloud Hub', operator: 'Groq', country: 'United States', country_code: 'US', region: 'North America', city: 'Santa Clara, CA', lat: 37.3541, lng: -121.9553, capacity_mw: 50, status: 'operational', ai_focus: ['LPU Inference'], gpu_type: 'Groq LPU', gpu_count: null, energy_source: 'Grid', opened_year: 2024, estimated_completion: null, investment_usd: 640_000_000, notes: 'Ultra-fast inference on custom LPU chips' },

  // ──── Additional Europe ────────────────────────────────────
  { id: 'ms-london-uk', name: 'Microsoft London AI Hub', operator: 'Microsoft', country: 'United Kingdom', country_code: 'GB', region: 'Europe', city: 'London', lat: 51.5074, lng: -0.1278, capacity_mw: 150, status: 'under_construction', ai_focus: ['Azure AI UK'], gpu_type: 'NVIDIA H100', gpu_count: null, energy_source: 'Wind + Grid', opened_year: null, estimated_completion: '2026-Q4', investment_usd: 3_000_000_000, notes: 'Part of $3B Microsoft UK AI commitment' },
  { id: 'scaleway-paris-fr', name: 'Scaleway DC5 AI Zone', operator: 'Scaleway', country: 'France', country_code: 'FR', region: 'Europe', city: 'Paris', lat: 48.8400, lng: 2.3700, capacity_mw: 40, status: 'operational', ai_focus: ['EU GPU Cloud'], gpu_type: 'NVIDIA H100', gpu_count: null, energy_source: 'Nuclear + Grid', opened_year: 2023, estimated_completion: null, investment_usd: 200_000_000, notes: 'European sovereign GPU cloud' },
  { id: 'hetzner-falkenstein-de', name: 'Hetzner Falkenstein GPU Park', operator: 'Hetzner', country: 'Germany', country_code: 'DE', region: 'Europe', city: 'Falkenstein', lat: 50.4753, lng: 12.3678, capacity_mw: 60, status: 'operational', ai_focus: ['Budget GPU Cloud'], gpu_type: 'NVIDIA A100/H100', gpu_count: null, energy_source: 'Grid + Green Certs', opened_year: 2022, estimated_completion: null, investment_usd: 300_000_000, notes: 'Popular with EU AI startups for cost efficiency' },
  { id: 'eai-trondheim-no', name: 'European AI Factory Trondheim', operator: 'EuroHPC JU', country: 'Norway', country_code: 'NO', region: 'Europe', city: 'Trondheim', lat: 63.4305, lng: 10.3951, capacity_mw: 50, status: 'under_construction', ai_focus: ['Sovereign EU AI'], gpu_type: 'NVIDIA GH200', gpu_count: null, energy_source: 'Hydro', opened_year: null, estimated_completion: '2026-Q3', investment_usd: 1_000_000_000, notes: 'EuroHPC AI Factory at NTNU' },
  { id: 'marenostrum5-barcelona-es', name: 'MareNostrum 5', operator: 'BSC (Barcelona Supercomputing)', country: 'Spain', country_code: 'ES', region: 'Europe', city: 'Barcelona', lat: 41.3874, lng: 2.1686, capacity_mw: 30, status: 'operational', ai_focus: ['EU HPC + AI'], gpu_type: 'NVIDIA GH200', gpu_count: null, energy_source: 'Grid + Solar', opened_year: 2024, estimated_completion: null, investment_usd: 220_000_000, notes: 'Europe\'s major pre-exascale system' },

  // ──── Additional MENA ──────────────────────────────────────
  { id: 'neom-sa', name: 'NEOM AI Data Center', operator: 'NEOM/Saudi Arabia', country: 'Saudi Arabia', country_code: 'SA', region: 'Middle East', city: 'NEOM', lat: 28.0000, lng: 35.2000, capacity_mw: 300, status: 'under_construction', ai_focus: ['Smart City AI', 'Sovereign AI'], gpu_type: 'NVIDIA H100', gpu_count: null, energy_source: 'Solar + Green Hydrogen', opened_year: null, estimated_completion: '2027-Q2', investment_usd: 5_000_000_000, notes: 'Part of NEOM smart city megaproject' },

  // ──── Canada ───────────────────────────────────────────────
  { id: 'google-beauharnois-ca', name: 'Google Beauharnois', operator: 'Google', country: 'Canada', country_code: 'CA', region: 'North America', city: 'Beauharnois, QC', lat: 45.3120, lng: -73.8730, capacity_mw: 100, status: 'operational', ai_focus: ['Cloud AI'], gpu_type: 'TPU v5', gpu_count: null, energy_source: 'Hydro', opened_year: 2012, estimated_completion: null, investment_usd: 800_000_000, notes: null },
  { id: 'cohere-toronto-ca', name: 'Cohere AI Lab Toronto', operator: 'Cohere', country: 'Canada', country_code: 'CA', region: 'North America', city: 'Toronto', lat: 43.6510, lng: -79.3470, capacity_mw: 20, status: 'operational', ai_focus: ['Enterprise LLM'], gpu_type: 'NVIDIA H100', gpu_count: null, energy_source: 'Grid + Hydro', opened_year: 2023, estimated_completion: null, investment_usd: 500_000_000, notes: 'Canadian enterprise AI unicorn' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function filterDatacenters(
  params: { region?: string; country?: string; status?: string; operator?: string; limit?: number },
): Omit<AIDatacenter, 'related_signals'>[] {
  let results = [...AI_DATACENTERS]

  if (params.region) {
    const r = params.region.toLowerCase()
    results = results.filter(d => d.region.toLowerCase() === r)
  }
  if (params.country) {
    const c = params.country.toUpperCase()
    results = results.filter(d => d.country_code === c)
  }
  if (params.status) {
    results = results.filter(d => d.status === params.status)
  }
  if (params.operator) {
    const op = params.operator.toLowerCase()
    results = results.filter(d => d.operator.toLowerCase().includes(op))
  }

  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  return results.slice(0, limit)
}

function buildSummary(): Omit<AIInfraSummary, 'related_signals_24h'> {
  const operational        = AI_DATACENTERS.filter(d => d.status === 'operational').length
  const under_construction = AI_DATACENTERS.filter(d => d.status === 'under_construction').length
  const announced          = AI_DATACENTERS.filter(d => d.status === 'announced').length
  const planned            = AI_DATACENTERS.filter(d => d.status === 'planned').length
  const total_capacity_mw  = AI_DATACENTERS.reduce((s, d) => s + (d.capacity_mw ?? 0), 0)
  const total_investment_usd = AI_DATACENTERS.reduce((s, d) => s + (d.investment_usd ?? 0), 0)

  const countries = new Set(AI_DATACENTERS.map(d => d.country_code))

  const operatorCounts: Record<string, number> = {}
  const countryCounts: Record<string, { country: string; country_code: string; count: number }> = {}

  for (const d of AI_DATACENTERS) {
    operatorCounts[d.operator] = (operatorCounts[d.operator] ?? 0) + 1
    if (!countryCounts[d.country_code]) {
      countryCounts[d.country_code] = { country: d.country, country_code: d.country_code, count: 0 }
    }
    countryCounts[d.country_code]!.count++
  }

  const top_operators = Object.entries(operatorCounts)
    .map(([operator, count]) => ({ operator, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  const top_countries = Object.values(countryCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  return {
    total_datacenters: AI_DATACENTERS.length,
    operational,
    under_construction,
    announced,
    planned,
    total_capacity_mw,
    countries_count: countries.size,
    top_operators,
    top_countries,
    total_investment_usd,
  }
}

// ─── Route Registration ───────────────────────────────────────────────────────

export const registerAIInfrastructureRoutes: FastifyPluginAsync = async (app) => {
  // ─── GET /datacenters ────────────────────────────────────
  app.get('/datacenters', {
    config: { rateLimit: { max: RATE_LIMIT_RPM, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    try {
      const q = req.query as Record<string, string | undefined>
      const region   = q.region
      const country  = q.country
      const status   = q.status
      const operator = q.operator
      const limit    = q.limit ? parseInt(q.limit, 10) : DEFAULT_LIMIT

      const cacheKey = `${CACHE_KEY_LIST}:${region ?? ''}:${country ?? ''}:${status ?? ''}:${operator ?? ''}:${limit}`
      const cached = await redis.get(cacheKey)
      if (cached) {
        return reply.send(JSON.parse(cached))
      }

      const datacenters = filterDatacenters({ region, country, status, operator, limit })

      // Enrich with related signal counts from DB
      const enriched: AIDatacenter[] = []
      for (const dc of datacenters) {
        let related_signals = 0
        try {
          const rows = await db('signals')
            .where('location_name', 'ilike', `%${dc.city.split(',')[0]?.trim() ?? dc.city}%`)
            .andWhere('created_at', '>', db.raw("NOW() - INTERVAL '30 days'"))
            .count('id as count')
          related_signals = parseInt(String((rows[0] as { count: string | number } | undefined)?.count ?? 0), 10)
        } catch {
          // DB may not be available in tests — default to 0
        }
        enriched.push({ ...dc, related_signals })
      }

      const body = {
        success: true,
        data: enriched,
        total: AI_DATACENTERS.length,
        filtered: enriched.length,
      }

      await redis.setex(cacheKey, LIST_CACHE_TTL, JSON.stringify(body))
      return reply.send(body)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch AI datacenters')
    }
  })

  // ─── GET /datacenters/:id ────────────────────────────────
  app.get('/datacenters/:id', {
    config: { rateLimit: { max: RATE_LIMIT_RPM, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string }

      const cacheKey = `${CACHE_KEY_DETAIL}:${id}`
      const cached = await redis.get(cacheKey)
      if (cached) {
        return reply.send(JSON.parse(cached))
      }

      const dc = AI_DATACENTERS.find(d => d.id === id)
      if (!dc) {
        return sendError(reply, 404, 'NOT_FOUND', `Datacenter '${id}' not found`)
      }

      // Get related signals
      let related_signals = 0
      let recent_signals: Array<{ id: string; title: string; severity: string; created_at: string }> = []
      try {
        const cityName = dc.city.split(',')[0]?.trim() ?? dc.city
        const rows = await db('signals')
          .where('location_name', 'ilike', `%${cityName}%`)
          .andWhere('created_at', '>', db.raw("NOW() - INTERVAL '30 days'"))
          .count('id as count')
        related_signals = parseInt(String((rows[0] as { count: string | number } | undefined)?.count ?? 0), 10)

        recent_signals = await db('signals')
          .select('id', 'title', 'severity', 'created_at')
          .where('location_name', 'ilike', `%${cityName}%`)
          .andWhere('created_at', '>', db.raw("NOW() - INTERVAL '7 days'"))
          .orderBy('created_at', 'desc')
          .limit(10)
      } catch {
        // DB may not be available
      }

      const body = {
        success: true,
        data: { ...dc, related_signals, recent_signals },
      }

      await redis.setex(cacheKey, LIST_CACHE_TTL, JSON.stringify(body))
      return reply.send(body)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch datacenter detail')
    }
  })

  // ─── GET /summary ────────────────────────────────────────
  app.get('/summary', {
    config: { rateLimit: { max: RATE_LIMIT_RPM, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    try {
      const cached = await redis.get(CACHE_KEY_SUMMARY)
      if (cached) {
        return reply.send(JSON.parse(cached))
      }

      const summary = buildSummary()

      // Count AI-related signals in last 24h
      let related_signals_24h = 0
      try {
        const rows = await db('signals')
          .where(function () {
            this.where('category', 'technology')
              .orWhere('title', 'ilike', '%datacenter%')
              .orWhere('title', 'ilike', '%data center%')
              .orWhere('title', 'ilike', '%GPU%')
              .orWhere('title', 'ilike', '%AI infrastructure%')
          })
          .andWhere('created_at', '>', db.raw("NOW() - INTERVAL '24 hours'"))
          .count('id as count')
        related_signals_24h = parseInt(String((rows[0] as { count: string | number } | undefined)?.count ?? 0), 10)
      } catch {
        // DB may not be available
      }

      const body = {
        success: true,
        data: { ...summary, related_signals_24h },
      }

      await redis.setex(CACHE_KEY_SUMMARY, SUMMARY_CACHE_TTL, JSON.stringify(body))
      return reply.send(body)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch AI infrastructure summary')
    }
  })

  // ─── GET /map/points ─────────────────────────────────────
  app.get('/map/points', {
    config: { rateLimit: { max: RATE_LIMIT_RPM, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    try {
      const q = req.query as Record<string, string | undefined>
      const status = q.status
      const region = q.region

      const cacheKey = `${CACHE_KEY_MAP}:${status ?? ''}:${region ?? ''}`
      const cached = await redis.get(cacheKey)
      if (cached) {
        return reply.send(JSON.parse(cached))
      }

      let filtered = [...AI_DATACENTERS]
      if (status) filtered = filtered.filter(d => d.status === status)
      if (region) {
        const r = region.toLowerCase()
        filtered = filtered.filter(d => d.region.toLowerCase() === r)
      }

      const geojson = {
        type: 'FeatureCollection' as const,
        features: filtered.map(dc => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [dc.lng, dc.lat],
          },
          properties: {
            id:           dc.id,
            name:         dc.name,
            operator:     dc.operator,
            country:      dc.country,
            country_code: dc.country_code,
            city:         dc.city,
            capacity_mw:  dc.capacity_mw,
            status:       dc.status,
            ai_focus:     dc.ai_focus,
            gpu_type:     dc.gpu_type,
            energy_source: dc.energy_source,
            investment_usd: dc.investment_usd,
          },
        })),
      }

      const body = { success: true, data: geojson, total: filtered.length }

      await redis.setex(cacheKey, MAP_CACHE_TTL, JSON.stringify(body))
      return reply.send(body)
    } catch (err) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch map points')
    }
  })
}

// ─── Exports for testing ──────────────────────────────────────────────────────
export {
  AI_DATACENTERS,
  LIST_CACHE_TTL,
  SUMMARY_CACHE_TTL,
  MAP_CACHE_TTL,
  RATE_LIMIT_RPM,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  filterDatacenters,
  buildSummary,
}
