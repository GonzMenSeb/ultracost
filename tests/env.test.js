import test from 'node:test'
import assert from 'node:assert/strict'
import { env } from '../src/env.mjs'

const WF = 'CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL'
const FORCE = 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE'
const EFFORT = 'CLAUDE_CODE_EFFORT_LEVEL'

const shape = (e) => {
  assert.equal(e.code, 'ENV')
  assert.equal(e.line, null)
  assert.equal(e.label, null)
  assert.equal(e.stage, null)
}

test('empty environment is clean', () => {
  assert.deepEqual(env({}), [])
})

test('CLAUDE_CODE_SUBAGENT_MODEL alone is allowed', () => {
  assert.deepEqual(env({ CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' }), [])
})

test('workflow subagent model denied when non-empty', () => {
  const errs = env({ [WF]: 'haiku' })
  assert.equal(errs.length, 1)
  shape(errs[0])
  assert.match(errs[0].message, new RegExp(WF))
  assert.match(errs[0].message, /remove it and restart/)
})

test('workflow subagent model empty or blank is allowed', () => {
  assert.deepEqual(env({ [WF]: '' }), [])
  assert.deepEqual(env({ [WF]: '   ' }), [])
})

for (const v of ['1', 'true', 'TRUE', ' yes ', 'on', 'On']) {
  test(`force truthy: ${JSON.stringify(v)}`, () => {
    const errs = env({ [FORCE]: v })
    assert.equal(errs.length, 1)
    shape(errs[0])
    assert.match(errs[0].message, new RegExp(FORCE))
    assert.match(errs[0].message, /remove it and restart/)
  })
}

for (const v of ['0', 'false', '', 'no', 'off', 'maybe']) {
  test(`force falsy: ${JSON.stringify(v)}`, () => {
    assert.deepEqual(env({ [FORCE]: v }), [])
  })
}

for (const v of ['auto', 'AUTO', ' unset ', 'unset', 'high']) {
  test(`effort level non-empty is denied: ${JSON.stringify(v)}`, () => {
    const errs = env({ [EFFORT]: v })
    assert.equal(errs.length, 1)
    shape(errs[0])
    assert.match(errs[0].message, new RegExp(EFFORT))
    assert.match(errs[0].message, /every agent\(\) effort/)
    assert.match(errs[0].message, /remove it and restart/)
  })
}

for (const v of ['', '  ']) {
  test(`effort level empty or blank is allowed: ${JSON.stringify(v)}`, () => {
    assert.deepEqual(env({ [EFFORT]: v }), [])
  })
}

for (const v of ['inherit', 'INHERIT', ' Inherit ']) {
  test(`workflow subagent model inherit is no override: ${JSON.stringify(v)}`, () => {
    assert.deepEqual(env({ [WF]: v }), [])
  })
}

for (const v of ['high', 'low', 'max', 'xhigh', 'medium']) {
  test(`effort level denied: ${v}`, () => {
    const errs = env({ [EFFORT]: v })
    assert.equal(errs.length, 1)
    shape(errs[0])
    assert.match(errs[0].message, new RegExp(EFFORT))
    assert.match(errs[0].message, /remove it and restart/)
  })
}

test('all three variables report separately', () => {
  const errs = env({ [WF]: 'opus', [FORCE]: '1', [EFFORT]: 'high' })
  assert.equal(errs.length, 3)
})

test('messages tell the user to remove the variable, not Claude to unset it', () => {
  const errs = env({ [WF]: 'opus', [FORCE]: '1', [EFFORT]: 'high' })
  for (const e of errs) {
    assert.match(e.message, /settings env block/)
    assert.match(e.message, /Ask the user to remove it and restart Claude Code/)
    assert.doesNotMatch(e.message, /Unset it\./)
  }
  assert.match(errs[2].message, /even the values auto and unset/)
})
