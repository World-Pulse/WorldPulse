/**
 * Reading one sheet of an Excel workbook (XLSX) without a library: a workbook is a zip of XML
 * files; the sheet's name leads, through xl/workbook.xml and its relationships, to the sheet's own
 * XML, whose text cells point into one shared list of strings. Enough for the public data files
 * the commodity watch reads (Oct 23, 2026: the World Bank's monthly prices).
 */

import { zipEntries, entryText } from './zip'

export type Cell = string | number | null

export interface SheetRow {
  /** The row's number in the sheet, from 1 */
  r: number
  /** Column letters → value ("A" → "2026M09", "C" → 116.8) */
  cells: Record<string, Cell>
}

/** XML text with its entities decoded */
export function decodeXmlText(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e]!
  })
}

/** An element's attributes ("name", "r:id", "t") */
function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]!] = decodeXmlText(m[2]!)
  return out
}

/** The workbook's shared strings, in order (each item's text runs joined; phonetic hints left out) */
export function sharedStrings(xml: string): string[] {
  const out: string[] = []
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const item = m[1]!.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
    let text = ''
    for (const t of item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += decodeXmlText(t[1]!)
    out.push(text)
  }
  return out
}

/** Where a sheet's XML is in the zip ("xl/worksheets/sheet2.xml"), from its name */
export function sheetPath(workbookXml: string, relsXml: string, name: string): string | null {
  let id: string | null = null
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const a = attributes(m[1]!)
    if (a.name === name) { id = a['r:id'] ?? null; break }
  }
  if (!id) return null
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const a = attributes(m[1]!)
    if (a.Id !== id || !a.Target) continue
    // Targets are relative to xl/ (the workbook's folder) unless they start with "/"
    return a.Target.startsWith('/') ? a.Target.slice(1) : `xl/${a.Target.replace(/^\.\//, '')}`
  }
  return null
}

/** Column letters → number ("A" → 1, "AB" → 28) and back */
export function columnNumber(letters: string): number {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}
export function columnLetters(n: number): string {
  let s = ''
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** A sheet's rows and their values (text from the shared strings; numbers as numbers; errors as null) */
export function sheetRows(xml: string, strings: readonly string[]): SheetRow[] {
  const rows: SheetRow[] = []
  let lastRow = 0
  for (const m of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const ra = attributes(m[1]!)
    const r = ra.r ? Number(ra.r) : lastRow + 1
    lastRow = r
    const cells: Record<string, Cell> = {}
    let lastCol = 0
    for (const c of (m[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attributes(c[1]!)
      const ref = a.r ? /^([A-Z]+)\d+$/.exec(a.r) : null
      const col = ref ? ref[1]! : columnLetters(lastCol + 1)
      lastCol = columnNumber(col)
      const body = c[2] ?? ''
      let value: Cell = null
      if (a.t === 'inlineStr') {
        let text = ''
        for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += decodeXmlText(t[1]!)
        value = text
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)
        if (!v) continue
        const raw = v[1]!
        if (a.t === 's') value = strings[Number(raw)] ?? null
        else if (a.t === 'str') value = decodeXmlText(raw)
        else if (a.t === 'b') value = raw === '1' ? 1 : 0
        else if (a.t === 'e') value = null
        else {
          const n = Number(raw)
          value = Number.isFinite(n) ? n : null
        }
      }
      cells[col] = value
    }
    rows.push({ r, cells })
  }
  return rows
}

/** One sheet of a workbook, by name, as rows */
export function readSheet(xlsx: Buffer, name: string): SheetRow[] {
  const files = new Map(zipEntries(xlsx).map(e => [e.name, e]))
  const text = (path: string): string | null => {
    const e = files.get(path)
    return e ? entryText(e) : null
  }
  const workbook = text('xl/workbook.xml')
  const rels = text('xl/_rels/workbook.xml.rels')
  if (!workbook || !rels) throw new Error('not an Excel workbook (no xl/workbook.xml)')
  const path = sheetPath(workbook, rels, name)
  if (!path) throw new Error(`the workbook has no sheet named "${name}"`)
  const sheet = text(path)
  if (!sheet) throw new Error(`the workbook's sheet "${name}" (${path}) is missing`)
  return sheetRows(sheet, sharedStrings(text('xl/sharedStrings.xml') ?? ''))
}
