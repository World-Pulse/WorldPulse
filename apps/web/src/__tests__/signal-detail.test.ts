/**
 * signal-detail.test.ts
 *
 * Unit tests for the pure helper functions used in the signal detail page:
 * - VerificationBadge helpers (buildVerificationSummary, getVerificationScore, etc.)
 * - RichMediaEmbed URL extractors (extractYouTubeId, extractVimeoId, detectEmbedType)
 */

import { describe, it, expect } from 'vitest'

import {
  getVerificationScore,
  computeVerificationStatus,
  computeVerificationStatusFromLog,
  buildVerificationSummary,
  getVerificationBadgeConfig,
} from '../components/signals/VerificationBadge'

import {
  extractYouTubeId,
  extractVimeoId,
  detectEmbedType,
  extractFirstEmbedUrl,
} from '../components/RichMediaEmbed'

import {
  getResultColor,
  getCheckTypeIcon,
  RESULT_COLOR,
  CHECK_TYPE_ICON,
} from '../components/signals/VerificationTimeline'

// ─── VerificationBadge helpers ───────────────────────────────────────────────

describe('getVerificationScore', () => {
  it('returns 0 for empty entries', () => {
    expect(getVerificationScore([])).toBe(0)
  })

  it('returns 1 for all confirmed entries at full confidence', () => {
    const entries = [
      { check_type: 'source_check', result: 'confirmed', confidence: 1 },
      { check_type: 'ai_analysis',  result: 'confirmed', confidence: 1 },
    ]
    expect(getVerificationScore(entries)).toBe(1)
  })

  it('penalises refuted results', () => {
    const entries = [
      { check_type: 'source_check', result: 'confirmed', confidence: 1 },
      { check_type: 'ai_analysis',  result: 'refuted',   confidence: 1 },
    ]
    const score = getVerificationScore(entries)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThan(0.5)
  })

  it('clamps confidence to [0, 1]', () => {
    const entries = [
      { check_type: 'source_check', result: 'confirmed', confidence: 999 },
    ]
    expect(getVerificationScore(entries)).toBeLessThanOrEqual(1)
  })

  it('handles neutral results (warn/pending)', () => {
    const entries = [
      { check_type: 'ai_check', result: 'pending', confidence: 0.5 },
    ]
    const score = getVerificationScore(entries)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })
})

describe('computeVerificationStatus', () => {
  it('returns disputed for disputed signal', () => {
    expect(computeVerificationStatus('disputed', 0.9)).toBe('disputed')
  })

  it('returns disputed for false/retracted signals', () => {
    expect(computeVerificationStatus('false',     0.9)).toBe('disputed')
    expect(computeVerificationStatus('retracted', 0.9)).toBe('disputed')
  })

  it('returns verified when status=verified', () => {
    expect(computeVerificationStatus('verified', 0.9)).toBe('verified')
  })

  it('derives verified from high reliability score', () => {
    expect(computeVerificationStatus('pending', 0.8)).toBe('verified')
  })

  it('derives partial from mid reliability score', () => {
    expect(computeVerificationStatus('pending', 0.5)).toBe('partial')
  })

  it('returns unverified for low score', () => {
    expect(computeVerificationStatus('pending', 0.1)).toBe('unverified')
  })

  it('handles null/undefined inputs gracefully', () => {
    expect(computeVerificationStatus(null, null)).toBe('unverified')
    expect(computeVerificationStatus(undefined, undefined)).toBe('unverified')
  })
})

describe('computeVerificationStatusFromLog', () => {
  it('returns unverified for empty log', () => {
    expect(computeVerificationStatusFromLog([])).toBe('unverified')
  })

  it('returns disputed if any entry is refuted', () => {
    const entries = [
      { check_type: 'source_check', result: 'confirmed', confidence: 1 },
      { check_type: 'ai_check',     result: 'refuted',   confidence: 0.9 },
    ]
    expect(computeVerificationStatusFromLog(entries)).toBe('disputed')
  })

  it('returns verified for high-confidence confirmed entries', () => {
    const entries = [
      { check_type: 'source_check',   result: 'confirmed', confidence: 1.0 },
      { check_type: 'cross_reference', result: 'pass',     confidence: 0.9 },
      { check_type: 'ai_analysis',    result: 'verified',  confidence: 1.0 },
    ]
    expect(computeVerificationStatusFromLog(entries)).toBe('verified')
  })

  it('returns partial for moderate confidence', () => {
    const entries = [
      { check_type: 'source_check', result: 'confirmed', confidence: 0.5 },
    ]
    expect(computeVerificationStatusFromLog(entries)).toBe('partial')
  })
})

describe('buildVerificationSummary', () => {
  it('returns correct confirmed_checks count', () => {
    const entries = [
      { check_type: 'source_check',    result: 'confirmed', confidence: 1 },
      { check_type: 'ai_analysis',     result: 'refuted',   confidence: 0.9 },
      { check_type: 'cross_reference', result: 'pass',      confidence: 0.8 },
    ]
    const summary = buildVerificationSummary(entries)
    expect(summary.confirmed_checks).toBe(2)
    expect(summary.total_checks).toBe(3)
    expect(summary.has_disputed).toBe(true)
  })

  it('falls back to signal status when no entries', () => {
    const summary = buildVerificationSummary([], 'verified')
    expect(summary.status).toBe('verified')
    expect(summary.total_checks).toBe(0)
  })
})

describe('getVerificationBadgeConfig', () => {
  it('returns green config for verified', () => {
    const cfg = getVerificationBadgeConfig('verified')
    expect(cfg.label).toBe('VERIFIED')
    expect(cfg.color).toBe('#00e676')
  })

  it('returns red config for disputed', () => {
    const cfg = getVerificationBadgeConfig('disputed')
    expect(cfg.label).toBe('DISPUTED')
    expect(cfg.color).toBe('#ff3b5c')
  })

  it('returns amber config for partial', () => {
    const cfg = getVerificationBadgeConfig('partial')
    expect(cfg.label).toBe('PARTIAL')
    expect(cfg.color).toBe('#f5a623')
  })

  it('returns grey config for unverified', () => {
    const cfg = getVerificationBadgeConfig('unverified')
    expect(cfg.label).toBe('UNVERIFIED')
  })
})

// ─── RichMediaEmbed URL extractors ───────────────────────────────────────────

describe('extractYouTubeId', () => {
  it('extracts ID from standard watch URL', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
      .toBe('dQw4w9WgXcQ')
  })

  it('extracts ID from youtu.be short URL', () => {
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ'))
      .toBe('dQw4w9WgXcQ')
  })

  it('extracts ID from embed URL', () => {
    expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ'))
      .toBe('dQw4w9WgXcQ')
  })

  it('extracts ID from shorts URL', () => {
    expect(extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ'))
      .toBe('dQw4w9WgXcQ')
  })

  it('returns null for non-YouTube URL', () => {
    expect(extractYouTubeId('https://vimeo.com/123456')).toBeNull()
    expect(extractYouTubeId('https://example.com')).toBeNull()
  })

  it('returns null for invalid URL', () => {
    expect(extractYouTubeId('not-a-url')).toBeNull()
  })
})

describe('extractVimeoId', () => {
  it('extracts ID from standard vimeo URL', () => {
    expect(extractVimeoId('https://vimeo.com/123456789')).toBe('123456789')
  })

  it('returns null for non-Vimeo URL', () => {
    expect(extractVimeoId('https://youtube.com/watch?v=abc')).toBeNull()
  })

  it('returns null for invalid URL', () => {
    expect(extractVimeoId('not-a-url')).toBeNull()
  })
})

describe('detectEmbedType', () => {
  it('detects youtube', () => {
    expect(detectEmbedType('https://www.youtube.com/watch?v=abc123abcde')).toBe('youtube')
  })

  it('detects vimeo', () => {
    expect(detectEmbedType('https://vimeo.com/123456789')).toBe('vimeo')
  })

  it('returns null for unknown URL', () => {
    expect(detectEmbedType('https://example.com/video')).toBeNull()
  })
})

describe('extractFirstEmbedUrl', () => {
  it('extracts the first embeddable URL from text', () => {
    const text = 'Check out https://example.com and https://www.youtube.com/watch?v=dQw4w9WgXcQ for details'
    expect(extractFirstEmbedUrl(text)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })

  it('returns null when no embeddable URL exists', () => {
    expect(extractFirstEmbedUrl('just plain text with https://example.com')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractFirstEmbedUrl('')).toBeNull()
  })
})

// ─── VerificationTimeline helpers ────────────────────────────────────────────

describe('getResultColor', () => {
  it('returns green for confirmed', () => {
    expect(getResultColor('confirmed')).toBe(RESULT_COLOR['confirmed'])
    expect(getResultColor('CONFIRMED')).toBe(RESULT_COLOR['confirmed'])
  })

  it('returns red for refuted', () => {
    expect(getResultColor('refuted')).toBe(RESULT_COLOR['refuted'])
    expect(getResultColor('fail')).toBe(RESULT_COLOR['fail'])
  })

  it('returns amber for pending/warn', () => {
    expect(getResultColor('pending')).toBe(RESULT_COLOR['pending'])
    expect(getResultColor('warn')).toBe(RESULT_COLOR['warn'])
  })

  it('returns grey for unknown result', () => {
    expect(getResultColor('unknown_result')).toBe('#8892a4')
  })
})

describe('getCheckTypeIcon', () => {
  it('returns robot icon for AI check types', () => {
    expect(getCheckTypeIcon('ai_analysis')).toBe(CHECK_TYPE_ICON['ai_analysis'])
    expect(getCheckTypeIcon('ai_check')).toBe(CHECK_TYPE_ICON['ai_check'])
  })

  it('returns magnifier icon for source check types', () => {
    expect(getCheckTypeIcon('source_check')).toBe(CHECK_TYPE_ICON['source_check'])
  })

  it('returns chain icon for cross reference', () => {
    expect(getCheckTypeIcon('cross_reference')).toBe(CHECK_TYPE_ICON['cross_reference'])
  })

  it('returns fallback checkmark for unknown check type', () => {
    expect(getCheckTypeIcon('unknown_check')).toBe('✓')
  })
})
