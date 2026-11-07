import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadPolicy, POLICY_PATH } from '../src/rules.mjs'

const MODELS = new Set(['opus', 'sonnet', 'haiku'])
const EFFORTS = new Set(['medium', 'high', 'xhigh'])

test('POLICY_PATH is absolute and points at policy/default.json', () => {
  assert.ok(path.isAbsolute(POLICY_PATH))
  assert.ok(POLICY_PATH.endsWith(path.join('policy', 'default.json')))
})

test('shipped policy loads', () => {
  const policy = loadPolicy()
  assert.ok(Object.keys(policy.classes).length > 0)
})

test('every shipped pair uses an alias model and an allowed effort', () => {
  const policy = loadPolicy()
  for (const [cls, def] of Object.entries(policy.classes)) {
    assert.equal(typeof def.owns, 'string', cls)
    for (const [model, efforts] of Object.entries(def.pairs)) {
      assert.ok(MODELS.has(model), `${cls}: ${model}`)
      for (const e of efforts) assert.ok(EFFORTS.has(e), `${cls}: ${model} ${e}`)
    }
  }
})

test('shipped policy text has no low, max, fable, mythos or full ids', () => {
  const text = fs.readFileSync(POLICY_PATH, 'utf8').toLowerCase()
  for (const bad of ['"low"', '"max"', 'fable', 'mythos', 'claude-']) assert.ok(!text.includes(bad), bad)
})

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tierguard-policy-'))
test.after(() => fs.rmSync(dir, { recursive: true, force: true }))

function write(name, content) {
  const p = path.join(dir, name)
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
  return p
}

const ok = { classes: { build: { owns: 'x', pairs: { sonnet: ['medium', 'high'] } } } }

test('loadPolicy accepts a minimal valid policy', () => {
  assert.deepEqual(loadPolicy(write('ok.json', ok)), ok)
})

const bad = {
  'not json': '{nope',
  'array': [],
  'no classes key': {},
  'empty classes': { classes: {} },
  'class without pairs': { classes: { build: { owns: 'x' } } },
  'class with empty pairs': { classes: { build: { owns: 'x', pairs: {} } } },
  'model outside set': { classes: { build: { owns: 'x', pairs: { fable: ['high'] } } } },
  'full model id': { classes: { build: { owns: 'x', pairs: { 'claude-opus-5-5': ['high'] } } } },
  'effort low': { classes: { build: { owns: 'x', pairs: { sonnet: ['low'] } } } },
  'effort max': { classes: { build: { owns: 'x', pairs: { sonnet: ['max'] } } } },
  'empty effort list': { classes: { build: { owns: 'x', pairs: { sonnet: [] } } } },
  'efforts not a list': { classes: { build: { owns: 'x', pairs: { sonnet: 'high' } } } },
  'duplicate efforts': { classes: { build: { owns: 'x', pairs: { sonnet: ['high', 'high'] } } } }
}

for (const [name, content] of Object.entries(bad)) {
  test(`loadPolicy throws: ${name}`, () => {
    assert.throws(() => loadPolicy(write(`${name.replace(/\W+/g, '-')}.json`, content)), Error)
  })
}

test('loadPolicy throws on an unreadable path', () => {
  assert.throws(() => loadPolicy(path.join(dir, 'missing.json')), Error)
})
