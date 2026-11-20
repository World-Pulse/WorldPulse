/**
 * Cities and provinces named in Chinese, Japanese and Korean (Nov 20, 2026): of the 13 hours' reports, those linked to
 * a named person, place or organisation went from 17% to 31% in Chinese, 13% to 42% in Japanese, 8% to 13% in Korean.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/redis', () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK'), set: vi.fn(async () => 'OK') } }))
vi.mock('../../lib/postgres', () => ({ db: Object.assign(vi.fn(), { raw: vi.fn() }), pgPool: { query: vi.fn() } }))
vi.mock('../../lib/logger', () => {
  const logger: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})

const { cjkPlaces, CJK_PLACE_NAMES } = await import('../cjk-places')
const { scriptPlaces } = await import('../insert-signal')
const { refinePlace } = await import('../entity-cleanup')

describe('places in Chinese, Japanese and Korean', () => {
  it('are read wherever they stand in Chinese and Japanese, the longest first', () => {
    expect(cjkPlaces('桃園中壢轎車撞進寶雅騎樓　1人命危送醫搶救')).toEqual(['Taoyuan'])
    expect(cjkPlaces('集聚英才强链补链 重庆高新区发力新一代电子信息制造业')).toEqual(['Chongqing'])
    expect(cjkPlaces('群馬県内の逸品を全国へお届け代行　新潟の企業')).toEqual(['Gunma Prefecture', 'Niigata'])
    expect(cjkPlaces('東京都と横浜市など5都市の消防が連携')).toEqual(['Tokyo', 'Yokohama'])   // not Kyoto
    expect(cjkPlaces('スノーシェッドにトラック衝突　長野市の市道')).toEqual(['Nagano Prefecture'])
  })

  it('and in Korean where no syllable comes before them', () => {
    expect(cjkPlaces('부산 사하구서 시외버스 불…인명피해 없어')).toEqual(['Busan'])
    expect(cjkPlaces('민주평통 대구·광주지역회의')).toEqual(['Daegu', 'Gwangju'])
    expect(cjkPlaces('제2차 세계대전 종전 기념식')).toEqual([])           // a world war, not Daejeon
    expect(cjkPlaces('음식물 부산물 재활용')).toEqual([])                 // a by-product, not Busan
  })

  it('leave out what makes the name something else', () => {
    expect(cjkPlaces('北京时间11月20日凌晨')).toEqual([])                  // Beijing time
    expect(cjkPlaces('巴丹吉林沙漠里的“三北”治沙答卷')).toEqual([])        // the Badain Jaran desert
    expect(cjkPlaces('上海合作组织成员国会议')).toEqual([])                 // the Shanghai Cooperation Organisation
    expect(cjkPlaces('石川さんと山口さんが会談')).toEqual([])               // surnames
    expect(cjkPlaces('Typhoon nears Tokyo')).toEqual([])
  })

  it('name each place as the start-up repair keeps it', () => {
    for (const name of CJK_PLACE_NAMES) expect(refinePlace(name, 1)?.name, name).toBe(name)
  })

  it("come after the matcher's countries, two at most", () => {
    expect(scriptPlaces('疑收中共金援網軍　桃園市議員候選人周曉芸遭起訴')).toEqual(['China', 'Taoyuan'])
  })
})
