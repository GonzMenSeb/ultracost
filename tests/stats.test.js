import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rng, seedOf, normal, t90, quantile, logSd, fieller } from '../src/stats.mjs'

const within = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b} (±${tol})`)
const take = (seed, n) => {
  const r = rng(seed)
  return Array.from({ length: n }, () => r())
}

test('rng is deterministic per seed', () => {
  assert.deepEqual(take(7, 5), take(7, 5))
  assert.notDeepEqual(take(7, 5), take(8, 5))
  for (const v of take(3, 1000)) assert.ok(v >= 0 && v < 1)
})

test('seedOf hashes text to a stable 32-bit integer', () => {
  assert.equal(seedOf('wf_1'), seedOf('wf_1'))
  assert.notEqual(seedOf('wf_1'), seedOf('wf_2'))
  assert.ok(Number.isInteger(seedOf('x')) && seedOf('x') >= 0 && seedOf('x') < 2 ** 32)
  assert.equal(seedOf(''), 2166136261)
})

test('normal draws have mean ≈ 0 and sd ≈ 1', () => {
  const rand = rng(1)
  const draws = Array.from({ length: 20000 }, () => normal(rand))
  const mean = draws.reduce((s, v) => s + v, 0) / draws.length
  const sd = Math.sqrt(draws.reduce((s, v) => s + (v - mean) ** 2, 0) / (draws.length - 1))
  within(mean, 0, 0.03)
  within(sd, 1, 0.03)
})

test('fieller matches a hand-checked case', () => {
  const f = fieller([10, 12, 9], [30, 33, 29])
  within(f.r, 2.968, 0.005)
  within(f.lo, 2.645, 0.005)
  within(f.hi, 3.504, 0.005)
})

test('fieller is unbounded when the denominator is too noisy', () => {
  const f = fieller([1, 10], [5, 6])
  assert.equal(f.lo, null)
  assert.equal(f.hi, null)
})

test('fieller with one pair has a ratio and no interval', () => {
  const f = fieller([4], [10])
  assert.equal(f.r, 2.5)
  assert.equal(f.lo, null)
})

test('t90 falls back to the normal quantile above 30 df', () => {
  assert.equal(t90(2), 2.92)
  assert.equal(t90(30), 1.697)
  assert.equal(t90(31), 1.645)
  assert.equal(t90(1000), 1.645)
})

test('quantile interpolates and logSd uses n − 1', () => {
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3)
  assert.equal(quantile([0, 10], 0.25), 2.5)
  assert.equal(quantile([1, 2, 3, 4], 0), 1)
  assert.equal(quantile([1, 2, 3, 4], 1), 4)
  within(logSd([1, 2, 3, 4]), 1.2909944, 1e-6)
  assert.equal(logSd([5]), 0)
  assert.equal(logSd([]), 0)
})
