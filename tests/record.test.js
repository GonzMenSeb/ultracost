import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recordPath, ID_RE } from '../src/record.mjs'

test('recordPath builds the per-launch path', () => {
  assert.equal(recordPath('/h/.claude', 'abc-123', 'toolu_01X', 'gate'), '/h/.claude/tierguard/sessions/abc-123/toolu_01X.gate.json')
  assert.equal(recordPath('/h/.claude/', 'abc', 'wf_1-2', 'eval'), '/h/.claude/tierguard/sessions/abc/wf_1-2.eval.json')
})

test('recordPath falls back to unknown for a bad session id', () => {
  for (const s of [undefined, '', '../x', 'a/b', 'a'.repeat(129)]) {
    assert.equal(recordPath('/c', s, 'toolu_1', 'gate'), '/c/tierguard/sessions/unknown/toolu_1.gate.json')
  }
})

test('recordPath refuses a bad id, kind or config dir', () => {
  assert.equal(recordPath('/c', 's', '../evil', 'gate'), null)
  assert.equal(recordPath('/c', 's', '', 'gate'), null)
  assert.equal(recordPath('/c', 's', 'toolu_1', 'other'), null)
  assert.equal(recordPath('', 's', 'toolu_1', 'gate'), null)
  assert.ok(ID_RE.test('toolu_01V9qjc4DitaxzSSKqNe4avW'))
})
