import { savedColor } from './palette.mjs'

export const MAX_WIDTH = 56

const plain = (text, color) => (color ? { text, style: 'plain', color } : { text, style: 'plain' })

export const lineLength = (segments) => segments.reduce((n, g) => n + g.text.length, 0)

const clampUsed = (used) => Math.min(100, Math.max(0, used))

export function barCells(row, T, L) {
  const used = clampUsed(row.used)
  const saving = row.saved > 0 ? row.saved : 0
  const u = Math.round((used / 100) * 2 * L)
  let s = u
  let capped = false
  if (saving > 0) {
    const raw = ((used + saving) / 100) * 2 * L
    s = Math.max(u + 1 + (u % 2), Math.min(2 * T, Math.round(raw)))
    capped = raw > 2 * T + 0.5
  }
  const step = 100 / (2 * L)
  const lastSaved = Math.ceil(s / 2) - 1
  const savedAt = (i) => (i === lastSaved ? savedColor(saving) : savedColor(Math.min(saving, (Math.min(2 * i + 2, s) - u) * step)))
  const state = (h) => (h < u ? 'used' : h < s ? 'saved' : 'empty')
  const cells = []
  for (let i = 0; i < T; i++) {
    const a = state(2 * i)
    const b = state(2 * i + 1)
    if (a === 'empty') {
      cells.push(i < L ? plain('─', 'subtle') : plain(' '))
      continue
    }
    cells.push(plain(b === 'empty' ? '╸' : '━', a === 'used' ? 'text' : savedAt(i)))
  }
  if (capped) cells[T - 1] = { text: '»', style: 'saved', pct: row.saved }
  return [...cells.slice(0, L), plain('│', 'inactive'), ...cells.slice(L)]
}

const MIN_BAR = 4
const MAX_BAR = 48
const LABEL_W = 10

export function layoutOf(rows, width) {
  const usedW = Math.max(4, ...rows.map((r) => r.usedText.length))
  const room = (figs) => width - LABEL_W - 5 - usedW - Math.max(12, ...figs.map(lineLength))
  const whole = room(rows.map((r) => r.fig))
  const split = whole < MIN_BAR
  const T = Math.min(MAX_BAR, split ? Math.max(MIN_BAR, room(rows.map((r) => r.fig.slice(0, 1)))) : whole)
  const top = Math.max(...rows.filter((r) => r.used !== null).map((r) => clampUsed(r.used) + Math.max(r.saved, 0)))
  const S = Math.min(150, Math.max(100, top))
  const O = S > 100 ? Math.ceil((T * (S - 100)) / S) : 0
  return { T, L: T - O, usedW, split }
}

export function rowLine(row, layout) {
  const { T, L, usedW } = layout
  const label = plain('  ' + row.label.padEnd(8))
  if (row.used === null) return [label, plain(' '.repeat(T + 1)), plain(' '.repeat(2 + usedW + 2)), ...row.fig]
  return [label, ...barCells(row, T, L), plain('  ' + row.usedText.padStart(usedW) + '  '), ...row.fig]
}

export function rowLines(row, layout) {
  if (!layout.split || row.fig.length < 2) return [rowLine(row, layout)]
  const [amount, first, ...rest] = row.fig
  return [rowLine({ ...row, fig: [amount] }, layout), [plain(' '.repeat(LABEL_W)), { ...first, text: first.text.trimStart() }, ...rest]]
}
