// Sanctions search while OpenSanctions has no key from us (plan P16, Oct 20, 2026)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { entitiesOf, openSanctionsSearchUrl, sanctionsSearchOffline, SANCTIONS_OFFLINE_NOTE } from '../sanctions-search'

describe('sanctions search, offline', () => {
  it("links the reader's query to OpenSanctions' own search", () => {
    expect(openSanctionsSearchUrl('  Kim Jong Un ')).toBe('https://www.opensanctions.org/search/?q=Kim%20Jong%20Un')
    expect(openSanctionsSearchUrl('')).toBe('https://www.opensanctions.org/search/')
    expect(openSanctionsSearchUrl('a&b=c')).toBe('https://www.opensanctions.org/search/?q=a%26b%3Dc')
  })

  it('is offline on a 503 only', () => {
    expect(sanctionsSearchOffline(503)).toBe(true)
    for (const s of [200, 400, 429, 500]) expect(sanctionsSearchOffline(s)).toBe(false)
  })

  it("reads the API's answer, { success, data: { entities } }", () => {
    expect(entitiesOf<{ id: string }>({ success: true, data: { entities: [{ id: 'Q1' }] } })).toEqual([{ id: 'Q1' }])
    expect(entitiesOf({ entities: [{ id: 'Q2' }] })).toEqual([{ id: 'Q2' }])
    expect(entitiesOf({ success: false, error: 'x' })).toEqual([])
    expect(entitiesOf(null)).toEqual([])
  })

  it('says why, plainly, and the pages use it instead of the API error', () => {
    expect(SANCTIONS_OFFLINE_NOTE).toMatch(/offline for now/)
    expect(SANCTIONS_OFFLINE_NOTE).toMatch(/API key/)
    const page = readFileSync(join(__dirname, '../../app/sanctions/page.tsx'), 'utf8')
    expect(page).toContain('sanctionsSearchOffline(res.status)')
    expect(page).toContain('json.live === false')
    expect(page).not.toContain('Real-time OFAC')
    expect(page).not.toContain('setSearch(json.entities)')
    const search = readFileSync(join(__dirname, '../../app/search/page.tsx'), 'utf8')
    expect(search).toContain('SANCTIONS_OFFLINE_NOTE')
    expect(search).not.toContain('⚠ {entitiesError}')
  })
})
