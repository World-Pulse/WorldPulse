/**
 * Following a person, place or organisation (plan K6; Devon, Oct 21, 2026:
 * alerts "Free for everyone"): the alert the Follow button makes. Its name
 * is how the button finds it again; the API matches the keyword as a whole
 * word or phrase and, with digest "daily", sends one email a day.
 */

/** The alert's name: "Follow: NATO" (the API allows 100 characters) */
export function followAlertName(name: string): string {
  return `Follow: ${name.trim()}`.slice(0, 100)
}

/** POST /api/v1/alerts's body for following `name` */
export function followAlertBody(name: string) {
  return {
    name: followAlertName(name),
    keywords: [name.trim().slice(0, 100)],
    // every report naming it, however minor: the digest sorts the most serious first
    minSeverity: 'low' as const,
    channels: { email: true, push: false, in_app: true, digest: 'daily' as const },
  }
}
