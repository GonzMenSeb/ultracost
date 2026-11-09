import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NEAR, TINY, HALF, HALF_MARGIN, bandOf, limitMessages, wrapText } from '../src/limitText.mjs'

const row = (label, used, saved, lo) => ({ label, used, saved, range: lo === undefined ? null : { lo } })
const five = (used, saved, lo = saved - 1) => row('5-hour', used, saved, lo)
const week = (used, saved, lo = saved - 1) => row('weekly', used, saved, lo)

const BASE_FIVE = five(13, 17.8, -12.9)
const BASE_WEEK = week(50, 3.5, -3.0)

const PRESET_ROWS = {
  'Normal': [BASE_FIVE, BASE_WEEK],
  'Large saving': [five(10, 40, 22), week(30, 25, 15)],
  'Over the limit': [five(85, 30, 18), BASE_WEEK],
  'Close call': [five(70, 28, 12), BASE_WEEK],
  'Way past the limit': [five(85, 80, 60), BASE_WEEK],
  'Both limits over': [five(85, 30, 18), week(96, 8, 2)],
  'Tiny saving': [five(41, 0.4, -0.2), week(22, 0.1, -0.1)],
  'Tiny saving, near the limit': [five(93, 1.2, 0.4), BASE_WEEK],
  'Tiny saving, at the limit': [five(99.5, 0.8, 0.2), BASE_WEEK],
  'Weekly still learning': [BASE_FIVE, row('weekly', 50, 0, undefined)],
  'More tokens, cheaper': [BASE_FIVE, BASE_WEEK],
  'API key': []
}

const EXPECT = {
  'Normal': [],
  'Large saving': ['without ultraguard you would have been past half of your weekly limit already'],
  'Over the limit': ['without ultraguard you would have blown past your 5-hour limit'],
  'Close call': ['without ultraguard you would have had only 2% of your 5-hour limit left'],
  'Way past the limit': ['without ultraguard you would have blown past your 5-hour limit'],
  'Both limits over': ['without ultraguard you would have blown past your 5-hour and weekly limits'],
  'Tiny saving': [],
  'Tiny saving, near the limit': ['without ultraguard you would likely have had only 6% of your 5-hour limit left'],
  'Tiny saving, at the limit': ['without ultraguard you might have hit your 5-hour limit'],
  'Weekly still learning': [],
  'More tokens, cheaper': [],
  'API key': []
}

test('constants and bandOf', () => {
  assert.deepEqual([NEAR, TINY, HALF, HALF_MARGIN], [10, 2, 50, 5])
  assert.equal(bandOf(100.0001), 'over')
  assert.equal(bandOf(100), 'near')
  assert.equal(bandOf(90), 'near')
  assert.equal(bandOf(89.99), 'far')
})

for (const [name, rows] of Object.entries(PRESET_ROWS)) {
  test(`preset messages: ${name}`, () => {
    assert.deepEqual(limitMessages(rows), EXPECT[name])
  })
}

test('hand-written cases', () => {
  assert.deepEqual(limitMessages([five(85, 30, 18), week(92, 3, 1)]), ['without ultraguard you would have blown past your 5-hour limit', 'without ultraguard you would have had only 5% of your weekly limit left'])
  assert.deepEqual(limitMessages([five(85, 30, 18), week(99.8, 0.4, -0.1)]), ['without ultraguard you would have blown past your 5-hour limit', 'without ultraguard you might have hit your weekly limit'])
  assert.deepEqual(limitMessages([five(99.8, 0.4, 0.3), week(100, 0.5, 0.4)]), ['without ultraguard you would likely have hit your 5-hour and weekly limits'])
  assert.deepEqual(limitMessages([five(98.9, 0.2, 0.1)]), ['without ultraguard you would likely have had less than 1% of your 5-hour limit left'])
})

test('used, saved and lo grid', () => {
  let cells = 0
  for (let used = 0; used <= 100; used += 2.5) for (const saved of [0.1, 0.4, 1.9, 2, 2.5, 5, 12, 30]) for (const loOf of [(s) => s - 1, (s) => s / 2, (s) => s * 0.9, (s) => -0.5]) {
    const m = limitMessages([five(used, saved, loOf(saved))])
    const total = used + saved
    const tag = `used ${used} saved ${saved}`
    if (total < 90) {
      if (used < 50 && total > 50) {
        assert.equal(m.length, 1, `${tag}: expected one half message`)
        assert.ok(m[0].includes('past half of your 5-hour limit already'), `${tag}: ${m[0]}`)
        assert.equal(/\blikely\b/.test(m[0]), total - 50 < 5, `${tag}: half hedge`)
        assert.ok(!/\bmight\b/.test(m[0]), `${tag}: half never says might`)
      } else assert.equal(m.length, 0, `${tag}: message when far`)
      cells++
      continue
    }
    assert.equal(m.length, 1, `${tag}: expected one message`)
    assert.equal(/\b(might|likely)\b/.test(m[0]), saved < 2, `${tag}: hedge words for saved ${saved}`)
    if (total > 100) assert.ok(m[0].includes(saved < 2 ? 'hit your 5-hour limit' : 'blown past your 5-hour limit'), `${tag}: ${m[0]}`)
    else {
      const left = 100 - total
      assert.ok(m[0].includes(left < 1 ? 'less than 1%' : `only ${Math.round(left)}%`), `${tag}: ${m[0]}`)
      assert.ok(m[0].endsWith('of your 5-hour limit left'), `${tag}: ${m[0]}`)
    }
    assert.ok(m[0].startsWith('without ultraguard you '), `${tag}: ${m[0]}`)
    cells++
  }
  assert.ok(cells > 0)
})

test('wrapText', () => {
  for (const w of [10, 20, 54]) for (const s of ['without ultraguard you would likely have had only 6% of your 5-hour limit left', 'a b c']) {
    const lines = wrapText(s, w)
    for (const l of lines) assert.ok(l.length <= w || !l.includes(' '), `width ${w}: "${l}"`)
    assert.equal(lines.join(' '), s)
  }
  assert.deepEqual(wrapText('a verylongword b', 4), ['a', 'verylongword', 'b'])
})

test('half band: strict boundaries', () => {
  assert.deepEqual(limitMessages([five(50, 3)]), [])
  assert.deepEqual(limitMessages([five(49, 1.0)]), [])
  assert.deepEqual(limitMessages([five(49, 1.1)]), ['without ultraguard you would likely have been past half of your 5-hour limit already'])
  assert.equal(limitMessages([five(40, 10.1)]).length, 1)
  assert.deepEqual(limitMessages([five(40, 10)]), [])
  assert.deepEqual(limitMessages([five(30, 59.9)]), ['without ultraguard you would have been past half of your 5-hour limit already'])
})

test('half band: hedge margin', () => {
  assert.match(limitMessages([five(40, 14.9)])[0], /would likely have been past half/)
  assert.equal(limitMessages([five(40, 15)])[0], 'without ultraguard you would have been past half of your 5-hour limit already')
  assert.equal(limitMessages([five(40, 30)])[0], 'without ultraguard you would have been past half of your 5-hour limit already')
})

test('half band: stronger band wins', () => {
  assert.deepEqual(limitMessages([five(49, 45)]), ['without ultraguard you would have had only 6% of your 5-hour limit left'])
  assert.deepEqual(limitMessages([five(49, 60)]), ['without ultraguard you would have blown past your 5-hour limit'])
  assert.deepEqual(limitMessages([five(85, 30, 18), week(30, 25, 15)]), ['without ultraguard you would have blown past your 5-hour limit', 'without ultraguard you would have been past half of your weekly limit already'])
})

test('half band: merging', () => {
  assert.deepEqual(limitMessages([five(30, 25, 15), week(20, 40, 30)]), ['without ultraguard you would have been past half of your 5-hour and weekly limits already'])
  assert.deepEqual(limitMessages([five(40, 12, 5), week(30, 22, 10)]), ['without ultraguard you would likely have been past half of your 5-hour and weekly limits already'])
  assert.deepEqual(limitMessages([five(40, 12, 5), week(30, 25, 15)]), ['without ultraguard you would likely have been past half of your 5-hour limit already', 'without ultraguard you would have been past half of your weekly limit already'])
})

test('near rows never merge', () => {
  assert.deepEqual(limitMessages([five(70, 28, 12), week(70, 28, 12)]), ['without ultraguard you would have had only 2% of your 5-hour limit left', 'without ultraguard you would have had only 2% of your weekly limit left'])
})

test('null used and null range are skipped', () => {
  assert.deepEqual(limitMessages([five(null, 40, 30), week(30, 25, 15)]), ['without ultraguard you would have been past half of your weekly limit already'])
  assert.deepEqual(limitMessages([row('5-hour', 30, 40, undefined), week(30, 25, 15)]), ['without ultraguard you would have been past half of your weekly limit already'])
  assert.deepEqual(limitMessages([five(null, 40, 30), row('weekly', 30, 40, undefined)]), [])
  assert.deepEqual(limitMessages([five(30, 0, 0)]), [])
})

test('half messages never contain might', () => {
  for (let used = 0; used < 50; used += 0.5) for (const saved of [0.2, 1, 3, 10, 40]) for (const lo of [-5, 0, saved / 2, saved]) {
    for (const m of limitMessages([five(used, saved, lo)])) if (m.includes('past half')) assert.ok(!/\bmight\b/.test(m), m)
  }
})
