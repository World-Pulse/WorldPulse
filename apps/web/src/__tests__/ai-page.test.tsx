/**
 * /ai (Nov 21, 2026): WorldPulse's MCP server step by step in Claude, ChatGPT, Gemini and other apps, for readers
 * (the developer page has the full tool list). Its tool count and smaller sets are the server's, and every
 * address it gives is the one the server answers on.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ usePathname: () => '/ai', useRouter: () => ({ push: vi.fn() }) }))

const { default: UseInAiPage, metadata } = await import('@/app/ai/page')
const { default: sitemap } = await import('@/app/sitemap')
const { GET } = await import('@/app/llms.txt/route')

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8')
const source = read('app', 'ai', 'page.tsx')
const developers = read('app', 'developers', 'page.tsx')
const server = readFileSync(join(__dirname, '..', '..', '..', 'api', 'src', 'routes', 'mcp.ts'), 'utf8')

describe('the page', () => {
  const html = renderToStaticMarkup(<UseInAiPage />)

  it('gives the address to add, and a section for each assistant', () => {
    expect(html).toContain('https://api.world-pulse.io/mcp')
    for (const id of ['address', 'claude', 'chatgpt', 'gemini', 'ask', 'other', 'fewer', 'what']) expect(html).toContain(`id="${id}"`)
    expect(String(metadata.title)).toMatch(/Use WorldPulse in Claude, ChatGPT or Gemini/)
  })

  it("gives each app's own steps and help page", () => {
    // support.claude.com 11175166
    for (const s of ['Customize', 'Add custom connector', 'No sign in', 'Free allows one custom connector']) expect(html).toContain(s)
    // help.openai.com 12584461
    for (const s of ['https://chatgpt.com/plugins', 'Add custom MCP server', 'No authentication', 'Create as a plugin']) expect(html).toContain(s)
    // support.google.com/gemini 17209137
    for (const s of ['Connected Apps', 'Add a custom app', 'in the US']) expect(html).toContain(s)
    expect(html).toContain('href="https://support.claude.com/en/articles/11175166')
    expect(html).toContain('href="https://help.openai.com/en/articles/12584461"')
    expect(html).toContain('href="https://support.google.com/gemini/answer/17209137"')
  })

  it('gives the same commands as the developer page, and Gemini CLI and VS Code', () => {
    expect(source).toContain('claude mcp add --transport http worldpulse ${MCP_URL}')
    expect(developers).toContain('claude mcp add --transport http worldpulse https://api.world-pulse.io/mcp')
    expect(source).toContain('gemini mcp add --transport http worldpulse ${MCP_URL}')
    expect(source).toContain(`code --add-mcp '{"name":"worldpulse","type":"http","url":"\${MCP_URL}"}'`)
    expect(source).toContain('{"mcpServers":{"worldpulse":{"url":"${MCP_URL}"}}}')
  })

  it("says the server's number of tools", () => {
    const block = server.slice(server.indexOf('export const TOOLS'), server.indexOf('export const PROMPTS'))
    const served = [...block.matchAll(/^\s{4}name: '([a-z_]+)',$/gm)].length
    expect(source).toContain(`const TOOL_COUNT = ${served}`)
    expect(html).toContain(`WorldPulse has ${served} tools`)
  })

  it("lists the server's smaller sets, each the size the developer page gives", () => {
    const sizes = (src: string) => Object.fromEntries([...src.matchAll(/\{ id: '([a-z]+)', what: '[^']*?(\d+)[^']*' \}/g)].map(m => [m[1], m[2]]))
    const plans = server.slice(server.indexOf('const SET_PLANS'), server.indexOf('export const TOOL_SETS'))
    const served = [...plans.matchAll(/id: '([a-z]+)', title:/g)].map(m => m[1]).sort()
    expect(Object.keys(sizes(source)).sort()).toEqual(served)
    expect(sizes(source)).toEqual(sizes(developers))
  })

  it('is found from the sitemap, llms.txt and the developer page', async () => {
    expect((await sitemap()).some(p => p.url.endsWith('/ai'))).toBe(true)
    expect(await GET().text()).toContain('https://world-pulse.io/ai')
    expect(developers).toContain('<Link href="/ai"')
  })
})
