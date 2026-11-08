import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { sha256Hex } from '../src/fingerprint.mjs'

const node = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

test('sha256Hex matches node:crypto', () => {
  const samples = [
    '',
    'abc',
    'a'.repeat(55),
    'a'.repeat(56),
    'a'.repeat(64),
    'a'.repeat(1000),
    "await agent('x', { label: 'grunt: x', model: 'haiku', effort: 'xhigh' })\n",
    'ñandú — émoji 🚀 and 中文',
    '\u{10FFFF}\u0000\r\n\t'
  ]
  for (const s of samples) assert.equal(sha256Hex(s), node(s), JSON.stringify(s.slice(0, 20)))
})

test('sha256Hex replaces lone surrogates like node does', () => {
  for (const s of ['\ud800', 'x\udc00y', '\ud83d']) assert.equal(sha256Hex(s), node(s))
})

test('sha256Hex rejects non-strings', () => {
  assert.throws(() => sha256Hex(null), TypeError)
})
