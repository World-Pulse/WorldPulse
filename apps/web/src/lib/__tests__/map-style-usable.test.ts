import { describe, it, expect, vi } from 'vitest'
import { styleUsable, whenStyleUsable } from '../map-utils'

const fakeMap = (loaded: boolean) => {
  const handlers: Array<() => void> = []
  return {
    style: { _loaded: loaded },
    on: vi.fn((_e: string, h: () => void) => { handlers.push(h) }),
    off: vi.fn((_e: string, h: () => void) => { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1) }),
    fire: () => [...handlers].forEach(h => h()),
    handlers,
  }
}

describe('styleUsable / whenStyleUsable (layers draw before every tile has loaded)', () => {
  it('is true once the style itself has loaded, whatever the tiles are doing', () => {
    expect(styleUsable(fakeMap(true))).toBe(true)
    expect(styleUsable(fakeMap(false))).toBe(false)
    expect(styleUsable(null)).toBe(false)
    expect(styleUsable({ style: {}, getStyle: () => ({ layers: [] }) })).toBe(true)
  })

  it('runs at once when it can, or on the style\'s first load event, once', () => {
    const ready = fakeMap(true)
    const now = vi.fn()
    whenStyleUsable(ready, now)
    expect(now).toHaveBeenCalledTimes(1)
    expect(ready.on).not.toHaveBeenCalled()

    const later = fakeMap(false)
    const fn = vi.fn()
    whenStyleUsable(later, fn)
    later.fire()
    expect(fn).not.toHaveBeenCalled()
    later.style._loaded = true
    later.fire()
    later.fire()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(later.handlers).toHaveLength(0)
  })
})
