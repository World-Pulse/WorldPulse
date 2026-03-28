/**
 * sanitize.ts — Input sanitization helpers
 *
 * Use sanitizeString() for any freetext query param before passing it to
 * search engines, database queries, or external APIs. Trims whitespace,
 * enforces a maximum length, and strips ASCII control characters.
 */

/**
 * Trim, strip control chars, and cap length on a freetext string.
 *
 * @param value  - Raw user input
 * @param maxLen - Maximum allowed length (default 500)
 * @returns      - Sanitized string
 */
export function sanitizeString(value: string, maxLen = 500): string {
  return value
    .trim()
    // Strip ASCII control characters (0x00–0x1F, 0x7F) except tab/newline/CR
    // which are handled by trim(). Keeps unicode characters intact.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .slice(0, maxLen)
}
