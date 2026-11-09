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
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const BUCKET_NAMES = ['output', 'fresh', 'read']
const aa = () => read('published').sources.find((s) => s.id.startsWith('aa-'))

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

test('opus effort steps agree across sources, and their sd is the workload spread', () => {
  const s = ratios.steps.opus['high>xhigh']
  within(Math.exp(s.mu), 2.36)
  within(s.sd, 0.37)
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

test('a prior takes its buckets from the Artificial Analysis token counts of both configurations, fresh and read from the total input', () => {
  const p = ratios.priors['sonnet:high>opus:xhigh']
  const run = aa().wholeIndex
  const ln = (k) => Math.log(run.opus.efforts.xhigh[k] / run.sonnet.efforts.high[k])
  within(p.output.mu, ln('outputTokens'), 1e-9)
  within(p.read.mu, ln('inputTokens'), 1e-9)
  within(p.fresh.mu, ln('inputTokens'), 1e-9)
  within(Math.exp(p.output.mu), 1.848, 0.001)
  within(Math.exp(p.fresh.mu), 2.384, 0.001)
  within(Math.exp(p.read.mu), 2.384, 0.001)
  within(p.output.sd, 0.61)
  within(p.read.sd, 0.61)
  within(p.fresh.sd, 0.64)
})

test('a prior keeps its scalar, the mean log cost ratio less the input-price ratio, as the fallback', () => {
  const p = ratios.priors['sonnet:high>opus:xhigh']
  within(Math.exp(p.mu), 3.43)
  within(p.sd, 0.61)
  assert.equal(p.sources, 3)
  const prices = read('prices').families
  const logs = read('published').sources
    .filter((x) => x.cost.sonnet?.high > 0 && x.cost.opus?.xhigh > 0)
    .map((x) => Math.log(x.cost.opus.xhigh / x.cost.sonnet.high) - Math.log(prices.opus.input / prices.sonnet.input))
  within(p.mu, logs.reduce((t, x) => t + x, 0) / logs.length, 1e-9)
  assert.deepEqual(Object.keys(p), ['mu', 'sd', 'sources', 'output', 'fresh', 'read'])
})

test('every prior between Opus, Sonnet and Haiku carries three buckets that share the scalar sd, the fresh proxy adding 0.2', () => {
  let checked = 0
  for (const [key, p] of Object.entries(ratios.priors)) {
    const [from, to] = key.split('>').map((c) => c.split(':')[0])
    if (from === 'fable' || to === 'fable') continue
    for (const name of BUCKET_NAMES) assert.ok(Number.isFinite(p[name].mu), `${key} ${name}`)
    assert.equal(p.output.sd, p.sd)
    assert.equal(p.read.sd, p.sd)
    within(p.fresh.sd, Math.hypot(p.sd, 0.2), 1e-8)
    checked++
  }
  assert.ok(checked > 80)
})

test('a prior spread wider than 0.6 across sources is every bucket sd, with 0.2 added to fresh', () => {
  const tokens = { outputTokens: 10, inputTokens: 100 }
  const run = { efforts: { high: tokens } }
  const published = {
    v: 1,
    sources: [
      { id: 'a', cost: { haiku: { high: 1 }, sonnet: { high: 2 } }, wholeIndex: { haiku: run, sonnet: { efforts: { high: { outputTokens: 40, inputTokens: 150 } } } } },
      { id: 'b', cost: { haiku: { high: 1 }, sonnet: { high: 20 } } },
    ],
  }
  const p = buildRatios({ ...inputs(), published }).priors['haiku:high>sonnet:high']
  const spread = Math.log(10) / Math.SQRT2
  within(p.mu, (Math.log(2) + Math.log(20)) / 2 - Math.log(20), 1e-9)
  within(p.sd, spread, 1e-9)
  within(p.output.sd, spread, 1e-9)
  within(p.read.sd, spread, 1e-9)
  within(p.fresh.sd, Math.hypot(spread, 0.2), 1e-9)
  within(Math.exp(p.output.mu), 4, 1e-9)
  within(Math.exp(p.read.mu), 1.5, 1e-9)
  within(Math.exp(p.fresh.mu), 1.5, 1e-9)
})

test('a prior without token data for both configurations keeps the scalar alone', () => {
  const scalar = ['mu', 'sd', 'sources']
  for (const [key, p] of Object.entries(ratios.priors)) {
    if (key.split(/[>:]/).includes('fable')) assert.deepEqual(Object.keys(p), scalar, key)
  }
  const published = read('published')
  const bare = { ...published, sources: published.sources.map(({ wholeIndex, ...rest }) => rest) }
  const without = buildRatios({ ...inputs(), published: bare }).priors
  for (const [key, p] of Object.entries(without)) {
    assert.deepEqual(Object.keys(p), scalar, key)
    assert.equal(p.mu, ratios.priors[key].mu)
    assert.equal(p.sd, ratios.priors[key].sd)
  }
  const gap = structuredClone(published)
  delete gap.sources.find((s) => s.id.startsWith('aa-')).wholeIndex.opus.efforts.max
  const partial = buildRatios({ ...inputs(), published: gap }).priors
  assert.deepEqual(Object.keys(partial['sonnet:high>opus:max']), scalar)
  assert.deepEqual(Object.keys(partial['sonnet:high>opus:xhigh']), [...scalar, ...BUCKET_NAMES])
  assert.equal(partial['sonnet:high>opus:max'].mu, ratios.priors['sonnet:high>opus:max'].mu)
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

const pairsOf = () => EFFORTS.flatMap((a) => EFFORTS.filter((b) => b !== a).map((b) => [a, b]))

test('steps carry three buckets and keep the scalar as the mean log cost ratio over sources', () => {
  const sources = read('published').sources
  for (const family of ['opus', 'sonnet', 'haiku']) {
    for (const [a, b] of pairsOf()) {
      const s = ratios.steps[family][`${a}>${b}`]
      const logs = sources.map((x) => x.cost[family]).filter((c) => c && c[a] > 0 && c[b] > 0).map((c) => Math.log(c[b] / c[a]))
      within(s.mu, logs.reduce((t, x) => t + x, 0) / logs.length, 1e-9)
      assert.equal(s.sources, logs.length)
      for (const name of BUCKET_NAMES) assert.ok(Number.isFinite(s[name].mu) && s[name].sd >= s.sd, `${family} ${a}>${b} ${name}`)
    }
  }
})

test('high to xhigh buckets take the Artificial Analysis shape at the multi-source level', () => {
  const s = ratios.steps.sonnet['high>xhigh']
  within(Math.exp(s.mu), 2.494)
  within(Math.exp(s.output.mu), 2.21)
  within(Math.exp(s.fresh.mu), 2.11)
  within(Math.exp(s.read.mu), 3.28)
  const o = ratios.steps.opus['high>xhigh']
  within(Math.exp(o.output.mu), 2.42)
  within(Math.exp(o.fresh.mu), 2.12)
  within(Math.exp(o.read.mu), 2.56)
  const h = ratios.steps.haiku['high>xhigh']
  within(Math.exp(h.output.mu), 1.81)
  within(Math.exp(h.fresh.mu), 1.61)
  within(Math.exp(h.read.mu), 1.71)
})

test('a step and its reverse are mirror images, buckets included', () => {
  for (const family of ['opus', 'sonnet', 'haiku']) {
    for (const [a, b] of pairsOf()) {
      const up = ratios.steps[family][`${a}>${b}`]
      const down = ratios.steps[family][`${b}>${a}`]
      within(up.mu, -down.mu, 1e-9)
      assert.equal(up.sd, down.sd)
      for (const name of BUCKET_NAMES) {
        within(up[name].mu, -down[name].mu, 1e-9)
        assert.equal(up[name].sd, down[name].sd)
      }
    }
  }
})

test('a family or pair without token data keeps the scalar alone', () => {
  for (const s of Object.values(ratios.steps.fable)) assert.deepEqual(Object.keys(s), ['mu', 'sd', 'sources'])
  const published = read('published')
  const bare = { ...published, sources: published.sources.map(({ wholeIndex, ...rest }) => rest) }
  const steps = buildRatios({ ...inputs(), published: bare }).steps
  for (const [key, s] of Object.entries(steps.opus)) {
    assert.deepEqual(Object.keys(s), ['mu', 'sd', 'sources'])
    assert.equal(s.mu, ratios.steps.opus[key].mu)
    assert.equal(s.sd, ratios.steps.opus[key].sd)
  }
  const gap = structuredClone(published)
  delete gap.sources.find((s) => s.id.startsWith('aa-')).wholeIndex.sonnet.efforts.max
  const partial = buildRatios({ ...inputs(), published: gap }).steps.sonnet
  assert.equal(partial['high>max'].output, undefined)
  assert.ok(partial['high>xhigh'].output)
})

test('the Artificial Analysis Sonnet components add up to its input tokens and its cost to run', () => {
  const run = aa().wholeIndex.sonnet
  assert.deepEqual(run.prices, { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 })
  for (const e of EFFORTS) {
    const r = run.efforts[e]
    const tokens = (r.nonCacheInputCost / 2 + r.cacheReadCost / 0.1 + r.cacheWriteCost / 2.5) * 1e6
    assert.ok(Math.abs(tokens - r.inputTokens) < 1, `${e}: ${tokens} against ${r.inputTokens}`)
    within(r.nonCacheInputCost + r.cacheReadCost + r.cacheWriteCost + (r.outputTokens * 10) / 1e6, r.costToRun, 1e-6)
  }
})

test('at the Artificial Analysis Sonnet mix the buckets reproduce the multi-source total', () => {
  const run = aa().wholeIndex.sonnet.efforts
  for (const [a, b] of pairsOf()) {
    const s = ratios.steps.sonnet[`${a}>${b}`]
    const r = run[a]
    const fresh = r.nonCacheInputCost + r.cacheWriteCost
    const output = (r.outputTokens * 10) / 1e6
    const baseline = output * Math.exp(s.output.mu) + fresh * Math.exp(s.fresh.mu) + r.cacheReadCost * Math.exp(s.read.mu)
    within(Math.log(baseline / r.costToRun), s.mu, 0.02)
  }
})

test('opus and haiku take output and input shape from their run and borrow fresh from Sonnet', () => {
  const run = aa().wholeIndex
  for (const family of ['opus', 'haiku']) {
    for (const [a, b] of pairsOf()) {
      const s = ratios.steps[family][`${a}>${b}`]
      const ln = (k) => Math.log(run[family].efforts[b][k] / run[family].efforts[a][k])
      within(s.output.mu, s.mu + ln('outputTokens') - ln('costToRun'), 1e-9)
      within(s.read.mu, s.mu + ln('inputTokens') - ln('costToRun'), 1e-9)
      within(s.fresh.mu, s.mu + 0.77 * ln('outputTokens') - ln('costToRun'), 1e-9)
    }
  }
  const sonnet = run.sonnet.efforts
  const tokens = (e, k) => (k === 'fresh' ? sonnet[e].nonCacheInputCost / 2 + sonnet[e].cacheWriteCost / 2.5 : sonnet[e].outputTokens)
  const exponents = EFFORTS.flatMap((a, i) => EFFORTS.slice(i + 1).map((b) => Math.log(tokens(b, 'fresh') / tokens(a, 'fresh')) / Math.log(tokens(b, 'output') / tokens(a, 'output'))))
  within(exponents.reduce((t, x) => t + x, 0) / exponents.length, 0.77, 0.005)
})

test('step sd is the largest of the source spread, the per-evaluation spread and 0.25', () => {
  const evaluations = aa().evaluations.sonnet.efforts
  const spread = (a, b) => {
    const logs = Object.keys(evaluations[a]).map((k) => Math.log(evaluations[b][k] / evaluations[a][k]))
    const m = logs.reduce((t, x) => t + x, 0) / logs.length
    return Math.sqrt(logs.reduce((t, x) => t + (x - m) ** 2, 0) / (logs.length - 1))
  }
  within(spread('high', 'xhigh'), 0.37)
  within(spread('xhigh', 'max'), 0.7)
  within(spread('low', 'max'), 1.14)
  within(ratios.steps.opus['high>xhigh'].sd, spread('high', 'xhigh'), 1e-9)
  within(ratios.steps.sonnet['high>xhigh'].sd, 0.4, 1e-9)
  within(ratios.steps.haiku['xhigh>max'].sd, spread('xhigh', 'max'), 1e-9)
  within(ratios.steps.fable['xhigh>max'].sd, spread('xhigh', 'max'), 1e-9)
  const agreeing = { v: 1, sources: [{ id: 'a', cost: { opus: { high: 1, xhigh: 2 } } }, { id: 'b', cost: { opus: { high: 2, xhigh: 4 } } }] }
  assert.equal(buildRatios({ ...inputs(), published: agreeing }).steps.opus['high>xhigh'].sd, 0.25)
})

test('a borrowed fresh bucket adds 0.2 of shape spread in quadrature, a measured one does not', () => {
  for (const family of ['opus', 'haiku']) {
    for (const s of Object.values(ratios.steps[family])) {
      within(s.fresh.sd, Math.sqrt(s.sd ** 2 + 0.04), 1e-9)
      assert.equal(s.output.sd, s.sd)
      assert.equal(s.read.sd, s.sd)
    }
  }
  for (const s of Object.values(ratios.steps.sonnet)) for (const name of BUCKET_NAMES) assert.equal(s[name].sd, s.sd)
})

test('the shipped ratios file is current', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(ratios)), read('ratios'))
})
