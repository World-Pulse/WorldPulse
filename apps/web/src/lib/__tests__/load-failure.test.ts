/**
 * An outage shouldn't look like missing stories (plan D2): when the home feed
 * or the map can't load, they say so instead of "No signals yet" or "No
 * signals match these filters".
 */
import { describe, it, expect } from 'vitest'
import { loadFailure, LOAD_FAILURE_TEXT } from '../load-failure'

describe('loadFailure', () => {
  it('no answer, or the server failing: down', () => {
    expect(loadFailure(undefined)).toBe('down')
    expect(loadFailure(null)).toBe('down')
    expect(loadFailure(500)).toBe('down')
    expect(loadFailure(502)).toBe('down')
    expect(loadFailure(503)).toBe('down')
    expect(loadFailure(404)).toBe('down')
  })

  it('too many requests: busy', () => {
    expect(loadFailure(429)).toBe('busy')
  })

  it("signed out or the sign-in ended: not an outage (the tab's own empty state says what to do)", () => {
    expect(loadFailure(401)).toBeNull()
    expect(loadFailure(403)).toBeNull()
  })

  it('says the stories are still there, and to try again', () => {
    expect(LOAD_FAILURE_TEXT.down.headline).toMatch(/couldn’t be loaded/)
    expect(LOAD_FAILURE_TEXT.down.message).toMatch(/still there: try again in a minute\.$/)
    expect(LOAD_FAILURE_TEXT.busy.message).toMatch(/Try again in a minute\.$/)
  })
})
