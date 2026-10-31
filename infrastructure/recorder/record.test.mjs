// node --test infrastructure/recorder/record.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { msUntilNext, trimStart, layOut, slowUrl, frameName } from './record.mjs'

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

test('slow motion: each video frame shows the newest drawing by its time, sped back up (Oct 31, 2026)', () => {
  // drawings at 0, 1.0, 2.1 and 3.0 s of filming, 30 times slower, at 30 frames a second: the video is 0.1 s
  // long (4 frames), frame i at i / 30 * 30 = i s of filming
  assert.deepEqual(layOut([0, 1000, 2100, 3000], 30, 30), [0, 1, 1, 3])
  // filmed live (1 time slower), a drawing every 100 ms holds 3 frames
  assert.deepEqual(layOut([0, 100, 200], 30, 1), [0, 0, 0, 1, 1, 1, 2])
  assert.deepEqual(layOut([], 30, 30), [])
})

test('the page is asked to play slower, and the frames are numbered for ffmpeg', () => {
  assert.equal(slowUrl('https://world-pulse.io/map?play=24h&frame=vertical&len=30', 30), 'https://world-pulse.io/map?play=24h&frame=vertical&len=30&slow=30')
  assert.equal(frameName(7), 'f00007.jpg')
})
