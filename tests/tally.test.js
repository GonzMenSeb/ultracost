import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { createTally, noteTallyRun, countedRuns, overallInput, combine } from '../src/tally.mjs'
import { estimateRun } from '../src/savings.mjs'
import { loadPrices } from '../src/prices.mjs'
import { seedOf } from '../src/stats.mjs'
import { createMeter } from '../src/meter.mjs'
import { savedBlock } from '../src/savedText.mjs'

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'))
const ratios = read('ratios')
const prices = loadPrices(read('prices'))

const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const SONNET_XHIGH = { family: 'sonnet', effort: 'xhigh' }
const OPUS_HIGH = { family: 'opus', effort: 'high' }
const usage = { input: 2000, output: 40000, cacheRead: 300000, cacheWrite: 30000 }
const pieceOn = (family, effort) => ({ family, effort, ...usage })
const agentsOf = (key, n = 2, family = 'haiku', effort = 'high') =>
  Array.from({ length: n }, (_, i) => ({ agentId: `${key}-a${i}`, pieces: [pieceOn(family, effort)] }))
const runInfo = (key, over = {}) => ({
  key,
  status: 'completed',
  baseline: SONNET_XHIGH,
  agents: agentsOf(key),
  windows: { five_hour: 'A', seven_day: 'W' },
  at: 1000,
  ...over,
})
const tallyOf = (...runs) => runs.reduce((t, r) => noteTallyRun(t, r), createTally())
const keys = (runs) => runs.map((r) => r.key)
const intervals = (n) => Array.from({ length: n }, (_, i) => ({ d: 1, u: 0.5, c: 0.4, at: i }))
const meterWith = (over = {}) => ({
  ...createMeter(),
  subscription: true,
  last: { five_hour: { pct: 13, resetsAt: 'B' }, seven_day: { pct: 50, resetsAt: 'W' } },
  ...over,
})
const estimateGroups = (input, meter) =>
  input.groups.map((g) => {
    const one = (agents) =>
      estimateRun({
        agents,
        baseline: g.baseline,
        ratios,
        prices,
        meter: { subscription: meter.subscription, five_hour: intervals(8), seven_day: intervals(8) },
        seed: seedOf('overall'),
      })
    return { all: one(g.all), five_hour: one(g.five_hour), seven_day: one(g.seven_day) }
  })

test('createTally starts empty', () => {
  assert.deepEqual(createTally(), { v: 1, runs: {} })
})

test('noteTallyRun with the same key keeps one entry, replaced', () => {
  const first = tallyOf(runInfo('r1', { status: 'running' }))
  const t = noteTallyRun(first, runInfo('r1', { status: 'completed', at: 2000 }))
  assert.equal(Object.keys(t.runs).length, 1)
  assert.equal(t.runs.r1.status, 'completed')
  assert.equal(t.runs.r1.at, 2000)
  assert.equal(first.runs.r1.status, 'running')
})

test('noteTallyRun normalizes missing windows to null', () => {
  const t = noteTallyRun(createTally(), { ...runInfo('r1'), windows: undefined })
  assert.deepEqual(t.runs.r1.windows, { five_hour: null, seven_day: null })
})

test('noteTallyRun keeps 500 runs, drops the oldest and logs once', () => {
  let t = createTally()
  for (let i = 0; i < 500; i++) t = noteTallyRun(t, runInfo(`r${i}`, { at: 1000 + i }))
  const lines = []
  const log = (line) => lines.push(line)
  const replaced = noteTallyRun(t, runInfo('r7', { at: 5000 }), { log })
  assert.equal(Object.keys(replaced.runs).length, 500)
  assert.equal(lines.length, 0)
  const next = noteTallyRun(t, runInfo('new', { at: 9999 }), { log })
  assert.equal(Object.keys(next.runs).length, 500)
  assert.equal(next.runs.r0, undefined)
  assert.ok(next.runs.r1)
  assert.ok(next.runs.new)
  assert.equal(lines.length, 1)
})

test('countedRuns counts the runs of the current 5-hour window and shares a week stamp', () => {
  const t = tallyOf(runInfo('r1', { windows: { five_hour: 'A', seven_day: 'W' } }), runInfo('r2', { windows: { five_hour: 'B', seven_day: 'W' }, at: 2000 }))
  assert.deepEqual(keys(countedRuns(t, 'five_hour', 'B', 3000)), ['r2'])
  assert.deepEqual(keys(countedRuns(t, 'seven_day', 'W', 3000)), ['r1', 'r2'])
})

test('countedRuns falls back to the run age when a stamp is null', () => {
  const now = 100 * DAY
  const t = tallyOf(
    runInfo('young', { windows: { five_hour: null, seven_day: null }, at: now - 5 * HOUR + 60000 }),
    runInfo('old', { windows: { five_hour: 'A', seven_day: 'W' }, at: now - 5 * HOUR - 60000 }),
  )
  assert.deepEqual(keys(countedRuns(t, 'five_hour', null, now)), ['young'])
  assert.deepEqual(keys(countedRuns(t, 'five_hour', 'A', now)), ['old', 'young'])
  const w = tallyOf(
    runInfo('inside', { windows: { five_hour: null, seven_day: null }, at: now - 7 * DAY + 60000 }),
    runInfo('outside', { windows: { five_hour: null, seven_day: null }, at: now - 7 * DAY - 60000 }),
  )
  assert.deepEqual(keys(countedRuns(w, 'seven_day', 'W', now)), ['inside'])
})

test('countedRuns all counts every run, more than the 20 the run list keeps', () => {
  let t = createTally()
  for (let i = 0; i < 25; i++) t = noteTallyRun(t, runInfo(`r${i}`, { at: 1000 + i, windows: { five_hour: i % 2 ? 'A' : 'B', seven_day: 'W' } }))
  const all = countedRuns(t, 'all', null, 0)
  assert.equal(all.length, 25)
  assert.deepEqual(keys(all), Array.from({ length: 25 }, (_, i) => `r${i}`))
})

test('countedRuns orders by time, then key, not by insertion', () => {
  const t = tallyOf(runInfo('b', { at: 5 }), runInfo('10', { at: 5 }), runInfo('a', { at: 1 }))
  assert.deepEqual(keys(countedRuns(t, 'all', null, 0)), ['a', '10', 'b'])
})

test('overallInput splits the agents by baseline and scope', () => {
  const t = tallyOf(
    runInfo('r1', { baseline: SONNET_XHIGH, windows: { five_hour: 'A', seven_day: 'W' }, at: 1 }),
    runInfo('r2', { baseline: OPUS_HIGH, windows: { five_hour: 'B', seven_day: 'W' }, at: 2 }),
    runInfo('r3', { baseline: SONNET_XHIGH, windows: { five_hour: 'B', seven_day: 'W' }, at: 3 }),
    runInfo('r4', { baseline: null, at: 4 }),
  )
  const { groups } = overallInput(t, { five_hour: 'B', seven_day: 'W' }, 10)
  assert.deepEqual(
    groups.map((g) => g.baseline),
    [OPUS_HIGH, SONNET_XHIGH],
  )
  const ids = (list) => list.map((a) => a.agentId)
  const sonnet = groups[1]
  assert.deepEqual(ids(sonnet.all), ['r1-a0', 'r1-a1', 'r3-a0', 'r3-a1'])
  assert.deepEqual(ids(sonnet.five_hour), ['r3-a0', 'r3-a1'])
  assert.deepEqual(ids(sonnet.seven_day), ['r1-a0', 'r1-a1', 'r3-a0', 'r3-a1'])
  assert.deepEqual(sonnet.all[0].pieces, [pieceOn('haiku', 'high')])
  assert.deepEqual(ids(groups[0].five_hour), ['r2-a0', 'r2-a1'])
})

test('combine of one group is that group estimate as it is', () => {
  const meter = meterWith()
  const t = tallyOf(runInfo('r1', { windows: { five_hour: 'B', seven_day: 'W' } }), runInfo('r2', { windows: { five_hour: 'A', seven_day: 'W' }, at: 2000 }))
  const input = overallInput(t, { five_hour: 'B', seven_day: 'W' }, 3000)
  const estimates = estimateGroups(input, meter)
  const [e] = estimates
  const s = combine(estimates, { tally: t, meter, now: 3000 })
  assert.equal(s.status, 'estimated')
  assert.deepEqual(s.dollars, e.all.dollars)
  assert.deepEqual(s.tokens, e.all.tokens)
  assert.equal(s.baselineDollars, e.all.baselineDollars)
  assert.equal(s.actualDollars, e.all.actualDollars)
  assert.deepEqual(s.limits.five_hour, e.five_hour.limits.five_hour)
  assert.deepEqual(s.limits.seven_day, e.seven_day.limits.seven_day)
  assert.deepEqual(s.limits.readings, e.all.limits.readings)
  assert.notDeepEqual(e.five_hour.limits.five_hour, e.all.limits.five_hour)
  assert.deepEqual(s.baseline, SONNET_XHIGH)
  assert.equal(s.count, 2)
  assert.deepEqual(s.counted, { five_hour: 1, seven_day: 2 })
  assert.equal(s.running, false)
  assert.equal(s.subscription, true)
  assert.deepEqual(s.used, { five_hour: 13, seven_day: 50 })
  assert.deepEqual(s.transitions, [])
})

test('combine with two baselines adds the ends and recomputes the margin', () => {
  const meter = meterWith()
  const t = tallyOf(runInfo('r1', { baseline: SONNET_XHIGH, windows: { five_hour: 'B', seven_day: 'W' } }), runInfo('r2', { baseline: OPUS_HIGH, status: 'running', windows: { five_hour: 'B', seven_day: 'W' }, at: 2000 }))
  const input = overallInput(t, { five_hour: 'B', seven_day: 'W' }, 3000)
  const estimates = estimateGroups(input, meter)
  const s = combine(estimates, { tally: t, meter, now: 3000 })
  const sum = (pick) => estimates.reduce((n, e) => n + pick(e), 0)
  assert.equal(s.dollars.mid, sum((e) => e.all.dollars.mid))
  assert.equal(s.dollars.lo, sum((e) => e.all.dollars.lo))
  assert.equal(s.dollars.hi, sum((e) => e.all.dollars.hi))
  assert.equal(s.dollars.pm, Math.max(s.dollars.mid - s.dollars.lo, s.dollars.hi - s.dollars.mid))
  assert.equal(s.limits.five_hour.mid, sum((e) => e.five_hour.limits.five_hour.mid))
  assert.equal(s.limits.seven_day.hi, sum((e) => e.seven_day.limits.seven_day.hi))
  assert.equal(s.baselineDollars, sum((e) => e.all.baselineDollars))
  assert.equal(s.actualDollars, sum((e) => e.all.actualDollars))
  assert.equal(s.tokens.saved, sum((e) => e.all.tokens.saved))
  assert.equal(s.baseline, null)
  assert.equal(s.running, true)
  assert.equal(s.count, 2)
})

test('combine keeps a group with an empty window in the all totals', () => {
  const meter = meterWith()
  const t = tallyOf(runInfo('r1', { windows: { five_hour: 'A', seven_day: 'W' } }))
  const input = overallInput(t, { five_hour: 'B', seven_day: 'W' }, 3000)
  const estimates = estimateGroups(input, meter)
  assert.equal(estimates[0].five_hour.status, 'unknown')
  const s = combine(estimates, { tally: t, meter, now: 3000 })
  assert.equal(s.status, 'estimated')
  assert.deepEqual(s.dollars, estimates[0].all.dollars)
  assert.deepEqual(s.limits.five_hour, { mid: 0, lo: 0, hi: 0, pm: 0 })
  assert.deepEqual(s.counted, { five_hour: 0, seven_day: 1 })
})

test('combine keeps learning for an empty window that has too few readings', () => {
  const meter = meterWith()
  const t = tallyOf(runInfo('r1', { windows: { five_hour: 'A', seven_day: 'W' } }))
  const input = overallInput(t, { five_hour: 'B', seven_day: 'W' }, 3000)
  const estimates = estimateGroups(input, meter)
  estimates[0].all.limits.readings = { five_hour: 3, seven_day: 8 }
  const s = combine(estimates, { tally: t, meter, now: 3000 })
  assert.equal(s.limits.five_hour, null)
})

test('combine takes the zero range of a window whose agents all ran on the baseline', () => {
  const meter = meterWith()
  const t = tallyOf(
    runInfo('old', { windows: { five_hour: 'A', seven_day: 'W' } }),
    runInfo('new', { agents: agentsOf('new', 2, 'sonnet', 'xhigh'), windows: { five_hour: 'B', seven_day: 'W' }, at: 2000 })
  )
  const input = overallInput(t, { five_hour: 'B', seven_day: 'W' }, 3000)
  const estimates = estimateGroups(input, meter)
  assert.equal(estimates[0].five_hour.status, 'none')
  const s = combine(estimates, { tally: t, meter, now: 3000 })
  assert.deepEqual(s.limits.five_hour, estimates[0].five_hour.limits.five_hour)
  assert.notEqual(s.limits.five_hour, null)
})

test('combine leaves out groups that are not estimated', () => {
  const meter = meterWith()
  const t = tallyOf(
    runInfo('r1', { baseline: SONNET_XHIGH, agents: agentsOf('r1', 2, 'sonnet', 'xhigh') }),
    runInfo('r2', { baseline: OPUS_HIGH, at: 2000 }),
  )
  const input = overallInput(t, { five_hour: 'A', seven_day: 'W' }, 3000)
  const estimates = estimateGroups(input, meter)
  const opus = estimates[input.groups.findIndex((g) => g.baseline.family === 'opus')]
  const s = combine(estimates, { tally: t, meter, now: 3000 })
  assert.deepEqual(s.dollars, opus.all.dollars)
  assert.deepEqual(s.baseline, OPUS_HIGH)
  assert.equal(s.count, 2)
})

test('combine with no estimated group is unknown with the count', () => {
  const meter = meterWith()
  const t = tallyOf(runInfo('r1', { agents: agentsOf('r1', 2, 'sonnet', 'xhigh') }), runInfo('r2', { baseline: null, at: 2000 }))
  const estimates = estimateGroups(overallInput(t, { five_hour: 'A', seven_day: 'W' }, 3000), meter)
  assert.deepEqual(combine(estimates, { tally: t, meter, now: 3000 }), { status: 'unknown', count: 2, running: false })
  assert.deepEqual(combine([], { tally: createTally(), meter, now: 0 }), { status: 'unknown', count: 0, running: false })
})

test('combine with no estimated group still says a run is going', () => {
  const meter = meterWith()
  const t = tallyOf(runInfo('r1', { status: 'running', agents: agentsOf('r1', 2, 'sonnet', 'xhigh') }))
  const estimates = estimateGroups(overallInput(t, { five_hour: 'A', seven_day: 'W' }, 3000), meter)
  assert.deepEqual(combine(estimates, { tally: t, meter, now: 3000 }), { status: 'unknown', count: 1, running: true })
})

test('combine off a subscription has no limits and no used figures', () => {
  const meter = { ...createMeter(), subscription: false }
  const t = tallyOf(runInfo('r1'))
  const estimates = estimateGroups(overallInput(t, { five_hour: null, seven_day: null }, 3000), meter)
  const s = combine(estimates, { tally: t, meter, now: 3000 })
  assert.equal(s.limits, null)
  assert.equal(s.subscription, false)
  assert.deepEqual(s.used, { five_hour: null, seven_day: null })
  assert.deepEqual(s.dollars, estimates[0].all.dollars)
})

test('combine output carries what the saved block reads', () => {
  const text = (lines) => lines.map((l) => l.map((s) => s.text).join(''))
  const t = tallyOf(runInfo('r1', { baseline: SONNET_XHIGH }), runInfo('r2', { baseline: OPUS_HIGH, at: 2000 }))
  for (const meter of [meterWith({ last: { five_hour: { pct: 13, resetsAt: 'A' }, seven_day: { pct: 50, resetsAt: 'W' } } }), { ...createMeter(), subscription: false }]) {
    const input = overallInput(t, { five_hour: 'A', seven_day: 'W' }, 3000)
    const one = combine(estimateGroups(input, meter).slice(0, 1), { tally: t, meter, now: 3000 })
    const two = combine(estimateGroups(input, meter), { tally: t, meter, now: 3000 })
    const row = meter.subscription ? /^5-hour/ : /^cost/
    assert.ok(text(savedBlock(one, { width: 56 })).some((l) => row.test(l.trim())))
    assert.ok(text(savedBlock({ ...two, baseline: SONNET_XHIGH }, { width: 56 })).some((l) => row.test(l.trim())))
  }
})

test('combine with two baselines adds the coverage and merges the sources', () => {
  const meter = meterWith()
  const t = tallyOf(runInfo('r1', { baseline: SONNET_XHIGH }), runInfo('r2', { baseline: OPUS_HIGH, agents: agentsOf('r2', 3), at: 2000 }))
  const estimates = estimateGroups(overallInput(t, { five_hour: 'A', seven_day: 'W' }, 3000), meter)
  const s = combine(estimates, { tally: t, meter, now: 3000 })
  assert.equal(s.coverage.total, 5)
  assert.equal(s.coverage.used, estimates[0].all.coverage.used + estimates[1].all.coverage.used)
  assert.equal(s.sources.measuredPairs, estimates[0].all.sources.measuredPairs + estimates[1].all.sources.measuredPairs)
  const one = combine(estimates.slice(0, 1), { tally: t, meter, now: 3000 })
  assert.deepEqual(one.coverage, estimates[0].all.coverage)
  assert.deepEqual(one.sources, estimates[0].all.sources)
})

test('estimateRun over 300 pooled agents at 4000 draws', (t) => {
  const agents = Array.from({ length: 300 }, (_, i) => ({ agentId: `a${i}`, pieces: [pieceOn('sonnet', 'high')] }))
  const many = Array.from({ length: 200 }, (_, i) => ({ d: 1, u: 0.5, c: 0.4, at: i }))
  const once = () =>
    estimateRun({
      agents,
      baseline: OPUS_HIGH,
      ratios,
      prices,
      meter: { subscription: true, five_hour: many, seven_day: many },
      seed: seedOf('overall'),
      draws: 4000,
    })
  assert.equal(once().status, 'estimated')
  const times = Array.from({ length: 5 }, () => {
    const start = performance.now()
    once()
    return performance.now() - start
  }).sort((a, b) => a - b)
  const median = times[2]
  t.diagnostic(`one call ${median.toFixed(0)} ms, three scopes ${(3 * median).toFixed(0)} ms, over 250 ms: ${median > 250}`)
})
