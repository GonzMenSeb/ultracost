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
  assert.equal(priceFamily('claude-mythos-5-1'), null)
  assert.equal(priceFamily(null), null)
  assert.equal(priceFamily('opus-sonnet'), null)
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
