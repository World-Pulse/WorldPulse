/**
 * What WorldPulse calls itself, the way people search (Devon, Oct 20, 2026:
 * the title was "Global Intelligence Network", which put it among the
 * dashboards): the site's title and description, and the same words on the
 * home page, /llms.txt, /developers and the app manifest.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const TITLE = 'WorldPulse — How many newsrooms reported each world story'

describe('the title and description', () => {
  it('say what WorldPulse is, the way people search', () => {
    // (the root layout's metadata: the home page has no title of its own; the
    // layout itself needs Next's fonts, so it is read rather than imported)
    const layout = read('app/layout.tsx')
    const meta = layout.slice(layout.indexOf('export const metadata'), layout.indexOf('export const dynamic'))
    const titles = [...meta.matchAll(/title: '([^']+)'/g)].map(m => m[1])
    expect(titles.filter(t => t !== 'WorldPulse')).toEqual([TITLE, TITLE, TITLE])   // page, Open Graph, X
    const descriptions = [...meta.matchAll(/description: "([^"]+)"/g)].map(m => m[1]!)
    expect(descriptions).toHaveLength(3)
    for (const d of descriptions) {
      expect(d).toMatch(/^World news with how many independent outlets reported each story, and which ones\./)
      expect(d.length).toBeLessThanOrEqual(160)
    }
    expect(meta).not.toMatch(/title: 'WorldPulse — Global Intelligence Network'/)
  })

  it('agree on the home page, /llms.txt, /developers and the app manifest', () => {
    expect(read('app/page.tsx')).toContain('"World news with how many independent outlets reported each story, and which ones.')
    expect(read('app/llms.txt/route.ts')).toContain('> WorldPulse shows how many independent newsrooms reported each world story, and which ones.')
    expect(read('app/developers/page.tsx')).toContain('World stories with how many independent outlets reported each')
    const manifest = JSON.parse(read('../public/manifest.json')) as { name: string; description: string }
    expect(manifest.name).toBe('WorldPulse')
    expect(manifest.description).toMatch(/^World news with how many independent outlets/)
  })
})
