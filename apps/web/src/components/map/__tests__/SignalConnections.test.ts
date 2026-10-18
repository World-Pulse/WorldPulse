import { describe, it, expect } from 'vitest'
import { readConnections } from '../SignalConnections'

describe('readConnections', () => {
  it('keeps id, title, severity and up to two entity names, at most four items', () => {
    const connections = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i}`, title: ` Story ${i} `, severity: 'high',
      connectedVia: [{ name: 'UN' }, { name: 'Sudan' }, { name: 'Chad' }],
    }))
    const out = readConnections({ data: { connections } })
    expect(out).toHaveLength(4)
    expect(out[0]).toEqual({ id: 's0', title: 'Story 0', severity: 'high', connectedVia: ['UN', 'Sudan'] })
  })
  it('drops malformed entries and tolerates missing data', () => {
    expect(readConnections(null)).toEqual([])
    expect(readConnections({ data: {} })).toEqual([])
    const out = readConnections({ data: { connections: [null, { id: 'a' }, { id: 'b', title: 'T' }] } })
    expect(out).toEqual([{ id: 'b', title: 'T', severity: 'info', connectedVia: [] }])
  })
})
