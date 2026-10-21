/**
 * GET /api/v1/map/topics/:topic — the World Map's news layers found by
 * headline: protests and unrest, disease outbreaks, refugees and displacement
 * (Oct 21, 2026; the rules are in lib/map-topics.ts).
 *
 * Reports with a place, newest first, as GeoJSON: the same story from another
 * outlet, at the same place, shows once. Kept in Redis for 10 minutes and
 * remade in the background (lib/swr-cache.ts), like the Naval layer.
 */

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/postgres'
import { longQuery } from '../../lib/long-query'
import { staleWhileRevalidate } from '../../lib/swr-cache'
import { firstOfEach, headlineKey } from '../../lib/sea-headlines'
import { MAP_TOPICS, MAP_TOPIC_RULES, isMapTopic, isTopicReport, topicCandidate, type MapTopic } from '../../lib/map-topics'

/** Candidates read from the database (newest first) */
export const TOPIC_READ = 600
/** Points a layer shows */
export const TOPIC_POINTS = 300
export const TOPIC_FRESH_SECONDS = 600
// Oct 21, 10:28 AM, live: protests (48 h) took 15 s, outbreaks (72 h) 22 s, displacement (7 days) past 30 s
const TOPIC_QUERY_SECONDS = 45

export interface TopicRow {
  id:            string
  title:         string
  category:      string | null
  severity:      string | null
  location_name: string | null
  created_at:    string | Date
  lat:           number | null
  lng:           number | null
}

export interface TopicFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: { id: string; title: string; place: string | null; severity: string; created_at: string }
}

function placed(row: TopicRow): boolean {
  const lat = Number(row.lat), lng = Number(row.lng)
  return row.lat != null && row.lng != null && Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
}

/** The layer's points from the database's candidates: the topic's reports with a place, each story once */
export function topicFeatures(topic: MapTopic, rows: TopicRow[], max = TOPIC_POINTS): TopicFeature[] {
  const kept = rows.filter(row => placed(row) && isTopicReport(topic, String(row.title ?? ''), row.category))
  return firstOfEach(kept, row => `${headlineKey(row.title)}|${Number(row.lat).toFixed(1)}|${Number(row.lng).toFixed(1)}`)
    .slice(0, max)
    .map(row => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [Math.round(Number(row.lng) * 1e4) / 1e4, Math.round(Number(row.lat) * 1e4) / 1e4] as [number, number] },
      properties: {
        id:         row.id,
        title:      row.title,
        place:      row.location_name ?? null,
        severity:   row.severity ?? 'low',
        created_at: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
      },
    }))
}

export const registerMapTopicRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { topic: string } }>('/topics/:topic', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['map'],
      summary: 'The map\'s news layers found by headline: protests, disease outbreaks, refugees and displacement',
      description: 'News reports with a place, newest first, as GeoJSON: protests the last 48 hours, outbreaks and displacement 72. Found by words in the headline (English, French, Spanish, Portuguese), so a few may be off topic.',
      params: {
        type: 'object',
        required: ['topic'],
        properties: { topic: { type: 'string', enum: [...MAP_TOPICS] } },
      },
    },
  }, async (req, reply) => {
    const topic = req.params.topic
    if (!isMapTopic(topic)) return reply.code(404).send({ success: false, error: 'Unknown topic', topics: MAP_TOPICS })
    const rule = MAP_TOPIC_RULES[topic]
    let made = false
    const features = await staleWhileRevalidate(
      `map:topic:${topic}:v1`,
      { freshSeconds: TOPIC_FRESH_SECONDS, staleSeconds: 6 * 3600, lockSeconds: 2 * TOPIC_QUERY_SECONDS },
      async () => {
        made = true
        const since = new Date(Date.now() - rule.hours * 3600_000)
        const rows = await longQuery(TOPIC_QUERY_SECONDS, trx => trx('signals')
          .select('id', 'title', 'category', 'severity', 'location_name', 'created_at',
            db.raw('ST_X(location::geometry) as lng'),
            db.raw('ST_Y(location::geometry) as lat'))
          .whereRaw('title ~* ?', [topicCandidate(topic)])
          .whereNotNull('location')
          .whereIn('status', ['verified', 'pending'])
          .where('created_at', '>', since)
          .orderBy('created_at', 'desc')
          .limit(TOPIC_READ)) as TopicRow[]
        return topicFeatures(topic, rows)
      },
    )
    void reply.header('Cache-Control', 'public, max-age=300')
    return reply.send({ success: true, cached: !made, topic, hours: rule.hours, type: 'FeatureCollection', features })
  })
}
