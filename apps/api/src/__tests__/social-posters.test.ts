/**
 * Automatic Telegram and Bluesky posts (plan G10, lib/social-posters.ts):
 * off without keys, quiet at night, the best verified story once per
 * channel, spaced out and capped per day, a failure pauses the channel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ListedStory } from '../lib/story-list'

const h = vi.hoisted(() => ({
  kv: new Map<string, string>(),
  ex: new Map<string, number>(),     // each key's EX seconds, as set
  sets: new Map<string, Set<string>>(),
  stories: [] as ListedStory[],
}))

vi.mock('../db/redis', () => ({
  redis: {
    get: async (k: string) => h.kv.get(k) ?? null,
    set: async (k: string, v: string, ...opts: unknown[]) => {
      if (opts.includes('NX') && h.kv.has(k)) return null
      h.kv.set(k, v)
      const i = opts.indexOf('EX')
      if (i >= 0) h.ex.set(k, Number(opts[i + 1]))
      return 'OK'
    },
    del: async (k: string) => { h.kv.delete(k); h.ex.delete(k); return 1 },
    incr: async (k: string) => { const n = Number(h.kv.get(k) ?? 0) + 1; h.kv.set(k, String(n)); return n },
    expire: async () => 1,
    sadd: async (k: string, v: string) => { const s = h.sets.get(k) ?? new Set(); s.add(v); h.sets.set(k, s); return 1 },
    sismember: async (k: string, v: string) => (h.sets.get(k)?.has(v) ? 1 : 0),
    // a minute after it was set
    ttl: async (k: string) => (h.kv.has(k) ? (h.ex.get(k) ?? 3600) - 60 : -2),
  },
}))
vi.mock('../routes/stories', () => ({ topStories: vi.fn(async () => h.stories) }))
// (briefing-email, for newYorkTime, would otherwise connect to Postgres)
vi.mock('../db/postgres', () => ({ db: vi.fn() }))

import { runSocialPosts, postableStories, blueskyText, blueskyIdentifier, blueskySignInShape, blueskyServer, pauseSeconds, storyLink, telegramText, xText } from '../lib/social-posters'

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
  h.kv.clear(); h.ex.clear(); h.sets.clear()
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
    expect(h.ex.get('social:telegram:pause')).toBe(3600)
    expect((await runSocialPosts(minutes(MORNING, 10))).telegram).toBe('paused after an error')
    expect(JSON.parse(h.kv.get('social:status')!).telegram.last_error).toMatch(/Telegram 403/)
    // each pass says what it did, so an hour with no post and no error still reads (Oct 30, 2026)
    expect(JSON.parse(h.kv.get('social:status')!).last_pass).toEqual({ at: minutes(MORNING, 10).toISOString(), telegram: 'paused after an error' })
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

describe('Bluesky, steadier (Nov 25, 2026: the 4:16 PM post failed at "createRecord 502: UpstreamFailure")', () => {
  const PDS = 'https://fibercap.us-west.host.bsky.network'
  const pdsDoc = { service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }] }
  // Bluesky as it answers: the sign-in with its DID document, the account's latest posts, then the picture and the post
  const bluesky = (over: { records?: unknown[]; createRecord?: Response } = {}) => {
    delete process.env.TELEGRAM_BOT_TOKEN
    process.env.BLUESKY_HANDLE = 'world-pulse.io'
    process.env.BLUESKY_APP_PASSWORD = 'abcd-efgh-ijkl-mnop'
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body })
      if (url.endsWith('createSession')) return new Response(JSON.stringify({ accessJwt: 'jwt', did: 'did:plc:wp', didDoc: pdsDoc }), { status: 200 })
      if (url.includes('com.atproto.repo.listRecords')) return new Response(JSON.stringify({ records: over.records ?? [] }), { status: 200 })
      if (url.endsWith('/opengraph-image')) return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 })
      if (url.endsWith('uploadBlob')) return new Response(JSON.stringify({ blob: { ref: 'blob1' } }), { status: 200 })
      if (url.endsWith('createRecord')) return over.createRecord ?? new Response(JSON.stringify({ uri: 'at://x' }), { status: 200 })
      return new Response('{}', { status: 404 })
    }))
  }

  it('signs in at bsky.social, then sends the picture and the post straight to the account\'s own server', async () => {
    bluesky()
    expect((await runSocialPosts(MORNING)).bluesky).toMatch(/^posted: Earthquake number 1/)
    expect(calls.find(c => c.url.endsWith('createSession'))!.url).toBe('https://bsky.social/xrpc/com.atproto.server.createSession')
    expect(calls.find(c => c.url.endsWith('uploadBlob'))!.url).toBe(`${PDS}/xrpc/com.atproto.repo.uploadBlob`)
    expect(calls.find(c => c.url.endsWith('createRecord'))!.url).toBe(`${PDS}/xrpc/com.atproto.repo.createRecord`)
    expect(calls.find(c => c.url.includes('listRecords'))!.url).toBe(`${PDS}/xrpc/com.atproto.repo.listRecords?repo=did%3Aplc%3Awp&collection=app.bsky.feed.post&limit=10`)
  })

  it('counts a story already on the account (a try whose answer was lost) instead of posting it twice', async () => {
    bluesky({ records: [{ value: { embed: { external: { uri: storyLink(story(1), 'bluesky') } } } }] })
    expect((await runSocialPosts(MORNING)).bluesky).toMatch(/^posted: Earthquake number 1/)
    expect(calls.some(c => c.url.endsWith('createRecord'))).toBe(false)
    expect(h.sets.get('social:bluesky:posted')?.has(story(1).leadId)).toBe(true)
    expect(h.kv.get('social:bluesky:count:2026-10-12')).toBe('1')
  })

  it('posts when the account\'s posts can\'t be read', async () => {
    bluesky()
    const real = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url.includes('listRecords') ? new Response('{}', { status: 500 }) : real(url, init))))
    expect((await runSocialPosts(MORNING)).bluesky).toMatch(/^posted:/)
    expect(calls.some(c => c.url.endsWith('createRecord'))).toBe(true)
  })

  it('waits 15 minutes after Bluesky\'s own server fails, then tries again', async () => {
    bluesky({ createRecord: new Response(JSON.stringify({ error: 'UpstreamFailure', message: 'UpstreamFailure' }), { status: 502 }) })
    expect((await runSocialPosts(MORNING)).bluesky).toBe('error: Bluesky com.atproto.repo.createRecord 502: UpstreamFailure')
    expect(h.ex.get('social:bluesky:pause')).toBe(900)
    await runSocialPosts(minutes(MORNING, 10))
    expect(JSON.parse(h.kv.get('social:status')!).last_tries.bluesky.paused_minutes_left).toBe(14)
  })

  it('pauses 15 minutes for a server error or no answer, an hour for anything else', () => {
    expect(pauseSeconds('Bluesky com.atproto.repo.createRecord 502: UpstreamFailure')).toBe(900)
    expect(pauseSeconds('Telegram 503: Service Unavailable')).toBe(900)
    expect(pauseSeconds('The operation was aborted due to timeout')).toBe(900)
    expect(pauseSeconds('fetch failed')).toBe(900)
    expect(pauseSeconds('Bluesky com.atproto.server.createSession 401: Invalid identifier or password (as "world-pulse.io"; password in app-password form)')).toBe(3600)
    expect(pauseSeconds('Bluesky com.atproto.server.createSession 429: Rate Limit Exceeded')).toBe(3600)
    expect(pauseSeconds('Telegram 403: Forbidden')).toBe(3600)
  })

  it('takes the account\'s server from the DID document, else bsky.social', () => {
    expect(blueskyServer(pdsDoc)).toBe(PDS)
    expect(blueskyServer({ service: [{ id: 'did:plc:wp#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com/' }] })).toBe('https://pds.example.com')
    expect(blueskyServer(undefined)).toBe('https://bsky.social')
    expect(blueskyServer({ service: 'nope' })).toBe('https://bsky.social')
    expect(blueskyServer({ service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'http://pds.example.com' }] })).toBe('https://bsky.social')
    expect(blueskyServer({ service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com/x?y=1' }] })).toBe('https://bsky.social')
    expect(blueskyServer({ service: [{ id: '#atproto_labeler', type: 'AtprotoLabeler', serviceEndpoint: 'https://labeler.example.com' }] })).toBe('https://bsky.social')
  })
})

describe('X (plan G7; Devon, Oct 21, 2026: "Yes, 3 a day")', () => {
  const xKeys = () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    process.env.TWITTER_API_KEY = 'ck'; process.env.TWITTER_API_SECRET = 'cs'
    process.env.TWITTER_ACCESS_TOKEN = 'at'; process.env.TWITTER_ACCESS_SECRET = 'as'
  }

  it('a refused Bluesky sign-in says what it was given, never the password (Nov 25, 2026)', async () => {
    process.env.BLUESKY_HANDLE = 'world-pulse.io'
    process.env.BLUESKY_APP_PASSWORD = 'abcd-efgh-ijkl-mnop'
    delete process.env.TELEGRAM_BOT_TOKEN
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('createSession')) return new Response(JSON.stringify({ error: 'AuthenticationRequired', message: 'Invalid identifier or password' }), { status: 401 })
      return new Response('{}', { status: 200 })
    }))
    const r = await runSocialPosts(MORNING)
    expect(r.bluesky).toContain('401: Invalid identifier or password')
    expect(r.bluesky).toContain('as "world-pulse.io"; password in app-password form')
    expect(r.bluesky).not.toContain('abcd-efgh-ijkl-mnop')
  })

  it('describes the sign-in without the password', () => {
    expect(blueskySignInShape('world-pulse.io', 'abcd-efgh-ijkl-mnop')).toBe('as "world-pulse.io"; password in app-password form')
    expect(blueskySignInShape('did:plc:h6qv2my3og23ufuykl4rwdv3', 'x')).toBe('as "did:plc:h6qv2my3og23ufuykl4rwdv3"; password not in app-password form (1 characters)')
    expect(blueskySignInShape('someone@example.com', 'abcd-efgh-ijkl-mnop')).toBe('as an email address; password in app-password form')
    expect(blueskySignInShape("'world-pulse.io'", "'abcd-efgh-ijkl-mnop'")).toBe('as a name that is neither a handle nor a did; password not in app-password form (21 characters)')
    expect(blueskySignInShape('did=did:plc:abc', 'ABCD-EFGH-IJKL-MNOP')).toContain('neither a handle nor a did')
    // the keys swapped: the "handle" holds the app password (made name.bsky.social), which is never shown
    const swapped = blueskySignInShape(blueskyIdentifier('abcd-efgh-ijkl-mnop'), 'world-pulse.io')
    expect(swapped).toBe('as a name in app-password form (the two keys may be swapped); password not in app-password form (14 characters)')
    expect(swapped).not.toContain('abcd')
  })

  it('keeps each channel\'s last try, with the pause left, where a later pass can\'t erase it (Nov 25, 2026)', async () => {
    process.env.BLUESKY_HANDLE = 'world-pulse.io'
    process.env.BLUESKY_APP_PASSWORD = 'abcd-efgh-ijkl-mnop'
    delete process.env.TELEGRAM_BOT_TOKEN
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('createSession')) return new Response(JSON.stringify({ message: 'Rate Limit Exceeded' }), { status: 429 })
      return new Response('{}', { status: 200 })
    }))
    await runSocialPosts(MORNING)
    expect(JSON.parse(h.kv.get('social:bluesky:last_try')!)).toEqual({ at: MORNING.toISOString(), outcome: 'error: Bluesky com.atproto.server.createSession 429: Rate Limit Exceeded' })
    await runSocialPosts(minutes(MORNING, 10))                // paused: the try stays on record
    const st = JSON.parse(h.kv.get('social:status')!)
    expect(st.last_pass.bluesky).toBe('paused after an error')
    expect(st.last_tries.bluesky).toEqual({ at: MORNING.toISOString(), outcome: 'error: Bluesky com.atproto.server.createSession 429: Rate Limit Exceeded', paused_minutes_left: 59 })
    expect(JSON.stringify(st)).not.toContain('abcd-efgh-ijkl-mnop')
  })

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
