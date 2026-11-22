import Link from 'next/link'
import { pageMetadata } from '@/lib/page-metadata'
import { CopyText } from '@/components/ai/CopyText'

// Nov 21, 2026 (Devon: a simple "Use WorldPulse in Claude, Gemini, or ChatGPT" page, and every AI tool): the MCP
// server (apps/api/src/routes/mcp.ts) step by step in the assistants people use. Each app's steps are from its own
// help page, as of Nov 21, 2026: support.claude.com 11175166, help.openai.com 12584461, support.google.com/gemini
// 17209137, help.mistral.ai 393572, VS Code's MCP configuration reference and Gemini CLI's MCP docs. The developer
// page (/developers#mcp) has the full tool list; a test checks the count and the smaller sets against the server.
// Nov 22, 2026 (Devon: "can you do these for me?"): Grok and Le Chat as their own cards, Perplexity and Microsoft
// Copilot Studio with the other apps, from docs.x.ai/grok/connectors, help.mistral.ai 393572, Microsoft Learn's
// "Connect your agent to an existing MCP server" and a Perplexity setup guide (Perplexity has no public page on it).
export const metadata = pageMetadata({
  path: '/ai',
  title: 'Use WorldPulse in Claude, ChatGPT or Gemini',
  description: 'Add WorldPulse to Claude, ChatGPT, Gemini, Grok, Le Chat, Perplexity, Copilot or any AI assistant and get answers that say how many independent outlets reported each story. Free, no sign-up, no key.',
})

const MCP_URL = 'https://api.world-pulse.io/mcp'

const B = ({ children }: { children: React.ReactNode }) => <span className="font-semibold text-wp-text">{children}</span>

const APPS: Array<{ id: string; name: string; where: string; who: React.ReactNode; steps: React.ReactNode[]; help: string }> = [
  {
    id: 'claude',
    name: 'Claude',
    where: 'On claude.ai or the Claude desktop app. Once added, it works in the phone app too.',
    who: 'Every plan, Free included (Free allows one custom connector). On a Team or Enterprise plan, an owner adds it once in Organization settings, Connectors, and you click Connect.',
    steps: [
      <>Open <B>Customize</B>, then <B>Connectors</B>.</>,
      <>Click <B>+ Add</B>, then <B>Add custom connector</B>.</>,
      <>Name it WorldPulse, paste the address above and click <B>Continue</B>.</>,
      <>Under <B>Authentication</B>, choose <B>No sign in</B>, then click <B>Add</B>.</>,
      <>In a chat, click <B>+</B>, then <B>Connectors</B>, and turn WorldPulse on.</>,
    ],
    help: 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    where: 'On chatgpt.com, on a computer.',
    who: 'ChatGPT Pro, Business, Enterprise and Edu. On Business an admin or owner adds it; on Enterprise and Edu an admin, or someone they allow.',
    steps: [
      <>Go to <a href="https://chatgpt.com/plugins" className="text-wp-amber underline" rel="noopener noreferrer" target="_blank">chatgpt.com/plugins</a>.</>,
      <>Click <B>+</B>, then <B>Add custom MCP server</B>.</>,
      <>Name it WorldPulse. Under <B>Connection</B>, paste the address above.</>,
      <>For authentication, choose <B>No authentication</B>.</>,
      <>Tick <B>I understand and want to continue</B>, click <B>Create as a plugin</B>, then install it.</>,
      <>In a new chat, type <B>@</B> and pick WorldPulse.</>,
    ],
    help: 'https://help.openai.com/en/articles/12584461',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    where: 'On gemini.google.com, on a computer. Once added, it works in the phone app too.',
    who: 'A personal Google account (not work or school), 18 or older, in the US, with Gemini in English and its history on.',
    steps: [
      <>Open <B>gemini.google.com</B> and click <B>Settings</B>, then <B>Connected Apps</B>. (Not there? <B>Personal Intelligence</B>, then <B>Connected Apps</B>.)</>,
      <>Under <B>Custom apps</B>, click <B>Add a custom app</B>.</>,
      <>Paste the address above, click <B>Next</B> and follow the steps on screen. WorldPulse needs no sign-in.</>,
      <>In a chat, type <B>@</B> and pick WorldPulse.</>,
    ],
    help: 'https://support.google.com/gemini/answer/17209137',
  },
  {
    id: 'grok',
    name: 'Grok',
    where: 'On grok.com.',
    who: 'Every Grok user. On Grok Business or Enterprise, a team admin sets up connectors first.',
    steps: [
      <>Go to <a href="https://grok.com/connectors" className="text-wp-amber underline" rel="noopener noreferrer" target="_blank">grok.com/connectors</a>.</>,
      <>Click <B>New Connector</B>, then <B>Custom</B>.</>,
      <>Paste the address above. WorldPulse needs no sign-in.</>,
      <>Ask Grok about the news.</>,
    ],
    help: 'https://docs.x.ai/grok/connectors',
  },
  {
    id: 'le-chat',
    name: 'Le Chat',
    where: 'On chat.mistral.ai.',
    who: 'Free, Pro and Student plans: the account owner adds it.',
    steps: [
      <>In the side panel, open <B>Intelligence</B>, then <B>Connectors</B>.</>,
      <>Click <B>+ Add Connector</B> and open the <B>Custom MCP Connector</B> tab.</>,
      <>Name it worldpulse, paste the address in <B>Connection server</B> and click <B>Connect</B>. WorldPulse needs no sign-in.</>,
    ],
    help: 'https://help.mistral.ai/en/articles/393572-configuring-a-custom-connector',
  },
]

/** Apps set up with one command or one line of settings */
const COMMANDS: Array<{ name: string; how: string; text: string }> = [
  { name: 'Claude Code', how: 'In a terminal:', text: `claude mcp add --transport http worldpulse ${MCP_URL}` },
  { name: 'Gemini CLI', how: 'In a terminal:', text: `gemini mcp add --transport http worldpulse ${MCP_URL}` },
  { name: 'VS Code (GitHub Copilot)', how: 'In a terminal:', text: `code --add-mcp '{"name":"worldpulse","type":"http","url":"${MCP_URL}"}'` },
  { name: 'Cursor', how: 'In .cursor/mcp.json:', text: `{"mcpServers":{"worldpulse":{"url":"${MCP_URL}"}}}` },
]

/** The smaller sets (routes/mcp.ts TOOL_SETS; a test checks these against the developer page's) */
const SETS = [
  { id: 'essentials', what: 'the 28 most used tools' },
  { id: 'news', what: 'the news now, one story and checking: 39 tools' },
  { id: 'places', what: 'countries, regions and topics: 38 tools' },
  { id: 'outlets', what: 'outlets, people and organisations: 19 tools' },
  { id: 'live', what: 'aircraft, ships, hazards and government feeds: 16 tools' },
]

/** Questions to start with (each answered by one of the server's tools) */
const ASK = [
  'What are the top verified stories right now?',
  'How many outlets reported this? (paste a link)',
  'What is happening in Sudan today, and whose newsrooms are reporting it?',
  'Which crises are getting the least coverage this week?',
  'Do several newsrooms report this claim, or just one?',
  'Who reported this story first, and how did it spread?',
  'What did the world’s press report that English-language news missed?',
]

const TOOL_COUNT = 100

export default function UseInAiPage() {
  return (
    <div className="min-h-screen bg-wp-bg text-wp-text">
      <main className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-wp-text text-balance">Use WorldPulse in Claude, ChatGPT or Gemini</h1>
        <p className="text-sm text-wp-text2 mt-2 leading-relaxed">
          Add WorldPulse to your AI assistant (Claude, ChatGPT, Gemini, Grok, Le Chat, Perplexity, Copilot and more) and ask it about the news. Its answers then say how many independent outlets reported
          each story, whether the story is verified, and link to it, so you can check. Free, no account, no key, and it only reads.
        </p>

        <section id="address" className="mt-8">
          <h2 className="text-xs font-mono uppercase tracking-wider text-wp-text3 mb-2">The address to add</h2>
          <CopyText text={MCP_URL} />
          <p className="text-xs text-wp-text3 mt-2 leading-relaxed">
            It is an MCP server: MCP is the standard way AI assistants call outside tools. Your assistant connects to it for you.
          </p>
        </section>

        <div className="mt-10 space-y-6">
          {APPS.map(app => (
            <section key={app.id} id={app.id} className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5">
              <h2 className="text-lg font-semibold text-wp-text">{app.name}</h2>
              <p className="text-sm text-wp-text2 mt-1 leading-relaxed">{app.where}</p>
              <p className="text-xs text-wp-text3 mt-1 leading-relaxed"><span className="font-semibold">Who can:</span> {app.who}</p>
              <ol className="list-decimal pl-5 mt-3 space-y-1.5 text-sm text-wp-text2 leading-relaxed">
                {app.steps.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
              <p className="text-xs text-wp-text3 mt-3">
                Steps from <a href={app.help} className="text-wp-amber underline" rel="noopener noreferrer" target="_blank">{app.name}&rsquo;s help page</a>; menus can move as apps change.
              </p>
            </section>
          ))}
        </div>

        <section id="ask" className="mt-10">
          <h2 className="text-base font-semibold text-wp-text">Then ask</h2>
          <ul className="list-disc pl-5 mt-2 space-y-1.5 text-sm text-wp-text2 leading-relaxed">
            {ASK.map(q => <li key={q}>&ldquo;{q}&rdquo;</li>)}
          </ul>
          <p className="text-sm text-wp-text2 mt-3 leading-relaxed">
            Verified means two or more outlets report the story, not that it is proven true. <Link href="/how-we-count" className="text-wp-amber underline">How we count</Link>.
          </p>
        </section>

        <section id="other" className="mt-10">
          <h2 className="text-base font-semibold text-wp-text">Other AI apps</h2>
          <div className="mt-3 space-y-4">
            {COMMANDS.map(c => (
              <div key={c.name}>
                <p className="text-sm text-wp-text2 mb-1.5"><span className="font-semibold text-wp-text">{c.name}.</span> {c.how}</p>
                <CopyText text={c.text} />
              </div>
            ))}
            <p className="text-sm text-wp-text2 leading-relaxed">
              <span className="font-semibold text-wp-text">Perplexity</span> (Pro and Enterprise). In <B>Settings</B>, click <B>+ Custom connector</B> and choose{' '}
              <B>Remote</B>. Name it WorldPulse, paste the address and click <B>Add</B>; it needs no sign-in. On Enterprise, an admin first allows custom connectors.
            </p>
            <p className="text-sm text-wp-text2 leading-relaxed">
              <span className="font-semibold text-wp-text">Microsoft Copilot Studio</span> (for a company&rsquo;s own agents). In your agent, open <B>Tools</B>,{' '}
              <B>Add a tool</B>, <B>New tool</B>, then <B>Model Context Protocol</B>. Name it WorldPulse, paste the address, choose <B>None</B> for authentication and click{' '}
              <B>Create</B>, then <B>Add to agent</B>.
            </p>
            <p className="text-sm text-wp-text2 leading-relaxed">
              <span className="font-semibold text-wp-text">Any other app that takes MCP servers.</span> Add the address as a remote server (Streamable HTTP), with no sign-in.
            </p>
          </div>
        </section>

        <section id="fewer" className="mt-10">
          <h2 className="text-base font-semibold text-wp-text">Fewer tools</h2>
          <p className="text-sm text-wp-text2 mt-2 leading-relaxed">
            WorldPulse has {TOOL_COUNT} tools. Some apps take 40 at most, and an assistant can pick better among fewer: add one of these
            addresses instead, the same server with one set of its tools.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-wp-text2">
            {SETS.map(s => (
              <li key={s.id}><code className="font-mono text-[13px] text-wp-cyan break-all">{`${MCP_URL}/${s.id}`}</code>: {s.what}</li>
            ))}
          </ul>
        </section>

        <section id="what" className="mt-10">
          <h2 className="text-base font-semibold text-wp-text">What it does with your questions</h2>
          <ul className="list-disc pl-5 mt-2 space-y-1.5 text-sm text-wp-text2 leading-relaxed">
            <li>It only reads: it can&rsquo;t post, change or delete anything, and it never asks who you are.</li>
            <li>It gets the question your assistant sends a tool (a country or a link, say), not your conversation, and doesn&rsquo;t keep it: only a daily count of how often each tool was used. <Link href="/privacy#reading" className="text-wp-amber underline">Privacy policy</Link>.</li>
            <li>It answers from the same stories as this site, with each story&rsquo;s world-pulse.io link.</li>
          </ul>
        </section>

        <p className="text-sm text-wp-text2 mt-10 leading-relaxed">
          Building something? The full tool list, the public API and the feeds are on the <Link href="/developers#mcp" className="text-wp-amber underline">developer page</Link>.
          Stuck? Email <span className="text-wp-text select-all">support@world-pulse.io</span>.
        </p>
      </main>
    </div>
  )
}
