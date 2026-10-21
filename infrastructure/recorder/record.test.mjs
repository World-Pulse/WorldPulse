// node --test infrastructure/recorder/record.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { msUntilNext } from './record.mjs'

test('the next recording is at 05:30 New York time, today or tomorrow', () => {
  // 09:00 UTC on Oct 21, 2026 is 05:00 in New York (EDT): 30 minutes to go
  assert.equal(msUntilNext(new Date('2026-10-21T09:00:00Z'), '05:30'), 30 * 60_000)
  // 10:00 UTC is 06:00 there: tomorrow's, 23.5 hours away
  assert.equal(msUntilNext(new Date('2026-10-21T10:00:00Z'), '05:30'), 23.5 * 3_600_000)
  // in winter (EST, UTC-5): 10:00 UTC is 05:00
  assert.equal(msUntilNext(new Date('2026-12-01T10:00:00Z'), '05:30'), 30 * 60_000)
  // exactly at the time: the next day's
  assert.equal(msUntilNext(new Date('2026-10-21T09:30:00Z'), '05:30'), 24 * 3_600_000)
})
