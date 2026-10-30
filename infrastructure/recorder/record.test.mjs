// node --test infrastructure/recorder/record.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { msUntilNext, trimStart } from './record.mjs'

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

test('the video starts 3.2 s before the replay, never before the blank page is cut (Oct 30, 2026)', () => {
  // the replay began 12.4 s in: 9.2 s of waiting for the map are cut
  assert.equal(trimStart(12_400), 9.2)
  // a fast load keeps the 1.5 s cut of the blank page
  assert.equal(trimStart(3_000), 1.5)
  // a page without data-play-phase (an older site): the fixed cut
  assert.equal(trimStart(NaN), 1.5)
})
