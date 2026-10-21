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
 * channel for an hour. Each story goes out once per channel. ops-status shows
 * the result (Redis social:status).
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

async function bsky<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${BLUESKY_HOST}/xrpc/${path}`, { ...init, signal: AbortSignal.timeout(20_000) })
  const body = await res.json().catch(() => null) as (T & { message?: string }) | null
  if (!res.ok || !body) throw new Error(`Bluesky ${path} ${res.status}: ${String(body?.message ?? 'no answer').slice(0, 120)}`)
  return body
}

async function blueskyPost(s: ListedStory): Promise<void> {
  const session = await bsky<{ accessJwt: string; did: string }>('com.atproto.server.createSession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: process.env.BLUESKY_HANDLE, password: process.env.BLUESKY_APP_PASSWORD }),
  })
  const auth = { Authorization: `Bearer ${session.accessJwt}` }
  // The story's own card as the link preview (Bluesky doesn't fetch cards itself)
  let thumb: unknown
  const img = await fetch(`${SITE_URL}/signals/${encodeURIComponent(s.leadId)}/opengraph-image`, { signal: AbortSignal.timeout(20_000) })
    .catch(() => null)
  if (img?.ok) {
    const bytes = new Uint8Array(await img.arrayBuffer())
    if (bytes.length > 0 && bytes.length < 950_000) {
      thumb = (await bsky<{ blob: unknown }>('com.atproto.repo.uploadBlob', {
        method: 'POST', headers: { ...auth, 'Content-Type': 'image/png' }, body: bytes,
      })).blob
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
          external: { uri: storyLink(s, 'bluesky'), title: s.title.slice(0, 300), description: verifiedLine(s), ...(thumb ? { thumb } : {}) },
        },
      },
    }),
  })
}

const POSTERS: Record<Channel, (s: ListedStory) => Promise<void>> = { telegram: telegramPost, bluesky: blueskyPost, x: xPost }
const status: Record<string, unknown> = {}

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
    } catch (err) {
      const message = String((err as Error)?.message ?? err).replace(/bot\d+:[\w-]+/g, 'bot***').slice(0, 160)
      await redis.set(key('pause'), '1', 'EX', 3600).catch(() => {})
      result[channel] = `error: ${message}`
      status[channel] = { ...(status[channel] as object ?? {}), last_error: message, error_at: now.toISOString() }
      console.error(`[SOCIAL] ${channel} post failed; paused for an hour: ${message}`)
    }
  }
  await redis.set('social:status', JSON.stringify(status), 'EX', 2 * 86_400).catch(() => {})
  return result
}

let timer: ReturnType<typeof setInterval> | null = null

export function startSocialPosters(): void {
  if (timer) return
  const on = (Object.keys(RULES) as Channel[]).filter(configured)
  console.log(on.length ? `[SOCIAL] Automatic posts on for: ${on.join(', ')}` : '[SOCIAL] Automatic posts off (no Telegram, Bluesky or X keys)')
  if (!on.length) return
  timer = setInterval(() => { void runSocialPosts().catch(err => console.error('[SOCIAL] pass failed:', err)) }, TICK_MS)
}

export function stopSocialPosters(): void {
  if (timer) { clearInterval(timer); timer = null }
}
