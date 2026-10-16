/**
 * Honest measures for the Cortex engine (Oct 15, 2026).
 *
 * The engine's own numbers overstated it: alarms on tiny counts (5 culture
 * reports in Rome against 1.4 a day read as 6.6σ), a score that swung 74 → 64
 * within minutes because one query timed out and counted as 0, and links made
 * from timing alone. These pure helpers hold the fixed arithmetic so it can be
 * tested on its own; the queries live in metrics.ts, baselines.ts and the
 * analytics routes.
 *
 * @module cortex/honest
 */

/**
 * How far a count sits above normal once small numbers get a fair spread.
 * The spread is never taken below √usual (what chance alone gives a count of
 * that size) or 1, so a jump from 1 to 5 reports is not a "6σ" event.
 */
export function fairZ(count: number, usual: number, spread: number): number {
  const c = Number(count) || 0
  const u = Math.max(0, Number(usual) || 0)
  const s = Math.max(Number(spread) || 0, Math.sqrt(u), 1)
  return (c - u) / s
}

/**
 * Mean and sample spread over `days` days, counting days with no row as 0.
 * The old detector averaged only the days a place appeared, which hid every
 * quiet day and made a small place's normal look busier and steadier than it was.
 */
export function zeroFilledStats(counts: number[], days: number): { avg: number; sd: number } {
  const n = Math.max(days, counts.length, 1)
  const present = counts.map(c => Number(c) || 0)
  const sum = present.reduce((a, b) => a + b, 0)
  const sumSq = present.reduce((a, b) => a + b * b, 0)
  const avg = sum / n
  if (n < 2) return { avg, sd: 0 }
  const variance = Math.max(0, (sumSq - n * avg * avg) / (n - 1))
  return { avg, sd: Math.sqrt(variance) }
}

/** A nightly alarm worth keeping: enough reports, and far above normal by the fair spread */
export const ANOMALY_MIN_COUNT = 5
export const ANOMALY_MIN_FAIR_Z = 2
/** A place needs this many days with reports in the 30 before an alarm counts (new feeds and new place names are not news) */
export const ANOMALY_MIN_DAYS_SEEN = 3

export interface DayCounts {
  category: string
  region: string
  /** count on the day being checked */
  current: number
  /** counts on the days before that had any reports (others are 0) */
  history: number[]
}

export interface FairAnomaly {
  category: string
  region: string
  current_count: number
  baseline_avg: number
  baseline_stddev: number
  z_score: number
  direction: 'above' | 'below'
  window: string
}

/** Turn a day's counts and their 30-day history into the alarms that hold up */
export function fairAnomalies(rows: DayCounts[], historyDays = 30): FairAnomaly[] {
  const out: FairAnomaly[] = []
  for (const r of rows) {
    if ((r.history?.length ?? 0) < ANOMALY_MIN_DAYS_SEEN) continue
    const { avg, sd } = zeroFilledStats(r.history, historyDays)
    const z = fairZ(r.current, avg, sd)
    const above = z > 0
    if (Math.abs(z) < ANOMALY_MIN_FAIR_Z) continue
    if (above && r.current < ANOMALY_MIN_COUNT) continue
    // a drop only means something where there is usually plenty
    if (!above && avg < ANOMALY_MIN_COUNT * 2) continue
    out.push({
      category: r.category,
      region: r.region,
      current_count: r.current,
      baseline_avg: round2(avg),
      baseline_stddev: round2(sd),
      z_score: round2(z),
      direction: above ? 'above' : 'below',
      window: '30d',
    })
  }
  return out.sort((a, b) => b.z_score - a.z_score)
}

// ─── Same-day spikes ─────────────────────────────────────────────────────────

export interface WindowRow {
  category: string
  region: string
  /** 0 = the last `hours` hours; 1..7 = the same hours of the clock on each day before */
  day_back: number
  count: number
}

export interface LiveSpike {
  category: string
  region: string
  count: number
  usual: number
  spread: number
  fair_z: number
  days_seen: number
}

export interface LiveSpikeOptions {
  hours: number
  historyDays?: number
  minZ?: number
  minCount?: number
}

/** Fewest reports a same-day spike needs: 10 a day, scaled to the window, never under 4 */
export function liveMinCount(hours: number): number {
  return Math.max(4, Math.round(10 * Math.min(24, Math.max(1, hours)) / 24))
}

/**
 * Spikes in the last few hours, against the same hours of the clock on the
 * days before (news has a daily rhythm: 3 AM is quiet everywhere).
 */
export function liveSpikes(rows: WindowRow[], opts: LiveSpikeOptions): LiveSpike[] {
  const historyDays = opts.historyDays ?? 7
  const minZ = opts.minZ ?? 3
  const minCount = opts.minCount ?? liveMinCount(opts.hours)
  const byKey = new Map<string, { category: string; region: string; now: number; past: number[] }>()
  for (const r of rows) {
    const key = `${r.category}\u0000${r.region}`
    let k = byKey.get(key)
    if (!k) { k = { category: r.category, region: r.region, now: 0, past: [] }; byKey.set(key, k) }
    const d = Number(r.day_back)
    const c = Number(r.count) || 0
    if (d === 0) k.now += c
    else if (d >= 1 && d <= historyDays) k.past.push(c)
  }
  const out: LiveSpike[] = []
  for (const k of byKey.values()) {
    if (k.now < minCount) continue
    const { avg, sd } = zeroFilledStats(k.past, historyDays)
    const z = fairZ(k.now, avg, sd)
    if (z < minZ) continue
    out.push({
      category: k.category, region: k.region, count: k.now, usual: round2(avg),
      spread: round2(Math.max(sd, Math.sqrt(avg), 1)), fair_z: round2(z), days_seen: k.past.length,
    })
  }
  return out.sort((a, b) => b.fair_z - a.fair_z)
}

// ─── Links that share a subject ──────────────────────────────────────────────

const STOP = new Set(('about after again against amid among around because been before being below between both could does doing down during each from further have having here into itself just more most much near news once only other over said says same should since some such than that their them then there these they this those through under until upon very were what when where which while will with would your year years week today latest live update report reports first last make makes made take takes call calls called might told tell tells').split(/\s+/))

function wordsOf(t: string): Map<string, boolean> {
  const out = new Map<string, boolean>()
  for (const w of String(t || '').match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]+/g) ?? []) {
    const lw = w.toLowerCase().replace(/^['-]+|['-]+$/g, '')
    if (lw.length < 4 || STOP.has(lw)) continue
    const isName = /^[A-ZÀ-Ý]/.test(w)
    out.set(lw, (out.get(lw) ?? false) || isName)
  }
  return out
}

/**
 * The words two headlines share when they are about the same subject: two or
 * more words, or one name both capitalise. Null when they share nothing real.
 */
export function sharedSubject(a: string, b: string): string[] | null {
  const wa = wordsOf(a), wb = wordsOf(b)
  const shared = [...wa.keys()].filter(w => wb.has(w))
  const names = shared.filter(w => wa.get(w) && wb.get(w))
  return shared.length >= 2 || names.length >= 1 ? shared : null
}

/** How many of the engine's claimed links share a subject or named entities */
export function sensibleLinks(report: {
  causal_chains?: Array<{ cause?: { title?: string }; effect?: { title?: string }; shared_entities?: string[] }>
  cross_cluster_bridges?: Array<{ signal_title?: string; thread_a?: { title?: string }; thread_b?: { title?: string }; shared_entities?: string[] }>
  entity_links?: unknown[]
} | null): { sensible: number; total: number } {
  if (!report) return { sensible: 0, total: 0 }
  const chains = report.causal_chains ?? []
  const bridges = report.cross_cluster_bridges ?? []
  let sensible = 0
  for (const c of chains) {
    if ((c.shared_entities?.length ?? 0) > 0 || sharedSubject(c.cause?.title ?? '', c.effect?.title ?? '')) sensible++
  }
  for (const b of bridges) {
    if ((b.shared_entities?.length ?? 0) > 0) { sensible++; continue }
    if (sharedSubject(b.signal_title ?? '', b.thread_a?.title ?? '') && sharedSubject(b.signal_title ?? '', b.thread_b?.title ?? '')) sensible++
  }
  const entityLinks = Array.isArray(report.entity_links) ? report.entity_links.length : 0
  return { sensible: sensible + entityLinks, total: chains.length + bridges.length + entityLinks }
}

// ─── The score ───────────────────────────────────────────────────────────────

export interface ScorePart { key: string; name: string; got: number; max: number; value: number }

export interface ScoreInputs {
  /** share of 30 days of reports confirmed by 2+ outlets (0-1) */
  multiSourceRate: number
  /** average outlet rating (0-1) */
  avgReliability: number
  /** % of reports with a fingerprint (0-100) */
  embeddingCoverage: number
  /** % of the week's reports linked to a named person, place or organisation (0-100) */
  entityCoverage: number | null
  /** share of 30 days of reports that belong to a story thread (0-1) */
  threadCoverage: number | null
  /** days of baselines (30+ is mature) */
  baselineDays: number
  /** links that share a subject or named entities */
  sensibleLinks: number
}

/**
 * The 0-100 intelligence score from honest parts. A part that could not be
 * measured this time (null) is left out of both the points and the maximum,
 * instead of counting as 0 — that is what made the old score swing by 10.
 */
export function honestScore(i: ScoreInputs): { score: number; parts: ScorePart[]; left_out: string[] } {
  const clamp = (x: number) => Math.max(0, Math.min(1, Number(x) || 0))
  const parts: ScorePart[] = []
  const left_out: string[] = []
  const add = (key: string, name: string, frac: number | null, max: number, value: number | null) => {
    if (frac == null || value == null) { left_out.push(name); return }
    parts.push({ key, name, got: round1(clamp(frac) * max), max, value: round2(value) })
  }
  add('corroboration', 'Confirmed by 2+ outlets', i.multiSourceRate, 20, i.multiSourceRate)
  add('reliability', 'Source reliability', i.avgReliability, 15, i.avgReliability)
  add('embeddings', 'Report fingerprints', i.embeddingCoverage / 100, 15, i.embeddingCoverage)
  add('entities', 'Reports linked to named people, places, organisations',
    i.entityCoverage == null ? null : i.entityCoverage / 100, 15, i.entityCoverage)
  add('threads', 'Reports in story threads', i.threadCoverage, 10, i.threadCoverage)
  add('baselines', 'Baselines (30+ days)', Math.min(1, i.baselineDays / 30), 10, i.baselineDays)
  add('patterns', 'Links that share a subject', Math.min(1, i.sensibleLinks / 20), 15, i.sensibleLinks)
  const got = parts.reduce((a, p) => a + p.got, 0)
  const max = parts.reduce((a, p) => a + p.max, 0)
  return { score: max > 0 ? Math.round((got / max) * 100) : 0, parts, left_out }
}

function round1(n: number): number { return Math.round(n * 10) / 10 }
function round2(n: number): number { return Math.round(n * 100) / 100 }
