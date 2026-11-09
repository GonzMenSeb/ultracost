const FIRST_ROW_LINES = 3
const MIN_ROOM = 3

export function listLayout({ items, bodyRows, fixed, focusKey, prevFrom }) {
  const full = bodyRows - fixed
  if (costOf(items, 0, items.length) <= full) return { from: 0, to: items.length, above: 0, below: 0, windowed: false, pad: 0 }
  const shown = listWindow({ items, room: Math.max(MIN_ROOM, full - 2), focusKey, prevFrom })
  return { ...shown, windowed: true, pad: Math.max(1, full - 1 - costOf(items, shown.from, shown.to)) }
}

export function listWindow({ items, room, focusKey, scrolloff = 1, prevFrom = 0 }) {
  const n = items.length
  const hidden = (from, to) => ({ from, to, above: countRows(items, 0, from), below: countRows(items, to, n) })
  const cost = (from, to) => costOf(items, from, to)
  if (n === 0 || cost(0, n) <= room) return hidden(0, n)

  const found = items.findIndex((it) => it.key === focusKey)
  const focus = found < 0 ? 0 : found
  let lo = focus
  let hi = focus
  for (let s = scrolloff; s >= 0; s--) {
    lo = reach(items, focus, -1, s)
    hi = reach(items, focus, 1, s)
    if (cost(lo, hi + 1) <= room) break
    if (s === 0) return hidden(focus, focus + 1)
  }

  let from = Math.min(Math.max(Math.trunc(prevFrom) || 0, 0), n - 1, lo)
  while (from < lo && cost(from, hi + 1) > room) from++
  let to = hi + 1
  while (to < n && cost(from, to + 1) <= room) to++
  if (to < n) while (to > hi + 1 && !items[to - 1].row) to--
  if (to === n) while (from > 0 && cost(from - 1, to) <= room) from--
  return hidden(from, to)
}

function costOf(items, from, to) {
  let sum = 0
  for (let i = from; i < to; i++) sum += i === from && items[i].row ? Math.max(items[i].lines, FIRST_ROW_LINES) : items[i].lines
  return sum
}

function countRows(items, from, to) {
  let rows = 0
  for (let i = from; i < to; i++) if (items[i].row) rows++
  return rows
}

function reach(items, start, dir, rows) {
  let i = start
  let left = rows
  while (left > 0 && i + dir >= 0 && i + dir < items.length) {
    i += dir
    if (items[i].row) left--
  }
  return i
}
