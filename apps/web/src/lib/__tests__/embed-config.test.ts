import { describe, it, expect } from 'vitest'
import {
  buildEmbedUrl,
  buildIframeSnippet,
  buildScriptSnippet,
  EMBED_DEFAULTS,
} from '../embed-config'

const ORIGIN = 'https://worldpulse.io'

describe('buildEmbedUrl', () => {
  it('builds URL with defaults', () => {
    const url = buildEmbedUrl(ORIGIN, EMBED_DEFAULTS)
    expect(url).toContain('/embed?')
    expect(url).toContain('theme=dark')
    expect(url).toContain('limit=5')
  })

  it('omits category param when set to all', () => {
    const url = buildEmbedUrl(ORIGIN, EMBED_DEFAULTS)
    expect(url).not.toContain('category')
  })

  it('includes category when not all', () => {
    const url = buildEmbedUrl(ORIGIN, { ...EMBED_DEFAULTS, category: 'breaking' })
    expect(url).toContain('category=breaking')
  })

  it('encodes light theme', () => {
    const url = buildEmbedUrl(ORIGIN, { ...EMBED_DEFAULTS, theme: 'light' })
    expect(url).toContain('theme=light')
  })

  it('serialises limit correctly', () => {
    const url = buildEmbedUrl(ORIGIN, { ...EMBED_DEFAULTS, limit: 10 })
    expect(url).toContain('limit=10')
  })

  it('uses the provided origin', () => {
    const url = buildEmbedUrl('http://localhost:3000', EMBED_DEFAULTS)
    expect(url.startsWith('http://localhost:3000/embed?')).toBe(true)
  })
})

describe('buildIframeSnippet', () => {
  it('generates valid iframe HTML', () => {
    const html = buildIframeSnippet(ORIGIN, EMBED_DEFAULTS)
    expect(html).toContain('<iframe')
    expect(html).toContain('</iframe>')
    expect(html).toContain('width="360"')
    expect(html).toContain('height="500"')
    expect(html).toContain('border:none')
    expect(html).toContain('/embed?')
    expect(html).toContain('loading="lazy"')
  })

  it('reflects custom dimensions', () => {
    const html = buildIframeSnippet(ORIGIN, { ...EMBED_DEFAULTS, width: 480, height: 600 })
    expect(html).toContain('width="480"')
    expect(html).toContain('height="600"')
  })
})

describe('buildScriptSnippet', () => {
  it('generates script tag with widget.js src', () => {
    const snippet = buildScriptSnippet(ORIGIN, EMBED_DEFAULTS)
    expect(snippet).toContain('<script')
    expect(snippet).toContain('/widget.js"')
  })

  it('includes data-theme and data-limit', () => {
    const snippet = buildScriptSnippet(ORIGIN, EMBED_DEFAULTS)
    expect(snippet).toContain('data-theme="dark"')
    expect(snippet).toContain('data-limit="5"')
  })

  it('omits data-category when category is all', () => {
    const snippet = buildScriptSnippet(ORIGIN, EMBED_DEFAULTS)
    expect(snippet).not.toContain('data-category')
  })

  it('includes data-category when specific category set', () => {
    const snippet = buildScriptSnippet(ORIGIN, { ...EMBED_DEFAULTS, category: 'climate' })
    expect(snippet).toContain('data-category="climate"')
  })

  it('includes data-width and data-height', () => {
    const snippet = buildScriptSnippet(ORIGIN, { ...EMBED_DEFAULTS, width: 400, height: 550 })
    expect(snippet).toContain('data-width="400"')
    expect(snippet).toContain('data-height="550"')
  })
})
