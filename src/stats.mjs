const T90 = [
  6.314, 2.92, 2.353, 2.132, 2.015, 1.943, 1.895, 1.86, 1.833, 1.812, 1.796, 1.782, 1.771, 1.761, 1.753, 1.746,
  1.74, 1.734, 1.729, 1.725, 1.721, 1.717, 1.714, 1.711, 1.708, 1.706, 1.703, 1.701, 1.699, 1.697,
]
const Z90 = 1.645

export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seedOf(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function normal(rand) {
  const u = 1 - rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

export function t90(df) {
  if (df > 30) return Z90
  return df >= 1 ? T90[Math.floor(df) - 1] : Infinity
}

export function quantile(sorted, q) {
  const pos = q * (sorted.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length

export function logSd(values) {
  if (values.length < 2) return 0
  const m = mean(values)
  return Math.sqrt(values.reduce((s, x) => s + (x - m) ** 2, 0) / (values.length - 1))
}

export function fieller(x, y) {
  const n = x.length
  const xm = mean(x)
  const ym = mean(y)
  const r = ym / xm
  if (n < 2 || !(xm > 0)) return { r, lo: null, hi: null }
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - xm) ** 2
    syy += (y[i] - ym) ** 2
    sxy += (x[i] - xm) * (y[i] - ym)
  }
  const vxx = sxx / (n - 1) / n
  const vyy = syy / (n - 1) / n
  const vxy = sxy / (n - 1) / n
  const t = t90(n - 1)
  const g = (t * t * vxx) / (xm * xm)
  if (g >= 1) return { r, lo: null, hi: null }
  const shift = vxx > 0 ? (g * vxy) / vxx : 0
  const resid = vxx > 0 ? vyy - (vxy * vxy) / vxx : vyy
  const disc = vyy - 2 * r * vxy + r * r * vxx - g * resid
  if (disc < 0) return { r, lo: null, hi: null }
  const half = (t / xm) * Math.sqrt(disc)
  return { r, lo: (r - shift - half) / (1 - g), hi: (r - shift + half) / (1 - g) }
}
