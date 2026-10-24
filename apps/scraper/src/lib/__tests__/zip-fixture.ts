/**
 * Test helper: a zip of the given files, laid out as real zips are (local headers and data, then
 * the central directory, then the end record). Not a test file itself.
 */

import { deflateRawSync } from 'node:zlib'

export function zipFiles(files: Array<[name: string, text: string]>, method: 0 | 8 = 8): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of files) {
    const raw = Buffer.from(text)
    const data = method === 8 ? deflateRawSync(raw) : raw
    const nameBuf = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8)
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(method, 10); entry.writeUInt32LE(data.length, 20)
    entry.writeUInt32LE(raw.length, 24); entry.writeUInt16LE(nameBuf.length, 28); entry.writeUInt32LE(offset, 42)
    parts.push(local, nameBuf, data)
    central.push(entry, nameBuf)
    offset += local.length + nameBuf.length + data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, directory, end])
}

/** An Excel workbook of the given sheets (each sheet's XML as Excel writes it), with shared strings */
export function workbookOf(sheets: Array<{ name: string; xml: string; hidden?: boolean }>, strings: readonly string[]): Buffer {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${
    sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${20 + i}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')
  }</sheets></workbook>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>${
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).reverse().join('')
  }</Relationships>`
  const shared = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${
    strings.map(s => `<si><t${/^\s|\s$/.test(s) ? ' xml:space="preserve"' : ''}>${esc(s)}</t></si>`).join('')
  }</sst>`
  return zipFiles([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types/>'],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', rels],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, s.xml]),
    ['xl/sharedStrings.xml', shared],
  ])
}
