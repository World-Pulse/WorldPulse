/**
 * A story's outlet count covers its last two days (Devon, Oct 20, 2026,
 * option 1). A new report joins a story when it matches any of its reports,
 * so a story can run on for days: Oct 20's biggest, "Death toll from Houthi
 * attack on Yemen training camp rises to 73 · 143 outlets", went back to the
 * Riyadh airport attack of Oct 10, and 5 of that day's top 20 spanned more
 * than two days. So the number shown with a story counts the websites that
 * reported it in the STORY_COUNT_HOURS up to its newest report; its whole
 * life's count is given beside it (outletCountAll, outletsAll) for "· 143
 * since Oct 10". A finished week's page counts the week's own reports, as
 * before (GET /stories/week).
 */
export const STORY_COUNT_HOURS = 48

/** SQL: `createdAt` is inside the counted window of a story whose newest report is `newest` */
export function inCountedWindow(createdAt: string, newest: string): string {
  return `${createdAt} >= ${newest} - INTERVAL '${STORY_COUNT_HOURS} hours'`
}
