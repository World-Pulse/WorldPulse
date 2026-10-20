/**
 * The embedded story card's data, read by the website's server (plan G20).
 * Kept two minutes in this process (lib/server-fetch.ts): a card on a busy
 * page is viewed over and over, and every view of every card comes from this
 * one server, which shares one rate-limit budget with the rest of the site.
 */

import { cachedFetch } from '@/lib/server-fetch'
import { cardFromStory, isStoryId, type StoryAnswer, type StoryCardResult } from '@/lib/embed-card'

const API_BASE = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
export const CARD_KEEP_MS = 120_000

/** The card for report (or story) `id`; 'missing' when there is no such story, 'unavailable' when the API didn't answer */
export async function fetchStoryCard(id: string): Promise<StoryCardResult> {
  if (!isStoryId(id)) return 'missing'
  try {
    const res = await cachedFetch(`${API_BASE}/api/v1/stories/${id}`, CARD_KEEP_MS)
    if (res.status === 404 || res.status === 400) return 'missing'
    if (!res.ok) return 'unavailable'
    const json = await res.json() as { success?: boolean; data?: StoryAnswer }
    if (!json.success || !json.data) return 'missing'
    return cardFromStory(id, json.data) ?? 'missing'
  } catch {
    return 'unavailable'
  }
}
