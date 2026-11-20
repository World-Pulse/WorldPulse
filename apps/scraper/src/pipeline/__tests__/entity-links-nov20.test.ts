/**
 * Reports linked to named people, places and organisations (Nov 20, 2026; Devon, 11:14 AM: would that share rise
 * too?). The start-up repair cut the links (it runs at every update of the site): an entity with a variant to fold
 * in kept 100 of its reports (Mexico, named in 2,867, kept 101), and it deleted the newer list's cities the gazetteer
 * doesn't know whenever they had fewer than 20 mentions. And headlines in other scripts were linked to no place: the
 * rules read English names in Latin letters.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK'), set: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})

const { refinePlace, mergedSignalIds, planEntityCleanup } = await import('../entity-cleanup')
const { listedPlace } = await import('../entity-rules')
const { matcherCountries } = await import('../insert-signal')
const { entityId } = await import('../entity-graph')

const row = (id: string, type: string, canonical_name: string, mention_count: number, signal_ids: string[]) => ({
  id, type, canonical_name, aliases: [canonical_name], mention_count, signal_ids,
  first_seen: '2026-11-01T00:00:00Z', last_seen: '2026-11-20T00:00:00Z', metadata: {},
})

describe('the start-up repair', () => {
  it("keeps the newer list's cities, even named only a few times", () => {
    expect(refinePlace('Naucalpan de Juárez', 3)).toEqual({ type: 'location', name: 'Naucalpan de Juárez' })
    expect(refinePlace('Sao Bernardo do Campo', 1)).toEqual({ type: 'location', name: 'São Bernardo do Campo' })
    expect(listedPlace('  naucalpan de juarez ')).toBe('Naucalpan de Juárez')
    // and is as it was for the rest
    expect(refinePlace('France Consultation', 300)).toEqual({ type: 'location', name: 'France' })
    expect(refinePlace('Pleasant Valley Road', 3)).toBeNull()
    expect(refinePlace('Topeka', 157)).toEqual({ type: 'location', name: 'Topeka' })
  })

  it('leaves a clean city of the list as it is', () => {
    const plan = planEntityCleanup([row(entityId('location', 'Naucalpan de Juárez'), 'location', 'Naucalpan de Juárez', 2, ['s1'])])
    expect(plan.deletes).toEqual([])
    expect(plan.totals).toEqual({ merged: 0, removed: 0, retyped: 0, renamed: 0 })
  })

  it('keeps every report of the entities it folds into one', () => {
    const many = Array.from({ length: 150 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    const merged = mergedSignalIds([{ signal_ids: many }, { signal_ids: [...many.slice(0, 10), 'ffffffff-0000-4000-8000-000000000000'] }, { signal_ids: null }])
    expect(merged).toHaveLength(151)
    expect(merged).toContain('ffffffff-0000-4000-8000-000000000000')
  })
})

describe("a headline's countries in any script", () => {
  it('are read as the matcher reads them, named as the gazetteer names them', () => {
    expect(matcherCountries('今年1-10月中国财政收入同比增长4.9%')).toEqual(['China'])
    expect(matcherCountries('ポーランドにミサイル落下　ロシアのウクライナ攻撃で侵入')).toEqual(['Russia', 'Ukraine'])
    expect(matcherCountries('عادل العمدة: إصرار نتنياهو على ضرب إيران تحكمه 5 دوافع والموقف الأمريكي غير واضح')).toEqual(['Iran', 'United States'])
    expect(matcherCountries('Politico: Трамп потребовал от ЕС объяснить траты на военную помощь Украине')).toEqual(['Ukraine'])
    expect(matcherCountries('미국 전쟁부 "이란과의 분쟁 비용 483억 달러로 증가"')).toEqual(['United States', 'Iran'])
  })

  it('are two at most, and none when the headline names none', () => {
    expect(matcherCountries('Россия, Китай и Индия обсудили торговлю с Ираном').length).toBeLessThanOrEqual(2)
    expect(matcherCountries('แล็บไทยยังเผชิญ‘ช่องว่างดิจิทัล’')).toEqual(['Thailand'])
    expect(matcherCountries('Weather warning for the weekend')).toEqual([])
  })
})
