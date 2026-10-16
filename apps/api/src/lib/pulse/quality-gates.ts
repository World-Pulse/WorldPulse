/**
 * Editorial quality gates for PULSE posts (standards: .hq/departments/editorial/standards.md,
 * sections 3 and 6; handoff H-0003). They only refuse: a post that fails is never rewritten,
 * and the next cycle tries again.
 */

/** Section 3: filler the AI Digest never publishes (matched case-insensitively) */
export const BANNED_PHRASES: readonly string[] = [
  'in a developing story', 'it is worth noting', "it's worth noting", 'amid growing concerns',
  "in today's fast-moving world", 'as the situation continues to evolve',
  'only time will tell', 'remains to be seen', 'the world is watching', 'stay tuned',
  'reportedly', 'allegedly', 'it appears',
  'shocking', 'stunning', 'unprecedented',
  'could spark', 'may lead to a wider war',
]

/** Words and shapes an AI leaves behind */
const LEFTOVERS = [
  /\bas an ai\b/i, /\bi cannot\b/i, /\bhere is your\b/i, /\bcertainly[!,.]/i,
  /\[[^\]\n]*\]/, // [LOCATION], [...] — an unfilled placeholder
  /\bn\/a\b/i,
]

export const FLASH_MAX_CHARS = 400
export const FLASH_MAX_SENTENCES = 3

/** The first reason a post must be refused, or null when it passes the checks common to every post */
export function bodyProblem(text: string): string | null {
  const lower = text.toLowerCase()
  const phrase = BANNED_PHRASES.find(p => lower.includes(p))
  if (phrase) return `banned filler "${phrase}"`
  if (text.includes('!')) return 'exclamation mark'
  if (LEFTOVERS.some(re => re.test(text))) return 'placeholder or AI leftover'
  return null
}

/** How many sentences a text has (a full stop, ! or ? followed by a space or the end; "0.7" and "U.S." don't count) */
export function sentenceCount(text: string): number {
  return (text.trim().match(/[.!?]+(?=\s+[A-Z"'(]|\s*$)/g) ?? []).filter(Boolean).length
}

/** Says how sure we are: "3 sources", "two outlets", or a named kind of source */
const SOURCE_LINE = /(\b\d+|\b(?:one|two|three|four|five|six|seven|eight|nine|ten))\s+(?:\w+\s+){0,2}(?:sources?|outlets?)\b|\b(?:wire|institutional|osint|agency|agencies)\b/i

/** The first reason a flash brief must be refused, or null */
export function flashBriefProblem(text: string): string | null {
  const body = bodyProblem(text)
  if (body) return body
  if (text.length > FLASH_MAX_CHARS) return `over ${FLASH_MAX_CHARS} characters`
  if (sentenceCount(text) > FLASH_MAX_SENTENCES) return `more than ${FLASH_MAX_SENTENCES} sentences`
  if (/^#{1,6}\s/m.test(text)) return 'markdown heading in a flash brief'
  if (!SOURCE_LINE.test(text)) return 'no source line (outlet count or kind of source)'
  return null
}
