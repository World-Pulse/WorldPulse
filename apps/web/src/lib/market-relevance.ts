/**
 * Which prediction markets belong on a signal's page. The Polymarket search
 * answers loosely: for "12 killed, 309 injured in Riyadh Airport attack" it
 * offered an NBA game (Oct 11, 2026). A market is shown only when its
 * question names something particular from the headline (a person, a place,
 * a thing), not just the kind of event.
 */

/** Words too common in headlines to tie a market to a story */
const GENERIC = new Set([
  'about', 'after', 'again', 'against', 'amid', 'among', 'attack', 'attacks', 'being', 'breaking', 'calls',
  'could', 'dead', 'death', 'deaths', 'during', 'first', 'from', 'government', 'have', 'into', 'injured',
  'killed', 'kills', 'latest', 'leader', 'leaders', 'more', 'news', 'officials', 'other', 'over', 'people',
  'president', 'report', 'reports', 'said', 'says', 'should', 'since', 'than', 'that', 'their', 'there',
  'these', 'they', 'this', 'under', 'update', 'warns', 'what', 'when', 'where', 'which', 'while', 'will',
  'with', 'world', 'would', 'year', 'years',
])

/** The headline's particular words, in lower case */
export function particularWords(title: string): string[] {
  return [...new Set(title.toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length >= 4 && !/^\d+$/.test(w) && !GENERIC.has(w)))]
}

/** The markets whose question names one of the headline's particular words */
export function relevantMarkets<M extends { question: string }>(markets: M[], title: string): M[] {
  const words = particularWords(title)
  if (words.length === 0) return []
  return markets.filter(m => {
    const question = ` ${m.question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `
    return words.some(w => question.includes(` ${w} `))
  })
}
