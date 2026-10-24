/**
 * Reading XLSX sheets (Oct 23, 2026): the parts of the format the public data files use.
 */

import { describe, it, expect } from 'vitest'
import { decodeXmlText, sharedStrings, sheetPath, sheetRows, columnNumber, columnLetters, readSheet } from '../xlsx'
import { workbookOf } from './zip-fixture'

describe('xlsx', () => {
  it('decodes XML text', () => {
    expect(decodeXmlText('Fish &amp; meal &lt;5%&gt; &quot;A&quot; &#8230; &#x2026;')).toBe('Fish & meal <5%> "A" … …')
  })

  it('joins rich-text runs and leaves out phonetic hints', () => {
    const xml = '<sst><si><t>Cocoa</t></si><si><r><rPr><b/></rPr><t>Coffee, </t></r><r><t>Arabica</t></r><rPh sb="0" eb="1"><t>ignored</t></rPh></si><si><t xml:space="preserve">Urea </t></si></sst>'
    expect(sharedStrings(xml)).toEqual(['Cocoa', 'Coffee, Arabica', 'Urea '])
  })

  it("finds a sheet's file by its name", () => {
    const wb = '<sheets><sheet name="Mismatch Details" sheetId="22" state="hidden" r:id="rId1"/><sheet name="Monthly Prices" sheetId="24" r:id="rId2"/></sheets>'
    const rels = '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="/xl/worksheets/sheet9.xml"/></Relationships>'
    expect(sheetPath(wb, rels, 'Mismatch Details')).toBe('xl/worksheets/sheet1.xml')
    expect(sheetPath(wb, rels, 'Monthly Prices')).toBe('xl/worksheets/sheet9.xml')
    expect(sheetPath(wb, rels, 'Annual Prices')).toBeNull()
  })

  it('numbers columns both ways', () => {
    expect([columnNumber('A'), columnNumber('Z'), columnNumber('AA'), columnNumber('BT')]).toEqual([1, 26, 27, 72])
    expect([columnLetters(1), columnLetters(26), columnLetters(27), columnLetters(72)]).toEqual(['A', 'Z', 'AA', 'BT'])
  })

  it('reads values of every kind, and cells written without a reference', () => {
    const xml = '<sheetData><row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1"><v>9.0500000000000007</v></c><c r="C1" t="inlineStr"><is><t>inline</t></is></c><c r="D1" t="e"><v>#N/A</v></c><c r="E1" s="3"/></row>'
      + '<row r="3" spans="1:3"/><row><c t="str"><v>formula &amp; text</v></c><c t="b"><v>1</v></c></row></sheetData>'
    expect(sheetRows(xml, ['Gold', '…'])).toEqual([
      { r: 1, cells: { A: '…', B: 9.05, C: 'inline', D: null } },
      { r: 3, cells: {} },
      { r: 4, cells: { A: 'formula & text', B: 1 } },
    ])
  })

  it('reads a sheet from a workbook, and says when one is missing', () => {
    const xlsx = workbookOf([
      { name: 'Notes', xml: '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData>' },
      { name: 'Data', xml: '<sheetData><row r="2"><c r="B2"><v>42</v></c></row></sheetData>' },
    ], ['a note'])
    expect(readSheet(xlsx, 'Data')).toEqual([{ r: 2, cells: { B: 42 } }])
    expect(readSheet(xlsx, 'Notes')[0]!.cells.A).toBe('a note')
    expect(() => readSheet(xlsx, 'Prices')).toThrow(/no sheet named "Prices"/)
  })
})
