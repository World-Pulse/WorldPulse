/**
 * Tests for the Carrier Strike Group OSINT tracker.
 *
 * Covers: carrier name detection, event type detection, severity mapping,
 * dedup key generation, position estimation, signal output shape,
 * and USNI RSS parsing.
 */

import { describe, it, expect } from 'vitest'
import {
  detectCarrier,
  detectEventType,
  eventSeverity,
  dedupKey,
  estimatePosition,
  parseRssItems,
  CARRIER_REGISTRY,
  type CsgEventType,
} from '../carrier-strike-groups'

// ─── 1. Carrier name detection from article titles ────────────────────────────

describe('detectCarrier', () => {
  it('detects carrier by full name', () => {
    const carrier = detectCarrier('USS Theodore Roosevelt departs San Diego')
    expect(carrier).not.toBeNull()
    expect(carrier?.hull).toBe('CVN-71')
  })

  it('detects carrier by short alias', () => {
    const carrier = detectCarrier('The TR strike group has entered the Philippine Sea')
    expect(carrier).not.toBeNull()
    expect(carrier?.hull).toBe('CVN-71')
  })

  it('detects carrier by hull designation', () => {
    const carrier = detectCarrier('CVN-78 completed initial sea trials')
    expect(carrier).not.toBeNull()
    expect(carrier?.name).toBe('USS Gerald R. Ford')
  })

  it('detects carrier by nickname (Ike)', () => {
    const carrier = detectCarrier('Ike returned to Norfolk after 8-month deployment')
    expect(carrier).not.toBeNull()
    expect(carrier?.hull).toBe('CVN-69')
  })

  it('returns null when no carrier is mentioned', () => {
    const carrier = detectCarrier('Pentagon announces new defense budget proposal')
    expect(carrier).toBeNull()
  })

  it('handles case-insensitive matching', () => {
    const carrier = detectCarrier('uss nimitz arrived in bremerton')
    expect(carrier).not.toBeNull()
    expect(carrier?.hull).toBe('CVN-68')
  })

  it('detects all 11 carriers exist in registry', () => {
    expect(CARRIER_REGISTRY).toHaveLength(11)
    const hulls = CARRIER_REGISTRY.map(c => c.hull)
    expect(hulls).toContain('CVN-68')
    expect(hulls).toContain('CVN-69')
    expect(hulls).toContain('CVN-70')
    expect(hulls).toContain('CVN-71')
    expect(hulls).toContain('CVN-72')
    expect(hulls).toContain('CVN-73')
    expect(hulls).toContain('CVN-74')
    expect(hulls).toContain('CVN-75')
    expect(hulls).toContain('CVN-76')
    expect(hulls).toContain('CVN-77')
    expect(hulls).toContain('CVN-78')
  })
})

// ─── 2. Severity mapping ──────────────────────────────────────────────────────

describe('eventSeverity', () => {
  it('maps deployment to high severity', () => {
    expect(eventSeverity('deployment')).toBe('high')
  })

  it('maps departure to medium severity', () => {
    expect(eventSeverity('departure')).toBe('medium')
  })

  it('maps arrival to medium severity', () => {
    expect(eventSeverity('arrival')).toBe('medium')
  })

  it('maps exercise to medium severity', () => {
    expect(eventSeverity('exercise')).toBe('medium')
  })

  it('maps mention to medium severity', () => {
    expect(eventSeverity('mention')).toBe('medium')
  })
})

// ─── 3. Event type detection ──────────────────────────────────────────────────

describe('detectEventType', () => {
  it('detects deployment from "deployed"', () => {
    expect(detectEventType('USS Carl Vinson deployed to the Western Pacific')).toBe('deployment')
  })

  it('detects departure from "departed"', () => {
    expect(detectEventType('USS Nimitz departed Bremerton on Thursday')).toBe('departure')
  })

  it('detects arrival from "arrived"', () => {
    expect(detectEventType('USS Harry Truman arrived in Rota, Spain')).toBe('arrival')
  })

  it('detects exercise from "exercise"', () => {
    expect(detectEventType('USS Abraham Lincoln participates in joint exercise with JMSDF')).toBe('exercise')
  })

  it('detects deployment from "surge deployment"', () => {
    expect(detectEventType('USS Gerald R. Ford ordered surge deployment to Eastern Mediterranean')).toBe('deployment')
  })

  it('falls back to mention for unclassified text', () => {
    expect(detectEventType('USS George Washington crew receives award')).toBe('mention')
  })

  it('prioritizes deployment over departure keywords', () => {
    expect(detectEventType('USS Ronald Reagan deployed from Yokosuka')).toBe('deployment')
  })
})

// ─── 4. Dedup key generation ──────────────────────────────────────────────────

describe('dedupKey', () => {
  it('generates a stable key for same inputs', () => {
    const key1 = dedupKey('CVN-71', 'deployment', 'https://news.usni.org/2026/03/01/tr-deploys')
    const key2 = dedupKey('CVN-71', 'deployment', 'https://news.usni.org/2026/03/01/tr-deploys')
    expect(key1).toBe(key2)
  })

  it('generates different keys for different event types', () => {
    const url  = 'https://news.usni.org/article'
    const dep  = dedupKey('CVN-71', 'deployment', url)
    const arr  = dedupKey('CVN-71', 'arrival',    url)
    expect(dep).not.toBe(arr)
  })

  it('generates different keys for different carriers', () => {
    const url  = 'https://news.usni.org/article'
    const tr   = dedupKey('CVN-71', 'departure', url)
    const ike  = dedupKey('CVN-69', 'departure', url)
    expect(tr).not.toBe(ike)
  })

  it('prefixes with osint:csg namespace', () => {
    const key = dedupKey('CVN-78', 'exercise', 'https://news.usni.org/x')
    expect(key.startsWith('osint:csg:')).toBe(true)
  })

  it('sanitizes hull designation in key (no special chars)', () => {
    const key = dedupKey('CVN-78', 'mention', 'https://example.com')
    // Should not contain characters that break Redis key parsing
    expect(key).toMatch(/^[a-zA-Z0-9:._-]+$/)
  })
})

// ─── 5. Position estimation ───────────────────────────────────────────────────

describe('estimatePosition', () => {
  const tr = CARRIER_REGISTRY.find(c => c.hull === 'CVN-71')!

  it('detects Mediterranean theater from article text', () => {
    const pos = estimatePosition(tr, 'The TR strike group is operating in the Mediterranean')
    expect(pos.locationName).toContain('Mediterranean')
    expect(pos.lat).toBeGreaterThan(30)
    expect(pos.lat).toBeLessThan(45)
  })

  it('detects Persian Gulf theater', () => {
    const pos = estimatePosition(tr, 'USS Theodore Roosevelt enters the Persian Gulf')
    expect(pos.locationName).toContain('Persian Gulf')
  })

  it('detects Red Sea theater', () => {
    const pos = estimatePosition(tr, 'TR operating in the Red Sea')
    expect(pos.locationName).toContain('Red Sea')
  })

  it('falls back to carrier static position when no theater matched', () => {
    const pos = estimatePosition(tr, 'USS Theodore Roosevelt crew training exercise')
    expect(pos.lat).toBe(tr.position[0])
    expect(pos.lng).toBe(tr.position[1])
    expect(pos.locationName).toBe(tr.positionName)
  })

  it('detects Yokosuka from text', () => {
    const gw = CARRIER_REGISTRY.find(c => c.hull === 'CVN-73')!
    const pos = estimatePosition(gw, 'USS George Washington moored at Yokosuka')
    expect(pos.locationName).toContain('Yokosuka')
  })
})

// ─── 6. USNI RSS parsing ─────────────────────────────────────────────────────

describe('parseRssItems', () => {
  const MOCK_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>USNI News</title>
    <item>
      <title><![CDATA[USS Theodore Roosevelt Departs San Diego for Western Pacific Deployment]]></title>
      <link>https://news.usni.org/2026/03/20/uss-theodore-roosevelt-departs</link>
      <pubDate>Thu, 20 Mar 2026 14:30:00 +0000</pubDate>
      <description><![CDATA[The USS Theodore Roosevelt (CVN-71) carrier strike group departed San Diego on Thursday for a scheduled deployment to the Western Pacific.]]></description>
    </item>
    <item>
      <title>USS Carl Vinson Arrives in Pearl Harbor</title>
      <link>https://news.usni.org/2026/03/18/carl-vinson-pearl-harbor</link>
      <pubDate>Tue, 18 Mar 2026 09:00:00 +0000</pubDate>
      <description>USS Carl Vinson (CVN-70) made a port call in Pearl Harbor, Hawaii.</description>
    </item>
    <item>
      <title>Pentagon Budget Proposal</title>
      <link>https://news.usni.org/2026/03/15/pentagon-budget</link>
      <pubDate>Sun, 15 Mar 2026 12:00:00 +0000</pubDate>
      <description>Congress debates new defense spending.</description>
    </item>
  </channel>
</rss>`

  it('parses all RSS items from feed', () => {
    const items = parseRssItems(MOCK_RSS)
    expect(items).toHaveLength(3)
  })

  it('extracts title from CDATA section', () => {
    const items = parseRssItems(MOCK_RSS)
    expect(items[0].title).toContain('USS Theodore Roosevelt')
    expect(items[0].title).toContain('Western Pacific Deployment')
  })

  it('extracts title from plain text', () => {
    const items = parseRssItems(MOCK_RSS)
    expect(items[1].title).toBe('USS Carl Vinson Arrives in Pearl Harbor')
  })

  it('extracts link for each item', () => {
    const items = parseRssItems(MOCK_RSS)
    expect(items[0].link).toBe('https://news.usni.org/2026/03/20/uss-theodore-roosevelt-departs')
    expect(items[1].link).toBe('https://news.usni.org/2026/03/18/carl-vinson-pearl-harbor')
  })

  it('extracts pubDate', () => {
    const items = parseRssItems(MOCK_RSS)
    expect(items[0].pubDate).toContain('2026')
  })

  it('extracts description from CDATA and plain text', () => {
    const items = parseRssItems(MOCK_RSS)
    expect(items[0].description).toContain('carrier strike group')
    expect(items[1].description).toContain('Pearl Harbor')
  })

  it('returns empty array for empty/invalid XML', () => {
    expect(parseRssItems('')).toHaveLength(0)
    expect(parseRssItems('<rss></rss>')).toHaveLength(0)
  })

  it('correctly identifies carrier mentions in parsed items', () => {
    const items  = parseRssItems(MOCK_RSS)
    const trItem = items[0]
    const carrier = detectCarrier(`${trItem.title} ${trItem.description}`)
    expect(carrier?.hull).toBe('CVN-71')

    const cvItem     = items[1]
    const cvCarrier  = detectCarrier(`${cvItem.title} ${cvItem.description}`)
    expect(cvCarrier?.hull).toBe('CVN-70')

    // Non-carrier item should return null
    const nonCarrier = detectCarrier(`${items[2].title} ${items[2].description}`)
    expect(nonCarrier).toBeNull()
  })

  it('detects correct event types from parsed items', () => {
    const items = parseRssItems(MOCK_RSS)
    expect(detectEventType(`${items[0].title} ${items[0].description}`)).toBe('deployment')
    expect(detectEventType(`${items[1].title} ${items[1].description}`)).toBe('arrival')
  })
})

// ─── 7. Signal output shape validation ───────────────────────────────────────

describe('signal output shape', () => {
  it('all carriers have required fields', () => {
    for (const carrier of CARRIER_REGISTRY) {
      expect(carrier.name).toBeTruthy()
      expect(carrier.hull).toMatch(/^CVN-\d+$/)
      expect(carrier.aliases).toBeInstanceOf(Array)
      expect(carrier.aliases.length).toBeGreaterThan(0)
      expect(carrier.position).toHaveLength(2)
      expect(carrier.position[0]).toBeGreaterThanOrEqual(-90)
      expect(carrier.position[0]).toBeLessThanOrEqual(90)
      expect(carrier.position[1]).toBeGreaterThanOrEqual(-180)
      expect(carrier.position[1]).toBeLessThanOrEqual(180)
      expect(carrier.positionName).toBeTruthy()
      expect(carrier.fleet).toBeTruthy()
    }
  })

  it('eventSeverity returns valid severity values', () => {
    const validSeverities = ['high', 'medium'] as const
    const eventTypes: CsgEventType[] = ['deployment', 'departure', 'arrival', 'exercise', 'mention']
    for (const et of eventTypes) {
      expect(validSeverities).toContain(eventSeverity(et))
    }
  })

  it('dedupKey output is a non-empty string', () => {
    const key = dedupKey('CVN-73', 'deployment', 'https://news.usni.org/test')
    expect(typeof key).toBe('string')
    expect(key.length).toBeGreaterThan(0)
  })
})
