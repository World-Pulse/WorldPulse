/**
 * "The world in 30 seconds" (plan G9, slice 2; Devon, Oct 21, 2026: "Yes,
 * once a night"; Oct 31: "shorten the video ... to 30 seconds so the quality
 * is higher and crisp"): films the World Map's play mode (/map?play=24h&len=30:
 * a title card, the last 24 hours, the day's most-reported stories) in a
 * phone's 9:16 frame, every morning, as an MP4 ready to post (X, LinkedIn,
 * Reels, TikTok, Shorts).
 *
 * Slow motion since Oct 31, 2026: the server draws the map in software at 2 or
 * 3 frames a second, so filming the page live gave a jerky video (Oct 30's
 * froze for 0.3-0.7 s every half second: "a small lag") and, on a busy
 * morning, a slow one. Now the page plays SLOW times slower (?slow=: the
 * replay, the cards, the camera's flights and the cards' animations), the
 * recorder takes each drawing of the screen (drawn at 1.6 times the page's
 * 450 x 800, for smooth edges) with the time it came, and the drawings are
 * laid out SLOW times faster at 30 frames a second, as 720 x 1280: a smooth
 * video whatever the machine. If that fails, the
 * second try films live, the way until Oct 31.
 *
 *   node record.mjs                wait for RECORD_AT each day, record, repeat
 *   node record.mjs --now          record once now and stop
 *   node record.mjs --now --live   once, filmed live (the old way)
 *
 * Files: OUT_DIR/world-in-60s-YYYY-MM-DD.mp4 (New York's date; the name kept
 * from the minute-long video, so the links and the status file still find it),
 * kept KEEP_DAYS days; with the uploads volume as OUT_DIR they are served at
 * https://world-pulse.io/uploads/video/world-in-60s-YYYY-MM-DD.mp4.
 * Beside it since Nov 11, 2026, world-in-60s-YYYY-MM-DD.json: what the video
 * showed (the page's data-play-card: the title card's numbers and the closing
 * card's stories), so the morning post gives the video's own numbers.
 */

import { execFile } from 'node:child_process'
import { mkdir, readdir, rm, stat, rename, mkdtemp, writeFile, link } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const URL_TO_RECORD = process.env.RECORD_URL || 'https://world-pulse.io/map?play=24h&frame=vertical&len=30&utm_source=video'
/** Slow motion: the page plays this many times slower while it is filmed (its ?slow=) */
const SLOW = Number(process.env.SLOW || 30)
const OUT_DIR = process.env.OUT_DIR || '/out/video'
const RECORD_AT = process.env.RECORD_AT || '05:30'       // New York time
const KEEP_DAYS = Number(process.env.KEEP_DAYS || 14)
/**
 * Since Oct 30, 2026 the page opens on a title card, plays the day, shows the day's most-reported stories and
 * then sets data-play-done on <html>: the recording stops there, or after RECORD_MS at the most
 */
const RECORD_MS = Number(process.env.RECORD_MS || 120_000)
/** Seconds cut from the start at the least: the blank page before the title card */
const TRIM_START = Number(process.env.TRIM_START || 1.5)
/**
 * Seconds of title card kept before the replay begins (the page sets data-play-phase="play"): the rest of the wait
 * for the map is cut (Oct 30, 2026: the first lively video held its title card for 11 s, from a white page on)
 */
const INTRO_KEEP = Number(process.env.INTRO_KEEP || 3.2)
/** Milliseconds filmed after data-play-done, so the closing card isn't cut short (the frames trail the page) */
const TAIL_MS = Number(process.env.TAIL_MS || 3_000)
/**
 * The replay must begin within this long, or the page is broken and nothing is saved (Oct 30, 2026: a recording
 * started as a deploy finished got the page without its stylesheets and filmed 4 minutes of bare text)
 */
const START_MS = Number(process.env.START_MS || 100_000)
/** After a failed morning recording, wait this long and try once more */
const RETRY_MS = Number(process.env.RETRY_MS || 180_000)

/** Where the video starts: INTRO_KEEP seconds before the replay began, never before TRIM_START */
export function trimStart(playStartedAfterMs) {
  if (!Number.isFinite(playStartedAfterMs) || playStartedAfterMs <= 0) return TRIM_START
  return Math.max(TRIM_START, Math.round((playStartedAfterMs / 1000 - INTRO_KEEP) * 10) / 10)
}
/**
 * A phone-sized page (CSS pixels), made a 720 × 1280 video. (Playwright records
 * a page at its CSS size whatever its pixel density: a 360 × 640 phone at
 * twice the density filled only a quarter of a 720 × 1280 video, Oct 21.)
 */
const W = 450, H = 800, OUT_W = 720, OUT_H = 1280
/** Frames a second in the video, and the most seconds of video (a page that never says it's done) */
const FPS = Number(process.env.FPS || 30)
const MAX_VIDEO_S = Number(process.env.MAX_VIDEO_S || 90)
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
/** Frame n's file name (ffmpeg reads f%05d.jpg) */
export const frameName = n => `f${String(n).padStart(5, '0')}.jpg`
/** The page's address in slow motion */
export function slowUrl(url = URL_TO_RECORD, slow = SLOW) {
  const u = new URL(url)
  u.searchParams.set('slow', String(slow))
  return u.toString()
}
/**
 * The video's frames from the captures: frame i (at i / fps s of video) shows the newest capture taken by
 * i / fps * slow s of filming. `at`: each capture's time in ms since filming began, in order. Returns, for each
 * video frame, the index of its capture
 */
export function layOut(at, fps = FPS, slow = SLOW) {
  if (!at.length) return []
  const frames = Math.floor((at[at.length - 1] / slow / 1000) * fps) + 1
  const out = []
  let j = 0
  for (let i = 0; i < frames; i++) {
    const real = (i / fps) * slow * 1000
    while (j + 1 < at.length && at[j + 1] <= real) j++
    out.push(j)
  }
  return out
}

const log = (...a) => console.log(new Date().toISOString(), '[recorder]', ...a)

function nyParts(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) }
}

/** Milliseconds until the next RECORD_AT in New York */
export function msUntilNext(now = new Date(), at = RECORD_AT) {
  const [h, m] = at.split(':').map(Number)
  const target = h * 60 + m
  const { minutes } = nyParts(now)
  let wait = target - minutes
  if (wait <= 0) wait += 24 * 60
  return wait * 60_000 - now.getSeconds() * 1000
}

function run(cmd, args) {
  return new Promise((resolve, reject) => execFile(cmd, args, { maxBuffer: 1 << 24 }, (err, stdout, stderr) => (err ? reject(new Error(`${cmd}: ${stderr || err.message}`)) : resolve(stdout))))
}

/** The page must run the play mode with its stylesheets (the site's own: the map's and the page's inline styles load
 *  even when it doesn't) */
async function checkStyled(page) {
  const styled = await page.waitForFunction(() => document.documentElement.dataset.playPhase !== undefined
    && [...document.styleSheets].some(sheet => { try { return (sheet.href || '').includes('/_next/static/') && sheet.cssRules.length > 100 } catch { return false } }),
    null, { timeout: 45_000, polling: 500 })
    .then(() => true, () => false)
  if (!styled) throw new Error('the page came without its stylesheets or its play mode: nothing saved')
}

/** The MP4 every app takes from a video or a frame sequence: H.264, a quiet audio track some apps want */
async function encode(inputArgs, date, extraVideoArgs = []) {
  await mkdir(OUT_DIR, { recursive: true })
  const tmp = join(OUT_DIR, `.world-in-60s-${date}.mp4`)
  const out = join(OUT_DIR, `world-in-60s-${date}.mp4`)
  await run('ffmpeg', ['-y', ...inputArgs, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-shortest', ...extraVideoArgs,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '64k',
    '-movflags', '+faststart', tmp])
  await rename(tmp, out)
  const s = await stat(out)
  log('saved', out, `${Math.round(s.size / 1024)} KB`)
  return out
}

/**
 * What the video showed (Nov 11, 2026): the page's data-play-card (apps/web/src/lib/map-play.ts playCard), checked
 * and kept to its numbers and three stories; null when the page had none (an older site) or it isn't a card
 */
export function cardFile(raw, date, now = new Date()) {
  let card
  try { card = JSON.parse(String(raw)) } catch { return null }
  if (!card || typeof card !== 'object') return null
  const n = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0)
  if (n(card.reports) === 0) return null
  const top = (Array.isArray(card.top) ? card.top : [])
    .filter(t => t && typeof t.title === 'string' && t.title.trim())
    .slice(0, 3)
    .map(t => ({ title: t.title.trim().slice(0, 200), outlets: n(t.outlets), countries: n(t.countries) }))
  return {
    date, video: `world-in-60s-${date}.mp4`, recorded_at: now.toISOString(),
    reports: n(card.reports), outlets: n(card.outlets), countries: n(card.countries), verified: n(card.verified),
    milestone: n(card.milestone) || null, top,
  }
}

/** The card as the page has it now (before the page closes); null when it has none */
async function readCard(page) {
  return page.evaluate(() => document.documentElement.dataset.playCard || null).catch(() => null)
}

/** Saves the card beside the video, once the video is saved (never fails the recording) */
async function saveCard(raw, date) {
  const card = cardFile(raw, date)
  if (!card) { log('no card on the page: the video is saved without its numbers'); return }
  try {
    const tmp = join(OUT_DIR, `.world-in-60s-${date}.json`), out = join(OUT_DIR, `world-in-60s-${date}.json`)
    await writeFile(tmp, JSON.stringify(card))
    await rename(tmp, out)
    log('saved', out, `(${card.reports} reports, ${card.top.length} stories)`)
  } catch (err) {
    log('the card was not saved:', err?.message ?? err)
  }
}

/** In slow motion (since Oct 31, 2026): smooth and sharp whatever the machine's drawing speed */
export async function recordOnce() {
  const { date } = nyParts()
  const work = await mkdtemp(join(tmpdir(), 'rec-'))
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: GL_ARGS,
  })
  try {
    const scale = OUT_W / W
    const context = await browser.newContext({
      viewport: { width: W, height: H }, deviceScaleFactor: scale, isMobile: true, hasTouch: true, colorScheme: 'dark',
    })
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    const url = slowUrl()
    log(`opening ${url} (${SLOW} times slower)`)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await checkStyled(page)
    // Ready: the map and the day have loaded and the title card has its moment (data-play-ready; an older page:
    // the replay's start)
    const ready = await page.waitForFunction(() => document.documentElement.dataset.playReady === '1' || document.documentElement.dataset.playPhase === 'play',
      null, { timeout: START_MS, polling: 100 }).then(() => true, () => false)
    if (!ready) throw new Error(`the map and the day weren't ready within ${START_MS / 1000} s: nothing saved`)
    const shots = join(work, 'shots'), seq = join(work, 'seq')
    await mkdir(shots)
    await mkdir(seq)
    // The screen as the page draws it (DevTools' screencast, like Playwright's own recording): a frame each time
    // the page draws, with the time it came
    const at = [], writes = []
    const t0 = Date.now()
    cdp.on('Page.screencastFrame', f => {
      const n = at.length
      at.push(Date.now() - t0)
      writes.push(writeFile(join(shots, `s${String(n).padStart(6, '0')}.jpg`), Buffer.from(f.data, 'base64')))
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
    })
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: OUT_W, maxHeight: OUT_H, everyNthFrame: 1 })
    const maxMs = MAX_VIDEO_S * SLOW * 1000
    let doneAt = null
    while (Date.now() - t0 < maxMs) {
      if (await page.evaluate(() => document.documentElement.dataset.playDone === '1')) { doneAt = Date.now() - t0; break }
      await new Promise(r => setTimeout(r, 250))
    }
    await cdp.send('Page.stopScreencast').catch(() => {})
    await Promise.all(writes)
    if (!at.length) throw new Error('the page drew nothing while it played: nothing saved')
    // the last drawing stays on screen until the end (a still closing card sends no frames)
    const end = doneAt ?? (Date.now() - t0)
    if (end > at[at.length - 1]) {
      await link(join(shots, `s${String(at.length - 1).padStart(6, '0')}.jpg`), join(shots, `s${String(at.length).padStart(6, '0')}.jpg`))
      at.push(end)
    }
    if (doneAt === null) log(`no data-play-done after ${MAX_VIDEO_S} s of video: keeping what was filmed`)
    const frames = layOut(at)
    for (let i = 0; i < frames.length; i++) await link(join(shots, `s${String(frames[i]).padStart(6, '0')}.jpg`), join(seq, frameName(i)))
    const distinct = new Set(frames).size
    log(`filmed ${at.length} drawings in ${Math.round((Date.now() - t0) / 1000)} s: ${frames.length} frames (${(frames.length / FPS).toFixed(1)} s of video, ${distinct} different)`)
    const card = await readCard(page)
    await context.close()
    // (the screencast comes at the page's 450 x 800, drawn at 1.6 times that and scaled down: made 720 x 1280)
    const out = await encode(['-framerate', String(FPS), '-i', join(seq, 'f%05d.jpg')], date, ['-vf', `scale=${OUT_W}:${OUT_H}:flags=lanczos`])
    await saveCard(card, date)
    return out
  } finally {
    await browser.close().catch(() => {})
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

/** Filmed live as the page plays (the way until Oct 31, 2026): the second try when frame by frame fails */
export async function recordLive() {
  const { date } = nyParts()
  const work = await mkdtemp(join(tmpdir(), 'rec-'))
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: GL_ARGS,
  })
  try {
    const context = await browser.newContext({
      viewport: { width: W, height: H }, isMobile: true, hasTouch: true,
      recordVideo: { dir: work, size: { width: W, height: H } }, colorScheme: 'dark',
    })
    const page = await context.newPage()
    const filmingSince = Date.now()             // the video starts with the page
    log('opening', URL_TO_RECORD)
    await page.goto(URL_TO_RECORD, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    // The page must run the play mode with its stylesheets, and the replay must begin
    await checkStyled(page)
    const playStarted = await page.waitForFunction(() => document.documentElement.dataset.playPhase === 'play', null, { timeout: START_MS, polling: 200 })
      .then(() => Date.now() - filmingSince, () => NaN)
    if (!Number.isFinite(playStarted)) throw new Error(`the replay didn't begin within ${START_MS / 1000} s: nothing saved`)
    await page.waitForFunction(() => document.documentElement.dataset.playDone === '1', null, { timeout: RECORD_MS, polling: 500 })
      .catch(() => log(`no data-play-done after ${RECORD_MS / 1000} s: keeping what was recorded`))
    await page.waitForTimeout(TAIL_MS)
    const video = page.video()
    const card = await readCard(page)
    await context.close()                       // writes the video
    const trim = trimStart(playStarted)
    log(`the replay began ${Number.isFinite(playStarted) ? `${(playStarted / 1000).toFixed(1)} s` : 'at an unknown time'} in; cutting ${trim} s`)
    const webm = await video.path()
    // the start of loading cut; the page's 450 × 800 made 720 × 1280
    const out = await encode(['-ss', String(trim), '-i', webm], date, ['-vf', `scale=${OUT_W}:${OUT_H}:flags=lanczos`])
    await saveCard(card, date)
    return out
  } finally {
    await browser.close().catch(() => {})
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

async function prune() {
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000
  for (const f of await readdir(OUT_DIR).catch(() => [])) {
    if (!/^world-in-60s-\d{4}-\d{2}-\d{2}\.(mp4|json)$/.test(f)) continue
    const p = join(OUT_DIR, f)
    if ((await stat(p)).mtimeMs < cutoff) { await rm(p, { force: true }); log('removed old', f) }
  }
}

async function main() {
  if (process.argv.includes('--now')) { await (process.argv.includes('--live') ? recordLive() : recordOnce()); return }
  log(`recording ${URL_TO_RECORD} every day at ${RECORD_AT} New York time, ${SLOW} times slower, at ${FPS} frames a second`)
  for (;;) {
    const wait = msUntilNext()
    log(`next recording in ${Math.round(wait / 60_000)} min`)
    await new Promise(r => setTimeout(r, wait))
    try { await recordOnce() } catch (err) {
      log('failed:', err?.message ?? err, `; trying again live in ${RETRY_MS / 60_000} min`)
      await new Promise(r => setTimeout(r, RETRY_MS))
      try { await recordLive() } catch (err2) { log('failed again:', err2?.message ?? err2) }
    }
    await prune().catch(() => {})
    await new Promise(r => setTimeout(r, 120_000))   // never twice in one minute
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(err => { log('stopped:', err?.message ?? err); process.exit(1) })
