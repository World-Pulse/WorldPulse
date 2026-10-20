import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GET } from '../app/llms.txt/route'

// One definition of "Verified" (Oct 20, 2026): /how-we-count said two or
// more outlets and a 65% reliability score, while /help, /llms.txt, the
// onboarding and the sidebar said "when a second, independent outlet reports"

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const PLACES = ['app/how-we-count/page.tsx', 'app/help/page.tsx', 'app/llms.txt/route.ts', 'components/OnboardingModal.tsx', 'components/sidebar/RightSidebar.tsx']

describe('what "Verified" means, everywhere', () => {
  it('is two or more outlets and a 65% reliability score', () => {
    for (const p of PLACES) {
      const src = read(p)
      expect(src, p).toMatch(/two or more outlets/)
      expect(src, p).toMatch(/65%/)
      expect(src, p).not.toMatch(/a second, (independent|different) outlet reports/)
    }
  })

  it('llms.txt points AI assistants to the Week, the counting rule and the MCP server', async () => {
    const text = await GET().text()
    expect(text).toContain('https://world-pulse.io/week')
    expect(text).toContain('https://world-pulse.io/how-we-count')
    expect(text).toMatch(/MCP server at https:\/\/api\.world-pulse\.io\/mcp/)
    expect(text).toMatch(/no sign-in and no key/)
  })

  it('/help says the public endpoints need no sign-up', () => {
    expect(read('app/help/page.tsx')).toMatch(/public endpoints work without signing up/)
  })
})
