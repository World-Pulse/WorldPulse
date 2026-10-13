/**
 * What counts as escalating in the morning briefing (lib/pulse/trending.ts,
 * Oct 13, 2026): growth or reports turning more severe, not volume.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../db/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }) }))
vi.mock('../../../db/redis', () => ({ redis: { get: vi.fn(), setex: vi.fn() } }))

import { escalation } from '../trending'

describe('escalation', () => {
  it('is not escalating for a busy subject that is not growing (189 reports, evenly spread)', () => {
    expect(escalation(95, 94, 6, false)).toEqual({ isEscalating: false, reason: null })
  })

  it('is escalating when the second half has at least twice the first, with 5 or more', () => {
    expect(escalation(53, 12, 6, false)).toEqual({ isEscalating: true, reason: '53 reports in the last 6 hours, up from 12' })
    expect(escalation(10, 5, 6, false).isEscalating).toBe(true)
  })

  it('says "none before" for a subject that is new in the window', () => {
    expect(escalation(7, 0, 6, false).reason).toBe('7 reports in the last 6 hours, none before')
  })

  it('needs 5 reports in the second half to call growth', () => {
    expect(escalation(4, 0, 6, false).isEscalating).toBe(false)
  })

  it('is escalating when reports turn more severe, with 3 or more lately', () => {
    expect(escalation(3, 10, 6, true)).toEqual({ isEscalating: true, reason: 'Reports turning more severe' })
    expect(escalation(2, 10, 6, true).isEscalating).toBe(false)
  })

  it('names half hours that are not whole', () => {
    expect(escalation(6, 1, 1.5, false).reason).toBe('6 reports in the last 1.5 hours, up from 1')
  })
})
