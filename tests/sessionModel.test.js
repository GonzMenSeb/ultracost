import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sessionModel } from '../src/sessionModel.mjs'

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transcripts')
const fx = (n) => path.join(FIX, `${n}.jsonl`)

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tierguard-session-'))
test.after(() => fs.rmSync(dir, { recursive: true, force: true }))

const entry = (model, extra = {}) => JSON.stringify({
  type: 'assistant',
  isSidechain: false,
  timestamp: '2026-01-01T00:00:00.000Z',
  message: { role: 'assistant', model },
  ...extra
})
const user = JSON.stringify({ type: 'user', isSidechain: false, timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user' } })

let n = 0
function tmp(content) {
  const p = path.join(dir, `t${n++}.jsonl`)
  fs.writeFileSync(p, content)
  return p
}

test('real main-thread opus', () => {
  assert.equal(sessionModel(fx('opus')), 'opus')
})

test('real main-thread sonnet', () => {
  assert.equal(sessionModel(fx('sonnet')), 'sonnet')
})

test('real main-thread fable maps to opus', () => {
  assert.equal(sessionModel(fx('fable')), 'opus')
})

test('real synthetic entry as the last main-thread entry gives null', () => {
  assert.equal(sessionModel(fx('synthetic')), null)
})

test('haiku (real id shape, main-thread flag edited)', () => {
  assert.equal(sessionModel(fx('haiku-derived')), 'haiku')
})

test('last main-thread entry wins over earlier ones', () => {
  assert.equal(sessionModel(fx('last-wins')), 'opus')
})

test('trailing sidechain entries are ignored', () => {
  assert.equal(sessionModel(fx('trailing-sidechain')), 'opus')
})

test('fixtures carry no content beyond the redacted fields', () => {
  const top = ['type', 'isSidechain', 'agentId', 'timestamp', 'querySource', 'params', 'message']
  for (const f of fs.readdirSync(FIX)) {
    for (const line of fs.readFileSync(path.join(FIX, f), 'utf8').split('\n').filter(Boolean)) {
      let o
      try {
        o = JSON.parse(line)
      } catch {
        continue
      }
      assert.deepEqual(Object.keys(o).filter((k) => !top.includes(k)), [], f)
      if (o.message) assert.deepEqual(Object.keys(o.message).filter((k) => !['role', 'model', 'content'].includes(k)), [], f)
      if (o.params) assert.deepEqual(Object.keys(o.params).filter((k) => !['model', 'output_config'].includes(k)), [], f)
      if (o.type === 'user' && o.message.content !== undefined) assert.equal(typeof o.message.content, 'string', f)
    }
  }
})

for (const [name, want, why] of [
  ['request-sonnet-after-opus', 'sonnet', 'a main api-request after an opus assistant row names the model in flight'],
  ['request-opus-after-sonnet', 'opus', 'a main api-request after a sonnet assistant row names the model in flight'],
  ['request-subagent-ignored', 'opus', 'a trailing api-request with agentId is ignored'],
  ['request-non-main-ignored', 'opus', 'a trailing api-request with a non-main querySource is ignored'],
  ['request-then-completed-assistant', 'sonnet', 'a request followed by its completed assistant row gives that model'],
  ['request-sdk', 'sonnet', 'querySource sdk counts as main thread'],
  ['request-without-assistant', 'sonnet', 'a request with no assistant row at all is used'],
  ['request-unmappable-model', null, 'an unmappable request model gives null instead of the older assistant model'],
  ['synthetic-last', null, 'a synthetic last assistant row gives null'],
  ['torn-last-line', 'sonnet', 'a torn last line is skipped'],
  ['model-command-opus-to-sonnet', 'sonnet', '/model sonnet after an opus assistant row without a request gives sonnet'],
  ['model-command-sonnet-to-opus', 'sonnet', '/model opus after a sonnet assistant row without a request never raises the tier'],
  ['model-command-opusplan', 'sonnet', '/model opusplan runs sonnet outside plan mode'],
  ['model-command-opusplan1m', 'sonnet', '/model opusplan[1m] runs sonnet outside plan mode'],
  ['model-command-default', null, '/model default cannot be mapped'],
  ['model-command-last-wins', 'sonnet', 'the last /model command is the effective one'],
  ['model-command-after-request', 'opus', 'a request after the /model command takes precedence'],
  ['model-command-sidechain-ignored', 'opus', 'a sidechain /model row is ignored'],
  ['model-command-haiku-after-synthetic', 'haiku', '/model haiku after a synthetic assistant row gives haiku'],
  ['model-command-haiku-no-assistant', 'haiku', '/model haiku with no assistant row gives haiku'],
  ['model-command-synthetic-to-opus', null, '/model opus after a synthetic assistant row never raises the tier'],
  ['model-command-no-assistant-to-opus', null, '/model opus with no assistant row never raises the tier'],
  ['model-command-failed-after-synthetic', null, 'a /model that failed with a 429 is ignored after a synthetic row'],
  ['model-command-failed-after-opus', 'opus', 'a /model that failed with a 429 is ignored after an opus row'],
  ['model-command-kept-after-opus', 'opus', 'a declined /model (Kept model as) is ignored'],
  ['model-command-no-stdout', 'opus', 'a /model without a confirming stdout row is ignored'],
  ['model-command-failed-then-earlier-ok', 'sonnet', 'a failed /model does not hide an earlier successful one'],
  ['model-command-stdout-of-other-command', 'opus', 'the stdout of another command does not confirm a /model']
]) {
  test(why, () => {
    assert.equal(sessionModel(fx(name)), want)
  })
}

test('non-string and empty transcript paths give null', () => {
  for (const p of ['', undefined, null, 42, {}]) assert.equal(sessionModel(p), null)
})

test('request-only rows from the same session as an assistant row of another model', () => {
  const req = JSON.stringify({ type: 'api-request', timestamp: 't', querySource: 'repl_main_thread', params: { model: 'claude-haiku-5-5' } })
  assert.equal(sessionModel(tmp(`${entry('claude-opus-5-5')}\n${req}\n`)), 'haiku')
})

test('api-request far from the end of a large file', () => {
  const req = JSON.stringify({ type: 'api-request', timestamp: 't', querySource: 'repl_main_thread:outputStyle:Concise', params: { model: 'claude-sonnet-5-5' } })
  const filler = JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: 'x'.repeat(2000) } })
  const lines = [entry('claude-opus-5-5'), req]
  for (let i = 0; i < 400; i++) lines.push(filler)
  const p = tmp(lines.join('\n') + '\n')
  assert.ok(fs.statSync(p).size > 4 * 64 * 1024)
  assert.equal(sessionModel(p), 'sonnet')
})

test('a main tool_result row quoting the /model command is not a command', () => {
  const quoted = JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'tool_result', content: '<command-name>/model</command-name><command-args>haiku</command-args>' }] } })
  assert.equal(sessionModel(tmp(`${entry('claude-opus-5-5')}\n${quoted}\n`)), 'opus')
})

for (const [id, want] of [
  ['claude-mythos-1', null],
  ['<synthetic>', null],
  ['totally-unknown', null],
  ['', null],
  ['claude-opus-sonnet-mix', null],
  ['claude-haiku-sonnet', null],
  ['CLAUDE-OPUS-5-5', 'opus'],
  ['claude-sonnet-5-5[1m]', 'sonnet'],
  ['us.anthropic.claude-haiku-4-5-v1:0', 'haiku'],
  ['claude-fable-5-1', 'opus'],
  ['claude-fable-opus', null]
]) {
  test(`model id ${JSON.stringify(id)} -> ${want}`, () => {
    assert.equal(sessionModel(tmp(`${user}\n${entry(id)}\n`)), want)
  })
}

test('missing file gives null', () => {
  assert.equal(sessionModel(path.join(dir, 'nope.jsonl')), null)
})

test('directory path gives null', () => {
  assert.equal(sessionModel(dir), null)
})

test('empty file and no assistant entries give null', () => {
  assert.equal(sessionModel(tmp('')), null)
  assert.equal(sessionModel(tmp(`${user}\n${user}\n`)), null)
})

test('only sidechain entries gives null', () => {
  assert.equal(sessionModel(tmp(`${entry('claude-opus-5-5', { isSidechain: true })}\n`)), null)
})

test('last main-thread entry without a model gives null', () => {
  const noModel = JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant' } })
  assert.equal(sessionModel(tmp(`${entry('claude-opus-5-5')}\n${noModel}\n`)), null)
})

test('malformed JSON line is skipped', () => {
  assert.equal(sessionModel(tmp(`${entry('claude-sonnet-5-5')}\n{"type":"assistant","message":{"model":"claude-opu\n`)), 'sonnet')
})

test('trailing partial line without newline is skipped', () => {
  const partial = entry('claude-opus-5-5').slice(0, 40)
  assert.equal(sessionModel(tmp(`${entry('claude-sonnet-5-5')}\n${partial}`)), 'sonnet')
})

test('last line without trailing newline is read', () => {
  assert.equal(sessionModel(tmp(`${entry('claude-sonnet-5-5')}\n${entry('claude-haiku-5-5')}`)), 'haiku')
})

test('entry far from the end of a large file', () => {
  const filler = JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: 'x'.repeat(2000) } })
  const lines = [entry('claude-opus-5-5')]
  for (let i = 0; i < 400; i++) lines.push(filler)
  const p = tmp(lines.join('\n') + '\n')
  assert.ok(fs.statSync(p).size > 4 * 64 * 1024)
  assert.equal(sessionModel(p), 'opus')
})

test('sidechain tail larger than the read chunk before the main entry', () => {
  const side = entry('claude-haiku-5-5', { isSidechain: true, pad: 'y'.repeat(3000) })
  const lines = [entry('claude-sonnet-5-5')]
  for (let i = 0; i < 100; i++) lines.push(side)
  assert.equal(sessionModel(tmp(lines.join('\n') + '\n')), 'sonnet')
})

test('a single line larger than the read chunk', () => {
  const big = entry('claude-opus-5-5', { pad: 'z'.repeat(200 * 1024) })
  assert.equal(sessionModel(tmp(`${user}\n${big}\n`)), 'opus')
})

test('multibyte content straddling chunk boundaries does not break parsing', () => {
  const lines = [entry('claude-opus-5-5')]
  for (let i = 0; i < 300; i++) lines.push(JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: 'é€😀'.repeat(150) } }))
  assert.equal(sessionModel(tmp(lines.join('\n') + '\n')), 'opus')
})
