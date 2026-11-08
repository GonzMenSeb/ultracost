import { rng, normal, quantile } from './stats.mjs'
import { requestCost, meterUnits } from './prices.mjs'

const FAMILIES = new Set(['opus', 'sonnet', 'haiku', 'fable'])
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const MIN_READINGS = 5
const MAX_CACHE_READ_WEIGHT = 0.1
const NAMES = ['output', 'fresh', 'read']
const ZERO = { mu: 0, sigma: 0 }

export function configOf(family, effort) {
  return FAMILIES.has(family) && EFFORTS.includes(effort) ? `${family}:${effort}` : null
}

const hasBuckets = (m) => m && NAMES.every((name) => m[name])

export function ratioFor(ratios, from, to) {
  if (from === to) {
    return { source: 'identical', output: ZERO, fresh: ZERO, read: ZERO, agentSd: { output: 0, fresh: 0, read: 0 }, tau: 0, pairs: 0 }
  }
  const shape = (m, source, extra = {}) => ({
    source,
    ...Object.fromEntries(NAMES.map((name) => [name, { mu: m[name].mu, sigma: m[name].sigma }])),
    agentSd: Object.fromEntries(NAMES.map((name) => [name, m[name].agentSd])),
    tau: ratios.tau,
    pairs: m.pairs,
    ...extra,
  })
  const direct = ratios.measured[`${from}>${to}`]
  if (hasBuckets(direct)) return shape(direct, 'measured')

  const [family, effort] = to.split(':')
  const near = EFFORTS.indexOf(effort)
  const candidates = EFFORTS.filter((e) => e !== effort && hasBuckets(ratios.measured[`${from}>${family}:${e}`]) && ratios.steps[family]?.[`${e}>${effort}`])
    .sort((a, b) => Math.abs(EFFORTS.indexOf(a) - near) - Math.abs(EFFORTS.indexOf(b) - near) || EFFORTS.indexOf(a) - EFFORTS.indexOf(b))
  if (candidates.length) {
    const via = candidates[0]
    const m = ratios.measured[`${from}>${family}:${via}`]
    const step = ratios.steps[family][`${via}>${effort}`]
    const bucket = (b) => ({ mu: b.mu + step.mu, sigma: Math.sqrt(b.sigma ** 2 + step.sd ** 2) })
    return { ...shape(m, 'chained', { via }), ...Object.fromEntries(NAMES.map((name) => [name, bucket(m[name])])) }
  }

  const prior = ratios.priors[`${from}>${to}`]
  if (prior) {
    const bucket = { mu: prior.mu, sigma: prior.sd }
    return { source: 'prior', output: bucket, fresh: bucket, read: bucket, agentSd: { ...ratios.pooledAgentSd }, tau: 0, pairs: 0 }
  }
  return null
}

const factor = (b, sd, zT, shared, eps) => Math.exp(b.mu + b.sigma * zT + shared + sd * eps - (sd * sd) / 2)

const total = (t) => t.input + t.output + t.cacheRead + t.cacheWrite

function range(values) {
  const sorted = Float64Array.from(values).sort()
  const mid = quantile(sorted, 0.5)
  const lo = quantile(sorted, 0.05)
  const hi = quantile(sorted, 0.95)
  return { mid, lo, hi, pm: Math.max(mid - lo, hi - mid) }
}

const median = (values) => quantile(Float64Array.from(values).sort(), 0.5)

function validIntervals(list) {
  return (list ?? []).filter((i) => i && i.d > 0 && i.u > 0 && i.c >= 0 && Number.isFinite(i.d + i.u + i.c))
}

function emptySaved(base) {
  return {
    status: 'unknown',
    why: null,
    running: base.running,
    subscription: base.subscription,
    baseline: base.baseline,
    dollars: null,
    actualDollars: null,
    baselineDollars: null,
    tokens: null,
    limits: null,
    agents: base.agents.map((a) => ({ agentId: a.agentId, dollars: null, five_hour: null })),
    coverage: base.coverage,
    sources: { measuredPairs: 0, chained: [], priors: [] },
  }
}

export function estimateRun({ agents, baseline, ratios, prices, meter, seed, draws = 4000, running = false }) {
  const to = baseline ? configOf(baseline.family, baseline.effort) : null
  const baseFamily = to && prices.families[baseline.family] ? baseline.family : null
  const base = {
    running,
    subscription: meter?.subscription ?? null,
    baseline: baseFamily ? { family: baseline.family, effort: baseline.effort } : null,
    agents,
    coverage: { used: 0, total: agents.length, unpriced: 0, noRatio: [] },
  }
  if (!baseFamily) return { ...emptySaved(base), why: 'no-baseline' }

  const noRatio = new Set()
  const transitions = new Map()
  const used = []
  for (const a of agents) {
    const pieces = []
    let unpriced = false
    let missing = null
    for (const p of a.pieces) {
      if (!prices.families[p.family]) {
        unpriced = true
        continue
      }
      const from = configOf(p.family, p.effort)
      const ratio = from && ratioFor(ratios, from, to)
      if (!ratio) {
        missing = `${from ?? `${p.family}:?`}>${to}`
        continue
      }
      pieces.push({ p, from, ratio })
    }
    if (unpriced) base.coverage.unpriced++
    else if (missing) noRatio.add(missing)
    if (unpriced || missing || !pieces.length) continue
    for (const x of pieces) if (!transitions.has(x.from)) transitions.set(x.from, x.ratio)
    used.push({ agentId: a.agentId, pieces })
  }
  base.coverage.used = used.length
  base.coverage.noRatio = [...noRatio].sort()
  if (!used.length) return { ...emptySaved(base), why: 'no-agents' }

  const keys = [...transitions.keys()].sort()
  const slot = new Map(keys.map((k, i) => [k, i]))
  const measured = [...transitions.entries()].filter(([, r]) => r.source === 'measured')
  const sources = {
    measuredPairs: measured.reduce((n, [, r]) => n + r.pairs, 0),
    chained: keys.filter((k) => transitions.get(k).source === 'chained').map((k) => ({ from: k, to, via: transitions.get(k).via })),
    priors: keys.filter((k) => transitions.get(k).source === 'prior').map((k) => ({ from: k, to })),
  }
  const allIdentical = keys.every((k) => transitions.get(k).source === 'identical')

  const subscription = meter?.subscription === true
  const windows = subscription
    ? ['five_hour', 'seven_day'].map((kind) => {
        const list = validIntervals(meter[kind])
        return { kind, list, shown: list.length >= MIN_READINGS }
      })
    : []

  const flat = used.flatMap((a, ai) =>
    a.pieces.map(({ p, from, ratio }) => {
      const long = p.long === true
      const tokens = { input: p.input, output: p.output, cacheRead: p.cacheRead, cacheWrite: p.cacheWrite }
      const unitsActual = meterUnits(prices, p.family, tokens)
      return { ai, t: slot.get(from), ratio, tokens, long, actual: requestCost(prices, p.family, tokens, long), unitsActual, p }
    }),
  )
  const actualTotal = flat.reduce((s, x) => s + x.actual, 0)
  const actualTokens = flat.reduce((s, x) => s + total(x.tokens), 0)
  const actualOutput = flat.reduce((s, x) => s + x.tokens.output, 0)

  const rand = rng(seed)
  const n = used.length
  const savedDollars = new Float64Array(draws)
  const baselineDollars = new Float64Array(draws)
  const savedTokens = new Float64Array(draws)
  const savedOutput = new Float64Array(draws)
  const agentDollars = used.map(() => new Float64Array(draws))
  const agentPoints = used.map(() => new Float64Array(draws))
  const pointsDraws = windows.map(() => new Float64Array(draws))
  const zT = new Float64Array(keys.length)
  const eps = new Float64Array(n)
  const cfTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

  for (let k = 0; k < draws; k++) {
    const zRun = normal(rand)
    for (let i = 0; i < keys.length; i++) zT[i] = normal(rand)
    for (let i = 0; i < n; i++) eps[i] = normal(rand)
    const w = rand() * MAX_CACHE_READ_WEIGHT
    const pointsOf = windows.map((win) => {
      if (!win.shown) return 0
      let d = 0
      let u = 0
      let c = 0
      const len = win.list.length
      for (let i = 0; i < len; i++) {
        const pick = win.list[Math.floor(rand() * len)]
        d += pick.d
        u += pick.u
        c += pick.c
      }
      return d / (u + w * c)
    })

    let cfCost = 0
    let cfTok = 0
    let cfOut = 0
    const dollarsBy = new Float64Array(n)
    const unitsBy = new Float64Array(n)
    for (const x of flat) {
      const r = x.ratio
      const shared = r.tau * zRun - (r.tau * r.tau) / 2
      const fresh = factor(r.fresh, r.agentSd.fresh, zT[x.t], shared, eps[x.ai])
      cfTokens.input = x.tokens.input * fresh
      cfTokens.cacheWrite = x.tokens.cacheWrite * fresh
      cfTokens.cacheRead = x.tokens.cacheRead * factor(r.read, r.agentSd.read, zT[x.t], shared, eps[x.ai])
      cfTokens.output = x.tokens.output * factor(r.output, r.agentSd.output, zT[x.t], shared, eps[x.ai])
      const cost = requestCost(prices, baseFamily, cfTokens, x.long)
      cfCost += cost
      cfTok += total(cfTokens)
      cfOut += cfTokens.output
      dollarsBy[x.ai] += cost - x.actual
      if (windows.length) {
        const cf = meterUnits(prices, baseFamily, cfTokens)
        unitsBy[x.ai] += cf.u + w * cf.c - (x.unitsActual.u + w * x.unitsActual.c)
      }
    }
    savedDollars[k] = cfCost - actualTotal
    baselineDollars[k] = cfCost
    savedTokens[k] = cfTok - actualTokens
    savedOutput[k] = cfOut - actualOutput
    for (let i = 0; i < n; i++) {
      agentDollars[i][k] = dollarsBy[i]
      for (let j = 0; j < windows.length; j++) {
        const pts = unitsBy[i] * pointsOf[j]
        if (j === 0) agentPoints[i][k] = pts
        pointsDraws[j][k] += pts
      }
    }
  }

  const readings = { five_hour: validIntervals(meter?.five_hour).length, seven_day: validIntervals(meter?.seven_day).length }
  const limits = subscription
    ? {
        five_hour: windows[0].shown ? range(pointsDraws[0]) : null,
        seven_day: windows[1].shown ? range(pointsDraws[1]) : null,
        readings,
      }
    : null
  const byId = new Map(used.map((a, i) => [a.agentId, i]))
  return {
    status: allIdentical ? 'none' : 'estimated',
    why: null,
    running,
    subscription: base.subscription,
    baseline: base.baseline,
    dollars: range(savedDollars),
    actualDollars: actualTotal,
    baselineDollars: median(baselineDollars),
    tokens: { saved: median(savedTokens), outputSaved: median(savedOutput) },
    limits,
    agents: agents.map((a) => {
      const i = byId.get(a.agentId)
      return {
        agentId: a.agentId,
        dollars: i === undefined ? null : median(agentDollars[i]),
        five_hour: i === undefined || !windows[0]?.shown ? null : median(agentPoints[i]),
      }
    }),
    coverage: base.coverage,
    sources,
  }
}
