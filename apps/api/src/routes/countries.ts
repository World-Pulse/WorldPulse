import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { sendError } from '../lib/errors'
import { parseQuery, CountryIndexQuerySchema, CountryDetailQuerySchema } from '../lib/query-schemas'

const COUNTRY_LIST_TTL   = 300  // 5 min — list is heavy (all countries aggregated)
const COUNTRY_DETAIL_TTL = 120  // 2 min — per-country detail

// ISO 3166-1 alpha-2 → full country name
const COUNTRY_NAMES: Record<string, string> = {
  AF: 'Afghanistan',    AL: 'Albania',        DZ: 'Algeria',        AD: 'Andorra',
  AO: 'Angola',         AR: 'Argentina',      AM: 'Armenia',        AU: 'Australia',
  AT: 'Austria',        AZ: 'Azerbaijan',     BS: 'Bahamas',        BH: 'Bahrain',
  BD: 'Bangladesh',     BY: 'Belarus',        BE: 'Belgium',        BZ: 'Belize',
  BJ: 'Benin',          BO: 'Bolivia',        BA: 'Bosnia & Herz.', BR: 'Brazil',
  BN: 'Brunei',         BG: 'Bulgaria',       BF: 'Burkina Faso',   BI: 'Burundi',
  KH: 'Cambodia',       CM: 'Cameroon',       CA: 'Canada',         CF: 'C. African Rep.',
  TD: 'Chad',           CL: 'Chile',          CN: 'China',          CO: 'Colombia',
  CG: 'Congo',          CD: 'DR Congo',       CR: 'Costa Rica',     HR: 'Croatia',
  CU: 'Cuba',           CY: 'Cyprus',         CZ: 'Czech Republic', DK: 'Denmark',
  DJ: 'Djibouti',       DO: 'Dominican Rep.', EC: 'Ecuador',        EG: 'Egypt',
  SV: 'El Salvador',    GQ: 'Eq. Guinea',     ER: 'Eritrea',        EE: 'Estonia',
  ET: 'Ethiopia',       FJ: 'Fiji',           FI: 'Finland',        FR: 'France',
  GA: 'Gabon',          GM: 'Gambia',         GE: 'Georgia',        DE: 'Germany',
  GH: 'Ghana',          GR: 'Greece',         GT: 'Guatemala',      GN: 'Guinea',
  GW: 'Guinea-Bissau',  GY: 'Guyana',         HT: 'Haiti',          HN: 'Honduras',
  HU: 'Hungary',        IS: 'Iceland',        IN: 'India',          ID: 'Indonesia',
  IR: 'Iran',           IQ: 'Iraq',           IE: 'Ireland',        IL: 'Israel',
  IT: 'Italy',          JM: 'Jamaica',        JP: 'Japan',          JO: 'Jordan',
  KZ: 'Kazakhstan',     KE: 'Kenya',          KP: 'North Korea',    KR: 'South Korea',
  KW: 'Kuwait',         KG: 'Kyrgyzstan',     LA: 'Laos',           LV: 'Latvia',
  LB: 'Lebanon',        LR: 'Liberia',        LY: 'Libya',          LT: 'Lithuania',
  LU: 'Luxembourg',     MK: 'N. Macedonia',   MG: 'Madagascar',     MW: 'Malawi',
  MY: 'Malaysia',       MV: 'Maldives',       ML: 'Mali',           MT: 'Malta',
  MR: 'Mauritania',     MX: 'Mexico',         MD: 'Moldova',        MN: 'Mongolia',
  ME: 'Montenegro',     MA: 'Morocco',        MZ: 'Mozambique',     MM: 'Myanmar',
  NA: 'Namibia',        NP: 'Nepal',          NL: 'Netherlands',    NZ: 'New Zealand',
  NI: 'Nicaragua',      NE: 'Niger',          NG: 'Nigeria',        NO: 'Norway',
  OM: 'Oman',           PK: 'Pakistan',       PA: 'Panama',         PG: 'Papua N.G.',
  PY: 'Paraguay',       PE: 'Peru',           PH: 'Philippines',    PL: 'Poland',
  PT: 'Portugal',       QA: 'Qatar',          RO: 'Romania',        RU: 'Russia',
  RW: 'Rwanda',         SA: 'Saudi Arabia',   SN: 'Senegal',        RS: 'Serbia',
  SL: 'Sierra Leone',   SO: 'Somalia',        ZA: 'South Africa',   SS: 'South Sudan',
  ES: 'Spain',          LK: 'Sri Lanka',      SD: 'Sudan',          SE: 'Sweden',
  CH: 'Switzerland',    SY: 'Syria',          TW: 'Taiwan',         TJ: 'Tajikistan',
  TZ: 'Tanzania',       TH: 'Thailand',       TL: 'Timor-Leste',    TG: 'Togo',
  TT: 'Trinidad & T.',  TN: 'Tunisia',        TR: 'Turkey',         TM: 'Turkmenistan',
  UG: 'Uganda',         UA: 'Ukraine',        AE: 'UAE',            GB: 'United Kingdom',
  US: 'United States',  UY: 'Uruguay',        UZ: 'Uzbekistan',     VE: 'Venezuela',
  VN: 'Vietnam',        YE: 'Yemen',          ZM: 'Zambia',         ZW: 'Zimbabwe',
  PS: 'Palestine',      XX: 'International',
}

// Severity → numeric weight for risk score computation
const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 100,
  high:     70,
  medium:   40,
  low:      15,
  info:     5,
}

// Risk band thresholds
function riskBand(score: number): { label: string; color: string } {
  if (score >= 80) return { label: 'Critical',  color: '#ff3b5c' }
  if (score >= 60) return { label: 'High',       color: '#ff6b35' }
  if (score >= 40) return { label: 'Elevated',   color: '#f5a623' }
  if (score >= 20) return { label: 'Moderate',   color: '#ffd700' }
  return              { label: 'Low',         color: '#00e676' }
}

// ─── Resilience Scoring ───────────────────────────────────────────────────────

const RESILIENCE_CACHE_TTL   = 600  // 10 min
const RANKINGS_CACHE_TTL     = 1200 // 20 min

// Category → resilience dimension mapping
const CATEGORY_DIMENSION: Record<string, string> = {
  conflict:         'security',
  military:         'security',
  terrorism:        'security',
  weapons:          'security',
  political:        'political',
  government:       'political',
  elections:        'political',
  protests:         'political',
  economic:         'economic',
  finance:          'economic',
  trade:            'economic',
  sanctions:        'economic',
  climate:          'environmental',
  environment:      'environmental',
  natural_disaster: 'environmental',
  health:           'environmental',
  infrastructure:   'infrastructure',
  energy:           'infrastructure',
  transport:        'infrastructure',
  outages:          'infrastructure',
  cyber:            'cyber',
  technology:       'cyber',
  hacking:          'cyber',
  surveillance:     'cyber',
}

const DIMENSION_WEIGHTS: Record<string, number> = {
  security:       0.25,
  political:      0.20,
  economic:       0.20,
  environmental:  0.15,
  infrastructure: 0.10,
  cyber:          0.10,
}

// resilienceBand: high composite = low risk = resilient
function resilienceBand(score: number): { label: string; color: string } {
  if (score >= 80) return { label: 'Low',       color: '#00e676' }
  if (score >= 60) return { label: 'Moderate',  color: '#ffd700' }
  if (score >= 40) return { label: 'Elevated',  color: '#f5a623' }
  if (score >= 20) return { label: 'High',      color: '#ff6b35' }
  return              { label: 'Critical',  color: '#ff3b5c' }
}

interface SignalRow {
  category:  string | null
  severity:  string | null
  cnt:       string | number
  risk_sum:  string | number
}

interface DimensionScore {
  score:        number
  weight:       number
  signal_count: number
}

function computeResilienceFromRows(rows: SignalRow[]): {
  composite_score: number
  dimensions: Record<string, DimensionScore>
  signals_analyzed: number
} {
  // Accumulate risk per dimension
  const dimRisk: Record<string, { risk_sum: number; count: number }> = {
    security:       { risk_sum: 0, count: 0 },
    political:      { risk_sum: 0, count: 0 },
    economic:       { risk_sum: 0, count: 0 },
    environmental:  { risk_sum: 0, count: 0 },
    infrastructure: { risk_sum: 0, count: 0 },
    cyber:          { risk_sum: 0, count: 0 },
  }

  let totalSignals = 0

  for (const row of rows) {
    const cnt     = Number(row.cnt ?? 0)
    const riskSum = Number(row.risk_sum ?? 0)
    totalSignals += cnt

    const dim = CATEGORY_DIMENSION[row.category ?? '']
    if (dim) {
      dimRisk[dim]!.risk_sum += riskSum
      dimRisk[dim]!.count    += cnt
    } else {
      // Unrecognized category contributes 20% to all dimensions
      for (const d of Object.keys(dimRisk)) {
        dimRisk[d]!.risk_sum += riskSum * 0.20
        dimRisk[d]!.count    += cnt * 0.20
      }
    }
  }

  // Convert risk accumulation to 0-100 resilience per dimension
  // Log-normalize risk_sum (max reference = 10000), then invert
  const dimensions: Record<string, DimensionScore> = {}
  let weightedSum   = 0
  let totalWeight   = 0

  for (const [dim, weight] of Object.entries(DIMENSION_WEIGHTS)) {
    const { risk_sum, count } = dimRisk[dim] ?? { risk_sum: 0, count: 0 }
    const normalizedRisk = risk_sum > 0
      ? Math.min(100, Math.round(Math.log(risk_sum + 1) / Math.log(10000 + 1) * 100))
      : 0
    const score = Math.max(0, Math.min(100, 100 - normalizedRisk))

    dimensions[dim] = {
      score,
      weight,
      signal_count: Math.round(count),
    }

    weightedSum += score * weight
    totalWeight += weight
  }

  const composite_score = totalWeight > 0
    ? Math.round(weightedSum / totalWeight)
    : 100  // no signals = fully resilient

  return { composite_score, dimensions, signals_analyzed: totalSignals }
}

export const registerCountryRoutes: FastifyPluginAsync = async (app) => {

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.schema ??= {}
    routeOptions.schema.tags = routeOptions.schema.tags ?? ['countries']
  })

  // ─── GET /api/v1/countries/resilience/rankings ────────────────────────────
  // Must be registered BEFORE /:code to avoid static segment being consumed by param.
  app.get('/resilience/rankings', {
    schema: {
      summary: 'Country Resilience Rankings',
      description: 'Sorted resilience scores for all countries with recent signal activity',
      querystring: {
        type: 'object',
        properties: {
          limit:       { type: 'number', default: 50,  maximum: 200 },
          min_signals: { type: 'number', default: 3 },
        },
      },
    },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const query = req.query as { limit?: number; min_signals?: number }
    const limit      = Math.min(Number(query.limit ?? 50), 200)
    const minSignals = Number(query.min_signals ?? 3)

    const cacheKey = `country:resilience:rankings:${limit}:${minSignals}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))

    const now      = new Date()
    const since30d = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString()
    const since60d = new Date(now.getTime() - 60 * 24 * 3600 * 1000).toISOString()

    // Fetch all signal rows for both current and previous period in one query
    const allRows = await db('signals')
      .whereNotNull('country_code')
      .where('status', 'verified')
      .where('created_at', '>=', since60d)
      .select(
        'country_code',
        'category',
        db.raw('CASE WHEN created_at >= ? THEN \'current\' ELSE \'prev\' END as period', [since30d]),
        db.raw('COUNT(*) as cnt'),
        db.raw(`SUM(CASE
          WHEN severity = 'critical' THEN ${SEVERITY_WEIGHT.critical}
          WHEN severity = 'high'     THEN ${SEVERITY_WEIGHT.high}
          WHEN severity = 'medium'   THEN ${SEVERITY_WEIGHT.medium}
          WHEN severity = 'low'      THEN ${SEVERITY_WEIGHT.low}
          ELSE ${SEVERITY_WEIGHT.info}
        END) as risk_sum`),
      )
      .groupBy('country_code', 'category', db.raw('CASE WHEN created_at >= ? THEN \'current\' ELSE \'prev\' END', [since30d]))

    // Group rows by country + period
    const byCountry: Record<string, { current: SignalRow[]; prev: SignalRow[] }> = {}
    for (const row of allRows as Array<SignalRow & { country_code: string; period: string }>) {
      const cc = row.country_code
      byCountry[cc] ??= { current: [], prev: [] }
      if (row.period === 'current') {
        byCountry[cc]!.current.push(row)
      } else {
        byCountry[cc]!.prev.push(row)
      }
    }

    const rankings: Array<{
      country_code:    string
      country_name:    string
      composite_score: number
      risk_level:      string
      risk_color:      string
      signal_count:    number
      trend:           string
      trend_delta:     number
    }> = []

    for (const [cc, { current, prev }] of Object.entries(byCountry)) {
      const { composite_score, signals_analyzed } = computeResilienceFromRows(current)
      if (signals_analyzed < minSignals) continue

      const { composite_score: prevScore } = computeResilienceFromRows(prev)
      const trend_delta = composite_score - prevScore
      const trend = trend_delta > 2 ? 'improving' : trend_delta < -2 ? 'deteriorating' : 'stable'
      const band  = resilienceBand(composite_score)

      rankings.push({
        country_code:    cc,
        country_name:    COUNTRY_NAMES[cc] ?? cc,
        composite_score,
        risk_level:      band.label,
        risk_color:      band.color,
        signal_count:    signals_analyzed,
        trend,
        trend_delta,
      })
    }

    // Sort by composite_score descending (most resilient first)
    rankings.sort((a, b) => b.composite_score - a.composite_score)
    const sliced = rankings.slice(0, limit)

    const result = {
      success:      true,
      total:        sliced.length,
      period_days:  30,
      rankings:     sliced,
      generated_at: now.toISOString(),
    }

    await redis.setex(cacheKey, RANKINGS_CACHE_TTL, JSON.stringify(result)).catch(() => {})
    return reply.send(result)
  })

  // ─── GET /api/v1/countries/:code/resilience ───────────────────────────────
  app.get('/:code/resilience', {
    schema: {
      summary: 'Country Resilience Score',
      description: 'Multi-dimensional resilience/stability score for a single country based on 30-day signal data',
      params: {
        type: 'object',
        required: ['code'],
        properties: { code: { type: 'string', minLength: 2, maxLength: 2 } },
      },
    },
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { code } = req.params as { code: string }
    const upperCode = code.toUpperCase()

    const cacheKey = `country:resilience:${upperCode}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))

    const now      = new Date()
    const since30d = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString()
    const since60d = new Date(now.getTime() - 60 * 24 * 3600 * 1000).toISOString()

    // Fetch current and previous period in one query
    const allRows = await db('signals')
      .where('country_code', upperCode)
      .where('status', 'verified')
      .where('created_at', '>=', since60d)
      .select(
        'category',
        db.raw('CASE WHEN created_at >= ? THEN \'current\' ELSE \'prev\' END as period', [since30d]),
        db.raw('COUNT(*) as cnt'),
        db.raw(`SUM(CASE
          WHEN severity = 'critical' THEN ${SEVERITY_WEIGHT.critical}
          WHEN severity = 'high'     THEN ${SEVERITY_WEIGHT.high}
          WHEN severity = 'medium'   THEN ${SEVERITY_WEIGHT.medium}
          WHEN severity = 'low'      THEN ${SEVERITY_WEIGHT.low}
          ELSE ${SEVERITY_WEIGHT.info}
        END) as risk_sum`),
      )
      .groupBy('category', db.raw('CASE WHEN created_at >= ? THEN \'current\' ELSE \'prev\' END', [since30d]))

    const currentRows: SignalRow[] = []
    const prevRows:    SignalRow[] = []
    for (const row of allRows as Array<SignalRow & { period: string }>) {
      if (row.period === 'current') currentRows.push(row)
      else prevRows.push(row)
    }

    const { composite_score, dimensions, signals_analyzed } = computeResilienceFromRows(currentRows)
    const { composite_score: prevScore } = computeResilienceFromRows(prevRows)

    const trend_delta = composite_score - prevScore
    const trend       = trend_delta > 2 ? 'improving' : trend_delta < -2 ? 'deteriorating' : 'stable'
    const band        = resilienceBand(composite_score)

    const result = {
      success: true,
      data: {
        country_code:     upperCode,
        country_name:     COUNTRY_NAMES[upperCode] ?? upperCode,
        composite_score,
        risk_level:       band.label,
        risk_color:       band.color,
        trend,
        trend_delta,
        dimensions,
        signals_analyzed,
        period_days:      30,
        computed_at:      now.toISOString(),
      },
    }

    await redis.setex(cacheKey, RESILIENCE_CACHE_TTL, JSON.stringify(result)).catch(() => {})
    return reply.send(result)
  })

  // ─── GET /api/v1/countries ─────────────────────────────────────────────────
  // Returns all countries that have signals, sorted by risk score desc.
  app.get('/', {
    schema: {
      summary: 'Country Intelligence Index',
      description: 'Composite risk index for all countries with recent signal activity',
      querystring: {
        type: 'object',
        properties: {
          window:  { type: 'string', enum: ['24h', '48h', '7d', '30d'], default: '24h' },
          limit:   { type: 'number', default: 50, maximum: 200 },
          category: { type: 'string' },
        },
      },
    },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const qr = parseQuery(CountryIndexQuerySchema, req.query)
    if (qr.error) return sendError(reply, 400, 'VALIDATION_ERROR', qr.error)
    const { window, limit, category } = qr.data

    const cacheKey = `countries:index:${window}:${limit}:${category ?? 'all'}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))

    const windowHours = window === '30d' ? 720 : window === '7d' ? 168 : window === '48h' ? 48 : 24
    const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString()

    let query = db('signals')
      .whereNotNull('country_code')
      .where('status', 'verified')
      .where('created_at', '>=', since)

    if (category) {
      query = query.where('category', category)
    }

    const rows = await query
      .select(
        'country_code',
        db.raw('COUNT(*) as signal_count'),
        db.raw(`SUM(CASE
          WHEN severity = 'critical' THEN ${SEVERITY_WEIGHT.critical}
          WHEN severity = 'high'     THEN ${SEVERITY_WEIGHT.high}
          WHEN severity = 'medium'   THEN ${SEVERITY_WEIGHT.medium}
          WHEN severity = 'low'      THEN ${SEVERITY_WEIGHT.low}
          ELSE ${SEVERITY_WEIGHT.info}
        END) as raw_score`),
        db.raw(`MAX(CASE
          WHEN severity = 'critical' THEN 4
          WHEN severity = 'high'     THEN 3
          WHEN severity = 'medium'   THEN 2
          WHEN severity = 'low'      THEN 1
          ELSE 0
        END) as max_severity_rank`),
        db.raw(`json_agg(DISTINCT category) FILTER (WHERE category IS NOT NULL) as categories`),
        db.raw(`MAX(created_at) as latest_signal_at`),
        db.raw(`AVG(reliability_score) as avg_reliability`),
        db.raw(`COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '6 hours') as recent_6h`)
      )
      .groupBy('country_code')
      .orderByRaw('raw_score DESC')
      .limit(Number(limit))

    // Normalize risk scores to 0–100 scale
    const maxRaw = rows.length > 0 ? Number(rows[0].raw_score ?? 1) : 1
    const minRaw = rows.length > 0 ? Number(rows[rows.length - 1]?.raw_score ?? 0) : 0
    const range = maxRaw - minRaw || 1

    const countries = rows.map((row: Record<string, unknown>) => {
      const rawScore = Number(row.raw_score ?? 0)
      const normalizedScore = Math.round(((rawScore - minRaw) / range) * 85 + 10) // 10–95 range
      const band = riskBand(normalizedScore)
      const recent6h = Number(row.recent_6h ?? 0)
      const totalCount = Number(row.signal_count ?? 0)
      const trend = recent6h > totalCount * 0.5 ? 'rising' : recent6h > totalCount * 0.25 ? 'stable' : 'falling'

      return {
        code:          row.country_code as string,
        name:          COUNTRY_NAMES[row.country_code as string] ?? (row.country_code as string),
        risk_score:    normalizedScore,
        risk_label:    band.label,
        risk_color:    band.color,
        signal_count:  totalCount,
        recent_6h:     recent6h,
        trend,
        categories:    (row.categories as string[] | null) ?? [],
        avg_reliability: row.avg_reliability != null ? Math.round(Number(row.avg_reliability) * 100) / 100 : null,
        latest_signal_at: row.latest_signal_at,
      }
    })

    const result = { window, total: countries.length, countries, generated_at: new Date().toISOString() }
    await redis.setex(cacheKey, COUNTRY_LIST_TTL, JSON.stringify(result)).catch(() => {})
    return reply.send(result)
  })

  // ─── GET /api/v1/countries/:code ──────────────────────────────────────────
  // Detailed intelligence profile for a single country.
  app.get('/:code', {
    schema: {
      summary: 'Country intelligence profile',
      params: {
        type: 'object',
        required: ['code'],
        properties: { code: { type: 'string', minLength: 2, maxLength: 2 } },
      },
      querystring: {
        type: 'object',
        properties: {
          window: { type: 'string', enum: ['24h', '48h', '7d', '30d'], default: '7d' },
          limit:  { type: 'number', default: 10, maximum: 50 },
        },
      },
    },
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { code } = req.params as { code: string }
    const qr = parseQuery(CountryDetailQuerySchema, req.query)
    if (qr.error) return sendError(reply, 400, 'VALIDATION_ERROR', qr.error)
    const { window, limit } = qr.data
    const upperCode = code.toUpperCase()

    const cacheKey = `countries:detail:${upperCode}:${window}:${limit}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return reply.header('X-Cache-Hit', 'true').send(JSON.parse(cached))

    const windowHours = window === '30d' ? 720 : window === '7d' ? 168 : window === '48h' ? 48 : 24
    const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString()

    // Category breakdown
    const [categoryBreakdown, recentSignals, hourlyTrend] = await Promise.all([
      // Category signal counts
      db('signals')
        .where('country_code', upperCode)
        .where('status', 'verified')
        .where('created_at', '>=', since)
        .select('category')
        .count('* as count')
        .select(
          db.raw(`MAX(CASE WHEN severity='critical' THEN 4 WHEN severity='high' THEN 3 WHEN severity='medium' THEN 2 WHEN severity='low' THEN 1 ELSE 0 END) as max_sev`),
          db.raw(`AVG(reliability_score) as avg_rel`)
        )
        .groupBy('category')
        .orderBy('count', 'desc'),

      // Most recent signals
      db('signals')
        .where('country_code', upperCode)
        .where('status', 'verified')
        .where('created_at', '>=', since)
        .select('id', 'title', 'summary', 'severity', 'category', 'reliability_score', 'source_count', 'created_at', 'location_name')
        .orderBy('created_at', 'desc')
        .limit(Number(limit)),

      // 24-hour signal volume by 4-hour buckets (for sparkline)
      db('signals')
        .where('country_code', upperCode)
        .where('status', 'verified')
        .where('created_at', '>=', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
        .select(db.raw(`date_trunc('hour', created_at) as hour`))
        .count('* as count')
        .groupByRaw(`date_trunc('hour', created_at)`)
        .orderByRaw(`date_trunc('hour', created_at) asc`),
    ])

    const totalSignals = categoryBreakdown.reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.count ?? 0), 0)

    // Compute country risk score from category breakdown
    const SEVE_MAP = [0, 15, 40, 70, 100]
    let rawScore = 0
    for (const r of categoryBreakdown as Record<string, unknown>[]) {
      const maxSev = Number(r.max_sev ?? 0)
      rawScore += Number(r.count ?? 0) * (SEVE_MAP[maxSev] ?? 0)
    }
    const normalizedScore = totalSignals > 0
      ? Math.min(95, Math.round(Math.log(rawScore + 1) / Math.log(5000 + 1) * 85 + 10))
      : 0
    const band = riskBand(normalizedScore)

    if (totalSignals === 0) {
      return sendError(reply, 404, 'NOT_FOUND', 'No signal data found for this country')
    }

    const result = {
      code:           upperCode,
      name:           COUNTRY_NAMES[upperCode] ?? upperCode,
      window,
      risk_score:     normalizedScore,
      risk_label:     band.label,
      risk_color:     band.color,
      total_signals:  totalSignals,
      category_breakdown: (categoryBreakdown as Record<string, unknown>[]).map(r => ({
        category:     r.category,
        count:        Number(r.count),
        max_severity: (['info', 'low', 'medium', 'high', 'critical'] as const)[Number(r.max_sev ?? 0)],
        avg_reliability: r.avg_rel != null ? Math.round(Number(r.avg_rel) * 100) / 100 : null,
      })),
      recent_signals: recentSignals,
      hourly_trend:   (hourlyTrend as Record<string, unknown>[]).map(r => ({
        hour:  r.hour,
        count: Number(r.count),
      })),
      generated_at: new Date().toISOString(),
    }

    await redis.setex(cacheKey, COUNTRY_DETAIL_TTL, JSON.stringify(result)).catch(() => {})
    return reply.send(result)
  })
}
