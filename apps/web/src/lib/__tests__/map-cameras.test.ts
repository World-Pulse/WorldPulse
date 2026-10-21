import { describe, it, expect, vi } from 'vitest'
import { cameraPictureUrl, cameraPopupHtml, pictureAgeLabel, startCameraPicture } from '../map-cameras'

describe('cameraPictureUrl (the camera wall, Oct 21, 2026)', () => {
  it('asks for this minute\'s picture', () => {
    expect(cameraPictureUrl('https://api.world-pulse.io/api/v1/cameras/tfl%3A1/image', 29342817)).toBe('https://api.world-pulse.io/api/v1/cameras/tfl%3A1/image?m=29342817')
    expect(cameraPictureUrl('https://x.test/img?size=s', 5)).toBe('https://x.test/img?size=s&m=5')
  })
})

describe('pictureAgeLabel', () => {
  const now = Date.parse('2026-10-19T17:00:00Z')
  it('says how long ago the source took the picture', () => {
    expect(pictureAgeLabel('2026-10-19T16:59:40Z', now)).toBe('just now')
    expect(pictureAgeLabel('2026-10-19T16:56:00Z', now)).toBe('4 min ago')
    expect(pictureAgeLabel('2026-10-19T14:30:00Z', now)).toBe('2 h ago')
    expect(pictureAgeLabel(null, now)).toBe('')
    expect(pictureAgeLabel('not a date', now)).toBe('')
  })
})

describe('cameraPopupHtml', () => {
  it('names the camera, where it is and who runs it, safely', () => {
    const html = cameraPopupHtml({ name: '<img src=x onerror=alert(1)>', city: 'Southern, Hong Kong', country: 'Hong Kong', type: 'traffic',
      sourceName: 'Hong Kong Transport Department', embedUrl: 'https://www.hkemobility.gov.hk/' })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
    // the country isn't repeated when the place already names it
    expect(html).toContain('Southern, Hong Kong · Road camera')
    expect(html).toContain('href="https://www.hkemobility.gov.hk/"')
    expect(html).toContain('Camera: Hong Kong Transport Department')
  })

  it('no link for a page that isn\'t http(s)', () => {
    const html = cameraPopupHtml({ name: 'A', city: 'London', country: 'United Kingdom', type: 'traffic', sourceName: 'TfL', embedUrl: 'javascript:alert(1)' })
    expect(html).not.toContain('javascript:')
    expect(html).toContain('London, United Kingdom')
  })
})

describe('startCameraPicture', () => {
  const fakeRoot = () => {
    const img = { style: { opacity: '0' }, src: '', onload: null as null | (() => void) }
    const msg = { style: { display: 'grid' }, textContent: 'Loading the picture…' }
    const age = { textContent: '' }
    const root = { querySelector: (sel: string) => ({ '.wp-cam-img': img, '.wp-cam-msg': msg, '.wp-cam-age': age } as Record<string, unknown>)[sel] ?? null }
    return { root: root as unknown as HTMLElement, img, msg, age }
  }

  it('shows the picture and its age, and stops when the popup closes', async () => {
    vi.useFakeTimers()
    const { root, img, msg, age } = fakeRoot()
    const create = vi.fn(() => 'blob:1')
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
    const fetchImpl = vi.fn(async () => new Response(new Blob(['jpeg']), { status: 200, headers: { 'X-Picture-Time': new Date(Date.now() - 4 * 60_000).toISOString() } })) as unknown as typeof fetch
    const stop = startCameraPicture(root, 'https://api.world-pulse.io/api/v1/cameras/tfl%3A1/image', fetchImpl)
    await vi.advanceTimersByTimeAsync(10)
    expect(img.src).toBe('blob:1')
    img.onload?.()
    expect(img.style.opacity).toBe('1')
    expect(msg.style.display).toBe('none')
    expect(age.textContent).toBe('4 min ago')
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/\/image\?m=\d+$/)
    // a fresh picture every minute while open
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    stop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(revoke).toHaveBeenCalled()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('says so when the camera has no picture', async () => {
    const { root, msg } = fakeRoot()
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 404 })) as unknown as typeof fetch
    const stop = startCameraPicture(root, 'https://api.world-pulse.io/api/v1/cameras/x%3A1/image', fetchImpl)
    await new Promise(r => setTimeout(r, 20))
    expect(msg.textContent).toMatch(/No picture from this camera right now/)
    stop()
  })
})
