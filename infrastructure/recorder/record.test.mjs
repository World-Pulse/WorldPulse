// node --test infrastructure/recorder/record.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { msUntilNext, trimStart, layOut, slowUrl, frameName, cardFile, within, statusRecord, shouldCatchUp, recordMorning } from './record.mjs'

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

test("the video's card is saved as the page had it: its numbers and three stories (Nov 11, 2026)", () => {
  const raw = JSON.stringify({
    reports: 18508, outlets: 1827, countries: 215, verified: 3471, milestone: null,
    top: [{ title: ' Senator calls on Nvidia CEO to step down ', outlets: 170, countries: 57 }, { title: 'B', outlets: 90, countries: 0 },
      { title: 'C', outlets: 80, countries: 12 }, { title: 'D', outlets: 70, countries: 9 }],
  })
  const card = cardFile(raw, '2026-11-11', new Date('2026-11-11T10:47:51Z'))
  assert.deepEqual(card, {
    date: '2026-11-11', video: 'world-in-60s-2026-11-11.mp4', recorded_at: '2026-11-11T10:47:51.000Z',
    reports: 18508, outlets: 1827, countries: 215, verified: 3471, milestone: null,
    top: [{ title: 'Senator calls on Nvidia CEO to step down', outlets: 170, countries: 57 }, { title: 'B', outlets: 90, countries: 0 }, { title: 'C', outlets: 80, countries: 12 }],
  })
  assert.equal(cardFile(JSON.stringify({ reports: 750123, milestone: 750000, top: [] }), '2026-11-13').milestone, 750000)
})

test('no card when the page had none or it is not one', () => {
  assert.equal(cardFile(null, '2026-11-11'), null)
  assert.equal(cardFile('not json', '2026-11-11'), null)
  assert.equal(cardFile(JSON.stringify({ reports: 0 }), '2026-11-11'), null)
  assert.equal(cardFile(JSON.stringify([1, 2]), '2026-11-11'), null)
})

// Nov 21, 2026: on Nov 20 and 21 the page's day didn't come in time at 5:30, the one retry failed the same way, and
// there was no video. Now the morning keeps trying, each step goes in a status file, and nothing waits forever.

test('a morning tries frame by frame up to 8 times, 5 minutes apart, and stops at the first video', async () => {
  const statuses = [], sleeps = []
  let n = 0
  const out = await recordMorning({
    tries: 8, retryMs: 300_000,
    once: async () => { n++; if (n < 3) throw new Error("the map and the day weren't ready within 100 s: nothing saved"); return '/out/video/world-in-60s-2026-11-22.mp4' },
    live: async () => { throw new Error('not asked') },
    status: async (state, note, extra = {}) => { statuses.push([state, note, extra.try ?? null]) },
    sleep: async ms => { sleeps.push(ms) },
  })
  assert.equal(out, '/out/video/world-in-60s-2026-11-22.mp4')
  assert.equal(n, 3)
  assert.deepEqual(sleeps, [300_000, 300_000])
  assert.deepEqual(statuses.map(s => s[0]), ['recording', 'failed', 'recording', 'failed', 'recording', 'saved'])
  assert.match(statuses[1][1], /^try 1 of 8: the map and the day weren't ready/)
  assert.deepEqual(statuses[5], ['saved', 'saved on try 3', 3])
})

test('when every try fails it films once live, and says it gave up when that fails too', async () => {
  const statuses = []
  let lives = 0
  const status = async (state, note) => { statuses.push(state + ': ' + note) }
  const none = await recordMorning({
    tries: 2, retryMs: 1,
    once: async () => { throw new Error('stuck') },
    live: async () => { lives++; throw new Error("the replay didn't begin") },
    status, sleep: async () => {},
  })
  assert.equal(none, null)
  assert.equal(lives, 1)
  assert.equal(statuses.at(-1), "gave_up: every try failed; the last: the replay didn't begin")
  const live = await recordMorning({ tries: 1, retryMs: 1, once: async () => { throw new Error('x') }, live: async () => '/out/video/v.mp4', status: async () => {}, sleep: async () => {} })
  assert.equal(live, '/out/video/v.mp4')
})

test('nothing waits forever: within gives up after its time, and passes a quick answer through', async () => {
  assert.equal(await within(Promise.resolve(7), 1000, 'x'), 7)
  await assert.rejects(within(new Promise(() => {}), 20, 'the page'), /the page took more than 0 s/)
  await assert.rejects(within(Promise.reject(new Error('own')), 1000, 'x'), /own/)
})

test("a recorder started in the morning records the day's missing video now, not tomorrow", () => {
  // 11:00 UTC on Nov 22, 2026 is 6:00 in New York (EST): 30 minutes after 5:30, no video yet
  assert.equal(shouldCatchUp(new Date('2026-11-22T11:00:00Z'), ['world-in-60s-2026-11-21.mp4'], '05:30', 240), true)
  // the day's video is there
  assert.equal(shouldCatchUp(new Date('2026-11-22T11:00:00Z'), ['world-in-60s-2026-11-22.mp4'], '05:30', 240), false)
  // before 5:30 (the day's recording is still to come), and past the morning (4 hours on)
  assert.equal(shouldCatchUp(new Date('2026-11-22T10:00:00Z'), [], '05:30', 240), false)
  assert.equal(shouldCatchUp(new Date('2026-11-22T14:31:00Z'), [], '05:30', 240), false)
})

test('the status file holds the time, the state and a short plain note', () => {
  const s = statusRecord('failed', 'try 2 of 8: line one\nline two', new Date('2026-11-22T10:35:00Z'), { try: 2 })
  assert.deepEqual(s, { at: '2026-11-22T10:35:00.000Z', state: 'failed', note: 'try 2 of 8: line one line two', try: 2 })
  assert.equal(statusRecord('failed', 'x'.repeat(500)).note.length, 200)
})
