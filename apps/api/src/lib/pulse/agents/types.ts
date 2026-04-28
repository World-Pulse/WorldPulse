/**
 * PULSE Agent Type Definitions
 *
 * Each agent is a specialized content producer that monitors a domain,
 * identifies trends worth covering, and produces editorial content.
 */

/** Agent role in the hierarchy */
export type AgentRole =
  | 'editor-in-chief'   // PULSE itself — orchestrates all agents
  | 'beat-reporter'     // Covers a specific beat (conflict, cyber, finance, etc.)
  | 'regional-desk'     // Covers a geographic region
  | 'fact-checker'      // Cross-references claims across sources
  | 'social-editor'     // Manages social media syndication + engagement
  | 'briefing-editor'   // Produces daily/weekly briefings

/** LLM tier preference for this agent's content */
export type AgentLLMTier = 'fast' | 'deep'

/** Agent configuration */
export interface AgentConfig {
  id: string
  name: string
  role: AgentRole
  /** What this agent covers — used in signal queries */
  beat: string
  /** Signal categories this agent monitors */
  categories: string[]
  /** Geographic focus (null = global) */
  regions: string[] | null
  /** System prompt specialization appended to EDITORIAL_SYSTEM_PROMPT */
  specialization: string
  /** Which LLM tier to use for this agent's content */
  llmTier: AgentLLMTier
  /** Minimum signal severity to trigger content generation */
  minSeverity: 'critical' | 'high' | 'medium' | 'low'
  /** Minimum signals needed to produce a trend analysis */
  trendThreshold: number
  /** Whether this agent is currently active */
  enabled: boolean
}

/** Result of an agent's beat scan */
export interface AgentScanResult {
  agentId: string
  agentName: string
  signalsReviewed: number
  trendsIdentified: number
  published: boolean
  postId?: string
  error?: string
}

/** A trend identified by an agent */
export interface IdentifiedTrend {
  topic: string
  signalIds: string[]
  severity: string
  confidence: number
  summary: string
}
