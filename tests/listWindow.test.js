import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listWindow } from '../src/listWindow.mjs'

const rows = (count) => Array.from({ length: count }, (_, i) => ({ key: `r${i}`, lines: i === 0 ? 3 : 2, row: true }))

test('the window opens at the top and closes at the bottom of a long list', () => {
  const items = rows(15)
  const top = listWindow({ items, room: 12, focusKey: 'r0' })
  assert.equal(top.from, 0)
  assert.equal(top.above, 0)
  assert.ok(top.below > 0)
  const bottom = listWindow({ items, room: 12, focusKey: 'r14' })
  assert.equal(bottom.to, 15)
  assert.equal(bottom.below, 0)
  assert.ok(bottom.above > 0)
})

test('moving the focus down one row shifts the window by at most one row', () => {
  const items = rows(15)
  let prevFrom = 0
  for (let i = 0; i < 15; i++) {
    const w = listWindow({ items, room: 12, focusKey: `r${i}`, prevFrom })
    assert.ok(w.from - prevFrom <= 1, `row ${i}: from ${prevFrom} to ${w.from}`)
    assert.ok(w.from <= i && i < w.to)
    prevFrom = w.from
  }
})

test('the focused row keeps one row drawn on each side where it exists', () => {
  const items = rows(15)
  let prevFrom = 0
  for (let i = 0; i < 15; i++) {
    const w = listWindow({ items, room: 12, focusKey: `r${i}`, prevFrom })
    if (i < 14) assert.ok(w.to > i + 1, `row ${i} has no row below it`)
    if (i > 0) assert.ok(w.from < i, `row ${i} has no row above it`)
    prevFrom = w.from
  }
})

test('a room smaller than one row plus scrolloff still returns the focused row', () => {
  const items = rows(15)
  for (const room of [1, 2, 3, 4]) {
    const w = listWindow({ items, room, focusKey: 'r7' })
    assert.ok(w.from <= 7 && 7 < w.to, `room ${room}`)
  }
  assert.deepEqual(listWindow({ items, room: 2, focusKey: 'r7' }), { from: 7, to: 8, above: 7, below: 7 })
})

test('everything that fits gives the full range with nothing hidden', () => {
  const items = rows(4)
  assert.deepEqual(listWindow({ items, room: 9, focusKey: 'r2' }), { from: 0, to: 4, above: 0, below: 0 })
  assert.deepEqual(listWindow({ items: [], room: 5, focusKey: null }), { from: 0, to: 0, above: 0, below: 0 })
})

test('hidden counts cover rows only and prevFrom is clamped', () => {
  const items = [{ key: 'h', lines: 2, row: false }, ...rows(10)]
  const w = listWindow({ items, room: 9, focusKey: 'r9', prevFrom: 999 })
  assert.equal(w.to, 11)
  assert.equal(w.below, 0)
  assert.equal(w.above, items.slice(0, w.from).filter((it) => it.row).length)
  assert.ok(w.from > 0)
})

test('the first drawn row counts three lines even mid-group', () => {
  const items = rows(10).map((it) => ({ ...it, lines: 2 }))
  const w = listWindow({ items, room: 6, focusKey: 'r5', prevFrom: 3 })
  assert.ok(w.to - w.from <= 2)
  assert.ok(w.from <= 5 && 5 < w.to)
})

test('the window never ends on a group head whose rows are all hidden', () => {
  const shape = 'r r h r h r h r r r r r'.split(' ')
  const items = shape.map((s, i) => (s === 'h' ? { key: `h${i}`, lines: 2, row: false } : { key: `r${i}`, lines: 2, row: true }))
  const w = listWindow({ items, room: 5, focusKey: 'r1', prevFrom: 11 })
  assert.ok(w.from <= 1 && 1 < w.to)
  assert.equal(items[w.to - 1].row, true)
})
