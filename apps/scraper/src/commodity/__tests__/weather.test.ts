/**
 * Weather risk (Oct 23, 2026). The forecast is MET Norway's for South Minas Gerais made at 23:18
 * UTC on Oct 23, 2026, and the normals NASA POWER's for the same point: 95 mm of rain in the next
 * nine and a half days while the coffee flowers, more than twice normal, so no risk. The dry,
 * frost and heat cases change that real forecast one way at a time.
 */

import { describe, it, expect } from 'vitest'
import { readLocationforecast, readPowerClimatology, assessRegion, countryWeather, normalOn, type PointForecast } from '../weather'
import { BY_KEY } from '../catalog'
import { REGIONS } from '../regions'

const WINDOWS: Array<[string, number, number, number]> = [["10-24T00",17,17.4,0],["10-24T06",17.4,21.8,0.1],["10-24T12",23.1,25.8,0.2],["10-24T18",19.1,24.6,3.5],["10-25T00",18.8,19.1,0],["10-25T06",19.5,22.1,3.7],["10-25T12",21.4,24.4,5.6],["10-25T18",20.5,21.2,3.6],["10-26T00",19.2,20.4,7.9],["10-26T06",19,21.4,0.7],["10-26T12",21.4,25.5,1],["10-26T18",16.5,25.3,0],["10-27T00",12.9,16.5,0],["10-27T06",11.9,18.6,0],["10-27T12",18.6,25.3,0],["10-27T18",17.7,25.2,0],["10-28T00",14.6,17.7,0],["10-28T06",14.5,19,0],["10-28T12",19,22.7,1.6],["10-28T18",18.4,22.8,3.1],["10-29T00",16.8,18.4,0.6],["10-29T06",16.7,20.2,0.5],["10-29T12",20.2,22.4,1],["10-29T18",18.9,22.5,1.5],["10-30T00",17.7,18.9,14.6],["10-30T06",17.7,18.9,17.2],["10-30T12",18.9,22.7,10.5],["10-30T18",18.2,22.4,4.2],["10-31T00",17.9,18.3,0.1],["10-31T06",17.7,21.1,0.5],["10-31T12",21.1,26.2,1.1],["10-31T18",19.3,26.3,0.2],["11-01T00",16.9,19.3,0],["11-01T06",16.4,21.4,0],["11-01T12",21.4,26.2,0.8],["11-01T18",18.3,25.9,6.5],["11-02T00",17.3,18.4,4.8],["11-02T06",17.1,20.7,0.1]]
const forecast = (map: (w: { start: string; min: number; max: number; rain: number }) => object = w => w): PointForecast => ({
  updated: '2026-10-23T23:18:45Z',
  windows: WINDOWS.map(([t, min, max, rain]) => ({ start: `2026-${t}:00:00Z`, min, max, rain })).map(w => ({ ...w, ...map(w) })),
})
/** NASA POWER, PRECTOTCORR at -21.55, -45.43 (mm a day, January first) */
const NORMALS = [7.39, 5.67, 4.65, 2.12, 1.44, 0.71, 0.49, 0.6, 1.66, 3.19, 5.72, 6.92]
const NOW = new Date('2026-10-24T00:30:00Z')
const minas = REGIONS.find(r => r.id === 'coffee:BR:south-minas-gerais-varginha')!
const coffee = BY_KEY.get('coffee')!

describe("reading MET Norway's and NASA's answers", () => {
  it('turns the forecast into six-hour windows, each counted once', () => {
    const json = {"type":"Feature","properties":{"meta":{"updated_at":"2026-10-23T23:18:45Z"},"timeseries":[{"time":"2026-10-24T00:00:00Z","data":{"instant":{"details":{"air_temperature":17.5}},"next_12_hours":{"details":{}},"next_1_hours":{"details":{"precipitation_amount":0}},"next_6_hours":{"details":{"air_temperature_max":17.4,"air_temperature_min":17,"precipitation_amount":0}}}},{"time":"2026-10-24T01:00:00Z","data":{"instant":{"details":{"air_temperature":17.1}},"next_12_hours":{"details":{}},"next_1_hours":{"details":{"precipitation_amount":0}},"next_6_hours":{"details":{"air_temperature_max":17.4,"air_temperature_min":17,"precipitation_amount":0}}}},{"time":"2026-10-24T06:00:00Z","data":{"instant":{"details":{"air_temperature":17.3}},"next_12_hours":{"details":{}},"next_1_hours":{"details":{"precipitation_amount":0}},"next_6_hours":{"details":{"air_temperature_max":21.8,"air_temperature_min":17.4,"precipitation_amount":0.1}}}},{"time":"2026-11-02T06:00:00Z","data":{"instant":{"details":{"air_temperature":17.3}},"next_6_hours":{"details":{"air_temperature_max":20.7,"air_temperature_min":17.1,"precipitation_amount":0.1}}}},{"time":"2026-11-02T12:00:00Z","data":{"instant":{"details":{"air_temperature":20.7}}}}]}}
    expect(readLocationforecast(json)).toEqual({
      updated: '2026-10-23T23:18:45Z',
      windows: [
        { start: '2026-10-24T00:00:00Z', min: 17, max: 17.4, rain: 0 },
        { start: '2026-10-24T06:00:00Z', min: 17.4, max: 21.8, rain: 0.1 },
        { start: '2026-11-02T06:00:00Z', min: 17.1, max: 20.7, rain: 0.1 },
      ],
    })
    expect(readLocationforecast({}).windows).toEqual([])
  })

  it("reads each month's normal rain", () => {
    const json = { properties: { parameter: { PRECTOTCORR: { JAN: 7.39, FEB: 5.67, MAR: 4.65, APR: 2.12, MAY: 1.44, JUN: 0.71, JUL: 0.49, AUG: 0.6, SEP: 1.66, OCT: 3.19, NOV: 5.72, DEC: 6.92, ANN: 3.37 } } } }
    expect(readPowerClimatology(json)).toEqual(NORMALS)
    expect(readPowerClimatology({ properties: { parameter: { PRECTOTCORR: { JAN: -999 } } } })).toBeNull()
  })
})

describe('a region\'s weather risk', () => {
  it('sees no risk in a wet flowering season (the real forecast)', () => {
    const w = assessRegion(minas, coffee, forecast(), NORMALS, NOW)
    expect(w).toMatchObject({ stage: 'B', doing: 'flowering', days: 9.5, rain_mm: 95.2, normal_mm: 40.2, rain_pct: 237, low_c: 11.9, low_on: 'Oct 27', high_c: 26.3, level: 0, risks: [] })
  })

  it('calls a dry forecast while coffee flowers a high risk', () => {
    const w = assessRegion(minas, coffee, forecast(x => ({ rain: x.rain / 20 })), NORMALS, NOW)
    expect(w.level).toBe(3)
    expect(w.risks[0]).toEqual({ kind: 'dry', level: 3, text: '4.8 mm of rain forecast in the next 10 days, 12% of normal, while the crop is flowering' })
  })

  it('lowers the same dry spell a step while a crop is only growing', () => {
    const w = assessRegion(minas, coffee, forecast(x => ({ rain: x.rain / 20 })), NORMALS, new Date('2026-04-02T00:00:00Z'))
    // April is "G" in South Minas, but the windows are October's: the stage is read from the date
    expect(w.stage).toBe('G')
    expect(w.risks.find(r => r.kind === 'dry')?.level).toBe(2)
  })

  it('counts frost for coffee whatever the stage', () => {
    const w = assessRegion(minas, coffee, forecast(x => (x.start.startsWith('2026-10-27') ? { min: -0.5 } : {})), NORMALS, NOW)
    expect(w.risks[0]).toMatchObject({ kind: 'frost', level: 3 })
    expect(w.risks[0]!.text).toBe('Lows of -0.5°C forecast on Oct 27, while the crop is flowering')
    expect(w.frost_nights).toBe(1)
  })

  it('counts heat only at flowering and filling', () => {
    const hot = forecast(x => ({ max: x.max + 10 }))
    const w = assessRegion(minas, coffee, hot, NORMALS, NOW)
    expect(w.risks[0]).toMatchObject({ kind: 'heat', level: 3 })
    expect(w.hot_days).toBe(6)
    const later = assessRegion(minas, coffee, hot, NORMALS, new Date('2026-06-10T00:00:00Z'))   // June: harvest
    expect(later.risks.find(r => r.kind === 'heat')).toBeUndefined()
  })

  it('reads normals between the monthly averages, day by day', () => {
    expect(normalOn(NORMALS, '2026-10-16T00:00:00Z')).toBeCloseTo(3.19, 2)          // mid-October: October's average
    expect(normalOn(NORMALS, '2026-10-31T12:00:00Z')).toBeCloseTo(4.455, 3)         // late October leans to November
    expect(normalOn(NORMALS, '2026-11-01T00:00:00Z')).toBeCloseTo(4.497, 3)         // and carries on into it
  })

  it('skips the dry rule where the crop is irrigated', () => {
    const irrigated = { ...minas, irrigated: true }
    expect(assessRegion(irrigated, coffee, forecast(x => ({ rain: x.rain / 20 })), NORMALS, NOW).risks).toEqual([])
  })

  it('gives robusta more heat, and sugar beet more frost, than their commodity', () => {
    const hot = forecast(x => ({ max: x.max + 10 }))                                // 6 days at 34 or more, highs 36.3
    expect(assessRegion({ ...minas, variant: 'robusta' }, coffee, hot, NORMALS, NOW).risks.find(r => r.kind === 'heat')?.level).toBe(1)
    const beet = REGIONS.find(r => r.id === 'sugar:US:red-river-valley-beet')!
    const sugar = BY_KEY.get('sugar')!
    const frosty = forecast(x => ({ min: x.min - 18 }))                            // lows of -6.1
    const june = new Date('2026-06-02T00:00:00Z')                                    // the beet growing
    expect(assessRegion(beet, sugar, frosty, NORMALS, june).risks.find(r => r.kind === 'frost')).toMatchObject({ level: 2 })
    expect(assessRegion(beet, sugar, forecast(x => ({ min: x.min - 13 })), NORMALS, june).risks.find(r => r.kind === 'frost')).toBeUndefined()  // -1.1: fine for beet
  })

  it('calls flooding only at twice the normal rain or more', () => {
    const soaked = forecast(x => ({ rain: x.rain * 2 }))                           // 190 mm against 40 normal: flooding
    expect(assessRegion(minas, coffee, soaked, NORMALS, NOW).risks[0]).toMatchObject({ kind: 'wet', level: 2 })
    const wetPlace = NORMALS.map(n => n * 3)                                          // the same rain where 120 mm is normal
    expect(assessRegion(minas, coffee, soaked, wetPlace, NOW).risks.find(r => r.kind === 'wet')).toBeUndefined()
  })

  it('needs a forecast to say anything', () => {
    expect(assessRegion(minas, coffee, null, NORMALS, NOW)).toMatchObject({ level: 0, days: 0, risks: [] })
  })
})

describe("a country's weather risk", () => {
  it('takes the worst of the regions growing a good part of the crop', () => {
    const regions = REGIONS.filter(r => r.commodity === 'coffee' && r.iso === 'BR')
    const assessed = regions.map(r => assessRegion(r, coffee, r === minas ? forecast(x => ({ rain: x.rain / 20 })) : forecast(), NORMALS, NOW))
    const c = countryWeather('coffee', 'BR', assessed)
    expect(c.level).toBe(3)
    expect(c.weighted).toBeCloseTo(3 * 0.3 / 0.78, 2)
    expect(c.summary).toMatch(/^South Minas Gerais \(Varginha\): 4\.8 mm of rain/)
    expect(c.regions[0]!.id).toBe(minas.id)
  })
})
