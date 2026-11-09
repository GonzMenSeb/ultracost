import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sha256Hex } from '../src/fingerprint.mjs'
import { recordPath } from '../src/record.mjs'
import { readFileSync } from 'node:fs'
import { loadPrices } from '../src/prices.mjs'
import { toastText } from '../src/savedText.mjs'
import { STOPPED, TALLY_PREFIX, UNKNOWN_PHASE, noteFocus, phaseOpen, setFolds, agentPieces, finishedRuns, hideFinished, noteMainStep, noteMeterReading, noteSaved, noteStored, noteUsage, staleTallies, storedTally, settledTally, stoppedRuns } from '../src/eval.mjs'
import {
  activeRuns,
  bandText,
  bandView,
  closeRun,
  createState,
  endAllRuns,
  evalRecord,
  familyOf,
  findRunKey,
  gateWanted,
  labelMatches,
  noteAgentDone,
  noteGateRecord,
  noteLaunch,
  noteLaunchResult,
  noteLimit,
  noteRunEnd,
  noteSpawn,
  noteStep,
  openRun,
  parseTaskNotifications,
  runChecks,
  runOfAgent,
  runView
} from '../src/eval.mjs'

const SCRIPT = "await agent('x', { label: 'synth: research legal', model: 'opus', effort: 'xhigh' })\n"
const TU = 'toolu_01A'
const RUN = 'wf_abc123def'
const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'

const stage = (index, label, model, effort) => ({ index, line: index + 1, label, class: label.split(':')[0], model, effort, inFanout: false, bigFanout: false, verdict: false })
const gate = (over = {}) => ({
  v: 1,
  kind: 'gate',
  at: '2026-11-07T00:00:00.000Z',
  session_id: 's1',
  tool_use_id: TU,
  decision: 'pass',
  fingerprint: sha256Hex(SCRIPT),
  scriptPath: null,
  sessionModel: 'opus',
  maxOpus: 3,
  stages: [stage(0, 'synth: research ${…}', 'opus', 'xhigh'), stage(1, 'investigate: map', 'sonnet', 'high')],
  errors: [],
  ...over
})

const UNREAD = Symbol('unread')

function launched({ record = gate(), fingerprint = sha256Hex(SCRIPT), name = 'research', from = createState() } = {}) {
  let s = from
  s = noteLaunch(s, { toolUseId: TU, fingerprint, at: 1000 })
  if (record !== UNREAD) s = noteGateRecord(s, TU, record)
  return noteLaunchResult(s, { toolUseId: TU, isError: false, taskId: 'w1', runId: RUN, name, at: 1001 })
}

const spawn = (s, n, label, resolvedModel, over = {}) =>
  noteSpawn(s, { toolUseId: TU, runId: RUN, agentId: `a${n}`, label, askedModel: resolvedModel, resolvedModel, at: 2000 + n, ...over })
const step = (s, n, model, effort) => noteStep(s, { agentId: `a${n}`, model, effort })
const only = (s) => activeRuns(s)[0]
const reasons = (s) => runChecks(only(s)).map((c) => (c.ok ? 'ok' : c.reason))

function compliant() {
  let s = launched()
  s = spawn(s, 1, 'synth: research legal', OPUS)
  s = step(s, 1, OPUS, 'xhigh')
  s = spawn(s, 2, 'investigate: map', SONNET)
  s = step(s, 2, SONNET, 'high')
  return s
}

test('familyOf reads the family out of an alias or a full id', () => {
  assert.equal(familyOf('opus'), 'opus')
  assert.equal(familyOf('claude-sonnet-4-6'), 'sonnet')
  assert.equal(familyOf('claude-3-5-haiku-20241022'), 'haiku')
  assert.equal(familyOf('Claude-OPUS-4-7[1m]'), 'opus')
  assert.equal(familyOf('gpt-5'), null)
  assert.equal(familyOf(undefined), null)
})

test('labelMatches: ${…} matches any text, the rest is literal', () => {
  assert.equal(labelMatches('synth: research ${…}', 'synth: research legal'), true)
  assert.equal(labelMatches('synth: research ${…}', 'synth: research '), true)
  assert.equal(labelMatches('synth: research ${…}', 'synth: map legal'), false)
  assert.equal(labelMatches('synth: map', 'synth: map x'), false)
  assert.equal(labelMatches('synth: map', 'synth: map'), true)
  assert.equal(labelMatches('a ${…} b ${…} c', 'a 1 b 2 c'), true)
  assert.equal(labelMatches('a ${…} b ${…} c', 'a 1 c'), false)
  assert.equal(labelMatches('${…}: x', 'build: x'), true)
  assert.equal(labelMatches('a ${…}b', 'a'), false)
  assert.equal(labelMatches('a.b', 'axb'), false)
  assert.equal(labelMatches(null, 'x'), false)
})

test('a compliant run is green with four passing checks', () => {
  const s = compliant()
  assert.deepEqual(reasons(s), ['ok', 'ok', 'ok', 'ok'])
  assert.deepEqual(runChecks(only(s)).map((c) => c.id), ['gate', 'plan', 'requests', 'opus'])
  assert.deepEqual(bandView(s), { color: 'green', running: 1, red: 0 })
  const v = runView(only(s))
  assert.equal(v.ok, true)
  assert.equal(v.color, 'green')
  assert.equal(v.title, 'research')
  assert.equal(v.shortId, 'abc123')
  assert.equal(v.countsText, '1 opus  1 sonnet')
  assert.deepEqual(v.agents.map((a) => [a.label, a.approved, a.ran, a.ok]), [
    ['synth: research legal', 'opus · xhigh', 'opus · xhigh', true],
    ['investigate: map', 'sonnet · high', 'sonnet · high', true]
  ])
})

test('a run with no gate record is red: not approved by the gate', () => {
  const s = launched({ record: null })
  assert.equal(reasons(s)[0], 'not approved by the gate')
  assert.deepEqual(bandView(s), { color: 'red', running: 1, red: 1 })
})

test('a gate record that has not been read yet is not approval', () => {
  const s = launched({ record: UNREAD })
  assert.equal(reasons(s)[0], 'not approved by the gate')
})

test('a fingerprint mismatch is red', () => {
  const s = launched({ fingerprint: sha256Hex('something else') })
  assert.match(reasons(s)[0], /not the one the gate approved/)
  const unknown = launched({ fingerprint: null })
  assert.match(reasons(unknown)[0], /not the one the gate approved/)
})

test('a deny record is red', () => {
  const s = launched({ record: gate({ decision: 'deny' }) })
  assert.equal(reasons(s)[0], 'the gate denied this script')
})

test('a record of another launch or another kind counts as no record', () => {
  assert.equal(reasons(launched({ record: gate({ tool_use_id: 'toolu_other' }) }))[0], 'not approved by the gate')
  assert.equal(reasons(launched({ record: gate({ kind: 'eval' }) }))[0], 'not approved by the gate')
  assert.equal(reasons(launched({ record: gate({ decision: 'maybe' }) }))[0], 'not approved by the gate')
})

test('an agent whose label matches no approved stage is red', () => {
  const s = spawn(launched(), 1, 'build: surprise', OPUS)
  assert.equal(reasons(s)[1], 'agent "build: surprise" matches no approved stage')
  assert.equal(bandView(s).color, 'red')
})

test('an agent that ran on another model family than approved is red', () => {
  const s = spawn(launched(), 1, 'synth: research legal', SONNET)
  assert.equal(reasons(s)[1], 'agent "synth: research legal" ran on sonnet, the gate approved opus')
  const v = runView(only(s))
  assert.equal(v.agents[0].ok, false)
  assert.equal(v.agents[0].approved, 'opus · xhigh')
})

test('a request with another effort than approved is red (xhigh approved, high sent)', () => {
  let s = spawn(launched(), 1, 'synth: research legal', OPUS)
  s = step(s, 1, OPUS, 'xhigh')
  assert.deepEqual(reasons(s), ['ok', 'ok', 'ok', 'ok'])
  s = step(s, 1, OPUS, 'high')
  assert.equal(reasons(s)[2], 'agent "synth: research legal" sent effort high, the gate approved xhigh')
})

test('a request with no effort or another model family is red', () => {
  let s = spawn(launched(), 1, 'synth: research legal', OPUS)
  s = step(s, 1, OPUS, undefined)
  assert.match(reasons(s)[2], /sent effort none, the gate approved xhigh/)
  let t = spawn(launched(), 1, 'synth: research legal', OPUS)
  t = step(t, 1, SONNET, 'xhigh')
  assert.match(reasons(t)[2], /sent a sonnet request, the gate approved opus/)
})

test('a fourth concurrent opus agent is red; finishing one first keeps it green', () => {
  const record = gate({ stages: [stage(0, 'design: ${…}', 'opus', 'high')] })
  let s = launched({ record })
  for (let n = 1; n <= 3; n++) s = spawn(s, n, `design: part ${n}`, OPUS)
  assert.deepEqual(reasons(s), ['ok', 'ok', 'ok', 'ok'])
  s = spawn(s, 4, 'design: part 4', OPUS)
  assert.equal(reasons(s)[3], '4 opus agents ran at once; the limit is 3')

  let t = launched({ record })
  for (let n = 1; n <= 3; n++) t = spawn(t, n, `design: part ${n}`, OPUS)
  t = noteAgentDone(t, { agentId: 'a1' })
  t = spawn(t, 4, 'design: part 4', OPUS)
  assert.deepEqual(reasons(t), ['ok', 'ok', 'ok', 'ok'])
})

test('sonnet agents never count toward the opus cap', () => {
  const record = gate({ stages: [stage(0, 'investigate: ${…}', 'sonnet', 'high')] })
  let s = launched({ record })
  for (let n = 1; n <= 8; n++) s = spawn(s, n, `investigate: ${n}`, SONNET)
  assert.equal(runChecks(only(s))[3].ok, true)
})

test('noteLimit changes the cap for runs created afterwards', () => {
  const record = gate({ stages: [stage(0, 'design: ${…}', 'opus', 'high')] })
  let s = noteLimit(createState(), 4)
  s = noteLaunch(s, { toolUseId: TU, fingerprint: sha256Hex(SCRIPT), at: 1 })
  s = noteGateRecord(s, TU, record)
  s = noteLaunchResult(s, { toolUseId: TU, runId: RUN, at: 2 })
  for (let n = 1; n <= 4; n++) s = spawn(s, n, `design: part ${n}`, OPUS)
  assert.equal(runChecks(only(s))[3].ok, true)
  assert.equal(noteLimit(s, 0), s)
  assert.equal(noteLimit(s, 4), s)
})

test('a spawn whose run has no launch creates a red run keyed by runId', () => {
  let s = noteSpawn(createState(), { toolUseId: '', runId: 'wf_9zz', agentId: 'a1', label: 'grunt: x', askedModel: 'haiku', resolvedModel: 'claude-haiku-4-5', at: 5 })
  const run = only(s)
  assert.equal(run.key, 'wf_9zz')
  assert.equal(run.launched, false)
  assert.equal(runChecks(run)[0].reason, 'not approved by the gate')
  assert.equal(bandView(s).color, 'red')
  s = noteSpawn(s, { toolUseId: 'toolu_unknown', runId: 'wf_9zz', agentId: 'a2', label: 'grunt: y', resolvedModel: 'claude-haiku-4-5', at: 6 })
  assert.equal(activeRuns(s).length, 1)
  assert.equal(only(s).agents.length, 2)
  assert.equal(runView(only(s)).title, 'unknown launch')
})

test('a spawn with a tool_use_id but no run id and no launch is keyed by the tool_use_id', () => {
  const s = noteSpawn(createState(), { toolUseId: 'toolu_zzz', runId: '', agentId: 'a1', label: 'x', resolvedModel: OPUS, at: 1 })
  assert.equal(only(s).key, 'toolu_zzz')
  assert.equal(noteSpawn(createState(), { toolUseId: '', runId: '', agentId: 'a1', label: 'x', resolvedModel: OPUS }).runs.constructor, Object)
})

test('a spawn before the launch result still lands in its launch run', () => {
  let s = noteLaunch(createState(), { toolUseId: TU, fingerprint: sha256Hex(SCRIPT), at: 1 })
  s = noteGateRecord(s, TU, gate())
  s = spawn(s, 1, 'synth: research legal', OPUS)
  assert.equal(only(s).key, TU)
  s = noteLaunchResult(s, { toolUseId: TU, runId: RUN, taskId: 'w1', name: 'research', at: 3 })
  assert.equal(activeRuns(s).length, 1)
  assert.equal(only(s).runId, RUN)
  assert.equal(runChecks(only(s))[0].ok, true)
})

test('a resumed run raising spawns with no tool_use_id binds to the one pending launch', () => {
  let s = noteLaunch(createState(), { toolUseId: TU, fingerprint: sha256Hex(SCRIPT), at: 1 })
  s = noteGateRecord(s, TU, gate())
  s = noteSpawn(s, { toolUseId: '', runId: RUN, agentId: 'a1', label: 'synth: research legal', resolvedModel: OPUS, at: 2 })
  assert.equal(only(s).key, TU)
  assert.equal(runChecks(only(s))[0].ok, true)
})

test('a resumed run raising spawns before its launch result does not file them under the ended run of that run id', () => {
  for (const spawnId of ['toolu_02B', '']) {
    let s = compliant()
    s = noteRunEnd(s, { toolUseId: TU, status: 'killed', at: 5 })
    const before = s.runs[TU].agents.length
    s = noteLaunch(s, { toolUseId: 'toolu_02B', fingerprint: sha256Hex(SCRIPT), at: 10 })
    s = noteGateRecord(s, 'toolu_02B', gate({ tool_use_id: 'toolu_02B' }))
    s = noteSpawn(s, { toolUseId: spawnId, runId: RUN, agentId: 'a9', label: 'synth: research legal', resolvedModel: OPUS, at: 11 })
    assert.equal(s.runs[TU].agents.length, before)
    assert.equal(s.runs.toolu_02B.agents.length, 1)
    s = noteLaunchResult(s, { toolUseId: 'toolu_02B', runId: RUN, at: 12 })
    assert.equal(s.runs.toolu_02B.agents.length, 1)
    assert.deepEqual(activeRuns(s).map((r) => r.key), ['toolu_02B'])
    assert.deepEqual(bandView(s), { color: 'green', running: 1, red: 0 })
  }
})

test('a resumed run spawning an unapproved agent shows red in its own run', () => {
  let s = compliant()
  s = noteRunEnd(s, { toolUseId: TU, status: 'killed', at: 5 })
  s = noteLaunch(s, { toolUseId: 'toolu_02B', fingerprint: sha256Hex(SCRIPT), at: 10 })
  s = noteGateRecord(s, 'toolu_02B', gate({ tool_use_id: 'toolu_02B' }))
  s = noteSpawn(s, { toolUseId: '', runId: RUN, agentId: 'a9', label: 'grunt: unapproved', resolvedModel: OPUS, at: 11 })
  assert.deepEqual(bandView(s), { color: 'red', running: 1, red: 1 })
})

test('findRunKey never returns an ended run by run id, and a late spawn still lands in it', () => {
  let s = compliant()
  s = noteRunEnd(s, { toolUseId: TU, status: 'completed', at: 5 })
  assert.equal(findRunKey(s, { toolUseId: '', runId: RUN }), null)
  s = noteSpawn(s, { toolUseId: '', runId: RUN, agentId: 'a9', label: 'x', resolvedModel: OPUS, at: 6 })
  assert.equal(activeRuns(s).length, 0)
  assert.equal(s.runs[TU].agents.some((a) => a.agentId === 'a9'), true)
})

test('an orphan run keeps the spawn tool_use_id and leaves the band when it ends', () => {
  let s = noteSpawn(createState(), { toolUseId: 'toolu_X', runId: 'wf_9', agentId: 'a1', label: 'x', resolvedModel: OPUS, at: 1 })
  assert.equal(only(s).toolUseId, 'toolu_X')
  assert.equal(only(s).key, 'wf_9')
  assert.equal(bandView(s).red, 1)
  s = noteRunEnd(s, { ...parseTaskNotifications('<task-notification><tool-use-id>toolu_X</tool-use-id><status>completed</status></task-notification>')[0], at: 5 })
  assert.equal(activeRuns(s).length, 0)
  assert.equal(bandView(s), null)
  assert.equal(s.runs.wf_9.status, 'completed')
})

test('an ending notice with no task id does not end an orphan that has no task id either', () => {
  const s = noteSpawn(createState(), { toolUseId: '', runId: 'wf_9', agentId: 'a1', label: 'x', resolvedModel: OPUS, at: 1 })
  assert.equal(noteRunEnd(s, { toolUseId: null, taskId: null, status: 'completed', at: 2 }), s)
})

test('two pending launches are ambiguous: the spawn stays an unapproved run', () => {
  let s = noteLaunch(createState(), { toolUseId: TU, fingerprint: 'f', at: 1 })
  s = noteLaunch(s, { toolUseId: 'toolu_02B', fingerprint: 'g', at: 2 })
  s = noteSpawn(s, { toolUseId: '', runId: RUN, agentId: 'a1', label: 'x', resolvedModel: OPUS, at: 3 })
  assert.equal(only(s).key, RUN)
  assert.equal(only(s).launched, false)
})

test('a launch result that arrives after an orphan run adopts it', () => {
  let s = noteLaunch(createState(), { toolUseId: TU, fingerprint: sha256Hex(SCRIPT), at: 1 })
  s = noteLaunch(s, { toolUseId: 'toolu_02B', fingerprint: 'g', at: 2 })
  s = noteGateRecord(s, TU, gate())
  s = noteSpawn(s, { toolUseId: '', runId: RUN, agentId: 'a1', label: 'synth: research legal', resolvedModel: OPUS, at: 3 })
  assert.equal(only(s).launched, false)
  s = noteLaunchResult(s, { toolUseId: TU, runId: RUN, taskId: 'w1', at: 4 })
  assert.equal(activeRuns(s).length, 1)
  assert.equal(only(s).key, TU)
  assert.equal(only(s).agents.length, 1)
  assert.equal(runChecks(only(s))[0].ok, true)
})

test('noting the same launch twice keeps what the first note learned', () => {
  let s = noteLaunch(createState(), { toolUseId: TU, fingerprint: 'f1', at: 1 })
  s = noteGateRecord(s, TU, gate())
  s = noteLaunchResult(s, { toolUseId: TU, runId: RUN, at: 2 })
  const again = noteLaunch(s, { toolUseId: TU, fingerprint: 'f1', at: 3 })
  assert.equal(again.launches[TU].gate.decision, 'pass')
  assert.equal(again.launches[TU].pending, false)
  assert.equal(again.launches[TU].at, 1)
})

test('a refused launch is not a run', () => {
  let s = noteLaunch(createState(), { toolUseId: TU, fingerprint: 'f', at: 1 })
  s = noteLaunchResult(s, { toolUseId: TU, isError: true, at: 2 })
  assert.equal(activeRuns(s).length, 0)
  assert.equal(bandView(s), null)
  assert.equal(gateWanted(s, { toolUseId: TU }), null)
  const late = noteSpawn(s, { toolUseId: TU, runId: '', agentId: 'a1', label: 'x', resolvedModel: OPUS, at: 3 })
  assert.equal(only(late).launched, false)
})

test('a launch result without a runId still shows the run', () => {
  let s = noteLaunch(createState(), { toolUseId: TU, fingerprint: sha256Hex(SCRIPT), at: 1 })
  s = noteGateRecord(s, TU, gate())
  s = noteLaunchResult(s, { toolUseId: TU, runId: null, taskId: null, at: 2 })
  assert.equal(only(s).key, TU)
  assert.equal(runChecks(only(s))[0].ok, true)
  assert.equal(runView(only(s)).shortId, 'toolu_')
})

test('steps and completion that arrive before the spawn settles are kept', () => {
  let s = launched()
  s = step(s, 1, OPUS, 'high')
  s = noteAgentDone(s, { agentId: 'a1' })
  assert.equal(runOfAgent(s, 'a1'), null)
  s = spawn(s, 1, 'synth: research legal', OPUS)
  assert.equal(runOfAgent(s, 'a1'), TU)
  assert.equal(only(s).agents[0].done, true)
  assert.deepEqual(only(s).agents[0].sent, [{ model: OPUS, effort: 'high' }])
  assert.equal(reasons(s)[2], 'agent "synth: research legal" sent effort high, the gate approved xhigh')
  assert.deepEqual(s.early, {})
})

test('an agent that finished before its spawn settled is not counted as running', () => {
  const record = gate({ stages: [stage(0, 'design: ${…}', 'opus', 'high')] })
  const run = (early) => {
    let s = launched({ record })
    for (let n = 1; n <= 3; n++) s = spawn(s, n, `design: part ${n}`, OPUS)
    if (early) s = noteAgentDone(s, { agentId: 'a4' })
    return spawn(s, 4, 'design: part 4', OPUS)
  }
  assert.equal(runChecks(only(run(true)))[3].ok, true)
  assert.equal(runChecks(only(run(false)))[3].ok, false)
})

test('noteStep and noteAgentDone return the same state when nothing changes', () => {
  let s = spawn(launched(), 1, 'synth: research legal', OPUS)
  s = step(s, 1, OPUS, 'xhigh')
  assert.equal(step(s, 1, OPUS, 'xhigh'), s)
  s = noteAgentDone(s, { agentId: 'a1' })
  assert.equal(noteAgentDone(s, { agentId: 'a1' }), s)
  assert.equal(noteStep(s, { agentId: '', model: OPUS, effort: 'x' }), s)
})

test('early buffering is bounded', () => {
  let s = createState()
  for (let n = 0; n < 100; n++) s = noteStep(s, { agentId: `x${n}`, model: OPUS, effort: 'high' })
  assert.equal(Object.keys(s.early).length, 32)
})

test('noteRunEnd removes the run from the active list but evalRecord keeps it with its status', () => {
  let s = compliant()
  assert.equal(activeRuns(s).length, 1)
  s = noteRunEnd(s, { toolUseId: TU, status: 'completed', at: 9000 })
  assert.equal(activeRuns(s).length, 0)
  assert.equal(bandView(s), null)
  const rec = evalRecord(s, s.runs[TU])
  assert.equal(rec.status, 'completed')
  assert.equal(rec.ok, true)
  assert.equal(rec.endedAt, '1970-01-01T00:00:09.000Z')
  assert.equal(rec.agents.length, 2)
  assert.equal(rec.agents.every((a) => a.done), true)
  assert.equal(noteRunEnd(s, { toolUseId: TU, status: 'failed', at: 9500 }), s)
})

test('noteRunEnd takes failed and killed, finds the run by task id, and ignores other statuses', () => {
  const s = compliant()
  assert.equal(noteRunEnd(s, { toolUseId: TU, status: 'running' }), s)
  assert.equal(noteRunEnd(s, { toolUseId: 'toolu_other', status: 'completed' }), s)
  assert.equal(noteRunEnd(s, { toolUseId: TU, status: 'killed', at: 1 }).runs[TU].status, 'killed')
  assert.equal(noteRunEnd(s, { toolUseId: null, taskId: 'w1', status: 'failed', at: 1 }).runs[TU].status, 'failed')
})

test('a red run keeps its failure in the record after it ends', () => {
  let s = spawn(launched(), 1, 'build: surprise', OPUS)
  s = noteRunEnd(s, { toolUseId: TU, status: 'killed', at: 5 })
  const rec = evalRecord(s, s.runs[TU])
  assert.equal(rec.ok, false)
  assert.equal(rec.status, 'killed')
  assert.deepEqual(rec.failures, ['agent "build: surprise" matches no approved stage'])
  assert.equal(rec.checks[1].ok, false)
  assert.equal(JSON.stringify(rec).includes('undefined'), false)
})

test('endAllRuns ends every running run and leaves ended ones alone', () => {
  let s = compliant()
  s = noteLaunch(s, { toolUseId: 'toolu_02B', fingerprint: 'f', at: 10 })
  s = noteLaunchResult(s, { toolUseId: 'toolu_02B', runId: 'wf_2', at: 11 })
  s = noteRunEnd(s, { toolUseId: TU, status: 'completed', at: 12 })
  const all = endAllRuns(s, 'cleared', 20)
  assert.equal(activeRuns(all).length, 0)
  assert.equal(all.runs[TU].status, 'completed')
  assert.equal(all.runs.toolu_02B.status, 'cleared')
  assert.equal(endAllRuns(all, 'cleared', 30), all)
})

test('bandView is null with no active run and red when any active run is red', () => {
  assert.equal(bandView(createState()), null)
  let s = compliant()
  assert.deepEqual(bandView(s), { color: 'green', running: 1, red: 0 })
  s = noteLaunch(s, { toolUseId: 'toolu_02B', fingerprint: 'f', at: 10 })
  s = noteLaunchResult(s, { toolUseId: 'toolu_02B', runId: 'wf_2', at: 11 })
  assert.deepEqual(bandView(s), { color: 'red', running: 2, red: 1 })
  assert.equal(bandText(bandView(s)), '2 running  1 red')
  assert.equal(bandText({ color: 'green', running: 3, red: 0 }), '3 running')
  s = noteRunEnd(s, { toolUseId: 'toolu_02B', status: 'completed', at: 12 })
  assert.deepEqual(bandView(s), { color: 'green', running: 1, red: 0 })
})

test('activeRuns lists runs in launch order', () => {
  let s = createState()
  for (const [id, at] of [['toolu_b', 20], ['toolu_a', 10], ['toolu_c', 30]]) {
    s = noteLaunch(s, { toolUseId: id, fingerprint: 'f', at })
    s = noteLaunchResult(s, { toolUseId: id, runId: `wf_${id}`, at })
  }
  assert.deepEqual(activeRuns(s).map((r) => r.key), ['toolu_a', 'toolu_b', 'toolu_c'])
})

test('a resumed run with the same runId resolves to the active run', () => {
  let s = compliant()
  s = noteRunEnd(s, { toolUseId: TU, status: 'killed', at: 5 })
  s = noteLaunch(s, { toolUseId: 'toolu_02B', fingerprint: sha256Hex(SCRIPT), at: 10 })
  s = noteGateRecord(s, 'toolu_02B', gate({ tool_use_id: 'toolu_02B' }))
  s = noteLaunchResult(s, { toolUseId: 'toolu_02B', runId: RUN, at: 11 })
  assert.equal(findRunKey(s, { toolUseId: '', runId: RUN }), 'toolu_02B')
  s = noteSpawn(s, { toolUseId: '', runId: RUN, agentId: 'a9', label: 'synth: research legal', resolvedModel: OPUS, at: 12 })
  assert.equal(s.runs.toolu_02B.agents.length, 1)
  assert.equal(s.runs[TU].agents.length, 2)
})

test('gateWanted names the launch to read until a record is in or the tries run out', () => {
  let s = noteLaunch(createState(), { toolUseId: TU, fingerprint: 'f', at: 1 })
  assert.equal(gateWanted(s, { toolUseId: TU }), TU)
  assert.equal(gateWanted(s, { toolUseId: 'toolu_other' }), null)
  assert.equal(gateWanted(s, { toolUseId: '', runId: '' }), null)
  for (let i = 0; i < 5; i++) s = noteGateRecord(s, TU, null)
  assert.equal(gateWanted(s, { toolUseId: TU }), null)
  const ok = noteGateRecord(noteLaunch(createState(), { toolUseId: TU, fingerprint: 'f', at: 1 }), TU, gate())
  assert.equal(gateWanted(ok, { toolUseId: TU }), null)
})

test('a gate record is attached to the run that already exists', () => {
  let s = launched({ record: null })
  assert.equal(reasons(s)[0], 'not approved by the gate')
  s = noteGateRecord(s, TU, gate())
  assert.equal(reasons(s)[0], 'ok')
})

test('state is plain JSON and the note functions never mutate their input', () => {
  const s0 = createState()
  const frozen = JSON.stringify(s0)
  let s = noteLaunch(s0, { toolUseId: TU, fingerprint: 'f', at: 1 })
  assert.equal(JSON.stringify(s0), frozen)
  const steps = [
    (x) => noteGateRecord(x, TU, gate()),
    (x) => noteLaunchResult(x, { toolUseId: TU, runId: RUN, at: 2 }),
    (x) => spawn(x, 1, 'synth: research legal', OPUS),
    (x) => step(x, 1, OPUS, 'xhigh'),
    (x) => noteAgentDone(x, { agentId: 'a1' }),
    (x) => noteRunEnd(x, { toolUseId: TU, status: 'completed', at: 3 })
  ]
  for (const f of steps) {
    const before = JSON.stringify(s)
    const next = f(s)
    assert.equal(JSON.stringify(s), before)
    s = next
  }
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s)
})

test('ended runs and stale launches are pruned', () => {
  let s = createState()
  for (let n = 0; n < 130; n++) {
    const id = `toolu_${n}`
    s = noteLaunch(s, { toolUseId: id, fingerprint: 'f', at: n + 1 })
    s = noteLaunchResult(s, { toolUseId: id, runId: `wf_${n}`, at: n + 1 })
    s = noteRunEnd(s, { toolUseId: id, status: 'completed', at: n + 1 })
  }
  assert.equal(Object.keys(s.runs).length, 20)
  assert.ok(Object.keys(s.launches).length <= 100)
  assert.ok(s.runs.toolu_129)
  assert.equal(s.runs.toolu_0, undefined)
})

test('openRun and closeRun move the pane between its list and a run', () => {
  const s = createState()
  assert.equal(openRun(s, TU).ui.run, TU)
  assert.equal(openRun(openRun(s, TU), TU).ui.run, TU)
  assert.equal(closeRun(openRun(s, TU)).ui.run, null)
  assert.equal(closeRun(s), s)
})

test('parseTaskNotifications reads the end of a run from a notification row', () => {
  const row = [
    '<task-notification>',
    '<task-id>w2taqthv9</task-id>',
    '<tool-use-id>toolu_01QCArUWit3UYPoD5J4PHf13</tool-use-id>',
    '<output-file>/tmp/x.output</output-file>',
    '<status>completed</status>',
    '<summary>Dynamic workflow "lc4" completed</summary>',
    '</task-notification>'
  ].join('\n')
  assert.deepEqual(parseTaskNotifications(row), [{ toolUseId: 'toolu_01QCArUWit3UYPoD5J4PHf13', taskId: 'w2taqthv9', status: 'completed' }])
  assert.deepEqual(parseTaskNotifications(`${row}\n${row.replace('completed', 'KILLED').replace('toolu_01QCArUWit3UYPoD5J4PHf13', 'toolu_2')}`).map((n) => [n.toolUseId, n.status]), [
    ['toolu_01QCArUWit3UYPoD5J4PHf13', 'completed'],
    ['toolu_2', 'killed']
  ])
  assert.deepEqual(parseTaskNotifications('<task-notification>\nflightdeck: its hook was skipped.\n</task-notification>'), [])
  assert.deepEqual(parseTaskNotifications('no notification here'), [])
  assert.deepEqual(parseTaskNotifications(undefined), [])
  assert.deepEqual(parseTaskNotifications('<task-notification><tool-use-id>toolu_3</tool-use-id><status>failed</status>'), [{ toolUseId: 'toolu_3', taskId: null, status: 'failed' }])
})

test('a notification drives noteRunEnd; an unknown launch changes nothing', () => {
  let s = compliant()
  const [n] = parseTaskNotifications(`<task-notification><task-id>w1</task-id><tool-use-id>${TU}</tool-use-id><status>completed</status></task-notification>`)
  s = noteRunEnd(s, { ...n, at: 77 })
  assert.equal(s.runs[TU].status, 'completed')
  const t = compliant()
  const [m] = parseTaskNotifications('<task-notification><tool-use-id>toolu_nope</tool-use-id><status>completed</status></task-notification>')
  assert.equal(noteRunEnd(t, { ...m, at: 1 }), t)
})

test('the eval record path sits next to the gate record for the same launch', () => {
  const gatePath = recordPath('/h/.claude', 'sess-1', TU, 'gate')
  const evalPath = recordPath('/h/.claude', 'sess-1', only(compliant()).key, 'eval')
  assert.equal(gatePath, `/h/.claude/ultraguard/sessions/sess-1/${TU}.gate.json`)
  assert.equal(evalPath, `/h/.claude/ultraguard/sessions/sess-1/${TU}.eval.json`)
  const orphan = noteSpawn(createState(), { toolUseId: '', runId: RUN, agentId: 'a1', label: 'x', resolvedModel: OPUS })
  assert.equal(recordPath('/h/.claude', 'sess-1', only(orphan).key, 'eval'), `/h/.claude/ultraguard/sessions/sess-1/${RUN}.eval.json`)
})

test('runView explains a red agent and a red run', () => {
  const s = spawn(launched({ record: null }), 1, 'synth: research legal', OPUS)
  const v = runView(only(s))
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'not approved by the gate')
  assert.equal(v.checks.map((c) => c.title).join('|'), 'Approved by the gate|Every agent matches the plan|Every request as approved|At most 3 Opus at once')
  assert.equal(v.agents[0].reason, 'no approved plan to compare against')
  assert.equal(v.agents[0].approved, null)
})

const HAIKU = 'claude-haiku-5-5'
const PRICES = loadPrices(JSON.parse(readFileSync(new URL('../data/prices.json', import.meta.url), 'utf8')))
const use = (model, input, output, cacheRead, cacheWrite) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite, model })
const usage = (s, n, effort, u, prices) => noteUsage(s, { agentId: `a${n}`, effort, usage: u, prices })
const lastRun = (s) => Object.values(s.runs)[0]

test('usage is summed per agent and configuration', () => {
  let s = compliant()
  s = usage(s, 2, 'high', use(SONNET, 10, 20, 30, 40))
  s = usage(s, 2, 'high', use(SONNET, 1, 2, 3, 4))
  s = usage(s, 2, 'xhigh', use(SONNET, 5, 5, 5, 5))
  const u = lastRun(s).agents[1].usage
  assert.deepEqual(Object.keys(u).sort(), ['sonnet:high', 'sonnet:xhigh'])
  assert.deepEqual(u['sonnet:high'], { family: 'sonnet', effort: 'high', input: 11, output: 22, cacheRead: 33, cacheWrite: 44, requests: 2 })
  assert.deepEqual(lastRun(s).agents[0].usage, {})
})

test('a request with no response or an unknown model is handled', () => {
  let s = compliant()
  assert.equal(noteUsage(s, { agentId: 'a2', effort: 'high', usage: null }), s)
  s = usage(s, 2, 'high', use('claude-mythos-5-1', 1, 1, 1, 1))
  s = noteUsage(s, { agentId: 'a2', effort: null, usage: { input_tokens: 3, model: SONNET } })
  const u = lastRun(s).agents[1].usage
  assert.deepEqual(Object.keys(u).sort(), ['?:high', 'sonnet:?'])
  assert.equal(u['?:high'].family, null)
  assert.equal(u['sonnet:?'].effort, null)
  assert.equal(u['sonnet:?'].output, 0)
})

test('early usage is kept when the spawn arrives later', () => {
  let s = launched()
  s = usage(s, 1, 'high', use(SONNET, 7, 8, 9, 10))
  assert.equal(s.early.a1.usage['sonnet:high'].output, 8)
  s = spawn(s, 1, 'investigate: map', SONNET)
  assert.deepEqual(s.early, {})
  assert.equal(lastRun(s).agents[0].usage['sonnet:high'].input, 7)
  s = usage(s, 1, 'high', use(SONNET, 1, 1, 1, 1))
  assert.equal(lastRun(s).agents[0].usage['sonnet:high'].input, 8)
})

test('baseline effort is frozen at launch', () => {
  let s = noteMainStep(createState(), { model: OPUS, effort: 'high' })
  s = launched({ from: s })
  s = noteMainStep(s, { model: OPUS, effort: 'xhigh' })
  s = spawn(s, 1, 'investigate: map', SONNET)
  assert.deepEqual(lastRun(s).baseline, { model: OPUS, effort: 'high' })
  assert.deepEqual(s.main, { model: OPUS, effort: 'xhigh' })
})

test('parentModel sets the baseline model once, on the first spawn', () => {
  let s = launched()
  assert.deepEqual(lastRun(s).baseline, { model: null, effort: null })
  s = spawn(s, 1, 'investigate: map', SONNET, { parentModel: OPUS })
  assert.equal(lastRun(s).baseline.model, OPUS)
  s = spawn(s, 2, 'investigate: map', SONNET, { parentModel: SONNET })
  assert.equal(lastRun(s).baseline.model, OPUS)
})

test('main-loop usage reaches the meter but no agent', () => {
  let s = compliant()
  s = noteUsage(s, { effort: 'high', usage: use(OPUS, 100, 50, 10, 5) })
  assert.deepEqual(s.meter.acc.five_hour.opus, { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 })
  assert.ok(lastRun(s).agents.every((a) => Object.keys(a.usage).length === 0))
  assert.deepEqual(s.early, {})
  s = usage(s, 2, 'high', use(SONNET, 1, 1, 1, 1))
  assert.equal(s.meter.acc.seven_day.sonnet.input, 1)
})

test('a meter reading is kept in the eval state', () => {
  const s = noteMeterReading(createState(), [{ kind: 'five_hour', percentUsed: 4, resetsAt: 'r' }], 5, PRICES)
  assert.equal(s.meter.subscription, true)
  assert.equal(s.meter.last.five_hour.pct, 4)
})

test('haiku requests above the long-prompt threshold are kept apart', () => {
  let s = compliant()
  s = usage(s, 2, 'xhigh', use(HAIKU, 50000, 10, 0, 0), PRICES)
  s = usage(s, 2, 'xhigh', use(HAIKU, 120000, 10, 0, 0), PRICES)
  const pieces = agentPieces(lastRun(s)).find((a) => a.agentId === 'a2').pieces
  assert.deepEqual(pieces.map((p) => [p.family, p.effort, p.input, p.long === true]).sort(), [
    ['haiku', 'xhigh', 120000, true],
    ['haiku', 'xhigh', 50000, false]
  ])
})

test('agentPieces lists every agent, with no pieces for an agent that sent nothing', () => {
  let s = usage(compliant(), 2, 'high', use(SONNET, 1, 2, 3, 4))
  const all = agentPieces(lastRun(s))
  assert.deepEqual(all.map((a) => a.agentId), ['a1', 'a2'])
  assert.deepEqual(all[0].pieces, [])
  assert.deepEqual(all[1].pieces, [{ family: 'sonnet', effort: 'high', input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }])
})

function twoEnded() {
  let s = createState()
  const add = (n, name) => {
    s = noteLaunch(s, { toolUseId: `toolu_0${n}`, fingerprint: 'f', at: 100 * n })
    s = noteLaunchResult(s, { toolUseId: `toolu_0${n}`, taskId: `w${n}`, runId: `wf_run${n}`, name, at: 100 * n })
  }
  add(1, 'one')
  add(2, 'two')
  add(3, 'three')
  s = noteRunEnd(s, { toolUseId: 'toolu_01', status: 'completed', at: 5000 })
  s = noteRunEnd(s, { toolUseId: 'toolu_02', status: 'failed', at: 9000 })
  return endAllRuns(s, 'cleared', 12000)
}

test('finished runs are listed newest first and cleared runs are not', () => {
  const s = twoEnded()
  assert.deepEqual(finishedRuns(s).map((r) => r.name), ['two', 'one'])
  assert.deepEqual(activeRuns(s), [])
})

test('runView carries the saved estimate and the clock a run ended', () => {
  let s = twoEnded()
  assert.equal(runView(s.runs.toolu_01).saved, null)
  assert.match(runView(s.runs.toolu_01).endedClock, /^\d\d:\d\d$/)
  const d = new Date(5000)
  assert.equal(runView(s.runs.toolu_01).endedClock, `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
  s = noteSaved(s, 'toolu_01', { status: 'none' })
  assert.deepEqual(runView(s.runs.toolu_01).saved, { status: 'none' })
  assert.equal(noteSaved(s, 'nope', {}), s)
  assert.equal(runView(only(compliant())).endedClock, null)
})

test('the eval record carries the savings block', () => {
  let s = noteMainStep(createState(), { model: OPUS, effort: 'high' })
  s = launched({ from: s })
  s = spawn(s, 1, 'investigate: map', SONNET, { parentModel: OPUS })
  s = usage(s, 1, 'high', use(SONNET, 1, 2, 3, 4))
  s = noteSaved(s, TU, { status: 'estimated' })
  const rec = evalRecord(s, lastRun(s))
  assert.deepEqual(rec.savings.baseline, { model: OPUS, effort: 'high' })
  assert.deepEqual(rec.savings.saved, { status: 'estimated' })
  assert.equal(typeof rec.savings.seed, 'number')
  assert.deepEqual(rec.savings.usage, [{ agent_id: 'a1', usage: [{ family: 'sonnet', effort: 'high', input: 1, output: 2, cacheRead: 3, cacheWrite: 4, requests: 1 }] }])
})

test('stored meter values are merged into the eval state', () => {
  const value = { v: 1, five_hour: [{ d: 1, u: 1, c: 0, at: 5 }], seven_day: [] }
  const s = noteStored(createState(), { 'meter:other': value, 'meter:mine': value }, 'meter:mine')
  assert.equal(s.meter.others.five_hour.length, 1)
  assert.equal(s.meter.mine.five_hour.length, 1)
})

test('usage of an unpriced model reaches the meter under an unknown family', () => {
  const s = noteUsage(compliant(), { effort: 'high', usage: use('claude-mythos-5-1', 1, 2, 3, 4) })
  assert.deepEqual(Object.keys(s.meter.acc.five_hour), ['?'])
})

const withStopped = () => {
  let s = twoEnded()
  const add = (n, name) => {
    s = noteLaunch(s, { toolUseId: `toolu_0${n}`, fingerprint: 'f', at: 100 * n })
    s = noteLaunchResult(s, { toolUseId: `toolu_0${n}`, taskId: `w${n}`, runId: `wf_run${n}`, name, at: 100 * n })
  }
  add(4, 'four')
  add(5, 'five')
  add(6, 'six')
  s = noteRunEnd(s, { toolUseId: null, taskId: 'w4', status: STOPPED, at: 13000 })
  s = noteRunEnd(s, { toolUseId: null, taskId: 'w5', status: STOPPED, at: 15000 })
  return s
}

test('a stopped run ends with the status the host notification uses', () => {
  assert.equal(STOPPED, 'killed')
  const s = withStopped()
  assert.equal(s.runs.toolu_04.status, 'killed')
  assert.equal(s.runs.toolu_04.endedAt, 13000)
  assert.deepEqual(activeRuns(s).map((r) => r.name), ['six'])
})

test('stopped runs are listed apart from the finished ones, newest first', () => {
  const s = withStopped()
  assert.deepEqual(stoppedRuns(s).map((r) => r.name), ['five', 'four'])
  assert.deepEqual(finishedRuns(s).map((r) => r.name), ['two', 'one'])
  assert.deepEqual(stoppedRuns(twoEnded()), [])
  assert.deepEqual(stoppedRuns(hideFinished(s)), [])
})

test('a stopped run keeps its status when a later notice ends it again', () => {
  const s = withStopped()
  assert.equal(noteRunEnd(s, { toolUseId: 'toolu_04', taskId: 'w4', status: 'completed', at: 20000 }), s)
})

test('runView gives the clock a run was stopped, and only for a stopped run', () => {
  const s = withStopped()
  const d = new Date(13000)
  assert.equal(runView(s.runs.toolu_04).stoppedClock, `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
  assert.equal(runView(s.runs.toolu_01).stoppedClock, null)
  assert.equal(runView(s.runs.toolu_06).stoppedClock, null)
})

test('the toast of a stopped run says it stopped and what it saved', () => {
  const s = noteRunEnd(compliant(), { toolUseId: null, taskId: 'w1', status: STOPPED, at: 3000 })
  const limit = { mid: 1.43, lo: 0.6, hi: 2.2, pm: 0.8 }
  const estimated = { status: 'estimated', running: false, subscription: true, dollars: { mid: 2.32, lo: 1, hi: 3, pm: 1 }, limits: { five_hour: limit, seven_day: null, readings: { five_hour: 6, seven_day: 6 } } }
  const toast = (saved, from = s) => toastText(runView(noteSaved(from, TU, saved).runs[TU]))
  assert.equal(toast(estimated), 'ultraguard: research stopped and saved about 1.4% of your 5-hour limit')
  assert.equal(toast({ ...estimated, limits: null, subscription: false }), 'ultraguard: research stopped and saved about $2.32 off your API bill')
  assert.equal(toast({ status: 'none' }), 'ultraguard: research stopped')
  assert.equal(toast({ status: 'unknown' }), 'ultraguard: research stopped')
  assert.equal(toastText(runView(s.runs[TU])), 'ultraguard: research stopped')
  assert.equal(toastText(runView(withStopped().runs.toolu_04)), 'ultraguard: four stopped, but not approved by the gate')
  const done = noteRunEnd(compliant(), { toolUseId: TU, status: 'completed', at: 3000 })
  assert.equal(toast(estimated, done), 'ultraguard: research finished as approved and saved about 1.4% of your 5-hour limit')
})

test('a clear hides the finished runs too', () => {
  const s = hideFinished(twoEnded())
  assert.deepEqual(finishedRuns(s), [])
  assert.equal(finishedRuns(twoEnded()).length, 2)
  const live = compliant()
  assert.equal(hideFinished(live), live)
})

const withPhase = (st, phase) => ({ ...st, phase })
const phasedGate = (over = {}) =>
  gate({
    phases: ['Collect', 'Investigate', 'Decide'],
    stages: [
      withPhase(stage(0, 'grunt: facts ${…}', 'haiku', 'xhigh'), 'Collect'),
      withPhase(stage(1, 'investigate: map', 'sonnet', 'high'), 'Investigate'),
      withPhase(stage(2, 'decide: pick', 'opus', 'high'), 'Decide')
    ],
    ...over
  })
const done = (s, n) => noteAgentDone(s, { agentId: `a${n}` })
const phasesOf = (s) => runView(only(s)).phases

function phasedRun(record = phasedGate()) {
  let s = launched({ record })
  s = spawn(s, 1, 'grunt: facts a', HAIKU)
  s = spawn(s, 2, 'grunt: facts b', HAIKU)
  return s
}

test('a gate without phases gives a flat run', () => {
  assert.equal(phasesOf(compliant()), null)
  assert.equal(phasesOf(launched({ record: null })), null)
})

test('phases come in declared order, with the agents the plan places in each', () => {
  let s = phasedRun()
  s = spawn(s, 3, 'investigate: map', SONNET)
  const phases = phasesOf(s)
  assert.deepEqual(phases.map((p) => [p.title, p.total, p.agentIds]), [
    ['Collect', 2, ['a1', 'a2']],
    ['Investigate', 1, ['a3']],
    ['Decide', 0, []]
  ])
  assert.deepEqual(phases[0].counts, { opus: 0, sonnet: 0, haiku: 2 })
  assert.deepEqual(runView(only(s)).agents.map((a) => a.phase), ['Collect', 'Collect', 'Investigate'])
})

test('stage phases not declared in meta come after the declared ones', () => {
  const record = phasedGate({ phases: ['Decide'] })
  const s = spawn(phasedRun(record), 3, 'investigate: map', SONNET)
  assert.deepEqual(phasesOf(s).map((p) => p.title), ['Decide', 'Collect', 'Investigate'])
})

test('a phase is running until its agents are done and a later phase has started', () => {
  let s = phasedRun()
  assert.deepEqual(phasesOf(s).map((p) => p.state), ['running', 'not started', 'not started'])
  s = done(done(s, 1), 2)
  assert.deepEqual(phasesOf(s).map((p) => [p.state, p.done]), [['running', 2], ['not started', 0], ['not started', 0]])
  s = spawn(s, 3, 'investigate: map', SONNET)
  assert.deepEqual(phasesOf(s).map((p) => p.state), ['done', 'running', 'not started'])
})

test('when the run ends every phase is done or did not run', () => {
  let s = spawn(phasedRun(), 3, 'investigate: map', SONNET)
  s = noteRunEnd(s, { toolUseId: TU, taskId: 'w1', status: 'completed', at: 3000 })
  const run = finishedRuns(s)[0]
  assert.deepEqual(runView(run).phases.map((p) => p.state), ['done', 'done', 'did not run'])
})

test('an agent the plan cannot place goes to a last unknown group', () => {
  const record = phasedGate({
    stages: [
      withPhase(stage(0, 'grunt: facts ${…}', 'haiku', 'xhigh'), 'Collect'),
      withPhase(stage(1, 'grunt: facts ${…}', 'haiku', 'xhigh'), 'Decide'),
      withPhase(stage(2, 'investigate: map', 'sonnet', 'high'), 'Investigate')
    ]
  })
  const s = spawn(spawn(phasedRun(record), 3, 'investigate: map', SONNET), 4, 'investigate: map', SONNET)
  const phases = phasesOf(s)
  assert.equal(phases.at(-1).key, UNKNOWN_PHASE)
  assert.equal(phases.at(-1).title, 'phase unknown')
  assert.deepEqual(phases.at(-1).agentIds, ['a1', 'a2'])
  assert.deepEqual(phases.find((p) => p.title === 'Investigate').agentIds, ['a3', 'a4'])
})

test('an ambiguous label resolves by the model the agent ran on', () => {
  const record = phasedGate({
    stages: [
      withPhase(stage(0, 'grunt: facts ${…}', 'haiku', 'xhigh'), 'Collect'),
      withPhase(stage(1, 'grunt: facts ${…}', 'sonnet', 'high'), 'Decide')
    ]
  })
  const s = spawn(spawn(launched({ record }), 1, 'grunt: facts a', HAIKU), 2, 'grunt: facts b', SONNET)
  assert.deepEqual(runView(only(s)).agents.map((a) => a.phase), ['Collect', 'Decide'])
})

test('a stage with no phase in a phased plan puts its agents in the unknown group', () => {
  const record = phasedGate({
    stages: [stage(0, 'grunt: facts ${…}', 'haiku', 'xhigh'), withPhase(stage(1, 'investigate: map', 'sonnet', 'high'), 'Investigate')]
  })
  const s = spawn(phasedRun(record), 3, 'investigate: map', SONNET)
  assert.deepEqual(phasesOf(s).map((p) => [p.key === UNKNOWN_PHASE ? 'unknown' : p.title, p.total]), [['Collect', 0], ['Investigate', 1], ['Decide', 0], ['unknown', 2]])
})

test('a red agent makes its phase red and counts it', () => {
  let s = phasedRun()
  s = spawn(s, 3, 'investigate: map', OPUS)
  const phases = phasesOf(s)
  const bad = phases.find((p) => p.title === 'Investigate')
  assert.deepEqual([bad.ok, bad.red, bad.open], [false, 1, false])
  assert.equal(phases[0].ok, true)
  assert.match(bad.agents[0].reason, /ran on opus, the gate approved sonnet/)
})

test('every phase starts collapsed, a red one and a running one included', () => {
  let few = phasedRun()
  few = done(done(spawn(few, 3, 'investigate: map', OPUS), 1), 2)
  assert.deepEqual(phasesOf(few).map((p) => [p.state, p.red, p.open]), [['done', 0, false], ['running', 1, false], ['not started', 0, false]])
  let many = launched({ record: phasedGate() })
  for (let n = 1; n <= 13; n++) many = spawn(many, n, `grunt: facts ${n}`, HAIKU)
  for (let n = 1; n <= 13; n++) many = done(many, n)
  many = spawn(many, 14, 'investigate: map', SONNET)
  assert.deepEqual(phasesOf(many).map((p) => [p.state, p.open]), [['done', false], ['running', false], ['not started', false]])
  const ended = noteRunEnd(many, { toolUseId: TU, taskId: 'w1', status: 'completed', at: 3000 })
  assert.ok(runView(finishedRuns(ended)[0]).phases.every((p) => p.open === false))
})

test('a toggle beats the default and survives a redraw; opening another run resets it', () => {
  const s = done(done(phasedRun(), 1), 2)
  const first = phasesOf(s)[0]
  assert.equal(phaseOpen(first, undefined), false)
  assert.equal(phaseOpen(first, {}), false)
  const opened = setFolds(openRun(s, TU), [first.key], false)
  assert.equal(phaseOpen(first, opened.ui.folds), true)
  assert.equal(setFolds(opened, [first.key], false), opened)
  const folded = setFolds(opened, [first.key], true)
  assert.equal(phaseOpen(first, folded.ui.folds), false)
  const all = setFolds(folded, ['Investigate', 'Decide'], false)
  assert.deepEqual(all.ui.folds, { Collect: true, Investigate: false, Decide: false })
  assert.equal(phaseOpen(first, all.ui.folds), false)
  assert.deepEqual(openRun(all, 'other').ui, { run: 'other', folds: {} })
  assert.equal(openRun(all, TU).ui.run, TU)
  assert.deepEqual(closeRun(all).ui, { run: null, folds: {} })
  assert.equal(phaseOpen({ key: 'x', open: false }, null), false)
})

test('state saved before folds existed still opens, folds and closes', () => {
  const old = { ...createState(), ui: { run: null } }
  const opened = openRun(old, TU)
  assert.deepEqual(opened.ui, { run: TU, folds: {} })
  assert.deepEqual(setFolds(old, ['a'], true).ui.folds, { a: true })
})

test('the gate record keeps only text phases', () => {
  const record = gate({
    phases: ['A', 'A', '', 7, null, 'B'],
    stages: [{ ...stage(0, 'investigate: map', 'sonnet', 'high'), phase: 7 }, { ...stage(1, 'synth: x', 'opus', 'high'), phase: 'A' }]
  })
  const run = only(launched({ record }))
  assert.deepEqual(run.gate.phases, ['A', 'B'])
  assert.deepEqual(run.gate.stages.map((s) => s.phase), [null, 'A'])
  const older = gate()
  delete older.phases
  assert.deepEqual(only(launched({ record: older })).gate.phases, [])
  assert.equal(phasesOf(launched({ record: older })), null)
})

test('the eval record names each agent phase and lists the phases', () => {
  const s = spawn(done(done(phasedRun(), 1), 2), 3, 'investigate: map', SONNET)
  const rec = evalRecord(s, only(s))
  assert.deepEqual(rec.agents.map((a) => a.phase), ['Collect', 'Collect', 'Investigate'])
  assert.deepEqual(rec.phases, [
    { title: 'Collect', state: 'done', agents: ['a1', 'a2'] },
    { title: 'Investigate', state: 'running', agents: ['a3'] },
    { title: 'Decide', state: 'not started', agents: [] }
  ])
  assert.equal(evalRecord(compliant(), only(compliant())).phases, null)
})

test('the focused element is kept in the ui state, and the same one is not a change', () => {
  const s = compliant()
  assert.equal(s.ui.focus ?? null, null)
  const focused = noteFocus(s, 'run:abc')
  assert.equal(focused.ui.focus, 'run:abc')
  assert.equal(noteFocus(focused, 'run:abc'), focused)
  assert.equal(noteFocus(focused, null).ui.focus, null)
  assert.equal(noteFocus(s, null), s)
  assert.equal(noteFocus(focused, 'run:abc').ui.run, focused.ui.run)
})

const DAY_MS = 24 * 3600 * 1000
const tallyAt = (...ats) => ({ v: 1, runs: Object.fromEntries(ats.map((at, i) => [`r${i}`, { key: `r${i}`, status: 'completed', baseline: null, agents: [], windows: { five_hour: null, seven_day: null }, at }])) })

test('a stored tally is used only when it is a version 1 tally with a runs map', () => {
  const good = tallyAt(5)
  assert.equal(storedTally(good), good)
  assert.equal(storedTally({ v: 1, runs: {}, overall: { status: 'unknown', count: 0 } })?.v, 1)
  for (const bad of [undefined, null, 7, 'x', [], { v: 2, runs: {} }, { v: 1 }, { v: 1, runs: null }, { v: 1, runs: [] }]) assert.equal(storedTally(bad), null)
})

test('the tally keys older than 30 days are stale, never the own key and never a key with a recent run', () => {
  const now = 100 * DAY_MS
  const own = `${TALLY_PREFIX}sess-1`
  const stored = {
    [own]: tallyAt(1000),
    [`${TALLY_PREFIX}ancient`]: tallyAt(1000, now - 31 * DAY_MS),
    [`${TALLY_PREFIX}recent`]: tallyAt(1000, now - 29 * DAY_MS),
    [`${TALLY_PREFIX}empty`]: tallyAt(),
    [`${TALLY_PREFIX}broken`]: { v: 1, runs: 'x' },
    'meter:old': { v: 1, five_hour: [], seven_day: [] }
  }
  assert.deepEqual(staleTallies(stored, own, now).sort(), [`${TALLY_PREFIX}ancient`, `${TALLY_PREFIX}broken`, `${TALLY_PREFIX}empty`])
  assert.deepEqual(staleTallies(undefined, own, now), [])
  assert.equal(TALLY_PREFIX, 'tally:')
})

test('the store keeps the tallies of the 3 newest other sessions, never the own key', () => {
  const now = 100 * DAY_MS
  const own = `${TALLY_PREFIX}sess-1`
  const stored = { [own]: tallyAt(1000, now - 9 * DAY_MS) }
  for (let i = 1; i <= 5; i++) stored[`${TALLY_PREFIX}s${i}`] = tallyAt(1000, now - i * DAY_MS)
  assert.deepEqual(staleTallies(stored, own, now).sort(), [`${TALLY_PREFIX}s4`, `${TALLY_PREFIX}s5`])
})

test('a tally loaded from the store has no running runs left, and its overall is not so far', () => {
  const t = tallyAt(5, 6)
  t.runs.r1.status = 'running'
  t.overall = { status: 'unknown', count: 2, running: true }
  const settled = settledTally(t)
  assert.deepEqual(Object.values(settled.runs).map((r) => r.status), ['completed', 'cleared'])
  assert.equal(settled.overall.running, false)
  assert.equal(t.runs.r1.status, 'running')
  assert.equal(settledTally(null), null)
})
