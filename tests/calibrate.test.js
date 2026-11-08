import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildRatios } from '../src/calibrate.mjs'
import { loadPrices } from '../src/prices.mjs'

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'))
const inputs = () => ({ replays: read('replays'), published: read('published'), prices: loadPrices(read('prices')) })
const ratios = buildRatios(inputs())
const within = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b} (±${tol})`)

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

test('pooled per-agent spread covers every bucket', () => {
  for (const name of ['output', 'fresh', 'read']) assert.ok(ratios.pooledAgentSd[name] > 0)
})

test('opus effort steps agree across sources', () => {
  const s = ratios.steps.opus['high>xhigh']
  within(Math.exp(s.mu), 2.36)
  within(s.sd, 0.22)
  assert.equal(s.sources, 4)
  within(Math.exp(ratios.steps.opus['medium>high'].mu), 1.455)
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
