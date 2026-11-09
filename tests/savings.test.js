import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { configOf, ratioFor, estimateRun } from '../src/savings.mjs'
import { loadPrices, meterUnits } from '../src/prices.mjs'
import { seedOf } from '../src/stats.mjs'
import { createMeter } from '../src/meter.mjs'
import { combine, countedRuns, createTally, noteTallyRun, overallInput } from '../src/tally.mjs'
import { overallBlock, savedBlock } from '../src/savedText.mjs'

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
test('a version price row keys its ratios by its family, and stays priced at its own row', () => {
  assert.equal(configOf('opus-5', 'high'), 'opus:high')
  assert.equal(configOf('fable-5-2', 'medium'), 'fable:medium')
  assert.equal(configOf('sonnet-5', 'max'), 'sonnet:max')
  assert.equal(configOf('mythos-5', 'high'), null)
  const usage = sum('w1')
  const onRow = run({ agents: [agent('a1', piece(usage, 'sonnet-5'))], baseline: { family: 'opus-5', effort: 'high' } })
  assert.equal(onRow.status, 'estimated')
  assert.equal(onRow.coverage.used, 1)
  const onFamily = run({ agents: [agent('a1', piece(usage, 'sonnet'))], baseline: { family: 'opus', effort: 'high' } })
  assert.equal(onFamily.status, 'estimated')
  assert.notEqual(onRow.actualDollars, onFamily.actualDollars)
  assert.notEqual(onRow.baselineDollars, onFamily.baselineDollars)
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

test('an opus agent at another effort is estimated from the published effort step', () => {
  const s = run({ agents: [agent('a1', piece(sum('w1'), 'opus', 'medium'))] })
  assert.equal(s.status, 'estimated')
  assert.ok(s.dollars.mid > 0)
  assert.deepEqual(s.sources.priors, [{ from: 'opus:medium', to: 'opus:high' }])
  assert.equal(s.coverage.used, 1)
})

test('none means nothing was left out: an excluded agent makes it an estimate', () => {
  const same = agent('a1', piece(sum('w1'), 'opus', 'high'))
  const unreadable = agent('a2', { ...piece(sum('w1'), 'sonnet'), effort: 16000 })
  const left = run({ agents: [same, unreadable] })
  assert.equal(left.status, 'estimated')
  assert.deepEqual(left.coverage, { used: 1, total: 2, unpriced: 0, noRatio: ['sonnet:?>opus:high'] })
  assert.equal(run({ agents: [same, agent('a2')] }).status, 'none')
  assert.equal(run({ agents: [same, agent('a2', piece(sum('w1'), null, 'high'))] }).status, 'estimated')
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
  const step = ratioFor(ratios, 'opus:medium', 'opus:high')
  assert.equal(step.source, 'prior')
  assert.equal(step.tau, 0)
  assert.ok(Math.abs(step.output.mu - ratios.steps.opus['medium>high'].mu) < 1e-9)
  assert.equal(step.output.sigma, ratios.steps.opus['medium>high'].sd)
  assert.equal(ratioFor(ratios, 'sonnet:high', 'sonnet:xhigh').source, 'prior')
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

test('4,000 draws over 50 agents finish in under a second', () => {
  const agents = split(sum('w1'), 50)
  const meter = { subscription: true, five_hour: intervals(200), seven_day: intervals(200) }
  run({ agents: agents.slice(0, 2), meter, draws: 200 })
  const t = performance.now()
  run({ agents, meter })
  const ms = performance.now() - t
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms`)
})

test('a group saves what its agents save, per draw', () => {
  const agents = split(sum('w1'), 3)
  const groups = [
    { key: 'all', agentIds: ['a0', 'a1', 'a2'] },
    { key: 'one', agentIds: ['a1'] },
    { key: 'none', agentIds: ['missing', 'gone'] },
    { key: 'empty', agentIds: [] },
  ]
  const s = run({ agents, groups })
  const by = Object.fromEntries(s.groups.map((g) => [g.key, g]))
  assert.ok(Math.abs(by.all.dollars - s.dollars.mid) < 1e-9)
  assert.ok(Math.abs(by.one.dollars - s.agents[1].dollars) < 1e-9)
  assert.deepEqual([by.all.used, by.all.total, by.one.used, by.one.total], [3, 3, 1, 1])
  assert.deepEqual(by.none, { key: 'none', dollars: null, five_hour: null, used: 0, total: 2 })
  assert.deepEqual(by.empty, { key: 'empty', dollars: null, five_hour: null, used: 0, total: 0 })
})

test('group limit points are the sum of the agent points', () => {
  const agents = split(sum('w1'), 2)
  const s = run({ agents, groups: [{ key: 'all', agentIds: ['a0', 'a1'] }], meter: { subscription: true, five_hour: intervals(6), seven_day: intervals(2) } })
  assert.ok(s.agents[0].five_hour !== null)
  assert.ok(Math.abs(s.groups[0].five_hour - (s.agents[0].five_hour + s.agents[1].five_hour)) < 0.05 * s.groups[0].five_hour)
  const learning = run({ agents, groups: [{ key: 'all', agentIds: ['a0', 'a1'] }], meter: { subscription: true, five_hour: intervals(2), seven_day: intervals(2) } })
  assert.equal(learning.groups[0].five_hour, null)
})

test('no groups leaves the figures as they were and returns an empty list', () => {
  const s = run()
  assert.deepEqual(s.groups, [])
  assert.deepEqual(run({ groups: [{ key: 'g', agentIds: ['a1'] }] }).dollars, s.dollars)
})

test('groups come back unknown when nothing can be estimated', () => {
  const s = run({ baseline: null, groups: [{ key: 'g', agentIds: ['a1'] }] })
  assert.equal(s.status, 'unknown')
  assert.deepEqual(s.groups, [{ key: 'g', dollars: null, five_hour: null, used: 0, total: 1 }])
})

const unitsOf = meterUnits(prices, 'sonnet', sum('w1'))
const spendAtMidW = (unitsOf.u + 0.05 * unitsOf.c) / (0.5 + 0.05 * 0.4)
const subscribed = (rise) => ({ subscription: true, five_hour: intervals(8), seven_day: intervals(8), ...(rise === undefined ? {} : { rise }) })
const bounded = (rise, over = {}) => run({ meter: subscribed(rise), ...over })
const rowsOf = (block) => block.map((l) => l.map((x) => x.text).join(''))

const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))
const scaledRange = (r, base, f) => near(r.mid, base.mid * f) && near(r.lo, base.lo * f) && near(r.hi, base.hi * f)
const opts = { agents: split(sum('w1'), 2), groups: [{ key: 'all', agentIds: ['a0', 'a1'] }] }

test('a figure whose spend exceeds the account rise plus one point is scaled down to it', () => {
  const plain = bounded(undefined, opts)
  const s = bounded({ five_hour: spendAtMidW - 1 - 0.1, seven_day: null }, opts)
  const f = s.limits.clamp.five_hour
  assert.ok(f > 0 && f < 1, String(f))
  assert.equal(s.limits.clamp.seven_day, null)
  assert.ok(scaledRange(s.limits.five_hour, plain.limits.five_hour, f))
  assert.deepEqual(s.limits.seven_day, plain.limits.seven_day)
  s.agents.forEach((a, i) => assert.ok(near(a.five_hour, plain.agents[i].five_hour * f)))
  assert.ok(near(s.groups[0].five_hour, plain.groups[0].five_hour * f))
  assert.deepEqual(s.dollars, plain.dollars)
})

test('a figure whose spend is within the account rise plus one point is kept as it is', () => {
  const plain = bounded(undefined, opts)
  const s = bounded({ five_hour: spendAtMidW - 1 + 0.1, seven_day: spendAtMidW - 1 + 0.1 }, opts)
  assert.deepEqual(s.limits, plain.limits)
  assert.deepEqual(s.limits.clamp, { five_hour: null, seven_day: null })
  assert.deepEqual(s.agents, plain.agents)
  assert.deepEqual(s.groups, plain.groups)
})

test('the clamp is per window, and a rise of nothing caps the spend at one point', () => {
  const plain = bounded(undefined)
  const s = bounded({ five_hour: 1000, seven_day: 0 })
  assert.deepEqual(s.limits.five_hour, plain.limits.five_hour)
  assert.equal(s.limits.clamp.five_hour, null)
  const f = s.limits.clamp.seven_day
  assert.ok(f > 0 && f < 1)
  assert.ok(scaledRange(s.limits.seven_day, plain.limits.seven_day, f))
})

test('no rise leaves the figures alone', () => {
  const plain = bounded(undefined)
  assert.deepEqual(plain.limits.clamp, { five_hour: null, seven_day: null })
  for (const rise of [{ five_hour: null, seven_day: null }, {}, null]) {
    const s = bounded(rise)
    assert.deepEqual(s.limits, plain.limits)
    assert.deepEqual(s.agents, plain.agents)
    assert.deepEqual(s.dollars, plain.dollars)
  }
})

test('a window still learning has nothing to clamp', () => {
  const s = run({ meter: { subscription: true, five_hour: intervals(2), seven_day: intervals(8), rise: { five_hour: 0, seven_day: 1000 } } })
  assert.equal(s.limits.five_hour, null)
  assert.deepEqual(s.limits.clamp, { five_hour: null, seven_day: null })
})

test('the clamp does not touch dollars, tokens or the status of a run', () => {
  const kept = bounded({ five_hour: 1000, seven_day: 1000 })
  const cut = bounded({ five_hour: 0, seven_day: 0 })
  assert.ok(cut.limits.clamp.five_hour < 1 && cut.limits.clamp.seven_day < 1)
  assert.deepEqual(cut.dollars, kept.dollars)
  assert.deepEqual(cut.tokens, kept.tokens)
  assert.equal(cut.status, kept.status)
})

test('a clamped row still shows its number', () => {
  const text = rowsOf(savedBlock(bounded({ five_hour: 0, seven_day: 0 })))
  assert.ok(text.some((l) => l.includes('5-hour') && l.includes('+')), text.join('\n'))
  assert.ok(!text.some((l) => l.includes('learning') || l.includes("can't tell")))
})

const SONNET_XHIGH = { family: 'sonnet', effort: 'xhigh' }
const tallyRun = (key, over = {}) => ({
  key,
  status: 'completed',
  baseline: SONNET_XHIGH,
  agents: [{ agentId: `${key}-a`, pieces: [piece(sum('w1'), 'haiku', 'high')] }],
  windows: { five_hour: 'A', seven_day: 'W' },
  at: 1000,
  ...over,
})
const tallyOf = (...runs) => runs.reduce((t, r) => noteTallyRun(t, r), createTally())
const overallOf = (tally, current = { five_hour: 'A', seven_day: 'W' }, now = 2000) => {
  const meter = { ...createMeter(), subscription: true, last: { five_hour: { pct: 5, resetsAt: current.five_hour }, seven_day: { pct: 5, resetsAt: current.seven_day } } }
  const estimates = overallInput(tally, current, now).groups.map((g) => {
    const one = (agents) => estimateRun({ agents, baseline: g.baseline, ratios, prices, meter: subscribed(), seed: seedOf('overall') })
    return { all: one(g.all), five_hour: one(g.five_hour), seven_day: one(g.seven_day) }
  })
  return combine(estimates, { tally, meter, now })
}

test('a tally run keeps its clamp factors, and nothing that is not a factor below 1', () => {
  assert.deepEqual(tallyOf(tallyRun('r1')).runs.r1.clamp, { five_hour: null, seven_day: null })
  assert.deepEqual(tallyOf(tallyRun('r1', { clamp: { five_hour: 0.5, seven_day: 2 } })).runs.r1.clamp, { five_hour: 0.5, seven_day: null })
  assert.deepEqual(tallyOf(tallyRun('r1', { clamp: 'x' })).runs.r1.clamp, { five_hour: null, seven_day: null })
})

test('a clamped run still counts for its windows', () => {
  const t = tallyOf(tallyRun('r1', { clamp: { five_hour: 0.5, seven_day: null } }), tallyRun('r2', { at: 1500 }))
  assert.deepEqual(countedRuns(t, 'five_hour', 'A', 2000).map((r) => r.key), ['r1', 'r2'])
  assert.deepEqual(countedRuns(t, 'seven_day', 'W', 2000).map((r) => r.key), ['r1', 'r2'])
})

test('the pooled agents of a clamped run carry its factors, and the others none', () => {
  const t = tallyOf(tallyRun('r1', { clamp: { five_hour: 0.5, seven_day: null } }), tallyRun('r2', { at: 1500 }))
  const [g] = overallInput(t, { five_hour: 'A', seven_day: 'W' }, 2000).groups
  assert.deepEqual(g.five_hour.map((a) => a.scale ?? null), [{ five_hour: 0.5, seven_day: null }, null])
  assert.deepEqual(g.all.map((a) => a.agentId), ['r1-a', 'r2-a'])
})

test('combine scales the points of a clamped run by its factor and leaves the others', () => {
  const one = overallOf(tallyOf(tallyRun('r1')))
  const cut = overallOf(tallyOf(tallyRun('r1', { clamp: { five_hour: 0.5, seven_day: null } })))
  assert.ok(scaledRange(cut.limits.five_hour, one.limits.five_hour, 0.5))
  assert.deepEqual(cut.limits.seven_day, one.limits.seven_day)
  assert.deepEqual(cut.dollars, one.dollars)
  assert.deepEqual(cut.counted, { five_hour: 1, seven_day: 1 })
  const both = overallOf(tallyOf(tallyRun('r1'), tallyRun('r2', { at: 1500 })))
  const some = overallOf(tallyOf(tallyRun('r1', { clamp: { five_hour: 0.5, seven_day: null } }), tallyRun('r2', { at: 1500 })))
  assert.ok(some.limits.five_hour.mid < both.limits.five_hour.mid)
  assert.ok(some.limits.five_hour.mid > one.limits.five_hour.mid)
  assert.deepEqual(some.counted, { five_hour: 2, seven_day: 2 })
})

test('the overall keeps the limits shape it had, with no clamp of its own', () => {
  const s = overallOf(tallyOf(tallyRun('r1')))
  assert.ok(s.limits.five_hour.mid !== undefined)
  assert.deepEqual(Object.keys(s.limits), ['five_hour', 'seven_day', 'readings'])
})
