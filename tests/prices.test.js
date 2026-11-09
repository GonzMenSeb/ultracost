import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { priceFamily, loadPrices, requestCost, meterUnits, inputPrice } from '../src/prices.mjs'

const raw = JSON.parse(readFileSync(new URL('../data/prices.json', import.meta.url), 'utf8'))
const prices = loadPrices(raw)
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !~ ${b}`)
const each = { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 }

test('priceFamily maps model ids and refuses unknowns', () => {
  assert.equal(priceFamily('claude-opus-5-5'), 'opus')
  assert.equal(priceFamily('claude-fable-5-1'), 'fable')
  assert.equal(priceFamily('claude-sonnet-5-5-20261001'), 'sonnet')
  assert.equal(priceFamily('claude-opus-5-5[1m]'), 'opus')
  assert.equal(priceFamily('claude-opus-4-1'), null)
  assert.equal(priceFamily('claude-haiku-4-5'), null)
  assert.equal(priceFamily('opus'), null)
  assert.equal(priceFamily('claude-mythos-5-1'), null)
  assert.equal(priceFamily(null), null)
  assert.equal(priceFamily('opus-sonnet'), null)
})

test('priceFamily gives Opus 5, Sonnet 5 and Fable 5.2 their own rows and keeps the 5.5 and 5.1 rows', () => {
  const rows = {
    'claude-opus-5': 'opus-5',
    'claude-opus-5-20260801': 'opus-5',
    'claude-opus-5[1m]': 'opus-5',
    'claude-opus-5-5': 'opus',
    'claude-opus-5.5': 'opus',
    'claude-opus-5-5-20261001': 'opus',
    'claude-sonnet-5': 'sonnet-5',
    'claude-sonnet-5-20260801': 'sonnet-5',
    'claude-sonnet-5[1m]': 'sonnet-5',
    'claude-sonnet-5-5': 'sonnet',
    'claude-sonnet-5-5-20261001': 'sonnet',
    'claude-haiku-5-5': 'haiku',
    'claude-haiku-5-5-20261001': 'haiku',
    'claude-fable-5-1': 'fable',
    'claude-fable-5-1[1m]': 'fable',
    'claude-fable-5-2': 'fable-5-2',
    'claude-fable-5.2': 'fable-5-2',
    'claude-fable-5-2-20261101': 'fable-5-2',
    'claude-fable-5-2[1m]': 'fable-5-2',
  }
  for (const [id, row] of Object.entries(rows)) {
    assert.equal(priceFamily(id), row, id)
    assert.ok(prices.families[row], `${id} has no price row ${row}`)
  }
  for (const id of ['claude-opus-4-8', 'claude-mythos-5-2', 'claude-sonnet-4-6', 'claude-opus-6', 'claude-fable-4']) {
    assert.equal(priceFamily(id), null, id)
  }
})

test('the version rows hold the list prices of their models', () => {
  near(requestCost(prices, 'opus-5', each), 5 + 25 + 0.5 + 6.25)
  near(requestCost(prices, 'sonnet-5', each), 2 + 10 + 0.2 + 2.5)
  near(requestCost(prices, 'fable-5-2', each), 8 + 40 + 0.2 + 10)
  near(requestCost(prices, 'sonnet', each), 2 + 10 + 0.1 + 2.5)
  near(requestCost(prices, 'fable', each), 10 + 50 + 0.25 + 12.5)
  assert.equal(inputPrice(prices, 'opus-5'), 5)
  assert.equal(inputPrice(prices, 'opus'), 4)
})

test('request cost prices each bucket', () => {
  near(requestCost(prices, 'opus', each), 29.2)
})

test('haiku long prompts are repriced whole', () => {
  near(requestCost(prices, 'haiku', { input: 60000, output: 1000, cacheRead: 50000, cacheWrite: 0 }), 0.035)
  near(requestCost(prices, 'haiku', { input: 50000, output: 1000, cacheRead: 40000, cacheWrite: 0 }), 0.0059)
})

test('unknown family has no cost', () => {
  assert.equal(requestCost(prices, null, each), null)
  assert.equal(meterUnits(prices, 'mythos', each), null)
  assert.equal(inputPrice(prices, 'mythos'), null)
})

test('meter units weigh cache writes at the input price and keep cache reads apart', () => {
  const m = meterUnits(prices, 'sonnet', each)
  near(m.u, 14)
  near(m.c, 2)
  assert.equal(inputPrice(prices, 'sonnet'), 2)
})

test('loadPrices refuses a negative or missing price', () => {
  const bad = (edit) => {
    const copy = JSON.parse(JSON.stringify(raw))
    edit(copy)
    assert.throws(() => loadPrices(copy))
  }
  bad((j) => { j.families.opus.output = -1 })
  bad((j) => { delete j.families.sonnet.cacheRead })
  bad((j) => { j.families.haiku.longPrompt.input = Number.NaN })
  assert.throws(() => loadPrices(null))
})

test('an explicit long flag overrides the per-request rule for aggregated usage', () => {
  const t = { input: 200000, output: 0, cacheRead: 0, cacheWrite: 0 }
  near(requestCost(prices, 'haiku', t, false), 0.02)
  near(requestCost(prices, 'haiku', t), 0.1)
  near(requestCost(prices, 'haiku', { ...t, input: 1000 }, true), 0.0005)
  near(requestCost(prices, 'opus', t, true), 0.8)
})
