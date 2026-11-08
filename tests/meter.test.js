import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createMeter, noteRequest, noteReading, intervalsOf, mergeStored, storedValue } from '../src/meter.mjs'
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
