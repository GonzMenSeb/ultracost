import test from 'node:test'
import assert from 'node:assert/strict'
import { loadPolicy, effectivePairs, formatPairs, formatClassPairs, rules } from '../src/rules.mjs'
import { analyze } from '../src/analyze.mjs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const shipped = loadPolicy()
const ALL = ['medium', 'high', 'xhigh']

const withHaiku = {
  classes: {
    ...shipped.classes,
    code: { owns: 'x', pairs: { haiku: ['xhigh'], sonnet: ALL } },
    grunt: { owns: 'x', pairs: { haiku: ['xhigh'], sonnet: ALL } }
  }
}

const noHaiku = {
  classes: Object.fromEntries(
    Object.entries(shipped.classes).map(([k, c]) => [k, { ...c, pairs: Object.fromEntries(Object.entries(c.pairs).filter(([m]) => m !== 'haiku')) }])
  )
}

const stage = (cls, model, effort, extra = {}) => ({
  line: 3,
  label: cls ? `${cls}: thing` : null,
  class: cls,
  model,
  effort,
  ...extra
})

const BLOCKED_ON = "blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }"
const analyzed = (label, model, withBlockedOn) =>
  analyze(
    `await agent('p', { label: '${label}', model: '${model}', effort: 'high'${
      withBlockedOn ? `, schema: { type: 'object', properties: { ${BLOCKED_ON} } }` : ''
    } })`
  ).stages

const shippedHasHaiku = Object.values(shipped.classes).some((c) => 'haiku' in c.pairs)

test('opus session: policy unchanged', () => {
  for (const [cls, def] of Object.entries(shipped.classes)) {
    assert.deepEqual(effectivePairs(shipped, cls, 'opus'), def.pairs, cls)
  }
})

test('opus-mapped (fable) session sees the full build pairs', () => {
  assert.deepEqual(effectivePairs(shipped, 'build', 'opus'), { sonnet: ALL, opus: ALL })
})

test('sonnet session: drops opus, falls back to sonnet x all efforts', () => {
  assert.deepEqual(effectivePairs(shipped, 'decide', 'sonnet'), { sonnet: ALL })
  assert.deepEqual(effectivePairs(shipped, 'judge', 'sonnet'), { sonnet: ALL })
  assert.deepEqual(effectivePairs(shipped, 'build', 'sonnet'), { sonnet: ALL })
  assert.deepEqual(effectivePairs(shipped, 'code', 'sonnet'), shipped.classes.code.pairs.haiku
    ? { haiku: shipped.classes.code.pairs.haiku, sonnet: ALL }
    : { sonnet: ALL })
})

test('null session counts as sonnet', () => {
  for (const cls of Object.keys(shipped.classes)) {
    assert.deepEqual(effectivePairs(shipped, cls, null), effectivePairs(shipped, cls, 'sonnet'), cls)
  }
})

test('haiku session with shipped policy follows whether it lists haiku', () => {
  for (const cls of Object.keys(shipped.classes)) {
    const got = effectivePairs(shipped, cls, 'haiku')
    if (shippedHasHaiku) {
      const own = shipped.classes[cls].pairs.haiku
      assert.deepEqual(got, { haiku: own || ['xhigh'] }, cls)
    } else {
      assert.deepEqual(got, {}, cls)
    }
  }
})

test('haiku session with a haiku-listing policy', () => {
  assert.deepEqual(effectivePairs(withHaiku, 'code', 'haiku'), { haiku: ['xhigh'] })
  assert.deepEqual(effectivePairs(withHaiku, 'grunt', 'haiku'), { haiku: ['xhigh'] })
  assert.deepEqual(effectivePairs(withHaiku, 'decide', 'haiku'), { haiku: ['xhigh'] })
  assert.deepEqual(effectivePairs(withHaiku, 'build', 'haiku'), { haiku: ['xhigh'] })
})

test('haiku-listing policy on sonnet and opus sessions', () => {
  assert.deepEqual(effectivePairs(withHaiku, 'code', 'sonnet'), { haiku: ['xhigh'], sonnet: ALL })
  assert.deepEqual(effectivePairs(withHaiku, 'code', 'opus'), { haiku: ['xhigh'], sonnet: ALL })
})

test('haiku session with a policy that lists no haiku pair is empty', () => {
  const noHaiku = { classes: { build: { owns: 'x', pairs: { sonnet: ALL, opus: ALL } } } }
  assert.deepEqual(effectivePairs(noHaiku, 'build', 'haiku'), {})
})

test('unknown class gives empty effective pairs', () => {
  assert.deepEqual(effectivePairs(shipped, 'nope', 'opus'), {})
  assert.deepEqual(effectivePairs(shipped, 'constructor', 'opus'), {})
})

test('effective pairs keep policy key order', () => {
  assert.deepEqual(Object.keys(effectivePairs(shipped, 'build', 'opus')), ['sonnet', 'opus'])
})

test('formatPairs', () => {
  assert.equal(formatPairs({ sonnet: ALL, opus: ALL }), 'sonnet × {medium, high, xhigh}; opus × {medium, high, xhigh}')
  assert.equal(formatPairs({ haiku: ['xhigh'] }), 'haiku × {xhigh}')
  assert.equal(formatPairs({}), 'none')
})

test('valid pairs pass', () => {
  assert.deepEqual(rules([stage('decide', 'opus', 'high')], shipped, { sessionModel: 'opus' }), [])
  assert.deepEqual(rules([stage('build', 'sonnet', 'xhigh')], shipped, { sessionModel: 'opus' }), [])
  assert.deepEqual(rules([stage('build', 'opus', 'medium')], shipped, { sessionModel: 'opus' }), [])
})

test('unknown class lists the valid classes', () => {
  const errs = rules([stage('frobnicate', 'opus', 'high')], shipped, { sessionModel: 'opus' })
  assert.equal(errs.length, 1)
  assert.equal(errs[0].code, 'PAIR')
  assert.equal(errs[0].line, 3)
  assert.equal(errs[0].stage, 0)
  assert.equal(errs[0].label, 'frobnicate: thing')
  for (const cls of Object.keys(shipped.classes)) assert.ok(errs[0].message.includes(cls), cls)
  assert.ok(errs[0].message.includes('frobnicate'))
})

test('unknown class with null model and effort still emits one error', () => {
  const errs = rules([stage('zzz', null, null)], shipped, { sessionModel: 'opus' })
  assert.equal(errs.length, 1)
})

test('bad pair lists the class effective pairs', () => {
  const errs = rules([stage('decide', 'sonnet', 'high')], shipped, { sessionModel: 'opus' })
  assert.equal(errs.length, 1)
  assert.equal(errs[0].code, 'PAIR')
  assert.ok(errs[0].message.includes(formatPairs(shipped.classes.decide.pairs)))
  assert.ok(errs[0].message.includes('sonnet'))
})

test('effort not allowed for the model is denied', () => {
  const errs = rules([stage('decide', 'opus', 'low')], shipped, { sessionModel: 'opus' })
  assert.equal(errs.length, 1)
})

for (const effort of ['low', 'max', 'LOW', 'High', '', 'minimal']) {
  test(`effort denied: ${JSON.stringify(effort)}`, () => {
    assert.equal(rules([stage('build', 'sonnet', effort)], shipped, { sessionModel: 'opus' }).length, 1)
  })
}

for (const model of ['fable', 'mythos', 'claude-opus-5-5', 'claude-sonnet-5-5', 'opus[1m]', 'sonnet[1m]', 'Opus', 'inherit', '']) {
  test(`model denied: ${JSON.stringify(model)}`, () => {
    const errs = rules([stage('build', model, 'high')], shipped, { sessionModel: 'opus' })
    assert.equal(errs.length, 1)
    assert.equal(errs[0].code, 'PAIR')
  })
}

test('opus stage on a sonnet session is denied; sonnet decide stage passes', () => {
  const ctx = { sessionModel: 'sonnet' }
  const denied = rules([stage('decide', 'opus', 'high')], shipped, ctx)
  assert.equal(denied.length, 1)
  assert.ok(denied[0].message.includes('sonnet × {medium, high, xhigh}'))
  assert.deepEqual(rules([stage('decide', 'sonnet', 'high')], shipped, ctx), [])
  assert.equal(rules([stage('build', 'opus', 'high')], shipped, ctx).length, 1)
})

test('null session model is treated as sonnet', () => {
  const ctx = { sessionModel: null }
  assert.equal(rules([stage('decide', 'opus', 'high')], shipped, ctx).length, 1)
  assert.deepEqual(rules([stage('decide', 'sonnet', 'high')], shipped, ctx), [])
})

test('haiku session, policy without haiku pairs: exact message', () => {
  const noHaiku = { classes: { build: { owns: 'x', pairs: { sonnet: ALL, opus: ALL } } } }
  const errs = rules([stage('build', 'sonnet', 'high')], noHaiku, { sessionModel: 'haiku' })
  assert.equal(errs.length, 1)
  assert.equal(errs[0].message, 'This session runs Haiku and no Haiku pair is allowed; switch with /model sonnet or /model opus.')
})

test('haiku session on the shipped policy', () => {
  const errs = rules([stage('build', 'sonnet', 'high')], shipped, { sessionModel: 'haiku' })
  if (shippedHasHaiku) {
    assert.equal(errs.length, 1)
    assert.ok(errs[0].message.includes('haiku'))
  } else {
    assert.equal(errs.length, 1)
    assert.equal(errs[0].message, 'This session runs Haiku and no Haiku pair is allowed; switch with /model sonnet or /model opus.')
  }
})

test('haiku session with a haiku-listing policy allows haiku xhigh only', () => {
  const ctx = { sessionModel: 'haiku' }
  assert.deepEqual(rules([stage('code', 'haiku', 'xhigh')], withHaiku, ctx), [])
  assert.deepEqual(rules([stage('decide', 'haiku', 'xhigh')], withHaiku, ctx), [])
  assert.equal(rules([stage('code', 'haiku', 'high')], withHaiku, ctx).length, 1)
  assert.equal(rules([stage('code', 'sonnet', 'xhigh')], withHaiku, ctx).length, 1)
  assert.equal(rules([stage('decide', 'opus', 'xhigh')], withHaiku, ctx).length, 1)
})

test('haiku pairs on code and grunt for opus and sonnet sessions', () => {
  for (const s of ['opus', 'sonnet']) {
    assert.deepEqual(rules([stage('code', 'haiku', 'xhigh'), stage('grunt', 'haiku', 'xhigh')], withHaiku, { sessionModel: s }), [], s)
    assert.equal(rules([stage('code', 'haiku', 'high')], withHaiku, { sessionModel: s }).length, 1, s)
  }
})

test('class null emits nothing', () => {
  assert.deepEqual(rules([stage(null, null, null)], shipped, { sessionModel: 'opus' }), [])
  assert.deepEqual(rules([stage(null, 'haiku', 'xhigh')], withHaiku, { sessionModel: 'haiku' }), [])
  assert.deepEqual(rules([stage(null, 'haiku', null)], shipped, { sessionModel: 'opus' }), [])
})

test('classless or unknown-class haiku below xhigh is a PAIR error', () => {
  for (const cls of [null, 'review']) {
    for (const effort of ['medium', 'high']) {
      const errs = rules([stage(cls, 'haiku', effort)], shipped, { sessionModel: 'opus' })
      assert.ok(errs.some((e) => e.code === 'PAIR' && e.message.includes('haiku')), `${cls} ${effort}`)
    }
    assert.deepEqual(rules([stage(cls, 'haiku', 'xhigh')], withHaiku, { sessionModel: 'opus' }).filter((e) => !e.message.startsWith('Unknown class')), [], String(cls))
  }
})

test('valid class with null model or effort emits nothing on opus', () => {
  assert.deepEqual(rules([stage('decide', null, 'high')], shipped, { sessionModel: 'opus' }), [])
  assert.deepEqual(rules([stage('decide', 'opus', null)], shipped, { sessionModel: 'opus' }), [])
})

test('stage index follows the stages array', () => {
  const errs = rules(
    [stage('decide', 'opus', 'high'), stage('decide', 'opus', 'max', { line: 9 }), stage('nope', 'opus', 'high')],
    shipped,
    { sessionModel: 'opus' }
  )
  assert.deepEqual(errs.map((e) => [e.stage, e.line]), [[1, 9], [2, 3]])
})

test('effort with no effective pair is denied while model is unknown', () => {
  for (const effort of ['low', 'max']) {
    const errs = rules([stage('grunt', null, effort)], shipped, { sessionModel: 'opus' })
    assert.equal(errs.length, 1, effort)
    assert.equal(errs[0].code, 'PAIR')
    assert.ok(errs[0].message.includes(`"${effort}"`))
    assert.ok(errs[0].message.includes(formatPairs(shipped.classes.grunt.pairs)))
  }
  assert.deepEqual(rules([stage('grunt', null, 'high')], shipped, { sessionModel: 'opus' }), [])
})

test('model with no effective pair is denied while effort is unknown', () => {
  for (const sessionModel of ['sonnet', null]) {
    const errs = rules([stage('decide', 'opus', null)], shipped, { sessionModel })
    assert.equal(errs.length, 1, String(sessionModel))
    assert.equal(errs[0].code, 'PAIR')
    assert.ok(errs[0].message.includes('"opus"'))
    assert.ok(errs[0].message.includes('sonnet × {medium, high, xhigh}'))
  }
  assert.deepEqual(rules([stage('decide', 'sonnet', null)], shipped, { sessionModel: 'sonnet' }), [])
  assert.deepEqual(rules([stage('build', 'opus', null)], shipped, { sessionModel: 'opus' }), [])
})

test('classless stage still reports effort and model outside the global sets', () => {
  const ctx = { sessionModel: 'opus' }
  const lowEffort = rules([stage(null, 'sonnet', 'low')], shipped, ctx)
  assert.equal(lowEffort.length, 1)
  assert.equal(lowEffort[0].code, 'PAIR')
  assert.ok(lowEffort[0].message.includes('"low"'))
  const maxEffort = rules([stage(null, 'haiku', 'max')], shipped, ctx)
  assert.equal(maxEffort.length, 1)
  assert.ok(maxEffort[0].message.includes('"max"'))
  const badModel = rules([stage(null, 'fable', 'high')], shipped, ctx)
  assert.equal(badModel.length, 1)
  assert.ok(badModel[0].message.includes('"fable"'))
  assert.deepEqual(rules([stage(null, 'sonnet', 'high')], shipped, ctx), [])
})

test('classless stage reports a model above the session model', () => {
  const errs = rules([stage(null, 'opus', 'high')], shipped, { sessionModel: 'sonnet' })
  assert.equal(errs.length, 1)
  assert.ok(errs[0].message.includes('"opus"'))
  assert.deepEqual(rules([stage(null, 'opus', 'high')], shipped, { sessionModel: 'opus' }), [])
})

test('unknown class also reports a global effort problem', () => {
  const errs = rules([stage('review', 'opus', 'low')], shipped, { sessionModel: 'opus' })
  assert.equal(errs.length, 2)
  assert.ok(errs.some((e) => e.message.includes('Unknown class')))
  assert.ok(errs.some((e) => e.message.includes('"low"')))
})

test('pair deny that leaves no opus asks for blocked_on unless the stage already has it', () => {
  const ctx = { sessionModel: 'sonnet' }
  const denied = rules([stage('decide', 'opus', 'high')], shipped, ctx)
  assert.equal(denied.length, 1)
  assert.equal(denied[0].needsBlockedOn, true)
  assert.equal(rules(analyzed('decide: x', 'opus', false), shipped, ctx)[0].needsBlockedOn, true)
  const withIt = rules(analyzed('decide: x', 'opus', true), shipped, ctx)
  assert.equal(withIt.length, 1)
  assert.ok(!withIt[0].needsBlockedOn)
  const opusPair = rules([stage('build', 'sonnet', 'low')], shipped, { sessionModel: 'opus' })
  assert.ok(!opusPair[0].needsBlockedOn)
})

test('opus above the session model asks for blocked_on on a sonnet or unknown session', () => {
  for (const ctx of [{ sessionModel: 'sonnet' }, { sessionModel: null }]) {
    const unknown = rules([stage('review', 'opus', 'high')], shipped, ctx)
    assert.ok(unknown.some((e) => e.message.includes('above the session model') && e.needsBlockedOn === true))
    const classless = rules([stage(null, 'opus', 'high')], shipped, ctx)
    assert.equal(classless.length, 1)
    assert.equal(classless[0].needsBlockedOn, true)
  }
  const classless = rules(analyzed('x', 'opus', true).map((st) => ({ ...st, class: null })), shipped, { sessionModel: 'sonnet' })
  assert.equal(classless.length, 1)
  assert.ok(!classless[0].needsBlockedOn)
  assert.ok(!rules([stage(null, 'sonnet', 'low')], shipped, { sessionModel: 'sonnet' })[0].needsBlockedOn)
})

test('opus stage with an unknown or missing class asks for blocked_on on every session', () => {
  for (const sessionModel of ['opus', 'sonnet', null]) {
    const ctx = { sessionModel }
    const unknown = rules([stage('summarize', 'opus', 'medium')], shipped, ctx)
    assert.ok(unknown.some((e) => e.message.startsWith('Unknown class') && e.needsBlockedOn === true), String(sessionModel))
    const noModel = rules([stage('summarize', null, 'medium')], shipped, ctx)
    assert.ok(noModel.some((e) => e.needsBlockedOn === true), String(sessionModel))
    const classless = rules([stage(null, 'opus', 'low')], shipped, ctx)
    assert.ok(classless.length > 0 && classless.every((e) => e.needsBlockedOn === true), String(sessionModel))
    const withIt = rules(analyzed('summarize: x', 'opus', true).map((st) => ({ ...st })), shipped, ctx)
    assert.ok(withIt.length > 0 && withIt.every((e) => !e.needsBlockedOn), String(sessionModel))
  }
})

test('gate on an Opus session: an unknown-class opus draft is denied with the blocked_on snippet', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const script = "await agent('Summarize the three reports into one list of findings', { label: 'summarize: findings', model: 'opus', effort: 'medium' })"
  const configDir = mkdtempSync(join(tmpdir(), 'ultraguard-rules-'))
  const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir }
  for (const k of ['CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE', 'CLAUDE_CODE_EFFORT_LEVEL']) delete env[k]
  const input = JSON.stringify({
    session_id: 'rules',
    tool_use_id: 'toolu_rules',
    tool_name: 'Workflow',
    tool_input: { script },
    cwd: root,
    transcript_path: `${root}tests/harness/transcripts/opus.jsonl`
  })
  const r = spawnSync(process.execPath, [`${root}hooks/gate.mjs`], { input, env, encoding: 'utf8' })
  const wrote = existsSync(join(configDir, 'ultraguard', 'sessions', 'rules', 'toolu_rules.gate.json'))
  rmSync(configDir, { recursive: true, force: true })
  assert.ok(wrote)
  assert.equal(r.status, 0, r.stderr)
  const reason = JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason
  assert.match(reason, /Unknown class "summarize:"/)
  assert.match(reason, /blocked_on: \{ type: \['string', 'null'\]/)
})

test('classless haiku stage: haiku-xhigh instruction only when some class allows haiku', () => {
  for (const s of ['opus', 'sonnet']) {
    const ctx = { sessionModel: s }
    const none = rules([stage(null, 'haiku', 'high')], noHaiku, ctx)
    assert.equal(none.length, 1, s)
    assert.ok(!none[0].message.includes('xhigh'), `${s}: ${none[0].message}`)
    assert.ok(none[0].message.includes('haiku'), s)
    const listed = rules([stage(null, 'haiku', 'high')], withHaiku, ctx)
    assert.ok(listed.some((e) => e.message.includes('only allowed with effort "xhigh"')), s)
  }
})

test('unknown-class haiku stage: haiku-xhigh instruction only when some class allows haiku', () => {
  const none = rules([stage('nope', 'haiku', 'high')], noHaiku, { sessionModel: 'opus' })
  assert.ok(none.every((e) => !e.message.includes('only allowed with effort')))
  assert.ok(none.some((e) => e.message.includes('haiku')))
  const listed = rules([stage('nope', 'haiku', 'high')], withHaiku, { sessionModel: 'opus' })
  assert.ok(listed.some((e) => e.message.includes('only allowed with effort "xhigh"')))
})

test('classless or unknown-class haiku xhigh is denied when no class allows haiku', () => {
  for (const sessionModel of ['opus', 'sonnet', null]) {
    for (const cls of [null, 'extract']) {
      const errs = rules([stage(cls, 'haiku', 'xhigh')], noHaiku, { sessionModel })
      assert.ok(
        errs.some((e) => e.code === 'PAIR' && e.message === 'model "haiku" is not allowed under the current policy; see the allowed pairs per class.'),
        `${cls} ${sessionModel}`
      )
      assert.deepEqual(
        rules([stage(cls, 'haiku', 'xhigh')], withHaiku, { sessionModel }).filter((e) => !e.message.startsWith('Unknown class')),
        [],
        `${cls} ${sessionModel} withHaiku`
      )
    }
  }
})

test('shipped policy allows haiku xhigh for every class that lists haiku, and nothing else', () => {
  const listing = Object.entries(shipped.classes).filter(([, c]) => 'haiku' in c.pairs)
  assert.ok(listing.length > 0)
  for (const sessionModel of ['opus', 'sonnet']) {
    for (const [cls, c] of listing) {
      for (const effort of c.pairs.haiku) {
        assert.deepEqual(rules([stage(cls, 'haiku', effort)], shipped, { sessionModel }), [], `${cls} ${effort} ${sessionModel}`)
      }
      assert.equal(rules([stage(cls, 'haiku', 'high')], shipped, { sessionModel }).length, c.pairs.haiku.includes('high') ? 0 : 1, `${cls} high ${sessionModel}`)
    }
    const nonListing = Object.keys(shipped.classes).find((k) => !('haiku' in shipped.classes[k].pairs))
    assert.equal(rules([stage(nonListing, 'haiku', 'xhigh')], shipped, { sessionModel }).length, 1, nonListing)
  }
})

const fan = (...bigs) => ({ stages: bigs.map((bigFanout) => ({ inFanout: bigFanout, bigFanout })) })
const OPUS_CTX = { sessionModel: 'opus' }

test('opus session: investigate is sonnet only', () => {
  assert.deepEqual(effectivePairs(shipped, 'investigate', 'opus'), { sonnet: ALL })
  for (const effort of ALL) assert.deepEqual(rules([stage('investigate', 'sonnet', effort)], shipped, OPUS_CTX), [], effort)
  const errs = rules([stage('investigate', 'opus', 'high')], shipped, OPUS_CTX)
  assert.equal(errs.length, 1)
  assert.equal(errs[0].code, 'PAIR')
  assert.ok(errs[0].message.includes('sonnet × {medium, high, xhigh}'))
  assert.equal(errs[0].needsBlockedOn, true)
  assert.equal(rules([stage('investigate', 'sonnet', 'low')], shipped, OPUS_CTX).length, 1)
})

test('investigate runs on sonnet and haiku sessions', () => {
  assert.deepEqual(rules([stage('investigate', 'sonnet', 'high')], shipped, { sessionModel: 'sonnet' }), [])
  assert.deepEqual(rules([stage('investigate', 'sonnet', 'high')], shipped, { sessionModel: null }), [])
  assert.equal(rules([stage('investigate', 'opus', 'high')], shipped, { sessionModel: 'sonnet' }).length, 1)
})

test('effectivePairs: conditional pairs are added on an opus session only', () => {
  assert.deepEqual(effectivePairs(shipped, 'judge', 'opus'), { opus: ALL })
  assert.deepEqual(effectivePairs(shipped, 'judge', 'opus', { verdict: true }), { opus: ALL, sonnet: ALL })
  assert.deepEqual(effectivePairs(shipped, 'judge', 'opus', { bigFanout: true }), { opus: ALL })
  assert.deepEqual(effectivePairs(shipped, 'decide', 'opus', { bigFanout: true }), { opus: ALL, sonnet: ALL })
  assert.deepEqual(effectivePairs(shipped, 'decide', 'opus', { verdict: true }), { opus: ALL })
  assert.deepEqual(effectivePairs(shipped, 'synth', 'opus', { bigFanout: true, verdict: true }), { opus: ALL, sonnet: ALL })
  assert.deepEqual(effectivePairs(shipped, 'build', 'opus', { bigFanout: true, verdict: true }), shipped.classes.build.pairs)
  for (const sessionModel of ['sonnet', null]) {
    assert.deepEqual(effectivePairs(shipped, 'judge', sessionModel, { verdict: true }), { sonnet: ALL })
    assert.deepEqual(effectivePairs(shipped, 'decide', sessionModel, { bigFanout: true }), { sonnet: ALL })
  }
})

test('effectivePairs merges efforts of a conditional pair into a model the class already lists', () => {
  const custom = {
    classes: { x: { owns: 'x', pairs: { opus: ['high'], sonnet: ['medium'] }, fanoutPairs: { sonnet: ['high', 'medium'], haiku: ['xhigh'] } } }
  }
  assert.deepEqual(effectivePairs(custom, 'x', 'opus', { bigFanout: true }), { opus: ['high'], sonnet: ['medium', 'high'], haiku: ['xhigh'] })
  assert.deepEqual(effectivePairs(custom, 'x', 'opus'), { opus: ['high'], sonnet: ['medium'] })
})

test('judge on sonnet passes with a verdict schema and fails without it', () => {
  assert.deepEqual(rules([stage('judge', 'sonnet', 'high', { verdict: true })], shipped, OPUS_CTX), [])
  for (const effort of ALL) assert.deepEqual(rules([stage('judge', 'sonnet', effort, { verdict: true })], shipped, OPUS_CTX), [], effort)
  const errs = rules([stage('judge', 'sonnet', 'high', { verdict: false })], shipped, OPUS_CTX)
  assert.equal(errs.length, 1)
  assert.equal(errs[0].code, 'PAIR')
  assert.match(errs[0].message, /single yes\/no review/)
  assert.match(errs[0].message, /pass/)
  assert.match(errs[0].message, /evidence/)
  assert.match(errs[0].message, /Allowed: opus × \{medium, high, xhigh\}\.$/)
  assert.ok(!errs[0].message.includes('fan-out'))
  assert.equal(rules([stage('judge', 'sonnet', 'high')], shipped, OPUS_CTX).length, 1)
})

test('a judge verdict is not tied to a fan-out and a fan-out does not unlock a judge on sonnet', () => {
  assert.deepEqual(rules([stage('judge', 'sonnet', 'high', { verdict: true })], shipped, { ...OPUS_CTX, fanout: fan(true) }), [])
  assert.deepEqual(rules([stage('judge', 'sonnet', 'high', { verdict: true })], shipped, { ...OPUS_CTX, fanout: fan(false) }), [])
  const errs = rules([stage('judge', 'sonnet', 'high')], shipped, { ...OPUS_CTX, fanout: fan(true) })
  assert.equal(errs.length, 1)
  assert.match(errs[0].message, /single yes\/no review/)
})

test('judge on opus keeps any schema, verdict or not', () => {
  assert.deepEqual(rules([stage('judge', 'opus', 'xhigh', { verdict: true })], shipped, OPUS_CTX), [])
  assert.deepEqual(rules([stage('judge', 'opus', 'xhigh', { verdict: false })], shipped, OPUS_CTX), [])
})

test('decide, synth and design on sonnet pass only in a big fan-out', () => {
  for (const cls of ['decide', 'synth', 'design']) {
    assert.deepEqual(rules([stage(cls, 'sonnet', 'high')], shipped, { ...OPUS_CTX, fanout: fan(true) }), [], cls)
    for (const ctx of [OPUS_CTX, { ...OPUS_CTX, fanout: fan(false) }, { ...OPUS_CTX, fanout: { stages: [] } }]) {
      const errs = rules([stage(cls, 'sonnet', 'high')], shipped, ctx)
      assert.equal(errs.length, 1, cls)
      assert.equal(errs[0].code, 'PAIR')
      assert.match(errs[0].message, /more than 3 agents/, cls)
      assert.ok(errs[0].message.includes(`${cls}: may use sonnet only in a fan-out`), errs[0].message)
      assert.match(errs[0].message, /Allowed: opus × \{medium, high, xhigh\}\.$/)
      assert.ok(!errs[0].message.includes('yes/no'))
    }
  }
})

test('bigFanout is read per stage by index', () => {
  const stages = [stage('decide', 'sonnet', 'high'), stage('decide', 'sonnet', 'high'), stage('decide', 'opus', 'high')]
  const errs = rules(stages, shipped, { ...OPUS_CTX, fanout: fan(true, false, false) })
  assert.deepEqual(errs.map((e) => e.stage), [1])
})

test('a fan-out changes nothing for classes without fanoutPairs', () => {
  assert.deepEqual(rules([stage('build', 'sonnet', 'high')], shipped, { ...OPUS_CTX, fanout: fan(false) }), [])
  assert.equal(rules([stage('investigate', 'opus', 'high')], shipped, { ...OPUS_CTX, fanout: fan(true) }).length, 1)
})

test('sonnet and null sessions: judge needs no verdict schema and decide needs no fan-out', () => {
  for (const sessionModel of ['sonnet', null]) {
    const ctx = { sessionModel, fanout: fan(false) }
    assert.deepEqual(rules([stage('judge', 'sonnet', 'high', { verdict: false })], shipped, ctx), [], String(sessionModel))
    assert.deepEqual(rules([stage('decide', 'sonnet', 'high')], shipped, ctx), [], String(sessionModel))
    assert.deepEqual(rules([stage('synth', 'sonnet', 'medium')], shipped, ctx), [], String(sessionModel))
    assert.deepEqual(rules([stage('design', 'sonnet', 'xhigh')], shipped, ctx), [], String(sessionModel))
    assert.equal(rules([stage('judge', 'opus', 'high')], shipped, ctx).length, 1, String(sessionModel))
  }
})

test('a conditional refusal carries no hint when the pair is not allowed under any condition', () => {
  const errs = rules([stage('decide', 'sonnet', 'low')], shipped, OPUS_CTX)
  assert.equal(errs.length, 1)
  assert.ok(!errs[0].message.includes('fan-out'))
  const haiku = rules([stage('judge', 'haiku', 'xhigh')], shipped, OPUS_CTX)
  assert.ok(haiku.every((e) => !e.message.includes('yes/no')))
})

test('a refused judge on sonnet that has a valid blocked_on does not ask for the snippet again', () => {
  const errs = rules(analyzed('judge: x', 'sonnet', true), shipped, OPUS_CTX)
  assert.equal(errs.length, 1)
  assert.match(errs[0].message, /single yes\/no review/)
  assert.ok(!errs[0].needsBlockedOn)
})

test('formatClassPairs marks the conditional pairs of a class', () => {
  assert.equal(formatClassPairs(shipped, 'investigate'), 'sonnet × {medium, high, xhigh}')
  assert.equal(formatClassPairs(shipped, 'build'), formatPairs(shipped.classes.build.pairs))
  assert.equal(
    formatClassPairs(shipped, 'judge'),
    'opus × {medium, high, xhigh}; sonnet × {medium, high, xhigh} (yes/no verdict schema only)'
  )
  for (const cls of ['decide', 'synth', 'design']) {
    assert.equal(
      formatClassPairs(shipped, cls),
      'opus × {medium, high, xhigh}; sonnet × {medium, high, xhigh} (in a fan-out of more than 3 only)',
      cls
    )
  }
  const wide = { limits: { bigFanout: 5 }, classes: { decide: { owns: 'x', pairs: { opus: ['high'] }, fanoutPairs: { sonnet: ['high'] } } } }
  assert.equal(formatClassPairs(wide, 'decide'), 'opus × {high}; sonnet × {high} (in a fan-out of more than 5 only)')
})

test('label check: investigation words in decide, judge and design labels are LABEL errors', () => {
  const s = (label, cls, model = 'opus') => ({ line: 1, label, class: cls, model, effort: 'high' })
  const run = (st, fan = false) => rules([st], shipped, { sessionModel: 'opus', fanout: { stages: [{ inFanout: fan, bigFanout: false }] } }).filter((e) => e.code === 'LABEL')
  const hit = run(s('decide: ovh extra ip research', 'decide'))
  assert.equal(hit.length, 1)
  assert.match(hit[0].message, /reads like investigation \("research"\)/)
  assert.match(hit[0].message, /investigate: on sonnet × \{medium, high, xhigh\}/)
  assert.equal(hit[0].needsBlockedOn, true)
  assert.equal(run(s('judge: migration readiness', 'judge')).length, 1)
  assert.equal(run(s('design: map ${…}', 'design')).length, 1)
  assert.equal(run(s('decide: pc1 relay design', 'decide')).length, 0)
  assert.equal(run(s('judge: verify finding ${…}', 'judge')).length, 0)
  assert.equal(run(s('investigate: research legal', 'investigate', 'sonnet')).length, 0)
  assert.equal(run(s('build: search index', 'build', 'sonnet')).length, 0)
})

test('label check: synth is checked only inside a fan-out', () => {
  const st = { line: 1, label: 'synth: research ${…}', class: 'synth', model: 'opus', effort: 'high' }
  const run = (fan) => rules([st], shipped, { sessionModel: 'opus', fanout: { stages: [{ inFanout: fan, bigFanout: false }] } }).filter((e) => e.code === 'LABEL')
  assert.equal(run(false).length, 0)
  assert.equal(run(true).length, 1)
})
