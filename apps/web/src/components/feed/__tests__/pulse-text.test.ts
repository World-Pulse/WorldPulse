/**
 * The AI Bureau's pieces in the feed (Nov 12, 2026): short, plain, no machine marks.
 */
import { describe, it, expect } from 'vitest'
import { isDigestOnlyPiece, isPulsePiece, plainPulse, plainPulseText } from '../pulse-text'

// As they stood on the home page on Nov 12, 2026
const FLASH = `[FLASH BRIEF]

PULSE · WorldPulse AI Bureau — Flash: Gaza. Wednesday night's strike hit Nasser Hospital, Khan Younis's largest functioning medical facility, per 25 verified outlets (high confidence, 0.98 reliability). Assessment: Damage to one of the last major surgical centers in southern Gaza further strains an already collapsed health system; watch for WHO and OCHA access statements and casualty updates.

— PULSE · WorldPulse AI Bureau`

const ANALYSIS = `[ANALYSIS] Cross-Domain Alert: conflict, disaster, health, security convergence

PULSE · WorldPulse AI Bureau

Cross-Domain Alert: Conflict, Disaster, Health and Security Signals Converge

Context

Ten signals spanning four domains registered within the same collection window, nine rated HIGH and one CRITICAL.

Development

Conflict and security: Israel struck a hospital in southern Gaza, killing at least 6 people, according to 3 verified outlets (high confidence, 0.897 reliability). A Russian colonel died in a car bomb attack in St. Petersburg, verified by 6 outlets (0.957).

Disaster and accidents: Separate road incidents killed 14 in the UAE (2 outlets, 0.830), 9 in Gilgit-Baltistan (3 outlets, 0.876).

CONTEST

— PULSE · WorldPulse AI Bureau`

const FACT = `[FACT CHECK]

PULSE · WorldPulse AI Bureau, Fact-Check Bureau

---

SECTION 1: CLAIM VERIFICATION

Signal 1: LXJ265 squawking 7500 (United States): UNVERIFIED
- Evidence supporting: A single ADS-B telemetry record from OpenSky Network shows squawk 7500 at 36.5528°N.
- Missing corroboration: FAA or airline confirmation.`

describe('isPulsePiece', () => {
  it('knows the AI Bureau by its account, its kind or its opening tag', () => {
    expect(isPulsePiece('@pulse', 'post', 'anything')).toBe(true)
    expect(isPulsePiece('@someone', 'ai_digest', '')).toBe(true)
    expect(isPulsePiece('@someone', 'post', '[FACT CHECK]\n\ntext')).toBe(true)
    expect(isPulsePiece('@worldpulse_ai', 'signal', 'Sheep price records continue to tumble')).toBe(false)
    expect(isPulsePiece(undefined, undefined, undefined)).toBe(false)
  })
})

describe('isDigestOnlyPiece', () => {
  it('is an analysis or a fact-check by the AI Bureau', () => {
    expect(isDigestOnlyPiece('@pulse', '[FACT CHECK]\n\n# PULSE FACT-CHECK BUREAU: SIGNAL REVIEW', ['pulse', 'fact-check', 'verification'])).toBe(true)
    expect(isDigestOnlyPiece('pulse', '[ANALYSIS] Cross-border strikes this week', ['pulse'])).toBe(true)
    expect(isDigestOnlyPiece('@pulse', 'A piece with no opening tag', ['pulse', 'analysis'])).toBe(true)
  })
  it('leaves flash briefs, briefings and outlets\' stories in the feed', () => {
    expect(isDigestOnlyPiece('@pulse', '[FLASH BRIEF]\n\nGunmen killed at least 37 civilians in western Niger', ['pulse', 'flash-brief'])).toBe(false)
    expect(isDigestOnlyPiece('@pulse', '[DAILY BRIEFING]\n\nThe day so far', ['pulse', 'daily-briefing'])).toBe(false)
    expect(isDigestOnlyPiece('@worldpulse_ai', 'Analysis: what the rate cut means', ['analysis'])).toBe(false)
    expect(isDigestOnlyPiece(undefined, undefined, undefined)).toBe(false)
  })
})

describe('plainPulseText', () => {
  it('drops the tag, the bylines, the place tag and the scores from a flash brief', () => {
    const t = plainPulseText(FLASH)
    expect(t.startsWith("Wednesday night's strike hit Nasser Hospital")).toBe(true)
    expect(t).toContain('per 25 verified outlets. Assessment:')
    for (const gone of ['[FLASH BRIEF]', 'PULSE', 'AI Bureau', 'Flash:', '0.98', 'confidence']) expect(t).not.toContain(gone)
  })
  it('keeps the outlets and drops the decimals in an analysis, and the heading left hanging at its end', () => {
    const t = plainPulseText(ANALYSIS)
    expect(t).toContain('according to 3 verified outlets. A Russian colonel')
    expect(t).toContain('verified by 6 outlets.')
    expect(t).toContain('14 in the UAE (2 outlets), 9 in Gilgit-Baltistan (3 outlets).')
    expect(t).not.toMatch(/0\.\d{3}/)
    expect(t).not.toContain('CONTEST')
    expect(t).not.toContain('PULSE')
    expect(t.endsWith('(3 outlets).')).toBe(true)
  })
  it('turns a fact check’s section marks and shouting into ordinary text', () => {
    const t = plainPulseText(FACT)
    expect(t.startsWith('Claim verification')).toBe(true)
    expect(t).toContain('1. LXJ265 squawking 7500 (United States): unverified')
    expect(t).not.toContain('---')
    expect(t).not.toContain('SECTION')
    expect(t).toContain('- Evidence supporting: A single ADS-B telemetry record')
  })
  it('leaves ordinary brackets and numbers alone', () => {
    expect(plainPulseText('The toll rose to 66 (up from 41), officials said (Reuters).')).toBe('The toll rose to 66 (up from 41), officials said (Reuters).')
    expect(plainPulseText('Inflation was 0.3% in October (0.2% expected).')).toBe('Inflation was 0.3% in October (0.2% expected).')
    expect(plainPulseText('')).toBe('')
  })
})

describe('plainPulse', () => {
  it('shows a flash brief’s first two sentences and keeps the rest behind "Read more"', () => {
    const p = plainPulse(FLASH)
    expect(p.preview).toBe("Wednesday night's strike hit Nasser Hospital, Khan Younis's largest functioning medical facility, per 25 verified outlets.")
    expect(p.more).toBe(true)
    expect(p.full.length).toBeGreaterThan(p.preview.length)
  })
  it('starts an analysis at its first sentence, not at a heading', () => {
    const p = plainPulse(ANALYSIS)
    expect(p.preview.startsWith('Ten signals spanning four domains')).toBe(true)
    expect(p.preview.length).toBeLessThanOrEqual(280)
    expect(p.more).toBe(true)
  })
  it('never shows more than the limit, cut at a word', () => {
    const long = 'A'.repeat(20) + ' ' + 'word '.repeat(200) + 'end.'
    const p = plainPulse(long, 120)
    expect(p.preview.length).toBeLessThanOrEqual(121)
    expect(p.preview.endsWith('…')).toBe(true)
  })
  it('has no "Read more" when the piece is short', () => {
    const p = plainPulse('[FLASH BRIEF]\n\nPolls closed in Chile at 6 PM.')
    expect(p).toEqual({ preview: 'Polls closed in Chile at 6 PM.', full: 'Polls closed in Chile at 6 PM.', more: false })
  })
})
