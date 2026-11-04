/**
 * The sign-up form's half of the bot trap (lib/signup-trap.ts, Nov 3, 2026): the form sends its fields,
 * the invisible box and how long it was open.
 */
import { describe, it, expect } from 'vitest'
import { TRAP_FIELD, signupBody, trapFields } from '../signup-trap'

const fields = { handle: 'reader', displayName: 'Reader', email: 'reader@example.com', password: 'a-long-password' }

describe('the sign-up form body', () => {
  it('sends the fields, the empty box and how long the form was open', () => {
    expect(signupBody(fields, '', 1_000, 15_500)).toEqual({ ...fields, extra: '', formMs: 14_500 })
  })

  it('leaves the time out if the page never noted when it opened', () => {
    expect(signupBody(fields, '', 0, 15_500).formMs).toBeUndefined()
  })

  it('gives the email briefing form the same two fields (Nov 4, 2026)', () => {
    expect({ email: 'r@example.com', ...trapFields('', 2_000, 9_000) }).toEqual({ email: 'r@example.com', extra: '', formMs: 7_000 })
    expect(trapFields('filled by a script', 2_000, 2_150)).toEqual({ extra: 'filled by a script', formMs: 150 })
  })

  it("names the box so that no browser or password manager fills it in by itself", () => {
    expect(TRAP_FIELD).not.toMatch(/mail|name|user|pass|url|site|phone|address|company/i)
  })
})
