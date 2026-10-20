/**
 * A list's cursor is the id of the last item on the previous page (the
 * answer's `cursor` field).
 *
 * Oct 19, 2026: anything else (a date, a word) went straight into a lookup by
 * id, the database refused it ("invalid input syntax for type uuid"), and the
 * list answered 500, ten lists in six route files. Such a cursor now answers
 * 400, and an id that can't exist answers 404, without asking the database.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const BAD_CURSOR = "cursor must be the previous page's cursor (an item id)"

/** A uuid, the shape of every id a list's cursor can be */
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}
