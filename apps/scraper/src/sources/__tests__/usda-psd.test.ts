/**
 * USDA PSD (Oct 23, 2026): the database file read into the two latest marketing years. The rows
 * are USDA's own (psd_alldata.csv, October 2026 release), zipped here the way USDA zips it.
 */

import { describe, it, expect } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { csvFields, firstEntry, zipLines, readPsd, FAS_TO_ISO } from '../usda-psd'

const CSV = `Commodity_Code,Commodity_Description,Country_Code,Country_Name,Market_Year,Calendar_Year,Month,Attribute_ID,Attribute_Description,Unit_ID,Unit_Description,Value
0577400,"Almonds, Shelled Basis",AF,"Afghanistan",2010,2018,10,020,"Beginning Stocks",21,"(MT)",0.0000
0711100,"Coffee, Green",BR,"Brazil",2025,2026,07,088,"Exports",02,"(1000 60 KG BAGS)",37870.0000
0711100,"Coffee, Green",BR,"Brazil",2025,2026,07,028,"Production",02,"(1000 60 KG BAGS)",63000.0000
0711100,"Coffee, Green",BR,"Brazil",2026,2026,07,176,"Ending Stocks",02,"(1000 60 KG BAGS)",4425.0000
0711100,"Coffee, Green",BR,"Brazil",2026,2026,07,088,"Exports",02,"(1000 60 KG BAGS)",49070.0000
0711100,"Coffee, Green",BR,"Brazil",2026,2026,07,057,"Imports",02,"(1000 60 KG BAGS)",90.0000
0711100,"Coffee, Green",BR,"Brazil",2026,2026,07,028,"Production",02,"(1000 60 KG BAGS)",71900.0000
0711100,"Coffee, Green",VM,"Vietnam",2025,2026,07,028,"Production",02,"(1000 60 KG BAGS)",31700.0000
0711100,"Coffee, Green",VM,"Vietnam",2026,2026,07,088,"Exports",02,"(1000 60 KG BAGS)",28950.0000
0711100,"Coffee, Green",VM,"Vietnam",2026,2026,07,028,"Production",02,"(1000 60 KG BAGS)",32500.0000
0440000,"Corn",US,"United States",2025,2026,10,028,"Production",08,"(1000 MT)",430896.0000
0440000,"Corn",US,"United States",2026,2026,10,004,"Area Harvested",04,"(1000 HA)",35817.0000
0440000,"Corn",US,"United States",2026,2026,10,088,"Exports",08,"(1000 MT)",83824.0000
0440000,"Corn",US,"United States",2026,2026,10,028,"Production",08,"(1000 MT)",407281.0000
0440000,"Corn",US,"United States",2026,2026,10,184,"Yield",26,"(MT/HA)",11.3700
0440000,"Corn",US,"United States",2026,2026,10,125,"Domestic Consumption",08,"(1000 MT)",326000.0000
0440000,"Corn",US,"United States",2026,2026,10,161,"Feed Waste Dom. Cons.",08,"(1000 MT)",150000.0000
0410000,"Wheat",E4,"European Union",2025,2026,09,028,"Production",08,"(1000 MT)",145136.0000
0410000,"Wheat",E4,"European Union",2026,2026,10,028,"Production",08,"(1000 MT)",133000.0000
0410000,"Wheat",E4,"European Union",2026,2026,10,088,"Exports",08,"(1000 MT)",31000.0000
0410000,"Wheat",UR,"Union of Soviet Socialist Repu",1990,1992,12,028,"Production",08,"(1000 MT)",101900.0000
2631000,"Cotton",PK,"Pakistan",2026,2026,10,028,"Production",07,"1000 480 lb. Bales",5500.0000
`

/** A zip of one file, as USDA's: a local header, the deflated data, a central directory, the end record */
function zipOf(name: string, text: string): Buffer {
  const data = deflateRawSync(Buffer.from(text))
  const nameBuf = Buffer.from(name)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8)
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(text.length, 22); local.writeUInt16LE(nameBuf.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(text.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(0, 42)
  const cdOffset = local.length + nameBuf.length + data.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + nameBuf.length, 12); end.writeUInt32LE(cdOffset, 16)
  return Buffer.concat([local, nameBuf, data, central, nameBuf, end])
}

describe('reading the file', () => {
  it('splits quoted CSV fields', () => {
    expect(csvFields('0577400,"Almonds, Shelled Basis",AF,"Afghanistan",2010')).toEqual(['0577400', 'Almonds, Shelled Basis', 'AF', 'Afghanistan', '2010'])
    expect(csvFields('a,"say ""hi""",b')).toEqual(['a', 'say "hi"', 'b'])
  })

  it('finds and inflates the first file of a zip, line by line', async () => {
    const zip = zipOf('psd_alldata.csv', CSV)
    expect(firstEntry(zip)).toMatchObject({ name: 'psd_alldata.csv', method: 8 })
    const lines: string[] = []
    for await (const l of zipLines(zip)) lines.push(l)
    expect(lines[0]).toMatch(/^Commodity_Code,/)
    expect(lines.filter(Boolean)).toHaveLength(CSV.trim().split('\n').length)
  })

  it('refuses something that is not a zip', () => {
    expect(() => firstEntry(Buffer.from('not a zip at all, nothing like one'))).toThrow(/not a zip/)
  })
})

describe('readPsd', () => {
  it('keeps the current and the previous marketing year, per commodity and country', async () => {
    const psd = await readPsd(zipLines(zipOf('psd_alldata.csv', CSV)), 'Fri, 09 Oct 2026 19:02:03 GMT')
    expect(psd.release).toBe('2026-10')
    const coffee = psd.commodities['0711100']!
    expect(coffee).toMatchObject({ name: 'Coffee, Green', unit: '1000 60 KG BAGS', current_year: 2026, previous_year: 2025 })
    expect(coffee.countries.BR).toMatchObject({
      iso: 'BR', name: 'Brazil', estimate: '2026-07',
      current: { production: 71_900, exports: 49_070, imports: 90, ending_stocks: 4_425 },
      previous: { production: 63_000, exports: 37_870 },
    })
    expect(coffee.countries.VM!.iso).toBe('VN')
  })

  it("keeps the readings the watch uses, and USDA's units", async () => {
    const psd = await readPsd(zipLines(zipOf('psd_alldata.csv', CSV)))
    const corn = psd.commodities['0440000']!.countries.US!
    expect(corn.current).toEqual({ area: 35_817, exports: 83_824, production: 407_281, yield: 11.37, consumption: 326_000 })
    expect(psd.commodities['2631000']!.unit).toBe('1000 480 lb. Bales')
  })

  it('names the European Union as one, and leaves out years long gone', async () => {
    const psd = await readPsd(zipLines(zipOf('psd_alldata.csv', CSV)))
    expect(psd.commodities['0410000']!.countries.E4).toMatchObject({ iso: 'EU', current: { production: 133_000 } })
    expect(psd.commodities['0410000']!.countries.UR).toBeUndefined()      // the USSR, 1990
    expect(psd.commodities['0577400']).toBeUndefined()                    // almonds, 2010 only
  })
})

describe('FAS_TO_ISO', () => {
  it("translates USDA's codes, which differ from ISO's", () => {
    expect(FAS_TO_ISO.CH).toBe('CN')    // China
    expect(FAS_TO_ISO.SZ).toBe('CH')    // Switzerland
    expect(FAS_TO_ISO.IV).toBe('CI')    // Cote d'Ivoire
    expect(FAS_TO_ISO.RP).toBe('PH')    // the Philippines
    expect(FAS_TO_ISO.UP).toBe('UA')    // Ukraine
    expect(FAS_TO_ISO.KS).toBe('KR')    // South Korea
  })
})
