/**
 * The sign-up form's half of the bot trap (lib/signup-trap.ts, Nov 3, 2026): the form sends its fields,
 * the invisible box and how long it was open.
 */
import { describe, it, expect } from 'vitest'
import { TRAP_FIELD, signupBody } from '../signup-trap'

const fields = { handle: 'reader', displayName: 'Reader', email: 'reader@example.com', password: 'a-long-password' }

describe('the sign-up form body', () => {
  it('sends the fields, the empty box and how long the form was open', () => {
    expect(signupBody(fields, '', 1_000, 15_500)).toEqual({ ...fields, extra: '', formMs: 14_500 })
  })

  it('leaves the time out if the page never noted when it opened', () => {
    expect(signupBody(fields, '', 0, 15_500).formMs).toBeUndefined()
  })

  it("names the box so that no browser or password manager fills it in by itself", () => {
    expect(TRAP_FIELD).not.toMatch(/mail|name|user|pass|url|site|phone|address|company/i)
  })
})
