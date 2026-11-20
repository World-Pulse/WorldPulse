/**
 * Places named in Ukrainian, and the Ukrainian cities in Russian (Nov 20, 2026): of the 903 reports in Ukrainian of
 * 13 hours, those linked to a named person, place or organisation went from 20% to 62%; in Russian, 42% to 47%.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK'), set: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})

const { cyrillicPlaces, CYRILLIC_PLACE_NAMES } = await import('../cyrillic-places')
const { scriptPlaces } = await import('../insert-signal')
const { placesInText } = await import('../geo')
const { listedPlace } = await import('../entity-rules')

describe('places in Ukrainian', () => {
  it('are read with their case endings', () => {
    expect(cyrillicPlaces('Удари по мостах Києва, по Львову та інших містах: які наслідки атаки')).toEqual(['Kyiv', 'Lviv'])
    expect(cyrillicPlaces('Їй було лише 19: російська атака на Одесу забрала життя')).toEqual(['Russia', 'Odesa'])
    expect(cyrillicPlaces('Російські ракети та дрон залетіли в Польщу: лунали вибухи')).toEqual(['Russia', 'Poland'])
    expect(cyrillicPlaces('ЗСУ звільнили 14 сіл: секретні бої на Харківщині')).toEqual(['Kharkiv'])
    expect(cyrillicPlaces('Начальник ГУР провів наради на Запорізькому напрямку')).toEqual(['Zaporizhzhia'])
    expect(cyrillicPlaces('Як змінилися ціни на житло в Україні')).toEqual(['Ukraine'])
    expect(cyrillicPlaces('У РФ заговорили про ремонт Кримського мосту')).toEqual(['Russia', 'Crimea'])
  })

  it("and the war's cities in Russian, and the countries the matcher's list lacks", () => {
    expect(cyrillicPlaces('Ракетный удар по Харькову и Запорожью')).toEqual(['Kharkiv', 'Zaporizhzhia'])
    expect(cyrillicPlaces('Туск назвал падение российских ракет в Польше преднамеренной провокацией')).toEqual(['Poland'])
    expect(cyrillicPlaces('Промышленное производство в Молдове выросло')).toEqual(['Moldova'])
  })

  it("doesn't read a longer word as the place", () => {
    expect(cyrillicPlaces('Кримінальна справа щодо посадовця')).toEqual([])      // criminal, not Crimea
    expect(cyrillicPlaces('Сирий хліб і сирі овочі')).toEqual([])                // raw, not Syria
    expect(cyrillicPlaces('Ціни на індичку зросли')).toEqual([])                  // turkey (the bird), not India
    expect(cyrillicPlaces('Weather in Kyiv')).toEqual([])
  })

  it('names each place as the gazetteer or the newer list spells it', () => {
    for (const name of CYRILLIC_PLACE_NAMES) expect(placesInText(name)[0] === name || listedPlace(name) === name, name).toBe(true)
  })

  it("come after the matcher's countries, two at most", () => {
    expect(scriptPlaces('Посольство России отвергло обвинения Австрии в ударе по дипмиссии в Киеве')).toEqual(['Russia', 'Ukraine'])
    expect(scriptPlaces('Росіяни вдарили реактивним "Шахедом" по Харкову')).toEqual(['Russia', 'Kharkiv'])
  })
})
