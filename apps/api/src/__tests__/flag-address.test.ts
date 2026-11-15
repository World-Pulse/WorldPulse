/**
 * The anonymous flag is counted per visitor address (H-0056): the address the
 * server saw (req.ip), never the X-Forwarded-For header the client writes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('flag route address', () => {
  const src = readFileSync(join(__dirname, '../routes/signals.ts'), 'utf8')
  const start = src.indexOf("app.post('/:id/flag'")
  const route = src.slice(start, src.indexOf('FLAGS ON A SIGNAL', start))

  it('uses req.ip', () => {
    expect(route).toContain('visitorHash(ipRaw)')
    expect(route).toContain('req.ip')
  })
  it('does not read x-forwarded-for', () => {
    expect(route.toLowerCase()).not.toContain('x-forwarded-for\'] as')
    expect(route).not.toMatch(/headers\[['"]x-forwarded-for/i)
  })
})
