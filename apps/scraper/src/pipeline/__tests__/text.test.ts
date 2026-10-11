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

describe('cleanSummary (feed footers, Oct 11, 2026)', () => {
  it('takes out WordPress footers, "Read More" links and "[…]"', async () => {
    const { cleanSummary } = await import('../text')
    expect(cleanSummary('At least 12 people have been killed. The post 12 killed, 309 injured in Riyadh Airport attack appeared first on Vanguard News. Source: Vanguard News (Nigeria).'))
      .toBe('At least 12 people have been killed. Source: Vanguard News (Nigeria).')
    expect(cleanSummary('SERAP has sued the CBN. Read More: https://punchng.com/serap-sues-cbn/ Source: The Punch.'))
      .toBe('SERAP has sued the CBN. Source: The Punch.')
    expect(cleanSummary('Talks resumed in Geneva on Sunday [&#8230;]')).toBe('Talks resumed in Geneva on Sunday…')
    expect(cleanSummary('Flooding cut roads across the north. Continue reading')).toBe('Flooding cut roads across the north.')
  })

  it('leaves the story alone', async () => {
    const { cleanSummary } = await import('../text')
    const story = 'The post office in Kyiv reopened; read more about the repairs in our live blog.'
    expect(cleanSummary(story)).toBe(story)
  })
})

describe('summaryWithoutNotes (the outlet note, Oct 11, 2026)', () => {
  it('takes out the note RSS added, and the state-media sentence', async () => {
    const { summaryWithoutNotes } = await import('../text')
    expect(summaryWithoutNotes('Talks resumed in Geneva on Sunday. Source: Middle East Eye (reliability: 74%, bias: center-left).', 'Talks resume'))
      .toBe('Talks resumed in Geneva on Sunday.')
    expect(summaryWithoutNotes('Moscow says the drones were downed. Source: TASS (reliability: 45%, bias: state-media). ⚠️ This outlet is state-controlled and may reflect official government positions.', 'Drones downed'))
      .toBe('Moscow says the drones were downed.')
    // an outlet name with brackets of its own
    expect(summaryWithoutNotes('Floods closed schools. Source: New Straits Times (Malaysia) (reliability: 75%, bias: center).', 'Floods'))
      .toBe('Floods closed schools.')
  })

  it('stores nothing when all that is left repeats the headline', async () => {
    const { summaryWithoutNotes } = await import('../text')
    const title = 'Yemen’s Houthis renew warning over Saudi airports after deadly Riyadh attack'
    expect(summaryWithoutNotes(`${title}. Source: Investing.com News (reliability: 76%, bias: center).`, title)).toBeNull()
    expect(summaryWithoutNotes(`"${title}"`, title)).toBeNull()
    expect(summaryWithoutNotes('Source: The Block (reliability: 75%, bias: center).', title)).toBeNull()
    expect(summaryWithoutNotes(null, title)).toBeNull()
  })

  it('leaves a real summary alone, footers aside', async () => {
    const { summaryWithoutNotes } = await import('../text')
    const story = 'The source said talks would resume (reliability of the claim unclear). More soon.'
    expect(summaryWithoutNotes(story, 'Talks')).toBe(story)
    expect(summaryWithoutNotes('Roads cut across the north. Continue reading', 'Floods')).toBe('Roads cut across the north.')
  })

  it('cleans every source at insert, and the stored form is null for a title repeat', () => {
    const row = { title: 'Quake hits Peru', summary: 'Quake hits Peru. Source: Reuters (reliability: 90%, bias: center).' }
    expect(cleanSignalText(row).summary).toBeNull()
  })
})

describe('repeatsTitle', () => {
  it('ignores case, spaces, quotes and end punctuation', async () => {
    const { repeatsTitle } = await import('../text')
    expect(repeatsTitle('Quake hits  Peru.', 'quake hits Peru')).toBe(true)
    expect(repeatsTitle('“Quake hits Peru”', 'Quake hits Peru')).toBe(true)
    expect(repeatsTitle('', 'Quake hits Peru')).toBe(true)
    expect(repeatsTitle('Quake hits Peru, killing 3.', 'Quake hits Peru')).toBe(false)
  })
})
