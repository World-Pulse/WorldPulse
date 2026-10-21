/**
 * What stops a flood of posts and communities (plan C6, Oct 21, 2026; from
 * the moderation check of Oct 17, which found nothing for either). Until now
 * an account could post 10 times a minute, all day, the same text with any
 * number of links, and create communities without any limit.
 *
 * Every account: 200 posts a day, 5 links in a post, and the same text at
 * most twice an hour; 3 new communities a day. In an account's first day:
 * 20 posts and 2 links in a post; in its first week, one community. Counts
 * come from the posts and communities tables (no new table). A check that
 * can't read the database lets the post through: a spam limit never stops
 * the site.
 */

export const POSTS_A_DAY = 200
export const LINKS_A_POST = 5
export const SAME_TEXT_AN_HOUR = 2
export const NEW_ACCOUNT_HOURS = 24
export const NEW_ACCOUNT_POSTS_A_DAY = 20
export const NEW_ACCOUNT_LINKS_A_POST = 2
export const COMMUNITIES_A_DAY = 3
export const NEW_ACCOUNT_DAYS_FOR_COMMUNITIES = 7
export const NEW_ACCOUNT_COMMUNITIES = 1

/** Links in a post's text: web addresses, with or without http(s)://, counted once each */
export function linksIn(text: string): number {
  const found = text.match(/\bhttps?:\/\/[^\s<>"']+|\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>"']*/gi) ?? []
  return new Set(found.map(l => l.toLowerCase().replace(/^https?:\/\//, '').replace(/[.,;:!?)]+$/, ''))).size
}

export interface PostCounts {
  /** How old the account is */
  accountAgeHours: number
  /** Its posts in the last 24 hours */
  postsToday: number
  /** Its posts with this exact text in the last hour */
  sameTextLastHour: number
  /** Links in the new post (its text and its source link) */
  links: number
}

/** Why a post can't go out now, in words for the poster; null when it can */
export function postLimitProblem(c: PostCounts): string | null {
  const isNew = c.accountAgeHours < NEW_ACCOUNT_HOURS
  const dayCap = isNew ? NEW_ACCOUNT_POSTS_A_DAY : POSTS_A_DAY
  if (c.postsToday >= dayCap) {
    return isNew
      ? `New accounts can post ${NEW_ACCOUNT_POSTS_A_DAY} times in their first day. Try again tomorrow.`
      : `That's ${POSTS_A_DAY} posts in a day, the most there can be. Try again tomorrow.`
  }
  if (c.sameTextLastHour >= SAME_TEXT_AN_HOUR) return 'You posted this same text twice in the last hour.'
  const linkCap = isNew ? NEW_ACCOUNT_LINKS_A_POST : LINKS_A_POST
  if (c.links > linkCap) {
    return isNew
      ? `In their first day, accounts can share ${NEW_ACCOUNT_LINKS_A_POST} links in a post.`
      : `A post can have ${LINKS_A_POST} links at most.`
  }
  return null
}

export interface CommunityCounts {
  accountAgeHours: number
  /** Communities it created in the last 24 hours */
  createdToday: number
  /** Communities it created in all */
  createdTotal: number
}

/** Why a community can't be created now; null when it can */
export function communityLimitProblem(c: CommunityCounts): string | null {
  if (c.accountAgeHours < NEW_ACCOUNT_DAYS_FOR_COMMUNITIES * 24 && c.createdTotal >= NEW_ACCOUNT_COMMUNITIES) {
    return `In its first week, an account can create ${NEW_ACCOUNT_COMMUNITIES} community.`
  }
  if (c.createdToday >= COMMUNITIES_A_DAY) return `That's ${COMMUNITIES_A_DAY} new communities today, the most there can be. Try again tomorrow.`
  return null
}

/** Hours since a time (an account's created_at); a very large number when unknown, so an unknown age never counts as new */
export function hoursSince(at: unknown, now = Date.now()): number {
  const t = at instanceof Date ? at.getTime() : typeof at === 'string' ? Date.parse(at) : NaN
  return Number.isFinite(t) ? Math.max(0, (now - t) / 3_600_000) : Number.MAX_SAFE_INTEGER
}
