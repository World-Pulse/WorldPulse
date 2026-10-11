/**
 * The World Map's Layers panel (plan M11): the count on the Layers button.
 */
import { describe, it, expect } from 'vitest'
import { Flame } from 'lucide-react'
import { activeLayerCount, type MapLayerGroup } from '../LayersPanel'

const item = (key: string, on: boolean) => ({ key, label: key, description: '', icon: Flame, color: '#fff', on, toggle: () => {} })

describe('activeLayerCount', () => {
  it('counts the layers switched on across all groups', () => {
    const groups: MapLayerGroup[] = [
      { title: 'Signals', items: [item('heat', true), item('replay', false)] },
      { title: 'Security', items: [item('conflict', true), item('threats', true)] },
    ]
    expect(activeLayerCount(groups)).toBe(3)
  })

  it('is 0 with nothing on', () => {
    expect(activeLayerCount([{ title: 'Signals', items: [item('heat', false)] }])).toBe(0)
  })
})
