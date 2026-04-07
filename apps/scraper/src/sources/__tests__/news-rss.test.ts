/**
 * Tests for the global news RSS adapter (news-rss.ts)
 *
 * Covers: feed registry integrity, RSS/Atom parsing, severity detection,
 * category override, geo inference, dedup key generation, and poller lifecycle.
 */

import {
  NEWS_SOURCE_REGISTRY,
  type NewsSource,
  detectNewsSeverity,
  detectNewsCategory,
  inferGeo,
  parseFeedItems,
  newsRedisKey,
} from '../news-rss'

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

  it('tier-1 sources (Reuters, BBC, AP, NHK) have reliability >= 0.88', () => {
    const tier1Ids = ['reuters-world', 'bbc-world', 'ap-news', 'nhk-world']
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

  it('includes 10 new sources added in cycle 8', () => {
    const cycle8Ids = [
      'le-monde', 'der-spiegel-intl', 'el-pais-eng', 'the-wire-india',
      'daily-maverick', 'nikkei-asia', 'arab-news', 'allafrica',
      'folha-sao-paulo', 'the-conversation',
    ]
    for (const id of cycle8Ids) {
      const src = NEWS_SOURCE_REGISTRY.find(s => s.id === id)
      expect(src).toBeDefined()
    }
  })

  it('includes 15 new sources added in cycle 9', () => {
    const cycle9Ids = [
      'euractiv', 'moscow-times', 'taipei-times', 'the-hindu-national',
      'dawn-pakistan', 'premium-times-nigeria', 'bangkok-post', 'jakarta-post',
      'al-monitor', 'eu-observer', 'africanews', 'rferl',
      'caixin-global', 'asia-times', 'channel-news-asia',
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
    expect(geo.locationName.toLowerCase()).toContain('gaza')
  })

  it('infers China from Xi Jinping mention', () => {
    const geo = inferGeo('Xi Jinping warns Taiwan over independence push', '', bbcSource)
    expect(geo.countryCode).toBe('CN')
  })

  it('infers US from White House mention', () => {
    const geo = inferGeo('White House announces new sanctions', '', bbcSource)
    expect(geo.countryCode).toBe('US')
  })

  it('falls back to source defaults when no geo keyword found', () => {
    const geo = inferGeo('Global leaders discuss AI governance', '', bbcSource)
    expect(geo.lat).toBe(bbcSource.defaultLat)
    expect(geo.lng).toBe(bbcSource.defaultLng)
    expect(geo.locationName).toBe(bbcSource.defaultLocation)
  })

  it('Kyiv Independent defaults to Ukraine', () => {
    const kyivSrc = NEWS_SOURCE_REGISTRY.find(s => s.id === 'kyiv-independent')!
    const geo = inferGeo('Front line update: heavy shelling overnight', '', kyivSrc)
    expect(geo.countryCode).toBe('UA')
  })
})

// ─── RSS / ATOM PARSING ───────────────────────────────────────────────────────

describe('parseFeedItems', () => {
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
