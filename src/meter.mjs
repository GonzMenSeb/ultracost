import { meterUnits } from './prices.mjs'

const KINDS = ['five_hour', 'seven_day']
const MAX_INTERVALS = 200
const MAX_AGE_MS = 30 * 24 * 3600 * 1000
const MIN_RISE = 0.1

const round1 = (x) => Math.round(x * 10) / 10
const both = (make) => Object.fromEntries(KINDS.map((k) => [k, make(k)]))
const finite = (...xs) => xs.every((x) => typeof x === 'number' && Number.isFinite(x))

export function createMeter() {
  return {
    subscription: null,
    acc: both(() => ({})),
    last: both(() => null),
    mine: both(() => []),
    others: both(() => []),
  }
}

export function noteRequest(meter, family, tokens) {
  if (typeof family !== 'string' || family === '') return meter
  const add = (acc) => {
    const old = acc[family] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    return {
      ...acc,
      [family]: {
        input: old.input + tokens.input,
        output: old.output + tokens.output,
        cacheRead: old.cacheRead + tokens.cacheRead,
        cacheWrite: old.cacheWrite + tokens.cacheWrite,
      },
    }
  }
  return { ...meter, acc: both((k) => add(meter.acc[k])) }
}

function unitsOf(acc, prices) {
  let u = 0
  let c = 0
  for (const [family, tokens] of Object.entries(acc)) {
    const m = meterUnits(prices, family, tokens)
    if (!m) continue
    u += m.u
    c += m.c
  }
  return { u, c }
}

export function noteReading(meter, rateLimits, at, prices) {
  if (!Array.isArray(rateLimits) || rateLimits.length === 0) return { ...meter, subscription: false }
  const next = { ...meter, subscription: true, acc: { ...meter.acc }, last: { ...meter.last }, mine: { ...meter.mine } }
  for (const kind of KINDS) {
    const entry = rateLimits.find((r) => r && r.kind === kind)
    if (!entry || !finite(entry.percentUsed)) continue
    const reading = { pct: entry.percentUsed, resetsAt: entry.resetsAt ?? null }
    const last = meter.last[kind]
    next.last[kind] = reading
    if (!last || last.resetsAt !== reading.resetsAt || reading.pct < last.pct) {
      next.acc[kind] = {}
      continue
    }
    const d = round1(reading.pct - last.pct)
    if (d < MIN_RISE) continue
    const { u, c } = unitsOf(meter.acc[kind], prices)
    if (!(u > 0)) continue
    next.mine[kind] = [...meter.mine[kind], { d, u, c, at }].slice(-MAX_INTERVALS)
    next.acc[kind] = {}
  }
  return next
}

const newest = (list) => [...list].sort((a, b) => b.at - a.at).slice(0, MAX_INTERVALS)

export function intervalsOf(meter, kind, now) {
  const seen = new Set()
  const fresh = [...meter.others[kind], ...meter.mine[kind]].filter((i) => {
    const id = `${i.at}:${i.d}:${i.u}:${i.c}`
    if (i.at < now - MAX_AGE_MS || seen.has(id)) return false
    seen.add(id)
    return true
  })
  return newest(fresh)
}

const validInterval = (i) => i !== null && typeof i === 'object' && finite(i.d, i.u, i.c, i.at) && i.d > 0 && i.u > 0 && i.c >= 0

function intervalsIn(value, kind) {
  if (value === null || typeof value !== 'object' || value.v !== 1 || !Array.isArray(value[kind])) return []
  return value[kind].filter(validInterval).map(({ d, u, c, at }) => ({ d, u, c, at }))
}

export function mergeStored(meter, stored, sessionKey) {
  const others = both(() => [])
  const mine = both((k) => [...meter.mine[k]])
  for (const [key, value] of Object.entries(stored ?? {})) {
    if (!key.startsWith('meter:')) continue
    for (const kind of KINDS) {
      const list = intervalsIn(value, kind)
      if (key === sessionKey) {
        const seen = new Set(mine[kind].map((i) => i.at))
        mine[kind] = [...mine[kind], ...list.filter((i) => !seen.has(i.at))]
      } else {
        others[kind].push(...list)
      }
    }
  }
  return { ...meter, others: both((k) => newest(others[k])), mine: both((k) => newest(mine[k]).reverse()) }
}

export function storedValue(meter) {
  return { v: 1, five_hour: meter.mine.five_hour, seven_day: meter.mine.seven_day }
}
