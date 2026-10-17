/**
 * Tests for the global news RSS adapter (news-rss.ts)
 *
 * Covers: feed registry integrity, RSS/Atom parsing, severity detection,
 * category override, geo inference, dedup key generation, and poller lifecycle.
 */

import { describe, it, expect } from 'vitest'
import {
  NEWS_SOURCE_REGISTRY,
  type NewsSource,
  detectNewsSeverity,
  detectNewsCategory,
  inferGeo,
  decodeEntities,
  parseFeedItems,
  newsRedisKey,
  isStaleItem,
  MAX_ITEM_AGE_MS,
  feedFailureWhy,
} from '../news-rss'

// ─── WHY A FEED FAILS (Oct 17, 2026) ──────────────────────────────────────────

describe('feedFailureWhy', () => {
  it('names why a poll failed in a fixed phrase, never the address', () => {
    expect(feedFailureWhy('HTTP 403 from https://thethaiger.com/feed')).toBe('turned away (403)')
    expect(feedFailureWhy('HTTP 429 from https://example.com/rss')).toBe('turned away (429)')
    expect(feedFailureWhy('HTTP 404 from https://www3.nhk.or.jp/nhkworld/en/news/feeds/')).toBe('feed gone (404)')
    expect(feedFailureWhy('HTTP 503 from https://example.com/rss')).toBe('answered 503')
    expect(feedFailureWhy('Timeout fetching https://www.cbc.ca/webfeed/rss/rss-topstories')).toBe('timed out')
    expect(feedFailureWhy('getaddrinfo ENOTFOUND api.acleddata.com')).toBe('address not found')
    expect(feedFailureWhy('read ECONNRESET')).toBe('connection cut')
    expect(feedFailureWhy('connect ECONNREFUSED 1.2.3.4:443')).toBe('connection refused')
    expect(feedFailureWhy('certificate has expired')).toBe('certificate problem')
    expect(feedFailureWhy('no items in the response')).toBe('not a feed (bot check or moved)')
    expect(feedFailureWhy('empty response')).toBe('empty answer')
    expect(feedFailureWhy('Too many redirects')).toBe('redirect problem')
    expect(feedFailureWhy('Response over 5242880 bytes from https://example.com/feed')).toBe('too large')
    expect(feedFailureWhy('something odd')).toBe('other error')
  })

  it('reads the reason, not the address (a feed address can hold words like "tls")', () => {
    expect(feedFailureWhy('Timeout fetching https://tls-news.example.com/cert/feed')).toBe('timed out')
    expect(feedFailureWhy('Bad redirect from https://ssl.example.com/rss')).toBe('redirect problem')
  })

  it('stays short enough for HQ (40 characters)', () => {
    for (const r of ['no items in the response', 'HTTP 403 from x', 'Timeout fetching x', 'whatever']) {
      expect(feedFailureWhy(r).length).toBeLessThanOrEqual(40)
    }
  })
})

// ─── REGISTRY INTEGRITY ───────────────────────────────────────────────────────

describe('NEWS_SOURCE_REGISTRY', () => {
  it('has at least 108 sources', () => {
    expect(NEWS_SOURCE_REGISTRY.length).toBeGreaterThanOrEqual(108)
  })

  it('every source has a non-empty id', () => {
    for (const src of NEWS_SOURCE_REGISTRY) {
      expect(src.id.length).toBeGreaterThan(0)
    }
  })

  it('every source has a valid feed URL starting with http', () => {
    for (const src of NEWS_SOURCE_REGISTRY) {
      expect(src.feedUrl).toMatch(/^https?:\/\//)
    }
  })

  it('all source IDs are unique', () => {
    const ids = NEWS_SOURCE_REGISTRY.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('reliability scores are between 0 and 1 for all sources', () => {
    for (const src of NEWS_SOURCE_REGISTRY) {
      expect(src.reliability).toBeGreaterThanOrEqual(0)
      expect(src.reliability).toBeLessThanOrEqual(1)
    }
  })

  it('state-media sources have reliability below 0.6', () => {
    const stateMedia = NEWS_SOURCE_REGISTRY.filter(s => s.biasLabel === 'state-media')
    expect(stateMedia.length).toBeGreaterThanOrEqual(2)   // Xinhua + TASS at minimum
    for (const src of stateMedia) {
      expect(src.reliability).toBeLessThan(0.6)
    }
  })

  it('state-media sources include "state-media" in extraTags', () => {
    const stateMedia = NEWS_SOURCE_REGISTRY.filter(s => s.biasLabel === 'state-media')
    for (const src of stateMedia) {
      expect(src.extraTags).toContain('state-media')
    }
  })

  it('tier-1 sources (BBC, NHK, NPR, DW, UN News) have reliability >= 0.88', () => {
    // nhk-world was removed Oct 14, 2026: its feed was Japanese and two months old
    const tier1Ids = ['bbc-world', 'npr-news', 'dw-world', 'un-news']
    for (const id of tier1Ids) {
      const src = NEWS_SOURCE_REGISTRY.find(s => s.id === id)
      expect(src).toBeDefined()
      expect(src!.reliability).toBeGreaterThanOrEqual(0.88)
    }
  })

  it('all sources have a non-empty defaultLocation', () => {
    for (const src of NEWS_SOURCE_REGISTRY) {
      expect(src.defaultLocation.length).toBeGreaterThan(0)
    }
  })

  it('defaultLat is in range -90 to 90 and defaultLng in -180 to 180', () => {
    for (const src of NEWS_SOURCE_REGISTRY) {
      expect(src.defaultLat).toBeGreaterThanOrEqual(-90)
      expect(src.defaultLat).toBeLessThanOrEqual(90)
      expect(src.defaultLng).toBeGreaterThanOrEqual(-180)
      expect(src.defaultLng).toBeLessThanOrEqual(180)
    }
  })

  it('all sources have a non-empty language code', () => {
    for (const src of NEWS_SOURCE_REGISTRY) {
      expect(src.language.length).toBeGreaterThan(0)
    }
  })

  it('non-English sources are explicitly tagged with their language', () => {
    const nonEnglish = NEWS_SOURCE_REGISTRY.filter(s => s.language !== 'en')
    // Le Monde (fr) and Folha de S.Paulo (pt) added in cycle 8
    expect(nonEnglish.length).toBeGreaterThanOrEqual(2)
    for (const src of nonEnglish) {
      expect(src.language).not.toBe('en')
    }
  })

  it('includes the sources added in cycle 8', () => {
    const cycle8Ids = [
      'le-monde', 'der-spiegel-intl', 'el-pais-eng',
      'daily-maverick', 'nikkei-asia', 'allafrica',
      'folha-sao-paulo', 'the-conversation',
      // the-wire-india was removed in October 2026: its feed address serves the website;
      // arab-news on Oct 14, 2026: it turned away every poll from our server
    ]
    for (const id of cycle8Ids) {
      const src = NEWS_SOURCE_REGISTRY.find(s => s.id === id)
      expect(src).toBeDefined()
    }
  })

  it('includes the sources added Oct 14, 2026 (replacements for dead feeds)', () => {
    for (const id of ['upi-top', 'ansa-en', 'yonhap-en', 'yonhap-nk', 'nyt-world', 'wsj-world', 'civil-ge',
      'standard-ke', 'egypt-independent', 'defense-news', 'mercopress']) {
      expect(NEWS_SOURCE_REGISTRY.find(s => s.id === id)).toBeDefined()
    }
  })

  it('has no feed that is gone or answers only bot checks (removed Oct 14, 2026)', () => {
    for (const id of ['euractiv', 'thestreet-markets', 'barrons-markets', 'nation-africa-ke', 'ahram-online', 'iea-news',
      'lawfare-blog', 'arab-weekly', 'maritime-global-security', 'port-technology', 'iiss-blog', 'naval-news',
      'georgia-today', 'islands-business', 'nhk-world', 'xinhua-en', 'cnn-markets', 'cnn-world', 'who-news', 'nature-news']) {
      expect(NEWS_SOURCE_REGISTRY.find(s => s.id === id)).toBeUndefined()
    }
  })

  it('replaces the feeds that turn our server away (Oct 14, 2026, 2 PM)', () => {
    for (const id of ['arab-news', 'bangkok-post', 'africa-report', 'ethiopia-reporter']) {
      expect(NEWS_SOURCE_REGISTRY.find(s => s.id === id)).toBeUndefined()
    }
    // thaiger was removed Oct 17, 2026: it failed every poll from our server too
    for (const id of ['gulf-news', 'saudi-gazette', 'fana-en', 'scroll-in', 'foreign-policy', 'meduza-en',
      'rest-of-world', 'sciencealert', 'the-register', 'folha-en']) {
      expect(NEWS_SOURCE_REGISTRY.find(s => s.id === id)).toBeDefined()
    }
    // A state broadcaster is labelled as one
    expect(NEWS_SOURCE_REGISTRY.find(s => s.id === 'fana-en')?.biasLabel).toBe('state-media')
  })

  it('drops the feeds that never answered our server and covers Canada (Oct 17, 2026)', () => {
    for (const id of ['anadolu-en', 'new-arab', 'thaiger', 'reliefweb-updates']) {
      expect(NEWS_SOURCE_REGISTRY.find(s => s.id === id)).toBeUndefined()
    }
    const canada = NEWS_SOURCE_REGISTRY.filter(s => s.countryCode === 'CA').map(s => s.id)
    expect(canada).toEqual(expect.arrayContaining(['globe-and-mail-ca', 'global-news-ca', 'national-post']))
    // Thailand and Turkey keep an outlet each
    expect(NEWS_SOURCE_REGISTRY.some(s => s.countryCode === 'TH')).toBe(true)
    expect(NEWS_SOURCE_REGISTRY.some(s => s.countryCode === 'TR')).toBe(true)
  })

  it('lists every feed once', () => {
    const ids = NEWS_SOURCE_REGISTRY.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('files every feed under a real category (USNI\'s "military" filed its stories as other)', () => {
    const valid = ['breaking', 'conflict', 'geopolitics', 'climate', 'health', 'economy', 'technology', 'science',
      'elections', 'culture', 'disaster', 'security', 'sports', 'space', 'finance', 'other']
    for (const src of NEWS_SOURCE_REGISTRY) expect(valid).toContain(src.category)
  })

  it('includes the sources added in cycle 9', () => {
    const cycle9Ids = [
      // euractiv was removed Oct 14, 2026: every request gets a bot check (403)
      'moscow-times', 'taipei-times', 'the-hindu-national',
      'dawn-pakistan', 'premium-times-nigeria',
      // bangkok-post was removed Oct 14, 2026: it turned away every poll from our server
      'al-monitor', 'eu-observer', 'africanews', 'rferl',
      'asia-times', 'channel-news-asia',
      // jakarta-post and caixin-global were removed in October 2026: their feeds are gone (404)
    ]
    for (const id of cycle9Ids) {
      const src = NEWS_SOURCE_REGISTRY.find(s => s.id === id)
      expect(src).toBeDefined()
    }
  })
})

// ─── SEVERITY DETECTION ───────────────────────────────────────────────────────

describe('detectNewsSeverity', () => {
  it('returns critical for nuclear strike', () => {
    expect(detectNewsSeverity('Nuclear strike warning issued', '')).toBe('critical')
  })

  it('returns critical for pandemic declared', () => {
    expect(detectNewsSeverity('WHO: Pandemic declared as new virus spreads', '')).toBe('critical')
  })

  it('returns high for bombing', () => {
    expect(detectNewsSeverity('Bombing kills dozens in capital city', '')).toBe('high')
  })

  it('returns high for earthquake', () => {
    expect(detectNewsSeverity('Magnitude 7.5 earthquake strikes Turkey', '')).toBe('high')
  })

  it('returns high for terrorist attack', () => {
    expect(detectNewsSeverity('Terror attack in Brussels leaves 20 dead', 'Explosion rocked city centre')).toBe('high')
  })

  it('returns medium for election', () => {
    expect(detectNewsSeverity('Election results: opposition leads in early count', '')).toBe('medium')
  })

  it('returns medium for sanctions', () => {
    expect(detectNewsSeverity('US imposes new sanctions on Russian oil industry', '')).toBe('medium')
  })

  it('returns medium for protest', () => {
    expect(detectNewsSeverity('Thousands protest in Paris over pension reform', '')).toBe('medium')
  })

  it('returns low for benign headline', () => {
    expect(detectNewsSeverity('G7 leaders hold annual dinner in Italy', '')).toBe('low')
  })

  it('handles empty strings gracefully', () => {
    expect(detectNewsSeverity('', '')).toBe('low')
  })
})

// ─── CATEGORY DETECTION ───────────────────────────────────────────────────────

describe('detectNewsCategory', () => {
  const geopoliticsSource = 'geopolitics' as const

  it('overrides to health for outbreak articles', () => {
    expect(detectNewsCategory('WHO declares new Ebola outbreak in Congo', '', geopoliticsSource)).toBe('health')
  })

  it('overrides to disaster for earthquake', () => {
    expect(detectNewsCategory('6.8 Earthquake hits Morocco', '', geopoliticsSource)).toBe('disaster')
  })

  it('overrides to elections for voting', () => {
    expect(detectNewsCategory('French voters head to ballot in snap election', '', geopoliticsSource)).toBe('elections')
  })

  it('overrides to economy for market crash', () => {
    expect(detectNewsCategory('Stock market drops 8% as recession fears grow', '', geopoliticsSource)).toBe('economy')
  })

  it('overrides to technology for AI news', () => {
    expect(detectNewsCategory('OpenAI unveils new model amid AI regulation debate', '', geopoliticsSource)).toBe('technology')
  })

  it('overrides to climate for COP article', () => {
    expect(detectNewsCategory('COP31 opens with calls for faster carbon cuts', '', geopoliticsSource)).toBe('climate')
  })

  it('overrides to conflict for invasion', () => {
    expect(detectNewsCategory('Russian troops advance on Kharkiv in major offensive', '', geopoliticsSource)).toBe('conflict')
  })

  it('overrides to space for rocket launch', () => {
    expect(detectNewsCategory('SpaceX Falcon Heavy launches NASA payload to Mars', '', geopoliticsSource)).toBe('space')
  })

  it('overrides to security for ransomware', () => {
    expect(detectNewsCategory('Ransomware hits UK hospital network', '', geopoliticsSource)).toBe('security')
  })

  it('returns sourceDefault when no keyword matches', () => {
    expect(detectNewsCategory('Leaders meet in Vienna for trade talks', '', geopoliticsSource)).toBe('geopolitics')
  })

  // Oct 11, 2026 (reading audit, H-0011)
  it('files attacks as conflict, whatever the outlet usually covers', () => {
    expect(detectNewsCategory('Yemen’s Houthis renew warning over Saudi airports after deadly Riyadh attack', '', 'finance')).toBe('conflict')
    expect(detectNewsCategory('Russia’s Yandex says data centre shut down after drone attack', '', geopoliticsSource)).toBe('conflict')
  })

  it('files surgery as health, and matches as sports', () => {
    expect(detectNewsCategory('Pope Leo XIV to undergo surgery to remove lung nodule', '', geopoliticsSource)).toBe('health')
    expect(detectNewsCategory('Liverpool vs Man City live: Premier League', '', geopoliticsSource)).toBe('sports')
  })

  it('reads the headline before the description (casualty reports quote health ministries)', () => {
    expect(detectNewsCategory('Israeli strikes kill five in Gaza', 'Gaza health ministry says five were killed', geopoliticsSource)).toBe('conflict')
  })

  it("doesn't call a cyber attack, a heart attack or a tiger's attack conflict", () => {
    expect(detectNewsCategory('Cyber attack shuts airline check-in systems', '', geopoliticsSource)).toBe('security')
    expect(detectNewsCategory('Senator recovering after heart attack', '', geopoliticsSource)).toBe('health')
    expect(detectNewsCategory('Man dies after tiger attack at UK zoo', '', geopoliticsSource)).toBe('other')
  })
})

// ─── GEO INFERENCE ───────────────────────────────────────────────────────────

describe('inferGeo', () => {
  const bbcSource: NewsSource = NEWS_SOURCE_REGISTRY.find(s => s.id === 'bbc-world')!

  it('infers Ukraine from title keyword', () => {
    const geo = inferGeo('War in Ukraine: Kyiv strikes Russian fuel depot', '', bbcSource)
    expect(geo.locationName).toContain('Ukraine')
    expect(geo.countryCode).toBe('UA')
  })

  it('infers Gaza from description', () => {
    const geo = inferGeo('Middle East', 'Hamas fighters in Gaza launch rockets', bbcSource)
    expect(geo.locationName?.toLowerCase()).toContain('gaza')
  })

  it('infers China from Xi Jinping mention', () => {
    const geo = inferGeo('Xi Jinping meets business leaders', '', bbcSource)
    expect(geo.countryCode).toBe('CN')
  })

  it('prefers the place a headline names to a leader it names', () => {
    expect(inferGeo('Xi Jinping warns Taiwan over independence push', '', bbcSource).countryCode).toBe('TW')
  })

  it('infers US from White House mention', () => {
    const geo = inferGeo('White House announces new sanctions', '', bbcSource)
    expect(geo.countryCode).toBe('US')
  })

  it("gives an international outlet's story without a place no pin (not the outlet's office)", () => {
    expect(inferGeo('Global leaders discuss AI governance', '', bbcSource))
      .toEqual({ lat: null, lng: null, locationName: null, countryCode: null })
  })

  it("pins a national outlet's story without a place at the outlet's home", () => {
    const punch = NEWS_SOURCE_REGISTRY.find(s => s.id === 'punch-nigeria')!
    const geo = inferGeo('Tinubu will deliver more prosperity if re-elected — First Lady', '', punch)
    expect(geo.countryCode).toBe('NG')
  })

  it('Kyiv Independent defaults to Ukraine', () => {
    const kyivSrc = NEWS_SOURCE_REGISTRY.find(s => s.id === 'kyiv-independent')!
    const geo = inferGeo('Front line update: heavy shelling overnight', '', kyivSrc)
    expect(geo.countryCode).toBe('UA')
  })
})

// ─── RSS / ATOM PARSING ───────────────────────────────────────────────────────

describe('parseFeedItems', () => {
  it('reads a CDATA section wrapped in whitespace (OC Media, Oct 14, 2026: every title came out empty)', () => {
    const xml = `<rss><channel><item>
\t\t<title>
\t\t\t<![CDATA[ MP from Armenia’s ruling party denied entry to Russia ]]>
\t\t</title>
\t\t<description>
\t\t\t<![CDATA[ Lusine Badalyan claims authorities declined to give a reason. ]]>
\t\t</description>
\t\t<link>https://oc-media.org/mp-denied-entry/</link>
\t</item></channel></rss>`
    const [item] = parseFeedItems(xml)
    expect(item?.title).toBe('MP from Armenia’s ruling party denied entry to Russia')
    expect(item?.description).toBe('Lusine Badalyan claims authorities declined to give a reason.')
    expect(item?.link).toBe('https://oc-media.org/mp-denied-entry/')
  })

  const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title><![CDATA[Breaking: Major earthquake strikes Pacific]]></title>
      <link>https://example.com/earthquake-1</link>
      <pubDate>Sat, 28 Mar 2026 10:00:00 GMT</pubDate>
      <description><![CDATA[A major earthquake measuring 7.8 struck the Pacific coast.]]></description>
    </item>
    <item>
      <title>Election: Voters head to polls</title>
      <link>https://example.com/election-2</link>
      <pubDate>Sat, 28 Mar 2026 09:30:00 GMT</pubDate>
      <description>Citizens cast ballots in historic election.</description>
    </item>
  </channel>
</rss>`

  const ATOM_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom headline one</title>
    <link href="https://example.com/atom-1"/>
    <published>2026-03-28T10:00:00Z</published>
    <summary>Summary of atom entry one.</summary>
  </entry>
  <entry>
    <title>Atom headline two</title>
    <id>https://example.com/atom-2</id>
    <updated>2026-03-28T09:00:00Z</updated>
    <summary><![CDATA[Summary of entry two.]]></summary>
  </entry>
</feed>`

  it('parses RSS items with CDATA titles', () => {
    const items = parseFeedItems(RSS_FIXTURE)
    expect(items.length).toBe(2)
    expect(items[0].title).toContain('earthquake')
    expect(items[0].link).toBe('https://example.com/earthquake-1')
  })

  it('parses RSS items with plain text', () => {
    const items = parseFeedItems(RSS_FIXTURE)
    expect(items[1].title).toContain('Election')
    expect(items[1].description).toContain('ballots')
  })

  it('parses pubDate correctly', () => {
    const items = parseFeedItems(RSS_FIXTURE)
    expect(items[0].pubDate).toContain('2026')
  })

  it('parses Atom <entry> blocks', () => {
    const items = parseFeedItems(ATOM_FIXTURE)
    expect(items.length).toBe(2)
    expect(items[0].title).toBe('Atom headline one')
  })

  it('extracts Atom link href attribute', () => {
    const items = parseFeedItems(ATOM_FIXTURE)
    expect(items[0].link).toBe('https://example.com/atom-1')
  })

  it('extracts Atom <id> as link when no <link> present', () => {
    const items = parseFeedItems(ATOM_FIXTURE)
    // entry two has <id> but no <link href=...>
    expect(items[1].link).toContain('atom-2')
  })

  it('returns empty array for empty XML', () => {
    expect(parseFeedItems('')).toEqual([])
    expect(parseFeedItems('<rss></rss>')).toEqual([])
  })

  it('returns empty array for malformed XML', () => {
    expect(parseFeedItems('not xml at all').length).toBe(0)
  })

  it('caps output at MAX_ITEMS (20)', () => {
    const manyItems = Array.from({ length: 30 }, (_, i) =>
      `<item><title>Item ${i}</title><link>https://x.com/${i}</link></item>`,
    ).join('\n')
    const xml = `<rss><channel>${manyItems}</channel></rss>`
    const items = parseFeedItems(xml)
    expect(items.length).toBeLessThanOrEqual(20)
  })
})

// ─── DEDUP KEY GENERATION ────────────────────────────────────────────────────

describe('newsRedisKey', () => {
  it('generates a key with the expected prefix', () => {
    const key = newsRedisKey('bbc-world', 'https://bbc.co.uk/news/world-12345')
    expect(key).toMatch(/^osint:news-rss:bbc-world:/)
  })

  it('produces different keys for different source IDs', () => {
    const url = 'https://example.com/article-1'
    const key1 = newsRedisKey('reuters-world', url)
    const key2 = newsRedisKey('bbc-world', url)
    expect(key1).not.toBe(key2)
  })

  it('produces different keys for different URLs from the same source', () => {
    const k1 = newsRedisKey('bbc-world', 'https://bbc.co.uk/news/world-1')
    const k2 = newsRedisKey('bbc-world', 'https://bbc.co.uk/news/world-2')
    expect(k1).not.toBe(k2)
  })

  it('key length stays bounded (under 200 chars)', () => {
    const longUrl = 'https://example.com/' + 'x'.repeat(200) + '?q=test'
    const key = newsRedisKey('bbc-world', longUrl)
    expect(key.length).toBeLessThan(200)
  })

  it('sanitizes special characters in URL', () => {
    const key = newsRedisKey('dw-world', 'https://dw.com/news/article?id=123&lang=en#top')
    expect(key).not.toContain('?')
    expect(key).not.toContain('&')
    expect(key).not.toContain('#')
  })
})

describe('news text fixes', () => {
  it('does not read the word "who" as the World Health Organization', () => {
    expect(detectNewsCategory('Abbas postpones elections', 'Those who watched say little changed', 'geopolitics')).toBe('elections')
    expect(detectNewsCategory('World Health Organization warns of risks', '', 'geopolitics')).toBe('health')
  })

  it('rates "kills" headlines high', () => {
    expect(detectNewsSeverity('Russian attack on Zaporizhzhia kills seven', '')).toBe('high')
  })

  it('pins places only at the start of a word', () => {
    const src = NEWS_SOURCE_REGISTRY[0]
    expect(inferGeo('Tirana hosts summit', '', src).countryCode).not.toBe('IR')
    expect(inferGeo('The Dukes of Hazzard return', '', src).countryCode).toBeNull()
    expect(inferGeo('Iranian envoy arrives', '', src).countryCode).toBe('IR')
    expect(inferGeo('Palestinian president speaks', '', src).countryCode).toBe('PS')
    expect(inferGeo('UK inflation falls', '', src).countryCode).toBe('GB')
  })

  it('decodes HTML entities but never produces a tag', () => {
    expect(decodeEntities('Abbas&#x27;s plan &amp; more &quot;x&quot;')).toBe('Abbas\'s plan & more "x"')
    expect(decodeEntities('&lt;b&gt; &#60;i&#62;')).toBe('&lt;b> &#60;i>')
  })
})

// ─── OLD ITEMS ────────────────────────────────────────────────────────────────

describe('isStaleItem', () => {
  const now = Date.parse('2026-10-11T03:20:00Z')

  it('skips stories published years ago (a feed posting its backlog)', () => {
    expect(isStaleItem('Fri, 10 Dec 2021 18:58:28 GMT', now)).toBe(true)  // CNN world, Oct 11
    expect(isStaleItem('2017-03-30T08:00:00Z', now)).toBe(true)           // Xinhua
  })

  it('keeps today\'s and yesterday\'s stories', () => {
    expect(isStaleItem('Sat, 11 Oct 2026 02:00:00 GMT', now)).toBe(false)
    expect(isStaleItem('Fri, 10 Oct 2026 01:00:00 +0000', now)).toBe(false)
  })

  it('draws the line at three days', () => {
    expect(MAX_ITEM_AGE_MS).toBe(3 * 24 * 3_600_000)
    expect(isStaleItem(new Date(now - MAX_ITEM_AGE_MS + 60_000).toUTCString(), now)).toBe(false)
    expect(isStaleItem(new Date(now - MAX_ITEM_AGE_MS - 60_000).toUTCString(), now)).toBe(true)
  })

  it('keeps items without a readable date (they get the time we first saw them)', () => {
    expect(isStaleItem('', now)).toBe(false)
    expect(isStaleItem(undefined, now)).toBe(false)
    expect(isStaleItem('not a date', now)).toBe(false)
  })
})

describe('decodeFeed (Oct 11, 2026)', () => {
  it('reads a feed in the character set its XML prolog declares', async () => {
    const { decodeFeed } = await import('../news-rss')
    const xml = '<?xml version="1.0" encoding="ISO-8859-1" ?><rss><title>Argentina cara amea\u00e7a planos</title></rss>'
    expect(decodeFeed(Buffer.from(xml, 'latin1'), 'text/xml')).toContain('amea\u00e7a')
  })

  it("prefers the header's charset, and reads UTF-8 by default", async () => {
    const { decodeFeed } = await import('../news-rss')
    expect(decodeFeed(Buffer.from('<rss>S\u00e3o Paulo</rss>', 'latin1'), 'text/xml; charset=ISO-8859-1')).toBe('<rss>S\u00e3o Paulo</rss>')
    expect(decodeFeed(Buffer.from('<rss>S\u00e3o Paulo</rss>', 'utf8'), 'application/rss+xml')).toBe('<rss>S\u00e3o Paulo</rss>')
    expect(decodeFeed(Buffer.from('\uFEFF<?xml version="1.0" encoding="utf-8"?><rss>\u00e7</rss>', 'utf8'))).toContain('\u00e7')
  })

  it('falls back to UTF-8 for a character set it does not know', async () => {
    const { decodeFeed } = await import('../news-rss')
    expect(decodeFeed(Buffer.from('<?xml version="1.0" encoding="x-unknown-9"?><rss>\u00e7</rss>', 'utf8'))).toContain('\u00e7')
  })
})
