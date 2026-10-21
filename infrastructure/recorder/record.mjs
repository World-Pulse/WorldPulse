/**
 * "The world in 60 seconds" (plan G9, slice 2; Devon, Oct 21, 2026: "Yes,
 * once a night"): records the World Map's play mode (/map?play=24h, the last
 * 24 hours in about a minute, slice 1) in a phone's 9:16 frame, every
 * morning, as an MP4 ready to post (X, LinkedIn, Reels, TikTok, Shorts).
 *
 *   node record.mjs          wait for RECORD_AT each day, record, repeat
 *   node record.mjs --now    record once now and stop
 *
 * Files: OUT_DIR/world-in-60s-YYYY-MM-DD.mp4 (New York's date), kept
 * KEEP_DAYS days; with the uploads volume as OUT_DIR they are served at
 * https://world-pulse.io/uploads/video/world-in-60s-YYYY-MM-DD.mp4.
 */

import { execFile } from 'node:child_process'
import { mkdir, readdir, rm, stat, rename, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const URL_TO_RECORD = process.env.RECORD_URL || 'https://world-pulse.io/map?play=24h&frame=vertical&utm_source=video'
const OUT_DIR = process.env.OUT_DIR || '/out/video'
const RECORD_AT = process.env.RECORD_AT || '05:30'       // New York time
const KEEP_DAYS = Number(process.env.KEEP_DAYS || 14)
/** The play mode lasts about 60 s after the map loads; record a little more */
const RECORD_MS = Number(process.env.RECORD_MS || 80_000)
/** Seconds of loading cut from the start */
const TRIM_START = Number(process.env.TRIM_START || 6)
/**
 * A phone-sized page (CSS pixels), made a 720 × 1280 video. (Playwright records
 * a page at its CSS size whatever its pixel density: a 360 × 640 phone at
 * twice the density filled only a quarter of a 720 × 1280 video, Oct 21.)
 */
const W = 450, H = 800, OUT_W = 720, OUT_H = 1280

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

export async function recordOnce() {
  const { date } = nyParts()
  const work = await mkdtemp(join(tmpdir(), 'rec-'))
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  try {
    const context = await browser.newContext({
      viewport: { width: W, height: H }, isMobile: true, hasTouch: true,
      recordVideo: { dir: work, size: { width: W, height: H } }, colorScheme: 'dark',
    })
    const page = await context.newPage()
    log('opening', URL_TO_RECORD)
    await page.goto(URL_TO_RECORD, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(RECORD_MS)
    const video = page.video()
    await context.close()                       // writes the video
    const webm = await video.path()
    await mkdir(OUT_DIR, { recursive: true })
    const tmp = join(OUT_DIR, `.world-in-60s-${date}.mp4`)
    const out = join(OUT_DIR, `world-in-60s-${date}.mp4`)
    // H.264 for every app; a quiet audio track some apps want; the start of loading cut
    await run('ffmpeg', ['-y', '-ss', String(TRIM_START), '-i', webm, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-shortest',
      '-vf', `scale=${OUT_W}:${OUT_H}:flags=lanczos`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '64k',
      '-movflags', '+faststart', tmp])
    await rename(tmp, out)
    const s = await stat(out)
    log('saved', out, `${Math.round(s.size / 1024)} KB`)
    return out
  } finally {
    await browser.close().catch(() => {})
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

async function prune() {
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000
  for (const f of await readdir(OUT_DIR).catch(() => [])) {
    if (!/^world-in-60s-\d{4}-\d{2}-\d{2}\.mp4$/.test(f)) continue
    const p = join(OUT_DIR, f)
    if ((await stat(p)).mtimeMs < cutoff) { await rm(p, { force: true }); log('removed old', f) }
  }
}

async function main() {
  if (process.argv.includes('--now')) { await recordOnce(); return }
  log(`recording ${URL_TO_RECORD} every day at ${RECORD_AT} New York time`)
  for (;;) {
    const wait = msUntilNext()
    log(`next recording in ${Math.round(wait / 60_000)} min`)
    await new Promise(r => setTimeout(r, wait))
    try { await recordOnce(); await prune() } catch (err) { log('failed:', err?.message ?? err) }
    await new Promise(r => setTimeout(r, 120_000))   // never twice in one minute
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(err => { log('stopped:', err?.message ?? err); process.exit(1) })
