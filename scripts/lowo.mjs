import { readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildRatios } from '../src/calibrate.mjs'
import { loadPrices, requestCost } from '../src/prices.mjs'

const BUCKETS = {
  output: (u) => u.output,
  fresh: (u) => u.input + u.cacheWrite,
  read: (u) => u.cacheRead,
}
const METRICS = [...Object.keys(BUCKETS), 'dollars']
const WITHIN = 0.5
const EPS = 1e-9
const MEDIAN_SD = 0.6745

const sum = (v) => v.reduce((s, x) => s + x, 0)
const mean = (v) => sum(v) / v.length
const unique = (v) => [...new Set(v)]
const familyOf = (config) => config.split(':')[0]
const keyOf = (p) => `${p.from}>${p.to}`
const covered = (n) => Math.ceil((9 * n) / 10)

export function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function summarize(errors) {
  if (!errors.length) return { n: 0, medianLog: null, medianRel: null, within50: null, multiplier90: null }
  const ratios = errors.map((e) => Math.exp(e))
  const cover = ratios.map((r) => 1 / r).sort((a, b) => a - b)
  return {
    n: errors.length,
    medianLog: medianOf(errors.map((e) => Math.abs(e))),
    medianRel: medianOf(ratios.map((r) => Math.abs(r - 1))),
    within50: ratios.filter((r) => Math.abs(r - 1) <= WITHIN + EPS).length / errors.length,
    multiplier90: cover[covered(errors.length) - 1],
  }
}

export function totalsOf(pairs, prices) {
  const side = (which, end) => ({
    ...Object.fromEntries(Object.entries(BUCKETS).map(([name, of]) => [name, sum(pairs.map((p) => of(p[which])))])),
    dollars: sum(pairs.map((p) => requestCost(prices, familyOf(p[end]), p[which]))),
  })
  const repriced = sum(pairs.map((p) => requestCost(prices, familyOf(p.to), p.actual)))
  return { actual: { ...side('actual', 'from'), repriced }, baseline: side('baseline', 'to') }
}

function compare(actual, measured, ratio, repriced) {
  if (!(actual > 0 && measured > 0 && Number.isFinite(ratio) && ratio > 0)) return null
  return {
    ratio,
    actual,
    measured,
    predicted: ratio * actual,
    error: Math.log((ratio * actual) / measured),
    noProbeError: Math.log(actual / measured),
    ...(repriced > 0 ? { repricedError: Math.log(repriced / measured) } : {}),
  }
}

export function leaveOneOut({ replays, prices }) {
  const pairs = replays.pairs
  const cases = []
  for (const held of unique(pairs.map((p) => p.workflow))) {
    const others = pairs.filter((p) => p.workflow !== held)
    const fit = buildRatios({ replays: { pairs: others }, published: { sources: [] }, prices }).measured
    const mine = pairs.filter((p) => p.workflow === held)
    for (const transition of unique(mine.map(keyOf))) {
      const own = mine.filter((p) => keyOf(p) === transition)
      const sources = others.filter((p) => keyOf(p) === transition)
      const base = { workflow: held, transition, pairs: own.length, fitWorkflows: unique(sources.map((p) => p.workflow)), fitPairs: sources.length }
      const entry = fit[transition]
      if (!entry) {
        const reason = sources.length
          ? `the ${sources.length} pair(s) of the other workflows give no usable ratio`
          : 'no other workflow measured this transition'
        cases.push({ ...base, predictable: false, reason })
        continue
      }
      const totals = totalsOf(own, prices)
      const metrics = Object.fromEntries(METRICS.map((m) => [m, compare(totals.actual[m], totals.baseline[m], entry[m]?.r, m === 'dollars' ? totals.actual.repriced : undefined)]))
      const unusable = Object.fromEntries(
        METRICS.filter((m) => !metrics[m]).map((m) => [m, entry[m] ? 'a total is zero' : 'calibrate keeps a bucket only when its 90% interval is bounded and above zero, and this one is not, so ratioFor would not use the transition as measured']),
      )
      cases.push({ ...base, predictable: true, metrics, unusable })
    }
  }
  return cases
}

export function summaries(cases) {
  const rows = cases
    .filter((c) => c.predictable)
    .flatMap((c) => METRICS.filter((m) => c.metrics[m]).map((m) => ({ workflow: c.workflow, metric: m, ...c.metrics[m] })))
  const of = (list) => ({
    probe: summarize(list.map((r) => r.error)),
    noProbe: summarize(list.map((r) => r.noProbeError)),
    repriced: summarize(list.filter((r) => r.repricedError !== undefined).map((r) => r.repricedError)),
  })
  return {
    workflows: Object.fromEntries(unique(rows.map((r) => r.workflow)).map((w) => [w, of(rows.filter((r) => r.workflow === w))])),
    overall: of(rows),
    metrics: Object.fromEntries(METRICS.map((m) => [m, of(rows.filter((r) => r.metric === m))])),
  }
}

export function tauCheck(cases, tau) {
  const scale = (k) => Math.sqrt(1 + 1 / k)
  const rows = cases
    .filter((c) => c.predictable && c.metrics.dollars)
    .map((c) => {
      const k = c.fitWorkflows.length
      return { workflow: c.workflow, error: c.metrics.dollars.error, k, sd: tau * scale(k), z: c.metrics.dollars.error / (tau * scale(k)), scaled: c.metrics.dollars.error / scale(k) }
    })
  const perTransition = new Map()
  for (const c of cases) {
    if (!perTransition.has(c.transition)) perTransition.set(c.transition, new Set())
    perTransition.get(c.transition).add(c.workflow)
  }
  return {
    tau,
    rows,
    implied: rows.length ? Math.sqrt(mean(rows.map((r) => r.scaled ** 2))) : null,
    expectedMedian: rows.length ? medianOf(rows.map((r) => MEDIAN_SD * r.sd)) : null,
    observedMedian: rows.length ? medianOf(rows.map((r) => Math.abs(r.error))) : null,
    dof: sum([...perTransition.values()].map((set) => Math.max(0, set.size - 1))),
  }
}

const signed = (x) => `${x < 0 ? '-' : '+'}${Math.abs(x).toFixed(3)}`
const percent = (x) => `${Math.round(x * 100)}%`
const grouped = (x) => String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const amount = (metric, x) => (metric === 'dollars' ? `$${x.toFixed(2)}` : grouped(x))
const factor = (x) => `x${x.toFixed(2)}`

function table(header, rows, align) {
  const all = [header, ...rows]
  const widths = header.map((_, i) => Math.max(...all.map((r) => String(r[i]).length)))
  const line = (r) => r.map((c, i) => (align[i] === 'r' ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i]))).join('  ').trimEnd()
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n')
}

function caseRows(cases) {
  return cases.flatMap((c) => {
    if (!c.predictable) return [[c.workflow, c.transition, 'not predictable', '-', '-', '-', '-', '-', '-', '-', '-']]
    const from = `${c.fitWorkflows.join('+')} (${c.fitPairs} pairs)`
    return METRICS.map((m) => {
      const x = c.metrics[m]
      if (!x) return [c.workflow, c.transition, from, m, '-', '-', '-', '-', '-', '-', '-']
      const repriced = x.repricedError === undefined ? '-' : signed(x.repricedError)
      return [c.workflow, c.transition, from, m, x.ratio.toFixed(3), amount(m, x.actual), amount(m, x.measured), amount(m, x.predicted), signed(x.error), signed(x.noProbeError), repriced]
    })
  })
}

function summaryRows(scope, s) {
  const row = (label, x) => [scope, label, x.n, ...(x.n ? [x.medianLog.toFixed(3), percent(x.medianRel), percent(x.within50), factor(x.multiplier90)] : ['-', '-', '-', '-'])]
  return [row('fitted ratio', s.probe), row('no probe', s.noProbe), ...(scope === 'dollars' ? [row('no probe, repriced', s.repriced)] : [])]
}

export function report({ cases, tau }) {
  const s = summaries(cases)
  const rows = [
    ...Object.entries(s.workflows).flatMap(([w, x]) => summaryRows(w, x)),
    ...summaryRows('overall', s.overall),
    ...METRICS.flatMap((m) => summaryRows(m, s.metrics[m])),
  ]
  const lost = [
    ...cases.filter((c) => !c.predictable).map((c) => `Not predictable: ${c.workflow} ${c.transition} (${c.pairs} pairs): ${c.reason}.`),
    ...cases.filter((c) => c.predictable).flatMap((c) =>
      Object.entries(c.unusable).map(([m, why]) => `Not predictable: ${c.workflow} ${m} (fit from ${c.fitWorkflows.join('+')}, ${c.fitPairs} pairs): ${why}.`),
    ),
  ]
  const check = tauCheck(cases, tau)
  const out = [
    `Leave-one-workflow-out check: ${cases.length} held-out workflow transition(s), ${cases.filter((c) => c.predictable).length} predictable`,
    'Each workflow is held out in turn. Its transition ratios (per bucket and in dollars) are fitted from the other workflows\' pairs of the same transition.',
    'Predicted baseline = fitted ratio x the held-out workflow\'s actual total. No probe = ratio 1: baseline = actual, in each bucket and in dollars.',
    'Repriced (dollars only) = ratio 1 per token bucket: the actual tokens priced at the baseline model\'s prices.',
    'ln err = ln(predicted / measured baseline), per workflow total; positive means over-predicted.',
    '',
    table(['Held out', 'Transition', 'Fit from', 'Metric', 'Ratio', 'Actual', 'Measured', 'Predicted', 'ln err', 'No probe', 'Repriced'], caseRows(cases), 'lllrrrrrrrr'),
    '',
    ...lost,
    ...(lost.length ? [''] : []),
    'Summary. A case is one workflow and one metric; both methods use the same cases, so n leaves out what is not predictable. Median err is |predicted - measured| / measured; within +-50% means predicted / measured in [0.5, 1.5]; x for 90% is the smallest factor on the prediction that reaches the measured baseline in at least 90% of cases.',
    table(['Scope', 'Method', 'n', 'Median |ln err|', 'Median err', 'Within +-50%', 'x for 90%'], rows, 'llrrrrr'),
  ]
  if (check.rows.length) {
    out.push(
      '',
      `Dollar errors against tau = ${tau.toFixed(4)} (a prediction from k other workflows has error sd tau * sqrt(1 + 1/k)):`,
      table(['Held out', 'ln err', 'k', 'Expected sd', 'z'], check.rows.map((r) => [r.workflow, signed(r.error), r.k, r.sd.toFixed(3), r.z.toFixed(2)]), 'lrrrr'),
      `tau implied by these errors: ${check.implied.toFixed(4)}`,
      `Median |ln err| expected at this tau: ${check.expectedMedian.toFixed(3)}; observed: ${check.observedMedian.toFixed(3)}`,
      `Independent comparisons behind tau (workflows minus transitions, as in the calibration): ${check.dof}`,
    )
  }
  return out.join('\n')
}

function main() {
  const dir = new URL('../data/', import.meta.url)
  const read = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, dir), 'utf8'))
  const replays = read('replays')
  const prices = loadPrices(read('prices'))
  const tau = buildRatios({ replays, published: { sources: [] }, prices }).tau
  console.log(report({ cases: leaveOneOut({ replays, prices }), tau }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main()
