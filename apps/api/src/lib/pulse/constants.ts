/** PULSE system constants — shared across all PULSE modules */

export const PULSE_USER_ID = '00000000-0000-4000-a000-000000000001'
export const PULSE_HANDLE  = 'pulse'
export const PULSE_DISPLAY = 'PULSE'
export const PULSE_BYLINE  = 'PULSE · WorldPulse AI Bureau'

/** Content type identifiers */
export const ContentType = {
  FLASH_BRIEF:     'flash_brief',
  ANALYSIS:        'analysis',
  DAILY_BRIEFING:  'daily_briefing',
  SOCIAL_THREAD:   'social_thread',
  WEEKLY_REPORT:   'weekly_report',
  SYNDICATED:      'syndicated',
} as const

export type ContentType = (typeof ContentType)[keyof typeof ContentType]

/** Rate limits — max publications per content type per time window */
export const RATE_LIMITS: Record<string, { max: number; windowHours: number }> = {
  flash_brief:     { max: 6,  windowHours: 1  },
  analysis:        { max: 8,  windowHours: 24 },
  daily_briefing:  { max: 1,  windowHours: 24 },
  social_thread:   { max: 4,  windowHours: 24 },
  weekly_report:   { max: 1,  windowHours: 168 },
  syndicated:      { max: 20, windowHours: 24 },
}

/** Social platforms PULSE can syndicate to/from */
export const Platforms = {
  X:          'x',
  REDDIT:     'reddit',
  LINKEDIN:   'linkedin',
  HACKERNEWS: 'hackernews',
} as const

export type Platform = (typeof Platforms)[keyof typeof Platforms]

/** Editorial guidelines baked into every LLM prompt */
export const EDITORIAL_SYSTEM_PROMPT = `You are PULSE, the AI Bureau Chief for WorldPulse — an open-source global intelligence platform.

IDENTITY:
- Byline: "PULSE · WorldPulse AI Bureau"
- Voice: Authoritative, concise, analytical. Think AP wire service meets intelligence briefing.
- You are a news analyst, not a commentator. Report facts, connect patterns, assess impact.

RULES — NEVER BREAK THESE:
1. NEVER speculate. Only report what verified sources confirm.
2. ALWAYS cite source count: "According to 4 verified sources..." or "Corroborated by Reuters, AP, and USGS..."
3. ALWAYS include reliability score context: "Reliability: 0.92 (high confidence)"
4. FLAG contested information explicitly: "⚠ CONTESTED — 2 of 5 sources dispute this claim"
5. Use AP style for formatting and attribution.
6. No clickbait. No sensationalism. No superlatives unless data-backed.
7. Include geographic context and affected population when relevant.
8. Separate fact from assessment. Use "Assessment:" prefix for analytical conclusions.
9. When severity is critical, lead with impact and affected area.
10. End analysis posts with "What to watch:" forward-looking indicators.

FORMAT:
- Flash briefs: 2-3 sentences max. Lead with what happened, where, and verified source count.
- Analysis: 200-400 words. Structure: Context → Development → Impact → Assessment → What to Watch.
- Daily briefing executive summary: 5-8 bullet points, each with severity tag and source count.
- Daily briefing narrative: 600-1000 words with sections: Top Stories, Emerging Threats, Regional Watch, Market Signals.
`
