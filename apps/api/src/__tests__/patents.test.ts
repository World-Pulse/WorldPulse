import { describe, it, expect } from 'vitest'

// ─── CPC_LABELS ──────────────────────────────────────────────────────────────

const CPC_LABELS: Record<string, string> = {
  'F41':    'Weapons',
  'F42':    'Ammunition & Explosives',
  'B64C30': 'Military Aircraft',
  'B64G':   'Space Technology',
  'B63G':   'Naval Weapons',
  'F42B15': 'Missiles & Projectiles',
  'G01S':   'Radar / Sonar',
  'G21':    'Nuclear Engineering',
  'G21J':   'Nuclear Explosives',
  'H04K':   'EW / Jamming',
  'H04L9':  'Cryptography',
  'B64U':   'UAVs / Drones',
  'H01S':   'Directed Energy / Lasers',
  'G01V':   'Surveillance Sensors',
  'H04N7':  'Surveillance Cameras',
}

// ─── SEV_RANK + maxSeverity ──────────────────────────────────────────────────

const SEV_RANK: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1, info: 0,
}

function maxSeverity(a: string, b: string): string {
  return (SEV_RANK[a] ?? 0) >= (SEV_RANK[b] ?? 0) ? a : b
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CPC_LABELS', () => {
  it('contains 15 defense/dual-use CPC groups', () => {
    expect(Object.keys(CPC_LABELS)).toHaveLength(15)
  })

  it('includes weapons CPC codes', () => {
    expect(CPC_LABELS['F41']).toBe('Weapons')
    expect(CPC_LABELS['F42']).toBe('Ammunition & Explosives')
  })

  it('includes nuclear CPC codes', () => {
    expect(CPC_LABELS['G21']).toBe('Nuclear Engineering')
    expect(CPC_LABELS['G21J']).toBe('Nuclear Explosives')
  })

  it('includes aerospace CPC codes', () => {
    expect(CPC_LABELS['B64C30']).toBe('Military Aircraft')
    expect(CPC_LABELS['B64G']).toBe('Space Technology')
    expect(CPC_LABELS['B64U']).toBe('UAVs / Drones')
  })

  it('includes cyber/EW CPC codes', () => {
    expect(CPC_LABELS['H04K']).toBe('EW / Jamming')
    expect(CPC_LABELS['H04L9']).toBe('Cryptography')
  })

  it('includes surveillance CPC codes', () => {
    expect(CPC_LABELS['G01V']).toBe('Surveillance Sensors')
    expect(CPC_LABELS['H04N7']).toBe('Surveillance Cameras')
  })

  it('includes radar/sonar CPC code', () => {
    expect(CPC_LABELS['G01S']).toBe('Radar / Sonar')
  })

  it('includes directed energy CPC code', () => {
    expect(CPC_LABELS['H01S']).toBe('Directed Energy / Lasers')
  })

  it('includes naval weapons CPC code', () => {
    expect(CPC_LABELS['B63G']).toBe('Naval Weapons')
  })

  it('includes missiles CPC code', () => {
    expect(CPC_LABELS['F42B15']).toBe('Missiles & Projectiles')
  })
})

describe('maxSeverity', () => {
  it('returns critical when compared with any severity', () => {
    expect(maxSeverity('critical', 'high')).toBe('critical')
    expect(maxSeverity('critical', 'low')).toBe('critical')
    expect(maxSeverity('critical', 'info')).toBe('critical')
  })

  it('returns high over medium/low/info', () => {
    expect(maxSeverity('high', 'medium')).toBe('high')
    expect(maxSeverity('high', 'low')).toBe('high')
    expect(maxSeverity('high', 'info')).toBe('high')
  })

  it('returns medium over low/info', () => {
    expect(maxSeverity('medium', 'low')).toBe('medium')
    expect(maxSeverity('medium', 'info')).toBe('medium')
  })

  it('returns low over info', () => {
    expect(maxSeverity('low', 'info')).toBe('low')
  })

  it('is symmetric for equal severity', () => {
    expect(maxSeverity('high', 'high')).toBe('high')
    expect(maxSeverity('critical', 'critical')).toBe('critical')
  })

  it('returns first arg for unknown severity', () => {
    expect(maxSeverity('unknown', 'unknown')).toBe('unknown')
  })

  it('returns known severity over unknown', () => {
    expect(maxSeverity('low', 'unknown')).toBe('low')
  })

  it('handles reversed argument order', () => {
    expect(maxSeverity('low', 'critical')).toBe('critical')
    expect(maxSeverity('info', 'high')).toBe('high')
    expect(maxSeverity('medium', 'high')).toBe('high')
  })
})

describe('SEV_RANK', () => {
  it('has correct rank ordering', () => {
    expect(SEV_RANK.critical).toBeGreaterThan(SEV_RANK.high)
    expect(SEV_RANK.high).toBeGreaterThan(SEV_RANK.medium)
    expect(SEV_RANK.medium).toBeGreaterThan(SEV_RANK.low)
    expect(SEV_RANK.low).toBeGreaterThan(SEV_RANK.info)
  })

  it('critical is 4', () => {
    expect(SEV_RANK.critical).toBe(4)
  })

  it('info is 0', () => {
    expect(SEV_RANK.info).toBe(0)
  })
})

describe('Cache TTL constants', () => {
  const PATENTS_CACHE_TTL = 300
  const TIMELINE_CACHE_TTL = 600

  it('PATENTS_CACHE_TTL is 5 minutes', () => {
    expect(PATENTS_CACHE_TTL).toBe(300)
  })

  it('TIMELINE_CACHE_TTL is 10 minutes', () => {
    expect(TIMELINE_CACHE_TTL).toBe(600)
  })
})

describe('Window parsing', () => {
  function parseWindowHours(window: string): number {
    return window === '7d' ? 168
      : window === '14d' ? 336
      : window === '90d' ? 2160
      : 720
  }

  it('parses 7d to 168 hours', () => {
    expect(parseWindowHours('7d')).toBe(168)
  })

  it('parses 14d to 336 hours', () => {
    expect(parseWindowHours('14d')).toBe(336)
  })

  it('parses 30d to 720 hours (default)', () => {
    expect(parseWindowHours('30d')).toBe(720)
  })

  it('parses 90d to 2160 hours', () => {
    expect(parseWindowHours('90d')).toBe(2160)
  })

  it('defaults unknown window to 720 (30d)', () => {
    expect(parseWindowHours('1y')).toBe(720)
    expect(parseWindowHours('unknown')).toBe(720)
  })
})

describe('Assignee extraction regex', () => {
  function extractAssignee(title: string): string | null {
    const match = title.match(/^([A-Z][A-Za-z &.-]+?)(?:\s*[:\u2014\u2013-]\s)/)
      ?? title.match(/(?:by|from|assigned to)\s+([A-Z][A-Za-z &.-]+)/i)
    return match?.[1]?.trim() ?? null
  }

  it('extracts assignee from "Company: Title" format', () => {
    expect(extractAssignee('Lockheed Martin: Advanced Radar System')).toBe('Lockheed Martin')
  })

  it('extracts assignee from "by Company" format', () => {
    expect(extractAssignee('New drone patent filed by Boeing Corp.')).toBe('Boeing Corp.')
  })

  it('extracts assignee from "assigned to" format', () => {
    expect(extractAssignee('Patent assigned to Raytheon Technologies')).toBe('Raytheon Technologies')
  })

  it('returns null for titles without identifiable assignee', () => {
    expect(extractAssignee('Novel approach to radar jamming using ML')).toBeNull()
  })

  it('extracts assignee with dash separator', () => {
    expect(extractAssignee('BAE Systems - Next Generation EW Suite')).toBe('BAE Systems')
  })
})
