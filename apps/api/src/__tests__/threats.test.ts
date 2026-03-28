/**
 * Threats Intelligence API — Unit Tests
 *
 * Tests for classifyThreatType, parseThreatOrigin, constants, and type
 * exports from apps/api/src/routes/threats.ts
 */

import { describe, it, expect } from 'vitest'
import {
  classifyThreatType,
  parseThreatOrigin,
  THREATS_CACHE_TTL,
  THREATS_RATE_LIMIT,
  THREATS_CACHE_KEY,
} from '../routes/threats'

// ─── Constants ─────────────────────────────────────────────────────────────────

describe('threats constants', () => {
  it('THREATS_CACHE_TTL is 180 seconds (3 minutes)', () => {
    expect(THREATS_CACHE_TTL).toBe(180)
  })

  it('THREATS_RATE_LIMIT is 30 rpm', () => {
    expect(THREATS_RATE_LIMIT).toBe(30)
  })

  it('THREATS_CACHE_KEY is threats:missiles', () => {
    expect(THREATS_CACHE_KEY).toBe('threats:missiles')
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
