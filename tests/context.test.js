import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WINDOW_TRIES, createContext, compactWindowOf, noteContext, noteBreakdown, contextFill } from '../src/context.mjs'

const W = 1_000_000
const breakdown = (rawMaxTokens, isAutoCompactEnabled = true) => ({ rawMaxTokens, isAutoCompactEnabled })

test('a fresh context knows nothing', () => {
  assert.deepEqual(createContext(), { tokens: null, window: 0, compact: null, asked: 0, misses: 0 })
  assert.equal(WINDOW_TRIES, 3)
})

test('compactWindowOf is the compaction window only when it is on and smaller than the window', () => {
  assert.equal(compactWindowOf(breakdown(200_000), W), 200_000)
  assert.equal(compactWindowOf(breakdown(200_000, false), W), null)
  assert.equal(compactWindowOf(breakdown(W), W), null)
  assert.equal(compactWindowOf(breakdown(2 * W), W), null)
  assert.equal(compactWindowOf(breakdown(0), W), null)
  assert.equal(compactWindowOf(breakdown(-5), W), null)
  assert.equal(compactWindowOf(breakdown(NaN), W), null)
  assert.equal(compactWindowOf({ rawMaxTokens: 200_000 }, W), null)
  assert.equal(compactWindowOf(null, W), null)
  assert.equal(compactWindowOf(undefined, W), null)
})

test('the first measurement records the tokens and claims the read', () => {
  const { state, ask } = noteContext(createContext(), { tokens: 5000, window: W, percent: 1 })
  assert.equal(ask, true)
  assert.deepEqual(state, { tokens: 5000, window: W, compact: null, asked: W, misses: 0 })
})

test('tokens are null after a fresh session or a compaction', () => {
  const { state } = noteContext(createContext(), { window: W })
  assert.equal(state.tokens, null)
  const again = noteContext(state, { tokens: 7000, window: W }).state
  assert.equal(again.tokens, 7000)
  assert.equal(noteContext(again, { window: W }).state.tokens, null)
  assert.equal(noteContext(again, { tokens: NaN, window: W }).state.tokens, null)
  assert.equal(noteContext(again, { tokens: '5', window: W }).state.tokens, null)
})

test('the same window is not claimed twice', () => {
  const first = noteContext(createContext(), { tokens: 1, window: W })
  const second = noteContext(first.state, { tokens: 2, window: W })
  assert.equal(second.ask, false)
  assert.equal(second.state.tokens, 2)
  assert.equal(second.state.asked, W)
})

test('an unchanged state comes back as the same object', () => {
  const first = noteContext(createContext(), { tokens: 1, window: W }).state
  const second = noteContext(first, { tokens: 1, window: W })
  assert.equal(second.ask, false)
  assert.equal(second.state, first)
  const empty = noteContext(createContext(), { window: 0 })
  assert.equal(empty.ask, false)
})

test('a window that is not a positive number leaves the state alone', () => {
  const state = noteContext(createContext(), { tokens: 1, window: W }).state
  for (const window of [0, -1, NaN, Infinity, '1000', null, undefined]) {
    const r = noteContext(state, { tokens: 9, window })
    assert.equal(r.state, state)
    assert.equal(r.ask, false)
  }
  assert.equal(noteContext(state, undefined).state, state)
  assert.equal(noteContext(state, null).ask, false)
})

test('a breakdown with a smaller compaction window is kept and ends the asking', () => {
  const claimed = noteContext(createContext(), { tokens: 1, window: W }).state
  const done = noteBreakdown(claimed, W, breakdown(200_000))
  assert.equal(done.compact, 200_000)
  assert.equal(done.misses, 0)
  assert.equal(done.asked, W)
  assert.equal(noteContext(done, { tokens: 1, window: W }).ask, false)
})

test('a breakdown without a smaller compaction window keeps the full window', () => {
  const claimed = noteContext(createContext(), { tokens: 1, window: W }).state
  const done = noteBreakdown(claimed, W, breakdown(200_000, false))
  assert.equal(done.compact, null)
  assert.equal(done.asked, W)
})

test('three misses and the window is no longer asked for', () => {
  let state = createContext()
  for (let i = 1; i <= WINDOW_TRIES; i++) {
    const r = noteContext(state, { tokens: i, window: W })
    assert.equal(r.ask, true)
    state = noteBreakdown(r.state, W, undefined)
    assert.equal(state.misses, i)
    assert.equal(state.asked, 0)
    assert.equal(state.compact, null)
  }
  const last = noteContext(state, { tokens: 9, window: W })
  assert.equal(last.ask, false)
  assert.equal(last.state.tokens, 9)
  assert.equal(last.state.asked, 0)
})

test('a read that succeeds resets the misses', () => {
  let state = noteContext(createContext(), { window: W }).state
  state = noteBreakdown(state, W, null)
  assert.equal(state.misses, 1)
  const r = noteContext(state, { window: W })
  assert.equal(r.ask, true)
  state = noteBreakdown(r.state, W, breakdown(200_000))
  assert.equal(state.misses, 0)
  assert.equal(state.compact, 200_000)
})

test('a new window forgets the compaction read and the misses', () => {
  let state = noteContext(createContext(), { tokens: 1, window: W }).state
  state = noteBreakdown(state, W, breakdown(200_000))
  const r = noteContext(state, { tokens: 2, window: 200_000 })
  assert.equal(r.ask, true)
  assert.deepEqual(r.state, { tokens: 2, window: 200_000, compact: null, asked: 200_000, misses: 0 })

  let failing = createContext()
  for (let i = 0; i < WINDOW_TRIES; i++) failing = noteBreakdown(noteContext(failing, { window: W }).state, W, undefined)
  assert.equal(noteContext(failing, { window: W }).ask, false)
  const moved = noteContext(failing, { window: 2 * W })
  assert.equal(moved.ask, true)
  assert.equal(moved.state.misses, 0)
})

test('a superseded breakdown is ignored', () => {
  let state = noteContext(createContext(), { tokens: 1, window: W }).state
  state = noteContext(state, { tokens: 1, window: 200_000 }).state
  assert.equal(noteBreakdown(state, W, breakdown(100_000)), state)
  assert.equal(noteBreakdown(state, W, undefined), state)
  const reset = { ...state, asked: 0 }
  assert.equal(noteBreakdown(reset, W, undefined), reset)
})

test('contextFill is null before any window is known', () => {
  assert.equal(contextFill(createContext()), null)
})

test('contextFill measures against the window without a compaction window', () => {
  const state = { ...createContext(), tokens: 250_000, window: W }
  assert.deepEqual(contextFill(state), { tokens: 250_000, window: W, pct: 25 })
})

test('contextFill measures against a smaller compaction window and does not clamp', () => {
  const state = { ...createContext(), tokens: 300_000, window: W, compact: 200_000 }
  assert.deepEqual(contextFill(state), { tokens: 300_000, window: 200_000, pct: 150 })
})

test('contextFill ignores a compaction window that is not smaller than the window', () => {
  for (const compact of [W, 2 * W, 0, -1, null]) {
    const state = { ...createContext(), tokens: 100_000, window: W, compact }
    assert.equal(contextFill(state).window, W)
  }
})

test('contextFill has no percentage while the tokens are unknown', () => {
  const state = { ...createContext(), window: W, compact: 200_000 }
  assert.deepEqual(contextFill(state), { tokens: null, window: 200_000, pct: null })
})
