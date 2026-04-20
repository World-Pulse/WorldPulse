import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/postgres'
import { redis } from '../db/redis'

const PATENTS_CACHE_TTL    = 300  // 5 min cache
const TIMELINE_CACHE_TTL   = 600  // 10 min cache

// ─── Types ────────────────────────────────────────────────────────────────────

interface PatentSignal {
  id:               string
  title:            string
  summary:          string | null
  severity:         string
  category:         string
  reliability_score: number | null
  source_count:     number | null
  created_at:       string
  location_name:    string | null
  country_code:     string | null
}

interface CpcBreakdown {
  cpc_group:   string
  label:       string
  count:       number
  max_severity: string
}

interface AssigneeRow {
  assignee: string
  count:    number
  latest_severity: string
}

interface TimelinePoint {
  day:   string
  count: number
}

interface SeverityDist {
  severity: string
  count:    number
}

// ─── CPC Label Lookup ─────────────────────────────────────────────────────────

const CPC_LABELS: Record<string, string> = {
  'F41':    'Weapons',
  'F42':    'Ammunition & Explosives',
  'B64C30': 'Military Aircraft',
  'B64G':   'Space Technology',
  'B63G':   'Naval Weapons',
  'F42B15': 'Missiles & Projectiles',
  'G01S':   'Radar / Sonar',
  'G21':    'Nuclear Engineering',
  'G21J':   'Nuclear Explosives',
  'H04K':   'EW / Jamming',
  'H04L9':  'Cryptography',
  'B64U':   'UAVs / Drones',
  'H01S':   'Directed Energy / Lasers',
  'G01V':   'Surveillance Sensors',
  'H04N7':  'Surveillance Cameras',
}

// Severity ordering for "max severity" aggregation
const SEV_RANK: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1, info: 0,
}

function maxSeverity(a: string, b: string): string {
  return (SEV_RANK[a] ?? 0) >= (SEV_RANK[b] ?? 0) ? a : b
}

// ─── Route ────────────────────────────────────────────────────────────────────

export const registerPatentRoutes: FastifyPluginAsync = async (app) => {

  /**
   * GET /api/v1/patents
   *
   * Patent intelligence dashboard data — recent defense/dual-use patent signals,
   * CPC category breakdown, top assignees, severity distribution, and 30-day timeline.
   *
   * Query params:
   *   window  — '7d' | '14d' | '30d' | '90d' (default '30d')
   *   limit   — max patent signals to return (default 50, max 200)
   *   severity — filter by severity level
   */
  app.get('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          window:   { type: 'string', enum: ['7d', '14d', '30d', '90d'], default: '30d' },
          limit:    { type: 'number', minimum: 1, maximum: 200, default: 50 },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            window:              { type: 'string' },
            total_patents:       { type: 'number' },
            severity_distribution: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  severity: { type: 'string' },
                  count:    { type: 'number' },
                },
              },
            },
            cpc_breakdown: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  cpc_group:    { type: 'string' },
                  label:        { type: 'string' },
                  count:        { type: 'number' },
                  max_severity: { type: 'string' },
                },
              },
            },
            top_assignees: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  assignee:        { type: 'string' },
                  count:           { type: 'number' },
                  latest_severity: { type: 'string' },
                },
              },
            },
            timeline: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  day:   { type: 'string' },
                  count: { type: 'number' },
                },
              },
            },
            recent_patents: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id:               { type: 'string' },
                  title:            { type: 'string' },
                  summary:          { type: ['string', 'null'] },
                  severity:         { type: 'string' },
                  category:         { type: 'string' },
                  reliability_score: { type: ['number', 'null'] },
                  source_count:     { type: ['number', 'null'] },
                  created_at:       { type: 'string' },
                  location_name:    { type: ['string', 'null'] },
                  country_code:     { type: ['string', 'null'] },
                },
              },
            },
            generated_at: { type: 'string' },
          },
        },
      },
    },
    handler: async (req, reply) => {
      try {
      const { window = '30d', limit = 50, severity } = req.query as {
        window?: string
        limit?: number
        severity?: string
      }

      const cacheKey = `patents:dashboard:${window}:${severity ?? 'all'}:${limit}`
      const cached = await redis.get(cacheKey)
      if (cached) {
        return reply.send(JSON.parse(cached))
      }

      // Parse window to interval
      const windowHours = window === '7d' ? 168
        : window === '14d' ? 336
        : window === '90d' ? 2160
        : 720 // 30d default

      const since = new Date(Date.now() - windowHours * 3600_000).toISOString()

      // Base query builder — patent signals matched by tags or title
      const baseWhere = (qb: ReturnType<typeof db>) => {
        qb.where('created_at', '>=', since)
          .where(function (this: ReturnType<typeof db>) {
            this.whereRaw("tags @> ARRAY['patent']::text[]")
              .orWhere('title', 'like', '%Patent%')
              .orWhere('title', 'like', '%patent%')
          })
        if (severity) {
          qb.where('severity', severity)
        }
      }

      // 1. Total count
      const countRows = await db('signals').where(baseWhere).count('id as count')
      const total = Number((countRows[0] as { count: string | number } | undefined)?.count ?? 0)

      // 2. Severity distribution
      const sevRows = await db('signals')
        .where(baseWhere)
        .select('severity')
        .count('id as count')
        .groupBy('severity')
        .orderByRaw(`CASE severity
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          ELSE 5 END`)

      const severityDistribution: SeverityDist[] = sevRows.map((r: Record<string, unknown>) => ({
        severity: String(r.severity ?? 'unknown'),
        count:    Number(r.count ?? 0),
      }))

      // 3. Recent patent signals
      const patentRows = await db('signals')
        .where(baseWhere)
        .select(
          'id', 'title', 'summary', 'severity', 'category',
          'reliability_score', 'source_count', 'created_at',
          'location_name', 'country_code',
        )
        .orderBy('created_at', 'desc')
        .limit(Math.min(limit, 200))

      const recentPatents: PatentSignal[] = patentRows.map((r: Record<string, unknown>) => ({
        id:               String(r.id ?? ''),
        title:            String(r.title ?? ''),
        summary:          r.summary != null ? String(r.summary) : null,
        severity:         String(r.severity ?? 'low'),
        category:         String(r.category ?? 'technology'),
        reliability_score: r.reliability_score != null ? Number(r.reliability_score) : null,
        source_count:     r.source_count != null ? Number(r.source_count) : null,
        created_at:       String(r.created_at ?? ''),
        location_name:    r.location_name != null ? String(r.location_name) : null,
        country_code:     r.country_code != null ? String(r.country_code) : null,
      }))

      // 4. CPC category breakdown — extract CPC code from title patterns
      const cpcBreakdown: CpcBreakdown[] = []
      const cpcCounts: Record<string, { count: number; maxSev: string }> = {}
      for (const p of recentPatents) {
        for (const [code, label] of Object.entries(CPC_LABELS)) {
          if (p.title.includes(code) || p.title.toLowerCase().includes(label.toLowerCase())) {
            if (!cpcCounts[code]) cpcCounts[code] = { count: 0, maxSev: 'low' }
            cpcCounts[code].count++
            cpcCounts[code].maxSev = maxSeverity(cpcCounts[code].maxSev, p.severity)
            break // one CPC per patent for breakdown
          }
        }
      }
      for (const [code, { count, maxSev }] of Object.entries(cpcCounts)) {
        cpcBreakdown.push({
          cpc_group:    code,
          label:        CPC_LABELS[code] ?? code,
          count,
          max_severity: maxSev,
        })
      }
      cpcBreakdown.sort((a, b) => b.count - a.count)

      // 5. Top assignees — extract from title (format: "Assignee: Title" or " — Assignee")
      const assigneeCounts: Record<string, { count: number; latestSev: string }> = {}
      for (const p of recentPatents) {
        // Try to extract assignee from common patent title patterns
        const assigneeMatch = p.title.match(/^([A-Z][A-Za-z &.-]+?)(?:\s*[:\u2014\u2013-]\s)/)
          ?? p.title.match(/(?:by|from|assigned to)\s+([A-Z][A-Za-z &.-]+)/i)
        if (assigneeMatch?.[1]) {
          const assignee = assigneeMatch[1].trim()
          if (!assigneeCounts[assignee]) assigneeCounts[assignee] = { count: 0, latestSev: 'low' }
          assigneeCounts[assignee].count++
          assigneeCounts[assignee].latestSev = maxSeverity(assigneeCounts[assignee].latestSev, p.severity)
        }
      }
      const topAssignees: AssigneeRow[] = Object.entries(assigneeCounts)
        .map(([assignee, { count, latestSev }]) => ({ assignee, count, latest_severity: latestSev }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15)

      // 6. Timeline — daily counts
      const timelineRows = await db('signals')
        .where(baseWhere)
        .select(db.raw("DATE(created_at) as day"))
        .count('id as count')
        .groupByRaw("DATE(created_at)")
        .orderBy('day', 'asc')

      const timeline: TimelinePoint[] = timelineRows.map((r: Record<string, unknown>) => ({
        day:   String(r.day ?? ''),
        count: Number(r.count ?? 0),
      }))

      const result = {
        window,
        total_patents: total,
        severity_distribution: severityDistribution,
        cpc_breakdown:   cpcBreakdown,
        top_assignees:   topAssignees,
        timeline,
        recent_patents:  recentPatents,
        generated_at:    new Date().toISOString(),
      }

      await redis.setex(cacheKey, PATENTS_CACHE_TTL, JSON.stringify(result))
      return reply.send(result)
      } catch (err) {
        req.log.error({ err }, 'patents: handler error')
        return reply.status(500).send({
          window: req.query && (req.query as Record<string, unknown>).window || '30d',
          total_patents: 0,
          severity_distribution: [],
          cpc_breakdown: [],
          top_assignees: [],
          timeline: [],
          recent_patents: [],
          generated_at: new Date().toISOString(),
          error: 'Temporary data unavailable',
        })
      }
    },
  })
}
