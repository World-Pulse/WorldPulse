/**
 * The AI tools page's list (/ai/tools, Nov 22, 2026): every one of the server's 100 tools once, in tool_guide's
 * groups, each with a question it answers; and the first sentence the page takes from each tool's description.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AI_TOOL_GROUPS, AI_TOOLS, firstSentence } from '../ai-tool-list'

describe('the AI tools list', () => {
  it("has the server's 100 tools, each once, each with a title and a question", () => {
    expect(AI_TOOLS).toHaveLength(100)
    expect(new Set(AI_TOOLS.map(t => t.name)).size).toBe(100)
    for (const t of AI_TOOLS) {
      expect(t.name, t.name).toMatch(/^[a-z_]+$/)
      expect(t.title.length, t.name).toBeGreaterThan(5)
      expect(t.ask, t.name).toMatch(/[?.)]$/)
    }
  })

  it('every group has tools and its own id', () => {
    expect(new Set(AI_TOOL_GROUPS.map(g => g.id)).size).toBe(AI_TOOL_GROUPS.length)
    for (const g of AI_TOOL_GROUPS) expect(g.tools.length, g.id).toBeGreaterThan(0)
  })

  it("matches the API server's tool_guide groups (apps/api/src/routes/mcp.ts TOOL_GUIDE)", () => {
    const src = readFileSync(join(__dirname, '../../../../api/src/routes/mcp.ts'), 'utf8')
    const block = src.slice(src.indexOf('const TOOL_GUIDE'), src.indexOf(']\n', src.indexOf('const TOOL_GUIDE')))
    const server = [...block.matchAll(/tools: \[([^\]]*)\]/g)].map(m => [...m[1]!.matchAll(/'([a-z_]+)'/g)].map(x => x[1]))
    expect(AI_TOOL_GROUPS.map(g => g.tools.map(t => t.name))).toEqual(server)
  })
})

describe('firstSentence', () => {
  it("ends at the first full stop that ends a sentence, not at an abbreviation", () => {
    expect(firstSentence('Finds reports by meaning (e.g. "drought in Kenya"). Give a query.')).toBe('Finds reports by meaning (e.g. "drought in Kenya").')
    expect(firstSentence('One story: every outlet.  Then more.')).toBe('One story: every outlet.')
    expect(firstSentence('No full stop at all')).toBe('No full stop at all')
    expect(firstSentence('x'.repeat(300) + '.')).toHaveLength(240)
  })
})
