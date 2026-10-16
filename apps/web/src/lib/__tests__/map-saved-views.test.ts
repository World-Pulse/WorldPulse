import { describe, it, expect } from 'vitest'
import {
  readSavedViews, writeSavedViews, addSavedView, removeSavedView, isMapHref,
  SAVED_VIEWS_KEY, MAX_SAVED_VIEWS, MAX_NAME_LENGTH,
} from '../map-saved-views'

const memory = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
}

describe('saved map views', () => {
  it('only accepts addresses on the map', () => {
    expect(isMapHref('/map#@14.5,3.2,4.00|l=heat')).toBe(true)
    expect(isMapHref('/map?sev=high#@1,2,3')).toBe(true)
    expect(isMapHref('/map')).toBe(true)
    expect(isMapHref('//evil.example/map')).toBe(false)
    expect(isMapHref('https://evil.example/map')).toBe(false)
    expect(isMapHref('/mapping')).toBe(false)
    expect(isMapHref('javascript:alert(1)')).toBe(false)
    expect(isMapHref(42)).toBe(false)
  })

  it('adds newest first, trims the name, and a repeated name replaces the old view', () => {
    const a = addSavedView([], '  Sahel   watch ', '/map#@14,3,4', 1)!
    expect(a[0].name).toBe('Sahel watch')
    const b = addSavedView(a, 'Red Sea', '/map#@20,38,5', 2)!
    expect(b.map(v => v.name)).toEqual(['Red Sea', 'Sahel watch'])
    const c = addSavedView(b, 'sahel WATCH', '/map#@15,4,4', 3)!
    expect(c.map(v => v.name)).toEqual(['sahel WATCH', 'Red Sea'])
    expect(c[0].href).toBe('/map#@15,4,4')
  })

  it('refuses empty names and foreign addresses, caps name length and list size', () => {
    expect(addSavedView([], '   ', '/map#@1,2,3')).toBeNull()
    expect(addSavedView([], 'x', 'https://evil.example')).toBeNull()
    expect(addSavedView([], 'n'.repeat(200), '/map')![0].name).toHaveLength(MAX_NAME_LENGTH)
    let list: ReturnType<typeof addSavedView> = []
    for (let i = 0; i < MAX_SAVED_VIEWS + 5; i++) list = addSavedView(list!, `v${i}`, '/map', i)!
    expect(list).toHaveLength(MAX_SAVED_VIEWS)
    expect(list![0].name).toBe(`v${MAX_SAVED_VIEWS + 4}`)
  })

  it('removes by id', () => {
    const list = addSavedView(addSavedView([], 'A', '/map', 1)!, 'B', '/map', 2)!
    expect(removeSavedView(list, list[0].id).map(v => v.name)).toEqual(['A'])
  })

  it('reads what it wrote, and nothing from junk, tampered or broken storage', () => {
    const s = memory()
    expect(readSavedViews(s)).toEqual([])
    const list = addSavedView([], 'A', '/map#@1,2,3', 1)!
    writeSavedViews(s, list)
    expect(readSavedViews(s)).toEqual(list)
    s.setItem(SAVED_VIEWS_KEY, 'not json')
    expect(readSavedViews(s)).toEqual([])
    s.setItem(SAVED_VIEWS_KEY, '{"a":1}')
    expect(readSavedViews(s)).toEqual([])
    s.setItem(SAVED_VIEWS_KEY, JSON.stringify([{ id: 'x', name: 'Bad', href: 'https://evil.example' }, ...list]))
    expect(readSavedViews(s)).toEqual(list)
    expect(readSavedViews(null)).toEqual([])
    expect(readSavedViews({ getItem: () => { throw new Error('blocked') }, setItem: () => {} })).toEqual([])
  })
})
