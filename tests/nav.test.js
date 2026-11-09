import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sha256Hex } from '../src/fingerprint.mjs'
import { STOPPED, closeRun, createState, noteLaunch, noteLaunchResult, noteRunEnd, openRun } from '../src/eval.mjs'
import { arrowOf, boxKeyOf, paneNav, stepFocus } from '../src/nav.mjs'

const SCRIPT = "await agent('x', { label: 'investigate: map', model: 'sonnet', effort: 'high' })\n"

function run(state, id, at) {
  let s = noteLaunch(state, { toolUseId: id, fingerprint: sha256Hex(SCRIPT), at })
  return noteLaunchResult(s, { toolUseId: id, isError: false, taskId: `t-${id}`, runId: `wf_${id}`, name: id, at: at + 1 })
}

const ended = (s, id, at) => noteRunEnd(s, { toolUseId: id, taskId: `t-${id}`, status: 'completed', at })

test('the list reaches every run, running ones first, and rests on the first running one', () => {
  let s = run(createState(), 'toolu_a', 1000)
  s = run(s, 'toolu_b', 2000)
  s = run(s, 'toolu_c', 3000)
  s = ended(s, 'toolu_a', 4000)
  const nav = paneNav(s)
  assert.deepEqual(nav.reachable, ['run:toolu_b', 'run:toolu_c', 'run:toolu_a'])
  assert.equal(nav.resting, 'run:toolu_b')
})

test('a stopped run stays open, and the list stops are not changed by it', () => {
  let s = run(createState(), 'toolu_a', 1000)
  s = run(s, 'toolu_b', 2000)
  s = openRun(s, 'toolu_a')
  s = noteRunEnd(s, { toolUseId: null, taskId: 't-toolu_a', status: STOPPED, at: 3000 })
  assert.deepEqual(paneNav(s), { reachable: ['back'], resting: 'back' })
  assert.deepEqual(paneNav(closeRun(s)), { reachable: ['run:toolu_b'], resting: 'run:toolu_b' })
})

test('an empty list reaches nothing and rests on nothing', () => {
  assert.deepEqual(paneNav(createState()), { reachable: [], resting: null })
})

test('a run with no phases reaches only the back button', () => {
  const s = openRun(run(createState(), 'toolu_a', 1000), 'toolu_a')
  assert.deepEqual(paneNav(s), { reachable: ['back'], resting: 'back' })
})

test('stepFocus moves one stop at a time from the focused one, or from the resting one when nothing is focused', () => {
  const nav = { reachable: ['run:a', 'run:b', 'run:c'], resting: 'run:a' }
  assert.equal(stepFocus(nav, 'run:a', 1), 'run:b')
  assert.equal(stepFocus(nav, 'run:b', 1), 'run:c')
  assert.equal(stepFocus(nav, 'run:c', -1), 'run:b')
  assert.equal(stepFocus(nav, null, 1), 'run:b')
  assert.equal(stepFocus(nav, 'gone', 1), 'run:b')
})

test('stepFocus stops at the ends so the arrow can scroll instead', () => {
  const nav = { reachable: ['run:a', 'run:b'], resting: 'run:a' }
  assert.equal(stepFocus(nav, 'run:a', -1), null)
  assert.equal(stepFocus(nav, 'run:b', 1), null)
})

test('stepFocus with no resting stop starts at the first one going down and nowhere going up', () => {
  const nav = { reachable: ['run:a', 'run:b'], resting: null }
  assert.equal(stepFocus(nav, null, 1), 'run:a')
  assert.equal(stepFocus(nav, null, -1), null)
  assert.equal(stepFocus({ reachable: [], resting: null }, null, 1), null)
})

test('only a one-row move by the person without a pointer is an arrow', () => {
  const person = { origin: { kind: 'person' }, bodyRows: 20 }
  assert.equal(arrowOf({ ...person, by: 1 }), 1)
  assert.equal(arrowOf({ ...person, by: -1 }), -1)
  assert.equal(arrowOf({ ...person, by: 1, pointer: { row: 3, column: 4 } }), 0)
  assert.equal(arrowOf({ ...person, by: 20 }), 0)
  assert.equal(arrowOf({ ...person, by: -20 }), 0)
  assert.equal(arrowOf({ ...person, by: 0 }), 0)
  assert.equal(arrowOf({ origin: { kind: 'plugin', name: 'ultraguard' }, bodyRows: 20, by: 1 }), 0)
  assert.equal(arrowOf({ ...person, bodyRows: 1, by: 1 }), 0)
})

test('a focus key maps to the box the outline is drawn around', () => {
  assert.equal(boxKeyOf('run:toolu_a'), 'box:toolu_a')
  assert.equal(boxKeyOf('phase:Collect'), 'box:phase:Collect')
  assert.equal(boxKeyOf('all'), 'box:all')
  assert.equal(boxKeyOf('back'), 'box:back')
})
