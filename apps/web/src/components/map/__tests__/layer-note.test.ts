import { describe, it, expect } from 'vitest'
import { layerNote } from '../LayersPanel'

describe('layerNote', () => {
  it("says why a layer that's on shows nothing", () => {
    const signIn = { text: 'This layer needs a free account.', href: '/auth/login', linkText: 'Sign in' }
    expect(layerNote({ on: true, loading: false, count: null, note: signIn })).toBe(signIn)
    expect(layerNote({ on: true, loading: false, count: 0 })).toEqual({ text: 'Nothing to show right now.' })
  })

  it('stays quiet while loading, when off, or when the layer has something', () => {
    expect(layerNote({ on: true, loading: true, count: 0 })).toBeNull()
    expect(layerNote({ on: false, count: 0 })).toBeNull()
    expect(layerNote({ on: true, count: 12 })).toBeNull()
    expect(layerNote({ on: true })).toBeNull()      // layers that don't count (heatmap) say nothing
  })
})
