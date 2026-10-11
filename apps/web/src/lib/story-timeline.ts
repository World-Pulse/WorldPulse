/**
 * A story's timeline (plan item 12d): how it unfolded, from the story's
 * reports as GET /api/v1/stories/:id returns them — the first report, each
 * outlet that joined, the moment two independent outlets made it verified,
 * when a report raised its severity, and which reports came in since you
 * last looked.
 */

export interface TimelineMember {
  id: string
  title: string
  status: string
  outlet: string
  url: string | null
  createdAt: string | null
  verifiedAt: string | null
  severity?: string | null
  /** 1 for the story's first report (the API leaves out the middle of a big story) */
  position?: number | null
}

export type TimelineEntry =
  | {
      kind: 'report'
      member: TimelineMember
      at: number
      /** The story's first report */
      first: boolean
      /** The signal this page shows */
      current: boolean
      /** Came in after your last look at this story */
      isNew: boolean
      /** The outlet's first report in this story */
      newOutlet: boolean
    }
  | { kind: 'verified'; at: number }
  | { kind: 'severity'; at: number; severity: string }

const SEVERITY_RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 }

const time = (iso: string | null | undefined): number => {
  const t = iso ? new Date(iso).getTime() : NaN
  return Number.isFinite(t) ? t : NaN
}

export function storyTimeline(
  members: TimelineMember[],
  verifiedAt: string | null,
  currentId: string,
  seenAt: number | null = null,
): { entries: TimelineEntry[]; reports: number; outlets: number; newCount: number } {
  const dated = members
    .filter(m => m && Number.isFinite(time(m.createdAt)))
    .sort((a, b) => time(a.createdAt) - time(b.createdAt))
  const entries: TimelineEntry[] = []
  const outlets = new Set<string>()
  let highest = -1
  let newCount = 0
  const verified = time(verifiedAt)
  let verifiedPlaced = !Number.isFinite(verified)

  dated.forEach((member, i) => {
    const at = time(member.createdAt)
    // Verified slots in at its moment, after the reports before it
    if (!verifiedPlaced && verified < at) {
      entries.push({ kind: 'verified', at: verified })
      verifiedPlaced = true
    }
    const outlet = member.outlet?.trim() || ''
    const newOutlet = outlet !== '' && !outlets.has(outlet)
    if (outlet) outlets.add(outlet)
    const isNew = seenAt != null && at > seenAt && member.id !== currentId
    if (isNew) newCount++
    entries.push({ kind: 'report', member, at, first: i === 0, current: member.id === currentId, isNew, newOutlet })

    const rank = SEVERITY_RANK[member.severity ?? ''] ?? -1
    if (i > 0 && rank > highest && highest >= 0 && rank >= SEVERITY_RANK.medium!) {
      entries.push({ kind: 'severity', at, severity: member.severity! })
    }
    highest = Math.max(highest, rank)
  })
  if (!verifiedPlaced) entries.push({ kind: 'verified', at: verified })

  return { entries, reports: dated.length, outlets: outlets.size, newCount }
}

/**
 * What to fold on a long story: the first `head` reports, the latest `tail`
 * and the one you're reading stay; each run of entries between them folds
 * into one "… N more reports" line. Returns, for every folded entry, the
 * number of reports its line stands for at the run's first entry and 0 for
 * the rest. Nothing folds when it would hide two reports or fewer.
 */
export function foldTimeline(entries: TimelineEntry[], head = 3, tail = 4): Map<number, number> {
  const reports = entries.map((e, i) => (e.kind === 'report' ? i : -1)).filter(i => i >= 0)
  const folds = new Map<number, number>()
  if (reports.length <= head + tail + 2) return folds
  const keep = new Set([...reports.slice(0, head), ...reports.slice(-tail)])
  entries.forEach((e, i) => { if (e.kind === 'report' && e.current) keep.add(i) })
  const from = reports[head - 1]! + 1
  const to = reports[reports.length - tail]! - 1
  let runStart = -1
  for (let i = from; i <= to + 1; i++) {
    const inRun = i <= to && !keep.has(i)
    if (inRun && runStart < 0) runStart = i
    if (!inRun && runStart >= 0) {
      // Reports the run stands for: from the positions around it when the API gave
      // them (the reports it left out of a big story included), else those in the run
      const before = entries.slice(0, runStart).reverse().find(x => x.kind === 'report')
      const after = entries.slice(i).find(x => x.kind === 'report')
      const posBefore = before?.kind === 'report' ? before.member.position : null
      const posAfter = after?.kind === 'report' ? after.member.position : null
      const inRunCount = entries.slice(runStart, i).filter(x => x.kind === 'report').length
      const count = posBefore && posAfter && posAfter - posBefore - 1 >= inRunCount ? posAfter - posBefore - 1 : inRunCount
      // A run with no report in it (a severity rise between two kept reports) stays as it is
      if (count > 0) for (let j = runStart; j < i; j++) folds.set(j, j === runStart ? count : 0)
      runStart = -1
    }
  }
  return folds
}

/** "9:12 AM" today, "Oct 9, 9:12 AM" on another day */
export function clockLabel(at: number, now = Date.now()): string {
  const d = new Date(at)
  const sameDay = new Date(now).toDateString() === d.toDateString()
  return d.toLocaleString('en-US', sameDay
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** How long after the first report: "+25 min", "+3 h", "+2 d" */
export function sinceFirst(at: number, firstAt: number): string {
  const minutes = Math.max(0, Math.round((at - firstAt) / 60_000))
  if (minutes < 60) return `+${minutes} min`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `+${hours} h` : `+${Math.round(hours / 24)} d`
}
