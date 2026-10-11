import { describe, it, expect } from 'vitest'
import { decodeEntities, cleanUrl, cleanTitle, ENCODED_TEXT_RE } from '../text'
import { cleanSignalText } from '../insert-signal'

describe('decodeEntities', () => {
  it('turns the codes seen in headlines on Oct 11, 2026 into characters', () => {
    expect(decodeEntities('Goebbels isn&#x27;t applauding Navi Pillay. He&#x27;s applauding')).toBe("Goebbels isn't applauding Navi Pillay. He's applauding")
    expect(decodeEntities('Who Are You, Naim Qassem? &#8211; Analysis')).toBe('Who Are You, Naim Qassem? – Analysis')
    expect(decodeEntities('Mother: &apos;I know the truth&apos;')).toBe("Mother: 'I know the truth'")
    expect(decodeEntities('Sunrun president &amp; CRO')).toBe('Sunrun president & CRO')
    expect(decodeEntities('We&rsquo;re reading &hellip;')).toBe('We’re reading …')
  })

  it('decodes ">", but never a "<" that could open a tag', () => {
    expect(decodeEntities('in MMI&gt;=VII')).toBe('in MMI>=VII')
    expect(decodeEntities('x &lt; 5 and &lt;= 7')).toBe('x < 5 and <= 7')
    expect(decodeEntities('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('&lt;script>alert(1)&lt;/script>')
    expect(decodeEntities('&#60;b&#62; &#x3c;!-- &lt;?xml')).toBe('&#60;b> &#x3c;!-- &lt;?xml')
  })
})

describe('cleanTitle', () => {
  it('drops tags, written out or encoded', () => {
    expect(cleanTitle('Two die and 16 hurt in Osaka <i>danjiri</i> float festival accidents'))
      .toBe('Two die and 16 hurt in Osaka danjiri float festival accidents')
    expect(cleanTitle('A &lt;b&gt;bold&lt;/b&gt; claim')).toBe('A bold claim')
    expect(cleanTitle('Rates 3 &lt; 4 &amp; falling')).toBe('Rates 3 < 4 & falling')
  })
})

describe('cleanUrl', () => {
  it('writes "&amp;" in links as "&"', () => {
    expect(cleanUrl('https://www.gdacs.org/report.aspx?eventtype=EQ&amp;eventid=1')).toBe('https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1')
  })
})

describe('ENCODED_TEXT_RE', () => {
  it('spots text that still has codes', () => {
    expect(ENCODED_TEXT_RE.test('isn&#x27;t')).toBe(true)
    expect(ENCODED_TEXT_RE.test('AT&T earnings')).toBe(false)
    expect(ENCODED_TEXT_RE.test('in MMI&gt;=VII')).toBe(true)
    expect(ENCODED_TEXT_RE.test('Osaka <i>danjiri</i>')).toBe(true)
  })
})

describe('cleanSignalText', () => {
  it("cleans a signal's title, summary and links, and nothing else", () => {
    const location = { raw: true }
    const row = { title: 'A &#8211; B', summary: 'x &amp; y', original_urls: ['https://a.b/?q=1&amp;r=2'], location, summaryless: 1 }
    const out = cleanSignalText(row)
    expect(out).toEqual({ title: 'A – B', summary: 'x & y', original_urls: ['https://a.b/?q=1&r=2'], location, summaryless: 1 })
    expect(out).toBe(row)                // in place, as insertAndCorrelate always worked
    expect(out.location).toBe(location)
    expect(cleanSignalText({ title: 'Plain', summary: null })).toEqual({ title: 'Plain', summary: null })
  })
})
