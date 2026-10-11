/**
 * Readable names for the outlets a story's links come from ("bbc.co.uk" →
 * "BBC"), best-known first, for the email briefing (plan G4). HQ's post
 * drafts (plan G6) use the same list.
 */

const NAMES: Array<[string, string]> = [
  ['reuters.com', 'Reuters'], ['apnews.com', 'AP'], ['bbc.co.uk', 'BBC'], ['bbc.com', 'BBC'],
  ['aljazeera.com', 'Al Jazeera'], ['dw.com', 'DW'], ['france24.com', 'France 24'],
  ['theguardian.com', 'The Guardian'], ['npr.org', 'NPR'], ['nytimes.com', 'The New York Times'],
  ['washingtonpost.com', 'The Washington Post'], ['wsj.com', 'The Wall Street Journal'],
  ['ft.com', 'Financial Times'], ['bloomberg.com', 'Bloomberg'], ['economist.com', 'The Economist'],
  ['cnn.com', 'CNN'], ['nbcnews.com', 'NBC News'], ['cbsnews.com', 'CBS News'], ['abcnews.com', 'ABC News'],
  ['abcnews.go.com', 'ABC News'], ['abc.net.au', 'ABC Australia'], ['euronews.com', 'Euronews'],
  ['news.sky.com', 'Sky News'], ['independent.co.uk', 'The Independent'], ['scmp.com', 'South China Morning Post'],
  ['straitstimes.com', 'The Straits Times'], ['channelnewsasia.com', 'CNA'], ['thehindu.com', 'The Hindu'],
  ['hindustantimes.com', 'Hindustan Times'], ['timesofindia.indiatimes.com', 'The Times of India'],
  ['dawn.com', 'Dawn'], ['japantimes.co.jp', 'The Japan Times'], ['al-monitor.com', 'Al-Monitor'],
  ['middleeasteye.net', 'Middle East Eye'], ['lemonde.fr', 'Le Monde'], ['rte.ie', 'RTÉ'],
  ['smh.com.au', 'The Sydney Morning Herald'], ['voanews.com', 'VOA'], ['politico.com', 'Politico'],
  ['axios.com', 'Axios'], ['nature.com', 'Nature'], ['phys.org', 'Phys.org'],
]
const RANK = new Map(NAMES.map(([d], i) => [d, i]))
const NAME = new Map(NAMES)
/** Aggregators and tabloids: counted, but not the outlets a story is introduced by */
const NOT_NAMED = new Set(['yahoo.com', 'aol.co.uk', 'aol.com', 'msn.com', 'news.google.com', 'dailymail.com', 'dailymail.co.uk'])

/** Up to `count` outlet names for a story's outlet websites, best-known first */
export function outletNames(domains: string[], count = 3): string[] {
  const ds = domains.filter(d => typeof d === 'string' && d !== '' && !NOT_NAMED.has(d))
  ds.sort((a, b) => (RANK.get(a) ?? RANK.size) - (RANK.get(b) ?? RANK.size))
  const out: string[] = []
  for (const d of ds) {
    const n = NAME.get(d) ?? d
    if (!out.includes(n)) out.push(n)
    if (out.length === count) break
  }
  return out
}

/** "A", "A and B", "A, B and C" */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
