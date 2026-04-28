/**
 * Trending Topic Engine
 * 
 * Computes trending topics from tag frequency, velocity, and engagement.
 * Uses time-decay weighting so recent signals count more.
 */

import { db } from '../lib/postgres'

interface TrendingResult {
  tag:      string
  category: string | null
  score:    number
  delta:    number
  count:    number
  momentum: 'surging' | 'rising' | 'steady' | 'cooling'
}

/**
 * Compute trending topics for a given time window
 */
export async function computeTrending(window: '1h' | '6h' | '24h'): Promise<TrendingResult[]> {
  const intervalMap = { '1h': 1, '6h': 6, '24h': 24 }
  const hours = intervalMap[window]
  const prevHours = hours * 2  // comparison period

  // Current period tag counts
  const current = await db.raw<{ rows: { tag: string; count: string; category: string | null }[] }>(`
    SELECT 
      unnest(s.tags) as tag,
      COUNT(*)::int as count,
      MODE() WITHIN GROUP (ORDER BY s.category) as category
    FROM signals s
    WHERE s.created_at > NOW() - INTERVAL '${hours} hours'
      AND s.status = 'verified'
    GROUP BY tag
    HAVING COUNT(*) >= 2
    ORDER BY count DESC
    LIMIT 50
  `)

  // Previous period for delta calculation
  const previous = await db.raw<{ rows: { tag: string; count: string }[] }>(`
    SELECT unnest(tags) as tag, COUNT(*)::int as count
    FROM signals
    WHERE created_at BETWEEN NOW() - INTERVAL '${prevHours} hours' 
                         AND NOW() - INTERVAL '${hours} hours'
      AND status = 'verified'
    GROUP BY tag
  `)

  const prevMap = new Map(previous.rows.map(r => [r.tag, Number(r.count)]))

  // Also factor in post engagement on these tags
  const engagement = await db.raw<{ rows: { tag: string; engagement: string }[] }>(`
    SELECT 
      unnest(p.tags) as tag,
      SUM(p.like_count + p.boost_count * 2 + p.reply_count)::int as engagement
    FROM posts p
    WHERE p.created_at > NOW() - INTERVAL '${hours} hours'
      AND p.deleted_at IS NULL
    GROUP BY tag
  `)

  const engagementMap = new Map(engagement.rows.map(r => [r.tag, Number(r.engagement)]))

  const results: TrendingResult[] = current.rows.map(row => {
    const count    = Number(row.count)
    const prevCount = prevMap.get(row.tag) ?? 0
    const eng      = engagementMap.get(row.tag) ?? 0

    // Score = signal count (weighted) + engagement bonus
    const score = count * 10 + Math.log1p(eng) * 5

    // Delta = % change vs previous period
    const delta = prevCount === 0 ? 100 : ((count - prevCount) / prevCount) * 100

    // Momentum classification
    let momentum: TrendingResult['momentum']
    if (delta > 100) momentum = 'surging'
    else if (delta > 30) momentum = 'rising'
    else if (delta > -20) momentum = 'steady'
    else momentum = 'cooling'

    return {
      tag:      row.tag,
      category: row.category,
      score:    Math.round(score * 10) / 10,
      delta:    Math.round(delta * 10) / 10,
      count,
      momentum,
    }
  })

  // Sort by score descending, take top 15
  return results.sort((a, b) => b.score - a.score).slice(0, 15)
}
