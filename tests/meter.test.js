import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createMeter, noteBoundary, noteRequest, noteReading, intervalsOf, mergeStored, riseOf, snapshotOf, staleKeys, storedValue, usedOf } from '../src/meter.mjs'
import { loadPrices } from '../src/prices.mjs'

const prices = loadPrices(JSON.parse(readFileSync(new URL('../data/prices.json', import.meta.url), 'utf8')))
const DAY = 24 * 3600 * 1000
const NOW = 100 * DAY
const SOON = 5000
const each = { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 }
const limits = (five, week = 2, resetsAt = 'r1') => [
  { kind: 'five_hour', percentUsed: five, resetsAt },
  { kind: 'seven_day', percentUsed: week, resetsAt: 'w1' },
]
const iv = (at, d = 1) => ({ d, u: 1, c: 0.5, at })
const stored = (n, from) => ({ v: 1, five_hour: Array.from({ length: n }, (_, i) => iv(from + i)), seven_day: [] })

test('a rise with usage stores an interval and restarts the counters', () => {
  let m = noteReading(createMeter(), limits(10), 1, prices)
  m = noteRequest(m, 'sonnet', each)
  m = noteReading(m, limits(10.4, 2.1), 2, prices)
  assert.equal(m.subscription, true)
  assert.equal(m.mine.five_hour.length, 1)
  const [i] = m.mine.five_hour
  assert.equal(i.d, 0.4)
  assert.equal(i.u, 14)
  assert.equal(i.c, 2)
  assert.equal(i.at, 2)
  assert.deepEqual(m.acc.five_hour, {})
  assert.equal(m.mine.seven_day[0].d, 0.1)
})

test('a reset or a drop stores nothing', () => {
  let m = noteReading(createMeter(), limits(40), 1, prices)
  m = noteRequest(m, 'sonnet', each)
  m = noteReading(m, limits(3, 2, 'r2'), 2, prices)
  assert.deepEqual(m.mine.five_hour, [])
  assert.deepEqual(m.acc.five_hour, {})
  m = noteReading(m, limits(40, 2, 'r2'), 3, prices)
  m = noteRequest(m, 'sonnet', each)
  m = noteReading(m, limits(12, 2, 'r2'), 4, prices)
  assert.deepEqual(m.mine.five_hour, [])
  assert.deepEqual(m.acc.five_hour, {})
  assert.equal(m.last.five_hour.pct, 12)
})

test('a rise with no usage of this session stores nothing', () => {
  let m = noteReading(createMeter(), limits(10), 1, prices)
  m = noteReading(m, limits(11), 2, prices)
  assert.deepEqual(m.mine.five_hour, [])
  assert.equal(m.last.five_hour.pct, 11)
})

test('an unchanged reading keeps accumulating', () => {
  let m = noteReading(createMeter(), limits(10), 1, prices)
  m = noteRequest(m, 'sonnet', each)
  m = noteReading(m, limits(10), 2, prices)
  m = noteRequest(m, 'sonnet', each)
  m = noteReading(m, limits(10.2), 3, prices)
  assert.equal(m.mine.five_hour[0].u, 28)
})

test('an empty rate-limit list marks an API session', () => {
  const m = noteReading(createMeter(), [], 1, prices)
  assert.equal(m.subscription, false)
  assert.equal(createMeter().subscription, null)
})

test('requests of an unknown family are ignored', () => {
  const m = noteRequest(noteRequest(createMeter(), null, each), 'sonnet', each)
  assert.deepEqual(Object.keys(m.acc.five_hour), ['sonnet'])
})

test('intervals from several session keys merge, newest 200 kept', () => {
  let m = createMeter()
  m = mergeStored(
    m,
    {
      'meter:a': stored(90, 0),
      'meter:b': stored(90, 1000),
      'meter:c': stored(90, 2000),
      'meter:bad': { v: 9, five_hour: 'x' },
      'meter:worse': null,
      'other:key': stored(5, 5000),
    },
    'meter:own',
  )
  const list = intervalsOf(m, 'five_hour', SOON)
  assert.equal(list.length, 200)
  assert.equal(list[0].at, 2089)
  assert.ok(list.every((x, i) => i === 0 || list[i - 1].at >= x.at))
})

test('malformed intervals inside a stored value are ignored', () => {
  const value = { v: 1, five_hour: [iv(1), { d: -1, u: 1, c: 0, at: 2 }, { d: 1, u: 0, c: 0, at: 3 }, 'x', { d: 1, u: 1, c: 0 }], seven_day: [] }
  const m = mergeStored(createMeter(), { 'meter:a': value }, 'meter:own')
  assert.deepEqual(intervalsOf(m, 'five_hour', SOON), [iv(1)])
})

test('intervals older than 30 days are dropped', () => {
  const m = mergeStored(createMeter(), { 'meter:a': { v: 1, five_hour: [iv(NOW - 31 * DAY), iv(NOW - 29 * DAY)], seven_day: [] } }, 'meter:own')
  assert.deepEqual(intervalsOf(m, 'five_hour', NOW), [iv(NOW - 29 * DAY)])
})

test('this session reloads its own stored intervals without duplicating them', () => {
  let m = noteReading(createMeter(), limits(10), 5, prices)
  m = noteRequest(m, 'sonnet', each)
  m = noteReading(m, limits(10.5), 6, prices)
  const value = storedValue(m)
  assert.equal(value.v, 1)
  assert.equal(value.five_hour.length, 1)
  const again = mergeStored(m, { 'meter:own': value, 'meter:a': stored(2, 10) }, 'meter:own')
  assert.equal(again.mine.five_hour.length, 1)
  assert.equal(intervalsOf(again, 'five_hour', SOON).length, 3)
  const fresh = mergeStored(createMeter(), { 'meter:own': value }, 'meter:own')
  assert.equal(fresh.mine.five_hour.length, 1)
})

test('the same interval stored under two session keys counts once', () => {
  const same = { v: 1, five_hour: [iv(10), iv(11)], seven_day: [] }
  let m = mergeStored(createMeter(), { 'meter:a': same, 'meter:b': same }, 'meter:own')
  m = { ...m, mine: { five_hour: [iv(10)], seven_day: [] } }
  assert.deepEqual(intervalsOf(m, 'five_hour', SOON).map((i) => i.at), [11, 10])
})

test('a request on an unpriced model voids the interval', () => {
  let m = noteReading(createMeter(), limits(10), 1, prices)
  m = noteRequest(noteRequest(m, 'sonnet', each), '?', each)
  m = noteReading(m, limits(10.5), 2, prices)
  assert.deepEqual(m.mine.five_hour, [])
  assert.deepEqual(m.acc.five_hour, {})
  assert.equal(m.last.five_hour.pct, 10.5)
})

test('merging at a given time drops what is older than 30 days from this session and the others', () => {
  const old = { v: 1, five_hour: [iv(NOW - 31 * DAY), iv(NOW - 1 * DAY)], seven_day: [] }
  const m = mergeStored(createMeter(), { 'meter:own': old, 'meter:a': old }, 'meter:own', NOW)
  assert.deepEqual(m.mine.five_hour, [iv(NOW - 1 * DAY)])
  assert.deepEqual(m.others.five_hour, [iv(NOW - 1 * DAY)])
})

test('a stored key with nothing newer than 30 days is stale, this session never is', () => {
  const value = (at) => ({ v: 1, five_hour: [iv(at)], seven_day: [] })
  const stored = {
    'meter:fresh': value(NOW - DAY),
    'meter:old': value(NOW - 40 * DAY),
    'meter:empty': { v: 1, five_hour: [], seven_day: [] },
    'meter:junk': 'x',
    'meter:own': value(NOW - 40 * DAY),
    'other:key': value(NOW - 40 * DAY),
  }
  assert.deepEqual(staleKeys(stored, 'meter:own', NOW).sort(), ['meter:empty', 'meter:junk', 'meter:old'])
})

test('usedOf is null without a usable reading', () => {
  assert.equal(usedOf(null, NOW), null)
  assert.equal(usedOf(undefined, NOW), null)
  assert.equal(usedOf({ pct: NaN, resetsAt: null }, NOW), null)
  assert.equal(usedOf({ pct: Infinity, resetsAt: null }, NOW), null)
  assert.equal(usedOf({ pct: '5', resetsAt: null }, NOW), null)
})

test('usedOf keeps a reading whose window has not reset', () => {
  assert.equal(usedOf({ pct: 42, resetsAt: new Date(NOW + 1).toISOString() }, NOW), 42)
  assert.equal(usedOf({ pct: 0, resetsAt: new Date(NOW + DAY).toISOString() }, NOW), 0)
})

test('usedOf drops a reading whose window has reset, exactly now included', () => {
  assert.equal(usedOf({ pct: 42, resetsAt: new Date(NOW).toISOString() }, NOW), null)
  assert.equal(usedOf({ pct: 42, resetsAt: new Date(NOW - 1).toISOString() }, NOW), null)
})

test('usedOf keeps a reading with a null or unparsable reset time', () => {
  assert.equal(usedOf({ pct: 42, resetsAt: null }, NOW), 42)
  assert.equal(usedOf({ pct: 42, resetsAt: 'soon' }, NOW), 42)
})

test('usedOf of a recorded reading matches the reading', () => {
  const resetsAt = new Date(NOW + DAY).toISOString()
  const m = noteReading(createMeter(), limits(37.5, 2, resetsAt), 1, prices)
  assert.equal(usedOf(m.last.five_hour, NOW), 37.5)
  assert.equal(usedOf(m.last.five_hour, NOW + 2 * DAY), null)
  assert.equal(usedOf(createMeter().last.five_hour, NOW), null)
})

test('a rise of 2 or more points is a jump: nothing is stored and the counters restart', () => {
  let m = noteReading(createMeter(), limits(10, 2), 1, prices)
  m = noteRequest(m, 'sonnet', each)
  m = noteReading(m, limits(12, 4), 2, prices)
  assert.deepEqual(m.mine.five_hour, [])
  assert.deepEqual(m.mine.seven_day, [])
  assert.deepEqual(m.acc.five_hour, {})
  assert.deepEqual(m.acc.seven_day, {})
  assert.equal(m.last.five_hour.pct, 12)
  m = noteRequest(m, 'sonnet', each)
  m = noteReading(m, limits(13, 5), 3, prices)
  assert.equal(m.mine.five_hour.length, 1)
  assert.equal(m.mine.five_hour[0].d, 1)
  assert.equal(m.mine.five_hour[0].u, 14)
})

test('a rise of exactly 1 stays, and so does one below 2', () => {
  let m = noteReading(createMeter(), limits(10, 2), 1, prices)
  m = noteRequest(m, 'sonnet', each)
  m = noteReading(m, limits(11, 3), 2, prices)
  m = noteRequest(m, 'sonnet', each)
  m = noteReading(m, limits(12.9, 3), 3, prices)
  assert.deepEqual(m.mine.five_hour.map((i) => i.d), [1, 1.9])
  assert.deepEqual(m.mine.seven_day.map((i) => i.d), [1])
})

test('a jump in one window leaves the other window recording', () => {
  let m = noteReading(createMeter(), limits(10, 2), 1, prices)
  m = noteRequest(m, 'sonnet', each)
  m = noteReading(m, limits(30, 3), 2, prices)
  assert.deepEqual(m.mine.five_hour, [])
  assert.equal(m.mine.seven_day.length, 1)
})

test('stored intervals with a rise of 2 or more are ignored when read back', () => {
  const value = { v: 1, five_hour: [iv(1, 1), iv(2, 2), iv(3, 1.9), iv(4, 7), iv(5, 0.4)], seven_day: [iv(6, 3)] }
  const m = mergeStored(createMeter(), { 'meter:a': value, 'meter:own': value }, 'meter:own')
  assert.deepEqual(intervalsOf(m, 'five_hour', SOON).map((i) => i.d).sort(), [0.4, 1, 1.9])
  assert.deepEqual(intervalsOf(m, 'seven_day', SOON), [])
  assert.deepEqual(m.mine.five_hour.map((i) => i.d).sort(), [0.4, 1, 1.9])
})

test('intervalsOf filters jumps from the lists it was handed too', () => {
  const m = { ...createMeter(), mine: { five_hour: [iv(1, 2), iv(2, 1)], seven_day: [] }, others: { five_hour: [iv(3, 40), iv(4, 1)], seven_day: [] } }
  assert.deepEqual(intervalsOf(m, 'five_hour', SOON).map((i) => i.at), [4, 2])
})

test('a stored key holding only jumps is stale', () => {
  const stored = { 'meter:jumpy': { v: 1, five_hour: [iv(NOW - DAY, 5)], seven_day: [iv(NOW - DAY, 2)] }, 'meter:fine': { v: 1, five_hour: [iv(NOW - DAY)], seven_day: [] } }
  assert.deepEqual(staleKeys(stored, 'meter:own', NOW), ['meter:jumpy'])
})

test('a percentUsed outside 0 to 100 or not finite is no reading', () => {
  for (const bad of [101, -1, NaN, Infinity, -Infinity, '5', null, undefined]) {
    let m = noteReading(createMeter(), limits(10), 1, prices)
    m = noteRequest(m, 'sonnet', each)
    const after = noteReading(m, limits(bad), 2, prices)
    assert.equal(after.last.five_hour.pct, 10, String(bad))
    assert.deepEqual(after.mine.five_hour, [], String(bad))
    assert.deepEqual(after.acc.five_hour, m.acc.five_hour, String(bad))
    const next = noteReading(after, limits(11), 3, prices)
    assert.equal(next.mine.five_hour.length, 1, String(bad))
    assert.equal(next.mine.five_hour[0].u, 14, String(bad))
  }
})

test('a first reading outside 0 to 100 sets no last reading, and 0 and 100 are readings', () => {
  assert.equal(noteReading(createMeter(), limits(101), 1, prices).last.five_hour, null)
  assert.equal(noteReading(createMeter(), limits(0), 1, prices).last.five_hour.pct, 0)
  assert.equal(noteReading(createMeter(), limits(100), 1, prices).last.five_hour.pct, 100)
})

test('noteBoundary clears the counters and the last readings, and keeps the rest', () => {
  let m = noteReading(createMeter(), limits(10), 1, prices)
  m = noteRequest(m, 'sonnet', each)
  m = noteReading(m, limits(11), 2, prices)
  m = noteRequest(m, 'sonnet', each)
  const cut = noteBoundary(m)
  assert.deepEqual(cut.acc, { five_hour: {}, seven_day: {} })
  assert.deepEqual(cut.last, { five_hour: null, seven_day: null })
  assert.equal(cut.subscription, true)
  assert.deepEqual(cut.mine, m.mine)
  assert.deepEqual(cut.others, m.others)
  assert.notDeepEqual(m.acc.five_hour, {})
})

test('no interval spans a boundary', () => {
  let m = noteReading(createMeter(), limits(10), 1, prices)
  m = noteRequest(m, 'sonnet', each)
  m = noteBoundary(m)
  m = noteReading(m, limits(11), 2, prices)
  assert.deepEqual(m.mine.five_hour, [])
  assert.equal(m.last.five_hour.pct, 11)
  m = noteRequest(m, 'sonnet', each)
  m = noteReading(m, limits(12), 3, prices)
  assert.equal(m.mine.five_hour.length, 1)
  assert.equal(m.mine.five_hour[0].u, 14)
})

test('snapshotOf copies the last readings and is null where there is none', () => {
  const m = noteReading(createMeter(), [{ kind: 'five_hour', percentUsed: 7, resetsAt: 'r1' }], 1, prices)
  const snap = snapshotOf(m)
  assert.deepEqual(snap, { five_hour: { pct: 7, resetsAt: 'r1' }, seven_day: null })
  assert.notEqual(snap.five_hour, m.last.five_hour)
  assert.deepEqual(snapshotOf(undefined), { five_hour: null, seven_day: null })
})

test('riseOf is the climb since the snapshot, in the same window, never negative', () => {
  const last = { five_hour: { pct: 15, resetsAt: 'r1' }, seven_day: { pct: 3, resetsAt: 'w1' } }
  const snap = { five_hour: { pct: 10, resetsAt: 'r1' }, seven_day: { pct: 3, resetsAt: 'w1' } }
  assert.deepEqual(riseOf(snap, last, NOW), { five_hour: 5, seven_day: 0 })
  assert.deepEqual(riseOf({ ...snap, five_hour: { pct: 10, resetsAt: 'r0' } }, last, NOW).five_hour, null)
  assert.deepEqual(riseOf({ ...snap, five_hour: { pct: 20, resetsAt: 'r1' } }, last, NOW).five_hour, null)
  assert.deepEqual(riseOf({ ...snap, five_hour: null }, last, NOW).five_hour, null)
  assert.deepEqual(riseOf(snap, { ...last, five_hour: null }, NOW).five_hour, null)
  assert.deepEqual(riseOf(null, last, NOW), { five_hour: null, seven_day: null })
  assert.deepEqual(riseOf(snap, null, NOW), { five_hour: null, seven_day: null })
})

test('riseOf ignores a latest reading whose window has reset', () => {
  const at = new Date(NOW - 1).toISOString()
  const snap = { five_hour: { pct: 10, resetsAt: at }, seven_day: null }
  const last = { five_hour: { pct: 15, resetsAt: at }, seven_day: null }
  assert.equal(riseOf(snap, last, NOW).five_hour, null)
  assert.equal(riseOf(snap, last, NOW - 2).five_hour, 5)
})
