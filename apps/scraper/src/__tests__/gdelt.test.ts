/**
 * Unit tests for the GDELT 2.0 Events Feed adapter.
 *
 * Covers:
 *  - TSV row parsing (valid, malformed, missing fields)
 *  - CAMEO root code → WorldPulse category mapping
 *  - GoldsteinScale → severity mapping
 *  - DATEADDED timestamp parsing
 *  - lastupdate.txt URL extraction
 */

import { describe, it, expect } from 'vitest'
import {
  parseTsvRow,
  parseDateAdded,
  parseLastUpdateUrl,
  gdeltCameoCategory,
  gdeltSeverity,
} from '../sources/gdelt'

// ─── TEST HELPERS ────────────────────────────────────────────────────────────

/**
 * Build a syntactically valid 61-column GDELT TSV row.
 * All columns default to empty strings; pass overrides for specific indices.
 */
function makeRow(overrides: Partial<Record<number, string>> = {}): string {
  const cols: string[] = Array.from({ length: 61 }, () => '')
  // Minimum required defaults
  cols[0]  = '987654321'                           // GLOBALEVENTID
  cols[1]  = '20260326'                            // SQLDATE
  cols[26] = '190'                                 // EventCode
  cols[28] = '19'                                  // EventRootCode (Fight)
  cols[30] = '-7.5'                                // GoldsteinScale
  cols[52] = 'Kyiv, Kiev Oblast, Ukraine'          // ActionGeo_FullName
  cols[53] = 'UP'                                  // ActionGeo_CountryCode
  cols[56] = '50.45'                               // ActionGeo_Lat
  cols[57] = '30.52'                               // ActionGeo_Long
  cols[59] = '20260326143000'                      // DATEADDED
  cols[60] = 'https://example.com/conflict-news'   // SOURCEURL

  for (const [idx, val] of Object.entries(overrides)) {
    cols[Number(idx)] = val
  }
  return cols.join('\t')
}

// ─── parseTsvRow ─────────────────────────────────────────────────────────────

describe('parseTsvRow', () => {
  it('parses a well-formed row and returns all expected fields', () => {
    const row = parseTsvRow(makeRow())
    expect(row).not.toBeNull()
    expect(row!.globalEventId).toBe('987654321')
    expect(row!.sqlDate).toBe('20260326')
    expect(row!.eventCode).toBe('190')
    expect(row!.eventRootCode).toBe('19')
    expect(row!.goldstein).toBe(-7.5)
    expect(row!.geoName).toBe('Kyiv, Kiev Oblast, Ukraine')
    expect(row!.countryCode).toBe('UP')
    expect(row!.lat).toBeCloseTo(50.45)
    expect(row!.lng).toBeCloseTo(30.52)
    expect(row!.dateAdded).toBe('20260326143000')
    expect(row!.sourceUrl).toBe('https://example.com/conflict-news')
  })

  it('returns null for a row with too few columns', () => {
    expect(parseTsvRow('only\ta\tfew\tcolumns')).toBeNull()
    expect(parseTsvRow('')).toBeNull()
  })

  it('returns null when GlobalEventID is missing', () => {
    expect(parseTsvRow(makeRow({ 0: '' }))).toBeNull()
  })

  it('returns null when SOURCEURL is missing', () => {
    expect(parseTsvRow(makeRow({ 60: '' }))).toBeNull()
  })

  it('sets lat and lng to null when ActionGeo columns are empty', () => {
    const row = parseTsvRow(makeRow({ 56: '', 57: '' }))
    expect(row).not.toBeNull()
    expect(row!.lat).toBeNull()
    expect(row!.lng).toBeNull()
  })

  it('sets lat and lng to null when ActionGeo columns contain non-numeric values', () => {
    const row = parseTsvRow(makeRow({ 56: 'N/A', 57: 'N/A' }))
    expect(row).not.toBeNull()
    expect(row!.lat).toBeNull()
    expect(row!.lng).toBeNull()
  })

  it('parses negative lat/lng correctly (southern/western hemispheres)', () => {
    const row = parseTsvRow(makeRow({ 56: '-33.87', 57: '-70.66' }))
    expect(row!.lat).toBeCloseTo(-33.87)
    expect(row!.lng).toBeCloseTo(-70.66)
  })

  it('falls back to 0 for an unparseable GoldsteinScale', () => {
    const row = parseTsvRow(makeRow({ 30: '' }))
    expect(row!.goldstein).toBe(0)
  })

  it('handles the exact boundary of 61 columns (no extras)', () => {
    // exactly 61 tab-separated tokens
    const row = parseTsvRow(makeRow())
    expect(row).not.toBeNull()
  })

  it('is not confused by extra trailing columns', () => {
    const line = makeRow() + '\textra\tcolumns'
    const row = parseTsvRow(line)
    expect(row).not.toBeNull()
    expect(row!.globalEventId).toBe('987654321')
  })
})

// ─── gdeltCameoCategory ──────────────────────────────────────────────────────

describe('gdeltCameoCategory', () => {
  it('maps root code 19 (Fight) to conflict', () => {
    expect(gdeltCameoCategory('19')).toBe('conflict')
  })

  it('maps root code 20 (Mass violence) to conflict', () => {
    expect(gdeltCameoCategory('20')).toBe('conflict')
  })

  it('maps root code 18 (Assault) to conflict', () => {
    expect(gdeltCameoCategory('18')).toBe('conflict')
  })

  it('maps root code 13 (Threaten) to conflict', () => {
    expect(gdeltCameoCategory('13')).toBe('conflict')
  })

  it('maps root code 15 (Force posture) to conflict', () => {
    expect(gdeltCameoCategory('15')).toBe('conflict')
  })

  it('maps root code 17 (Coerce) to conflict', () => {
    expect(gdeltCameoCategory('17')).toBe('conflict')
  })

  it('maps root code 5 (Diplomatic cooperation) to geopolitics', () => {
    expect(gdeltCameoCategory('5')).toBe('geopolitics')
    expect(gdeltCameoCategory('05')).toBe('geopolitics')
  })

  it('maps root code 6 (Material cooperation) to economy', () => {
    expect(gdeltCameoCategory('6')).toBe('economy')
  })

  it('maps root code 9 (Investigate) to security', () => {
    expect(gdeltCameoCategory('9')).toBe('security')
  })

  it('maps root code 14 (Protest) to elections', () => {
    expect(gdeltCameoCategory('14')).toBe('elections')
  })

  it('maps root code 7 (Aid) to other', () => {
    expect(gdeltCameoCategory('7')).toBe('other')
  })

  it('returns other for unknown/empty codes', () => {
    expect(gdeltCameoCategory('')).toBe('other')
    expect(gdeltCameoCategory('99')).toBe('other')
    expect(gdeltCameoCategory('abc')).toBe('other')
  })

  it('handles single-digit codes without leading zero', () => {
    // "1" should pad to "01" and map correctly
    expect(gdeltCameoCategory('1')).toBe('geopolitics')
    expect(gdeltCameoCategory('8')).toBe('geopolitics')
  })
})

// ─── gdeltSeverity ───────────────────────────────────────────────────────────

describe('gdeltSeverity', () => {
  it('returns critical for very hostile events (Goldstein <= -7)', () => {
    expect(gdeltSeverity(-10)).toBe('critical')
    expect(gdeltSeverity(-7)).toBe('critical')
  })

  it('returns high for hostile events (-7 < Goldstein <= -4)', () => {
    expect(gdeltSeverity(-6.9)).toBe('high')
    expect(gdeltSeverity(-4)).toBe('high')
  })

  it('returns medium for mildly hostile / neutral events (-4 < Goldstein <= 0)', () => {
    expect(gdeltSeverity(-3.9)).toBe('medium')
    expect(gdeltSeverity(-1)).toBe('medium')
    expect(gdeltSeverity(0)).toBe('medium')
  })

  it('returns low for cooperative events (Goldstein > 0)', () => {
    expect(gdeltSeverity(0.1)).toBe('low')
    expect(gdeltSeverity(3)).toBe('low')
    expect(gdeltSeverity(10)).toBe('low')
  })

  it('handles boundary at -7 exactly as critical', () => {
    expect(gdeltSeverity(-7)).toBe('critical')
    expect(gdeltSeverity(-6.99)).toBe('high')
  })

  it('handles boundary at -4 exactly as high', () => {
    expect(gdeltSeverity(-4)).toBe('high')
    expect(gdeltSeverity(-3.99)).toBe('medium')
  })

  it('handles boundary at 0 exactly as medium', () => {
    expect(gdeltSeverity(0)).toBe('medium')
    expect(gdeltSeverity(0.01)).toBe('low')
  })
})

// ─── parseDateAdded ──────────────────────────────────────────────────────────

describe('parseDateAdded', () => {
  it('parses a valid YYYYMMDDHHMMSS timestamp', () => {
    const dt = parseDateAdded('20260326143015')
    expect(dt).not.toBeNull()
    expect(dt!.getUTCFullYear()).toBe(2026)
    expect(dt!.getUTCMonth()).toBe(2)   // 0-indexed March
    expect(dt!.getUTCDate()).toBe(26)
    expect(dt!.getUTCHours()).toBe(14)
    expect(dt!.getUTCMinutes()).toBe(30)
    expect(dt!.getUTCSeconds()).toBe(15)
  })

  it('returns null for an empty string', () => {
    expect(parseDateAdded('')).toBeNull()
  })

  it('returns null for strings shorter than 14 chars', () => {
    expect(parseDateAdded('2026032614')).toBeNull()
    expect(parseDateAdded('20260326')).toBeNull()
  })

  it('returns null for strings longer than 14 chars', () => {
    expect(parseDateAdded('202603261430150000')).toBeNull()
  })

  it('returns null for an invalid calendar date', () => {
    // Month "99" does not exist
    expect(parseDateAdded('20269999143000')).toBeNull()
  })

  it('handles midnight (000000) correctly', () => {
    const dt = parseDateAdded('20260101000000')
    expect(dt).not.toBeNull()
    expect(dt!.getUTCHours()).toBe(0)
    expect(dt!.getUTCMinutes()).toBe(0)
  })
})

// ─── parseLastUpdateUrl ──────────────────────────────────────────────────────

describe('parseLastUpdateUrl', () => {
  const SAMPLE_LASTUPDATE = [
    'abc123def456  1234567  http://data.gdeltproject.org/gdeltv2/20260326143000.gkg.csv.zip',
    'fed321cba654  9876543  http://data.gdeltproject.org/gdeltv2/20260326143000.export.CSV.zip',
    'aabbccddeeff  5555555  http://data.gdeltproject.org/gdeltv2/20260326143000.mentions.CSV.zip',
  ].join('\n')

  it('extracts the .export.CSV.zip URL from lastupdate.txt', () => {
    const url = parseLastUpdateUrl(SAMPLE_LASTUPDATE)
    expect(url).toBe('http://data.gdeltproject.org/gdeltv2/20260326143000.export.CSV.zip')
  })

  it('returns null when there is no .export.CSV.zip line', () => {
    const text = 'abc123  12345  http://data.gdeltproject.org/gdeltv2/foo.gkg.csv.zip\n'
    expect(parseLastUpdateUrl(text)).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseLastUpdateUrl('')).toBeNull()
  })

  it('handles Windows-style CRLF line endings', () => {
    const text = SAMPLE_LASTUPDATE.replace(/\n/g, '\r\n')
    const url = parseLastUpdateUrl(text)
    expect(url).toBe('http://data.gdeltproject.org/gdeltv2/20260326143000.export.CSV.zip')
  })

  it('handles a single-line file with the export URL', () => {
    const text = 'aabbcc  999  http://data.gdeltproject.org/gdeltv2/X.export.CSV.zip'
    expect(parseLastUpdateUrl(text)).toBe('http://data.gdeltproject.org/gdeltv2/X.export.CSV.zip')
  })
})
