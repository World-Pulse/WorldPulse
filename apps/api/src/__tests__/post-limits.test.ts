/**
 * What stops a flood of posts and communities (plan C6, Oct 21, 2026): until
 * now an account could post 10 times a minute, all day, the same text with
 * any number of links, and create communities without any limit.
 */
import { describe, it, expect } from 'vitest'
import {
  linksIn, postLimitProblem, communityLimitProblem, hoursSince,
  POSTS_A_DAY, NEW_ACCOUNT_POSTS_A_DAY, LINKS_A_POST, NEW_ACCOUNT_LINKS_A_POST, COMMUNITIES_A_DAY,
} from '../lib/post-limits'

const settled = { accountAgeHours: 500, postsToday: 0, sameTextLastHour: 0, links: 0 }
const fresh = { ...settled, accountAgeHours: 2 }

describe('links in a post', () => {
  it('web addresses with or without http, each once', () => {
    expect(linksIn('Read https://example.com/a and http://news.example.org/b, or www.site.com/c.')).toBe(3)
    expect(linksIn('Same link twice: https://example.com/a https://example.com/a')).toBe(1)
    expect(linksIn('No links here, just e.g. and U.S. words')).toBe(0)
  })
})

describe('posts', () => {
  it('an ordinary post goes out', () => {
    expect(postLimitProblem({ ...settled, postsToday: 40, links: 1 })).toBeNull()
    expect(postLimitProblem({ ...fresh, postsToday: 3, links: 1 })).toBeNull()
  })
  it(`${POSTS_A_DAY} a day; ${NEW_ACCOUNT_POSTS_A_DAY} in an account's first day`, () => {
    expect(postLimitProblem({ ...settled, postsToday: POSTS_A_DAY })).toMatch(/200 posts in a day/)
    expect(postLimitProblem({ ...fresh, postsToday: NEW_ACCOUNT_POSTS_A_DAY })).toMatch(/first day/)
    expect(postLimitProblem({ ...settled, postsToday: NEW_ACCOUNT_POSTS_A_DAY })).toBeNull()
  })
  it('the same text at most twice an hour', () => {
    expect(postLimitProblem({ ...settled, sameTextLastHour: 1 })).toBeNull()
    expect(postLimitProblem({ ...settled, sameTextLastHour: 2 })).toMatch(/same text twice/)
  })
  it(`${LINKS_A_POST} links in a post; ${NEW_ACCOUNT_LINKS_A_POST} in an account's first day`, () => {
    expect(postLimitProblem({ ...settled, links: LINKS_A_POST })).toBeNull()
    expect(postLimitProblem({ ...settled, links: LINKS_A_POST + 1 })).toMatch(/5 links at most/)
    expect(postLimitProblem({ ...fresh, links: NEW_ACCOUNT_LINKS_A_POST + 1 })).toMatch(/first day/)
  })
})

describe('communities', () => {
  it(`${COMMUNITIES_A_DAY} a day; one in an account's first week`, () => {
    expect(communityLimitProblem({ accountAgeHours: 500, createdToday: 2, createdTotal: 6 })).toBeNull()
    expect(communityLimitProblem({ accountAgeHours: 500, createdToday: 3, createdTotal: 6 })).toMatch(/3 new communities today/)
    expect(communityLimitProblem({ accountAgeHours: 30, createdToday: 0, createdTotal: 0 })).toBeNull()
    expect(communityLimitProblem({ accountAgeHours: 30, createdToday: 1, createdTotal: 1 })).toMatch(/first week/)
  })
})

describe('an account\'s age', () => {
  it('from its created_at; an unknown one never counts as new', () => {
    const now = Date.parse('2026-10-21T18:00:00Z')
    expect(hoursSince('2026-10-21T12:00:00Z', now)).toBe(6)
    expect(hoursSince(new Date('2026-10-20T18:00:00Z'), now)).toBe(24)
    expect(hoursSince(null, now)).toBeGreaterThan(24 * 365)
  })
})
