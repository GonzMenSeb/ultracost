import { activeRuns, finishedRuns, runView, stoppedOpen, stoppedRuns } from './eval.mjs'

export const STOPPED_FOLD = 'fold:stopped'

const rowKey = (v) => `run:${v.key}`

export function paneNav(state) {
  const runs = activeRuns(state).map((r) => runView(r))
  const all = [...runs, ...finishedRuns(state).map((r) => runView(r))]
  const stopped = stoppedRuns(state).map((r) => runView(r))
  const open = [...all, ...stopped].find((v) => v.key === state.ui.run)
  if (!open) {
    const fold = stopped.length === 0 ? [] : [STOPPED_FOLD, ...(stoppedOpen(state) ? stopped.map(rowKey) : [])]
    return { reachable: [...all.map(rowKey), ...fold], resting: runs[0] ? rowKey(runs[0]) : null }
  }
  if (!open.phases) return { reachable: ['back'], resting: 'back' }
  const filled = open.phases.filter((p) => p.total > 0)
  const first = (filled.find((p) => p.state === 'running' || p.red > 0) ?? filled[0])?.key
  return { reachable: [...filled.map((p) => `phase:${p.key}`), 'all', 'back'], resting: first ? `phase:${first}` : 'back' }
}

export function stepFocus({ reachable, resting }, focus, dir) {
  const current = reachable.includes(focus) ? focus : resting
  const at = reachable.indexOf(current)
  if (at === -1) return dir > 0 ? (reachable[0] ?? null) : null
  return reachable[at + dir] ?? null
}

export const arrowOf = (e) => (e.origin?.kind === 'person' && e.pointer === undefined && Math.abs(e.by) === 1 && e.bodyRows > 1 ? Math.sign(e.by) : 0)

export const boxKeyOf = (key) => (key.startsWith('run:') ? `box:${key.slice(4)}` : `box:${key}`)
