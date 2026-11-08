import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadPolicy, limitsOf, POLICY_PATH } from '../src/rules.mjs'

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
    for (const key of ['pairs', 'fanoutPairs', 'verdictPairs']) {
      for (const [model, efforts] of Object.entries(def[key] || {})) {
        assert.ok(MODELS.has(model), `${cls} ${key}: ${model}`)
        for (const e of efforts) assert.ok(EFFORTS.has(e), `${cls} ${key}: ${model} ${e}`)
      }
    }
  }
})

const ALL = ['medium', 'high', 'xhigh']

test('investigate is a sonnet-only class', () => {
  const { investigate } = loadPolicy().classes
  assert.deepEqual(investigate.pairs, { sonnet: ALL })
  assert.match(investigate.owns, /web research/)
  assert.match(investigate.owns, /code mapping/)
  assert.equal('fanoutPairs' in investigate, false)
  assert.equal('verdictPairs' in investigate, false)
})

test('judge may use sonnet only through verdictPairs, and its owns text no longer claims verdict readings', () => {
  const { judge } = loadPolicy().classes
  assert.deepEqual(judge.pairs, { opus: ALL })
  assert.deepEqual(judge.verdictPairs, { sonnet: ALL })
  assert.equal('fanoutPairs' in judge, false)
  assert.ok(!judge.owns.includes('feeds a verdict'))
})

test('decide, synth and design may use sonnet only through fanoutPairs', () => {
  const { classes } = loadPolicy()
  for (const cls of ['decide', 'synth', 'design']) {
    assert.deepEqual(classes[cls].pairs, { opus: ALL }, cls)
    assert.deepEqual(classes[cls].fanoutPairs, { sonnet: ALL }, cls)
    assert.equal('verdictPairs' in classes[cls], false, cls)
  }
})

test('build, fix, combine, code and grunt have no conditional pairs', () => {
  const { classes } = loadPolicy()
  for (const cls of ['build', 'fix', 'combine', 'code', 'grunt']) {
    assert.equal('fanoutPairs' in classes[cls], false, cls)
    assert.equal('verdictPairs' in classes[cls], false, cls)
  }
})

test('shipped limits cap opus at 3 at once and call a fan-out big above 3', () => {
  assert.deepEqual(loadPolicy().limits, { maxConcurrentOpus: 3, bigFanout: 3 })
})

test('shipped policy text has no low, max, fable, mythos or full ids', () => {
  const text = fs.readFileSync(POLICY_PATH, 'utf8').toLowerCase()
  for (const bad of ['"low"', '"max"', 'fable', 'mythos', 'claude-']) assert.ok(!text.includes(bad), bad)
})

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultraguard-policy-'))
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
  'duplicate efforts': { classes: { build: { owns: 'x', pairs: { sonnet: ['high', 'high'] } } } },
  'fanoutPairs model outside set': { classes: { decide: { owns: 'x', pairs: { opus: ['high'] }, fanoutPairs: { fable: ['high'] } } } },
  'fanoutPairs empty': { classes: { decide: { owns: 'x', pairs: { opus: ['high'] }, fanoutPairs: {} } } },
  'fanoutPairs not an object': { classes: { decide: { owns: 'x', pairs: { opus: ['high'] }, fanoutPairs: ['sonnet'] } } },
  'verdictPairs effort low': { classes: { judge: { owns: 'x', pairs: { opus: ['high'] }, verdictPairs: { sonnet: ['low'] } } } },
  'verdictPairs duplicate efforts': { classes: { judge: { owns: 'x', pairs: { opus: ['high'] }, verdictPairs: { sonnet: ['high', 'high'] } } } },
  'verdictPairs empty efforts': { classes: { judge: { owns: 'x', pairs: { opus: ['high'] }, verdictPairs: { sonnet: [] } } } },
  'limits not an object': { classes: ok.classes, limits: 3 },
  'limits non-integer value': { classes: ok.classes, limits: { maxConcurrentOpus: 2.5, bigFanout: 3 } },
  'limits string value': { classes: ok.classes, limits: { maxConcurrentOpus: '3', bigFanout: 3 } },
  'limits zero': { classes: ok.classes, limits: { maxConcurrentOpus: 0, bigFanout: 3 } },
  'limits negative': { classes: ok.classes, limits: { maxConcurrentOpus: 3, bigFanout: -1 } },
  'limits unknown key': { classes: ok.classes, limits: { maxConcurrentOpus: 3, bigFanout: 3, maxOpus: 3 } }
}

for (const [name, content] of Object.entries(bad)) {
  test(`loadPolicy throws: ${name}`, () => {
    assert.throws(() => loadPolicy(write(`${name.replace(/\W+/g, '-')}.json`, content)), Error)
  })
}

test('loadPolicy accepts conditional pairs and limits', () => {
  const full = {
    limits: { maxConcurrentOpus: 2, bigFanout: 5 },
    classes: {
      decide: { owns: 'x', pairs: { opus: ['high'] }, fanoutPairs: { sonnet: ['medium', 'high'] } },
      judge: { owns: 'x', pairs: { opus: ['high'] }, verdictPairs: { sonnet: ['high'] } }
    }
  }
  assert.deepEqual(loadPolicy(write('full.json', full)), full)
  assert.deepEqual(limitsOf(full), { maxConcurrentOpus: 2, bigFanout: 5 })
})

test('limitsOf fills missing limits with the defaults', () => {
  assert.deepEqual(limitsOf(ok), { maxConcurrentOpus: 3, bigFanout: 3 })
  assert.deepEqual(limitsOf({ ...ok, limits: { bigFanout: 4 } }), { maxConcurrentOpus: 3, bigFanout: 4 })
})

test('loadPolicy throws on an unreadable path', () => {
  assert.throws(() => loadPolicy(path.join(dir, 'missing.json')), Error)
})

test('shipped labelCheck covers the agreed words and classes', () => {
  const { labelCheck } = loadPolicy()
  assert.deepEqual(labelCheck.words, ['research', 'investigate', 'map', 'explore', 'survey', 'scan', 'search', 'find', 'audit', 'inventory', 'readiness'])
  assert.deepEqual(labelCheck.classes, ['decide', 'judge', 'design'])
  assert.deepEqual(labelCheck.fanoutClasses, ['synth'])
  assert.equal(labelCheck.use, 'investigate')
})

test('loadPolicy rejects a bad labelCheck', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-lc-'))
  const base = { classes: { investigate: { owns: 'x', pairs: { sonnet: ['high'] } }, decide: { owns: 'y', pairs: { opus: ['high'] } } } }
  const bad = [
    { words: [], classes: ['decide'], use: 'investigate' },
    { words: ['Research'], classes: ['decide'], use: 'investigate' },
    { words: ['research'], classes: ['nope'], use: 'investigate' },
    { words: ['research'], classes: ['decide'], use: 'nope' },
    { words: ['research'], classes: ['decide'], use: 'investigate', extra: 1 }
  ]
  try {
    for (const [i, labelCheck] of bad.entries()) {
      const f = path.join(dir, `p${i}.json`)
      fs.writeFileSync(f, JSON.stringify({ ...base, labelCheck }))
      assert.throws(() => loadPolicy(f), /labelCheck/, JSON.stringify(labelCheck))
    }
    const ok = path.join(dir, 'ok.json')
    fs.writeFileSync(ok, JSON.stringify({ ...base, labelCheck: { words: ['research'], classes: ['decide'], use: 'investigate' } }))
    assert.doesNotThrow(() => loadPolicy(ok))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
