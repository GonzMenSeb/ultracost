import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  tokenRatios,
  candidateRatios,
  truthOf,
  predictedDollars,
  scoreCases,
  summaryOf,
  pickOf,
  crossRows,
  priceClassRatios,
  backtest,
  report,
} from '../scripts/priors.mjs'
import { loadPrices } from '../src/prices.mjs'

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'))
const within = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b} (±${tol})`)
const usage = ([input, output, cacheRead, cacheWrite]) => ({ input, output, cacheRead, cacheWrite })
const BUCKETS = ['output', 'fresh', 'read']

const prices = {
  families: {
    haiku: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    sonnet: { input: 2, output: 10, cacheRead: 0.5, cacheWrite: 2.5 },
  },
}
const wholeIndex = {
  haiku: { efforts: { high: { outputTokens: 100, inputTokens: 1000 } } },
  sonnet: { efforts: { high: { outputTokens: 400, inputTokens: 2500 } } },
}
const KEY = 'haiku:high>sonnet:high'
const priors = { [KEY]: { mu: Math.log(1.5), sd: 0.6, sources: 2 }, 'haiku:high>sonnet:low': { mu: 0, sd: 0.6, sources: 1 } }
const ctx = { priors, wholeIndex, prices }
const pair = (workflow, actual, baseline) => ({ workflow, kind: 'k', from: 'haiku:high', to: 'sonnet:high', actual: usage(actual), baseline: usage(baseline) })
const pairs = [pair('w', [10, 100, 1000, 50], [20, 300, 4000, 100]), pair('w', [30, 200, 3000, 150], [60, 500, 8000, 300])]

test('token ratios are the baseline run over the actual run for output and total input', () => {
  assert.deepEqual(tokenRatios(wholeIndex, 'haiku:high', 'sonnet:high'), { output: 4, input: 2.5 })
  assert.equal(tokenRatios(wholeIndex, 'haiku:high', 'sonnet:low'), null)
  assert.equal(tokenRatios(wholeIndex, 'haiku:high', 'fable:high'), null)
})

test('the four candidates, hand computed: the cost ratio is 1.5 x the input price ratio 2 = 3', () => {
  const c = candidateRatios(KEY, ctx)
  assert.deepEqual(c.current, { output: 1.5, fresh: 1.5, read: 1.5 })
  within(c.A.output, 4)
  within(c.A.fresh, 4 ** 0.77)
  within(c.A.read, 2.5)
  assert.deepEqual(c.A2, { output: 4, fresh: 2.5, read: 2.5 })
  within(c.B.output, 3 / 2)
  within(c.B.fresh, 3 / 2)
  within(c.B.read, 3 / 5)
})

test('a configuration without token data leaves A and A2 out, and a key without a prior has no candidates', () => {
  const c = candidateRatios('haiku:high>sonnet:low', ctx)
  assert.equal(c.A, null)
  assert.equal(c.A2, null)
  within(c.current.output, 1)
  within(c.B.read, 2 / 5)
  assert.equal(candidateRatios('sonnet:high>haiku:high', ctx), null)
})

test('truth is the sum of the baseline over the sum of the actual per bucket, fresh being input plus cache write', () => {
  const [t] = truthOf(pairs, prices)
  assert.equal(t.workflow, 'w')
  assert.equal(t.transition, KEY)
  within(t.ratios.output, 800 / 300)
  within(t.ratios.fresh, 480 / 240)
  within(t.ratios.read, 12000 / 4000)
  within(t.dollars, (20 * 2 + 300 * 10 + 4000 * 0.5 + 100 * 2.5 + 60 * 2 + 500 * 10 + 8000 * 0.5 + 300 * 2.5) / 1e6)
})

test('truth keeps a workflow on two transitions apart', () => {
  const other = { ...pair('w', [1, 1, 1, 1], [2, 2, 2, 2]), to: 'sonnet:low' }
  const list = truthOf([...pairs, other, pair('x', [1, 2, 3, 4], [4, 3, 2, 1])], prices)
  assert.deepEqual(list.map((t) => `${t.workflow} ${t.transition}`), ['w haiku:high>sonnet:high', 'w haiku:high>sonnet:low', 'x haiku:high>sonnet:high'])
})

test('predicted dollars price the scaled actual tokens at the baseline family, per pair', () => {
  within(predictedDollars(pairs, { output: 4, fresh: 2.5, read: 2.5 }, prices), (25 * 2 + 400 * 10 + 2500 * 0.5 + 125 * 2.5 + 75 * 2 + 800 * 10 + 7500 * 0.5 + 375 * 2.5) / 1e6)
  within(predictedDollars(pairs, { output: 1.5, fresh: 1.5, read: 0.6 }, prices), 6570 / 1e6)
})

test('the ln error of each bucket and of the dollars is ln(candidate / truth)', () => {
  const truth = truthOf(pairs, prices)
  const [c] = scoreCases({ truth, ...ctx })
  const a2 = c.byCandidate.A2.errors
  within(a2.output, Math.log(4 / (8 / 3)))
  within(a2.fresh, Math.log(2.5 / 2))
  within(a2.read, Math.log(2.5 / 3))
  within(a2.dollars, Math.log(18450 / 15160))
  within(c.byCandidate.B.errors.read, Math.log(0.6 / 3))
  within(c.byCandidate.B.errors.dollars, Math.log(6570 / 15160))
  within(c.byCandidate.current.errors.output, Math.log(1.5 / (8 / 3)))
})

test('the summary is the mean absolute ln error over bucket cases, and over dollars separately', () => {
  const truth = [...truthOf(pairs, prices), ...truthOf([pair('x', [1, 1, 1, 1], [3, 3, 3, 3])], prices)]
  const cases = scoreCases({ truth, ...ctx })
  const s = summaryOf(cases)
  assert.equal(s.A2.cases, 6)
  const first = [Math.log(1.5), Math.log(1.25), Math.log(3 / 2.5)]
  const second = [Math.log(4 / 3), Math.log(2.5 / 3), Math.log(2.5 / 3)]
  within(s.A2.buckets, (first.reduce((t, x) => t + x, 0) + second.reduce((t, x) => t + Math.abs(x), 0)) / 6)
  within(s.A2.perBucket.output, (first[0] + second[0]) / 2)
  within(s.A2.dollars, (Math.log(18450 / 15160) + Math.log(52.5 / 45)) / 2)
})

test('the pick is the lowest bucket error, and among those within 0.02 of it the lowest dollar error', () => {
  const of = (...rows) => Object.fromEntries(['current', 'A', 'A2', 'B'].map((name, i) => [name, { buckets: rows[i][0], dollars: rows[i][1] }]))
  assert.equal(pickOf(of([0.284, 0.177], [0.22, 0.205], [0.216, 0.161], [0.284, 0.177])), 'A2')
  assert.equal(pickOf(of([0.3, 0.2], [0.25, 0.1], [0.235, 0.15], [0.3, 0.2])), 'A')
  assert.equal(pickOf(of([0.3, 0.2], [0.26, 0.1], [0.235, 0.15], [0.3, 0.2])), 'A2')
  assert.equal(pickOf(of([0.2, 0.3], [0.3, 0.1], [0.25, 0.1], [0.2, 0.3])), 'current')
  assert.equal(pickOf(of([0.31, 0.2], [null, null], [null, null], [0.28, 0.25])), 'B')
  assert.equal(pickOf(of([0.3, 0.2], [null, null], [null, null], [0.28, 0.25])), 'current')
})

test('price class ratios, and the cross-family rows follow the shown efforts and family pairs', () => {
  assert.deepEqual(priceClassRatios(prices, 'haiku', 'sonnet'), { output: 2, input: 2, cacheRead: 5, cacheWrite: 2 })
  const rows = crossRows({
    priors: { ...priors, 'sonnet:high>haiku:high': priors[KEY], 'sonnet:low>haiku:high': priors[KEY], 'haiku:high>fable:high': priors[KEY] },
    wholeIndex,
    prices: { families: { ...prices.families, fable: prices.families.sonnet } },
  })
  assert.deepEqual(rows.map((r) => r.key), [KEY, 'sonnet:high>haiku:high'])
})

test('on the shipped data the backtest is 3 workflows on 2 transitions, A2 is picked and B equals current', () => {
  const b = backtest({ replays: read('replays'), published: read('published'), prices: loadPrices(read('prices')) })
  assert.deepEqual(b.truth.map((t) => `${t.workflow} ${t.transition}`), ['w1 sonnet:high>opus:high', 'w2 sonnet:high>opus:medium', 'w3 sonnet:high>opus:medium'])
  assert.equal(b.summary.current.cases, 9)
  within(b.summary.current.buckets, 0.284, 0.001)
  within(b.summary.A.buckets, 0.22, 0.001)
  within(b.summary.A2.buckets, 0.216, 0.001)
  within(b.summary.current.dollars, 0.177, 0.001)
  within(b.summary.A.dollars, 0.205, 0.001)
  within(b.summary.A2.dollars, 0.161, 0.001)
  assert.equal(b.pick, 'A2')
  for (const c of b.cases) {
    for (const name of BUCKETS) within(c.byCandidate.B.ratios[name], c.byCandidate.current.ratios[name], 1e-12)
  }
  assert.equal(b.cross.length, 36)
  const row = b.cross.find((r) => r.key === 'haiku:high>opus:xhigh')
  within(row.ratios.A.output, 1.125, 0.001)
  within(row.ratios.A.fresh, 1.095, 0.001)
  within(row.ratios.A.read, 1.634, 0.001)
  within(row.ratios.current.output, 0.972, 0.001)
})

test('the candidate for the pick equals the shipped prior buckets, and Fable pairs have none', () => {
  const shipped = read('ratios').priors
  const published = read('published')
  const wholeIndex = Object.fromEntries(['opus', 'sonnet', 'haiku', 'fable'].map((f) => [f, published.sources.find((s) => s.wholeIndex?.[f])?.wholeIndex[f]]))
  const p = loadPrices(read('prices'))
  let checked = 0
  for (const [key, prior] of Object.entries(shipped)) {
    const c = candidateRatios(key, { priors: shipped, wholeIndex, prices: p })
    if (!prior.output) {
      assert.equal(c.A2, null, key)
      continue
    }
    for (const name of BUCKETS) within(c.A2[name], Math.exp(prior[name].mu), 1e-7)
    within(c.current.output, Math.exp(prior.mu), 1e-12)
    checked++
  }
  assert.ok(checked > 80)
})

test('cache write is 1.25 times input in every family, so the fresh price ratio is the input price ratio', () => {
  const families = read('prices').families
  for (const a of ['opus', 'sonnet', 'haiku', 'fable']) {
    for (const b of ['opus', 'sonnet', 'haiku', 'fable']) {
      const r = priceClassRatios({ families }, a, b)
      within(r.cacheWrite, r.input, 1e-9)
    }
  }
})

test('the report states the limits of the backtest and the pick', () => {
  const b = backtest({ replays: read('replays'), published: read('published'), prices: loadPrices(read('prices')) })
  const text = report(b)
  assert.match(text, /3 workflows on 2 transitions/)
  assert.match(text, /all Sonnet to Opus/)
  assert.match(text, /B equals current here/)
  assert.match(text, /no Haiku pair/)
  assert.match(text, /Pick: A/)
})

test('node scripts/priors.mjs runs without arguments and exits 0', () => {
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/priors.mjs', import.meta.url))], { encoding: 'utf8' })
  assert.match(out, /Cross-family prior backtest: 3 workflows on 2 transitions/)
  assert.match(out, /Pick: A/)
  assert.match(out, /haiku:high>opus:xhigh/)
  assert.match(out, /sonnet:xhigh>haiku:xhigh/)
})
