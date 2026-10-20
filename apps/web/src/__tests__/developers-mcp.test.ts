import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The developer page lists the MCP server (plan 15, Oct 20, 2026: it was live
// with no page mentioning it), with the tools the server really has

const page = readFileSync(join(__dirname, '..', 'app', 'developers', 'page.tsx'), 'utf8')
const server = readFileSync(join(__dirname, '..', '..', '..', 'api', 'src', 'routes', 'mcp.ts'), 'utf8')

describe('the developer page on the MCP server', () => {
  it('gives its address and says it needs no key', () => {
    expect(page).toContain('https://api.world-pulse.io/mcp')
    expect(page).toMatch(/no sign-up, no key/)
    expect(page).toContain('id="mcp"')
  })

  it("gives Claude's own steps (support.claude.com: Customize, Connectors, Add custom connector)", () => {
    expect(page).toContain('Customize, Connectors, &ldquo;+ Add&rdquo;, &ldquo;Add custom connector&rdquo;')
    expect(page).not.toContain('(Settings, Connectors)')
  })

  it("lists exactly the server's tools", () => {
    const served = [...server.matchAll(/^\s{4}name: '([a-z_]+)',$/gm)].map(m => m[1]).sort()
    const listed = [...page.matchAll(/\{ name: '([a-z_]+)', what:/g)].map(m => m[1]).sort()
    expect(served).toEqual(['check_link', 'search_reports', 'story', 'top_stories', 'week'])
    expect(listed).toEqual(served)
  })
})
