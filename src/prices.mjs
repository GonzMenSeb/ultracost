const NAMES = ['opus', 'sonnet', 'haiku', 'fable', 'mythos']
const BUCKETS = ['input', 'output', 'cacheRead', 'cacheWrite']
const PER = 1e6

const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0

export function priceFamily(modelId) {
  if (typeof modelId !== 'string') return null
  const id = modelId.toLowerCase()
  const found = NAMES.filter((n) => id.includes(n))
  return found.length === 1 && found[0] !== 'mythos' ? found[0] : null
}

function checkRow(row, where) {
  if (row === null || typeof row !== 'object') throw new Error(`prices: ${where} is missing`)
  for (const b of BUCKETS) if (!isNum(row[b])) throw new Error(`prices: ${where}.${b} must be a number ≥ 0`)
}

export function loadPrices(json) {
  if (json === null || typeof json !== 'object' || json.families === null || typeof json.families !== 'object') {
    throw new Error('prices: no families')
  }
  for (const [family, row] of Object.entries(json.families)) {
    checkRow(row, family)
    if (row.longPrompt !== undefined) {
      checkRow(row.longPrompt, `${family}.longPrompt`)
      if (!isNum(row.longPrompt.above)) throw new Error(`prices: ${family}.longPrompt.above must be a number ≥ 0`)
    }
  }
  return json
}

const rowOf = (prices, family) => (typeof family === 'string' ? prices.families[family] ?? null : null)

export function inputPrice(prices, family) {
  const row = rowOf(prices, family)
  return row ? row.input : null
}

export function requestCost(prices, family, tokens) {
  const base = rowOf(prices, family)
  if (!base) return null
  const long = base.longPrompt && tokens.input + tokens.cacheRead + tokens.cacheWrite > base.longPrompt.above
  const row = long ? base.longPrompt : base
  return BUCKETS.reduce((sum, b) => sum + (tokens[b] * row[b]) / PER, 0)
}

export function meterUnits(prices, family, tokens) {
  const row = rowOf(prices, family)
  if (!row) return null
  return {
    u: ((tokens.input + tokens.cacheWrite) * row.input + tokens.output * row.output) / PER,
    c: (tokens.cacheRead * row.input) / PER,
  }
}
