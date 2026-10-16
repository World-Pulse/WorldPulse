/**
 * PULSE Scheduler — runs periodic editorial tasks.
 *
 * Schedule (all times UTC, ET equivalents in parentheses):
 *   Every 5 min  — Flash brief check (auto-publish critical signals)
 *   11:00 UTC    — Morning briefing (7am ET; caught up until 15:59 UTC if missed)
 *   17:00 UTC    — Mid-day update  (1pm ET; until 19:59 UTC)
 *   23:00 UTC    — Evening wrap     (7pm ET; until 23:59 UTC)
 *   Every 2 hrs  — Agent beat scan (agents identify trends in their domains)
 *
 * Gated by PULSE_ENABLED env var.
 */
import { checkAndPublishFlashBriefs, publishDailyBriefing, publishBriefingUpdate, type BriefingSlot } from './publisher'
import { runAgentBeatScan } from './agents/coordinator'
import { runTwitterPublisher } from './agents/twitter-publisher'
import { getAgent } from './agents/registry'
import { loadEngine } from '../engine-loader'

let flashTimer: ReturnType<typeof setInterval> | null = null
let briefingTimer: ReturnType<typeof setInterval> | null = null
let agentTimer: ReturnType<typeof setInterval> | null = null
let twitterTimer: ReturnType<typeof setInterval> | null = null
let isRunning = false

const FLASH_INTERVAL_MS   = 5 * 60 * 1000   // 5 minutes
const BRIEFING_CHECK_MS   = 60 * 1000        // check every minute
const AGENT_SCAN_MS       = 2 * 60 * 60_000  // 2 hours
const TWITTER_INTERVAL_MS = 15 * 60 * 1000   // 15 minutes — check for new content to tweet

// UTC hours for briefing schedule (EDT: subtract 4)
const MORNING_HOUR_UTC = 11   // 7am ET
const MIDDAY_HOUR_UTC  = 17   // 1pm ET
const EVENING_HOUR_UTC = 23   // 7pm ET

// Track what we've published today to avoid duplicates
const publishedToday = new Map<string, string>() // key → date string

function todayKey(prefix: string): string {
  return `${prefix}:${new Date().toISOString().slice(0, 10)}`
}

function alreadyPublished(key: string): boolean {
  const today = new Date().toISOString().slice(0, 10)
  return publishedToday.get(key) === today
}

function markPublished(key: string): void {
  const today = new Date().toISOString().slice(0, 10)
  publishedToday.set(key, today)

  // Clean old entries (keep only today's)
  for (const [k, v] of publishedToday) {
    if (v !== today) publishedToday.delete(k)
  }
}

function isPulseEnabled(): boolean {
  return process.env.PULSE_ENABLED === 'true' || process.env.PULSE_ENABLED === '1'
}

/**
 * Each briefing is written once a day within its window (UTC hours,
 * inclusive): it starts at the window's first hour, and a start that was
 * missed (the API down or restarting at 7 AM ET, Oct 12, 2026) is caught up
 * later in the window. A failed attempt is retried after 15 minutes, not
 * every minute. "Already out today" (the database says so, which survives
 * restarts) ends the day's tries.
 */
export const BRIEFING_SLOTS: ReadonlyArray<{ slot: BriefingSlot; from: number; to: number }> = [
  { slot: 'morning', from: MORNING_HOUR_UTC, to: MORNING_HOUR_UTC + 4 },   // 7–11 AM ET (EDT)
  { slot: 'midday',  from: MIDDAY_HOUR_UTC,  to: MIDDAY_HOUR_UTC + 2 },    // 1–3 PM ET
  { slot: 'evening', from: EVENING_HOUR_UTC, to: EVENING_HOUR_UTC },       // 7–8 PM ET
]
const BRIEFING_RETRY_MS = 15 * 60_000
const briefingRetryAt = new Map<BriefingSlot, number>()

function publishSlot(slot: BriefingSlot) {
  return slot === 'morning' ? publishDailyBriefing() : publishBriefingUpdate(slot)
}

/** One pass of the briefing schedule (every minute; exported for tests) */
export async function checkBriefings(now: Date = new Date()): Promise<void> {
  const hour = now.getUTCHours()
  for (const { slot, from, to } of BRIEFING_SLOTS) {
    if (hour < from || hour > to) continue
    if (alreadyPublished(slot) || (briefingRetryAt.get(slot) ?? 0) > now.getTime()) continue
    markPublished(slot)
    try {
      console.log(`[PULSE] Publishing the ${slot} briefing...`)
      const result = await publishSlot(slot)
      if (result.success) {
        console.log(`[PULSE] ${slot} briefing published: ${result.postId}`)
      } else if (result.alreadyPublished) {
        console.log(`[PULSE] ${result.error}`)   // done for today
      } else {
        console.error(`[PULSE] ${slot} briefing failed: ${result.error}; trying again in 15 minutes`)
        publishedToday.delete(slot)
        briefingRetryAt.set(slot, now.getTime() + BRIEFING_RETRY_MS)
      }
    } catch (err) {
      console.error(`[PULSE] ${slot} briefing error; trying again in 15 minutes:`, err)
      publishedToday.delete(slot)
      briefingRetryAt.set(slot, now.getTime() + BRIEFING_RETRY_MS)
    }
  }
}

/** For tests: forget today's attempts */
export function resetBriefingState(): void {
  publishedToday.clear()
  briefingRetryAt.clear()
}

/** Start the PULSE scheduler */
export function startPulseScheduler(): void {
  if (isRunning) return
  if (!isPulseEnabled()) {
    console.log('[PULSE] Scheduler disabled (set PULSE_ENABLED=true to enable)')
    return
  }

  isRunning = true
  console.log('[PULSE] Scheduler started — flash briefs (5m), briefings (7am/1pm/7pm ET), agent scans (2h), twitter (15m)')

  // ── Flash brief checker ────────────────────────────────────────────────
  flashTimer = setInterval(async () => {
    try {
      const count = await checkAndPublishFlashBriefs()
      if (count > 0) {
        console.log(`[PULSE] Published ${count} flash brief(s)`)
      }
    } catch (err) {
      console.error('[PULSE] Flash brief check failed:', err)
    }
  }, FLASH_INTERVAL_MS)

  // ── Briefing schedule checker ──────────────────────────────────────────
  // The morning briefing email is sent by lib/briefing-email.ts (plan G4),
  // whether or not PULSE is on.
  briefingTimer = setInterval(() => { void checkBriefings() }, BRIEFING_CHECK_MS)

  // ── Agent beat scan ────────────────────────────────────────────────────
  // Every 2 hours, agents scan their beats for trends worth covering.
  agentTimer = setInterval(async () => {
    try {
      const results = await runAgentBeatScan()
      const published = results.filter(r => r.published).length
      if (published > 0) {
        console.log(`[PULSE] Agent scan: ${published} posts published from ${results.length} agents`)
      }
    } catch (err) {
      console.error('[PULSE] Agent beat scan failed:', err)
    }
  }, AGENT_SCAN_MS)

  // ── Twitter auto-publisher ────────────────────────────────────────────
  // Every 15 minutes, check for new PULSE posts to tweet.
  // Gated by TWITTER_API_KEY — no-ops if not configured.
  twitterTimer = setInterval(async () => {
    if (!process.env.TWITTER_API_KEY) return // Skip if not configured

    const agent = getAgent('twitter-publisher')
    if (!agent || !agent.enabled) return

    try {
      const result = await runTwitterPublisher(agent)
      if (result.published) {
        console.log(`[PULSE] Twitter: posted for ${result.postId}`)
      }
    } catch (err) {
      console.error('[PULSE] Twitter publisher failed:', err)
    }
  }, TWITTER_INTERVAL_MS)

  // ── The hosted build's engine: its own scheduled jobs (lib/engine-loader.ts;
  //    none in the open-source edition)
  void loadEngine().then(engine => engine?.startJobs())
}

/** Stop the PULSE scheduler */
export function stopPulseScheduler(): void {
  if (flashTimer)    { clearInterval(flashTimer);    flashTimer = null }
  if (briefingTimer) { clearInterval(briefingTimer); briefingTimer = null }
  if (agentTimer)    { clearInterval(agentTimer);    agentTimer = null }
  if (twitterTimer)  { clearInterval(twitterTimer);  twitterTimer = null }
  void loadEngine().then(engine => engine?.stopJobs())
  isRunning = false
  console.log('[PULSE] Scheduler stopped')
}
