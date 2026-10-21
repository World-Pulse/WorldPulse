/**
 * A story's figures and the outlets that report each one (plan 14, Oct 21,
 * 2026: "next to each claim inside a story, its outlets"; WorldMonitor's
 * country briefs give one corroboration count, ours links every figure to
 * the outlets that carry it).
 *
 * The figures are the numbers a story is about: people killed, injured,
 * missing, displaced, evacuated, arrested or abducted, rescued. They are read
 * from the reports' headlines with word rules (English, Spanish, French and
 * Portuguese), no AI. Each figure keeps the outlets that reported it, how many
 * reports, when it was first and last reported, and its newest headline, so a
 * reader sees which outlets say 153 and which say 220, and what each figure
 * is about (a story can join reports of more than one event: the headline
 * shows which).
 *
 * Left out on purpose: vague words ("dozens", "hundreds"), ages ("Woman, 65,
 * killed", "a 15-year-old"), years, money and percentages.
 */

export type FigureKind = 'killed' | 'injured' | 'missing' | 'displaced' | 'evacuated' | 'detained' | 'abducted' | 'rescued'

export const FIGURE_KINDS: ReadonlyArray<{ kind: FigureKind; label: string }> = [
  { kind: 'killed', label: 'Killed' },
  { kind: 'injured', label: 'Injured' },
  { kind: 'missing', label: 'Missing' },
  { kind: 'displaced', label: 'Displaced' },
  { kind: 'evacuated', label: 'Evacuated' },
  { kind: 'abducted', label: 'Abducted' },
  { kind: 'detained', label: 'Arrested or detained' },
  { kind: 'rescued', label: 'Rescued' },
]

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
}

// A number: 153, 8,000, 2 000 and 2.000 (French, Spanish, Portuguese), 1.2
// million, 3k, or a word (two … twenty, thirty … ninety)
const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+(?:\.\d+)?)(?:\s?(?:million|thousand|k)\b)?|\b(?:${Object.keys(WORDS).join('|')})\b`
// How sure the outlet is of it ("at least 153", "more than 150", "around 150")
const QUAL = String.raw`(?:(at least|more than|over|nearly|almost|around|about|some|up to|roughly|al menos|más de|cerca de|au moins|plus de|près de|environ|pelo menos|ao menos|mais de)\s+)?`
// Up to three words between a number and what it counts ("53 recruits killed",
// "15 Palestinian civilians killed"), none of them a number
const BETWEEN = String.raw`(?:\s+(?!(?:and|or|but|as|after|in|on|at)\b)[\p{L}'’-]+){0,3}?`

const AFTER: Record<FigureKind, string> = {
  killed: String.raw`killed|dead|deaths|died|dies|die|slain|murdered|perished|muertos|fallecidos|morts|tués|mortos`,
  injured: String.raw`injured|wounded|hurt|injuries|heridos|blessés|feridos`,
  missing: String.raw`missing|desaparecidos|disparus`,
  displaced: String.raw`displaced|homeless|desplazados|déplacés|deslocados|desalojados|desabrigados`,
  evacuated: String.raw`evacuated|evacuados|évacués|evacuadas`,
  detained: String.raw`arrested|detained|detenidos|interpellés|arrêtés|presos|detidos`,
  abducted: String.raw`abducted|kidnapped|taken hostage|secuestrados|enlevés|sequestrados`,
  rescued: String.raw`rescued|rescatados|secourus|resgatados`,
}

// Verbs before the number ("kills 53", "Gunmen abduct 15"); "leaves" and
// "claims" only in the patterns that say lives or dead ("leaves 3 dead" is an
// AFTER match), since "left 2 options" and "claims 2 wins" count no one
const BEFORE: Partial<Record<FigureKind, string>> = {
  killed: String.raw`kills|kill|killing|killed`,
  injured: String.raw`injures|injure|injuring|wounds|wounding|injured|wounded`,
  displaced: String.raw`displaces|displace|displacing|displaced`,
  evacuated: String.raw`evacuates|evacuate|evacuating|evacuated`,
  detained: String.raw`arrests|arrest|arresting|arrested|detains|detain|detaining|detained`,
  abducted: String.raw`abducts|abduct|abducting|abducted|kidnaps|kidnap|kidnapping|kidnapped`,
  rescued: String.raw`rescues|rescue|rescuing|rescued`,
}

interface Found { kind: FigureKind; value: number; qualifier: string }

/** The outlet's own hedge, in English: "au moins" and "al menos" are "at least" */
const QUAL_EN: Record<string, string> = {
  'al menos': 'at least', 'au moins': 'at least', 'pelo menos': 'at least', 'ao menos': 'at least',
  'más de': 'more than', 'plus de': 'more than', 'mais de': 'more than', over: 'more than',
  'cerca de': 'about', 'près de': 'about', environ: 'about', around: 'about', roughly: 'about', some: 'about',
  nearly: 'nearly', almost: 'nearly',
}

function parseNumber(raw: string): number | null {
  const t = raw.trim().toLowerCase().replace(/[\u00a0\u202f]/g, ' ')
  if (t in WORDS) return WORDS[t]!
  const m = t.match(/^([\d,. ]+?)\s?(million|thousand|k)?$/)
  if (!m) return null
  let digits = m[1]!.trim()
  // "2.000" and "2 000" without a scale word are thousands (Spanish, Portuguese, French)
  if (!m[2] && /^\d{1,3}(?:[. ]\d{3})+$/.test(digits)) digits = digits.replace(/[. ]/g, '')
  const base = Number(digits.replace(/,/g, ''))
  if (!Number.isFinite(base)) return null
  // a count of people is whole, unless it comes with a scale ("1.2 million")
  if (!m[2] && !Number.isInteger(base)) return null
  const scale = m[2] === 'million' ? 1e6 : m[2] === 'thousand' || m[2] === 'k' ? 1e3 : 1
  const value = Math.round(base * scale)
  return value > 0 && value < 1e8 ? value : null
}

/** Not a count of people: an age ("Woman, 65, killed", "a 15-year-old"), a year, money, a share, a name ("COVID-19", "Rescue 1122") */
function notACount(text: string, start: number, end: number, raw: string): boolean {
  const before = text.slice(Math.max(0, start - 3), start)
  const after = text.slice(end, end + 12)
  if (/[$€£¥₦]\s*$/.test(before)) return true
  // part of a name: "COVID-19 deaths", "MH-17", "Su-30"
  if (/[\p{L}\d]-$/u.test(before)) return true
  // Punjab's emergency service, "Rescue 1122", is not 1,122 people rescued
  if (raw.trim() === '1122' && /rescue\s*$/i.test(text.slice(Math.max(0, start - 8), start))) return true
  if (/^\s*(%|per\s?cent|-?\s*years?\b|-?\s*year-old|-?\s*months?\b|-?\s*days?\b|-?\s*hours?\b|km|miles|mph)/i.test(after)) return true
  // "Woman, 65, killed": a number between commas right after a word is an age
  if (/,\s*$/.test(before) && /^\s*,/.test(after)) return true
  if (/^\d{4}$/.test(raw.trim())) {
    const y = Number(raw.trim())
    if (y >= 1900 && y <= 2100) return true
  }
  return false
}

/** The figures in one headline */
export function findFigures(headline: string): Found[] {
  const text = headline.replace(/\s+/g, ' ')
  const found: Found[] = []
  const seen = new Set<string>()
  const add = (kind: FigureKind, raw: string, qualifier: string | undefined, start: number, end: number) => {
    if (notACount(text, start, end, raw)) return
    const value = parseNumber(raw)
    if (value === null) return
    const key = `${kind}:${value}`
    if (seen.has(key)) return
    seen.add(key)
    const q = (qualifier ?? '').toLowerCase()
    found.push({ kind, value, qualifier: QUAL_EN[q] ?? q })
  }
  for (const { kind } of FIGURE_KINDS) {
    // "153 people killed", "53 recruits killed", "8,000 displaced", "200 heridos"
    const after = new RegExp(String.raw`(?<![\p{L}\d.,])${QUAL}(${NUM})${BETWEEN}\s+(?:${AFTER[kind]})(?![\p{L}])`, 'giu')
    for (const m of text.matchAll(after)) {
      const raw = m[2]!
      const start = m.index! + m[0].indexOf(raw)
      add(kind, raw, m[1], start, start + raw.length)
    }
    // "kills at least 153", "killing more than 200 people", "injures 12"
    const verbs = BEFORE[kind]
    if (verbs) {
      const before = new RegExp(String.raw`(?<![\p{L}])(?:${verbs})\s+${QUAL}(${NUM})(?![\p{L}\d])`, 'giu')
      for (const m of text.matchAll(before)) {
        const raw = m[2]!
        const start = m.index! + m[0].lastIndexOf(raw)
        add(kind, raw, m[1], start, start + raw.length)
      }
    }
  }
  // "Fire claims 9 lives"
  const lives = new RegExp(String.raw`(?<![\p{L}])(?:claims|claimed|claiming|claim)\s+${QUAL}(${NUM})\s+lives\b`, 'giu')
  for (const m of text.matchAll(lives)) {
    const raw = m[2]!
    const start = m.index! + m[0].lastIndexOf(raw)
    add('killed', raw, m[1], start, start + raw.length)
  }
  // "death toll from the Houthi attack on a Yemen training camp rises to 73"
  const toll = new RegExp(String.raw`death toll\b[^.;:!?]{0,80}?\b(?:rises|rose|climbs|climbed|jumps|jumped|reaches|reached|hits|tops|passes|now|stands|is)\s+(?:to\s+|at\s+)?${QUAL}(${NUM})(?![\p{L}\d])`, 'giu')
  for (const m of text.matchAll(toll)) {
    const raw = m[2]!
    const start = m.index! + m[0].lastIndexOf(raw)
    add('killed', raw, m[1], start, start + raw.length)
  }
  return found
}

export interface FigureReport {
  title: string
  /** The report's own article first, then the story's other links it holds */
  urls: string[]
  at: string | null
}

export interface FigureValue {
  value: number
  /** As most of its reports put it: "at least 153", "more than 220", "73" */
  text: string
  /** Outlets (websites) that reported it */
  outlets: number
  outletNames: string[]
  reports: number
  firstAt: string | null
  lastAt: string | null
  /** Its newest headline and that report's link: what the figure is about */
  headline: string
  url: string | null
}

export interface StoryFigure {
  kind: FigureKind
  label: string
  /** Newest first */
  values: FigureValue[]
}

const hostOf = (url: string | undefined): string => {
  try { return url ? new URL(url).hostname.toLowerCase().replace(/^www\./, '') : '' } catch { return '' }
}

/** Every figure in a story's reports, each with the outlets that report it; kinds in a fixed order, values newest first */
export function storyFigures(reports: FigureReport[], valuesPerKind = 5): StoryFigure[] {
  type Acc = { value: number; quals: Map<string, number>; outlets: Set<string>; reports: number; first: number; last: number; headline: string; url: string | null }
  const byKind = new Map<FigureKind, Map<number, Acc>>()
  for (const r of reports) {
    if (typeof r.title !== 'string' || !r.title) continue
    const at = r.at ? Date.parse(r.at) : NaN
    const t = Number.isFinite(at) ? at : 0
    const host = hostOf(r.urls[0])
    for (const f of findFigures(r.title)) {
      const kind = byKind.get(f.kind) ?? new Map<number, Acc>()
      byKind.set(f.kind, kind)
      const acc = kind.get(f.value) ?? { value: f.value, quals: new Map(), outlets: new Set(), reports: 0, first: Infinity, last: -Infinity, headline: r.title, url: r.urls[0] ?? null }
      kind.set(f.value, acc)
      acc.quals.set(f.qualifier, (acc.quals.get(f.qualifier) ?? 0) + 1)
      if (host) acc.outlets.add(host)
      acc.reports += 1
      acc.first = Math.min(acc.first, t)
      if (t >= acc.last) { acc.last = t; acc.headline = r.title; acc.url = r.urls[0] ?? null }
    }
  }
  const iso = (t: number) => (Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null)
  const out: StoryFigure[] = []
  for (const { kind, label } of FIGURE_KINDS) {
    const values = byKind.get(kind)
    if (!values) continue
    const list = [...values.values()]
      .sort((a, b) => b.last - a.last || b.outlets.size - a.outlets.size)
      .slice(0, valuesPerKind)
      .map(a => {
        const qual = [...a.quals.entries()].sort((x, y) => y[1] - x[1] || (y[0] ? 1 : 0) - (x[0] ? 1 : 0))[0]?.[0] ?? ''
        return {
          value: a.value,
          text: (qual ? qual + ' ' : '') + a.value.toLocaleString('en-US'),
          outlets: a.outlets.size,
          outletNames: [...a.outlets].sort().slice(0, 8),
          reports: a.reports,
          firstAt: iso(a.first),
          lastAt: iso(a.last),
          headline: a.headline,
          url: a.url,
        }
      })
    out.push({ kind, label, values: list })
  }
  return out
}
