/**
 * The categories a signal can have: the database's own list (the `category`
 * enum), read once per process (plan 0o and V3f, Oct 20, 2026).
 *
 * Three lists disagreed: the database's, the RSS routes' (17 names, 10 of
 * which no signal ever has, while 9 that signals do have, such as economy,
 * finance and geopolitics, answered 400 "Invalid category") and the API's
 * query schema (unused). A name the database doesn't know makes a query on
 * the enum fail, so routes check names against this list instead.
 */
import { db } from '../db/postgres'

let kept: Promise<string[]> | null = null

export function signalCategories(): Promise<string[]> {
  if (!kept) {
    kept = Promise.resolve()
      .then(() => db.raw(`SELECT unnest(enum_range(NULL::category))::text AS name`))
      .then((r: { rows?: Array<{ name?: unknown }> }) => (r?.rows ?? []).map(x => x.name).filter((n): n is string => typeof n === 'string'))
      .then(names => { if (!names.length) kept = null; return names })
      .catch((err: unknown) => { kept = null; throw err })
  }
  return kept
}

/** Whether `name` is one of the database's categories; null when the list can't be read (the query then decides) */
export async function isSignalCategory(name: string): Promise<boolean | null> {
  const names = await signalCategories().catch(() => [] as string[])
  return names.length ? names.includes(name) : null
}

/** Forget the kept list (tests) */
export function forgetSignalCategories(): void {
  kept = null
}
