/**
 * The email sign-up box (plan G4; G11 slice 2, Oct 30, 2026): readers pick every
 * morning or once a week, the API gets that choice, and the weekly reader's
 * confirmation (?subscribed=weekly) says the first email comes on Monday.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, '..', 'components/briefing/BriefingSignup.tsx'), 'utf8')

describe('the email sign-up box', () => {
  it('offers every morning and once a week, and sends the choice', () => {
    expect(src).toContain("choice: 'Every morning'")
    expect(src).toContain("choice: 'Once a week'")
    expect(src).toContain('role="radiogroup"')
    expect(src).toContain('JSON.stringify({ email, frequency, ')
    expect(src).not.toContain("frequency: 'daily', source")
  })
  it('tells a weekly reader when the first email comes', () => {
    expect(src).toContain("sub === 'weekly'")
    expect(src).toContain('Your first weekly email arrives on Monday at 7 AM New York time.')
  })
})

describe('follow your countries (plan G13)', () => {
  it('lets a reader follow up to 5 countries and sends them', () => {
    expect(src).toContain('const MAX_COUNTRIES = 5')
    expect(src).toContain('+ Follow your countries (optional)')
    expect(src).toContain('JSON.stringify({ email, frequency, countries, source })')
    expect(src).toContain("new Intl.DisplayNames(['en'], { type: 'region' })")
  })
})
