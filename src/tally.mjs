import { configOf } from './savings.mjs'
import { usedOf } from './meter.mjs'

const KINDS = ['five_hour', 'seven_day']
const MAX_RUNS = 500
const MIN_READINGS = 5
const SPAN_MS = { five_hour: 5 * 3600 * 1000, seven_day: 7 * 24 * 3600 * 1000 }
const DROPPED = (n) => `ultraguard: the session tally keeps ${MAX_RUNS} workflows; dropped the ${n} oldest`

const both = (make) => Object.fromEntries(KINDS.map((k) => [k, make(k)]))
const byTime = (a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
const runsOf = (tally) => Object.values(tally.runs).sort(byTime)
const stamp = (x) => (typeof x === 'string' ? x : null)
const withheldOf = (list) => (Array.isArray(list) ? KINDS.filter((k) => list.includes(k)) : [])

export function createTally() {
  return { v: 1, runs: {} }
}

export function noteTallyRun(tally, { key, status, baseline, agents, windows, withheld, at }, { log, ifAbsent = false } = {}) {
  const held = tally.runs[key]
  if (held && (ifAbsent || (held.status !== 'running' && status === 'running'))) return tally
  const runs = { ...tally.runs, [key]: { key, status, baseline: baseline ?? null, agents, windows: both((k) => stamp(windows?.[k])), withheld: withheldOf(withheld), at } }
  const all = Object.values(runs)
  if (all.length <= MAX_RUNS) return { ...tally, runs }
  const drop = all.sort(byTime).slice(0, all.length - MAX_RUNS)
  for (const r of drop) delete runs[r.key]
  if (log) log(DROPPED(drop.length))
  return { ...tally, runs }
}

const inWindow = (r, kind, current, now) => {
  const own = r.windows?.[kind] ?? null
  if (own === null || current === null || current === undefined) return now - r.at < SPAN_MS[kind]
  return own === current
}

const withheldIn = (r, kind) => Array.isArray(r.withheld) && r.withheld.includes(kind)

export function countedRuns(tally, kind, current, now) {
  const runs = runsOf(tally)
  if (kind === 'all') return runs
  return runs.filter((r) => inWindow(r, kind, current, now) && !withheldIn(r, kind))
}

export function withheldRuns(tally, kind, current, now) {
  return runsOf(tally).filter((r) => inWindow(r, kind, current, now) && withheldIn(r, kind))
}

const baselineKey = (b) => (b ? configOf(b.family, b.effort) : null)
const piecesOf = (runs) => runs.flatMap((r) => r.agents)

export function overallInput(tally, current, now) {
  const keys = [...new Set(runsOf(tally).map((r) => baselineKey(r.baseline)).filter(Boolean))].sort()
  const scope = (kind) => countedRuns(tally, kind, kind === 'all' ? null : current?.[kind] ?? null, now)
  const lists = { all: scope('all'), five_hour: scope('five_hour'), seven_day: scope('seven_day') }
  return {
    groups: keys.map((key) => {
      const mine = (runs) => piecesOf(runs.filter((r) => baselineKey(r.baseline) === key))
      const first = lists.all.find((r) => baselineKey(r.baseline) === key)
      return {
        baseline: { family: first.baseline.family, effort: first.baseline.effort },
        all: mine(lists.all),
        five_hour: mine(lists.five_hour),
        seven_day: mine(lists.seven_day)
      }
    })
  }
}

function addRanges(ranges) {
  if (ranges.length === 0) return null
  if (ranges.length === 1) return ranges[0]
  const mid = ranges.reduce((n, r) => n + r.mid, 0)
  const lo = ranges.reduce((n, r) => n + r.lo, 0)
  const hi = ranges.reduce((n, r) => n + r.hi, 0)
  return { mid, lo, hi, pm: Math.max(mid - lo, hi - mid) }
}

const addNumbers = (values) => (values.length === 1 ? values[0] : values.reduce((n, x) => n + x, 0))
const present = (values) => values.filter((x) => x !== null && x !== undefined)
const unique = (list, id) => [...new Map(list.map((x) => [id(x), x])).values()].sort((a, b) => (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0))
const pairId = (x) => `${x.from}>${x.to}`

function addCoverage(alls) {
  if (alls.length === 1) return alls[0].coverage
  const sum = (field) => alls.reduce((n, e) => n + e.coverage[field], 0)
  return { used: sum('used'), total: sum('total'), unpriced: sum('unpriced'), noRatio: [...new Set(alls.flatMap((e) => e.coverage.noRatio))].sort() }
}

function addSources(alls) {
  if (alls.length === 1) return alls[0].sources
  return {
    measuredPairs: alls.reduce((n, e) => n + e.sources.measuredPairs, 0),
    chained: unique(alls.flatMap((e) => e.sources.chained), pairId),
    priors: unique(alls.flatMap((e) => e.sources.priors), pairId)
  }
}

export function combine(estimates, { tally, meter, now }) {
  const count = Object.keys(tally.runs).length
  const running = runsOf(tally).some((r) => r.status === 'running')
  const baseline = estimates.length === 1 ? estimates[0].all.baseline : null
  if (estimates.length > 0 && estimates.every((e) => e?.all?.status === 'none')) return { status: 'none', count, running, baseline }
  const kept = estimates.filter((e) => e?.all?.status === 'estimated' || e?.all?.status === 'none')
  if (!kept.some((e) => e.all.status === 'estimated')) return { status: 'unknown', count, running }
  const alls = kept.map((e) => e.all)
  const subscription = meter?.subscription ?? null
  const current = both((k) => meter?.last?.[k]?.resetsAt ?? null)
  const readings = alls.find((e) => e.limits)?.limits.readings ?? { five_hour: 0, seven_day: 0 }
  const held = both((k) => withheldRuns(tally, k, current[k], now).length)
  const limitOf = (kind) => {
    const ranges = present(kept.map((e) => (e[kind] && e[kind].status !== 'unknown' ? e[kind].limits?.[kind] : null)))
    if (ranges.length) return addRanges(ranges)
    if (held[kind] > 0) return null
    return readings[kind] >= MIN_READINGS ? { mid: 0, lo: 0, hi: 0, pm: 0 } : null
  }
  const limitsOf = () => {
    const found = both(limitOf)
    return { ...found, readings, implausible: KINDS.filter((k) => found[k] === null && held[k] > 0) }
  }
  const tokens = present(alls.map((e) => e.tokens))
  return {
    status: 'estimated',
    why: null,
    count,
    counted: both((k) => countedRuns(tally, k, current[k], now).length),
    running,
    subscription,
    baseline,
    dollars: addRanges(present(alls.map((e) => e.dollars))),
    actualDollars: addNumbers(alls.map((e) => e.actualDollars)),
    baselineDollars: addNumbers(alls.map((e) => e.baselineDollars)),
    tokens: tokens.length === 0 ? null : tokens.length === 1 ? tokens[0] : { saved: addNumbers(tokens.map((t) => t.saved)), outputSaved: addNumbers(tokens.map((t) => t.outputSaved)) },
    limits: subscription === true ? limitsOf() : null,
    used: subscription === true ? both((k) => usedOf(meter.last?.[k], now)) : both(() => null),
    coverage: addCoverage(alls),
    sources: addSources(alls),
    transitions: []
  }
}
