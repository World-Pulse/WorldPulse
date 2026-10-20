/**
 * The help page and How We Count are linked from the side panel's footer
 * (plan C2, Oct 20, 2026): /help existed since Oct 17 but only onboarding and
 * How We Count linked to it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe("the side panel's footer", () => {
  it('links Help & FAQ and How We Count', () => {
    const src = readFileSync(join(__dirname, '..', 'components/sidebar/RightSidebar.tsx'), 'utf8')
    const footer = src.slice(src.indexOf('{/* Footer */}'))
    expect(footer).toContain('<Link href="/help"')
    expect(footer).toContain('<Link href="/how-we-count"')
  })
})
