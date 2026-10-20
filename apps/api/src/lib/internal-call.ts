/**
 * Calls the API makes to itself (app.inject) on a client's behalf, such as
 * the MCP tools asking the public routes (routes/mcp.ts, plan 15, Oct 20,
 * 2026).
 *
 * Such a call comes from 127.0.0.1, so the rate limiter would count every
 * client's tool calls in the one budget of that address, and one busy
 * assistant would shut out all the others. Leaving the calls out of the
 * limiter instead would let anyone get around a route's own limit (search by
 * meaning allows 20 a minute) by asking through the MCP server, up to 20
 * questions a POST. So the call carries the rate-limit key of the client it
 * is made for, and the limiter counts it as that client
 * (lib/rate-limit-options.ts): asking through MCP costs the same as asking
 * the API directly.
 *
 * The key is only believed next to a value made at random when the process
 * starts, which never leaves the process, so no one outside can pass a key.
 */
import { randomBytes } from 'node:crypto'

export const INTERNAL_CALL_HEADER = 'x-worldpulse-internal'
export const INTERNAL_CLIENT_HEADER = 'x-worldpulse-client'
const TOKEN = randomBytes(24).toString('hex')

/** Headers for a call made for the client whose rate-limit key this is */
export function internalCallHeaders(clientKey: string): Record<string, string> {
  return { [INTERNAL_CALL_HEADER]: TOKEN, [INTERNAL_CLIENT_HEADER]: clientKey }
}

export function isInternalCall(headers: Record<string, unknown>): boolean {
  return headers[INTERNAL_CALL_HEADER] === TOKEN
}

/** The rate-limit key an internal call is made for, or undefined for any other request */
export function internalCallClient(headers: Record<string, unknown>): string | undefined {
  if (!isInternalCall(headers)) return undefined
  const key = headers[INTERNAL_CLIENT_HEADER]
  return typeof key === 'string' && key ? key : undefined
}
