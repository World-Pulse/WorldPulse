import { describe, it, expect } from 'vitest'
import { decodeEntities, cleanUrl, cleanTitle, ENCODED_TEXT_RE, withoutOutletName, OUTLET_SUFFIX_SQL } from '../text'
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

  it("takes out a membership plugin's paywall line (Post-Courier, Oct 20, 2026)", async () => {
    const { cleanSummary, feedText } = await import('../text')
    const html = '<p>Prime Minister James Marape opened the 32nd forum in Port Moresby.</p><div class="woocommerce"><div class="woocommerce-info wc-memberships-restriction-message">To access this post, you must purchase <span><a href="https://www.postcourier.com.pg/product/web/">Web</a>, <a href="https://www.postcourier.com.pg/product/web/?attribute_duration=One-Day">Web &#8211; One-Day</a>, <a href="https://www.postcourier.com.pg/product/web/?attribute_duration=Weekly">Web &#8211; Weekly</a> or <a href="https://www.postcourier.com.pg/product/web-ebook/">Web &amp; eBook &#8211; Annual</a></span>.</div></div><p>The post <a href="https://www.postcourier.com.pg/x/">Prime Minister Marape opens forum</a> appeared first on <a href="https://www.postcourier.com.pg">Post Courier</a>.</p>'
    expect(cleanSummary(feedText(html))).toBe('Prime Minister James Marape opened the 32nd forum in Port Moresby.')
  })

  it('takes out WordPress footers in the languages added in round 6 (Oct 31, 2026)', async () => {
    const { cleanSummary } = await import('../text')
    const cases: Array<[string, string]> = [
      ['Der Beitrag Brand in Wien erschien zuerst auf Kurier.', 'de'],
      ["L'articolo Incendio a Rimini proviene da San Marino RTV.", 'it'],
      ["L’articolo Incendio a Rimini sembra essere il primo su Libertas.", 'it'],
      ['Het bericht Brand in Paramaribo verscheen eerst op Suriname Herald.', 'nl'],
      ['Indlægget Brand i Nuuk blev vist første gang på Sermitsiaq.', 'da'],
      ["L'entrada Incendi a Andorra ha aparegut primer a Altaveu.", 'ca'],
      ['Articolul Incendiu la Chișinău apare prima dată în Ziarul de Gardă.', 'ro'],
      ['Prispevek Požar v Mariboru se je najprej pojavil na Večer.', 'sl'],
      ['Postimi Zjarr në Prishtinë u shfaq së pari në Koha.', 'sq'],
    ]
    for (const [footer, language] of cases) expect(cleanSummary(`Firefighters came at dawn. ${footer}`), language).toBe('Firefighters came at dawn.')
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

describe('feedText (feed HTML as plain text, Oct 11, 2026)', () => {
  it('takes out tags the feed sent encoded, keeping paragraphs apart', async () => {
    const { feedText } = await import('../text')
    // The Guardian: a standfirst, a sign-up list, then the story
    expect(feedText('Family and friends say he brought joy&lt;/p&gt;&lt;ul&gt;&lt;li&gt;&lt;p&gt;Get our &lt;a href="https://www.theguardian.com/email-newsletters?CMP=cvau_sfl"&gt;breaking news email&lt;/a&gt;&lt;/p&gt;&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;An Australian trekker was found'))
      .toBe('Family and friends say he brought joy Get our breaking news email An Australian trekker was found')
    // Stored after the old cleaning: ">" decoded, "&lt;" kept
    expect(feedText('&lt;p>With the advantage of hindsight, one can study history.&lt;/p> &lt;blockquote class="blockquote-level-1"> &lt;p>History repeats itself.&lt;/p>'))
      .toBe('With the advantage of hindsight, one can study history. History repeats itself.')
  })

  it('takes out written-out tags and decodes the codes', async () => {
    const { feedText } = await import('../text')
    expect(feedText('<p>Osaka <i>danjiri</i> float festival &amp; parade</p><p>It&#8217;s back</p>')).toBe('Osaka danjiri float festival & parade It’s back')
  })

  it('drops a tag cut off where a description was clipped', async () => {
    const { feedText } = await import('../text')
    expect(feedText("Yemen's Health Ministry raises alarm over supplies in Taiz &lt;div class=\"field field-field-text\"")).toBe("Yemen's Health Ministry raises alarm over supplies in Taiz")
  })

  it('leaves plain text and comparisons alone', async () => {
    const { feedText } = await import('../text')
    expect(feedText('Inflation fell below 3% as rates < 5% held')).toBe('Inflation fell below 3% as rates < 5% held')
  })

  it('drops an XML declaration inside a description (Shafaq News, Oct 20, 2026)', async () => {
    const { feedText } = await import('../text')
    expect(feedText('<?xml encoding="utf-8" ?><p><em>Shafaq News- Baghdad</em></p><p>Iraq&rsquo;s electoral commission announced the results.</p>'))
      .toBe('Shafaq News- Baghdad Iraq’s electoral commission announced the results.')
    expect(feedText('&lt;?xml encoding="utf-8" ?&gt;&lt;p&gt;Text&lt;/p&gt;')).toBe('Text')
  })
})

describe('clipText', () => {
  it('cuts at a word and says so', async () => {
    const { clipText } = await import('../text')
    expect(clipText('short', 600)).toBe('short')
    expect(clipText('Senior military commander says Iran will continue to strike vessels', 40)).toBe('Senior military commander says Iran…')
  })
})

describe('cleanSummary (pitches, Oct 11, 2026)', () => {
  it("takes out The Guardian's sign-up line, newsletter pitches and a trailing byline", async () => {
    const { cleanSummary } = await import('../text')
    expect(cleanSummary("Family and friends remember him. Get our breaking news email, free app or daily news podcast An Australian trekker was found dead."))
      .toBe('Family and friends remember him. An Australian trekker was found dead.')
    expect(cleanSummary('The Pentagon updated its database.Subscribe to The Post Most newsletter for the most important stories.'))
      .toBe('The Pentagon updated its database.')
    expect(cleanSummary('Subscribe now with a one-month trial for only $1, then enjoy the first year at an exclusi')).toBe('')
    expect(cleanSummary("Former US official says Israeli demands made a deal 'impossible' Submitted by")).toBe("Former US official says Israeli demands made a deal 'impossible'")
  })

  it('leaves a story that mentions them alone', async () => {
    const { cleanSummary } = await import('../text')
    const story = 'Voters were asked to get our attention on the economy; the podcast host disagreed.'
    expect(cleanSummary(story)).toBe(story)
  })
})

describe('withoutOutletName (Oct 11, 2026)', () => {
  it("takes off the outlet's name when it matches the article's website", () => {
    expect(withoutOutletName("Rotting food and a foul stench haunt a Honolulu restaurant - The Garden Island", 'https://www.thegardenisland.com/2026/10/11/x/'))
      .toBe('Rotting food and a foul stench haunt a Honolulu restaurant')
    expect(withoutOutletName('IIT Kanpur alumnus unable to find job in US for two years | Mint', 'https://www.livemint.com/news/x')).toBe('IIT Kanpur alumnus unable to find job in US for two years')
    expect(withoutOutletName('Afghan refugees face deportation from Pakistan - Khaama Press', 'https://www.khaama.com/x')).toBe('Afghan refugees face deportation from Pakistan')
    expect(withoutOutletName('Police chief named in Louisiana town – Daily Grenada And Caribbean News', 'https://grenadachronicle.com/x')).toBe('Police chief named in Louisiana town')
  })

  it("keeps an ending that isn't the outlet", () => {
    expect(withoutOutletName('Russian diesel imports beneficial to Americans — Treasury Secretary', 'https://tass.com/economy/1')).toBe('Russian diesel imports beneficial to Americans — Treasury Secretary')
    expect(withoutOutletName('Woman seriously hurt in three-vehicle crash on major UK motorway - man arrested', 'https://www.express.co.uk/news/x')).toBe('Woman seriously hurt in three-vehicle crash on major UK motorway - man arrested')
    // a common word alone doesn't tie the ending to the website
    expect(withoutOutletName('Markets slide as oil jumps after strike - Daily update', 'https://www.dailymail.co.uk/x')).toBe('Markets slide as oil jumps after strike - Daily update')
    // too short a headline before the dash, no link, or a long ending
    expect(withoutOutletName('M 6.2 - 79 km SSE of Panguna, Papua New Guinea', 'https://earthquake.usgs.gov/x')).toBe('M 6.2 - 79 km SSE of Panguna, Papua New Guinea')
    expect(withoutOutletName('Strike hits port as talks stall - Reuters', null)).toBe('Strike hits port as talks stall - Reuters')
  })

  it('finds the headlines worth reading again (the repair)', () => {
    expect(new RegExp(OUTLET_SUFFIX_SQL).test('Strike hits port - The Korea Times')).toBe(true)
    expect(new RegExp(OUTLET_SUFFIX_SQL).test('Strike hits port')).toBe(false)
  })

  it('is applied to every signal at intake, by its first link', () => {
    const row = cleanSignalText({ title: 'Hurricane Simon nears western Mexico | Focus Taiwan', original_urls: ['https://focustaiwan.tw/news/x'] })
    expect(row.title).toBe('Hurricane Simon nears western Mexico')
  })
})

describe('summaries and story posts that repeat the headline (H-0024, Oct 20, 2026)', () => {
  const title = 'Sudan army drones hit mourners and fuel market killing more than 200 people, monitors say'

  it('saysMore: not the headline again, nor its first 150 characters, nor nothing', async () => {
    const { saysMore } = await import('../text')
    expect(saysMore(title, title)).toBe(false)
    expect(saysMore(`${title}.`, title)).toBe(false)
    expect(saysMore(title.slice(0, 60), title)).toBe(false)   // the word rules' summary, cut
    expect(saysMore('', title)).toBe(false)
    expect(saysMore(null, title)).toBe(false)
    expect(saysMore('The strikes hit a funeral in El Fasher and a market in Kutum on Sunday.', title)).toBe(true)
  })

  it("articleSummary: the classifier's when it says more, else the article's opening from its feed, else none", async () => {
    const { articleSummary } = await import('../text')
    expect(articleSummary('Drone strikes killed mourners in El Fasher.', null, title)).toBe('Drone strikes killed mourners in El Fasher.')
    expect(articleSummary(title.slice(0, 150), '<p>The strikes hit a funeral in El Fasher &amp; a market in Kutum.</p><p>The post Sudan appeared first on Example News.</p>', title))
      .toBe('The strikes hit a funeral in El Fasher & a market in Kutum.')
    expect(articleSummary(title.slice(0, 150), title, title)).toBeNull()
    expect(articleSummary(title.slice(0, 150), '   ', title)).toBeNull()
    expect(articleSummary(title.slice(0, 150), null, title)).toBeNull()
    expect(articleSummary(null, 'x '.repeat(500), title)!.length).toBeLessThanOrEqual(600)
  })

  it('storyPostText: the headline once, and the summary only when it says more', async () => {
    const { storyPostText } = await import('../text')
    expect(storyPostText(title, title.slice(0, 150))).toBe(title)
    expect(storyPostText(title, null)).toBe(title)
    expect(storyPostText(title, 'The strikes hit a funeral.')).toBe(`${title}\n\nThe strikes hit a funeral.`)
    expect(storyPostText('x'.repeat(300), 'y'.repeat(3000))).toHaveLength(2000)
  })
})
