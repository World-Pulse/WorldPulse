import Link from 'next/link'
import { pageMetadata, jsonLdText, SITE_URL } from '@/lib/page-metadata'
import { CopyText } from '@/components/ai/CopyText'
import { AI_TOOL_GROUPS, AI_TOOLS, firstSentence } from '@/lib/ai-tool-list'

// Nov 22, 2026 (the listing kit's plan, and Devon: "can all llms find us like the current ones which source us while
// searching?"): every one of the MCP server's tools with a question it answers, so searches such as "news MCP
// server" or "AI tool for ship tracking" find WorldPulse. The titles and questions are lib/ai-tool-list.ts; each
// tool's first sentence comes from the server itself (tools/list), read again once a day.
export const revalidate = 86400

export const metadata = pageMetadata({
  path: '/ai/tools',
  title: `${AI_TOOLS.length} AI tools for world news: the WorldPulse MCP server`,
  description: 'A news MCP server for Claude, ChatGPT, Gemini and any AI assistant: 100 free tools for the top stories, checking a link or a claim, under-reported crises, ships and military aircraft, sanctions and travel advice. Every answer says how many independent outlets reported the story.',
})

const MCP_URL = 'https://api.world-pulse.io/mcp'
const API = (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'https://api.world-pulse.io').replace(/\/+$/, '')

/** Each tool's first sentence as the server describes it now; none when the server doesn't answer (the page keeps its titles and questions) */
async function liveDescriptions(): Promise<Map<string, string>> {
  try {
    const res = await fetch(`${API}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'WorldPulse-Web/1.0 (ai tools page)' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return new Map()
    const raw = await res.text()
    const body = raw.trimStart().startsWith('{') ? raw : (raw.split('\n').find(l => l.startsWith('data:'))?.slice(5) ?? '')
    const tools: unknown = JSON.parse(body)?.result?.tools
    if (!Array.isArray(tools)) return new Map()
    return new Map(tools
      .filter((x): x is { name: string; description: string } => typeof x?.name === 'string' && typeof x?.description === 'string')
      .map(x => [x.name, firstSentence(x.description)]))
  } catch {
    return new Map()
  }
}

export default async function AiToolsPage() {
  const live = await liveDescriptions()
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'WorldPulse AI tools',
    url: `${SITE_URL}/ai/tools`,
    numberOfItems: AI_TOOLS.length,
    itemListElement: AI_TOOLS.map((tool, i) => ({ '@type': 'ListItem', position: i + 1, name: tool.title, description: tool.ask, url: `${SITE_URL}/ai/tools#${tool.name}` })),
  }
  return (
    <div className="min-h-screen bg-wp-bg text-wp-text">
      <main className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-xs font-mono uppercase tracking-wider text-wp-text3">
          <Link href="/ai" className="hover:text-wp-text">Use WorldPulse in your AI assistant</Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold text-wp-text text-balance">{AI_TOOLS.length} AI tools for world news</h1>
        <p className="text-sm text-wp-text2 mt-2 leading-relaxed">
          WorldPulse is a news MCP server. Add it to Claude, ChatGPT, Gemini or any AI assistant and ask about the news in your own words: the
          assistant picks the tool. Every answer says how many independent outlets reported each story, whether it is verified, and links to it,
          so you can check. Free, no account, no key, and it only reads.
        </p>

        <section className="mt-6">
          <h2 className="text-xs font-mono uppercase tracking-wider text-wp-text3 mb-2">The address to add</h2>
          <CopyText text={MCP_URL} />
          <p className="text-xs text-wp-text3 mt-2 leading-relaxed">
            <Link href="/ai" className="underline hover:text-wp-text">Step by step for Claude, ChatGPT, Gemini, Grok, Le Chat and more</Link>
          </p>
        </section>

        <nav className="mt-8 flex flex-wrap gap-2" aria-label="Kinds of question">
          {AI_TOOL_GROUPS.map(g => (
            <a key={g.id} href={`#${g.id}`} className="text-xs rounded-full border border-[rgba(255,255,255,0.1)] px-3 py-1 text-wp-text2 hover:text-wp-text">
              {g.title} · {g.tools.length}
            </a>
          ))}
        </nav>

        {AI_TOOL_GROUPS.map(g => (
          <section key={g.id} id={g.id} className="mt-10 scroll-mt-6">
            <h2 className="text-lg font-semibold text-wp-text">{g.title}</h2>
            <ul className="mt-2 divide-y divide-[rgba(255,255,255,0.06)]">
              {g.tools.map(tool => (
                <li key={tool.name} id={tool.name} className="py-3 scroll-mt-6">
                  <h3 className="text-sm font-semibold text-wp-text">
                    {tool.title} <code className="ml-1 text-[11px] font-mono font-normal text-wp-text3">{tool.name}</code>
                  </h3>
                  <p className="text-sm text-wp-amber mt-1">&ldquo;{tool.ask}&rdquo;</p>
                  {live.get(tool.name) && <p className="text-xs text-wp-text3 mt-1 leading-relaxed">{live.get(tool.name)}</p>}
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="text-xs text-wp-text3 mt-10 leading-relaxed">
          For developers: the server&rsquo;s smaller sets of tools and the same data as an API are on{' '}
          <Link href="/developers#mcp" className="underline hover:text-wp-text">the developers page</Link>.
        </p>
      </main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(jsonLd) }} />
    </div>
  )
}
