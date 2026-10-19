import { describe, it, expect, vi } from 'vitest'

vi.mock('../../pipeline/insert-signal', () => ({ insertAndCorrelate: vi.fn() }))
vi.mock('../../lib/fetch-with-resilience', () => ({ fetchWithResilience: vi.fn(), CircuitOpenError: class extends Error {} }))

import { radiationAlerts, radiationSeverity, type SafecastMeasurement } from '../safecast'

const now = Date.parse('2026-10-19T17:00:00Z')
let n = 0
const reading = (over: Partial<SafecastMeasurement>): SafecastMeasurement => ({
  id: ++n, value: 40, unit: 'cpm', latitude: 52.45, longitude: 13.31,
  captured_at: '2026-10-19T16:30:00Z', device_id: null, user_id: 7, ...over,
})

describe('radiationAlerts (Oct 19, 2026: one Berlin sensor sat in the ticker all day)', () => {
  it('one sensor alone, however high, is no alert', () => {
    const one = [reading({ value: 6477 }), reading({ value: 5840 }), reading({ value: 6153 })]
    expect(radiationAlerts(one, now)).toEqual([])
  })

  it('two different sensors reading high in one area alert, at the level both agree on', () => {
    const cells = radiationAlerts([
      reading({ value: 6477, user_id: 7 }),
      reading({ value: 180, user_id: 9, latitude: 52.51, longitude: 13.4 }),
      reading({ value: 45, user_id: 11 }),
    ], now)
    expect(cells).toHaveLength(1)
    expect(cells[0]).toMatchObject({ gridKey: '52_13', cpm: 180, sensors: 2 })
    expect(radiationSeverity(cells[0].cpm)).toBe('medium')
  })

  it('devices count apart from the person who uploaded them', () => {
    const cells = radiationAlerts([reading({ value: 400, device_id: 1, user_id: 7 }), reading({ value: 380, device_id: 2, user_id: 7 })], now)
    expect(cells[0]).toMatchObject({ cpm: 380, sensors: 2 })
  })

  it('old drives uploaded late, other units and readings from the future are left out', () => {
    expect(radiationAlerts([
      reading({ value: 900, user_id: 1, captured_at: '2024-09-07T06:25:51Z' }),
      reading({ value: 900, user_id: 2, captured_at: '2024-09-07T06:25:46Z' }),
    ], now)).toEqual([])
    expect(radiationAlerts([reading({ value: 900, user_id: 1, unit: 'usv' }), reading({ value: 900, user_id: 2, unit: 'celsius' })], now)).toEqual([])
    expect(radiationAlerts([reading({ value: 900, user_id: 1, captured_at: '2026-10-19T20:00:00Z' }), reading({ value: 900, user_id: 2, captured_at: '2026-10-19T20:00:00Z' })], now)).toEqual([])
  })

  it('normal background and 0,0 readings are no alert', () => {
    expect(radiationAlerts([reading({ value: 45, user_id: 1 }), reading({ value: 60, user_id: 2 })], now)).toEqual([])
    expect(radiationAlerts([reading({ value: 500, user_id: 1, latitude: 0, longitude: 0 }), reading({ value: 500, user_id: 2, latitude: 0, longitude: 0 })], now)).toEqual([])
  })
})
