const RAMP = {
  haiku: { low: '#f0ce65', medium: '#efc551', high: '#efbc3a', xhigh: '#efb219' },
  sonnet: { low: '#f9a63e', medium: '#f7972b', high: '#f48815', xhigh: '#ef790c' },
  opus: { low: '#f16e4a', medium: '#ec5d4d', high: '#e2484f', xhigh: '#d63150' }
}

const FAMILY_EFFORT = { haiku: 'xhigh', sonnet: 'high', opus: 'high' }
const SAVED_STOPS = [
  [1, [0.86, 0.1, 205]],
  [10, [0.72, 0.14, 255]],
  [20, [0.6, 0.18, 292]]
]

const rampOf = (model) => RAMP[model === 'fable' ? 'opus' : model]
const effortOf = (effort) => (effort === 'max' ? 'xhigh' : effort in RAMP.opus ? effort : 'high')

export function modelColor(model, effort) {
  const ramp = rampOf(model)
  return ramp ? ramp[effortOf(effort)] : undefined
}

export function familyColor(model) {
  const ramp = rampOf(model)
  return ramp ? ramp[FAMILY_EFFORT[model === 'fable' ? 'opus' : model]] : undefined
}

function linearOf(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
}

const encode = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

function hexOf([L, C, h]) {
  let lin = linearOf(L, C, h)
  while (C > 0 && !lin.every((x) => x >= -1e-4 && x <= 1 + 1e-4)) {
    C -= 0.005
    lin = linearOf(L, C, h)
  }
  return `#${lin.map((x) => Math.round(Math.max(0, Math.min(1, encode(Math.max(0, x)))) * 255).toString(16).padStart(2, '0')).join('')}`
}

export function savedColor(pct) {
  const p = Number.isFinite(pct) ? pct : 0
  if (p <= SAVED_STOPS[0][0]) return hexOf(SAVED_STOPS[0][1])
  for (let i = 1; i < SAVED_STOPS.length; i++) {
    const [p1, to] = SAVED_STOPS[i]
    if (p <= p1) {
      const [p0, from] = SAVED_STOPS[i - 1]
      const t = (p - p0) / (p1 - p0)
      return hexOf(from.map((v, k) => v + (to[k] - v) * t))
    }
  }
  return hexOf(SAVED_STOPS[SAVED_STOPS.length - 1][1])
}
