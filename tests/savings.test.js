import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { configOf, ratioFor, estimateRun } from '../src/savings.mjs'
import { loadPrices } from '../src/prices.mjs'
import { seedOf } from '../src/stats.mjs'

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'))
const ratios = read('ratios')
const prices = loadPrices(read('prices'))
const replays = read('replays')

const sum = (workflow) =>
  replays.pairs
    .filter((p) => p.workflow === workflow)
    .reduce(
      (t, p) => ({
        input: t.input + p.actual.input,
        output: t.output + p.actual.output,
        cacheRead: t.cacheRead + p.actual.cacheRead,
        cacheWrite: t.cacheWrite + p.actual.cacheWrite,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    )
const piece = (usage, family = 'sonnet', effort = 'high') => ({ family, effort, ...usage })
const agent = (agentId, ...pieces) => ({ agentId, pieces })
const intervals = (n) => Array.from({ length: n }, (_, i) => ({ d: 1, u: 0.5, c: 0.4, at: i }))
const noMeter = { subscription: null, five_hour: [], seven_day: [] }
const run = (over) =>
  estimateRun({
    agents: [agent('a1', piece(sum('w1')))],
    baseline: { family: 'opus', effort: 'high' },
    ratios,
    prices,
    meter: noMeter,
    seed: seedOf('run-1'),
    running: false,
    ...over,
  })
const split = (usage, n) =>
  Array.from({ length: n }, (_, i) =>
    agent(`a${i}`, piece(Object.fromEntries(Object.entries(usage).map(([k, v]) => [k, v / n])))),
  )

test('an agent on the baseline configuration saves exactly 0', () => {
  const s = run({ agents: [agent('a1', piece(sum('w1'), 'opus', 'high'))] })
  assert.equal(s.status, 'none')
  assert.equal(s.dollars.mid, 0)
  assert.equal(s.dollars.pm, 0)
  assert.equal(s.tokens.saved, 0)
})

test('a measured transition reproduces the replay ratio', () => {
  const s = run()
  assert.equal(s.status, 'estimated')
  const r = s.baselineDollars / s.actualDollars
  assert.ok(r > 2.2 && r < 3.1, `ratio ${r}`)
  assert.ok(s.dollars.lo > 0)
  assert.equal(s.sources.measuredPairs, 4)
  assert.deepEqual(s.coverage, { used: 1, total: 1, unpriced: 0, noRatio: [] })
})

test('the shared error does not shrink as agents are added', () => {
  const one = run().dollars
  const ten = run({ agents: split(sum('w1'), 10) }).dollars
  assert.ok(ten.pm / ten.mid >= 0.6 * (one.pm / one.mid), `${ten.pm / ten.mid} vs ${one.pm / one.mid}`)
})

test('same seed, same numbers; different run keys give different draws', () => {
  assert.deepEqual(run(), run())
  assert.notDeepEqual(run().dollars, run({ seed: seedOf('run-2') }).dollars)
})

test('a numeric or missing effort makes the agent unknown', () => {
  for (const effort of [16000, null, undefined]) {
    const s = run({ agents: [agent('a1', { ...piece(sum('w1')), effort })] })
    assert.equal(s.status, 'unknown')
    assert.equal(s.why, 'no-agents')
    assert.equal(s.coverage.used, 0)
    assert.equal(s.coverage.total, 1)
    assert.equal(s.dollars, null)
  }
})

test('an unpriced model is counted, not guessed', () => {
  const s = run({ agents: [agent('a1', piece(sum('w1'))), agent('a2', piece(sum('w1'), null, 'high'))] })
  assert.equal(s.coverage.unpriced, 1)
  assert.equal(s.coverage.used, 1)
  assert.equal(s.coverage.total, 2)
  assert.equal(s.agents.find((a) => a.agentId === 'a2').dollars, null)
})

test('an agent with no usage is not used and not an error', () => {
  const s = run({ agents: [agent('a1', piece(sum('w1'))), agent('a2')] })
  assert.deepEqual(s.coverage, { used: 1, total: 2, unpriced: 0, noRatio: [] })
})

test('no baseline is unknown', () => {
  const s = run({ baseline: null })
  assert.equal(s.status, 'unknown')
  assert.equal(s.why, 'no-baseline')
  assert.equal(s.baseline, null)
})

test('sonnet at high can use more tokens and still save money', () => {
  const s = run({ agents: [agent('a1', piece(sum('w2')))], baseline: { family: 'opus', effort: 'medium' } })
  assert.ok(s.tokens.saved < 0, `tokens ${s.tokens.saved}`)
  assert.ok(s.dollars.mid > 0)
})

test('xhigh is chained from the measured high ratio', () => {
  const r = ratioFor(ratios, 'sonnet:high', 'opus:xhigh')
  assert.equal(r.source, 'chained')
  assert.equal(r.via, 'high')
  const s = run({ baseline: { family: 'opus', effort: 'xhigh' } })
  assert.deepEqual(s.sources.chained, [{ from: 'sonnet:high', to: 'opus:xhigh', via: 'high' }])
})

test('a fable session falls back to the published prior', () => {
  const r = ratioFor(ratios, 'sonnet:high', 'fable:high')
  assert.equal(r.source, 'prior')
  assert.equal(r.tau, 0)
  assert.equal(ratioFor(ratios, 'sonnet:high', 'sonnet:high').source, 'identical')
  assert.equal(ratioFor(ratios, 'sonnet:high', 'sonnet:xhigh'), null)
  assert.equal(ratioFor(ratios, 'sonnet:high', 'opus:high').source, 'measured')
})

test('transitions record each source and ratio', () => {
  const [t] = run().transitions
  assert.equal(t.from, 'sonnet:high')
  assert.equal(t.to, 'opus:high')
  assert.equal(t.source, 'measured')
  assert.equal(t.pairs, 4)
  assert.ok(Math.abs(Math.exp(t.read.mu) - 2.29) < 0.01)
  assert.deepEqual(run({ baseline: null }).transitions, [])
})

test('configOf is null unless the family is priced and the effort is a label', () => {
  assert.equal(configOf('opus', 'high'), 'opus:high')
  assert.equal(configOf('opus', 16000), null)
  assert.equal(configOf(null, 'high'), null)
  assert.equal(configOf('mythos', 'high'), null)
})

test('limits need five readings', () => {
  const at = (n) => run({ meter: { subscription: true, five_hour: intervals(n), seven_day: intervals(7) } }).limits
  assert.equal(at(4).five_hour, null)
  assert.equal(at(4).readings.five_hour, 4)
  const five = at(5).five_hour
  assert.ok(five.mid > 0 && five.lo <= five.mid && five.mid <= five.hi)
  assert.ok(at(5).seven_day.mid > 0)
})

test('limits are absent off a subscription and before a first reading', () => {
  assert.equal(run({ meter: { subscription: false, five_hour: intervals(9), seven_day: intervals(9) } }).limits, null)
  assert.equal(run({ meter: { subscription: null, five_hour: intervals(9), seven_day: intervals(9) } }).limits, null)
  assert.equal(run({ meter: { subscription: false, five_hour: [], seven_day: [] } }).subscription, false)
})

test('per-agent medians add up to roughly the run median', () => {
  const s = run({
    agents: split(sum('w1'), 4),
    meter: { subscription: true, five_hour: intervals(6), seven_day: intervals(6) },
  })
  const total = s.agents.reduce((t, a) => t + a.dollars, 0)
  assert.ok(Math.abs(total - s.dollars.mid) / s.dollars.mid < 0.15)
  assert.ok(s.agents.every((a) => a.five_hour > 0))
})

test('haiku usage priced per long request stays priced per long request', () => {
  const small = { input: 50000, output: 1000, cacheRead: 0, cacheWrite: 0 }
  const a = run({ agents: [agent('a1', piece(small, 'haiku', 'xhigh')), agent('a2', { ...piece(small, 'haiku', 'xhigh'), long: true })] })
  assert.ok(Math.abs(a.actualDollars - (0.0055 + 0.0275)) < 1e-9, `${a.actualDollars}`)
})

test('4,000 draws over 50 agents finish in under 250 ms', () => {
  const agents = split(sum('w1'), 50)
  const meter = { subscription: true, five_hour: intervals(200), seven_day: intervals(200) }
  run({ agents: agents.slice(0, 2), meter, draws: 200 })
  const t = performance.now()
  run({ agents, meter })
  const ms = performance.now() - t
  assert.ok(ms < 250, `${ms.toFixed(0)} ms`)
})
