import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as acorn from '../vendor/acorn.mjs'
import { analyze, identifiers } from '../src/analyze.mjs'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const readFixture = (kind, name) => readFileSync(join(FIXTURES, kind, name), 'utf8')
const listFixtures = (kind) => readdirSync(join(FIXTURES, kind)).filter((f) => f.endsWith('.js')).sort()

const CODES = new Set(['SOURCE', 'PARSE', 'SHAPE', 'PAIR', 'ENV'])
const ERROR_KEYS = new Set(['code', 'line', 'label', 'message', 'stage', 'needsBlockedOn'])

function assertContract(result) {
  assert.ok(Array.isArray(result.stages))
  assert.ok(Array.isArray(result.errors))
  assert.ok(Array.isArray(result.calls))
  assert.equal(result.calls.length, result.stages.length)
  for (const e of result.errors) {
    assert.ok(CODES.has(e.code), `bad code ${e.code}`)
    assert.ok(e.line === null || (Number.isInteger(e.line) && e.line >= 1), `bad line ${e.line}`)
    assert.ok(e.label === null || typeof e.label === 'string', `bad label ${e.label}`)
    assert.equal(typeof e.message, 'string')
    assert.ok(e.message.length > 0)
    assert.ok(e.stage === null || (Number.isInteger(e.stage) && e.stage >= 0 && e.stage < result.stages.length), `bad stage ${e.stage}`)
    assert.ok(e.needsBlockedOn === undefined || e.needsBlockedOn === true)
    for (const key of ['code', 'line', 'label', 'message', 'stage']) assert.ok(key in e, `missing ${key}`)
    for (const key of Object.keys(e)) assert.ok(ERROR_KEYS.has(key), `unexpected key ${key}`)
    if (e.stage !== null) assert.equal(e.label, result.stages[e.stage].label)
    else assert.equal(e.label, null)
  }
  for (const s of result.stages) {
    assert.deepEqual(Object.keys(s), ['line', 'label', 'class', 'model', 'effort', 'hasBlockedOn', 'verdict'])
    assert.equal(typeof s.hasBlockedOn, 'boolean')
    assert.equal(typeof s.verdict, 'boolean')
    assert.ok(Number.isInteger(s.line) && s.line >= 1)
  }
}

const codesOf = (r) => r.errors.map((e) => e.code)

const BLOCKED_ON = "blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }"
const OPUS = "label: 'decide: pick', model: 'opus', effort: 'high'"
const SONNET = `label: 'build: parser', model: 'sonnet', effort: 'high', schema: { type: 'object', properties: { files: { type: 'array' }, ${BLOCKED_ON} } }`
const call = (opts) => `await agent('p', { ${opts} })`
const sonnetWithBlockedOn = (inner) =>
  call(`label: 'build: parser', model: 'sonnet', effort: 'high', schema: { type: 'object', properties: { blocked_on: ${inner} } }`)

test('identifier visitor matches the set derived once with acorn-walk 8.3.5 walk.full', () => {
  const PROBE = `const a = x?.y?.(1); class C { static { agent; } #p=1; m(){ return #p in this } static accessor = 1 }
label: for(;;){ break label }
const {agent: q, ...r} = o; import('x'); a ??= 1;
const o2 = { agent, workflow: 1, [workflow]: 2 }; o.workflow; import.meta;`
  const ast = acorn.parse(PROBE, { ecmaVersion: 'latest', sourceType: 'module' })
  const names = identifiers(ast).map((n) => n.name).sort()
  const expected = ['a', 'x', 'C', 'agent', 'q', 'r', 'o', 'a', 'o2', 'agent', 'workflow', 'o'].sort()
  assert.deepEqual(names, expected)
  assert.ok(identifiers(ast).every((n) => n.type === 'Identifier'))
})

test('pins Claude Code 2.1.319 wrapper facts (module-mode parse of a strict body); re-check on Claude Code upgrades', () => {
  const accepted = analyze(
    [
      "export const meta = { name: 'x', description: 'y' }",
      `const r = ${call(OPUS)}`,
      'return r'
    ].join('\n')
  )
  assert.deepEqual(accepted.errors, [])
  assert.equal(accepted.stages.length, 1)
  assert.equal(accepted.ast.type, 'Program')

  for (const [name, source] of [
    ['with statement', 'with (x) { y }'],
    ['legacy octal literal', 'const n = 010'],
    ['HTML-like comment', '<!-- hidden\nconst n = 1']
  ]) {
    const r = analyze(source)
    assert.deepEqual(codesOf(r), ['PARSE'], name)
    assert.equal(r.ast, null, name)
    assert.deepEqual(r.stages, [], name)
    assertContract(r)
  }
})

test('parse failure reports one PARSE error with the line', () => {
  const r = analyze('const a = 1\nconst = 2\n')
  assert.deepEqual(codesOf(r), ['PARSE'])
  assert.equal(r.errors[0].line, 2)
  assert.equal(r.errors[0].stage, null)
  assert.equal(r.errors[0].label, null)
  assert.match(r.errors[0].message, /Unexpected token/)
})

test('analyze rejects a non-string source instead of analysing it', () => {
  assert.throws(() => analyze(undefined), TypeError)
  assert.throws(() => analyze(null), TypeError)
})

test('good fixtures produce no errors', () => {
  const files = listFixtures('good')
  assert.ok(files.length >= 4)
  for (const file of files) {
    const r = analyze(readFixture('good', file))
    assert.deepEqual(r.errors, [], `${file}: ${JSON.stringify(r.errors)}`)
    assert.ok(r.stages.length > 0, file)
    assertContract(r)
  }
})

const E = (code, message, stage = null, needsBlockedOn = false) => ({ code, message, stage, needsBlockedOn })
const CALLED_DIRECTLY = /agent must be called directly/
const NEEDS_SCHEMA = /need an inline schema with blocked_on/

const BAD = {
  'map-agent.js': [E('SHAPE', CALLED_DIRECTLY, null, true)],
  'alias-agent.js': [E('SHAPE', CALLED_DIRECTLY, null, true)],
  'globalthis-agent.js': [E('SHAPE', /globalThis is not allowed/)],
  'this-agent.js': [E('SHAPE', /this is not allowed/)],
  'eval.js': [E('SHAPE', /eval is not allowed/)],
  'function-constructor.js': [E('SHAPE', /Function is not allowed/)],
  'workflow-alias.js': [E('SOURCE', /workflow is not allowed.*inline the child/)],
  'workflow-sequence-call.js': [E('SOURCE', /workflow is not allowed.*inline the child/)],
  'workflow-direct-call.js': [E('SOURCE', /workflow is not allowed.*inline the child/)],
  'spread-args.js': [E('SHAPE', /exactly 2 arguments with no spread/, 0, true)],
  'spread-options.js': [E('SHAPE', /options must not use spread/, 0)],
  'duplicate-effort.js': [E('SHAPE', /duplicate "effort"/, 0)],
  'param-named-agent.js': [E('SHAPE', /rename the variable/)],
  'destructured-agent.js': [E('SHAPE', /rename the variable/)],
  'label-expression-prefix.js': [E('SHAPE', /literal class prefix/, 0, true)],
  'label-missing.js': [E('SHAPE', /label is missing/, 0, true)],
  'label-no-prefix.js': [E('SHAPE', /literal class prefix/, 0, true)],
  'label-concat.js': [E('SHAPE', /string or template literal/, 0, true)],
  'shared-schema-const.js': [E('SHAPE', /shared schema const/, 0, true)],
  'schema-no-blocked-on.js': [E('SHAPE', /blocked_on is missing/, 0, true)],
  'schema-missing-sonnet.js': [E('SHAPE', NEEDS_SCHEMA, 0, true)],
  'schema-missing-haiku.js': [E('SHAPE', NEEDS_SCHEMA, 0, true)],
  'blocked-on-wrong-type.js': [E('SHAPE', /blocked_on\.type must be/, 0, true)],
  'blocked-on-identifier.js': [E('SHAPE', /only literals/, 0, true)],
  'blocked-on-empty-description.js': [E('SHAPE', /blocked_on\.description must be a non-empty/, 0, true)],
  'schema-spread.js': [E('SHAPE', /schema must not use spread or computed keys/, 0, true)],
  'properties-spread.js': [E('SHAPE', /schema\.properties must not use spread or computed keys/, 0, true)],
  'optional-call.js': [E('SHAPE', CALLED_DIRECTLY, null, true)],
  'new-agent.js': [E('SHAPE', CALLED_DIRECTLY, null, true)],
  'tagged-agent.js': [E('SHAPE', CALLED_DIRECTLY, null, true)],
  'sequence-agent.js': [E('SHAPE', CALLED_DIRECTLY, null, true)],
  'agent-call-method.js': [E('SHAPE', CALLED_DIRECTLY, null, true)],
  'agent-type.js': [E('SHAPE', /agentType is not allowed/, 0)],
  'nonliteral-model.js': [E('SHAPE', /model\/effort must be a quoted string literal/, 0, true)],
  'template-effort.js': [E('SHAPE', /model\/effort must be a quoted string literal/, 0)],
  'missing-effort.js': [E('SHAPE', /effort is missing/, 0)],
  'one-argument.js': [E('SHAPE', /exactly 2 arguments/, 0, true)],
  'options-identifier.js': [E('SHAPE', /options must be an object literal/, 0, true)],
  'parse-error.js': [E('PARSE', /Unexpected token|Unterminated|Unexpected/)]
}

const GATE_ONLY = [
  'decide-sonnet-alone.js',
  'fanout-four-opus.js',
  'fanout-unknown-size.js',
  'investigate-opus.js',
  'judge-sonnet-findings.js',
  'label-investigation.js'
]

test('every bad fixture has an expectation and every expectation has a fixture', () => {
  assert.deepEqual(listFixtures('bad'), [...Object.keys(BAD), ...GATE_ONLY].sort())
})

test('gate-only bad fixtures are clean for the analyzer; the rules and the fan-out analysis deny them in the gate test', () => {
  for (const file of GATE_ONLY) {
    const r = analyze(readFixture('bad', file))
    assertContract(r)
    assert.deepEqual(r.errors, [], file)
    assert.ok(r.stages.length > 0, file)
  }
})

for (const [file, expected] of Object.entries(BAD)) {
  test(`bad fixture ${file}`, () => {
    const r = analyze(readFixture('bad', file))
    assertContract(r)
    assert.equal(r.errors.length, expected.length, JSON.stringify(r.errors))
    expected.forEach((want, i) => {
      const got = r.errors[i]
      assert.equal(got.code, want.code)
      assert.match(got.message, want.message)
      assert.equal(got.stage, want.stage)
      assert.equal(got.needsBlockedOn === true, want.needsBlockedOn)
    })
    if (expected[0].code === 'PARSE') {
      assert.equal(r.ast, null)
      assert.deepEqual(r.stages, [])
    }
  })
}

test('bad fixture label with an expression before the prefix keeps class null and the template text', () => {
  const r = analyze(readFixture('bad', 'label-expression-prefix.js'))
  assert.equal(r.stages.length, 1)
  assert.equal(r.stages[0].class, null)
  assert.equal(r.stages[0].label, '${…}decide: pick the approach')
  assert.equal(r.stages[0].model, 'opus')
  assert.equal(r.stages[0].effort, 'high')
})

test('stage records carry literal values, the class and the line', () => {
  const r = analyze(`
const a = ${call(OPUS)}
const b = await agent(\`p\`, {
  label: \`build: parse \${a}\`,
  model: 'sonnet',
  effort: 'xhigh',
  schema: { type: 'object', properties: { ${BLOCKED_ON} } }
})
const c = ${call("label: 'code: rename', model: 'haiku', effort: 'xhigh', schema: { type: 'object', properties: { " + BLOCKED_ON + ' } }')}
`)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.stages, [
    { line: 2, label: 'decide: pick', class: 'decide', model: 'opus', effort: 'high', hasBlockedOn: false, verdict: false },
    { line: 3, label: 'build: parse ${…}', class: 'build', model: 'sonnet', effort: 'xhigh', hasBlockedOn: true, verdict: false },
    { line: 9, label: 'code: rename', class: 'code', model: 'haiku', effort: 'xhigh', hasBlockedOn: true, verdict: false }
  ])
})

test('stages are listed in source order, outer call before the call nested in its arguments', () => {
  const r = analyze(
    `const x = await agent(\`use \${await agent('inner', { label: 'grunt: inner', model: 'opus', effort: 'high' })}\`, { label: 'decide: outer', model: 'opus', effort: 'high' })`
  )
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.stages.map((s) => s.label), ['decide: outer', 'grunt: inner'])
})

test('a no-substitution template label is accepted and its class captured', () => {
  const r = analyze(call("label: `judge: review`, model: 'opus', effort: 'high'"))
  assert.deepEqual(r.errors, [])
  assert.equal(r.stages[0].class, 'judge')
  assert.equal(r.stages[0].label, 'judge: review')
})

test('quoted option keys are read like identifier keys', () => {
  const r = analyze(call("'label': 'decide: pick', 'model': 'opus', 'effort': 'high'"))
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.stages[0], { line: 1, label: 'decide: pick', class: 'decide', model: 'opus', effort: 'high', hasBlockedOn: false, verdict: false })
})

test('label class is the lowercase-letters-then-colon capture, case-sensitive and untrimmed', () => {
  for (const label of ["'Decide: x'", "' decide: x'", "'decide x'", "'decide-x: y'", "'decide2: y'", "':x'", '`decide${1}: x`']) {
    const r = analyze(call(`label: ${label}, model: 'opus', effort: 'high'`))
    assert.deepEqual(codesOf(r), ['SHAPE'], label)
    assert.equal(r.stages[0].class, null, label)
  }
  const ok = analyze(call("label: 'decide:x', model: 'opus', effort: 'high'"))
  assert.deepEqual(ok.errors, [])
  assert.equal(ok.stages[0].class, 'decide')
})

test('an unknown class is not an analyzer concern', () => {
  const r = analyze(call("label: 'ponder: x', model: 'opus', effort: 'high'"))
  assert.deepEqual(r.errors, [])
  assert.equal(r.stages[0].class, 'ponder')
})

test('model and effort are read as given, never validated or normalised here', () => {
  const r = analyze(call(`label: 'decide: x', model: 'Opus', effort: 'low', schema: { type: 'object', properties: { ${BLOCKED_ON} } }`))
  assert.deepEqual(r.errors, [])
  assert.equal(r.stages[0].model, 'Opus')
  assert.equal(r.stages[0].effort, 'low')
})

test('model and effort must be plain string literals', () => {
  for (const value of ['`opus`', 'opus', "'op' + 'us'", '1', 'null', 'undefined', 'String.raw`opus`']) {
    const r = analyze(call(`label: 'decide: x', model: ${value}, effort: 'high'`))
    assert.deepEqual(codesOf(r), ['SHAPE'], value)
    assert.match(r.errors[0].message, /model\/effort must be a quoted string literal/)
    assert.equal(r.stages[0].model, null)
  }
})

test('shorthand, computed, getter and method options are not read as model/effort', () => {
  const shorthand = analyze(`const model = 'opus'; ${call("label: 'decide: x', model, effort: 'high'")}`)
  assert.match(shorthand.errors[0].message, /quoted string literal/)
  const computed = analyze(call("label: 'decide: x', ['model']: 'opus', effort: 'high'"))
  assert.match(computed.errors[0].message, /model is missing/)
  const getter = analyze(call("label: 'decide: x', get model() { return 'opus' }, effort: 'high'"))
  assert.equal(getter.errors.length, 1)
  assert.equal(getter.stages[0].model, null)
  const method = analyze(call("label: 'decide: x', model() { return 'opus' }, effort: 'high'"))
  assert.equal(method.errors.length, 1)
  assert.equal(method.stages[0].model, null)
})

test('duplicates of model, effort, label and schema are SHAPE, an extra getter counts as a duplicate', () => {
  for (const name of ['model', 'effort', 'label']) {
    const base = { model: "'opus'", effort: "'high'", label: "'decide: x'" }
    const opts = Object.entries(base).map(([k, v]) => `${k}: ${v}`).join(', ')
    const r = analyze(call(`${opts}, ${name}: ${base[name]}`))
    assert.deepEqual(codesOf(r), ['SHAPE'], name)
    assert.match(r.errors[0].message, new RegExp(`duplicate "${name}"`))
  }
  const dupSonnet = analyze(call(`${SONNET}, schema: { type: 'object', properties: { ${BLOCKED_ON} } }`))
  assert.deepEqual(codesOf(dupSonnet), ['SHAPE'])
  assert.equal(dupSonnet.errors[0].needsBlockedOn, true)
  const dupOpus = analyze(call(`${OPUS}, schema: { a: 1 }, schema: { b: 2 }`))
  assert.deepEqual(codesOf(dupOpus), ['SHAPE'])
  assert.equal(dupOpus.errors[0].needsBlockedOn, undefined)
  const viaGetter = analyze(call(`${OPUS}, get effort() { return 'low' }`))
  assert.match(viaGetter.errors[0].message, /duplicate "effort"/)
})

test('agentType is denied in any form', () => {
  for (const form of ["agentType: 'x'", "'agentType': 'x'", 'agentType']) {
    const r = analyze(`const agentType = 'x'; ${call(`${OPUS}, ${form}`)}`)
    assert.deepEqual(codesOf(r), ['SHAPE'], form)
    assert.match(r.errors[0].message, /agentType is not allowed/)
  }
})

test('unrelated option keys, including a typo of effort, are not checked beyond the missing field', () => {
  const ok = analyze(call(`${OPUS}, phase: 'Decide', isolation: 'worktree', whatever: [1, 2]`))
  assert.deepEqual(ok.errors, [])
  const typo = analyze(call("label: 'decide: x', model: 'opus', efort: 'high'"))
  assert.deepEqual(codesOf(typo), ['SHAPE'])
  assert.match(typo.errors[0].message, /effort is missing/)
})

test('argument shape: exactly two arguments, no spread, options must be an object literal', () => {
  for (const args of ["'p'", "'p', {}, 1", '...rest', "'p', ...rest", '']) {
    const r = analyze(`await agent(${args})`)
    assert.ok(r.errors.some((e) => /exactly 2 arguments/.test(e.message)), args)
    assert.equal(r.stages.length, 1, args)
    assert.ok(r.errors.every((e) => e.code === 'SHAPE'))
    assertContract(r)
  }
  const idOptions = analyze("await agent('p', opts)")
  assert.deepEqual(idOptions.errors.map((e) => e.message.match(/options must be an object literal/) !== null), [true])
  const arrayOptions = analyze("await agent('p', [])")
  assert.match(arrayOptions.errors[0].message, /options must be an object literal/)
})

test('three arguments still get their options analysed', () => {
  const r = analyze(`await agent('p', { label: 'decide: x', model: 'opus', effort: 'max' }, 'extra')`)
  assert.equal(r.errors.length, 1)
  assert.match(r.errors[0].message, /exactly 2 arguments/)
  assert.equal(r.stages[0].effort, 'max')
})

test('spread options are denied even when model, effort and label are literals', () => {
  const r = analyze(call(`...base, ${OPUS}`))
  assert.deepEqual(codesOf(r), ['SHAPE'])
  assert.match(r.errors[0].message, /spread/)
  assert.equal(r.stages[0].model, 'opus')
})

test('direct calls in every ordinary position are accepted', () => {
  const r = analyze(
    [
      `const a = (agent)('p', { ${OPUS} })`,
      `const b = await agent('p', { ${OPUS} })?.x`,
      `const c = [1, 2].map((n) => agent('p' + n, { ${OPUS} }))`,
      `const d = cond ? agent('p', { ${OPUS} }) : null`,
      `async function f(x) { return await agent(x, { ${OPUS} }) }`,
      `for (const i of items) { await agent('p', { ${OPUS} }) }`
    ].join('\n')
  )
  assert.deepEqual(r.errors, [])
  assert.equal(r.stages.length, 6)
})

test('agent used as a value asks for the blocked_on snippet and names the requirements', () => {
  for (const source of ['const run = agent', 'await Promise.all(prompts.map(agent))']) {
    const r = analyze(source)
    const e = r.errors.find((x) => CALLED_DIRECTLY.test(x.message))
    assert.equal(e.needsBlockedOn, true, source)
    assert.match(e.message, /label, model and effort/, source)
  }
})

test('agent used as anything but a direct call is SHAPE, each once', () => {
  const sources = [
    'const run = agent',
    'foo(agent)',
    'foo(1, agent)',
    '[agent]',
    '({ f: agent })',
    '({ agent })',
    'const { x = agent } = y',
    'agent;',
    'typeof agent',
    'agent?.("p", {})',
    'agent?.x',
    'new agent("p", {})',
    'agent`p`',
    '(0, agent)("p", {})',
    'agent.call(null, "p", {})',
    'export default agent',
    'const t = `${agent}`',
    'agent = 1'
  ]
  for (const source of sources) {
    const r = analyze(source)
    const mine = r.errors.filter((e) => CALLED_DIRECTLY.test(e.message))
    assert.equal(mine.length, 1, `${source}: ${JSON.stringify(r.errors)}`)
    assert.equal(mine[0].code, 'SHAPE')
    assert.equal(mine[0].stage, null)
  }
})

test('any binding named agent is SHAPE with the rename message', () => {
  const sources = [
    'const agent = 1',
    'let [agent] = x',
    'var { agent } = x',
    'const { a: agent } = x',
    'const { a: [agent] } = x',
    'const { ...agent } = x',
    'const { a = 1, ...agent } = x',
    'function f(agent) {}',
    'function f(a, { agent }) {}',
    'function f(a = 1, ...agent) {}',
    'const f = (agent) => 1',
    'const f = function (agent) {}',
    'function agent() {}',
    'const f = function agent() {}',
    'class agent {}',
    'const C = class agent {}',
    'try { x } catch (agent) {}',
    'try { x } catch ({ agent }) {}',
    'for (const agent of xs) {}'
  ]
  for (const source of sources) {
    const r = analyze(source)
    assert.equal(r.errors.length, 1, `${source}: ${JSON.stringify(r.errors)}`)
    assert.equal(r.errors[0].code, 'SHAPE')
    assert.match(r.errors[0].message, /rename the variable/, source)
  }
})

test('workflow in any visited position is SOURCE with the inline-the-child fix', () => {
  const sources = [
    'workflow("x")',
    'await workflow({ scriptPath: "/tmp/x.js" })',
    'const w = workflow',
    '(0, workflow)("x")',
    'foo(workflow)',
    '({ [workflow]: 1 })',
    '({ workflow })'
  ]
  for (const source of sources) {
    const r = analyze(source)
    assert.ok(r.errors.length >= 1, source)
    assert.ok(r.errors.every((e) => e.code === 'SOURCE' && e.stage === null && /inline the child/.test(e.message)), source)
  }
})

test('a binding named workflow is SOURCE with the rename fix, not the inline-the-child fix', () => {
  const sources = [
    'const workflow = 1',
    'function workflow() {}',
    'function f(workflow) {}',
    'const f = (workflow) => agent(workflow)',
    'const { workflow } = o',
    'try { x } catch (workflow) {}',
    'class workflow {}'
  ]
  for (const source of sources) {
    const r = analyze(source)
    const own = r.errors.filter((e) => /workflow/.test(e.message))
    assert.ok(own.length >= 1, source)
    assert.ok(own.every((e) => e.code === 'SOURCE' && /rename the variable/.test(e.message) && !/inline the child/.test(e.message)), `${source}: ${JSON.stringify(own)}`)
  }
})

test('globalThis, eval, Function and this are SHAPE', () => {
  const sources = [
    'globalThis.agent("p", {})',
    'globalThis',
    'eval("1")',
    'Function("return 1")',
    'new Function("return 1")',
    'x instanceof Function',
    'const f = () => this',
    'class K { m() { return this } }',
    'this'
  ]
  for (const source of sources) {
    const r = analyze(source)
    assert.ok(r.errors.length >= 1, source)
    assert.ok(r.errors.every((e) => e.code === 'SHAPE' && e.stage === null), source)
  }
})

test('names that are only property keys, member names, labels, meta or specifiers are not visited', () => {
  const source = [
    'const o = { agent: 1, workflow: 2, globalThis: 3, eval: 4, Function: 5, "agent": 6 }',
    'o.agent; o.workflow; o.eval; o.Function; o.globalThis; o?.agent; o.a.workflow',
    'class K { agent() {} workflow = 1; static eval() {} get Function() { return 1 } static { } }',
    'agent: for (;;) { break agent }',
    'workflow: for (;;) { continue workflow }',
    'const m = import.meta',
    'const { agent: q, workflow: r, ...rest } = o',
    'export { o as agent, q as workflow }',
    'import { agent as a1, workflow as w1 } from "x"',
    'import agentDefault from "x"',
    'import * as ns from "x"'
  ].join('\n')
  const r = analyze(source)
  assert.deepEqual(r.errors, [])
})

test('computed keys and member expressions are visited', () => {
  assert.deepEqual(codesOf(analyze('({ [workflow]: 1 })')), ['SOURCE'])
  assert.deepEqual(codesOf(analyze('o[agent]')), ['SHAPE'])
  assert.deepEqual(codesOf(analyze('o[globalThis]')), ['SHAPE'])
  assert.deepEqual(codesOf(analyze('class K { [agent]() {} }')), ['SHAPE'])
})

test('all errors are emitted, ordered by line, each once', () => {
  const source = [
    'const run = agent',
    'const w = workflow',
    "await agent('p')",
    `await agent('p', { label: 'build: x', model: 'sonnet', effort: 'high' })`,
    'eval("1")'
  ].join('\n')
  const r = analyze(source)
  assertContract(r)
  assert.deepEqual(r.errors.map((e) => e.line), [1, 2, 3, 4, 5])
  assert.deepEqual(codesOf(r), ['SHAPE', 'SOURCE', 'SHAPE', 'SHAPE', 'SHAPE'])
  assert.deepEqual(r.errors.map((e) => e.stage), [null, null, 0, 1, null])
  const keys = r.errors.map((e) => JSON.stringify([e.code, e.line, e.stage, e.message]))
  assert.equal(new Set(keys).size, keys.length)
})

test('errors tied to a stage carry its index and label, errors elsewhere carry null', () => {
  const r = analyze(
    [
      `await agent('p', { label: 'decide: first', model: 'opus', effort: 'high' })`,
      `await agent('p', { label: 'decide: second', model: 'opus' })`,
      'const bad = this'
    ].join('\n')
  )
  assertContract(r)
  assert.equal(r.errors.length, 2)
  const stageError = r.errors.find((e) => e.stage !== null)
  assert.equal(stageError.stage, 1)
  assert.equal(stageError.label, 'decide: second')
  assert.equal(stageError.line, 2)
  const other = r.errors.find((e) => e.stage === null)
  assert.equal(other.label, null)
  assert.equal(other.line, 3)
})

test('Sonnet and Haiku stages need schema.properties.blocked_on; other models do not', () => {
  assert.deepEqual(analyze(call(SONNET)).errors, [])
  assert.deepEqual(analyze(call(SONNET.replace("'sonnet'", "'haiku'").replace("'high'", "'xhigh'"))).errors, [])
  assert.deepEqual(analyze(call(OPUS)).errors, [])
  for (const model of ['sonnet', 'haiku']) {
    const r = analyze(call(`label: 'build: x', model: '${model}', effort: 'high'`))
    assert.deepEqual(codesOf(r), ['SHAPE'], model)
    assert.equal(r.errors[0].needsBlockedOn, true)
  }
})

test('a non-alias model literal without a valid blocked_on schema flags needsBlockedOn so the first deny carries the snippet', () => {
  for (const model of ['claude-sonnet-5-5', 'sonnet[1m]', 'Sonnet', 'haiku[1m]']) {
    const r = analyze(call(`label: 'build: x', model: '${model}', effort: 'high'`))
    assert.ok(r.errors.some((e) => e.needsBlockedOn === true), model)
    assertContract(r)
  }
  assert.deepEqual(analyze(call(SONNET.replace("'sonnet'", "'claude-sonnet-5-5'"))).errors, [])
})

test('an unknown model (missing, non-literal or duplicated) flags needsBlockedOn on the model error without a schema error', () => {
  const unknown = [
    "label: 'grunt: x', effort: 'low'",
    "label: 'build: x', model: pick(), effort: 'high'",
    "label: 'build: x', model: 'opus', model: 'sonnet', effort: 'high'"
  ]
  for (const opts of unknown) {
    const r = analyze(call(opts))
    assert.equal(r.errors.length, 1, opts)
    assert.equal(r.errors[0].needsBlockedOn, true, opts)
    assert.match(r.errors[0].message, /model/, opts)
  }
})

test('every schema and blocked_on error carries needsBlockedOn, stage and label', () => {
  const sources = [
    call("label: 'build: x', model: 'sonnet', effort: 'high'"),
    call("label: 'build: x', model: 'sonnet', effort: 'high', schema: SCHEMA"),
    call("label: 'build: x', model: 'sonnet', effort: 'high', schema: { type: 'object' }"),
    call("label: 'build: x', model: 'sonnet', effort: 'high', schema: { type: 'object', properties: {} }"),
    call("label: 'build: x', model: 'sonnet', effort: 'high', schema: { type: 'object', properties: SHARED }"),
    call("label: 'build: x', model: 'sonnet', effort: 'high', schema: { type: 'object', properties: { blocked_on: BLOCKED } }"),
    call("label: 'build: x', model: 'sonnet', effort: 'high', schema: { ...base, properties: {} }"),
    call("label: 'build: x', model: 'sonnet', effort: 'high', schema: { [key]: 1 }"),
    call("label: 'build: x', model: 'sonnet', effort: 'high', schema: { get properties() { return {} } }"),
    call("label: 'build: x', model: 'sonnet', effort: 'high', get schema() { return {} }")
  ]
  for (const source of sources) {
    const r = analyze(source)
    const schemaErrors = r.errors.filter((e) => e.needsBlockedOn)
    assert.ok(schemaErrors.length >= 1, source)
    for (const e of schemaErrors) {
      assert.equal(e.code, 'SHAPE')
      assert.equal(e.stage, 0)
      assert.equal(e.label, 'build: x')
    }
    assertContract(r)
  }
})

test('schema chain: duplicates, spread and computed keys on the path are denied', () => {
  const dupProperties = analyze(
    call(`label: 'build: x', model: 'sonnet', effort: 'high', schema: { properties: { ${BLOCKED_ON} }, properties: {} }`)
  )
  assert.deepEqual(codesOf(dupProperties), ['SHAPE'])
  assert.match(dupProperties.errors[0].message, /more than once/)

  const dupKey = analyze(
    call(`label: 'build: x', model: 'sonnet', effort: 'high', schema: { properties: { ${BLOCKED_ON}, files: {}, files: {} } }`)
  )
  assert.deepEqual(codesOf(dupKey), ['SHAPE'])
  assert.match(dupKey.errors[0].message, /"files" more than once/)

  const dupBlocked = analyze(
    call(`label: 'build: x', model: 'sonnet', effort: 'high', schema: { properties: { ${BLOCKED_ON}, ${BLOCKED_ON} } }`)
  )
  assert.deepEqual(codesOf(dupBlocked), ['SHAPE'])

  const computedProps = analyze(
    call(`label: 'build: x', model: 'sonnet', effort: 'high', schema: { properties: { ${BLOCKED_ON}, [name]: {} } }`)
  )
  assert.match(computedProps.errors[0].message, /spread or computed/)

  const computedBlocked = analyze(
    call(`label: 'build: x', model: 'sonnet', effort: 'high', schema: { properties: { ['blocked_on']: { type: ['string', 'null'], description: 'd' } } }`)
  )
  assert.match(computedBlocked.errors[0].message, /spread or computed/)

  const methodBlocked = analyze(
    call(`label: 'build: x', model: 'sonnet', effort: 'high', schema: { properties: { blocked_on() {} } }`)
  )
  assert.match(methodBlocked.errors[0].message, /blocked_on must be a plain/)
})

test('blocked_on: type must be exactly the array literal [string, null] in that order', () => {
  const ok = (inner) => analyze(sonnetWithBlockedOn(inner)).errors
  assert.deepEqual(ok("{ type: ['string', 'null'], description: 'd' }"), [])
  assert.deepEqual(ok('{ type: ["string", "null"], description: "d" }'), [])
  assert.deepEqual(ok("{ 'type': ['string', 'null'], 'description': 'd', title: 'extra' }"), [])
  for (const type of ["'string'", "['null', 'string']", "['string']", "['string', 'null', 'number']", "['string', `null`]", "['string', null]", '[...parts]', '[kind, "null"]', 'TYPE', '["string", "null"].reverse()']) {
    const errors = ok(`{ type: ${type}, description: 'd' }`)
    assert.ok(errors.length >= 1, type)
    assert.ok(errors.every((e) => e.code === 'SHAPE' && e.needsBlockedOn === true), type)
  }
  const missingType = ok("{ description: 'd' }")
  assert.match(missingType[0].message, /blocked_on\.type must be/)
})

test('blocked_on: description must be a non-empty quoted string literal', () => {
  const errorsFor = (description) => analyze(sonnetWithBlockedOn(`{ type: ['string', 'null'], description: ${description} }`)).errors
  for (const bad of ["''", "'   '", '`d`', "'a' + b", 'DESC', '1', 'null']) {
    const errors = errorsFor(bad)
    assert.ok(errors.length >= 1, bad)
    assert.ok(errors.every((e) => e.needsBlockedOn === true), bad)
  }
  const missing = analyze(sonnetWithBlockedOn("{ type: ['string', 'null'] }")).errors
  assert.match(missing[0].message, /blocked_on\.description must be a non-empty/)
})

test('blocked_on: an identifier or non-literal expression anywhere inside is SHAPE', () => {
  for (const inner of [
    "BLOCKED",
    "{ type: ['string', 'null'], description: 'd', extra: [x] }",
    "{ type: ['string', 'null'], description: 'd', extra: { deep: f() } }",
    "{ type: ['string', 'null'], description: 'd', ...more }",
    "{ type: ['string', 'null'], description: 'd', [k]: 1 }",
    "{ type: ['string', 'null'], description: 'd', extra }",
    "{ type: ['string', 'null'], description: 'd', get extra() { return 1 } }",
    "{ type: ['string', 'null'], description: 'd', type: ['string', 'null'] }"
  ]) {
    const r = analyze(sonnetWithBlockedOn(inner))
    assert.ok(r.errors.length >= 1, inner)
    assert.ok(r.errors.every((e) => e.code === 'SHAPE' && e.needsBlockedOn === true && e.stage === 0), inner)
  }
})

test('error messages stay short enough for the gate to print one per line', () => {
  for (const file of listFixtures('bad')) {
    for (const e of analyze(readFixture('bad', file)).errors) {
      assert.ok(e.message.length <= 240, `${file}: ${e.message.length}`)
      assert.ok(!e.message.includes('\n'), file)
    }
  }
})

test('deeply nested sources are handled without recursion limits in the visitor', () => {
  const depth = 400
  const source = `const x = ${'['.repeat(depth)}1${']'.repeat(depth)}`
  const r = analyze(source)
  assert.deepEqual(r.errors, [])
})

test('a shared schema const with a missing or non-literal model is reported in the first deny', () => {
  for (const model of ['', "model: 'sonnet', ", 'model: M, ']) {
    const src = `const S = { type: 'object' }\nawait agent('p', { label: 'build: x', ${model}effort: 'medium', schema: S })`
    const r = analyze(src)
    const inline = r.errors.filter((e) => /inline object literal/.test(e.message))
    assert.equal(inline.length, 1, model)
    assert.equal(inline[0].needsBlockedOn, true, model)
  }
  const opus = analyze(`const S = { type: 'object' }\nawait agent('p', { ${OPUS}, schema: S })`)
  assert.deepEqual(opus.errors, [])
})

test('agent(prompt) and agent(prompt, OPTS) flag needsBlockedOn because the model cannot be read', () => {
  for (const src of ["await agent('p')", "const O = {}\nawait agent('p', O)", "await agent('p', ...a)"]) {
    const r = analyze(src)
    assert.ok(r.errors.length >= 1, src)
    assert.ok(r.errors.some((e) => e.needsBlockedOn === true), src)
  }
  const extra = analyze(`await agent('p', { ${SONNET} }, 1)`)
  assert.ok(extra.errors.length === 1 && extra.errors[0].needsBlockedOn === undefined)
})

test('hasBlockedOn is true exactly when the stage has a valid inline blocked_on, whatever its model', () => {
  const opusSchema = (props) => call(`${OPUS}, schema: { type: 'object', properties: { ${props} } }`)
  const has = (src) => analyze(src).stages[0].hasBlockedOn
  assert.equal(has(opusSchema(BLOCKED_ON)), true)
  assert.equal(has(call(OPUS)), false)
  assert.equal(has(opusSchema('files: { type: "array" }')), false)
  assert.equal(has(opusSchema("blocked_on: { type: 'string', description: 'x' }")), false)
  assert.equal(has(`const S = { type: 'object', properties: { ${BLOCKED_ON} } }\n${call(`${OPUS}, schema: S`)}`), false)
  assert.equal(has(call(`${OPUS}, schema: { type: 'object', properties: { ${BLOCKED_ON} } }, schema: {}`)), false)
  assert.equal(has(call(SONNET)), true)
  assert.equal(has(call("label: 'build: x', model: 'sonnet', effort: 'high'")), false)
  assert.equal(has("await agent('p', opts)"), false)
  assert.deepEqual(analyze(opusSchema(BLOCKED_ON)).errors, [])
})

test('a non-literal label message says the class prefix must be inline literal text, not a variable or helper parameter', () => {
  const src = "const review = (name, file) => agent(file, { label: name, model: 'opus', effort: 'high' })"
  const errs = analyze(src).errors.filter((e) => e.code === 'SHAPE')
  assert.equal(errs.length, 1)
  assert.match(errs[0].message, /literal text at the very start/)
  assert.match(errs[0].message, /variable or helper parameter/)
  assert.match(errs[0].message, /\$\{name\}/)
})

test('a stage with no usable class carries needsBlockedOn unless it already has blocked_on or is on sonnet or haiku', () => {
  const labelErrors = (src) => analyze(src).errors.filter((e) => /label/.test(e.message))
  const WITH_BO = `schema: { type: 'object', properties: { ${BLOCKED_ON} } }`
  for (const label of ['', "label: 'Summarize README', ", 'label: name, ', "label: 'a' + 'b: c', "]) {
    const src = `const name = 'x'; ${call(`${label}model: 'opus', effort: 'high'`)}`
    const errs = labelErrors(src)
    assert.equal(errs.length, 1, label)
    assert.equal(errs[0].needsBlockedOn, true, label)
    const noLabelOpus = labelErrors(`const name = 'x'; ${call(`${label}model: 'opus', effort: 'high', ${WITH_BO}`)}`)
    assert.equal(noLabelOpus[0].needsBlockedOn, undefined, label)
    const sonnet = labelErrors(`const name = 'x'; ${call(`${label}model: 'sonnet', effort: 'high', ${WITH_BO}`)}`)
    assert.equal(sonnet[0].needsBlockedOn, undefined, label)
  }
  const unknownModel = labelErrors(call("model: tier, effort: 'high'"))
  assert.equal(unknownModel[0].needsBlockedOn, true)
})

test('an unknown model reports the specific blocked_on problem as conditional on running sonnet or haiku', () => {
  const props = (inner, model = '') => `label: 'grunt: x', ${model}effort: 'medium', schema: { type: 'object', properties: ${inner} }`
  const SHARED = 'const FP = { findings: { type: "array" } }; '
  const cases = [
    [`${SHARED}${call(props('FP'))}`, /schema\.properties must be an inline object literal/],
    [`const BO = { type: ['string', 'null'], description: 'd' }; ${call(props('{ blocked_on: BO }', 'model: tier, '))}`, /blocked_on must be an inline object literal/],
    [call(props('{ files: { type: "array" } }')), /blocked_on is missing/]
  ]
  for (const [src, pattern] of cases) {
    const errs = analyze(src).errors.filter((e) => pattern.test(e.message))
    assert.equal(errs.length, 1, src)
    assert.match(errs[0].message, /^If this stage runs on sonnet or haiku/)
    assert.equal(errs[0].needsBlockedOn, true)
  }
  const valid = analyze(call(props(`{ ${BLOCKED_ON} }`)))
  assert.ok(valid.errors.every((e) => !/sonnet or haiku/.test(e.message)))
  const opus = analyze(`${SHARED}${call(props('FP', "model: 'opus', "))}`)
  assert.deepEqual(opus.errors, [])
})

const PASS = "pass: { type: 'boolean' }"
const EVIDENCE = "evidence: { type: 'string', description: 'x' }"
const judge = (props) => call(`label: 'judge: check', model: 'sonnet', effort: 'high', schema: { type: 'object', properties: { ${props} } }`)
const verdictOf = (src) => analyze(src).stages[0].verdict

test('verdict is true for exactly pass boolean, evidence string and a valid blocked_on, in any order', () => {
  const parts = [PASS, EVIDENCE, BLOCKED_ON]
  for (const order of [[0, 1, 2], [2, 1, 0], [1, 2, 0], [2, 0, 1]]) {
    const r = analyze(judge(order.map((i) => parts[i]).join(', ')))
    assert.deepEqual(r.errors, [])
    assert.equal(r.stages[0].verdict, true, order.join())
    assert.equal(r.stages[0].hasBlockedOn, true)
  }
  assert.equal(verdictOf(judge(`'pass': { 'type': 'boolean' }, ${EVIDENCE}, ${BLOCKED_ON}`)), true)
  assert.equal(verdictOf(judge(`pass: { type: 'boolean', description: 'did it pass' }, ${EVIDENCE}, ${BLOCKED_ON}`)), true)
})

test('verdict does not depend on the model or the class', () => {
  const props = `${PASS}, ${EVIDENCE}, ${BLOCKED_ON}`
  assert.equal(verdictOf(call(`label: 'decide: x', model: 'opus', effort: 'high', schema: { type: 'object', properties: { ${props} } }`)), true)
  assert.equal(verdictOf(call(`label: 'decide: x', model: tier, effort: 'high', schema: { type: 'object', properties: { ${props} } }`)), true)
})

test('verdict is false for an extra key, a wrong type, a missing key, a bad blocked_on or a non-literal value', () => {
  const cases = {
    'extra key': `${PASS}, ${EVIDENCE}, score: { type: 'number' }, ${BLOCKED_ON}`,
    'pass typed string': `pass: { type: 'string' }, ${EVIDENCE}, ${BLOCKED_ON}`,
    'evidence typed boolean': `${PASS}, evidence: { type: 'boolean' }, ${BLOCKED_ON}`,
    'evidence missing': `${PASS}, ${BLOCKED_ON}`,
    'pass missing': `${EVIDENCE}, ${BLOCKED_ON}`,
    'blocked_on missing': `${PASS}, ${EVIDENCE}`,
    'blocked_on wrong type': `${PASS}, ${EVIDENCE}, blocked_on: { type: 'string', description: 'x' }`,
    'pass not an object literal': `pass: BOOL, ${EVIDENCE}, ${BLOCKED_ON}`,
    'pass without type': `pass: { description: 'x' }, ${EVIDENCE}, ${BLOCKED_ON}`,
    'pass type is an identifier': `pass: { type: T }, ${EVIDENCE}, ${BLOCKED_ON}`,
    'pass type is a template': `pass: { type: \`boolean\` }, ${EVIDENCE}, ${BLOCKED_ON}`,
    'pass type is an array': `pass: { type: ['boolean'] }, ${EVIDENCE}, ${BLOCKED_ON}`,
    'pass has a non-literal description': `pass: { type: 'boolean', description: D }, ${EVIDENCE}, ${BLOCKED_ON}`,
    'evidence has a spread': `evidence: { type: 'string', ...X }, ${PASS}, ${BLOCKED_ON}`,
    'pass type defined twice': `pass: { type: 'boolean', type: 'boolean' }, ${EVIDENCE}, ${BLOCKED_ON}`,
    'pass defined twice': `${PASS}, ${PASS}, ${EVIDENCE}, ${BLOCKED_ON}`,
    'computed key': `${PASS}, ${EVIDENCE}, [k]: { type: 'string' }, ${BLOCKED_ON}`,
    'spread': `...X, ${PASS}, ${EVIDENCE}, ${BLOCKED_ON}`
  }
  for (const [name, props] of Object.entries(cases)) assert.equal(verdictOf(judge(props)), false, name)
})

test('verdict is false without an inline schema, with a shared schema const, or with a duplicate schema', () => {
  const props = `${PASS}, ${EVIDENCE}, ${BLOCKED_ON}`
  assert.equal(verdictOf(call("label: 'judge: x', model: 'sonnet', effort: 'high'")), false)
  assert.equal(verdictOf(`const S = { type: 'object', properties: { ${props} } }\n${call("label: 'judge: x', model: 'sonnet', effort: 'high', schema: S")}`), false)
  assert.equal(verdictOf(call(`label: 'judge: x', model: 'sonnet', effort: 'high', schema: { type: 'object', properties: { ${props} } }, schema: {}`)), false)
  assert.equal(verdictOf("await agent('p', opts)"), false)
})

test('calls are the agent() call nodes in stage order', () => {
  const r = analyze(`${call(OPUS)}\n${call("label: 'build: x', model: 'sonnet', effort: 'high'")}`)
  assert.equal(r.calls.length, 2)
  assert.deepEqual(r.calls.map((c) => c.loc.start.line), r.stages.map((s) => s.line))
  assert.equal(analyze('const =').calls.length, 0)
})
