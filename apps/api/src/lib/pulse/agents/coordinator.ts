/**
 * PULSE Agent Coordinator — the Editor-in-Chief.
 *
 * Orchestrates all hired agents:
 * 1. Assigns signals to the right beat agents based on category/region
 * 2. Runs periodic beat scans where each agent reviews their domain
 * 3. Identifies cross-beat trends that need multi-agent analysis
 * 4. Delegates fact-checking when signals have low confidence
 * 5. Routes published content to the social editor for distribution
 *
 * The coordinator runs as part of the PULSE scheduler.
 */
import { db } from '../../../db/postgres'
import { getActiveAgents, getAgentsByRole } from './registry'
import { runBeatAgent } from './beat-agent'
import { runFactCheck } from './fact-checker'
import type { AgentConfig, AgentScanResult, IdentifiedTrend } from './types'
import { EDITORIAL_SYSTEM_PROMPT } from '../constants'
import { generateContent } from '../publisher'
import { publishAnalysis, getTopSignals } from '../publisher'

/**
 * Run a full agent beat scan.
 * Called every 2 hours by the scheduler.
 *
 * Flow:
 * 1. Each beat agent scans their domain for trends
 * 2. Fact-checker reviews any low-confidence high-severity signals
 * 3. Coordinator identifies cross-beat connections
 * 4. Best trends get published
 */
export async function runAgentBeatScan(): Promise<AgentScanResult[]> {
  const agents = getActiveAgents()
  const results: AgentScanResult[] = []

  // Phase 1: Run beat reporters and regional desks in parallel
  const beatAgents = agents.filter(a =>
    a.role === 'beat-reporter' || a.role === 'regional-desk'
  )

  const beatResults = await Promise.allSettled(
    beatAgents.map(agent => runBeatAgent(agent))
  )

  for (let i = 0; i < beatAgents.length; i++) {
    const result = beatResults[i]
    if (result.status === 'fulfilled') {
      results.push(result.value)
    } else {
      results.push({
        agentId: beatAgents[i].id,
        agentName: beatAgents[i].name,
        signalsReviewed: 0,
        trendsIdentified: 0,
        published: false,
        error: result.reason?.message ?? 'Unknown error',
      })
    }
  }

  // Phase 2: Run fact-checker on low-confidence signals
  const factCheckers = getAgentsByRole('fact-checker')
  for (const checker of factCheckers) {
    try {
      const fcResult = await runFactCheck(checker)
      results.push(fcResult)
    } catch (err) {
      results.push({
        agentId: checker.id,
        agentName: checker.name,
        signalsReviewed: 0,
        trendsIdentified: 0,
        published: false,
        error: err instanceof Error ? err.message : 'Fact-check failed',
      })
    }
  }

  // Phase 3: Cross-beat trend detection
  // Look for signals that span multiple beats — these are the most valuable
  try {
    await detectCrossBeatTrends()
  } catch (err) {
    console.error('[PULSE Coordinator] Cross-beat detection failed:', err)
  }

  return results
}

/**
 * Detect trends that span multiple beats.
 * E.g., a cyber attack on financial infrastructure touches both cyber and finance beats.
 */
async function detectCrossBeatTrends(): Promise<void> {
  const signals = await getTopSignals(6, 40) // last 6 hours

  if (signals.length < 5) return // not enough data

  // Group signals by category
  const byCategory = new Map<string, typeof signals>()
  for (const sig of signals) {
    const cat = sig.category
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat)!.push(sig)
  }

  // Find categories with high-severity clusters
  const hotCategories: string[] = []
  for (const [cat, sigs] of byCategory) {
    const criticalCount = sigs.filter(s => s.severity === 'critical' || s.severity === 'high').length
    if (criticalCount >= 2) hotCategories.push(cat)
  }

  // If 3+ categories are hot, there might be a cross-cutting event
  if (hotCategories.length >= 3) {
    const crossSignals = signals.filter(s => hotCategories.includes(s.category)).slice(0, 10)

    // Check if we've already published a cross-beat analysis recently
    const recentCross = await db('pulse_publish_log')
      .where('content_type', 'analysis')
      .where('published_at', '>', new Date(Date.now() - 6 * 3600_000))
      .whereRaw("metadata->>'crossBeat' = 'true'")
      .first()

    if (!recentCross && crossSignals.length >= 3) {
      const topic = `Cross-Domain Alert: ${hotCategories.join(', ')} convergence`
      await publishAnalysis(crossSignals, topic)
      console.log(`[PULSE Coordinator] Published cross-beat analysis: ${topic}`)
    }
  }
}

/**
 * Get a status overview of all agents.
 * Used by the /api/v1/pulse/agents endpoint.
 */
export async function getAgentStatus(): Promise<{
  totalAgents: number
  activeAgents: number
  agents: Array<{
    id: string
    name: string
    role: string
    beat: string
    llmTier: string
    enabled: boolean
    lastPublished?: string
  }>
}> {
  const agents = getActiveAgents()

  // Get last publish time for each agent (from metadata)
  const agentStatus = await Promise.all(agents.map(async (agent) => {
    const lastPost = await db('pulse_publish_log')
      .whereRaw("metadata->>'agentId' = ?", [agent.id])
      .orderBy('published_at', 'desc')
      .first()

    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      beat: agent.beat,
      llmTier: agent.llmTier,
      enabled: agent.enabled,
      lastPublished: lastPost?.published_at ?? null,
    }
  }))

  return {
    totalAgents: agents.length + getAgentsByRole('social-editor').length,
    activeAgents: agents.length,
    agents: agentStatus,
  }
}
