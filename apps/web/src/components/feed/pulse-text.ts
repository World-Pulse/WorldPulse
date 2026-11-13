/**
 * The AI Bureau's pieces, as a reader should meet them in the feed (Nov 12, 2026).
 *
 * Devon, reviewing the home page: "Shortening the AI posts ... Make it feel less ai". They arrived as the
 * model wrote them: "[FLASH BRIEF]", a byline line, "---", "SECTION 1: CLAIM VERIFICATION", scores such
 * as "(high confidence, 0.897 reliability)", a stray heading at the end. The feed now shows a piece's
 * first two sentences in plain text, with the rest one tap away; the card's badge says it is AI-written.
 *
 * Pure: what the text becomes, kept apart from the drawing so it can be tested.
 */

/** The pieces' own filing labels, which say nothing to a reader as tag chips */
export const PULSE_MACHINE_TAGS: ReadonlySet<string> = new Set(['pulse', 'flash-brief', 'flash_brief', 'analysis', 'fact-check', 'fact_check', 'daily-briefing', 'daily_briefing', 'mid-day-update', 'evening-wrap', 'weekly-report'])

const TAG = /^\s*\[(?:FLASH BRIEF|DAILY BRIEFING|ANALYSIS|MID-DAY UPDATE|EVENING WRAP|FACT CHECK|WEEKLY REPORT)\][^\n]*\n*/i

/** Whether a feed item is one of the AI Bureau's pieces (its account, the digest tab's kind, or the tag it opens with) */
export function isPulsePiece(handle: string | undefined, type: string | undefined, content: string | undefined): boolean {
  return type === 'ai_digest' || (handle ?? '').replace(/^@/, '').toLowerCase() === 'pulse' || TAG.test(content ?? '')
}

const DIGEST_ONLY_TAG = /^\s*\[(?:ANALYSIS|FACT CHECK)\]/i

/**
 * An analysis or a fact-check: a long read about several stories, which belongs on the AI Digest tab and not
 * among the day's stories (Devon, Nov 13, 2026: "Ok go"). Flash briefs and the day's briefings stay in the feed.
 */
export function isDigestOnlyPiece(handle: string | undefined, content: string | undefined, tags?: readonly unknown[]): boolean {
  if ((handle ?? '').replace(/^@/, '').toLowerCase() !== 'pulse') return false
  return DIGEST_ONLY_TAG.test(content ?? '') || (tags ?? []).some(t => /^(?:analysis|fact[-_]check)$/i.test(String(t)))
}

/** "(high confidence, 0.98 reliability)" and "(0.876)" go; "(3 outlets, 0.876)" keeps its outlets */
function withoutScores(text: string): string {
  return text.replace(/\s*\(([^()]{0,80})\)/g, (whole, inner: string) => {
    if (!/\b0\.\d{2,3}\b|\bconfidence\b/i.test(inner)) return whole
    const kept = inner
      .split(',')
      .map(part => part.trim())
      .filter(part => part && !/^(?:(?:very )?(?:high|moderate|medium|low) confidence|0\.\d{2,3}(?: reliability)?|reliability 0\.\d{2,3})$/i.test(part))
    return kept.length ? ` (${kept.join(', ')})` : ''
  })
}

const isRule = (line: string) => /^\s*(?:-{3,}|={3,}|\*{3,}|_{3,})\s*$/.test(line)
const isByline = (line: string) => /^\s*(?:[—–-]{1,2}\s*)?PULSE\s*[·•|-]\s*WorldPulse AI\b[^\n]*$/i.test(line) && line.trim().length < 80
/** A short line with no sentence in it: "Context", "CONTEST", "Claim verification" */
const isHeading = (line: string) => {
  const t = line.trim()
  return t.length > 0 && t.length <= 60 && !/[.!?:;,]/.test(t.replace(/:$/, '')) && t.split(/\s+/).length <= 6 && !/^\d/.test(t) && !/^[-•]/.test(t)
}
const sentenceCase = (t: string) => (/[a-z]/.test(t) ? t : t.charAt(0) + t.slice(1).toLowerCase())

/** The whole piece in plain text: no tags, bylines, rules or scores, headings in ordinary case */
export function plainPulseText(raw: string): string {
  let text = String(raw ?? '').replace(/\r\n?/g, '\n').replace(/\*\*(.*?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '')
  text = text.replace(TAG, '')
  // "PULSE · WorldPulse AI Bureau — Flash: Gaza. Wednesday night's strike ..." opens with the byline and a place tag
  text = text.replace(/(^|\n)\s*PULSE\s*[·•|-]\s*WorldPulse AI[^\n—–]{0,40}[—–]\s*/gi, '$1')
  text = text.replace(/(^|\n)\s*Flash:\s*[^.\n]{1,40}\.\s*/gi, '$1')
  const lines: string[] = []
  for (const line of text.split('\n')) {
    if (isRule(line) || isByline(line)) continue
    let l = line.replace(/^\s*SECTION\s+\d+\s*[:.-]\s*/i, '').replace(/^\s*Signal\s+(\d+)\s*:\s*/i, '$1. ')
    // "...: UNVERIFIED" at a line's end reads as a shout; the word stays, in ordinary case
    l = l.replace(/:\s*(UNVERIFIED|VERIFIED|CONTESTED|DISPUTED|CONFIRMED|FALSE|TRUE|MISLEADING)\s*$/, (_m, w: string) => `: ${w.toLowerCase()}`)
    if (isHeading(l)) l = sentenceCase(l.trim())
    lines.push(l)
  }
  // a heading with nothing under it (the piece was cut off: "CONTEST") says nothing
  while (lines.length && (lines[lines.length - 1].trim() === '' || isHeading(lines[lines.length - 1]))) lines.pop()
  return withoutScores(lines.join('\n')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' ').trim()
}

export interface PulsePiece { preview: string; full: string; more: boolean }

/** What the feed shows first (two sentences, about 280 characters at most) and the whole piece behind "Read more" */
export function plainPulse(raw: string, maxChars = 280): PulsePiece {
  const full = plainPulseText(raw)
  // the first paragraph that is prose (it ends as a sentence does), not a heading or a title line
  const paragraphs = full.split(/\n+/).map(p => p.trim()).filter(Boolean)
  const first = paragraphs.find(p => !isHeading(p) && /[.!?]["'”’)\]]?$/.test(p)) ?? paragraphs.find(p => !isHeading(p)) ?? paragraphs[0] ?? ''
  const sentences = first.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.map(s => s.trim()).filter(Boolean) ?? [first]
  let preview = sentences.slice(0, 2).join(' ')
  if (preview.length > maxChars) {
    const one = sentences[0] ?? preview
    preview = one.length <= maxChars ? one : one.slice(0, maxChars).replace(/\s+\S*$/, '').replace(/[,;:]$/, '') + '…'
  }
  return { preview, full, more: full.length > preview.length + 12 }
}
