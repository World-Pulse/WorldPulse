/**
 * A window of days read one day at a time, each day kept (lib/day-scans.ts, Nov 22, 2026).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const store = new Map<string, string>()
const ttls = new Map<string, number>()
const redisMock = {
  get: vi.fn(async (k: string) => store.get(k) ?? null),
  setex: vi.fn(async (k: string, ttl: number, v: string) => { store.set(k, v); ttls.set(k, ttl); return 'OK' }),
}
vi.mock('../../db/redis', () => ({ get redis() { return redisMock } }))
const seconds: number[] = []
vi.mock('../long-query', () => ({ longQuery: async (s: number, run: (trx: unknown) => Promise<unknown>) => { seconds.push(s); return run({}) } }))

import { windowRows, dayStands, msOf, SETTLE_MS, UNSETTLED_EVERY_MS, KEEP_DAYS, DAY_MS, type DayScan } from '../day-scans'

interface Row { id: string; at: number }
const T = (iso: string) => new Date(iso).getTime()
/** The rows the database holds: one at noon each day from Nov 1, and a few more on Nov 10 */
const DB: Row[] = [
  ...Array.from({ length: 10 }, (_, i) => ({ id: `d${i + 1}`, at: T(`2026-11-${String(i + 1).padStart(2, '0')}T12:00:00Z`) })),
  { id: 'late', at: T('2026-11-10T22:00:00Z') }, { id: 'early', at: T('2026-11-10T01:00:00Z') },
]
let failOn: string | null = null
const read = vi.fn(async (_trx: unknown, from: string, to: string): Promise<Row[]> => {
  if (failOn === from) throw new Error('canceling statement due to statement timeout')
  return DB.filter(r => r.at >= T(from) && r.at < T(to))
})
const scan: DayScan<Row> = { prefix: 'test:scan', todaySeconds: 900, querySeconds: 60, read, at: r => r.at }

beforeEach(() => {
  store.clear(); ttls.clear(); seconds.length = 0; failOn = null
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-10T23:30:00Z'))
})
afterEach(() => { vi.useRealTimers() })

const days = () => read.mock.calls.map(c => String(c[1]).slice(0, 10))

describe('windowRows', () => {
  it('reads each day of the window once, with its own time limit, and gives the rows newer than now minus the days, newest first', async () => {
    const rows = await windowRows(scan, 3)
    // three days back from Nov 10, 23:30 is Nov 7, 23:30: its noon report is older
    expect(rows.map(r => r.id)).toEqual(['late', 'd10', 'early', 'd9', 'd8'])
    expect(days()).toEqual(['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'])
    expect(read.mock.calls[0]!.slice(1)).toEqual(['2026-11-07T00:00:00.000Z', '2026-11-08T00:00:00.000Z'])
    expect(seconds).toEqual([60, 60, 60, 60])
    expect([...store.keys()]).toEqual(['test:scan:day:2026-11-07', 'test:scan:day:2026-11-08', 'test:scan:day:2026-11-09', 'test:scan:day:2026-11-10'])
    // kept until KEEP_DAYS after the day ends: Nov 10 ends at midnight, 30 minutes from now
    expect(ttls.get('test:scan:day:2026-11-10')).toBe(30 * 60 + KEEP_DAYS * 86_400)
  })

  it('reads again only today, once its read is older than todaySeconds, and a past day still settling at most hourly', async () => {
    await windowRows(scan, 3)
    read.mockClear()
    // 10 minutes on: everything stands
    vi.setSystemTime(new Date('2026-11-10T23:40:00Z'))
    expect((await windowRows(scan, 3)).length).toBe(5)
    expect(read).not.toHaveBeenCalled()
    // 16 minutes on: today again; Nov 9 ended 23 hours before it was read, so it had settled
    vi.setSystemTime(new Date('2026-11-10T23:46:00Z'))
    await windowRows(scan, 3)
    expect(days()).toEqual(['2026-11-10'])
    // past midnight: Nov 10 was read before it ended, so it is read again an hour after that read, until it settles
    read.mockClear()
    vi.setSystemTime(new Date('2026-11-11T00:40:00Z'))
    await windowRows(scan, 3)
    expect(days()).toEqual(['2026-11-11'])
    read.mockClear()
    vi.setSystemTime(new Date('2026-11-11T00:50:00Z'))
    await windowRows(scan, 3)
    expect(days()).toEqual(['2026-11-10'])
    // read at 00:50, before Nov 10 had settled (6 hours after it ended): again within the hour no, after it yes
    read.mockClear()
    vi.setSystemTime(new Date('2026-11-11T01:30:00Z'))
    await windowRows(scan, 3)
    expect(days()).toEqual(['2026-11-11'])
    read.mockClear()
    vi.setSystemTime(new Date('2026-11-11T06:10:00Z'))
    await windowRows(scan, 3)
    expect(days()).toEqual(['2026-11-10', '2026-11-11'])
    // read at 06:10, past 06:00: settled, kept for good
    read.mockClear()
    vi.setSystemTime(new Date('2026-11-11T09:00:00Z'))
    await windowRows(scan, 3)
    expect(days()).toEqual(['2026-11-11'])
  })

  it('keeps each row in the day it was made, whatever a read gives', async () => {
    read.mockImplementationOnce(async () => [{ id: 'd9', at: T('2026-11-09T12:00:00Z') }, { id: 'd7', at: T('2026-11-07T12:00:00Z') }])
    const rows = await windowRows(scan, 3)
    // the first read was Nov 7's: its stray Nov 9 row is left out, and Nov 9's own read gives it once
    expect(rows.filter(r => r.id === 'd9')).toHaveLength(1)
    expect(JSON.parse(store.get('test:scan:day:2026-11-07')!).rows.map((r: Row) => r.id)).toEqual(['d7'])
  })

  it('keeps the days read before one that fails, so the next try starts from the one that failed', async () => {
    failOn = '2026-11-09T00:00:00.000Z'
    await expect(windowRows(scan, 3)).rejects.toThrow('statement timeout')
    expect(days()).toEqual(['2026-11-07', '2026-11-08', '2026-11-09'])
    read.mockClear(); failOn = null
    expect((await windowRows(scan, 3)).length).toBe(5)
    expect(days()).toEqual(['2026-11-09', '2026-11-10'])
  })

  it('reads every day again when Redis cannot keep them', async () => {
    redisMock.get.mockRejectedValueOnce(new Error('down'))
    redisMock.setex.mockRejectedValue(new Error('down'))
    expect((await windowRows(scan, 1)).map(r => r.id)).toEqual(['late', 'd10', 'early'])
    expect((await windowRows(scan, 1)).length).toBe(3)
    expect(read).toHaveBeenCalledTimes(4)
    redisMock.setex.mockReset()
    redisMock.setex.mockImplementation(async (k: string, ttl: number, v: string) => { store.set(k, v); ttls.set(k, ttl); return 'OK' })
  })
})

describe('dayStands and msOf', () => {
  const end = T('2026-11-10T00:00:00Z')
  it("stands today's read for todaySeconds, a past day's for good once read SETTLE_MS after it ended and for an hour before", () => {
    const now = T('2026-11-10T12:00:00Z')
    expect(dayStands(now - 899_000, end + DAY_MS, now, 900)).toBe(true)
    expect(dayStands(now - 901_000, end + DAY_MS, now, 900)).toBe(false)
    expect(dayStands(end + SETTLE_MS, end, now, 900)).toBe(true)
    expect(dayStands(end + SETTLE_MS - 1, end, end + SETTLE_MS + UNSETTLED_EVERY_MS - 2, 900)).toBe(true)
    expect(dayStands(end + SETTLE_MS - 1, end, end + SETTLE_MS + UNSETTLED_EVERY_MS, 900)).toBe(false)
  })
  it('reads a time from a Date or text', () => {
    expect(msOf(new Date('2026-11-10T00:00:00Z'))).toBe(end)
    expect(msOf('2026-11-10T00:00:00Z')).toBe(end)
    expect(msOf(null)).toBeNaN()
  })
})
