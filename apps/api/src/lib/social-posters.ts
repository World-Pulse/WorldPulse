/**
 * Automatic posts to WorldPulse's Telegram channel and Bluesky account (plan
 * G10; Devon approved both channels with automatic posting, Oct 11, 2026).
 * Each is off until its keys are on the server: TELEGRAM_BOT_TOKEN and
 * TELEGRAM_CHANNEL (the channel's @name, with the bot as an admin that can
 * post), or BLUESKY_HANDLE and BLUESKY_APP_PASSWORD (Settings → App
 * passwords; never the account password).
 *
 * X (@WorldPulse_io) since Oct 21, 2026 (plan G7; Devon: "Yes, 3 a day"):
 * off until TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN and
 * TWITTER_ACCESS_SECRET are on the server (an X developer account with
 * pay-per-use credits, about $0.20 a post with a link). Three a day, at least
 * four hours apart. The old PULSE X agent, up to 15 a day, stays off.
 *
 * Every 10 minutes from 6 AM to 11 PM New York time, each channel posts the
 * highest-ranked verified story of the last 12 hours it hasn't posted yet: 3+
 * independent outlets, an English headline, not sports or culture. At most
 * PER_DAY a day per channel and GAP_MINUTES apart. A failure pauses that
 * channel for an hour, or 15 minutes when the channel's own server failed or
 * didn't answer (pauseSeconds). Each story goes out once per channel. ops-status
 * shows the result (Redis social:status).
 */

import { redis } from '../db/redis'
import { topStories } from '../routes/stories'
import { newYorkTime } from './briefing-email'
import { outletNames, joinNames } from './outlet-names'
import type { ListedStory } from './story-list'
import { isTwitterConfigured, postTweet } from './pulse/agents/twitter-client'

export type Channel = 'telegram' | 'bluesky' | 'x'

const SITE_URL = (process.env.FRONTEND_URL || 'https://world-pulse.io').replace(/\/+$/, '')
const BLUESKY_HOST = 'https://bsky.social'
const RULES: Record<Channel, { perDay: number; gapMinutes: number }> = {
  telegram: { perDay: 8, gapMinutes: 75 },
  bluesky:  { perDay: 6, gapMinutes: 90 },
  x:        { perDay: 3, gapMinutes: 240 },
}
const FIRST_HOUR = 6     // New York time
const LAST_HOUR = 22     // posts until 10:59 PM
const MIN_OUTLETS = 3
const SKIP_CATEGORIES = new Set(['other', 'sports', 'culture', 'entertainment', 'lifestyle', 'celebrity'])
const FOREIGN = /\b(de|la|le|les|des|du|et|el|los|las|und|der|die|das|il|della|che)\b/i
const POSTED_TTL = 14 * 86_400
const TICK_MS = 10 * 60_000

function configured(channel: Channel): boolean {
  if (channel === 'telegram') return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL)
  if (channel === 'bluesky') return Boolean(process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD)
  return isTwitterConfigured()
}

/** A headline in English: mostly Latin letters, no common French/Spanish/German/Italian words */
function english(title: string): boolean {
  const letters = title.replace(/[^\p{L}]/gu, '')
  const latin = letters.replace(/[^A-Za-z]/g, '')
  return letters.length > 0 && latin.length / letters.length >= 0.9 && !FOREIGN.test(title)
}

/** Stories worth posting, best first */
export function postableStories(stories: ListedStory[]): ListedStory[] {
  return stories.filter(s =>
    s.verifiedAt !== null &&
    s.outletCount >= MIN_OUTLETS &&
    !SKIP_CATEGORIES.has(s.category ?? 'other') &&
    english(s.title))
}

export function storyLink(s: ListedStory, channel: Channel): string {
  return `${SITE_URL}/signals/${encodeURIComponent(s.leadId)}?utm_source=${channel}&utm_medium=social&utm_campaign=auto&utm_content=${encodeURIComponent(s.leadId.slice(0, 8))}`
}

function verifiedLine(s: ListedStory): string {
  const names = outletNames(s.outlets)
  return `Verified · ${s.outletCount} outlets${names.length ? `, including ${joinNames(names)}` : ''}`
}

const escapeHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The Telegram message: headline, place, outlets, link (Telegram shows the story's card) */
export function telegramText(s: ListedStory): string {
  return [
    `<b>${escapeHtml(s.title)}</b>`,
    `${s.place ? `📍 ${escapeHtml(s.place)} · ` : ''}✓ ${escapeHtml(verifiedLine(s))}`,
    storyLink(s, 'telegram'),
  ].join('\n')
}

/** Bluesky counts graphemes, at most 300; the link goes in the card, not the text */
export function blueskyText(s: ListedStory): string {
  const tail = `\n\n✓ ${verifiedLine(s)}${s.place ? ` · ${s.place}` : ''}`
  const room = 300 - [...tail].length
  const title = [...s.title].length > room ? `${[...s.title].slice(0, room - 1).join('').trimEnd()}…` : s.title
  return `${title}${tail}`.slice(0, 1000)
}

/** X counts a link as 23 characters, whatever its length; 280 in all */
const X_LINK = 23
export function xText(s: ListedStory): string {
  const tail = `\n\n✓ ${verifiedLine(s)}${s.place ? ` · ${s.place}` : ''}`
  const room = 280 - X_LINK - 1 - [...tail].length
  const title = [...s.title].length > room ? `${[...s.title].slice(0, Math.max(0, room - 1)).join('').trimEnd()}…` : s.title
  return `${title}${tail}\n${storyLink(s, 'x')}`
}

async function xPost(s: ListedStory): Promise<void> {
  const r = await postTweet(xText(s))
  if (!r.success) throw new Error(`X: ${String(r.error ?? 'no answer').slice(0, 120)}`)
}

async function telegramPost(s: ListedStory): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHANNEL, text: telegramText(s), parse_mode: 'HTML' }),
    signal: AbortSignal.timeout(15_000),
  })
  const body = await res.json().catch(() => null) as { ok?: boolean; description?: string } | null
  if (!res.ok || !body?.ok) throw new Error(`Telegram ${res.status}: ${String(body?.description ?? 'no answer').slice(0, 120)}`)
}

async function bsky<T>(path: string, init: RequestInit, server: string = BLUESKY_HOST): Promise<T> {
  const res = await fetch(`${server}/xrpc/${path}`, { ...init, signal: AbortSignal.timeout(20_000) })
  const body = await res.json().catch(() => null) as (T & { message?: string }) | null
  if (!res.ok || !body) throw new Error(`Bluesky ${path.split('?')[0]} ${res.status}: ${String(body?.message ?? 'no answer').slice(0, 120)}`)
  return body
}

/**
 * The account's own server (its PDS), named in the DID document Bluesky's sign-in answers with, so the picture and
 * the post go to it straight rather than through bsky.social, as Bluesky's own app does (Nov 25, 2026: the second
 * post, at 4:16 PM, failed at "com.atproto.repo.createRecord 502: UpstreamFailure", bsky.social's call on to the
 * account's server). bsky.social when the document names no https server.
 */
export function blueskyServer(didDoc: unknown): string {
  const services = (didDoc && typeof didDoc === 'object' ? (didDoc as { service?: unknown }).service : null)
  if (!Array.isArray(services)) return BLUESKY_HOST
  for (const s of services) {
    const { id, type, serviceEndpoint } = (s && typeof s === 'object' ? s : {}) as { id?: unknown; type?: unknown; serviceEndpoint?: unknown }
    if (typeof id === 'string' && id.endsWith('#atproto_pds') && type === 'AtprotoPersonalDataServer'
      && typeof serviceEndpoint === 'string' && /^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(serviceEndpoint)) {
      return serviceEndpoint.replace(/\/$/, '')
    }
  }
  return BLUESKY_HOST
}

/**
 * Whether the account's latest posts already link this story (an answer like a 502 can come after the post was
 * saved, and the next try would post it twice). A check that fails is no reason not to post.
 */
async function blueskyHasPosted(server: string, did: string, link: string): Promise<boolean> {
  try {
    const page = await bsky<{ records?: Array<{ value?: { embed?: { external?: { uri?: unknown } } } }> }>(
      `com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=app.bsky.feed.post&limit=10`, { method: 'GET' }, server)
    return (page.records ?? []).some(r => r?.value?.embed?.external?.uri === link)
  } catch {
    return false
  }
}

/**
 * How long a channel waits after a failed try: 15 minutes when the channel's own server failed (a 5xx answer) or
 * didn't answer in time, which usually passes in minutes (Nov 25, 2026: Bluesky's 502 at 4:16 PM held the second
 * post for an hour); an hour for anything else, such as a refused sign-in or a rate limit.
 */
export function pauseSeconds(message: string): number {
  return / 5\d\d: /.test(message) || /timeout|timed out|aborted|fetch failed/i.test(message) ? 900 : 3600
}

/**
 * The handle as Bluesky's sign-in takes it (Oct 30, 2026: the first post, at 6:02 AM New York time, was
 * refused with "Invalid identifier or password"). A handle is often copied as the profile shows it,
 * "@name.bsky.social", with a space around it, or as the profile's address; a bare "name" is
 * name.bsky.social. An email address or a did: is used as given.
 */
export function blueskyIdentifier(raw: string | undefined): string {
  let v = (raw || '').trim()
  const profile = /^https?:\/\/(?:www\.)?bsky\.app\/profile\/([^/?#\s]+)/i.exec(v)
  if (profile?.[1]) v = profile[1]
  v = v.replace(/^@+/, '')
  if (v && !v.includes('.') && !v.includes('@') && !v.startsWith('did:')) v += '.bsky.social'
  return v
}

/**
 * What a refused sign-in was given, safe for the status file (Nov 25, 2026: every sign-in since Oct 30 was
 * refused with "Invalid identifier or password", with three different sets of keys): the name it signed in
 * with when that is a handle or a did: (both public; an email address is only called one), and whether the
 * password has an app password's form (four groups of four letters or digits, xxxx-xxxx-xxxx-xxxx). Never
 * the password itself.
 */
export function blueskySignInShape(identifier: string, password: string): string {
  // a name holding an app password (the two keys swapped) is never shown either
  const swapped = /[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.test(identifier) || (password.length > 0 && identifier.includes(password))
  const who = identifier.includes('@') ? 'an email address'
    : swapped ? 'a name in app-password form (the two keys may be swapped)'
    : /^(did:[a-z0-9]+:[A-Za-z0-9._:-]{1,200}|[A-Za-z0-9.-]{1,253})$/.test(identifier) ? `"${identifier}"`
    : 'a name that is neither a handle nor a did'
  const form = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(password)
    ? 'in app-password form' : `not in app-password form (${password.length} characters)`
  return `as ${who}; password ${form}`
}

async function blueskyPost(s: ListedStory): Promise<void> {
  const identifier = blueskyIdentifier(process.env.BLUESKY_HANDLE)
  const password = (process.env.BLUESKY_APP_PASSWORD || '').trim()
  let session: { accessJwt: string; did: string; didDoc?: unknown }
  try {
    session = await bsky<{ accessJwt: string; did: string; didDoc?: unknown }>('com.atproto.server.createSession', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    })
  } catch (err) {
    const message = String((err as Error)?.message ?? err)
    if (/ 401: /.test(message)) throw new Error(`${message.slice(0, 90)} (${blueskySignInShape(identifier, password)})`)
    throw err
  }
  const auth = { Authorization: `Bearer ${session.accessJwt}` }
  const server = blueskyServer(session.didDoc)
  const link = storyLink(s, 'bluesky')
  // Already on the account (a try whose answer was lost): counted as posted, not posted twice
  if (await blueskyHasPosted(server, session.did, link)) return
  // The story's own card as the link preview (Bluesky doesn't fetch cards itself)
  let thumb: unknown
  const img = await fetch(`${SITE_URL}/signals/${encodeURIComponent(s.leadId)}/opengraph-image`, { signal: AbortSignal.timeout(20_000) })
    .catch(() => null)
  if (img?.ok) {
    const bytes = new Uint8Array(await img.arrayBuffer())
    if (bytes.length > 0 && bytes.length < 950_000) {
      thumb = (await bsky<{ blob: unknown }>('com.atproto.repo.uploadBlob', {
        method: 'POST', headers: { ...auth, 'Content-Type': 'image/png' }, body: bytes,
      }, server)).blob
    }
  }
  await bsky('com.atproto.repo.createRecord', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: blueskyText(s),
        createdAt: new Date().toISOString(),
        langs: ['en'],
        embed: {
          $type: 'app.bsky.embed.external',
          external: { uri: link, title: s.title.slice(0, 300), description: verifiedLine(s), ...(thumb ? { thumb } : {}) },
        },
      },
    }),
  }, server)
}

const POSTERS: Record<Channel, (s: ListedStory) => Promise<void>> = { telegram: telegramPost, bluesky: blueskyPost, x: xPost }
const status: Record<string, unknown> = {}

/**
 * Each channel's last real try, posted or refused, kept in Redis for a week (Nov 25, 2026: the status file
 * read "paused after an error" with no error beside it, the try's record gone from the in-memory status
 * before it was shown), and the minutes its pause has left. The status file shows both as last_tries.
 */
const LAST_TRY_TTL = 7 * 86_400
async function noteTry(channel: Channel, now: Date, outcome: string): Promise<void> {
  await redis.set(`social:${channel}:last_try`, JSON.stringify({ at: now.toISOString(), outcome: outcome.slice(0, 200) }), 'EX', LAST_TRY_TTL)
    .catch(() => {})
}
async function lastTries(channels: Channel[]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const c of channels) {
    let record: Record<string, unknown> = {}
    try {
      const raw = await redis.get(`social:${c}:last_try`)
      if (raw) record = JSON.parse(raw) as Record<string, unknown>
    } catch { /* a help, never a failure */ }
    try {
      const left = Number(await redis.ttl(`social:${c}:pause`))
      if (left > 0) record.paused_minutes_left = Math.ceil(left / 60)
    } catch { /* idem */ }
    if (Object.keys(record).length > 0) out[c] = record
  }
  return out
}

/** One pass: each configured channel posts at most one story (exported for tests) */
export async function runSocialPosts(now: Date = new Date()): Promise<Record<Channel, string>> {
  const result = { telegram: 'off', bluesky: 'off', x: 'off' } as Record<Channel, string>
  const ny = newYorkTime(now)
  const channels = (Object.keys(RULES) as Channel[]).filter(configured)
  if (channels.length === 0) return result
  if (ny.hour < FIRST_HOUR || ny.hour > LAST_HOUR) {
    for (const c of channels) result[c] = 'quiet hours'
    return result
  }
  const stories = postableStories(await topStories(12, 20))
  for (const channel of channels) {
    const key = (k: string) => `social:${channel}:${k}`
    try {
      if (await redis.get(key('pause'))) { result[channel] = 'paused after an error'; continue }
      const today = Number(await redis.get(key(`count:${ny.date}`))) || 0
      if (today >= RULES[channel].perDay) { result[channel] = 'daily limit reached'; continue }
      const last = Number(await redis.get(key('last'))) || 0
      if (now.getTime() - last < RULES[channel].gapMinutes * 60_000) { result[channel] = 'waiting between posts'; continue }
      let story: ListedStory | undefined
      for (const s of stories) {
        if (!(await redis.sismember(key('posted'), s.leadId))) { story = s; break }
      }
      if (!story) { result[channel] = 'nothing new to post'; continue }
      // Only one process posts for a channel at a time
      if ((await redis.set(key('lock'), '1', 'EX', 120, 'NX')) !== 'OK') { result[channel] = 'busy'; continue }
      try {
        await POSTERS[channel](story)
      } finally {
        await redis.del(key('lock'))
      }
      await redis.sadd(key('posted'), story.leadId)
      await redis.expire(key('posted'), POSTED_TTL)
      await redis.incr(key(`count:${ny.date}`))
      await redis.expire(key(`count:${ny.date}`), 2 * 86_400)
      await redis.set(key('last'), String(now.getTime()))
      result[channel] = `posted: ${story.title.slice(0, 80)}`
      status[channel] = { last_at: now.toISOString(), last_title: story.title.slice(0, 120), today: today + 1, last_error: null }
      await noteTry(channel, now, result[channel])
    } catch (err) {
      const message = String((err as Error)?.message ?? err).replace(/bot\d+:[\w-]+/g, 'bot***').slice(0, 160)
      const pause = pauseSeconds(message)
      await redis.set(key('pause'), '1', 'EX', pause).catch(() => {})
      result[channel] = `error: ${message}`
      status[channel] = { ...(status[channel] as object ?? {}), last_error: message, error_at: now.toISOString() }
      await noteTry(channel, now, `error: ${message}`)
      console.error(`[SOCIAL] ${channel} post failed; paused for ${pause / 60} minutes: ${message}`)
    }
  }
  // What each channel did this pass ("paused after an error", "waiting between posts", "posted: ..."), so the
  // status file shows why nothing went out (Oct 30, 2026: after Bluesky's refused sign-ins, hours with no post
  // and no error said nothing either way)
  status.last_pass = { at: now.toISOString(), ...Object.fromEntries(channels.map(c => [c, result[c].slice(0, 120)])) }
  status.last_tries = await lastTries(channels)
  await redis.set('social:status', JSON.stringify(status), 'EX', 2 * 86_400).catch(() => {})
  return result
}

/** A pass that failed before any channel was tried (the stories query, say), recorded like the others */
async function notePassFailed(err: unknown, now: Date = new Date()): Promise<void> {
  console.error('[SOCIAL] pass failed:', err)
  status.last_pass = { at: now.toISOString(), failed: String((err as Error)?.message ?? err).replace(/bot\d+:[\w-]+/g, 'bot***').slice(0, 160) }
  await redis.set('social:status', JSON.stringify(status), 'EX', 2 * 86_400).catch(() => {})
}

let timer: ReturnType<typeof setInterval> | null = null

export function startSocialPosters(): void {
  if (timer) return
  const on = (Object.keys(RULES) as Channel[]).filter(configured)
  console.log(on.length ? `[SOCIAL] Automatic posts on for: ${on.join(', ')}` : '[SOCIAL] Automatic posts off (no Telegram, Bluesky or X keys)')
  if (!on.length) return
  timer = setInterval(() => { void runSocialPosts().catch(err => notePassFailed(err)) }, TICK_MS)
}

export function stopSocialPosters(): void {
  if (timer) { clearInterval(timer); timer = null }
}
