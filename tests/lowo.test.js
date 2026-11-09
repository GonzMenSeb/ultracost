import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { medianOf, summarize, leaveOneOut, summaries, tauCheck, report } from '../scripts/lowo.mjs'
import { loadPrices } from '../src/prices.mjs'

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'))
const prices = loadPrices(read('prices'))
const within = (a, b, tol = 1e-8) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b} (±${tol})`)
const usage = ([input, output, cacheRead, cacheWrite]) => ({ input, output, cacheRead, cacheWrite })
const pair = (workflow, transition, actual, baseline) => {
  const [from, to] = transition.split('>')
  return { workflow, kind: 'k', from, to, actual: usage(actual), baseline: usage(baseline) }
}

const MEDIUM = 'sonnet:high>opus:medium'
const HIGH = 'sonnet:high>opus:high'
const A = [
  pair('A', MEDIUM, [10, 100, 1000, 20], [20, 150, 1400, 30]),
  pair('A', MEDIUM, [15, 110, 1100, 25], [22, 190, 1900, 40]),
  pair('A', MEDIUM, [10, 90, 900, 15], [14, 140, 1500, 26]),
]
const B = [
  pair('B', MEDIUM, [20, 200, 2000, 40], [50, 520, 5200, 100]),
  pair('B', MEDIUM, [30, 220, 2200, 50], [75, 520, 5300, 120]),
  pair('B', MEDIUM, [20, 180, 1800, 30], [50, 460, 4500, 80]),
]
const C = [
  pair('C', HIGH, [10, 100, 1000, 20], [20, 200, 2000, 40]),
  pair('C', HIGH, [10, 110, 1100, 20], [20, 220, 2200, 40]),
]
const replays = { v: 1, claudeCode: 'x', measuredAt: 'y', pairs: [...A, ...B, ...C] }
const cases = leaveOneOut({ replays, prices })
const caseOf = (workflow) => cases.find((c) => c.workflow === workflow)

test('median of an odd and an even count', () => {
  assert.equal(medianOf([3, 1, 2]), 2)
  assert.equal(medianOf([4, 1, 3, 2]), 2.5)
})

test('summarize reports median error, share within 50% and the 90% multiplier', () => {
  const ratios = [1.25, 0.8, 2, 0.4, 1.1, 0.9, 1.6, 0.55, 1.3, 1]
  const s = summarize(ratios.map(Math.log))
  assert.equal(s.n, 10)
  within(s.medianLog, (Math.log(1.25) + Math.log(1.3)) / 2, 1e-12)
  within(s.medianRel, 0.275, 1e-12)
  assert.equal(s.within50, 0.7)
  within(s.multiplier90, 1 / 0.55, 1e-12)
})

test('the 90% multiplier is the ceil(0.9 n)-th smallest actual / predicted', () => {
  const two = summarize([Math.log(1.25), Math.log(0.8)])
  within(two.multiplier90, 1.25, 1e-12)
  assert.equal(two.within50, 1)
  const twenty = summarize(Array.from({ length: 20 }, (_, i) => Math.log(1 / (i + 1))))
  within(twenty.multiplier90, 18, 1e-9)
  const one = summarize([Math.log(0.5)])
  within(one.multiplier90, 2, 1e-12)
})

test('exactly 50% off still counts as within 50%', () => {
  assert.equal(summarize([Math.log(1.5), Math.log(0.5)]).within50, 1)
  assert.equal(summarize([Math.log(1.51), Math.log(0.49)]).within50, 0)
})

test('summarize of nothing is empty, not NaN', () => {
  assert.deepEqual(summarize([]), { n: 0, medianLog: null, medianRel: null, within50: null, multiplier90: null })
})

test('every workflow is held out in turn and a lone transition is not predictable', () => {
  assert.deepEqual(cases.map((c) => [c.workflow, c.transition, c.predictable]), [['A', MEDIUM, true], ['B', MEDIUM, true], ['C', HIGH, false]])
  assert.equal(caseOf('C').reason, 'no other workflow measured this transition')
  assert.equal(caseOf('C').pairs, 2)
  assert.deepEqual(caseOf('A').fitWorkflows, ['B'])
  assert.equal(caseOf('A').fitPairs, 3)
})

test('the held-out workflow is fitted from the others only', () => {
  const a = caseOf('A').metrics
  for (const m of ['output', 'fresh', 'read']) {
    within(a[m].ratio, 2.5)
    within(a[m].error, Math.log(2.5 / 1.6))
    within(a[m].noProbeError, Math.log(1 / 1.6))
  }
  assert.equal(a.output.actual, 300)
  assert.equal(a.output.measured, 480)
  within(a.output.predicted, 750)
  assert.equal(a.fresh.actual, 95)
  assert.equal(a.fresh.measured, 152)
  assert.equal(a.read.actual, 3000)
  assert.equal(a.read.measured, 4800)
  const b = caseOf('B').metrics
  for (const m of ['output', 'fresh', 'read']) {
    within(b[m].ratio, 1.6)
    within(b[m].error, Math.log(1.6 / 2.5))
    within(b[m].noProbeError, Math.log(1 / 2.5))
  }
  assert.equal(b.output.actual, 600)
  assert.equal(b.output.measured, 1500)
  assert.equal(b.fresh.actual, 190)
  assert.equal(b.fresh.measured, 475)
})

test('dollars use the dollar ratio, with the no-probe baseline plain and repriced', () => {
  const a = caseOf('A').metrics.dollars
  within(a.actual, 3520e-6, 1e-12)
  within(a.measured, 11264e-6, 1e-12)
  within(a.ratio, 5)
  within(a.error, Math.log(5 / 3.2))
  within(a.noProbeError, Math.log(1 / 3.2))
  within(a.repricedError, Math.log(2 / 3.2))
  const b = caseOf('B').metrics.dollars
  within(b.actual, 7040e-6, 1e-12)
  within(b.measured, 35200e-6, 1e-12)
  within(b.ratio, 3.2)
  within(b.error, Math.log(3.2 / 5))
  within(b.noProbeError, Math.log(1 / 5))
  within(b.repricedError, Math.log(2 / 5))
  assert.equal(caseOf('A').metrics.output.repricedError, undefined)
})

test('per workflow, overall and per metric summaries use the same cases for both methods', () => {
  const s = summaries(cases)
  assert.deepEqual(Object.keys(s.workflows), ['A', 'B'])
  const overall = s.overall
  assert.equal(overall.probe.n, 8)
  assert.equal(overall.noProbe.n, 8)
  within(overall.probe.medianLog, Math.log(1.5625))
  within(overall.probe.medianRel, (0.36 + 0.5625) / 2)
  assert.equal(overall.probe.within50, 0.5)
  within(overall.probe.multiplier90, 1 / 0.64)
  within(overall.noProbe.medianLog, Math.log(2.5))
  within(overall.noProbe.medianRel, 0.6)
  assert.equal(overall.noProbe.within50, 0.375)
  within(overall.noProbe.multiplier90, 5)
  const dollars = s.metrics.dollars
  assert.equal(dollars.probe.n, 2)
  within(dollars.probe.medianRel, (0.5625 + 0.36) / 2)
  within(dollars.noProbe.medianLog, (Math.log(3.2) + Math.log(5)) / 2)
  within(dollars.repriced.medianLog, Math.log(2))
  within(dollars.repriced.medianRel, (0.375 + 0.6) / 2)
  assert.equal(dollars.repriced.within50, 0.5)
  within(dollars.repriced.multiplier90, 2.5)
  assert.equal(s.metrics.output.repriced.n, 0)
})

test('tau check scales each dollar error by sqrt(1 + 1/k)', () => {
  const t = tauCheck(cases, 0.3)
  assert.equal(t.rows.length, 2)
  const e = Math.log(1.5625)
  within(t.rows[0].error, e)
  within(t.rows[1].error, -e)
  within(t.rows[0].sd, 0.3 * Math.SQRT2)
  within(t.rows[0].z, e / (0.3 * Math.SQRT2))
  within(t.implied, e / Math.SQRT2)
  within(t.expectedMedian, 0.6745 * 0.3 * Math.SQRT2)
  within(t.observedMedian, e)
  assert.equal(t.dof, 1)
})

test('a fit from fewer than two pairs gives no usable ratio', () => {
  const pairs = [...A.map((p) => ({ ...p, workflow: 'P' })), { ...A[0], workflow: 'Q' }]
  const result = leaveOneOut({ replays: { pairs }, prices })
  const p = result.find((c) => c.workflow === 'P')
  assert.equal(p.predictable, false)
  assert.equal(p.reason, 'the 1 pair(s) of the other workflows give no usable ratio')
  const q = result.find((c) => c.workflow === 'Q')
  assert.equal(q.predictable, true)
  assert.equal(q.metrics.output.actual, 100)
  within(q.metrics.output.ratio, 1.6)
})

test('a bucket without a bounded interval is not predictable but the others are', () => {
  const wide = (workflow, cacheRead) => pair(workflow, MEDIUM, [10, 100, cacheRead, 10], [20, 200, cacheRead * 2, 20])
  const pairs = [wide('F', 100), wide('F', 1000), ...A.map((p) => ({ ...p, workflow: 'G' }))]
  const g = leaveOneOut({ replays: { pairs }, prices }).find((c) => c.workflow === 'G')
  assert.equal(g.predictable, true)
  assert.equal(g.metrics.read, null)
  assert.match(g.unusable.read, /bounded and above zero/)
  within(g.metrics.output.ratio, 2)
  within(g.metrics.output.error, Math.log((2 * 300) / 480))
  within(g.metrics.dollars.ratio, 4)
  assert.deepEqual(Object.keys(g.unusable), ['read'])
})

test('a held-out workflow with no other workflow at all is not predictable', () => {
  const only = leaveOneOut({ replays: { pairs: B }, prices })
  assert.equal(only.length, 1)
  assert.equal(only[0].predictable, false)
  assert.equal(summaries(only).overall.probe.n, 0)
  assert.equal(tauCheck(only, 0.3).implied, null)
})

test('the report names what is not predictable', () => {
  const text = report({ cases, tau: 0.3 })
  assert.match(text, /Not predictable: C sonnet:high>opus:high \(2 pairs\): no other workflow measured this transition\./)
  assert.match(text, /fitted ratio/)
  assert.match(text, /no probe, repriced/)
})

test('node scripts/lowo.mjs runs without arguments and exits 0', () => {
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/lowo.mjs', import.meta.url))], { encoding: 'utf8' })
  assert.match(out, /Leave-one-workflow-out check/)
  assert.match(out, /Not predictable: w1 sonnet:high>opus:high/)
  assert.match(out, /tau implied by these errors/)
})
