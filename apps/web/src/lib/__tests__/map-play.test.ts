import { describe, it, expect } from 'vitest'
import { parsePlayParam, playStepMs, pickCaption, captionAt, playTimeLabel } from '../map-play'

const sig = (title: string, severity: string, status?: string, is_breaking = false) =>
  ({ title, severity, status, is_breaking })

describe('map play mode', () => {
  it('reads the play address', () => {
    expect(parsePlayParam(null)).toBeNull()
    expect(parsePlayParam('')).toBe('24h')
    expect(parsePlayParam('1')).toBe('24h')
    expect(parsePlayParam('7d')).toBe('7d')
    expect(parsePlayParam('99h')).toBeNull()
  })

  it('fits the window into about a minute', () => {
    expect(playStepMs(24)).toBe(2500)
    expect(playStepMs(168)).toBe(357)
    expect(playStepMs(5)).toBe(3000)
    expect(playStepMs(1000)).toBe(150)
    expect(playStepMs(0)).toBe(3000)
  })

  it('captions with the verified, most severe headline', () => {
    const c = pickCaption({ t: 'x', signals: [sig('Pending critical', 'critical', 'pending'), sig('Verified high', 'high', 'verified'), sig('Verified medium', 'medium', 'verified')] })
    expect(c).toEqual({ title: 'Verified high', severity: 'high', verified: true })
    expect(pickCaption({ t: 'x', signals: [] })).toBeNull()
    expect(pickCaption({ t: 'x', signals: [sig('  ', 'high')] })).toBeNull()
  })

  it('shortens long headlines', () => {
    const c = pickCaption({ t: 'x', signals: [sig('a'.repeat(300), 'low')] })
    expect(c?.title.length).toBe(140)
    expect(c?.title.endsWith('…')).toBe(true)
  })

  it('keeps a headline over a quiet moment, but not for long', () => {
    const buckets = [{ t: '1', signals: [sig('First', 'high', 'verified')] }, { t: '2', signals: [] }, { t: '3', signals: [] }, { t: '4', signals: [] }]
    expect(captionAt(buckets, 2)?.title).toBe('First')
    expect(captionAt(buckets, 3)).toBeNull()
  })

  it('labels a moment in UTC', () => {
    expect(playTimeLabel('2026-10-17T14:00:00.000Z')).toBe('Oct 17 · 14:00 UTC')
    expect(playTimeLabel(null)).toBe('')
    expect(playTimeLabel('nope')).toBe('')
  })
})
