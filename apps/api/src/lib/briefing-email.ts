/**
 * The WorldPulse morning briefing by email (plan G4).
 *
 * At 7 AM New York time each confirmed subscriber gets the verified stories
 * most outlets reported in the last 24 hours (Mondays: the last 7 days for
 * weekly subscribers), each with how many outlets back it and which, plus
 * "New on WorldPulse" (lib/whats-new.ts). Sent through Resend, one email per
 * reader, with a one-click unsubscribe link and the List-Unsubscribe headers
 * Gmail and Yahoo ask of bulk senders.
 *
 * Resend's free plan sends 100 emails a day: EMAIL_DAILY_CAP (default 90)
 * keeps the briefing and the confirmation emails under it. Nothing is sent
 * without RESEND_API_KEY.
 */

import { db } from '../db/postgres'
import { redis } from '../db/redis'
import { logger } from './logger'
import { EMAIL_CONFIGURED } from './email'
import { emailLink, SITE_URL, subscribersReady, linksConfigured } from './subscribers'
import { outletNames, joinNames } from './outlet-names'
import { whatsNewSince, type WhatsNewItem } from './whats-new'
import { topStories } from '../routes/stories'
import type { ListedStory } from './story-list'

const RESEND_API_URL = 'https://api.resend.com/emails'
// `||`: compose passes an unset variable as ""
const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
export const BRIEFING_FROM = process.env.EMAIL_FROM_ADDRESS || 'WorldPulse <briefing@news.world-pulse.io>'
const REPLY_TO = process.env.EMAIL_REPLY_TO || ''
/** Emails a day the server may send (Resend's free plan allows 100) */
export const DAILY_CAP = Math.max(1, Number(process.env.EMAIL_DAILY_CAP || 90) || 90)
/** The hour (New York time) the briefing goes out, and the last hour it may still go */
export const SEND_HOUR = 7
const LAST_SEND_HOUR = 10
const STORIES_DAILY = 7
const STORIES_WEEKLY = 10
/** Resend's free plan takes 2 requests a second */
const SEND_GAP_MS = 600

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#dc2626', high: '#ea580c', medium: '#ca8a04', low: '#2563eb', info: '#64748b',
}
const SEVERITY_RANK: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 }

// ─── Time ────────────────────────────────────────────────────────────────────

export interface NyTime { date: string; hour: number; weekday: string }

/** The date, hour and weekday in New York (handles daylight saving) */
export function newYorkTime(now = new Date()): NyTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(now)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24, weekday: get('weekday') }
}

/** When New York's day `date` (YYYY-MM-DD) began, as a UTC instant */
export function newYorkMidnight(date: string): Date {
  // New York is UTC-4 or UTC-5: try both and keep the one that is midnight there
  for (const offset of [4, 5]) {
    const t = new Date(`${date}T${String(offset).padStart(2, '0')}:00:00Z`)
    if (newYorkTime(t).hour === 0 && newYorkTime(t).date === date) return t
  }
  return new Date(`${date}T05:00:00Z`)
}

// ─── Building the emails ─────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function storyUrl(leadId: string, campaign: string): string {
  return `${SITE_URL}/signals/${encodeURIComponent(leadId)}?utm_source=email&utm_medium=email&utm_campaign=${campaign}&utm_content=${encodeURIComponent(leadId.slice(0, 8))}`
}

function siteUrl(path: string, campaign: string): string {
  const sep = path.includes('?') ? '&' : '?'
  return `${SITE_URL}${path}${sep}utm_source=email&utm_medium=email&utm_campaign=${campaign}`
}

function shorten(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/[\s,;:–-]+$/, '')}…`
}

function categoryLabel(c: string | null): string {
  return c ? c.replace(/_/g, ' ').replace(/^./, x => x.toUpperCase()) : ''
}

export interface BriefingInput {
  stories: ListedStory[]
  whatsNew: WhatsNewItem[]
  /** e.g. "Monday, October 12" */
  dateLabel: string
  weekly: boolean
  unsubscribeUrl: string
}

/** The briefing's subject, HTML and plain text */
export function buildBriefingEmail(input: BriefingInput): { subject: string; html: string; text: string } {
  const { stories, whatsNew, dateLabel, weekly, unsubscribeUrl } = input
  const campaign = weekly ? 'weekly' : 'briefing'
  const lead = stories[0]
  const more = stories.length - 1
  const subject = lead
    ? `${shorten(lead.title, 70)}${more > 0 ? ` + ${more} more verified ${more === 1 ? 'story' : 'stories'}` : ''}`
    : `Your WorldPulse ${weekly ? 'week' : 'briefing'}, ${dateLabel}`
  const intro = weekly
    ? 'The week’s stories that the most outlets confirmed, and how many back each one.'
    : 'What happened overnight that several outlets confirm, and how many back each one.'

  const storyHtml = stories.map(s => {
    const color = SEVERITY_COLOR[s.severity] ?? '#64748b'
    const names = outletNames(s.outlets)
    const meta = [s.place, categoryLabel(s.category)].filter(Boolean).join(' · ')
    return `<tr><td style="padding:14px 0;border-bottom:1px solid #e5e7eb;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${color};">${escapeHtml(s.severity)}${meta ? ` <span style="color:#6b7280;font-weight:600;letter-spacing:0;text-transform:none;">· ${escapeHtml(meta)}</span>` : ''}</div>
      <a href="${escapeHtml(storyUrl(s.leadId, campaign))}" style="display:block;margin:4px 0 6px;font-size:17px;line-height:1.35;font-weight:700;color:#0f172a;text-decoration:none;">${escapeHtml(s.title)}</a>
      <div style="font-size:13px;color:#15803d;font-weight:600;">✓ Verified · ${s.outletCount.toLocaleString('en-US')} outlets${names.length ? ` <span style="color:#4b5563;font-weight:400;">including ${escapeHtml(joinNames(names))}</span>` : ''}</div>
    </td></tr>`
  }).join('')

  const newHtml = whatsNew.length ? `<tr><td style="padding:22px 0 6px;">
      <div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#0891b2;">New on WorldPulse</div>
      <ul style="margin:8px 0 0;padding-left:18px;color:#1f2937;font-size:14px;line-height:1.5;">${whatsNew.map(i =>
        `<li style="margin:0 0 6px;">${escapeHtml(i.text)} <a href="${escapeHtml(siteUrl(i.path, campaign))}" style="color:#0369a1;">See it</a></li>`).join('')}</ul>
    </td></tr>` : ''

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td style="background:#0b0d14;padding:18px 24px;">
    <span style="font-size:18px;font-weight:800;letter-spacing:.14em;color:#f8fafc;">WORLD<span style="color:#f59e0b;">PULSE</span></span>
    <span style="float:right;font-size:12px;color:#94a3b8;line-height:24px;">${escapeHtml(weekly ? 'The week' : 'Morning briefing')} · ${escapeHtml(dateLabel)}</span>
  </td></tr>
  <tr><td style="padding:20px 24px 4px;font-size:14px;line-height:1.5;color:#374151;">${escapeHtml(intro)}</td></tr>
  <tr><td style="padding:0 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${storyHtml || '<tr><td style="padding:14px 0;color:#6b7280;">No story reached several outlets in this window.</td></tr>'}${newHtml}</table></td></tr>
  <tr><td style="padding:18px 24px 22px;">
    <a href="${escapeHtml(siteUrl('/map', campaign))}" style="display:inline-block;background:#f59e0b;color:#111827;font-weight:700;font-size:14px;text-decoration:none;padding:10px 18px;border-radius:8px;">Open the live map</a>
  </td></tr>
  <tr><td style="padding:14px 24px 20px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280;">
    You get this because you signed up at world-pulse.io and confirmed your address. “Verified” means several separate outlets reported the story; every source is on its page.<br>
    <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280;">Unsubscribe</a> · <a href="${escapeHtml(SITE_URL)}" style="color:#6b7280;">world-pulse.io</a>
  </td></tr>
</table></td></tr></table></body></html>`

  const textStories = stories.map((s, i) => {
    const names = outletNames(s.outlets)
    const meta = [s.place, categoryLabel(s.category)].filter(Boolean).join(' · ')
    return `${i + 1}. ${s.title}\n   ${s.severity.toUpperCase()}${meta ? ` · ${meta}` : ''}\n   Verified · ${s.outletCount} outlets${names.length ? `, including ${joinNames(names)}` : ''}\n   ${storyUrl(s.leadId, campaign)}`
  }).join('\n\n')
  const textNew = whatsNew.length ? `\n\nNEW ON WORLDPULSE\n${whatsNew.map(i => `- ${i.text} ${siteUrl(i.path, campaign)}`).join('\n')}` : ''
  const text = `WORLDPULSE · ${weekly ? 'The week' : 'Morning briefing'} · ${dateLabel}\n\n${intro}\n\n${textStories || 'No story reached several outlets in this window.'}${textNew}\n\nLive map: ${siteUrl('/map', campaign)}\n\nYou get this because you signed up at world-pulse.io and confirmed your address.\nUnsubscribe: ${unsubscribeUrl}\n`

  return { subject, html, text }
}

/** The email that asks a new subscriber to confirm their address */
export function buildConfirmEmail(confirmUrl: string): { subject: string; html: string; text: string } {
  const subject = 'Confirm your WorldPulse briefing'
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td style="background:#0b0d14;padding:18px 24px;"><span style="font-size:18px;font-weight:800;letter-spacing:.14em;color:#f8fafc;">WORLD<span style="color:#f59e0b;">PULSE</span></span></td></tr>
  <tr><td style="padding:24px;font-size:15px;line-height:1.55;color:#1f2937;">
    <p style="margin:0 0 14px;">One tap and you’ll get the WorldPulse morning briefing: the stories several outlets confirmed overnight, at 7 AM New York time.</p>
    <a href="${escapeHtml(confirmUrl)}" style="display:inline-block;background:#f59e0b;color:#111827;font-weight:700;text-decoration:none;padding:11px 20px;border-radius:8px;">Confirm my address</a>
    <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">If you didn’t sign up at world-pulse.io, ignore this email: nothing will be sent.</p>
  </td></tr>
</table></td></tr></table></body></html>`
  const text = `One tap and you'll get the WorldPulse morning briefing: the stories several outlets confirmed overnight, at 7 AM New York time.\n\nConfirm: ${confirmUrl}\n\nIf you didn't sign up at world-pulse.io, ignore this email: nothing will be sent.\n`
  return { subject, html, text }
}

// ─── Sending ─────────────────────────────────────────────────────────────────

export interface SendResult { ok: boolean; status: number; limited: boolean }

/** Emails sent today (UTC), against DAILY_CAP */
async function takeDailySlot(): Promise<boolean> {
  const key = `email:sent:${new Date().toISOString().slice(0, 10)}`
  try {
    const n = await redis.incr(key)
    if (n === 1) await redis.expire(key, 2 * 86_400)
    if (n > DAILY_CAP) return false
    return true
  } catch {
    return true
  }
}

/** Send one email through Resend */
export async function sendEmail(msg: {
  to: string; subject: string; html: string; text: string; headers?: Record<string, string>
}): Promise<SendResult> {
  if (!EMAIL_CONFIGURED || !RESEND_API_KEY) return { ok: false, status: 0, limited: false }
  if (!(await takeDailySlot())) return { ok: false, status: 429, limited: true }
  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: BRIEFING_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text,
        ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
        ...(msg.headers ? { headers: msg.headers } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      logger.warn({ status: res.status, body: body.slice(0, 200) }, 'Briefing email: Resend refused a send')
    }
    return { ok: res.ok, status: res.status, limited: res.status === 429 }
  } catch (err) {
    logger.warn({ err }, 'Briefing email: request failed')
    return { ok: false, status: 0, limited: false }
  }
}

/** Confirmation emails a day: sign-ups can't use up the briefing's share of DAILY_CAP */
export const CONFIRM_DAILY_CAP = Math.max(1, Number(process.env.EMAIL_CONFIRM_DAILY_CAP || 25) || 25)

/** Ask a new subscriber to confirm (at most once every 10 minutes per address) */
export async function sendConfirmEmail(email: string): Promise<boolean> {
  const key = `email:confirm-sent:${email}`
  const fresh = await redis.set(key, '1', 'EX', 600, 'NX').catch(() => 'OK')
  if (fresh !== 'OK') return true
  const dayKey = `email:confirm:${new Date().toISOString().slice(0, 10)}`
  const n = await redis.incr(dayKey).catch(() => 1)
  if (n === 1) await redis.expire(dayKey, 2 * 86_400).catch(() => {})
  if (n > CONFIRM_DAILY_CAP) {
    logger.warn({ cap: CONFIRM_DAILY_CAP }, 'Briefing sign-ups: today\'s confirmation emails are used up')
    return false
  }
  const msg = buildConfirmEmail(emailLink(email, 'confirm'))
  const r = await sendEmail({ to: email, ...msg })
  return r.ok
}

// ─── The 7 AM dispatch ───────────────────────────────────────────────────────

interface SubscriberRow {
  id: string
  email: string
  frequency: string
  categories: string[] | null
  min_severity: string | null
  last_sent_at: Date | string | null
}

function forSubscriber(stories: ListedStory[], sub: SubscriberRow, max: number): ListedStory[] {
  const cats = Array.isArray(sub.categories) ? sub.categories.filter(Boolean) : []
  const min = SEVERITY_RANK[sub.min_severity ?? 'info'] ?? 1
  return stories
    .filter(s => s.verifiedAt !== null)
    .filter(s => cats.length === 0 || (s.category !== null && cats.includes(s.category)))
    .filter(s => (SEVERITY_RANK[s.severity] ?? 1) >= min)
    .slice(0, max)
}

/**
 * Send the briefing if it's time: from 7 to 10 AM New York time, to each
 * confirmed subscriber not yet sent today (so a restart halfway through goes
 * on with the rest). Weekly subscribers get theirs on Mondays.
 */
export async function dispatchBriefingEmails(now = new Date()): Promise<number> {
  if (!EMAIL_CONFIGURED || !subscribersReady() || !linksConfigured()) return 0
  const ny = newYorkTime(now)
  if (ny.hour < SEND_HOUR || ny.hour > LAST_SEND_HOUR) return 0

  // Today's pass already finished (or hit the sending limit): nothing more until tomorrow
  const doneKey = `email:briefing:done:${ny.date}`
  if (await redis.get(doneKey).catch(() => null)) return 0
  // One server at a time
  const lock = await redis.set(`email:briefing:lock:${ny.date}`, '1', 'EX', 900, 'NX').catch(() => null)
  if (lock !== 'OK') return 0
  try {
    const dayStart = newYorkMidnight(ny.date)
    const monday = ny.weekday === 'Mon'
    const subs = await db('digest_subscriptions')
      .where('is_active', true)
      .whereNotNull('confirmed_at')
      .where(q => { q.whereNull('last_sent_at').orWhere('last_sent_at', '<', dayStart) })
      .where(q => { q.where('frequency', 'daily'); if (monday) q.orWhere('frequency', 'weekly') })
      .orderBy('confirmed_at', 'asc')
      .limit(DAILY_CAP)
      .select(['id', 'email', 'frequency', 'categories', 'min_severity', 'last_sent_at']) as SubscriberRow[]
    if (subs.length === 0) {
      await redis.set(doneKey, '1', 'EX', 86_400).catch(() => {})
      return 0
    }

    const daily = subs.some(s => s.frequency === 'daily') ? await topStories(24, 20) : []
    const weekly = subs.some(s => s.frequency === 'weekly') ? await topStories(24 * 7, 25) : []
    const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }).format(now)

    let sent = 0
    for (const sub of subs) {
      const isWeekly = sub.frequency === 'weekly'
      const stories = forSubscriber(isWeekly ? weekly : daily, sub, isWeekly ? STORIES_WEEKLY : STORIES_DAILY)
      if (stories.length === 0) continue
      const last = sub.last_sent_at ? new Date(sub.last_sent_at) : null
      const unsubscribeUrl = emailLink(sub.email, 'unsubscribe')
      const msg = buildBriefingEmail({ stories, whatsNew: whatsNewSince(last, now), dateLabel, weekly: isWeekly, unsubscribeUrl })
      const r = await sendEmail({
        to: sub.email, ...msg,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      })
      if (r.limited) { logger.warn({ sent }, 'Briefing email: daily sending limit reached; the rest wait for tomorrow'); break }
      if (r.ok) {
        sent++
        await db('digest_subscriptions').where('id', sub.id).update({ last_sent_at: now, updated_at: now })
      }
      await new Promise(res => setTimeout(res, SEND_GAP_MS))
    }
    // A whole pass (or the day's limit): new confirmations get tomorrow's briefing
    await redis.set(doneKey, '1', 'EX', 86_400).catch(() => {})
    logger.info({ sent, due: subs.length }, 'Briefing emails sent')
    return sent
  } finally {
    await redis.del(`email:briefing:lock:${ny.date}`).catch(() => {})
  }
}

let timer: ReturnType<typeof setInterval> | null = null

/** Check every minute whether the briefing is due */
export function startBriefingEmails(): void {
  if (timer) return
  timer = setInterval(() => {
    dispatchBriefingEmails().catch(err => logger.warn({ err }, 'Briefing email dispatch failed'))
  }, 60_000)
  timer.unref?.()
}

export function stopBriefingEmails(): void {
  if (timer) clearInterval(timer)
  timer = null
}
