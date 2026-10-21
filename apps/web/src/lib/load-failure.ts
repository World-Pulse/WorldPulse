/**
 * When a list of stories can't be loaded, say so (plan D2, "An outage
 * shouldn't look like missing stories", Oct 21, 2026). The home feed and the
 * map showed their empty states when the API didn't answer: "No signals yet:
 * the scraper is collecting…" and "No signals match these filters" with a
 * button to reset filters that weren't the reason. Story pages already
 * answer an outage with "This story is briefly unavailable" (1be54f1).
 */

export type LoadFailure = 'down' | 'busy'

/**
 * Why a list didn't load, from the answer's status (none: no answer at all).
 * Null when it isn't an outage: signed out, or the sign-in ended (401, 403),
 * where a tab's own empty state says what to do.
 */
export function loadFailure(status?: number | null): LoadFailure | null {
  if (status === 401 || status === 403) return null
  if (status === 429) return 'busy'
  return 'down'
}

export const LOAD_FAILURE_TEXT: Record<LoadFailure, { headline: string; message: string }> = {
  down: {
    headline: 'The stories couldn’t be loaded',
    message: 'WorldPulse’s server didn’t answer just now. The stories are still there: try again in a minute.',
  },
  busy: {
    headline: 'Too many requests just now',
    message: 'Your connection asked for more than WorldPulse answers in a minute. Try again in a minute.',
  },
}
