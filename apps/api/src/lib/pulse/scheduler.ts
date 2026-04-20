/**
 * PULSE Scheduler — runs periodic editorial tasks.
 *
 * Schedule (all times UTC, ET equivalents in parentheses):
 *   Every 5 min  — Flash brief check (auto-publish critical signals)
 *   11:00 UTC    — Morning briefing (7am ET)
 *   17:00 UTC    — Mid-day update  (1pm ET)
 *   23:00 UTC    — Evening wrap     (7pm ET)
 *   Every 2 hrs  — Agent beat scan (agents identify trends in their domains)
 *
 * Gated by PULSE_ENABLED env var.
 */
import { checkAndPublishFlashBriefs, publishDailyBriefing, publishBriefingUpdate } from './publisher'
import { runAgentBeatScan } from './agents/coordinator'

let flashTimer: ReturnType<typeof setInterval> | null = null
let briefingTimer: ReturnType<typeof setInterval> | null = null
let agentTimer: ReturnType<typeof setInterval> | null = null
let isRunning = false

const FLASH_INTERVAL_MS   = 5 * 60 * 1000   // 5 minutes
const BRIEFING_CHECK_MS   = 60 * 1000        // check every minute
const AGENT_SCAN_MS       = 2 * 60 * 60_000  // 2 hours

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

/** Start the PULSE scheduler */
export function startPulseScheduler(): void {
  if (isRunning) return
  if (!isPulseEnabled()) {
    console.log('[PULSE] Scheduler disabled (set PULSE_ENABLED=true to enable)')
    return
  }

  isRunning = true
  console.log('[PULSE] Scheduler started — flash briefs (5m), briefings (7am/1pm/7pm ET), agent scans (2h)')

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
  briefingTimer = setInterval(async () => {
    const hour = new Date().getUTCHours()

    // Morning briefing — full daily briefing via Anthropic (deep)
    if (hour === MORNING_HOUR_UTC && !alreadyPublished('morning')) {
      markPublished('morning')
      try {
        console.log('[PULSE] Publishing morning briefing (deep/Anthropic)...')
        const result = await publishDailyBriefing()
        if (result.success) {
          console.log(`[PULSE] Morning briefing published: ${result.postId}`)
        } else {
          console.error(`[PULSE] Morning briefing failed: ${result.error}`)
          publishedToday.delete('morning') // retry next minute
        }
      } catch (err) {
        console.error('[PULSE] Morning briefing error:', err)
        publishedToday.delete('morning')
      }
    }

    // Mid-day update — shorter, via OpenAI (fast)
    if (hour === MIDDAY_HOUR_UTC && !alreadyPublished('midday')) {
      markPublished('midday')
      try {
        console.log('[PULSE] Publishing mid-day update (fast/OpenAI)...')
        const result = await publishBriefingUpdate('midday')
        if (result.success) {
          console.log(`[PULSE] Mid-day update published: ${result.postId}`)
        } else {
          console.error(`[PULSE] Mid-day update failed: ${result.error}`)
          publishedToday.delete('midday')
        }
      } catch (err) {
        console.error('[PULSE] Mid-day update error:', err)
        publishedToday.delete('midday')
      }
    }

    // Evening wrap — shorter, via OpenAI (fast)
    if (hour === EVENING_HOUR_UTC && !alreadyPublished('evening')) {
      markPublished('evening')
      try {
        console.log('[PULSE] Publishing evening wrap (fast/OpenAI)...')
        const result = await publishBriefingUpdate('evening')
        if (result.success) {
          console.log(`[PULSE] Evening wrap published: ${result.postId}`)
        } else {
          console.error(`[PULSE] Evening wrap failed: ${result.error}`)
          publishedToday.delete('evening')
        }
      } catch (err) {
        console.error('[PULSE] Evening wrap error:', err)
        publishedToday.delete('evening')
      }
    }
  }, BRIEFING_CHECK_MS)

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
}

/** Stop the PULSE scheduler */
export function stopPulseScheduler(): void {
  if (flashTimer)    { clearInterval(flashTimer);    flashTimer = null }
  if (briefingTimer) { clearInterval(briefingTimer); briefingTimer = null }
  if (agentTimer)    { clearInterval(agentTimer);    agentTimer = null }
  isRunning = false
  console.log('[PULSE] Scheduler stopped')
}
