import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as acorn from '../vendor/acorn.mjs'
import { fanout } from '../src/fanout.mjs'

const LIMITS = { maxConcurrentOpus: 3, bigFanout: 3 }
const PARSE = { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, locations: true }

function collectCalls(ast) {
  const calls = []
  const stack = [ast]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'agent') calls.push(n)
    for (const v of Object.values(n).flat()) if (v !== null && typeof v === 'object' && typeof v.type === 'string') stack.push(v)
  }
  return calls.sort((a, b) => a.start - b.start)
}

function stageOf(call) {
  const opts = call.arguments[1]
  const prop = (name) => opts.properties.find((p) => p.key && p.key.name === name)
  const lit = (p) => (p && p.value.type === 'Literal' ? p.value.value : null)
  const label = prop('label')
  const text = label && label.value.type === 'TemplateLiteral' ? label.value.quasis.map((q) => q.value.cooked).join('${…}') : lit(label)
  return { line: call.loc.start.line, label: text, model: lit(prop('model')) }
}

function run(src, limits = LIMITS) {
  const ast = acorn.parse(src, PARSE)
  const calls = collectCalls(ast)
  return fanout(ast, calls, calls.map(stageOf), limits)
}

const stage = (model, label = 'decide: x') => `agent('p', { label: '${label}', model: '${model}', effort: 'high' })`
const opus = (label) => stage('opus', label)
const sonnet = (label) => stage('sonnet', label)
const haiku = (label) => stage('haiku', label)
const thunks = (n, make = opus) => Array.from({ length: n }, () => `() => ${make()}`).join(', ')
const listOf = (n) => `[${Array.from({ length: n }, (_, i) => i + 1).join(', ')}]`

const OVER = 'opus agents can run at once here; the limit is 3'
const UNKNOWN = 'cannot count how many opus agents run at once'

function assertCounts(src, maxOpus, expectedErrors = maxOpus > 3 ? undefined : 0) {
  const r = run(src)
  assert.equal(r.maxOpus, maxOpus, src)
  if (expectedErrors !== undefined) assert.equal(r.errors.length, expectedErrors, src)
  else assert.ok(r.errors.length > 0, src)
  return r
}

test('sequential awaited opus agents never raise the bound', () => {
  for (const src of [
    `await ${opus()}`,
    `for (let i = 0; i < 5; i++) { await ${opus()} }`,
    `let n = 0\nwhile (n < 5) { n++; await ${opus()} }`,
    `async function helper() { return ${opus()} }\nawait helper()\nawait helper()\nawait helper()\nawait helper()`,
    `const helper = async () => { await ${opus()} }\nfor (const x of [1, 2, 3, 4]) await helper()`,
    `try { await ${opus()} } catch { await ${opus()} } finally { await ${opus()} }`,
    `const r = cond ? await ${opus()} : await ${opus()}\nawait ${opus()}\nawait ${opus()}\nawait ${opus()}\nawait ${opus()}`
  ]) {
    const r = assertCounts(src, 1)
    assert.ok(r.stages.every((s) => s.inFanout === false && s.bigFanout === false), src)
  }
})

test('parallel over an array literal of thunks sums its elements', () => {
  const three = assertCounts(`await parallel([${thunks(3)}])`, 3)
  assert.ok(three.stages.every((s) => s.inFanout && !s.bigFanout))
  const four = run(`await parallel([${thunks(4)}])`)
  assert.equal(four.maxOpus, 4)
  assert.equal(four.errors.length, 4)
  assert.deepEqual(four.errors.map((e) => e.stage), [0, 1, 2, 3])
  assert.ok(four.stages.every((s) => s.inFanout && s.bigFanout))
})

test('a single thunk is not a fan-out', () => {
  const r = assertCounts(`await parallel([() => ${opus()}])`, 1)
  assert.deepEqual(r.stages, [{ inFanout: false, bigFanout: false }])
})

test('parallel over a mapped const list multiplies by its size', () => {
  assertCounts(`const LIST = [1, 2]\nawait parallel(LIST.map(x => () => ${opus()}))`, 2)
  assertCounts(`const LIST = ${listOf(4)}\nawait parallel(LIST.map(x => () => ${opus()}))`, 4)
  const unknown = assertCounts(`await parallel(args.items.map(x => () => ${opus()}))`, Infinity)
  assert.ok(unknown.errors.every((e) => e.message.includes(UNKNOWN)))
})

test('parallel over flatMap and Array.from callbacks multiplies the same way', () => {
  assertCounts(`const L = [1, 2]\nawait parallel(L.flatMap(x => () => ${opus()}))`, 2)
  assertCounts(`const L = [1, 2, 3, 4]\nawait parallel(L.flatMap(x => () => ${opus()}))`, 4)
  assertCounts(`const L = [1, 2, 3]\nawait parallel(Array.from(L, x => () => ${opus()}))`, 3)
})

test('map callbacks may return a thunk from a block body or a helper', () => {
  assertCounts(`const L = [1, 2]\nawait parallel(L.map(x => { const k = x + 1; return () => ${opus()} }))`, 2)
  assertCounts(`const L = ${listOf(4)}\nawait parallel(L.map(x => { return async () => { await ${opus()} } }))`, 4)
  assertCounts(`const L = [1, 2]\nconst make = (x) => () => ${opus()}\nawait parallel(L.map(make))`, 2)
  assertCounts(`const L = [1, 2]\nawait parallel(L.map(x => cond ? () => ${opus()} : () => ${opus()}))`, 2)
})

test('the slice pattern keeps three on opus and the rest on sonnet', () => {
  const src = `const ranked = args.ranked
await parallel([
  ...ranked.slice(0, 3).map(t => () => ${opus('design: ${t.key}')}),
  ...ranked.slice(3).map(t => () => ${sonnet('design: ${t.key}')})
])`
  const r = assertCounts(src, 3)
  assert.equal(r.maxAll, Infinity)
  assert.deepEqual(r.stages, [
    { inFanout: true, bigFanout: true },
    { inFanout: true, bigFanout: true }
  ])
})

test('slice sizes: literal bounds, offsets, clamping to a known size and the top-n alias', () => {
  assertCounts(`const R = ${listOf(10)}\nawait parallel(R.slice(2, 5).map(t => () => ${opus()}))`, 3)
  assertCounts(`const R = ${listOf(2)}\nawait parallel(R.slice(0, 3).map(t => () => ${opus()}))`, 2)
  assertCounts(`const R = ${listOf(5)}\nawait parallel(R.slice(3).map(t => () => ${opus()}))`, 2)
  assertCounts(`const R = ${listOf(5)}\nawait parallel(R.slice(0, 4).map(t => () => ${opus()}))`, 4)
  assertCounts(`await parallel(args.items.slice(0, 4).map(t => () => ${opus()}))`, 4)
  assertCounts(`await parallel(args.items.slice(3).map(t => () => ${opus()}))`, Infinity)
  assertCounts(`const top = args.items.slice(0, 3)\nawait parallel(top.map(t => () => ${opus()}))`, 3)
  assertCounts(`const N = 3\nawait parallel(args.items.slice(0, N).map(t => () => ${opus()}))`, 3)
  assertCounts(`await parallel(args.items.filter(Boolean).slice(0, 3).map(t => () => ${opus()}))`, 3)
  assertCounts(`await parallel(args.items.slice(0, -1).map(t => () => ${opus()}))`, Infinity)
  assertCounts(`await parallel(args.items.slice(-3).map(t => () => ${opus()}))`, Infinity)
})

test('the batching loop counts as three', () => {
  const r = assertCounts(
    `const items = args.items\nfor (let i = 0; i < items.length; i += 3) await parallel(items.slice(i, i + 3).map(x => () => ${opus()}))`,
    3
  )
  assert.deepEqual(r.stages, [{ inFanout: true, bigFanout: false }])
  assertCounts(
    `for (let i = 0; i < args.length; i += 4) await parallel(args.slice(i, i + 4).map(x => () => ${opus()}))`,
    4
  )
  assertCounts(
    `let i = 0\nwhile (i < args.length) { await parallel(args.slice(i, i + 3).map(x => () => ${opus()})); i += 3 }`,
    3
  )
  assertCounts(
    `for (let i = 0; i < 9; i += 3) { await parallel(args.slice(i, i + 3).map(x => () => ${opus()})) }\nfor (let i = 0; i < 9; i += 3) { await parallel(args.slice(i, i + 3).map(x => () => ${opus()})) }`,
    3
  )
})

test('a slice window over a counter that may not be a number is unknown', () => {
  assertCounts(`for (const i of args.starts) await parallel(args.items.slice(i, i + 3).map(x => () => ${opus()}))`, Infinity)
  assertCounts(
    `for (let i = 0; i < 9; i += 3) { i = String(i); await parallel(args.items.slice(i, i + 3).map(x => () => ${opus()})) }`,
    Infinity
  )
  assertCounts(
    `for (let i = 0; i < 9; i += args.step) await parallel(args.items.slice(i, i + 3).map(x => () => ${opus()}))`,
    Infinity
  )
  assertCounts(`for (let i = 0; i < 9; i += 3) await parallel(args.items.slice(i, i + 4).map(x => () => ${opus()}))`, 4)
  assertCounts(`for (let i = 0; i < 9; i += 3) await parallel(args.items.slice(i, i + 3 + args.k).map(x => () => ${opus()}))`, Infinity)
  assertCounts(`for (let i = 0; i < 9; i += 3) await parallel(args.items.slice(i, i + 3).map(x => () => ${opus()}))`, 3)
})

test('pipeline multiplies the widest stage by the number of items', () => {
  assertCounts(`const ITEMS = [1, 2]\nawait pipeline(ITEMS, a => ${opus()}, b => ${opus()})`, 2)
  const unknown = assertCounts(`await pipeline(args, a => ${opus()}, b => ${opus()})`, Infinity)
  assert.ok(unknown.errors.every((e) => e.message.includes(UNKNOWN)))
  assertCounts(`const ITEMS = ${listOf(4)}\nawait pipeline(ITEMS, a => ${opus()}, b => ${sonnet()})`, 4)
  const mixed = assertCounts(`const ITEMS = ${listOf(5)}\nawait pipeline(ITEMS, a => ${sonnet()}, async (b) => { const r = await ${sonnet()}; return r })`, 0)
  assert.ok(mixed.stages.every((s) => s.inFanout && s.bigFanout))
})

test('Promise.allSettled sums its elements', () => {
  assertCounts(`await Promise.allSettled([${opus()}, ${opus()}])`, 2)
  assertCounts(`await Promise.allSettled([${opus()}, ${opus()}, ${opus()}])`, 3)
  assertCounts(`await Promise.allSettled([${opus()}, ${opus()}, ${opus()}, ${opus()}])`, 4)
  assertCounts(`const xs = ${listOf(5)}\nawait Promise.allSettled(xs.map(x => ${opus()}))`, 5)
  assertCounts(`const xs = [1, 2]\nawait Promise.allSettled(xs.map(async x => { const r = await ${opus()}; return r }))`, 2)
  assertCounts(`await Promise.allSettled(args.items.map(x => ${opus()}))`, Infinity)
  assertCounts(`await Promise.allSettled([...args.items.slice(0, 2).map(x => ${opus()}), ${opus()}])`, 3)
})

test('Promise.all rejects early and leaves the other agents running, so it is unknown', () => {
  const r = assertCounts(`await Promise.all([${opus()}, ${opus()}])`, Infinity)
  assert.ok(r.errors.every((e) => e.message.includes(UNKNOWN) && e.message.includes('Promise.all leaves the other agents running when one fails')))
  assertCounts(`const xs = [1, 2]\nawait Promise.all(xs.map(x => ${opus()}))`, Infinity)
  assertCounts(`await Promise.all([${opus()}])`, 1)
  assertCounts(`await Promise.all([${sonnet()}, ${sonnet()}])`, 0)
  assertCounts(`await Promise.all([${sonnet()}, ${sonnet()}, ${sonnet()}, ${sonnet()}])`, 0)
  const handled = [
    `const items = [1, 2, 3]\ntry { await Promise.all([...items.map(x => ${opus()}), (async () => { throw new Error('boom') })()]) } catch {}\nawait Promise.all(items.map(x => ${opus()}))`,
    `await Promise.all([${opus()}, ${opus()}, ${opus()}, Promise.reject(new Error('x'))]).catch(() => Promise.all([${opus()}, ${opus()}, ${opus()}]))`
  ]
  for (const src of handled) assertCounts(src, Infinity)
})

test('Promise.all of sonnet agents is not a big fan-out by itself', () => {
  const two = run(`await Promise.all([${sonnet()}, ${sonnet()}])`)
  assert.deepEqual(two.stages, [{ inFanout: true, bigFanout: false }, { inFanout: true, bigFanout: false }])
})

test('Promise.race and Promise.any leave the losers running, so they are unknown', () => {
  assertCounts(`await Promise.race([${opus()}, ${opus()}])`, Infinity)
  assertCounts(`await Promise.any([${opus()}, ${sonnet()}])`, Infinity)
  assertCounts(`await Promise.race([${opus()}])`, 1)
  assertCounts(`await Promise.race([${sonnet()}, ${sonnet()}])`, 0)
})

test('Array.from with a length builds the list', () => {
  assertCounts(`await parallel(Array.from({ length: 3 }, () => () => ${opus()}))`, 3)
  assertCounts(`const N = 5\nawait parallel(Array.from({ length: N }, () => () => ${opus()}))`, 5)
  assertCounts(`const N = 2\nawait parallel(Array.from({ length: N }, () => () => ${opus()}))`, 2)
  assertCounts(`await parallel(Array.from({ length: args.n }, () => () => ${opus()}))`, Infinity)
  assertCounts(`let N = 2\nawait parallel(Array.from({ length: N }, () => () => ${opus()}))`, Infinity)
  assertCounts(`await parallel(Array.from({ length: 4 }, (_, i) => async () => { await ${opus()} }))`, 4)
})

test('then, catch and finally take the max of the chain and the callback', () => {
  assertCounts(`await parallel([${thunks(3)}]).then(vs => ${opus()})`, 3)
  assertCounts(`await ${opus()}.then(v => ${opus()}).then(w => ${opus()})`, 1)
  assertCounts(`await ${opus()}.catch(e => ${opus()}).finally(() => ${opus()})`, 1)
  assertCounts(`await Promise.allSettled([${opus()}, ${opus()}]).then(vs => parallel([${thunks(2)}]))`, 2)
  assertCounts(`await parallel([${thunks(2)}]).then(vs => parallel([${thunks(4)}]))`, 4)
  assertCounts(`const xs = [1, 2, 3]\nawait parallel(xs.map(x => () => ${opus()}.then(r => ${sonnet()})))`, 3)
  assertCounts(`const xs = [1, 2, 3, 4]\nawait parallel(xs.map(x => () => ${opus()}.then(r => ${opus()})))`, 4)
})

test('an unawaited then chain, or one on an unknown receiver, is unknown', () => {
  assertCounts(`${opus()}.then(v => v)\nawait ${opus()}`, Infinity)
  assertCounts(`await args.job.then(v => ${opus()})`, Infinity)
})

test('functions passed by name are inlined', () => {
  assertCounts(`const files = [1, 2]\nasync function review(f) { return ${opus()} }\nawait pipeline(files, review)`, 2)
  assertCounts(`const files = ${listOf(4)}\nasync function review(f) { return ${opus()} }\nawait pipeline(files, review)`, 4)
  assertCounts(`const t = () => ${opus()}\nawait parallel([t, t, t])`, 3)
  assertCounts(`const t = () => ${opus()}\nawait parallel([t, t, t, t])`, 4)
  assertCounts(`const files = [1, 2]\nconst review = async (f) => ${opus()}\nawait Promise.allSettled(files.map(review))`, 2)
  assertCounts(`const files = [1, 2, 3, 4]\nconst review = async (f) => ${opus()}\nawait Promise.allSettled(files.map(review))`, 4)
  assertCounts(`const t = () => ${opus()}\nawait parallel([t, () => ${opus()}])`, 2)
})

test('local helpers that fan out are inlined at their call sites', () => {
  assertCounts(`async function panel() { return parallel([${thunks(2)}]) }\nawait panel()\nawait panel()`, 2)
  assertCounts(`async function panel() { return parallel([${thunks(2)}]) }\nawait parallel([() => panel(), () => panel()])`, 4)
  assertCounts(`async function panel() { return parallel([${thunks(2)}]) }\nawait Promise.allSettled([panel(), panel()])`, 4)
  assertCounts(`const L = [1, 2]\nasync function inner(x) { return parallel([${thunks(2)}]) }\nawait pipeline(L, inner)`, 4)
  assertCounts(`(async () => { await ${opus()}; await ${opus()} })()`, Infinity)
  assertCounts(`await (async () => { await ${opus()}; await ${opus()} })()`, 1)
})

test('nested fan-outs multiply', () => {
  const r = run(`const A = [1, 2]\nconst B = [1, 2]\nawait parallel(A.map(a => () => parallel(B.map(b => () => ${opus()}))))`)
  assert.equal(r.maxOpus, 4)
  assert.equal(r.errors.length, 1)
  assert.ok(r.errors[0].message.includes('Up to 4 opus agents can run at once'))
  assertCounts(`const A = [1, 2]\nconst B = [1]\nawait parallel(A.map(a => () => parallel(B.map(b => () => ${opus()}))))`, 2)
  assertCounts(`const A = [1, 2]\nconst B = ${listOf(2)}\nawait pipeline(A, a => parallel(B.map(b => () => ${opus()})))`, 4)
  assertCounts(`const A = [1, 2, 3]\nawait parallel(A.map(a => async () => { const x = await ${opus()}; await parallel([() => ${opus()}]) }))`, 3)
})

test('escapes make the bound unknown', () => {
  const unawaited = assertCounts(`const p = ${opus()}\nawait p`, Infinity)
  assert.ok(unawaited.errors[0].message.includes(UNKNOWN))
  assertCounts(`const thunks = []\nthunks.push(() => ${opus()})\nawait parallel(thunks)`, Infinity)
  assertCounts(`items.forEach(async x => { await ${opus()} })`, Infinity)
  assertCounts(`${opus()}\nawait ${opus()}`, Infinity)
  assertCounts(`const ps = [${opus()}, ${opus()}]\nawait Promise.all(ps)`, Infinity)
  assertCounts(`async function f() { await ${opus()} }\nf()\nf()\nf()\nf()`, Infinity)
  assertCounts(`void ${opus()}\nawait ${opus()}`, Infinity)
  assertCounts(`const run = () => ${opus()}\nfor (const f of [run, run, run, run]) f()`, Infinity)
  assertCounts(`const run = () => ${opus()}\nawait parallel([run, run])\nsetTimeout(run, 0)`, Infinity)
  assertCounts(`const o = { go() { return ${opus()} } }\nawait o.go()`, Infinity)
  assertCounts(`class K { go() { return ${opus()} } }\nawait new K().go()`, Infinity)
  assertCounts(`function* g() { yield ${opus()} }\nfor (const p of g()) await p`, Infinity)
  assertCounts(`async function f() { await ${opus()} }\nawait Promise.allSettled([f(), f(), f(), f()])`, 4)
  assertCounts(`await parallel(args.items.map(x => ${opus()}))`, Infinity)
  assertCounts(`await parallel([${opus()}, ${opus()}])`, Infinity)
  assertCounts(`await parallel([${thunks(2)}].concat([() => ${opus()}]))`, Infinity)
  assertCounts(`const t = [() => ${opus()}]\nawait parallel(t)`, Infinity)
  assertCounts(`const p = parallel\nawait p([${thunks(4)}])`, Infinity)
  assertCounts(`await Promise['all']([${opus()}, ${opus()}, ${opus()}, ${opus()}])`, Infinity)
  assertCounts(`async function f() { await ${opus()} }\nawait f.call(null)`, Infinity)
  assertCounts(`async function f() { await ${opus()} }\nawait f?.()`, Infinity)
})

test('an escape reaches the opus agents of the local helpers a function calls', () => {
  const helper = `async function helper() { return ${opus()} }\n`
  const items = `const items = ${listOf(10)}\n`
  const cases = [
    `${helper}async function rec(n) {\n  if (n <= 0) return null\n  return parallel([() => helper(), () => rec(n - 1)])\n}\nawait rec(10)`,
    `${helper}async function rec(n) {\n  if (n <= 0) return null\n  return Promise.all([helper(), rec(n - 1)])\n}\nawait rec(10)`,
    `${helper}${items}await helper()\nitems.forEach(() => helper())`,
    `${helper}await helper()\nfunction* gen() { for (let i = 0; i < 10; i++) yield helper() }\nawait Promise.allSettled([...gen()])`,
    `${helper}const wrap = () => helper()\nawait helper()\nconst thunks = []\nfor (let i = 0; i < 10; i++) thunks.push(wrap)\nawait parallel(thunks)`,
    `const inner = async () => ${opus()}\nconst outer = async () => inner()\nawait outer()\n${listOf(10)}.forEach(() => outer())`
  ]
  for (const src of cases) {
    const r = assertCounts(src, Infinity)
    assert.ok(r.errors.every((e) => e.message.includes(UNKNOWN)), src)
  }
  assertCounts(`${helper}await helper()\nawait helper()\nawait helper()`, 1)
})

test('a list that a callback can reach is not trusted to keep its size', () => {
  const fan = `await parallel(items.map(t => () => ${opus()}))`
  const grow = (body) => `const items = [1, 2, 3]\n${body}\n${fan}`
  for (const src of [
    grow(`function cb(x) { return x }\ncb = (x, i, arr) => { if (arr.length < 10) arr.push(0) }\nitems.forEach(cb)`),
    grow(`var cb = function (x) { return x }\nvar cb = function (x, i, arr) { if (arr.length < 10) arr.push(0) }\nitems.forEach(cb)`),
    grow(`items.forEach(function (x) { if (arguments[2].length < 10) arguments[2].push(0) })`),
    grow(`function cb(x) { if (arguments[2].length < 10) arguments[2].push(0) }\nitems.forEach(cb)`),
    grow(`JSON.stringify(items, (k, v) => { if (k === '' && v.length < 10) v.push(0, 0, 0, 0, 0, 0, 0); return v })`),
    grow(`JSON.stringify(items, null, 2)`)
  ]) assertCounts(src, Infinity)
  for (const src of [
    grow(`function cb(x) { return x }\nitems.forEach(cb)`),
    grow(`items.forEach(function (x, i) { log(x, i) })`),
    grow(`items.forEach(x => log(arguments))`),
    grow(`log(JSON.stringify(items))`)
  ]) assertCounts(src, 3)
})

test('slice keeps a literal size only when the script defines no slice, map, flatMap or filter of its own', () => {
  const fan = (receiver) => `await parallel(${receiver}.slice(0, 3).map(t => () => ${opus()}))`
  assertCounts(fan('args.items'), 3)
  assertCounts(`const src = { slice: () => [1, 2, 3, 4, 5, 6, 7, 8] }\n${fan('src')}`, Infinity)
  assertCounts(`const src = { 'slice'() { return [1, 2, 3, 4, 5, 6, 7, 8] } }\n${fan('src')}`, Infinity)
  assertCounts(`class Src { slice() { return [1, 2, 3, 4, 5, 6, 7, 8] } }\n${fan('new Src()')}`, Infinity)
  assertCounts(`const src = {}\nsrc.slice = () => [1, 2, 3, 4, 5, 6, 7, 8]\n${fan('src')}`, Infinity)
  assertCounts(`const items = [1, 2, 3]\nArray.prototype.slice = function () { return [1, 2, 3, 4, 5, 6, 7, 8] }\n${fan('items')}`, Infinity)
  assertCounts(`const src = {}\nObject.defineProperty(src, 'slice', { value: () => [1, 2, 3, 4, 5, 6, 7, 8] })\n${fan('src')}`, Infinity)
  assertCounts(`const src = { map: (cb) => [cb(), cb(), cb(), cb()] }\nawait parallel(src.map(() => () => ${opus()}))`, Infinity)
  assertCounts(`const items = [1, 2, 3]\nArray.prototype.map = function (cb) { return [cb(), cb(), cb(), cb()] }\nawait parallel(items.map(() => () => ${opus()}))`, Infinity)
  assertCounts(`const items = [1, 2, 3]\nconst { slice } = items\nlog(slice)\nawait parallel(items.map(() => () => ${opus()}))`, Infinity)
  assertCounts(`const o = { slice: 1 }\n${fan('args.items')}`, Infinity)
  assertCounts(`const ok = { name: 'x' }\nlog(ok.slice)\n${fan('args.items')}`, 3)
})

test('an opus agent that cannot be traced to where it runs is unknown', () => {
  assertCounts(`async function unused() { await ${opus()} }\nawait ${opus()}`, Infinity)
  assertCounts(`if (false) { const f = () => ${opus()} }\nawait ${opus()}`, Infinity)
})

test('a locally redefined combinator is not trusted', () => {
  assertCounts(`const parallel = async (xs) => xs.map(x => x())\nawait parallel([${thunks(4)}])`, Infinity)
  assertCounts(`function pipeline(xs, f) { return xs.map(f) }\nawait pipeline([1, 2, 3, 4], x => ${opus()})`, Infinity)
  assertCounts(`const Promise = { all: (xs) => xs }\nawait Promise.all([${opus()}, ${opus()}, ${opus()}, ${opus()}])`, Infinity)
  assertCounts(`function f(parallel) { return parallel([${thunks(4)}]) }\nawait f(async xs => xs.map(x => x()))`, Infinity)
})

test('a mutated or aliased const list is unknown', () => {
  assertCounts(`const LIST = [1, 2]\nLIST.push(3)\nawait parallel(LIST.map(x => () => ${opus()}))`, Infinity)
  assertCounts(`const LIST = [1, 2]\nLIST.unshift(3, 4, 5)\nawait parallel(LIST.map(x => () => ${opus()}))`, Infinity)
  assertCounts(`const LIST = [1, 2]\nLIST.splice(0, 0, 1, 2, 3)\nawait parallel(LIST.map(x => () => ${opus()}))`, Infinity)
  assertCounts(`const LIST = [1, 2]\nLIST.length = 9\nawait parallel(LIST.map(x => () => ${opus()}))`, Infinity)
  assertCounts(`const LIST = [1, 2]\nLIST[LIST.length] = 3\nawait parallel(LIST.map(x => () => ${opus()}))`, Infinity)
  assertCounts(`const LIST = [1, 2]\nLIST[7] = 3\nawait parallel(LIST.map(x => () => ${opus()}))`, Infinity)
  assertCounts(`const LIST = [1, 2]\nconst alias = LIST\nalias.push(1, 2, 3)\nawait parallel(LIST.map(x => () => ${opus()}))`, Infinity)
  assertCounts(`const LIST = [1, 2]\ngrow(LIST)\nawait parallel(LIST.map(x => () => ${opus()}))`, Infinity)
  assertCounts(`const LIST = [1, 2]\nArray.prototype.push.call(LIST, 3, 4, 5)\nawait parallel(LIST.map(x => () => ${opus()}))`, Infinity)
  assertCounts(`const LIST = [1, 2]\nLIST.forEach((x, i, arr) => arr.push(x))\nawait parallel(LIST.map(x => () => ${opus()}))`, Infinity)
  assertCounts(`const LIST = [1, 2]\nconst s = LIST.sort()\ns.push(1, 2, 3)\nawait parallel(LIST.map(x => () => ${opus()}))`, Infinity)
  assertCounts(`let LIST = [1, 2]\nawait parallel(LIST.map(x => () => ${opus()}))`, Infinity)
  assertCounts(`const LIST = [1, 2]\nasync function f(LIST) { LIST.push(1, 2) }\nawait parallel(LIST.map(x => () => ${opus()}))`, 2)
})

test('reading a const list in other ways keeps its size', () => {
  const read = `const LIST = [1, 2]\nconst joined = LIST.join(',')\nconst copy = [...LIST]\nconst n = LIST.length\nfor (const x of LIST) log(x)\nlog(\`\${LIST}\`)\nlog(JSON.stringify(LIST), LIST[0])\n`
  assertCounts(`${read}await parallel(LIST.map(x => () => ${opus()}))`, 2)
  assertCounts(`const A = [1, 2]\nconst B = [...A, 3, 4]\nawait parallel(B.map(x => () => ${opus()}))`, 4)
  assertCounts(`const A = [1, 2]\nconst B = [...A, 3]\nawait parallel(B.map(x => () => ${opus()}))`, 3)
})

test('a shadowing name does not borrow the outer const list', () => {
  assertCounts(`const LIST = [1, 2]\nasync function f(LIST) { return parallel(LIST.map(x => () => ${opus()})) }\nawait f(args.items)`, Infinity)
  assertCounts(`const LIST = [1, 2]\n{ const LIST = args.items; await parallel(LIST.map(x => () => ${opus()})) }`, Infinity)
})

test('block scopes give each const list its own size', () => {
  assertCounts(`{ const L = [1, 2]; await parallel(L.map(x => () => ${opus()})) }\n{ const L = [1, 2, 3]; await parallel(L.map(x => () => ${opus()})) }`, 3)
  assertCounts(`{ const L = [1, 2]; await parallel(L.map(x => () => ${opus()})) }\n{ const L = ${listOf(4)}; await parallel(L.map(x => () => ${opus()})) }`, 4)
  assertCounts(`for (const L of [[1, 2]]) { const T = [1, 2, 3]; await parallel(T.map(x => () => ${opus()})) }\nconst T = ${listOf(5)}\nawait ${opus()}`, 3)
})

test('recursion is unknown', () => {
  assertCounts(`const f = async function inner(n) { await parallel([() => ${opus()}, () => inner(n - 1)]) }\nawait f(3)`, Infinity)
  assertCounts(`await (async function loop(n) { await ${opus()}; if (n) await loop(n - 1) })(3)`, Infinity)
  assertCounts(`await parallel([async function inner(n) { await ${opus()}; if (n) await inner(n - 1) }])`, Infinity)
  assertCounts(`async function f(n) { await ${opus()}; if (n) await f(n - 1) }\nawait f(3)`, Infinity)
  assertCounts(`async function a(n) { await ${opus()}; if (n) await b(n - 1) }\nasync function b(n) { if (n) await a(n - 1) }\nawait a(3)`, Infinity)
  assertCounts(`async function walk(n) { if (n) await walk(n - 1) }\nawait walk(3)\nawait ${opus()}`, 1)
})

test('sonnet and haiku fan-outs of any shape never raise the opus bound', () => {
  for (const src of [
    `await parallel(args.items.map(x => () => ${sonnet()}))`,
    `await parallel([${thunks(9, sonnet)}])`,
    `await pipeline(args, a => ${haiku()}, b => ${sonnet()})`,
    `await Promise.all(args.items.map(x => ${sonnet()}))`,
    `const p = ${sonnet()}\nawait p`,
    `items.forEach(async x => { await ${sonnet()} })`,
    `async function f(n) { await ${sonnet()}; if (n) await f(n - 1) }\nawait f(3)`,
    `const thunks = []\nthunks.push(() => ${haiku()})\nawait parallel(thunks)`,
    `await parallel(Array.from({ length: args.n }, () => () => ${sonnet()}))`
  ]) {
    const r = run(src)
    assert.equal(r.maxOpus, 0, src)
    assert.deepEqual(r.errors, [], src)
  }
  const unknown = run(`await parallel(args.items.map(x => () => ${sonnet()}))`)
  assert.deepEqual(unknown.stages, [{ inFanout: true, bigFanout: true }])
  const big = run(`await parallel([${thunks(4, sonnet)}])`)
  assert.ok(big.stages.every((s) => s.inFanout && s.bigFanout))
  const small = run(`await parallel([${thunks(3, sonnet)}])`)
  assert.ok(small.stages.every((s) => s.inFanout && !s.bigFanout))
  assert.equal(small.maxAll, 3)
})

test('opus agents beside a sonnet fan-out only count themselves', () => {
  const r = run(`await parallel([${thunks(2)}, ${thunks(5, sonnet)}])`)
  assert.equal(r.maxOpus, 2)
  assert.equal(r.maxAll, 7)
  assert.deepEqual(r.errors, [])
  assert.ok(r.stages.every((s) => s.inFanout && s.bigFanout))
  const seqThenFan = run(`await ${opus()}\nawait parallel([${thunks(3, sonnet)}])\nawait ${opus()}`)
  assert.equal(seqThenFan.maxOpus, 1)
  assert.deepEqual(seqThenFan.stages.map((s) => s.inFanout), [false, true, true, true, false])
})

test('a batching loop and an outer fan-out only flag the agents inside the construct', () => {
  const r = run(`const A = [1, 2]\nawait ${opus()}\nawait parallel(A.map(a => () => ${sonnet()}))`)
  assert.deepEqual(r.stages, [
    { inFanout: false, bigFanout: false },
    { inFanout: true, bigFanout: false }
  ])
})

test('error messages name the stage and the fix', () => {
  const over = run(`await parallel([${thunks(4)}])`)
  const e = over.errors[0]
  assert.equal(e.code, 'FANOUT')
  assert.equal(e.line, 1)
  assert.equal(e.label, 'decide: x')
  assert.equal(e.stage, 0)
  assert.ok(e.message.includes('Up to 4 opus agents can run at once'))
  assert.ok(e.message.includes('limit is 3'))
  assert.ok(e.message.includes('items.slice(0, 3)'))
  assert.ok(e.message.includes('items.slice(i, i + 3)'))

  const unknown = run(`await parallel(args.items.map(x => () => ${opus('judge: ${x}')}))`)
  assert.equal(unknown.errors.length, 1)
  assert.ok(unknown.errors[0].message.includes('tierguard cannot count how many opus agents run at once here (the size of args.items is not known)'))
  assert.ok(unknown.errors[0].message.includes('at most 3'))
  assert.equal(unknown.errors[0].label, 'judge: ${x}')
})

test('only the opus stages that contribute are reported', () => {
  const r = run(`await ${opus('judge: a')}\nawait parallel([${thunks(4)}])\nawait ${sonnet('build: b')}\nawait ${opus('judge: c')}`)
  assert.deepEqual(r.errors.map((e) => e.stage), [1, 2, 3, 4])
  const s = run(`await parallel([${thunks(2)}, ${thunks(2, sonnet)}, ${thunks(1)}])`)
  assert.deepEqual(s.errors, [])
  const mix = run(`await parallel([${thunks(4, sonnet)}, ${thunks(4)}])`)
  assert.deepEqual(mix.errors.map((e) => e.stage), [4, 5, 6, 7])
  const unk = run(`await ${opus('judge: a')}\nawait parallel(args.xs.map(x => () => ${opus('judge: b')}))\nawait ${sonnet('build: c')}`)
  assert.deepEqual(unk.errors.map((e) => e.stage), [1])
})

test('an over-limit message states the count of the construct that holds the stage', () => {
  const r = run(`await parallel([${thunks(4)}])\nawait parallel([${thunks(5)}])`)
  assert.equal(r.maxOpus, 5)
  assert.ok(r.errors.slice(0, 4).every((e) => e.message.includes('Up to 4 ')))
  assert.ok(r.errors.slice(4).every((e) => e.message.includes('Up to 5 ')))
})

test('a stage whose model cannot be read counts as opus', () => {
  const src = `await parallel([${Array.from({ length: 4 }, () => `() => agent('p', { label: 'x: y', model: m, effort: 'high' })`).join(', ')}])`
  const r = run(src)
  assert.equal(r.maxOpus, 4)
  assert.equal(r.errors.length, 4)
})

test('limits are read from the argument', () => {
  const r = run(`await parallel([${thunks(2)}])`, { maxConcurrentOpus: 1, bigFanout: 1 })
  assert.equal(r.errors.length, 2)
  assert.ok(r.errors[0].message.includes('the limit is 1'))
  assert.ok(r.stages.every((s) => s.bigFanout))
  const ok = run(`await parallel([${thunks(2)}])`, { maxConcurrentOpus: 2, bigFanout: 3 })
  assert.deepEqual(ok.errors, [])
  assert.ok(ok.stages.every((s) => s.inFanout && !s.bigFanout))
})

test('a script with no agents, or a missing tree, is trivially fine', () => {
  const none = run('log("x")')
  assert.deepEqual(none, { maxOpus: 0, maxAll: 0, stages: [], errors: [] })
  assert.deepEqual(fanout(null, [], [], LIMITS), { maxOpus: 0, maxAll: 0, stages: [], errors: [] })
})

test('a script too deep to analyse fails closed instead of throwing', () => {
  const r = run(`await ${opus()}\nconst x = ${'a + '.repeat(3000)}a`)
  assert.equal(r.maxOpus, Infinity)
  assert.equal(r.errors.length, 1)
  assert.ok(r.errors[0].message.includes(UNKNOWN))
  assert.equal(run(`await ${sonnet()}\nconst x = ${'a + '.repeat(3000)}a`).errors.length, 0)
})

test('realistic compliant workflows pass', () => {
  const research = `
export const meta = { name: 'x', description: 'y' }
phase('Research')
const topics = args.topics
const findings = await parallel(topics.map(t => () => ${sonnet('investigate: ${t}')}))
const usable = findings.filter(Boolean)
phase('Decide')
const ranked = usable.slice(0, 20)
const designs = await parallel([
  ...ranked.slice(0, 3).map(t => () => ${opus('design: ${t.key}')}),
  ...ranked.slice(3).map(t => () => ${sonnet('design: ${t.key}')})
])
const verdict = await ${opus('judge: final')}
return verdict`
  const r = run(research)
  assert.equal(r.maxOpus, 3)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.stages.map((s) => s.bigFanout), [true, true, true, false])

  const reviewLoop = `
const results = await pipeline(
  args.files,
  (file) => ${sonnet('build: ${file}')},
  (built, file) => ${opus('judge: ${file}')}
)`
  assert.equal(run(reviewLoop).maxOpus, Infinity)
  const reviewBatched = `
const files = args.files
const out = []
for (let i = 0; i < files.length; i += 3) {
  const batch = await parallel(files.slice(i, i + 3).map(f => () => ${opus('judge: ${f}')}))
  out.push(...batch)
}
return out`
  const b = run(reviewBatched)
  assert.equal(b.maxOpus, 3)
  assert.deepEqual(b.errors, [])
})

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const SIM_ARGS = [
  { items: [1, 2, 3, 4, 5, 6, 7], flag: true },
  { items: [1, 2, 3, 4, 5, 6, 7], flag: false },
  { items: [1], flag: true },
  { items: [], flag: false }
]

function generate(seed) {
  let s = seed | 0
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)]
  const many = (n, f) => Array.from({ length: 1 + Math.floor(rnd() * n) }, f)
  const strict = seed % 2 === 1
  const lists = ['L2', 'L4', 'args.items', 'L3.slice(0, 2)', 'args.items.slice(0, 3)', 'args.items.slice(2)', 'Array.from({ length: 4 })', 'L4.filter(Boolean)']
  const helpers = []
  let uid = 0
  const agentCall = () => `agent('p', { label: 'x: y', model: '${pick(['opus', 'opus', 'sonnet'])}', effort: 'high' })`
  const good = ['agent', 'agent', 'par', 'parmap', 'parslice', 'pipe', 'pall', 'pallmap', 'helper', 'iife', 'then', 'loop', 'cond', 'spread']
  const expr = (d) => {
    if (d <= 0) return agentCall()
    const e = () => expr(d - 1)
    switch (pick(strict ? good : [...good, 'bad', 'race'])) {
      case 'par':
        return `parallel([${many(4, () => `() => ${e()}`).join(', ')}])`
      case 'parmap':
        return `parallel(${pick(lists)}.map(x => () => ${e()}))`
      case 'parslice':
        return `parallel(args.items.slice(${pick([0, 1, 2])}, ${pick([2, 3, 4])}).map(x => ${pick([`() => ${e()}`, `async () => { await ${e()} }`])}))`
      case 'pipe':
        return `pipeline(${pick(['L2', 'L4', 'args.items'])}, a => ${e()}, (b, it, i) => ${e()})`
      case 'pall':
        return `Promise.all([${many(3, e).join(', ')}])`
      case 'pallmap':
        return `Promise.all(${pick(lists)}.map(async x => { const r = await ${e()}; return r }))`
      case 'helper': {
        const name = `h${++uid}`
        helpers.push(`async function ${name}() { ${rnd() < 0.5 ? `return ${e()}` : `await ${e()}; await ${e()}`} }`)
        return `${name}()`
      }
      case 'iife':
        return `(async () => { await ${e()}; return ${e()} })()`
      case 'then':
        return `${e()}.then(v => ${e()})`
      case 'loop':
        return `(async () => { for (let k = 0; k < 2; k++) { await ${e()} } })()`
      case 'cond':
        return `(args.flag ? ${e()} : ${e()})`
      case 'spread':
        return `parallel([...L2.map(x => () => ${e()}), ...args.items.slice(0, 2).map(x => () => ${e()})])`
      case 'bad':
        return pick([`new Promise(res => { ${agentCall()}; res() })`, `Promise.resolve(${e()})`, `(async () => { ${e()}; ${e()} })()`])
      case 'race':
        return `Promise.${pick(['race', 'any'])}([${e()}, ${e()}])`
      default:
        return agentCall()
    }
  }
  const stmt = (d) => {
    switch (pick(strict ? ['await', 'await', 'for', 'if', 'batch'] : ['await', 'await', 'fire', 'const', 'for', 'if', 'batch', 'forEach', 'push', 'timer'])) {
      case 'fire':
        return expr(d)
      case 'const': {
        const n = `p${++uid}`
        return `const ${n} = ${expr(d)}\nawait ${n}`
      }
      case 'for':
        return `for (let q = 0; q < 2; q++) {\n${stmts(d - 1)}\n}`
      case 'if':
        return `if (args.flag) {\n${stmts(d - 1)}\n} else {\n${stmts(d - 1)}\n}`
      case 'batch': {
        const k = pick([2, 3])
        return `for (let i = 0; i < args.items.length; i += ${k}) await parallel(args.items.slice(i, i + ${k}).map(x => () => ${expr(d - 1)}))`
      }
      case 'forEach':
        return `args.items.forEach(async x => { await ${expr(d - 1)} })`
      case 'push': {
        const n = `th${++uid}`
        return `const ${n} = []\n${n}.push(() => ${expr(d - 1)})\nawait parallel(${n})`
      }
      case 'timer':
        return `setTimeout(() => ${expr(d - 1)}, 0)`
      default:
        return `await ${expr(d)}`
    }
  }
  const stmts = (d) => many(2, () => stmt(d)).join('\n')
  const body = stmts(3)
  return `const L2 = [1, 2]\nconst L3 = [1, 2, 3]\nconst L4 = [1, 2, 3, 4]\n${helpers.join('\n')}\n${body}`
}

async function simulate(src, args) {
  let running = 0
  let pending = 0
  let peak = 0
  const tick = () => new Promise((resolve) => setTimeout(resolve, 1))
  const agent = async (p, o) => {
    pending++
    if (o.model === 'opus') peak = Math.max(peak, ++running)
    await tick()
    if (o.model === 'opus') running--
    pending--
    return { items: [1, 2, 3] }
  }
  const parallel = (ts) =>
    Promise.all(
      ts.map(async (t) => {
        try {
          return await t()
        } catch {
          return null
        }
      })
    )
  const pipeline = (items, ...stages) =>
    Promise.all(
      items.map(async (item, i) => {
        try {
          let prev = item
          for (const st of stages) prev = await st(prev, item, i)
          return prev
        } catch {
          return null
        }
      })
    )
  const body = new AsyncFunction('agent', 'parallel', 'pipeline', 'args', src)
  await body(agent, parallel, pipeline, args).catch(() => {})
  while (pending > 0) await tick()
  return peak
}

test('the bound is never below the real concurrency of generated scripts', async () => {
  let finite = 0
  for (let seed = 1; seed <= 80; seed++) {
    const src = generate(seed)
    const r = run(src)
    if (r.maxOpus !== Infinity) finite++
    let worst = 0
    for (const args of SIM_ARGS) worst = Math.max(worst, await simulate(src, args))
    assert.ok(worst <= r.maxOpus, `seed ${seed}: bound ${r.maxOpus}, ran ${worst}\n${src}`)
  }
  assert.ok(finite >= 20, `only ${finite} generated scripts had a finite bound`)
})
