import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_WIDTH, barCells, layoutOf, lineLength, rowLine, rowLines } from '../src/bars.mjs'
import { savedColor } from '../src/palette.mjs'

const EPS = 1e-3
const USEDS = Array.from({ length: 41 }, (_, i) => i * 2.5)
const SAVEDS = [0.1, 0.4, 1.9, 2, 5, 12, 20, 40, 80]
const TS = [4, 6, 11, 12, 20, 30, 48]
const lsOf = (T) => [...new Set([T, T - Math.ceil(T / 3), T - 4, T - 12])].filter((L) => L >= 0)

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const isHex = (c) => typeof c === 'string' && c.startsWith('#')

function expectedSavedColors(used, saved, L, T) {
  const u = Math.round((used / 100) * 2 * L)
  const raw = ((used + saved) / 100) * 2 * L
  const s = Math.max(u + 1 + (u % 2), Math.min(2 * T, Math.round(raw)))
  const step = 100 / (2 * L)
  const last = Math.ceil(s / 2) - 1
  const out = []
  for (let i = 0; i < T; i++) if (2 * i >= u && 2 * i < s) out.push(i === last ? savedColor(saved) : savedColor(Math.min(saved, (Math.min(2 * i + 2, s) - u) * step)))
  return { out, raw }
}

const split = (cells, L) => ({ before: cells.slice(0, L), marker: cells[L], after: cells.slice(L + 1) })

test('bar cells follow the independent recomputation across the sweep', () => {
  for (const T of TS) for (const L of lsOf(T)) for (const used of USEDS) for (const saved of SAVEDS) {
    const tag = `T ${T} L ${L} used ${used} saved ${saved}`
    const cells = barCells({ used, saved }, T, L)
    assert.equal(cells.length, T + 1, `${tag}: segment count`)
    assert.deepEqual(cells[L], { text: '│', style: 'plain', color: 'inactive' }, `${tag}: marker`)
    assert.equal(cells.filter((g) => g.text === '│').length, 1, `${tag}: one marker`)
    const bar = [...cells.slice(0, L), ...cells.slice(L + 1)]
    assert.equal(bar.length, T, `${tag}: bar length`)

    const savedCells = bar.filter((g) => isHex(g.color) || g.style === 'saved')
    const hexCells = savedCells.filter((g) => isHex(g.color))
    const u = Math.round((used / 100) * 2 * L)
    for (const g of savedCells) assert.ok(['━', '╸', '»'].includes(g.text), `${tag}: glyph ${g.text}`)

    const exp = expectedSavedColors(used, saved, L, T)
    const capped = exp.raw > 2 * T + 0.5
    assert.equal(savedCells.length >= 1, Math.ceil(u / 2) < T || capped, `${tag}: saved cell presence`)
    assert.equal(bar.some((g) => g.text === '»'), capped, `${tag}: cap presence`)
    if (capped) assert.deepEqual(bar[T - 1], { text: '»', style: 'saved', pct: saved }, `${tag}: cap segment`)
    assert.deepEqual(hexCells.map((g) => g.color), capped ? exp.out.slice(0, -1) : exp.out, `${tag}: colors`)
    if (!capped && hexCells.length) assert.equal(hexCells[hexCells.length - 1].color, savedColor(saved), `${tag}: last saved cell`)

    let prev = Infinity
    for (const g of hexCells) {
      const l = luminance(g.color)
      assert.ok(l <= prev + EPS, `${tag}: luminance rises`)
      prev = l
    }

    const usedCells = bar.filter((g) => g.color === 'text')
    assert.equal(usedCells.length, Math.ceil(u / 2) - (capped && Math.ceil(u / 2) >= T ? 1 : 0), `${tag}: used cell count`)
    for (const g of usedCells) assert.equal(g.style, 'plain', `${tag}: used style`)

    for (let i = 0; i < T; i++) {
      const g = bar[i]
      if (g.color === 'subtle') {
        assert.equal(g.text, '─', `${tag}: track glyph`)
        assert.ok(i < L, `${tag}: subtle track past the limit`)
      } else if (g.text === ' ') {
        assert.ok(i >= L, `${tag}: blank track before the limit`)
        assert.deepEqual(g, { text: ' ', style: 'plain' })
      }
    }
  }
})

test('the last saved cell is exactly savedColor(saved) when the bar is not capped', () => {
  for (const saved of SAVEDS) {
    const cells = barCells({ used: 10, saved }, 30, 30)
    const hex = cells.filter((g) => isHex(g.color))
    assert.equal(hex[hex.length - 1].color, savedColor(saved))
  }
})

test('capped bars end in the saved-style cap', () => {
  const cells = barCells({ used: 85, saved: 80 }, 20, 20)
  assert.equal(cells.length, 21)
  assert.deepEqual(cells[19], { text: '»', style: 'saved', pct: 80 })
})

test('used cells all use the text color', () => {
  const cells = barCells({ used: 50, saved: 0 }, 20, 20)
  const drawn = cells.filter((g) => g.text === '━' || g.text === '╸')
  assert.equal(drawn.length, 10)
  for (const g of drawn) assert.deepEqual(g, { text: g.text, style: 'plain', color: 'text' })
})

test('a row with no saving has no hex cell and no cap', () => {
  for (const saved of [0, -3]) for (const T of TS) for (const L of lsOf(T)) for (const used of USEDS) {
    const cells = barCells({ used, saved }, T, L)
    assert.equal(cells.length, T + 1)
    assert.equal(cells.filter((g) => isHex(g.color)).length, 0)
    assert.equal(cells.some((g) => g.text === '»' || g.style === 'saved'), false)
  }
})

test('used above 100 behaves like 100 and below 0 like 0', () => {
  for (const saved of [0, 5, 40]) for (const L of [20, 12]) {
    assert.deepEqual(barCells({ used: 140, saved }, 20, L), barCells({ used: 100, saved }, 20, L))
    assert.deepEqual(barCells({ used: -5, saved }, 20, L), barCells({ used: 0, saved }, 20, L))
  }
})

test('a saved 40 row at T 48 shows at least 6 distinct shades', () => {
  const cells = barCells({ used: 10, saved: 40 }, 48, 48)
  const shades = new Set(cells.filter((g) => isHex(g.color)).map((g) => g.color))
  assert.ok(shades.size >= 6, `got ${shades.size}`)
})

test('the marker splits the bar at L', () => {
  const { before, marker, after } = split(barCells({ used: 20, saved: 5 }, 20, 16), 16)
  assert.equal(before.length, 16)
  assert.equal(marker.text, '│')
  assert.equal(after.length, 4)
})

const BASE_ROWS = [
  { label: 'context', used: 12.5, usedText: '12%', saved: 0, fig: [{ text: '125k of 1M', style: 'plain' }] },
  { label: '5-hour', used: 13, usedText: '13%', saved: 17.8, fig: [{ text: '+17.8', style: 'plain' }, { text: ' ±30.7', style: 'plain' }] },
  { label: 'weekly', used: 50, usedText: '50%', saved: 3.5, fig: [{ text: '+3.5', style: 'plain' }, { text: ' ±6.5', style: 'plain' }] }
]

test('layoutOf matches the mock numbers for the base rows', () => {
  const expected = { 44: 13, 56: 25, 72: 25, 110: 25 }
  for (const [width, T] of Object.entries(expected)) {
    const layout = layoutOf(BASE_ROWS, Math.min(Number(width), MAX_WIDTH))
    assert.deepEqual(layout, { T, L: T, usedW: 4, split: false }, `width ${width}`)
    for (const row of BASE_ROWS) {
      const total = lineLength(rowLine(row, layout))
      assert.ok(total <= Math.min(Number(width), MAX_WIDTH), `width ${width} ${row.label}: ${total}`)
    }
  }
})

test('layoutOf places the limit marker when the total passes 100', () => {
  const rows = [{ label: '5-hour', used: 85, usedText: '85%', saved: 30, fig: [{ text: '+30.0 ±12.0', style: 'plain' }] }]
  const layout = layoutOf(rows, 56)
  assert.deepEqual(layout, { T: 25, L: 25 - Math.ceil((25 * 15) / 115), usedW: 4, split: false })
  const capped = layoutOf([{ ...rows[0], saved: 200 }], 56)
  assert.equal(capped.L, 25 - Math.ceil((25 * 50) / 150))
})

test('layoutOf clamps used and ignores null-used rows for the scale', () => {
  const fig = [{ text: '+1.0 ±1.0', style: 'plain' }]
  const clamped = layoutOf([{ label: 'a', used: 400, usedText: '100%', saved: 0, fig }], 56)
  assert.equal(clamped.L, clamped.T)
  const withNull = layoutOf([{ label: 'a', used: null, usedText: '', saved: 90, fig }, { label: 'b', used: 10, usedText: '10%', saved: 0, fig }], 56)
  assert.equal(withNull.L, withNull.T)
})

test('layoutOf widens usedW and figW from the rows and keeps T within 4 and 48', () => {
  const wide = [{ label: 'cost', used: 10, usedText: '$100.00', saved: 5, fig: [{ text: '+$5.00 ±$1.00 and more text', style: 'plain' }] }]
  assert.equal(layoutOf(wide, 56).usedW, 7)
  assert.equal(layoutOf(wide, 20).T, 4)
  assert.equal(layoutOf(BASE_ROWS, 200).T, 48)
})

const COST_ROW = { label: 'cost', used: 31.4, usedText: '$5.50', saved: 68.6, fig: [{ text: '+$12.04', style: 'saved', pct: 68.6 }, { text: ' ($1.20 to $35.21)', style: 'dim' }] }
const CONTEXT_ROW = { label: 'context', used: 12.5, usedText: '12%', saved: 0, fig: [{ text: '125k of 1M', style: 'dim' }] }

test('a figure too wide for a 12-cell bar shrinks the bar so the row keeps to the width', () => {
  const layout = layoutOf([CONTEXT_ROW, COST_ROW], 56)
  assert.equal(layout.T, 11)
  assert.equal(layout.split, false)
  assert.deepEqual(rowLines(COST_ROW, layout), [rowLine(COST_ROW, layout)])
  assert.equal(lineLength(rowLine(COST_ROW, layout)), 56)
})

test('when a 4-cell bar still does not fit, every range moves to its own line under the bar', () => {
  const layout = layoutOf([CONTEXT_ROW, COST_ROW], 44)
  assert.equal(layout.split, true)
  assert.equal(layout.T, 12)
  const [first, second, ...rest] = rowLines(COST_ROW, layout)
  assert.equal(rest.length, 0)
  assert.ok(lineLength(first) <= 44)
  assert.deepEqual(first.at(-1), COST_ROW.fig[0])
  assert.deepEqual(second, [{ text: ' '.repeat(10), style: 'plain' }, { text: '($1.20 to $35.21)', style: 'dim' }])
  assert.deepEqual(rowLines(CONTEXT_ROW, layout), [rowLine(CONTEXT_ROW, layout)])
})

test('rowLine puts label, bar, used text and figure together', () => {
  const layout = layoutOf(BASE_ROWS, 56)
  const line = rowLine(BASE_ROWS[1], layout)
  assert.deepEqual(line[0], { text: '  5-hour  ', style: 'plain' })
  assert.equal(line.length, 1 + (layout.T + 1) + 1 + 2)
  assert.deepEqual(line[1 + layout.T + 1], { text: '   13%  ', style: 'plain' })
  assert.deepEqual(line.slice(-2), BASE_ROWS[1].fig)
  assert.equal(lineLength(line), 2 + 8 + (layout.T + 1) + 2 + layout.usedW + 2 + lineLength(BASE_ROWS[1].fig) )
})

test('a null-used row has no bar glyphs and the same length as a drawn row', () => {
  const fig = [{ text: '+3.5', style: 'plain' }, { text: ' ±6.5', style: 'plain' }]
  const rows = [...BASE_ROWS, { label: 'weekly', used: null, usedText: '', saved: 0, fig }]
  for (const width of [44, 56]) {
    const layout = layoutOf(rows, width)
    const drawn = rowLine(rows[2], layout)
    const blank = rowLine(rows[3], layout)
    assert.equal(lineLength(blank), lineLength(drawn))
    assert.ok(!blank.some((g) => /[━╸─│»]/.test(g.text)))
    assert.ok(!blank.some((g) => g.color))
    assert.equal(blank[1].text, ' '.repeat(layout.T + 1))
  }
})
