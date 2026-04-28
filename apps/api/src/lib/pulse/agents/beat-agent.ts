/**
 * PULSE Beat Agent — runs a single beat reporter or regional desk agent.
 *
 * Each beat agent:
 * 1. Queries signals matching their categories/regions from the last scan window
 * 2. Identifies clusters of related signals (trends)
 * 3. If a trend crosses the threshold, generates and publishes an analysis
 * 4. Logs what it reviewed and found for the coordinator
 */
import { db } from '../../../db/postgres'
import { EDITORIAL_SYSTEM_PROMPT } from '../constants'
import { generateContent, publishAnalysis } from '../publisher'
import type { AgentConfig, AgentScanResult, IdentifiedTrend } from './types'

const SCAN_WINDOW_HOURS = 4 // look back 4 hours per scan

/**
 * Run a single beat agent's scan cycle.
 */
export async function runBeatAgent(agent: AgentConfig): Promise<AgentScanResult> {
  const since = new Date(Date.now() - SCAN_WINDOW_HOURS * 3600_000)

  // Build query based on agent's beat
  let q = db('signals')
    .whereIn('status', ['verified', 'pending'])
    .where('created_at', '>', since)
    .where('reliability_score', '>=', 0.5)  // Skip unreliable signals
    .where('source_count', '>=', 2)         // Must have corroboration
    .orderBy('created_at', 'desc')
    .limit(50)
    .select(['id', 'title', 'summary', 'category', 'severity',
      'reliability_score', 'source_count', 'location_name',
      'country_code', 'created_at'])

  // Filter by categories if specified
  if (agent.categories.length > 0) {
    q = q.whereIn('category', agent.categories)
  }

  // Filter by regions if specified
  if (agent.regions && agent.regions.length > 0) {
    q = q.whereIn('country_code', agent.regions)
  }

  // Filter by minimum severity
  const severityOrder = ['critical', 'high', 'medium', 'low']
  const minIdx = severityOrder.indexOf(agent.minSeverity)
  const allowedSeverities = severityOrder.slice(0, minIdx + 1)
  q = q.whereIn('severity', allowedSeverities)

  const signals = await q

  if (signals.length === 0) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      signalsReviewed: 0,
      trendsIdentified: 0,
      published: false,
    }
  }

  // Identify trends — cluster signals by topic similarity
  const trends = identifyTrends(signals, agent)

  // Check if any trend is worth publishing
  const publishableTrend = trends.find(t =>
    t.signalIds.length >= agent.trendThreshold && t.confidence >= 0.6
  )

  if (!publishableTrend) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      signalsReviewed: signals.length,
      trendsIdentified: trends.length,
      published: false,
    }
  }

  // Check we haven't published on this topic recently
  const recentOnTopic = await db('pulse_publish_log')
    .where('content_type', 'analysis')
    .where('published_at', '>', new Date(Date.now() - 6 * 3600_000))
    .whereRaw("metadata->>'agentId' = ?", [agent.id])
    .first()

  if (recentOnTopic) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      signalsReviewed: signals.length,
      trendsIdentified: trends.length,
      published: false,
    }
  }

  // Publish the analysis
  const trendSignals = signals.filter(s => publishableTrend.signalIds.includes(s.id))
  const topic = `${agent.name}: ${publishableTrend.topic}`
  const result = await publishAnalysis(trendSignals, topic)

  // Tag the publish log with agent metadata
  if (result.success && result.postId) {
    await db('pulse_publish_log')
      .where('post_id', result.postId)
      .update({
        metadata: db.raw("metadata || ?::jsonb", [JSON.stringify({
          agentId: agent.id,
          agentName: agent.name,
          agentRole: agent.role,
          trendTopic: publishableTrend.topic,
          trendConfidence: publishableTrend.confidence,
        })]),
      })
  }

  return {
    agentId: agent.id,
    agentName: agent.name,
    signalsReviewed: signals.length,
    trendsIdentified: trends.length,
    published: result.success,
    postId: result.postId,
    error: result.error,
  }
}

/**
 * Simple trend identification using keyword clustering.
 * Groups signals that share significant keyword overlap.
 */
function identifyTrends(signals: any[], agent: AgentConfig): IdentifiedTrend[] {
  const trends: IdentifiedTrend[] = []
  const assigned = new Set<string>()

  for (const signal of signals) {
    if (assigned.has(signal.id)) continue

    // Find related signals by keyword overlap
    const keywords = extractKeywords(signal.title + ' ' + (signal.summary ?? ''))
    const related = signals.filter(other => {
      if (other.id === signal.id || assigned.has(other.id)) return false
      const otherKeywords = extractKeywords(other.title + ' ' + (other.summary ?? ''))
      const overlap = keywords.filter(k => otherKeywords.includes(k)).length
      return overlap >= 2 // at least 2 shared keywords
    })

    if (related.length > 0) {
      const cluster = [signal, ...related]
      const signalIds = cluster.map((s: any) => s.id)
      signalIds.forEach((id: string) => assigned.add(id))

      // Calculate cluster confidence from reliability scores
      const avgReliability = cluster.reduce((sum: number, s: any) => sum + (s.reliability_score ?? 0.5), 0) / cluster.length
      const sourceStrength = Math.min(cluster.reduce((sum: number, s: any) => sum + (s.source_count ?? 1), 0) / 10, 1)

      trends.push({
        topic: signal.title, // Use the highest-severity signal's title as topic
        signalIds,
        severity: signal.severity,
        confidence: (avgReliability + sourceStrength) / 2,
        summary: `${cluster.length} related signals: ${cluster.map((s: any) => s.title).join('; ')}`,
      })
    }
  }

  // Sort by confidence descending
  return trends.sort((a, b) => b.confidence - a.confidence)
}

/** Extract meaningful keywords from text */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'in', 'on', 'at', 'to',
    'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into', 'over',
    'after', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both',
    'that', 'this', 'these', 'those', 'it', 'its', 'they', 'them',
    'their', 'we', 'our', 'us', 'he', 'she', 'his', 'her', 'my',
    'your', 'who', 'what', 'which', 'where', 'when', 'how', 'why',
    'all', 'each', 'every', 'some', 'any', 'no', 'more', 'most',
    'other', 'than', 'very', 'just', 'also', 'new', 'says', 'said',
    'report', 'reports', 'according', 'sources', 'officials',
  ])

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))
}
