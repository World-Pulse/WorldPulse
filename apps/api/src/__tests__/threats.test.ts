/**
 * Threats Intelligence API — Unit Tests
 *
 * Tests for classifyThreatType, parseThreatOrigin, buildSeverityDistribution,
 * buildThreatTypeBreakdown, deriveTrendDirection, buildActiveDigest,
 * constants, and type exports from apps/api/src/routes/threats.ts
 */

import { describe, it, expect } from 'vitest'
import {
  classifyThreatType,
  parseThreatOrigin,
  buildSeverityDistribution,
  buildThreatTypeBreakdown,
  deriveTrendDirection,
  buildActiveDigest,
  THREATS_CACHE_TTL,
  THREATS_SUMMARY_CACHE_TTL,
  THREATS_RATE_LIMIT,
  THREATS_CACHE_KEY,
  THREATS_SUMMARY_CACHE_KEY,
} from '../routes/threats'

// ─── Constants ─────────────────────────────────────────────────────────────────

describe('threats constants', () => {
  it('THREATS_CACHE_TTL is 180 seconds (3 minutes)', () => {
    expect(THREATS_CACHE_TTL).toBe(180)
  })

  it('THREATS_SUMMARY_CACHE_TTL is 300 seconds (5 minutes)', () => {
    expect(THREATS_SUMMARY_CACHE_TTL).toBe(300)
  })

  it('THREATS_RATE_LIMIT is 30 rpm', () => {
    expect(THREATS_RATE_LIMIT).toBe(30)
  })

  it('THREATS_CACHE_KEY is threats:missiles', () => {
    expect(THREATS_CACHE_KEY).toBe('threats:missiles')
  })

  it('THREATS_SUMMARY_CACHE_KEY is threats:summary', () => {
    expect(THREATS_SUMMARY_CACHE_KEY).toBe('threats:summary')
  })
})

// ─── classifyThreatType ────────────────────────────────────────────────────────

describe('classifyThreatType', () => {
  // Hypersonic (highest precedence)
  it('classifies Kinzhal as hypersonic', () => {
    expect(classifyThreatType('Russian Kinzhal strike on Lviv logistics hub')).toBe('hypersonic')
  })

  it('classifies Zircon as hypersonic', () => {
    expect(classifyThreatType('Zircon hypersonic anti-ship missile test')).toBe('hypersonic')
  })

  it('classifies DF-17 as hypersonic', () => {
    expect(classifyThreatType('China deploys DF-17 near Taiwan Strait')).toBe('hypersonic')
  })

  // Ballistic
  it('classifies ICBM launch as ballistic', () => {
    expect(classifyThreatType('North Korea ICBM launch detected over Sea of Japan')).toBe('ballistic')
  })

  it('classifies Hwasong as ballistic', () => {
    expect(classifyThreatType('Hwasong-17 intercontinental missile test')).toBe('ballistic')
  })

  it('classifies Shahab as ballistic', () => {
    expect(classifyThreatType('Iran fires Shahab-3 ballistic missile')).toBe('ballistic')
  })

  // Cruise
  it('classifies Kalibr as cruise', () => {
    expect(classifyThreatType('Kalibr cruise missile volley from Caspian fleet')).toBe('cruise')
  })

  it('classifies Tomahawk as cruise', () => {
    expect(classifyThreatType('US fires Tomahawk at Syrian airfield')).toBe('cruise')
  })

  it('classifies Storm Shadow as cruise', () => {
    expect(classifyThreatType('Storm Shadow cruise missile strike on Russian depot')).toBe('cruise')
  })

  // Drone
  it('classifies Shahed drone as drone', () => {
    expect(classifyThreatType('Shahed-136 loitering munition attack on Kyiv')).toBe('drone')
  })

  it('classifies UAV as drone', () => {
    expect(classifyThreatType('UAV swarm detected over Red Sea convoy')).toBe('drone')
  })

  it('classifies Bayraktar as drone', () => {
    expect(classifyThreatType('Bayraktar TB2 drone films armor destruction')).toBe('drone')
  })

  // Rocket
  it('classifies Qassam as rocket', () => {
    expect(classifyThreatType('Qassam rocket barrage fired at Sderot')).toBe('rocket')
  })

  it('classifies Katyusha as rocket', () => {
    expect(classifyThreatType('Katyusha rocket salvo from southern Lebanon')).toBe('rocket')
  })

  it('classifies Grad as rocket', () => {
    expect(classifyThreatType('Grad rocket artillery hitting Kherson')).toBe('rocket')
  })

  // Unknown fallback
  it('returns unknown for unclassified military event', () => {
    expect(classifyThreatType('Troops advance on frontline near Avdiivka')).toBe('unknown')
  })

  it('returns unknown for empty string', () => {
    expect(classifyThreatType('')).toBe('unknown')
  })

  // Precedence — hypersonic wins over ballistic
  it('hypersonic wins over ballistic when both keywords present', () => {
    expect(classifyThreatType('DF-17 hypersonic ballistic glide vehicle')).toBe('hypersonic')
  })

  // Case-insensitive
  it('is case-insensitive', () => {
    expect(classifyThreatType('HYPERSONIC KINZHAL STRIKE')).toBe('hypersonic')
    expect(classifyThreatType('DRONE ATTACK ON KHARKIV')).toBe('drone')
    expect(classifyThreatType('ROCKET FIRE FROM GAZA')).toBe('rocket')
  })
})

// ─── parseThreatOrigin ─────────────────────────────────────────────────────────

describe('parseThreatOrigin', () => {
  it('detects Russia by "russia"', () => {
    expect(parseThreatOrigin('Russia fires Kalibr missiles at Odesa')).toBe('Russia')
  })

  it('detects Russia by "russian"', () => {
    expect(parseThreatOrigin('Russian air force strikes Zaporizhzhia')).toBe('Russia')
  })

  it('detects Russia by "kremlin"', () => {
    expect(parseThreatOrigin('Kremlin confirms missile launch')).toBe('Russia')
  })

  it('detects Iran by "iran"', () => {
    expect(parseThreatOrigin('Iran fires ballistic missiles at Israel')).toBe('Iran')
  })

  it('detects Iran by "irgc"', () => {
    expect(parseThreatOrigin('IRGC launches drones toward Persian Gulf targets')).toBe('Iran')
  })

  it('detects North Korea by "north korea"', () => {
    expect(parseThreatOrigin('North Korea fires ICBM into Japan EEZ')).toBe('North Korea')
  })

  it('detects North Korea by "dprk"', () => {
    expect(parseThreatOrigin('DPRK missile overflights Japan')).toBe('North Korea')
  })

  it('detects North Korea by "kim jong"', () => {
    expect(parseThreatOrigin('Kim Jong Un oversees missile test')).toBe('North Korea')
  })

  it('detects China by "china"', () => {
    expect(parseThreatOrigin('China launches DF-41 ICBM test')).toBe('China')
  })

  it('detects China by "pla"', () => {
    expect(parseThreatOrigin('PLA rocket force conducts live-fire exercise')).toBe('China')
  })

  it('detects Ukraine by "ukraine"', () => {
    expect(parseThreatOrigin('Ukraine fires Storm Shadow cruise missiles')).toBe('Ukraine')
  })

  it('detects Israel by "idf"', () => {
    expect(parseThreatOrigin('IDF strikes Beirut suburbs with precision munitions')).toBe('Israel')
  })

  it('detects Non-State Actor by "hamas"', () => {
    expect(parseThreatOrigin('Hamas fires rockets at Tel Aviv')).toBe('Non-State Actor')
  })

  it('detects Non-State Actor by "hezbollah"', () => {
    expect(parseThreatOrigin('Hezbollah launches anti-tank missile at IDF vehicle')).toBe('Non-State Actor')
  })

  it('detects Non-State Actor by "houthi"', () => {
    expect(parseThreatOrigin('Houthi drone targets Israeli cargo ship')).toBe('Non-State Actor')
  })

  it('returns null when no known actor is found', () => {
    expect(parseThreatOrigin('Missile strike on unidentified compound')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseThreatOrigin('')).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(parseThreatOrigin('RUSSIAN MILITARY STRIKES UKRAINE')).toBe('Russia')
    expect(parseThreatOrigin('IRAN LAUNCHES DRONES')).toBe('Iran')
  })
})

// ─── buildSeverityDistribution ────────────────────────────────────────────────

describe('buildSeverityDistribution', () => {
  it('counts each severity level correctly', () => {
    const dist = buildSeverityDistribution(['critical', 'high', 'high', 'medium', 'low', 'low', 'low'])
    expect(dist.critical).toBe(1)
    expect(dist.high).toBe(2)
    expect(dist.medium).toBe(1)
    expect(dist.low).toBe(3)
    expect(dist.unknown).toBe(0)
  })

  it('returns all zeros for empty array', () => {
    const dist = buildSeverityDistribution([])
    expect(dist.critical).toBe(0)
    expect(dist.high).toBe(0)
    expect(dist.medium).toBe(0)
    expect(dist.low).toBe(0)
    expect(dist.unknown).toBe(0)
  })

  it('counts unrecognised values as unknown', () => {
    const dist = buildSeverityDistribution(['elevated', 'SEVERE', 'low'])
    expect(dist.unknown).toBe(2)
    expect(dist.low).toBe(1)
  })

  it('is case-insensitive', () => {
    const dist = buildSeverityDistribution(['CRITICAL', 'HIGH', 'MEDIUM'])
    expect(dist.critical).toBe(1)
    expect(dist.high).toBe(1)
    expect(dist.medium).toBe(1)
  })
})

// ─── buildThreatTypeBreakdown ─────────────────────────────────────────────────

describe('buildThreatTypeBreakdown', () => {
  it('counts each threat type correctly', () => {
    const bd = buildThreatTypeBreakdown(['drone', 'drone', 'ballistic', 'hypersonic', 'rocket', 'cruise', 'unknown'])
    expect(bd.drone).toBe(2)
    expect(bd.ballistic).toBe(1)
    expect(bd.hypersonic).toBe(1)
    expect(bd.rocket).toBe(1)
    expect(bd.cruise).toBe(1)
    expect(bd.unknown).toBe(1)
  })

  it('returns all zeros for empty array', () => {
    const bd = buildThreatTypeBreakdown([])
    expect(bd.drone).toBe(0)
    expect(bd.ballistic).toBe(0)
    expect(bd.hypersonic).toBe(0)
    expect(bd.cruise).toBe(0)
    expect(bd.rocket).toBe(0)
    expect(bd.unknown).toBe(0)
  })
})

// ─── deriveTrendDirection ─────────────────────────────────────────────────────

describe('deriveTrendDirection', () => {
  it('returns stable when count48h is 0', () => {
    expect(deriveTrendDirection(0, 0)).toBe('stable')
  })

  it('returns escalating when 6h rate > 2× hourly average', () => {
    // 48h count = 24, hourly avg = 0.5; 6h count = 10, rate = 1.67 > 1.0
    expect(deriveTrendDirection(24, 10)).toBe('escalating')
  })

  it('returns de-escalating when 6h rate < 0.5× hourly average and < 1/8 of 48h', () => {
    // 48h count = 96, hourly avg = 2; 6h count = 2, rate = 0.33 < 1.0; 2 < 96/8=12
    expect(deriveTrendDirection(96, 2)).toBe('de-escalating')
  })

  it('returns stable for normal proportional activity', () => {
    // 48h count = 48, hourly avg = 1; 6h count = 6, rate = 1 = avg
    expect(deriveTrendDirection(48, 6)).toBe('stable')
  })
})

// ─── buildActiveDigest ────────────────────────────────────────────────────────

describe('buildActiveDigest', () => {
  it('returns no-threat message when total_threats_48h is 0', () => {
    const digest = buildActiveDigest({
      total_threats_48h: 0,
      total_threats_6h:  0,
      trend_direction:   'stable',
      threat_type_breakdown: { hypersonic: 0, ballistic: 0, cruise: 0, drone: 0, rocket: 0, unknown: 0 },
      top_origin_countries: [],
    })
    expect(digest).toContain('No threat signals detected')
  })

  it('includes dominant type label and origin country in digest', () => {
    const digest = buildActiveDigest({
      total_threats_48h: 30,
      total_threats_6h:  8,
      trend_direction:   'escalating',
      threat_type_breakdown: { hypersonic: 0, ballistic: 2, cruise: 3, drone: 20, rocket: 5, unknown: 0 },
      top_origin_countries: [{ country: 'Iran', count: 15 }],
    })
    expect(digest).toContain('drone')
    expect(digest).toContain('Iran')
    expect(digest).toContain('escalating')
  })

  it('handles missing origin gracefully', () => {
    const digest = buildActiveDigest({
      total_threats_48h: 10,
      total_threats_6h:  2,
      trend_direction:   'stable',
      threat_type_breakdown: { hypersonic: 0, ballistic: 0, cruise: 0, drone: 0, rocket: 10, unknown: 0 },
      top_origin_countries: [],
    })
    expect(digest).toContain('rocket')
    expect(digest).not.toContain('attributed to')
  })

  it('includes de-escalating language when trend is de-escalating', () => {
    const digest = buildActiveDigest({
      total_threats_48h: 50,
      total_threats_6h:  1,
      trend_direction:   'de-escalating',
      threat_type_breakdown: { hypersonic: 0, ballistic: 0, cruise: 0, drone: 50, rocket: 0, unknown: 0 },
      top_origin_countries: [],
    })
    expect(digest).toContain('de-escalating')
  })
})
