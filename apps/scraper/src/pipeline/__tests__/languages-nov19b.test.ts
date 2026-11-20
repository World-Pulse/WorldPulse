/**
 * The second-outlet search in Hungarian, Czech, Slovak, Finnish, Estonian, Lithuanian, Latvian, Norwegian and Swahili
 * (Nov 19, 2026, evening; Devon, 7:56 PM: "where should we add and improve now?"): their reports' second outlets are
 * looked for in GDELT's translated list, Hungarian's, Czech's and Slovak's serious news rated above low.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})
vi.mock('../crosscheck', () => ({ crossCheckLater: vi.fn() }))

const { rateSeverity } = await import('../severity')
const { foreignCasualties } = await import('../severity-languages')
const { waitingQuery, storyTokens, SEARCHED_LANGUAGES } = await import('../second-outlet')
const { TRANSLATED_LANGUAGES } = await import('../gdelt-articles')

describe('severity in Hungarian, Czech and Slovak', () => {
  it('counts the dead and injured', () => {
    expect(foreignCasualties('Buszbaleset: 5 ember meghalt, 12 megsérült', 'hu')).toMatchObject({ dead: 5, injured: 12 })
    expect(foreignCasualties('Legalább 7 halott a földrengésben', 'hu')?.dead).toBe(7)
    expect(foreignCasualties('Nehoda autobusu: zahynulo 6 lidí, 20 osob bylo zraněno', 'cs')).toMatchObject({ dead: 6, injured: 20 })
    expect(foreignCasualties('Počet obětí stoupl na 14', 'cs')?.dead).toBe(14)
    expect(foreignCasualties('Pri nehode zahynuli 3 ľudia', 'sk')?.dead).toBe(3)
    expect(foreignCasualties('Při požáru zemřeli 2 lidé', 'cs')?.dead).toBe(2)
    expect(foreignCasualties('Výbuch: 4 mŕtvych a 9 zranených', 'sk')).toMatchObject({ dead: 4, injured: 9 })
  })

  it('rates serious news above low, everyday news low', () => {
    expect(rateSeverity('Robbanás egy budapesti lakóházban', null, 'other', 'hu')).toBe('high')
    expect(rateSeverity('Tüntetés a Parlament előtt', null, 'politics', 'hu')).toBe('medium')
    expect(rateSeverity('Új könyvtár nyílt Debrecenben', null, 'culture', 'hu')).toBe('low')
    expect(rateSeverity('Rusko provedlo masivní nálet na Kyjev', null, 'other', 'cs')).toBe('high')
    expect(rateSeverity('Stávka dopravců v Praze', null, 'economy', 'cs')).toBe('medium')
    expect(rateSeverity('Nová výstava v Brně', null, 'culture', 'cs')).toBe('low')
    expect(rateSeverity('Požiar v Bratislave', null, 'other', 'sk')).toBe('medium')
    expect(rateSeverity('Nové kino v Košiciach', null, 'culture', 'sk')).toBe('low')
  })
})

describe('the search in these languages', () => {
  it("reads GDELT's translated list in them and searches their waiting reports", () => {
    expect(TRANSLATED_LANGUAGES).toMatchObject({ hun: 'hu', ces: 'cs', slk: 'sk', fin: 'fi', est: 'et', lit: 'lt', lav: 'lv', nor: 'no', swa: 'sw' })
    const { sql } = waitingQuery([], new Date('2026-11-20T04:00:00Z'))
    for (const lang of ['hu', 'cs', 'sk', 'fi', 'et', 'lt', 'lv', 'no', 'sw']) expect(sql).toContain(`'${lang}'`)
    for (const lang of new Set(Object.values(TRANSLATED_LANGUAGES))) expect(SEARCHED_LANGUAGES).toContain(lang)
  })

  it('leaves out their small words', () => {
    expect(storyTokens('Meghalt öt ember egy balesetben Budapesten', 'hu')).not.toContain('egy')
    expect(storyTokens('Policie zadržela muže, který útočil v Praze', 'cs')).not.toContain('ktery')
    expect(storyTokens('Hallitus kertoo uusista leikkauksista', 'fi')).not.toContain('kertoo')
    expect(storyTokens('Rais amesema kuhusu uchaguzi', 'sw')).not.toContain('amesema')
  })
})
