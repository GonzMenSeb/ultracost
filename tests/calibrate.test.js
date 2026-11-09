import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildRatios } from '../src/calibrate.mjs'
import { loadPrices } from '../src/prices.mjs'

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'))
const inputs = () => ({ replays: read('replays'), published: read('published'), prices: loadPrices(read('prices')) })
const ratios = buildRatios(inputs())
const within = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b} (±${tol})`)
const SINGLE_RUN_FLOOR = { output: 0.227 / Math.SQRT2, fresh: 0.259 / Math.SQRT2, read: 0.273 / Math.SQRT2 }
const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable']

test('measured web research ratio', () => {
  const m = ratios.measured['sonnet:high>opus:high']
  assert.equal(m.pairs, 4)
  within(m.output.r, 1.07)
  within(m.read.r, 2.29)
  within(m.fresh.r, 1.15)
  within(m.dollars.r, 2.6)
  within(m.dollars.lo, 2.19)
  within(m.dollars.hi, 2.89)
})

test('measured medium ratio pools code mapping and checks', () => {
  const m = ratios.measured['sonnet:high>opus:medium']
  assert.equal(m.pairs, 18)
  assert.equal(m.workflows, 2)
  within(m.output.r, 0.61)
  within(m.dollars.r, 1.59)
})

test('a measured bucket carries its log mean, sigma and per-agent spread', () => {
  const b = ratios.measured['sonnet:high>opus:high'].read
  within(b.mu, Math.log(b.r), 1e-6)
  within(b.sigma, (Math.log(b.hi) - Math.log(b.lo)) / (2 * 1.645), 1e-6)
  assert.ok(b.agentSd > 0)
})

test('tau comes from the spread between workflows', () => {
  within(ratios.tau, 0.3)
})

test('tau never drops below its floor', () => {
  assert.ok(read('ratios').tau >= 0.22)
  const u = (n) => ({ input: 10 * n, output: n, cacheRead: 100 * n, cacheWrite: 5 * n })
  const pair = (workflow, n) => ({ workflow, kind: 'k', from: 'sonnet:high', to: 'opus:high', actual: u(n), baseline: u(2 * n) })
  const pairs = [pair('w1', 1), pair('w1', 2), pair('w2', 1), pair('w2', 2)]
  const agreeing = buildRatios({ ...inputs(), replays: { v: 1, claudeCode: 'x', measuredAt: 'y', pairs } })
  assert.equal(agreeing.tau, 0.22)
})

test('pooled per-agent spread covers every bucket and clears the single-run floor', () => {
  const pooled = read('ratios').pooledAgentSd
  for (const name of ['output', 'fresh', 'read']) {
    assert.ok(pooled[name] >= SINGLE_RUN_FLOOR[name], `${name} ${pooled[name]} < ${SINGLE_RUN_FLOOR[name]}`)
  }
})

test('opus effort steps agree across sources', () => {
  const s = ratios.steps.opus['high>xhigh']
  within(Math.exp(s.mu), 2.36)
  within(s.sd, 0.22)
  assert.equal(s.sources, 4)
  within(Math.exp(ratios.steps.opus['medium>high'].mu), 1.455)
})

test('no step comes from the community source into max', () => {
  const published = read('published')
  const community = published.sources.find((s) => s.id.startsWith('community-'))
  for (const row of Object.values(community.cost)) assert.equal(row.max, undefined)
  const others = { ...published, sources: published.sources.filter((s) => s !== community) }
  const without = buildRatios({ ...inputs(), published: others })
  const touchesMax = (key) => key.split(/[>:]/).includes('max')
  let checked = 0
  for (const family of Object.keys(ratios.steps)) {
    const keys = Object.keys(ratios.steps[family]).filter(touchesMax)
    assert.deepEqual(keys, Object.keys(without.steps[family] ?? {}).filter(touchesMax))
    for (const key of keys) {
      assert.deepEqual(ratios.steps[family][key], without.steps[family][key])
      checked++
    }
  }
  for (const key of Object.keys(ratios.priors).filter(touchesMax)) {
    assert.deepEqual(ratios.priors[key], without.priors[key])
    checked++
  }
  assert.ok(checked > 20)
})

test('opus steps into max come from the Artificial Analysis run alone', () => {
  const s = ratios.steps.opus['high>max']
  within(Math.exp(s.mu), 2.9)
  assert.equal(s.sources, 1)
  assert.equal(ratios.steps.haiku['low>max'].sources, 1)
})

test('source ids are unique and Artificial Analysis ids carry the index version', () => {
  const ids = read('published').sources.map((s) => s.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids.filter((i) => i.startsWith('aa-'))) assert.ok(id.includes('v5.0.1'), id)
})

test('the Managed Agents run is its own source for Opus low and medium', () => {
  const run = read('published').sources.find((s) => s.id === 'anthropic-managed-agents-134')
  assert.deepEqual(run.cost, { opus: { low: 1.84, medium: 4.78 } })
  const s = ratios.steps.opus['low>medium']
  assert.equal(s.sources, 5)
  within(Math.exp(s.mu), 2.13)
})

test('Fable medium is the Fable 5.2 figure and moves the priors into it', () => {
  const run = read('published').sources.find((s) => s.id === 'anthropic-agentic-370')
  assert.equal(run.cost.fable.medium, 1.34)
  within(Math.exp(ratios.priors['opus:medium>fable:medium'].mu), 0.76)
  within(Math.exp(ratios.priors['sonnet:medium>fable:medium'].mu), 1.55)
})

test('ratios stay keyed by family, never by price row', () => {
  for (const family of Object.keys(ratios.steps)) assert.ok(FAMILIES.includes(family), family)
  const configs = [...Object.keys(ratios.measured), ...Object.keys(ratios.priors)].flatMap((key) => key.split('>'))
  for (const config of configs) assert.ok(FAMILIES.includes(config.split(':')[0]), config)
})

test('priors convert cost to tokens with the input-price ratio', () => {
  const p = ratios.priors['sonnet:high>opus:xhigh']
  within(Math.exp(p.mu), 3.43)
  within(p.sd, 0.61)
})

test('priors never pair a family with itself and need a source', () => {
  assert.equal(ratios.priors['sonnet:high>sonnet:xhigh'], undefined)
  assert.ok(ratios.priors['opus:high>fable:high'])
  const published = { v: 1, sources: [{ id: 's', cost: { opus: { high: 2 }, sonnet: { high: 1 } } }] }
  const priors = buildRatios({ ...inputs(), published }).priors
  assert.deepEqual(Object.keys(priors), ['opus:high>sonnet:high', 'sonnet:high>opus:high'])
  assert.equal(priors['sonnet:high>opus:high'].sd, 0.6)
})

test('an unbounded bucket is dropped', () => {
  const pair = (actual, baseline) => ({ workflow: 'w1', kind: 'k', from: 'sonnet:high', to: 'opus:high', actual, baseline })
  const u = (input, output, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite })
  const replays = {
    v: 1,
    claudeCode: 'x',
    measuredAt: 'y',
    pairs: [pair(u(100, 1), u(200, 5)), pair(u(110, 10), u(230, 6))],
  }
  const m = buildRatios({ ...inputs(), replays }).measured['sonnet:high>opus:high']
  assert.equal(m.output, undefined)
  assert.equal(m.read, undefined)
  assert.ok(m.fresh.lo > 0)
  const none = { ...replays, pairs: [pair(u(1, 1), u(5, 5)), pair(u(10, 10), u(6, 6))] }
  assert.deepEqual(buildRatios({ ...inputs(), replays: none }).measured, {})
})

test('the shipped ratios file is current', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(ratios)), read('ratios'))
})
