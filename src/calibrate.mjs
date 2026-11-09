import { fieller, logSd } from './stats.mjs'
import { inputPrice, requestCost } from './prices.mjs'

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable']
const AGENT_FAMILIES = ['opus', 'sonnet', 'haiku']
const AGENT_EFFORTS = ['medium', 'high', 'xhigh']
const Z90 = 1.645
const SINGLE_SOURCE_STEP_SD = 0.4
const MIN_PRIOR_SD = 0.6
const MIN_TAU = 0.22

const round = (x) => Math.round(x * 1e9) / 1e9
const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length
const familyOf = (config) => config.split(':')[0]
const BUCKETS = {
  output: (u) => u.output,
  fresh: (u) => u.input + u.cacheWrite,
  read: (u) => u.cacheRead,
}

function groupBy(items, keyOf) {
  const groups = new Map()
  for (const item of items) {
    const key = keyOf(item)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  return groups
}

const agentLogs = (pairs, of) =>
  pairs.filter((p) => of(p.actual) > 0 && of(p.baseline) > 0).map((p) => Math.log(of(p.baseline) / of(p.actual)))

function measuredBucket(pairs, of) {
  const f = fieller(pairs.map((p) => of(p.actual)), pairs.map((p) => of(p.baseline)))
  if (f.lo === null || !(f.lo > 0) || !(f.r > 0)) return null
  return {
    r: f.r,
    lo: f.lo,
    hi: f.hi,
    mu: Math.log(f.r),
    sigma: (Math.log(f.hi) - Math.log(f.lo)) / (2 * Z90),
    agentSd: logSd(agentLogs(pairs, of)),
  }
}

function pairCosts(prices, pairs) {
  return {
    actual: pairs.map((p) => requestCost(prices, familyOf(p.from), p.actual)),
    baseline: pairs.map((p) => requestCost(prices, familyOf(p.to), p.baseline)),
  }
}

function measuredOf(pairs, prices) {
  const out = {}
  for (const [key, group] of groupBy(pairs, (p) => `${p.from}>${p.to}`)) {
    const entry = { pairs: group.length, workflows: new Set(group.map((p) => p.workflow)).size }
    for (const [name, of] of Object.entries(BUCKETS)) {
      const bucket = measuredBucket(group, of)
      if (bucket) entry[name] = bucket
    }
    if (!Object.keys(BUCKETS).some((name) => entry[name])) continue
    const costs = pairCosts(prices, group)
    const d = fieller(costs.actual, costs.baseline)
    entry.dollars = { r: d.r, lo: d.lo, hi: d.hi }
    out[key] = entry
  }
  return out
}

function tauOf(pairs, prices) {
  const total = (list) => {
    const c = pairCosts(prices, list)
    return c.baseline.reduce((s, x) => s + x, 0) / c.actual.reduce((s, x) => s + x, 0)
  }
  const transitions = groupBy(pairs, (p) => `${p.from}>${p.to}`)
  let sum = 0
  let cells = 0
  for (const group of transitions.values()) {
    const rt = Math.log(total(group))
    for (const cell of groupBy(group, (p) => p.workflow).values()) {
      sum += (Math.log(total(cell)) - rt) ** 2
      cells++
    }
  }
  return Math.max(MIN_TAU, Math.sqrt(sum / Math.max(1, cells - transitions.size)))
}

function stepsOf(sources) {
  const steps = {}
  for (const family of FAMILIES) {
    for (const e1 of EFFORTS) {
      for (const e2 of EFFORTS) {
        if (e1 === e2) continue
        const logs = sources
          .map((s) => s.cost[family])
          .filter((c) => c && c[e1] > 0 && c[e2] > 0)
          .map((c) => Math.log(c[e2] / c[e1]))
        if (!logs.length) continue
        steps[family] ??= {}
        steps[family][`${e1}>${e2}`] = { mu: mean(logs), sd: logs.length >= 2 ? logSd(logs) : SINGLE_SOURCE_STEP_SD, sources: logs.length }
      }
    }
  }
  return steps
}

function priorsOf(sources, prices) {
  const priors = {}
  for (const f1 of AGENT_FAMILIES) {
    for (const e1 of AGENT_EFFORTS) {
      for (const f2 of FAMILIES) {
        if (f1 === f2) continue
        for (const e2 of EFFORTS) {
          const price = Math.log(inputPrice(prices, f2) / inputPrice(prices, f1))
          const logs = sources
            .map((s) => [s.cost[f1]?.[e1], s.cost[f2]?.[e2]])
            .filter(([a, b]) => a > 0 && b > 0)
            .map(([a, b]) => Math.log(b / a) - price)
          if (!logs.length) continue
          priors[`${f1}:${e1}>${f2}:${e2}`] = { mu: mean(logs), sd: Math.max(MIN_PRIOR_SD, logSd(logs)), sources: logs.length }
        }
      }
    }
  }
  return priors
}

function rounded(value) {
  if (typeof value === 'number') return round(value)
  if (Array.isArray(value)) return value.map(rounded)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rounded(v)]))
  return value
}

export function buildRatios({ replays, published, prices }) {
  const pairs = replays.pairs
  const pooled = (of) => logSd(pairs.flatMap((p) => agentLogs([p], of)))
  return rounded({
    v: 1,
    claudeCode: replays.claudeCode,
    measuredAt: replays.measuredAt,
    tau: tauOf(pairs, prices),
    pooledAgentSd: Object.fromEntries(Object.entries(BUCKETS).map(([name, of]) => [name, pooled(of)])),
    measured: measuredOf(pairs, prices),
    steps: stepsOf(published.sources),
    priors: priorsOf(published.sources, prices),
  })
}
