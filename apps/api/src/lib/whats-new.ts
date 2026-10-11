/**
 * "New on WorldPulse": what the team shipped that readers can use, for the
 * email briefing (plan G4). Devon wants subscribers to stay in the loop on
 * what's coming out. Each reader sees an item once: in the first briefing
 * sent after its date (up to three, newest first).
 *
 * Shifts that ship something a reader would notice add a line here: the date
 * it went live (UTC), one plain sentence, and where to see it.
 */

export interface WhatsNewItem {
  /** When it went live (YYYY-MM-DD, UTC) */
  date: string
  text: string
  /** A path on world-pulse.io */
  path: string
}

export const WHATS_NEW: WhatsNewItem[] = [
  { date: '2026-10-11', text: 'Every story link now shows its own picture with how many outlets confirm it, so a story shared on X or LinkedIn says how much to trust it.', path: '/' },
  { date: '2026-10-11', text: 'The WorldPulse news box for other websites works again: paste one line and your readers see verified stories.', path: '/developer/embed' },
  { date: '2026-10-11', text: 'Signing in now brings you back to the story or page you were on.', path: '/map' },
]

/** The items newer than `since` (all of the last week when null), newest first */
export function whatsNewSince(since: Date | null, now = new Date(), max = 3): WhatsNewItem[] {
  const floor = since ?? new Date(now.getTime() - 7 * 86_400_000)
  return WHATS_NEW
    .filter(i => {
      const t = Date.parse(`${i.date}T23:59:59Z`)
      return !Number.isNaN(t) && t > floor.getTime() && Date.parse(`${i.date}T00:00:00Z`) <= now.getTime()
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, max)
}
