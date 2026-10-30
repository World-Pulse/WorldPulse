/**
 * Automatic Telegram and Bluesky posts (plan G10, lib/social-posters.ts):
 * off without keys, quiet at night, the best verified story once per
 * channel, spaced out and capped per day, a failure pauses the channel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ListedStory } from '../lib/story-list'

const h = vi.hoisted(() => ({
  kv: new Map<string, string>(),
  sets: new Map<string, Set<string>>(),
  stories: [] as ListedStory[],
}))

vi.mock('../db/redis', () => ({
  redis: {
    get: async (k: string) => h.kv.get(k) ?? null,
    set: async (k: string, v: string, ...opts: unknown[]) => {
      if (opts.includes('NX') && h.kv.has(k)) return null
      h.kv.set(k, v); return 'OK'
    },
    del: async (k: string) => { h.kv.delete(k); return 1 },
    incr: async (k: string) => { const n = Number(h.kv.get(k) ?? 0) + 1; h.kv.set(k, String(n)); return n },
    expire: async () => 1,
    sadd: async (k: string, v: string) => { const s = h.sets.get(k) ?? new Set(); s.add(v); h.sets.set(k, s); return 1 },
    sismember: async (k: string, v: string) => (h.sets.get(k)?.has(v) ? 1 : 0),
  },
}))
vi.mock('../routes/stories', () => ({ topStories: vi.fn(async () => h.stories) }))
// (briefing-email, for newYorkTime, would otherwise connect to Postgres)
vi.mock('../db/postgres', () => ({ db: vi.fn() }))

import { runSocialPosts, postableStories, blueskyText, blueskyIdentifier, telegramText, xText } from '../lib/social-posters'

const story = (n: number, extra: Partial<ListedStory> = {}): ListedStory => ({
  id: `story-${n}`, leadId: `${n}${n}${n}${n}${n}${n}${n}${n}-0000-0000-0000-000000000000`,
  title: `Earthquake number ${n} shakes the coast`, category: 'disaster', place: 'Chile', severity: 'high',
  size: 5, outlets: ['reuters.com', 'apnews.com', 'bbc.co.uk', 'example.org'], outletCount: 5,
  firstSeenAt: '2026-10-12T10:00:00Z', updatedAt: '2026-10-12T11:00:00Z', verifiedAt: '2026-10-12T11:00:00Z', ...extra,
})

// 10:00 AM New York (EDT) on Oct 12, 2026
const MORNING = new Date('2026-10-12T14:00:00Z')
const minutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000)

let calls: Array<{ url: string; body: unknown }>
beforeEach(() => {
  h.kv.clear(); h.sets.clear()
  h.stories = [story(1), story(2), story(3)]
  calls = []
  process.env.TELEGRAM_BOT_TOKEN = '123:secret'
  process.env.TELEGRAM_CHANNEL = '@worldpulse'
  delete process.env.BLUESKY_HANDLE
  delete process.env.BLUESKY_APP_PASSWORD
  for (const k of ['TWITTER_API_KEY', 'TWITTER_API_SECRET', 'TWITTER_ACCESS_TOKEN', 'TWITTER_ACCESS_SECRET']) delete process.env[k]
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body
    calls.push({ url, body })
    if (url.includes('api.telegram.org')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
    if (url.endsWith('createSession')) return new Response(JSON.stringify({ accessJwt: 'jwt', did: 'did:plc:wp' }), { status: 200 })
    if (url.endsWith('/opengraph-image')) return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 })
    if (url.endsWith('uploadBlob')) return new Response(JSON.stringify({ blob: { ref: 'blob1' } }), { status: 200 })
    if (url.endsWith('createRecord')) return new Response(JSON.stringify({ uri: 'at://x' }), { status: 200 })
    if (url === 'https://api.x.com/2/tweets') return new Response(JSON.stringify({ data: { id: '1', text: 'ok' } }), { status: 201 })
    return new Response('{}', { status: 404 })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('which stories go out', () => {
  it('only verified stories with 3+ outlets, English headlines, not sports or culture', () => {
    const picked = postableStories([
      story(1),
      story(2, { verifiedAt: null }),
      story(3, { outletCount: 2 }),
      story(4, { category: 'sports' }),
      story(5, { title: 'Le président annonce des mesures pour la région' }),
      story(6, { title: '东京发生地震' }),
    ])
    expect(picked.map(s => s.id)).toEqual(['story-1'])
  })

  it('writes posts that name the outlets and fit Bluesky', () => {
    const s = story(1, { title: 'A'.repeat(400) })
    expect([...blueskyText(s)].length).toBeLessThanOrEqual(300)
    expect(telegramText(story(1))).toContain('Verified · 5 outlets, including Reuters, AP and BBC')
    expect(telegramText(story(1))).toContain('utm_source=telegram&utm_medium=social&utm_campaign=auto')
  })
})

describe('posting', () => {
  it('does nothing without keys', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    expect(await runSocialPosts(MORNING)).toEqual({ telegram: 'off', bluesky: 'off', x: 'off' })
    expect(calls).toHaveLength(0)
  })

  it('stays quiet at night (New York)', async () => {
    const r = await runSocialPosts(new Date('2026-10-12T06:00:00Z'))   // 2 AM New York
    expect(r.telegram).toBe('quiet hours')
    expect(calls).toHaveLength(0)
  })

  it('posts the best story once, waits between posts, then posts the next one', async () => {
    expect((await runSocialPosts(MORNING)).telegram).toMatch(/^posted: Earthquake number 1/)
    expect((calls[0]!.body as { chat_id: string }).chat_id).toBe('@worldpulse')
    expect((await runSocialPosts(minutes(MORNING, 30))).telegram).toBe('waiting between posts')
    expect((await runSocialPosts(minutes(MORNING, 80))).telegram).toMatch(/^posted: Earthquake number 2/)
    expect(calls.filter(c => c.url.includes('telegram'))).toHaveLength(2)
  })

  it('stops at the daily limit', async () => {
    h.kv.set('social:telegram:count:2026-10-12', '8')
    expect((await runSocialPosts(MORNING)).telegram).toBe('daily limit reached')
  })

  it('pauses a channel for an hour after a failure, without printing the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, description: 'Forbidden: bot123:secret is not a member' }), { status: 403 })))
    const r = await runSocialPosts(MORNING)
    expect(r.telegram).toMatch(/^error: Telegram 403/)
    expect(r.telegram).not.toContain('123:secret')
    expect(h.kv.get('social:telegram:pause')).toBe('1')
    expect((await runSocialPosts(minutes(MORNING, 10))).telegram).toBe('paused after an error')
    expect(JSON.parse(h.kv.get('social:status')!).telegram.last_error).toMatch(/Telegram 403/)
  })

  it('posts to Bluesky with the story card as the link preview', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    process.env.BLUESKY_HANDLE = 'worldpulse.bsky.social'
    process.env.BLUESKY_APP_PASSWORD = 'app-pass'
    expect((await runSocialPosts(MORNING)).bluesky).toMatch(/^posted:/)
    const record = calls.find(c => c.url.endsWith('createRecord'))!.body as { record: { text: string; embed: { external: { uri: string; thumb: unknown } } } }
    expect(record.record.embed.external.uri).toContain('utm_source=bluesky')
    expect(record.record.embed.external.thumb).toEqual({ ref: 'blob1' })
    expect(record.record.text).toContain('Verified · 5 outlets')
  })

  it('signs in to Bluesky with the handle as people copy it (Oct 30, 2026: "Invalid identifier or password")', async () => {
    expect(blueskyIdentifier('@worldpulse.bsky.social')).toBe('worldpulse.bsky.social')
    expect(blueskyIdentifier('  worldpulse.bsky.social \t')).toBe('worldpulse.bsky.social')
    expect(blueskyIdentifier('https://bsky.app/profile/worldpulse.bsky.social')).toBe('worldpulse.bsky.social')
    expect(blueskyIdentifier('worldpulse')).toBe('worldpulse.bsky.social')
    expect(blueskyIdentifier('world-pulse.io')).toBe('world-pulse.io')
    expect(blueskyIdentifier('newsdesk@example.org')).toBe('newsdesk@example.org')
    expect(blueskyIdentifier('did:plc:wp')).toBe('did:plc:wp')
    expect(blueskyIdentifier(undefined)).toBe('')
    delete process.env.TELEGRAM_BOT_TOKEN
    process.env.BLUESKY_HANDLE = '@worldpulse.bsky.social '
    process.env.BLUESKY_APP_PASSWORD = ' app-pass\t'
    expect((await runSocialPosts(MORNING)).bluesky).toMatch(/^posted:/)
    expect(calls.find(c => c.url.endsWith('createSession'))!.body).toEqual({ identifier: 'worldpulse.bsky.social', password: 'app-pass' })
  })
})

describe('X (plan G7; Devon, Oct 21, 2026: "Yes, 3 a day")', () => {
  const xKeys = () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    process.env.TWITTER_API_KEY = 'ck'; process.env.TWITTER_API_SECRET = 'cs'
    process.env.TWITTER_ACCESS_TOKEN = 'at'; process.env.TWITTER_ACCESS_SECRET = 'as'
  }

  it('fits 280 characters, a link counting as 23', () => {
    const t = xText(story(1, { title: 'A'.repeat(400) }))
    const link = t.slice(t.lastIndexOf('\n') + 1)
    expect(link).toMatch(/^https:\/\/world-pulse\.io\/signals\/.+utm_source=x&utm_medium=social/)
    expect([...t.slice(0, t.lastIndexOf('\n') + 1)].length + 23).toBeLessThanOrEqual(280)
    expect(xText(story(1))).toContain('Earthquake number 1 shakes the coast\n\n✓ Verified · 5 outlets, including Reuters, AP and BBC · Chile\n')
  })

  it('posts the best story with the account\'s own keys, signed', async () => {
    xKeys()
    expect((await runSocialPosts(MORNING)).x).toMatch(/^posted: Earthquake number 1/)
    const post = calls.find(c => c.url === 'https://api.x.com/2/tweets')!
    expect((post.body as { text: string }).text).toContain('utm_source=x')
  })

  it('three a day, four hours apart', async () => {
    xKeys()
    expect((await runSocialPosts(MORNING)).x).toMatch(/^posted:/)
    expect((await runSocialPosts(minutes(MORNING, 120))).x).toBe('waiting between posts')
    h.kv.set('social:x:count:2026-10-12', '3')
    expect((await runSocialPosts(minutes(MORNING, 300))).x).toBe('daily limit reached')
  })
})
