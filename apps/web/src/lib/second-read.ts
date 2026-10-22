/**
 * The second read (plan 11; Devon, Oct 21, 2026: "Yes, with Claude Haiku"):
 * for a high or critical report few outlets carry, Claude's own read of how
 * serious it is, beside the word rules' (the scraper's
 * pipeline/second-read.ts). What the story page's badge says. Since plan 11a
 * (Oct 22, 2026) a second read that rates a report lower, or reads it as no
 * new event, lowers it one level: the badge says from what.
 */

export interface SecondReadInfo {
  verdict: 'agree' | 'lower' | 'higher' | 'not_event'
  /** "Agrees: HIGH, a new event. …", "Rates it MEDIUM, not HIGH. … Lowered from HIGH to MEDIUM.", "Reads as analysis, not a new event. …" */
  note: string
  at: string | null
  /** The second read lowered the report's severity (plan 11a) */
  lowered?: boolean
}

export interface SecondReadBadge {
  label: string
  /** agree: the two reads match; differ: the second read rates it otherwise */
  tone: 'agree' | 'differ'
  /** The whole note, for the badge's tooltip */
  title: string
}

const SEVERITIES = ['critical', 'high', 'medium', 'low']

export function secondReadBadge(read: SecondReadInfo | null | undefined): SecondReadBadge | null {
  if (!read || typeof read.note !== 'string') return null
  const title = `Second read by an AI model: ${read.note}`.trim()
  if (read.verdict === 'agree') return { label: 'Second read agrees', tone: 'agree', title }
  if (read.lowered && (read.verdict === 'lower' || read.verdict === 'not_event')) {
    // the report's own severity is now the lowered one: the badge says what it was
    const was = /Lowered from (\w+)/i.exec(read.note)?.[1]?.toLowerCase()
    return { label: was && SEVERITIES.includes(was) ? `Lowered from ${was} by a second read` : 'Lowered by a second read', tone: 'differ', title }
  }
  if (read.verdict === 'not_event') {
    const kind = /Reads as (analysis|a roundup|not news of an event)/i.exec(read.note)?.[1]?.toLowerCase()
    return { label: kind === 'analysis' ? 'Second read: analysis' : kind === 'a roundup' ? 'Second read: a roundup' : 'Second read: not a new event', tone: 'differ', title }
  }
  if (read.verdict === 'lower' || read.verdict === 'higher') {
    const level = /Rates it (\w+)/i.exec(read.note)?.[1]?.toLowerCase()
    return { label: level && SEVERITIES.includes(level) ? `Second read: ${level}` : (read.verdict === 'lower' ? 'Second read: less serious' : 'Second read: more serious'), tone: 'differ', title }
  }
  return null
}
