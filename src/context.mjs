export const WINDOW_TRIES = 3

const num = (x) => typeof x === 'number' && Number.isFinite(x)

export function createContext() {
  return { tokens: null, window: 0, compact: null, asked: 0, misses: 0 }
}

export function compactWindowOf(breakdown, window) {
  if (breakdown === null || typeof breakdown !== 'object') return null
  const raw = breakdown.rawMaxTokens
  return breakdown.isAutoCompactEnabled === true && num(raw) && raw > 0 && raw < window ? raw : null
}

export function noteContext(state, context) {
  const window = context?.window
  if (!num(window) || window <= 0) return { state, ask: false }
  const tokens = num(context.tokens) ? context.tokens : null
  const base = window === state.window ? state : { ...state, window, compact: null, asked: 0, misses: 0 }
  const ask = base.asked !== window && base.misses < WINDOW_TRIES
  const next = ask ? { ...base, asked: window } : base
  if (next.tokens === tokens && next === state) return { state, ask }
  return { state: { ...next, tokens }, ask }
}

export function forgetCompactRead(state) {
  return state.compact === null && state.asked === 0 && state.misses === 0 ? state : { ...state, compact: null, asked: 0, misses: 0 }
}

export function noteBreakdown(state, window, breakdown) {
  if (state.asked !== window) return state
  if (breakdown !== null && typeof breakdown === 'object') return { ...state, compact: compactWindowOf(breakdown, window), misses: 0 }
  return { ...state, compact: null, asked: 0, misses: state.misses + 1 }
}

export function contextFill(state) {
  if (!(state.window > 0)) return null
  const window = state.compact > 0 && state.compact < state.window ? state.compact : state.window
  const tokens = state.tokens
  return { tokens, window, pct: num(tokens) ? (100 * tokens) / window : null }
}
