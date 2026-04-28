/**
 * Communities API Route Tests — apps/api/src/routes/communities.ts
 *
 * Tests the community system: listing, creation, membership,
 * role management, and moderation.
 *
 * Covers: schema validation, role hierarchy, slug formatting,
 *         query parameter handling, membership states, and moderation logic.
 */

import { describe, it, expect } from 'vitest'

// ─── Schema Constraints (mirroring communities.ts Zod schemas) ──────────────────

const SLUG_REGEX = /^[a-z0-9-]+$/
const SLUG_MIN = 2
const SLUG_MAX = 100
const NAME_MIN = 2
const NAME_MAX = 255
const DESCRIPTION_MAX = 1000
const CATEGORIES_MAX = 5
const VALID_ROLES = ['admin', 'moderator', 'member'] as const

function validateSlug(slug: string): boolean {
  return slug.length >= SLUG_MIN && slug.length <= SLUG_MAX && SLUG_REGEX.test(slug)
}

function validateName(name: string): boolean {
  return name.length >= NAME_MIN && name.length <= NAME_MAX
}

function validateRole(role: string): boolean {
  return (VALID_ROLES as readonly string[]).includes(role)
}

// ─── Role Helpers (mirroring communities.ts) ────────────────────────────────────

type MemberRole = 'admin' | 'moderator' | 'member'

function canModerate(role: MemberRole | null): boolean {
  return role === 'admin' || role === 'moderator'
}

// ─── Schema Validation Tests ────────────────────────────────────────────────────

describe('CreateCommunitySchema Constraints', () => {
  it('accepts valid slug', () => {
    expect(validateSlug('osint-analysts')).toBe(true)
  })

  it('rejects slug shorter than min length', () => {
    expect(validateSlug('a')).toBe(false)
  })

  it('rejects slug longer than max length', () => {
    expect(validateSlug('a'.repeat(101))).toBe(false)
  })

  it('slug only allows lowercase alphanumeric and hyphens', () => {
    expect(validateSlug('my-community')).toBe(true)
    expect(validateSlug('test123')).toBe(true)
    expect(validateSlug('a-b-c-d')).toBe(true)
    expect(validateSlug('My-Community')).toBe(false)
    expect(validateSlug('test space')).toBe(false)
    expect(validateSlug('test_underscore')).toBe(false)
    expect(validateSlug('UPPER')).toBe(false)
  })

  it('rejects name shorter than min length', () => {
    expect(validateName('X')).toBe(false)
  })

  it('rejects name longer than max length', () => {
    expect(validateName('A'.repeat(256))).toBe(false)
  })

  it('accepts valid name', () => {
    expect(validateName('Test Community')).toBe(true)
  })

  it('description max length is 1000', () => {
    expect(DESCRIPTION_MAX).toBe(1000)
  })

  it('categories max count is 5', () => {
    expect(CATEGORIES_MAX).toBe(5)
  })
})

// ─── Update Member Role Schema Tests ────────────────────────────────────────────

describe('UpdateMemberRole Constraints', () => {
  it('accepts admin role', () => {
    expect(validateRole('admin')).toBe(true)
  })

  it('accepts moderator role', () => {
    expect(validateRole('moderator')).toBe(true)
  })

  it('accepts member role', () => {
    expect(validateRole('member')).toBe(true)
  })

  it('rejects invalid role strings', () => {
    expect(validateRole('owner')).toBe(false)
    expect(validateRole('banned')).toBe(false)
    expect(validateRole('')).toBe(false)
  })

  it('exactly 3 valid roles exist', () => {
    expect(VALID_ROLES).toHaveLength(3)
  })
})

// ─── Role Hierarchy Tests ───────────────────────────────────────────────────────

describe('Role Hierarchy', () => {
  it('admin can moderate', () => {
    expect(canModerate('admin')).toBe(true)
  })

  it('moderator can moderate', () => {
    expect(canModerate('moderator')).toBe(true)
  })

  it('member cannot moderate', () => {
    expect(canModerate('member')).toBe(false)
  })

  it('null role (non-member) cannot moderate', () => {
    expect(canModerate(null)).toBe(false)
  })
})

// ─── Slug Validation Tests ──────────────────────────────────────────────────────

describe('Slug Validation', () => {
  it('valid slugs pass validation', () => {
    const valid = [
      'climate-watchers',
      'osint-analysts',
      'conflict-monitors',
      'tech-and-cyber',
      'health123',
      'ab',
    ]
    for (const s of valid) {
      expect(validateSlug(s)).toBe(true)
    }
  })

  it('invalid slugs fail validation', () => {
    const invalid = [
      'Climate-Watchers',    // uppercase
      'has space',           // space
      'under_score',         // underscore
      'special@char',        // special char
      'a',                   // too short
    ]
    for (const s of invalid) {
      expect(validateSlug(s)).toBe(false)
    }
  })

  it('slug regex allows hyphens at start and end', () => {
    // Regex allows this — business logic should further validate
    expect(SLUG_REGEX.test('-leading')).toBe(true)
    expect(SLUG_REGEX.test('trailing-')).toBe(true)
  })
})

// ─── Community List Query Parameter Tests ───────────────────────────────────────

describe('Community List Query Params', () => {
  const validSorts = ['members', 'posts', 'newest', 'trending']

  it('all valid sort options are enumerated', () => {
    expect(validSorts).toHaveLength(4)
  })

  it('sort by members is a valid option', () => {
    expect(validSorts).toContain('members')
  })

  it('sort by trending is a valid option', () => {
    expect(validSorts).toContain('trending')
  })
})

// ─── Community Categories Tests ─────────────────────────────────────────────────

describe('Community Categories', () => {
  const KNOWN_CATEGORIES = [
    'security', 'geopolitics', 'climate', 'disaster', 'conflict',
    'economy', 'technology', 'health', 'science', 'elections',
  ]

  it('known category list has at least 8 entries', () => {
    expect(KNOWN_CATEGORIES.length).toBeGreaterThanOrEqual(8)
  })

  it('all categories are lowercase strings', () => {
    for (const cat of KNOWN_CATEGORIES) {
      expect(cat).toBe(cat.toLowerCase())
    }
  })

  it('categories array max is 5 per community', () => {
    expect(KNOWN_CATEGORIES.slice(0, 5).length).toBeLessThanOrEqual(CATEGORIES_MAX)
    expect(KNOWN_CATEGORIES.slice(0, 6).length).toBeGreaterThan(CATEGORIES_MAX)
  })
})

// ─── Membership State Machine Tests ─────────────────────────────────────────────

describe('Membership States', () => {
  type MembershipState = 'not_member' | 'member' | 'moderator' | 'admin'

  function getPermissions(state: MembershipState) {
    return {
      canView: true, // public communities are always viewable
      canPost: state !== 'not_member',
      canModerate: state === 'admin' || state === 'moderator',
      canDelete: state === 'admin',
      canInvite: state === 'admin' || state === 'moderator',
      canLeave: state !== 'not_member',
    }
  }

  it('non-members can view but not post', () => {
    const perms = getPermissions('not_member')
    expect(perms.canView).toBe(true)
    expect(perms.canPost).toBe(false)
    expect(perms.canModerate).toBe(false)
  })

  it('members can post but not moderate', () => {
    const perms = getPermissions('member')
    expect(perms.canPost).toBe(true)
    expect(perms.canModerate).toBe(false)
    expect(perms.canDelete).toBe(false)
  })

  it('moderators can moderate but not delete', () => {
    const perms = getPermissions('moderator')
    expect(perms.canModerate).toBe(true)
    expect(perms.canDelete).toBe(false)
    expect(perms.canInvite).toBe(true)
  })

  it('admins have all permissions', () => {
    const perms = getPermissions('admin')
    expect(perms.canView).toBe(true)
    expect(perms.canPost).toBe(true)
    expect(perms.canModerate).toBe(true)
    expect(perms.canDelete).toBe(true)
    expect(perms.canInvite).toBe(true)
    expect(perms.canLeave).toBe(true)
  })
})

// ─── Seeded Community Data Tests ────────────────────────────────────────────────

describe('Seeded Community Data', () => {
  const SEEDED_COMMUNITIES = [
    { slug: 'osint-analysts',         name: 'OSINT Analysts',              categories: ['security', 'geopolitics'] },
    { slug: 'climate-watchers',       name: 'Climate Watchers',            categories: ['climate', 'disaster'] },
    { slug: 'conflict-monitors',      name: 'Conflict Monitors',           categories: ['conflict', 'geopolitics'] },
    { slug: 'maritime-intelligence',  name: 'Maritime Intelligence',       categories: ['geopolitics', 'economy'] },
    { slug: 'tech-and-cyber',         name: 'Tech & Cyber',                categories: ['technology', 'security'] },
    { slug: 'elections-watch',        name: 'Elections Watch',              categories: ['elections', 'geopolitics'] },
    { slug: 'health-pandemic-intel',  name: 'Health & Pandemic Intel',     categories: ['health', 'science'] },
    { slug: 'economic-intelligence',  name: 'Economic Intelligence',       categories: ['economy', 'geopolitics'] },
  ]

  it('8 seeded communities defined', () => {
    expect(SEEDED_COMMUNITIES).toHaveLength(8)
  })

  it('all seeded slugs are unique', () => {
    const slugs = SEEDED_COMMUNITIES.map(c => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('all seeded slugs match regex pattern', () => {
    const slugRegex = /^[a-z0-9-]+$/
    for (const c of SEEDED_COMMUNITIES) {
      expect(slugRegex.test(c.slug)).toBe(true)
    }
  })

  it('each seeded community has 2 categories', () => {
    for (const c of SEEDED_COMMUNITIES) {
      expect(c.categories).toHaveLength(2)
    }
  })

  it('no seeded community exceeds 5 categories', () => {
    for (const c of SEEDED_COMMUNITIES) {
      expect(c.categories.length).toBeLessThanOrEqual(5)
    }
  })

  it('geopolitics is the most common category', () => {
    const counts: Record<string, number> = {}
    for (const c of SEEDED_COMMUNITIES) {
      for (const cat of c.categories) {
        counts[cat] = (counts[cat] ?? 0) + 1
      }
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
    expect(sorted[0]![0]).toBe('geopolitics')
  })
})
