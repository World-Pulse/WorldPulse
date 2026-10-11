/**
 * Independent outlets.
 *
 * Two reports on different websites aren't independent reporting when one is
 * a copy of the other, so copies count as one outlet toward verification:
 *  - sister sites of one owner publish the same article under the same address
 *    slug (Sinclair stations, Oct 2026: cbs12.com/weather/hurricane-stories/
 *    governor-ron-desantis-to-address-… and foxrochester.com/news/nation-world/
 *    governor-ron-desantis-to-address-…);
 *  - papers that run a wire story usually keep its headline word for word
 *    (one AFP headline on CNA, DW and VnExpress is one report, not three).
 * Competitors count distinct websites; counting independent ones is what makes
 * "verified" mean something (competitor watch, Oct 10, 2026).
 */

export interface OutletReport {
  /** The outlet's key (website, else source id); reports without one don't count */
  source_id?: string | null
  url?: string | null
  title?: string | null
}

/** Shortest slug or headline that is specific enough to identify a copy */
const MIN_SLUG_WORDS = 4
const MIN_HEADLINE_WORDS = 5

/**
 * The last part of an article's address when it reads like a headline
 * ("governor-ron-desantis-to-address-hurricane-isaias-damage"), without numeric
 * ids or file extensions; null for short or numeric ones ("index.html", "12345").
 */
export function articleSlug(url: string | null | undefined): string | null {
  if (!url) return null
  let last: string
  try {
    last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
    last = decodeURIComponent(last)
  } catch {
    return null
  }
  const words = last
    .toLowerCase()
    .replace(/\.(?:s?html?|php|aspx?|amp)$/, '')
    .split(/[-_+]+/)
    .filter(w => /[a-z]/.test(w)) // drop story ids like "13563284"
  return words.length >= MIN_SLUG_WORDS ? words.join('-') : null
}

/** A headline reduced to its words, to spot word-for-word copies; null under 5 words */
export function headlineKey(title: string | null | undefined): string | null {
  const words = (title ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’']/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  return words.length >= MIN_HEADLINE_WORDS ? words.join(' ') : null
}

/**
 * Groups reports that are the same outlet or copies of one article. Returns,
 * for each report with an outlet, the index of its group's first report
 * (reports without an outlet map to -1).
 */
function groupCopies(reports: OutletReport[]): number[] {
  const parent = reports.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const firstWithKey = new Map<string, number>()
  reports.forEach((r, i) => {
    if (!r.source_id) return
    const slug = articleSlug(r.url)
    const headline = headlineKey(r.title)
    const keys = [`s:${r.source_id}`, slug ? `u:${slug}` : '', headline ? `t:${headline}` : ''].filter(Boolean)
    for (const key of keys) {
      const j = firstWithKey.get(key)
      if (j === undefined) firstWithKey.set(key, i)
      else {
        const a = find(i), b = find(j)
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b)
      }
    }
  })
  return reports.map((r, i) => (r.source_id ? find(i) : -1))
}

/** How many independent outlets the reports come from */
export function countIndependentOutlets(reports: OutletReport[]): number {
  return new Set(groupCopies(reports).filter(g => g >= 0)).size
}

/** One report per independent outlet (the first of each group), in the original order */
export function independentReports<T>(items: T[], report: (item: T) => OutletReport): T[] {
  const groups = groupCopies(items.map(report))
  return items.filter((_, i) => groups[i] === i)
}

/**
 * Whether an incoming report is a copy of one a signal already holds: the same
 * article slug as one of its links, or the same headline word for word.
 */
export function isCopyOf(
  incoming: { url?: string | null; title?: string | null },
  held: { urls: string[]; title?: string | null },
): boolean {
  const slug = articleSlug(incoming.url)
  if (slug && held.urls.some(u => articleSlug(u) === slug)) return true
  const headline = headlineKey(incoming.title)
  return headline !== null && headline === headlineKey(held.title)
}
