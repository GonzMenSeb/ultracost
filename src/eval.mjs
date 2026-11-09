import { priceFamily } from './prices.mjs'
import { createMeter, mergeStored, noteRequest, noteReading } from './meter.mjs'
import { seedOf } from './stats.mjs'

export const EVAL_VERSION = 1
export const DEFAULT_MAX_OPUS = 3

export const STOPPED = 'killed'

const FAMILIES = ['opus', 'sonnet', 'haiku']
const ENDING = new Set(['completed', 'failed', STOPPED])
const MAX_ENDED = 20
const MAX_LAUNCHES = 100
const MAX_EARLY = 32
const MAX_SENT = 16
const GATE_TRIES = 5
const NO_GATE = 'not approved by the gate'
const NO_PLAN = 'no approved plan to compare against'
const MAX_PHASES = 64
export const UNKNOWN_PHASE = '\u0000unknown'

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const get = (o, k) => (typeof k === 'string' && hasOwn(o, k) ? o[k] : undefined)
const isId = (v) => typeof v === 'string' && v !== ''
const text = (v) => (typeof v === 'string' ? v : null)
const effortOf = (v) => (v === undefined || v === null ? null : String(v))
const iso = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null)
const unique = (list) => [...new Set(list)]
const runsOf = (state) => Object.values(state.runs)
const setRun = (state, run) => ({ ...state, runs: { ...state.runs, [run.key]: run } })

export function familyOf(modelId) {
  if (typeof modelId !== 'string') return null
  const id = modelId.toLowerCase()
  const found = FAMILIES.filter((f) => id.includes(f))
  return found.length === 1 ? found[0] : null
}

export function labelMatches(pattern, label) {
  if (typeof pattern !== 'string' || typeof label !== 'string') return false
  const parts = pattern.split('${…}')
  if (parts.length === 1) return label === pattern
  const first = parts[0]
  const last = parts[parts.length - 1]
  if (label.length < first.length + last.length || !label.startsWith(first) || !label.endsWith(last)) return false
  const end = label.length - last.length
  let at = first.length
  for (const mid of parts.slice(1, -1)) {
    const i = label.indexOf(mid, at)
    if (i < 0 || i + mid.length > end) return false
    at = i + mid.length
  }
  return true
}

export function createState() {
  return { v: EVAL_VERSION, limit: DEFAULT_MAX_OPUS, launches: {}, runs: {}, early: {}, ui: { run: null, folds: {} }, main: { model: null, effort: null }, meter: createMeter() }
}

export function noteLimit(state, limit) {
  return Number.isInteger(limit) && limit > 0 && limit !== state.limit ? { ...state, limit } : state
}

function prune(state) {
  let { runs, launches } = state
  const ended = Object.values(runs)
    .filter((r) => r.status !== 'running')
    .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
  if (ended.length > MAX_ENDED) {
    runs = { ...runs }
    for (const r of ended.slice(0, ended.length - MAX_ENDED)) delete runs[r.key]
  }
  const ids = Object.keys(launches)
  if (ids.length > MAX_LAUNCHES) {
    const live = new Set(Object.values(runs).map((r) => r.toolUseId))
    const stale = ids
      .map((k) => launches[k])
      .filter((l) => !l.pending && !live.has(l.toolUseId))
      .sort((a, b) => a.at - b.at)
    launches = { ...launches }
    for (const l of stale.slice(0, ids.length - MAX_LAUNCHES)) delete launches[l.toolUseId]
  }
  return runs === state.runs && launches === state.launches ? state : { ...state, runs, launches }
}

const blankLaunch = (toolUseId, at, main) => ({ toolUseId, fingerprint: null, at, refused: false, pending: true, gate: null, gateTries: 0, baseline: { ...main } })

export function noteLaunch(state, { toolUseId, fingerprint, at = 0 }) {
  if (!isId(toolUseId)) return state
  const prev = get(state.launches, toolUseId)
  const launch = prev ? { ...prev, fingerprint: text(fingerprint) || prev.fingerprint } : { ...blankLaunch(toolUseId, at, state.main), fingerprint: text(fingerprint) }
  return prune({ ...state, launches: { ...state.launches, [toolUseId]: launch } })
}

function newRun(state, key, launch, at) {
  return {
    key,
    toolUseId: launch ? launch.toolUseId : null,
    runId: null,
    taskId: null,
    name: null,
    at: (launch && launch.at) || at,
    status: 'running',
    endedAt: null,
    launched: Boolean(launch),
    fingerprint: launch ? launch.fingerprint : null,
    gate: launch ? launch.gate : null,
    agents: [],
    peakOpus: 0,
    limit: state.limit,
    baseline: { ...((launch && launch.baseline) || state.main) },
    saved: null
  }
}

export function noteLaunchResult(state, { toolUseId, isError = false, taskId, runId, name, at = 0 }) {
  if (!isId(toolUseId)) return state
  const known = get(state.launches, toolUseId) || blankLaunch(toolUseId, at, state.main)
  if (isError) {
    const runs = { ...state.runs }
    const run = get(runs, toolUseId)
    if (run && run.agents.length === 0) delete runs[toolUseId]
    return { ...state, runs, launches: { ...state.launches, [toolUseId]: { ...known, refused: true, pending: false } } }
  }
  const launch = { ...known, pending: false }
  const runs = { ...state.runs }
  let run = get(runs, toolUseId)
  if (!run) {
    const orphan = isId(runId) ? get(runs, runId) : undefined
    if (orphan && !orphan.launched) {
      delete runs[orphan.key]
      run = { ...orphan, key: toolUseId }
    } else {
      run = newRun(state, toolUseId, launch, at)
    }
  }
  run = {
    ...run,
    toolUseId,
    launched: true,
    fingerprint: launch.fingerprint,
    gate: launch.gate,
    runId: isId(runId) ? runId : run.runId,
    taskId: isId(taskId) ? taskId : run.taskId,
    name: text(name) || run.name
  }
  return { ...state, launches: { ...state.launches, [toolUseId]: launch }, runs: { ...runs, [run.key]: run } }
}

function trimGate(record, toolUseId) {
  if (!record || typeof record !== 'object' || record.kind !== 'gate') return null
  if (record.decision !== 'pass' && record.decision !== 'deny') return null
  if (typeof record.tool_use_id === 'string' && record.tool_use_id !== toolUseId) return null
  const stages = (Array.isArray(record.stages) ? record.stages : [])
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      index: Number.isInteger(s.index) ? s.index : null,
      label: text(s.label),
      class: text(s.class),
      model: typeof s.model === 'string' ? s.model.toLowerCase() : null,
      effort: effortOf(s.effort),
      phase: isId(s.phase) ? s.phase : null
    }))
  const phases = unique((Array.isArray(record.phases) ? record.phases : []).filter(isId)).slice(0, MAX_PHASES)
  return {
    decision: record.decision,
    fingerprint: text(record.fingerprint),
    maxOpus: Number.isInteger(record.maxOpus) ? record.maxOpus : null,
    sessionModel: text(record.sessionModel),
    at: text(record.at),
    phases,
    stages
  }
}

export function noteGateRecord(state, toolUseId, record) {
  if (!isId(toolUseId)) return state
  const gate = trimGate(record, toolUseId)
  const launch = get(state.launches, toolUseId)
  const launches = launch
    ? { ...state.launches, [toolUseId]: { ...launch, gate, gateTries: launch.gateTries + 1 } }
    : state.launches
  const runs = { ...state.runs }
  for (const run of runsOf(state)) if (run.toolUseId === toolUseId) runs[run.key] = { ...run, gate }
  return { ...state, launches, runs }
}

const byRunId = (state, runId) =>
  runsOf(state)
    .filter((r) => r.runId === runId)
    .sort((a, b) => b.at - a.at)

export function findRunKey(state, { toolUseId, runId }) {
  if (isId(toolUseId) && get(state.runs, toolUseId)) return toolUseId
  if (!isId(runId)) return null
  const live = byRunId(state, runId).find((r) => r.status === 'running')
  return live ? live.key : null
}

export function gateWanted(state, { toolUseId, runId }) {
  const key = findRunKey(state, { toolUseId, runId })
  const id = key ? get(state.runs, key).toolUseId : isId(toolUseId) ? toolUseId : null
  const launch = id ? get(state.launches, id) : undefined
  return launch && !launch.refused && !launch.gate && launch.gateTries < GATE_TRIES ? id : null
}

const agentFamily = (a) => familyOf(a.ranModel === null ? a.askedModel : a.ranModel)
const opusRunning = (agents) => agents.filter((a) => !a.done && agentFamily(a) === 'opus').length

function runForSpawn(state, { toolUseId, runId }, at) {
  const withRunId = (run) => ({ ...run, runId: isId(runId) ? runId : null })
  if (isId(toolUseId) && get(state.runs, toolUseId)) return get(state.runs, toolUseId)
  const launch = isId(toolUseId) ? get(state.launches, toolUseId) : undefined
  if (launch && !launch.refused) return withRunId(newRun(state, launch.toolUseId, launch, at))
  const key = findRunKey(state, { toolUseId, runId })
  if (key) return get(state.runs, key)
  if (!isId(toolUseId) && isId(runId)) {
    const pending = Object.values(state.launches).filter((l) => l.pending && !l.refused)
    if (pending.length === 1) return withRunId(newRun(state, pending[0].toolUseId, pending[0], at))
  }
  const ended = isId(runId) ? byRunId(state, runId)[0] : undefined
  if (ended) return ended
  const orphanKey = isId(runId) ? runId : isId(toolUseId) ? toolUseId : null
  const orphan = orphanKey ? withRunId(newRun(state, orphanKey, null, at)) : null
  return orphan && isId(toolUseId) ? { ...orphan, toolUseId } : orphan
}

export function noteSpawn(state, { toolUseId, runId, agentId, label, askedModel, resolvedModel, parentModel, at = 0 }) {
  if (!isId(agentId)) return state
  const run = runForSpawn(state, { toolUseId, runId }, at)
  if (!run) return state
  const early = get(state.early, agentId)
  const agent = {
    agentId,
    label: text(label) || '',
    askedModel: text(askedModel),
    ranModel: text(resolvedModel),
    at,
    done: Boolean(early && early.done),
    sent: early ? early.sent : [],
    usage: (early && early.usage) || {}
  }
  const agents = run.agents.some((a) => a.agentId === agentId)
    ? run.agents.map((a) => (a.agentId === agentId ? { ...a, label: agent.label, askedModel: agent.askedModel, ranModel: agent.ranModel } : a))
    : [...run.agents, agent]
  const rest = { ...state.early }
  delete rest[agentId]
  const baseline = run.agents.length === 0 && text(parentModel) ? { ...run.baseline, model: parentModel } : run.baseline
  return setRun({ ...state, early: rest }, { ...run, agents, baseline, peakOpus: Math.max(run.peakOpus, opusRunning(agents)) })
}

function locateAgent(state, agentId) {
  for (const run of runsOf(state)) {
    const index = run.agents.findIndex((a) => a.agentId === agentId)
    if (index >= 0) return { run, index }
  }
  return null
}

export function runOfAgent(state, agentId) {
  const at = isId(agentId) ? locateAgent(state, agentId) : null
  return at ? at.run.key : null
}

const blankEarly = () => ({ sent: [], done: false, usage: {} })

function setEarly(state, agentId, entry) {
  const early = { ...state.early, [agentId]: entry }
  const ids = Object.keys(early)
  if (ids.length > MAX_EARLY) delete early[ids[0]]
  return { ...state, early }
}

const withAgent = (state, at, change) =>
  setRun(state, { ...at.run, agents: at.run.agents.map((a, i) => (i === at.index ? change(a) : a)) })

export function noteStep(state, { agentId, model, effort }) {
  if (!isId(agentId) || typeof model !== 'string') return state
  const pair = { model, effort: effortOf(effort) }
  const add = (sent) =>
    sent.length >= MAX_SENT || sent.some((s) => s.model === pair.model && s.effort === pair.effort) ? sent : [...sent, pair]
  const at = locateAgent(state, agentId)
  if (at) {
    const sent = add(at.run.agents[at.index].sent)
    return sent === at.run.agents[at.index].sent ? state : withAgent(state, at, (a) => ({ ...a, sent }))
  }
  const entry = get(state.early, agentId) || blankEarly()
  const sent = add(entry.sent)
  return sent === entry.sent && hasOwn(state.early, agentId) ? state : setEarly(state, agentId, { ...entry, sent })
}

export function noteMainStep(state, { model, effort }) {
  if (typeof model !== 'string') return state
  const main = { model, effort: effortOf(effort) }
  return state.main.model === main.model && state.main.effort === main.effort ? state : { ...state, main }
}

const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

function addUsage(map, family, effort, tokens, long) {
  const key = `${family || '?'}:${effort || '?'}${long ? ':long' : ''}`
  const old = map[key] || { family, effort, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 }
  const next = {
    ...old,
    input: old.input + tokens.input,
    output: old.output + tokens.output,
    cacheRead: old.cacheRead + tokens.cacheRead,
    cacheWrite: old.cacheWrite + tokens.cacheWrite,
    requests: old.requests + 1
  }
  if (long) next.long = true
  return { ...map, [key]: next }
}

export function noteUsage(state, { agentId, effort, usage, prices }) {
  if (usage === null || typeof usage !== 'object') return state
  const tokens = {
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens)
  }
  const family = priceFamily(usage.model)
  const next = { ...state, meter: noteRequest(state.meter, family || '?', tokens) }
  if (!isId(agentId)) return next
  const row = family && prices ? prices.families[family] : undefined
  const long = Boolean(row && row.longPrompt && tokens.input + tokens.cacheRead + tokens.cacheWrite > row.longPrompt.above)
  const add = (map) => addUsage(map, family, effortOf(effort), tokens, long)
  const at = locateAgent(next, agentId)
  if (at) return withAgent(next, at, (a) => ({ ...a, usage: add(a.usage) }))
  const entry = get(next.early, agentId) || blankEarly()
  return setEarly(next, agentId, { ...entry, usage: add(entry.usage) })
}

export function noteMeterReading(state, rateLimits, at, prices) {
  return { ...state, meter: noteReading(state.meter, rateLimits, at, prices) }
}

export function noteStored(state, stored, sessionKey, now) {
  return { ...state, meter: mergeStored(state.meter, stored, sessionKey, now) }
}

export function hideFinished(state) {
  const finished = runsOf(state).filter((r) => r.status !== 'running' && !r.hidden)
  return finished.length === 0 ? state : finished.reduce((s, r) => setRun(s, { ...r, hidden: true }), state)
}

export function noteSaved(state, key, saved) {
  const run = get(state.runs, key)
  return run ? setRun(state, { ...run, saved }) : state
}

export function noteAgentDone(state, { agentId }) {
  if (!isId(agentId)) return state
  const at = locateAgent(state, agentId)
  if (at) return at.run.agents[at.index].done ? state : withAgent(state, at, (a) => ({ ...a, done: true }))
  const entry = get(state.early, agentId) || blankEarly()
  return entry.done ? state : setEarly(state, agentId, { ...entry, done: true })
}

function endRun(state, run, status, at) {
  return setRun(state, { ...run, status, endedAt: at, agents: run.agents.map((a) => (a.done ? a : { ...a, done: true })) })
}

export function noteRunEnd(state, { toolUseId, taskId, status, at = 0 }) {
  if (!ENDING.has(status)) return state
  let run = isId(toolUseId) ? get(state.runs, toolUseId) : undefined
  if (!run && isId(toolUseId)) run = runsOf(state).find((r) => r.status === 'running' && r.toolUseId === toolUseId)
  if (!run && isId(taskId)) run = runsOf(state).find((r) => r.taskId === taskId)
  if (!run || run.status !== 'running') return state
  return prune(endRun(state, run, status, at))
}

export function endAllRuns(state, status = 'cleared', at = 0) {
  const live = runsOf(state).filter((r) => r.status === 'running')
  if (live.length === 0) return state
  return prune(live.reduce((s, r) => endRun(s, r, status, at), state))
}

export function openRun(state, key) {
  return state.ui.run === key ? state : { ...state, ui: { ...state.ui, run: key, folds: {} } }
}

export function closeRun(state) {
  return state.ui.run === null ? state : { ...state, ui: { ...state.ui, run: null, folds: {}, focus: `run:${state.ui.run}` } }
}

export function noteFocus(state, key) {
  return (state.ui.focus ?? null) === key ? state : { ...state, ui: { ...state.ui, focus: key } }
}

export const stoppedOpen = (state) => state.ui.list?.stoppedOpen ?? false

export function setStoppedOpen(state, open) {
  return stoppedOpen(state) === open ? state : { ...state, ui: { ...state.ui, list: { ...state.ui.list, stoppedOpen: open } } }
}

export function setFolds(state, keys, folded) {
  const current = state.ui.folds || {}
  if (keys.every((k) => current[k] === folded)) return state
  return { ...state, ui: { ...state.ui, folds: { ...current, ...Object.fromEntries(keys.map((k) => [k, folded])) } } }
}

export function phaseOpen(phase, folds) {
  const set = folds ? folds[phase.key] : undefined
  return typeof set === 'boolean' ? !set : phase.open
}

export function parseTaskNotifications(source) {
  if (typeof source !== 'string' || !source.includes('<task-notification>')) return []
  const out = []
  for (const m of source.matchAll(/<task-notification>([\s\S]*?)(?:<\/task-notification>|$)/g)) {
    const body = m[1]
    const pick = (tag) => {
      const hit = new RegExp(`<${tag}>\\s*([^<\\s]+)\\s*</${tag}>`).exec(body)
      return hit ? hit[1] : null
    }
    const status = pick('status')
    const toolUseId = pick('tool-use-id')
    const taskId = pick('task-id')
    if (status && (toolUseId || taskId)) out.push({ toolUseId, taskId, status: status.toLowerCase() })
  }
  return out
}

const gateReason = (run) => {
  if (!run.launched || !run.gate) return NO_GATE
  if (run.gate.decision !== 'pass') return 'the gate denied this script'
  if (!run.fingerprint || run.gate.fingerprint !== run.fingerprint) return 'the script that ran is not the one the gate approved'
  return null
}

const planOf = (run) => (gateReason(run) === null ? run.gate.stages : null)

function candidateStages(plan, agent) {
  if (!plan) return []
  const byLabel = plan.filter((s) => s.label !== null && labelMatches(s.label, agent.label))
  const ran = agentFamily(agent)
  const byModel = byLabel.filter((s) => s.model === ran)
  return byModel.length > 0 ? byModel : byLabel
}

function phaseOf(plan, agent) {
  const titles = unique(candidateStages(plan, agent).map((s) => s.phase ?? null))
  return titles.length === 1 ? titles[0] : null
}

function judge(plan, agent) {
  if (!plan) return { stage: null, planReason: NO_PLAN, requestReason: NO_PLAN }
  const who = `agent "${agent.label}"`
  const ran = agentFamily(agent)
  const byLabel = plan.filter((s) => s.label !== null && labelMatches(s.label, agent.label))
  if (byLabel.length === 0) return { stage: null, planReason: `${who} matches no approved stage`, requestReason: null }
  const byModel = byLabel.filter((s) => s.model === ran)
  if (byModel.length === 0) {
    const approved = unique(byLabel.map((s) => s.model)).join(' or ')
    return { stage: byLabel[0], planReason: `${who} ran on ${ran || agent.ranModel || 'an unknown model'}, the gate approved ${approved}`, requestReason: null }
  }
  const stage = byModel[0]
  const efforts = unique(byModel.map((s) => s.effort))
  for (const s of agent.sent) {
    const family = familyOf(s.model)
    if (family !== stage.model) return { stage, planReason: null, requestReason: `${who} sent a ${family || s.model} request, the gate approved ${stage.model}` }
    if (!efforts.includes(s.effort)) {
      return { stage, planReason: null, requestReason: `${who} sent effort ${s.effort || 'none'}, the gate approved ${efforts.join(' or ')}` }
    }
  }
  return { stage, planReason: null, requestReason: null }
}

export function runChecks(run) {
  const plan = planOf(run)
  const judged = run.agents.map((a) => judge(plan, a))
  const gate = gateReason(run)
  const planBad = judged.find((j) => j.planReason !== null)
  const requestBad = judged.find((j) => j.requestReason !== null)
  const opus = run.peakOpus > run.limit ? `${run.peakOpus} opus agents ran at once; the limit is ${run.limit}` : null
  return [
    { id: 'gate', ok: gate === null, reason: gate },
    { id: 'plan', ok: !planBad, reason: planBad ? planBad.planReason : null },
    { id: 'requests', ok: !requestBad, reason: requestBad ? requestBad.requestReason : null },
    { id: 'opus', ok: opus === null, reason: opus }
  ]
}

export function activeRuns(state) {
  return runsOf(state)
    .filter((r) => r.status === 'running')
    .sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1))
}

const newestEnded = (a, b) => (b.endedAt || 0) - (a.endedAt || 0) || (a.key < b.key ? -1 : 1)

export function finishedRuns(state) {
  return runsOf(state)
    .filter((r) => r.status !== 'running' && r.status !== 'cleared' && r.status !== STOPPED && !r.hidden)
    .sort(newestEnded)
}

export function stoppedRuns(state) {
  return runsOf(state)
    .filter((r) => r.status === STOPPED && !r.hidden)
    .sort(newestEnded)
}

export const TALLY_PREFIX = 'tally:'
const TALLY_MAX_AGE_MS = 30 * 24 * 3600 * 1000
const TALLY_KEEP_OTHERS = 3
export const TALLY_STORE_MAX = 512 * 1024

export function storedTally(value) {
  const ok = value !== null && typeof value === 'object' && value.v === 1 && value.runs !== null && typeof value.runs === 'object' && !Array.isArray(value.runs)
  return ok ? value : null
}

export function settledTally(tally) {
  if (!tally) return tally
  const runs = Object.fromEntries(Object.entries(tally.runs).map(([key, r]) => [key, r.status === 'running' ? { ...r, status: 'cleared' } : r]))
  return { ...tally, runs, ...(tally.overall ? { overall: { ...tally.overall, running: false } } : {}) }
}

export function staleTallies(stored, sessionKey, now) {
  const newest = (value) => Math.max(-Infinity, ...Object.values(storedTally(value)?.runs ?? {}).map((r) => (Number.isFinite(r?.at) ? r.at : -Infinity)))
  const others = Object.entries(stored ?? {})
    .filter(([key]) => key.startsWith(TALLY_PREFIX) && key !== sessionKey)
    .map(([key, value]) => ({ key, at: newest(value) }))
    .sort((a, b) => b.at - a.at)
  return others.filter(({ at }, i) => i >= TALLY_KEEP_OTHERS || !(at >= now - TALLY_MAX_AGE_MS)).map(({ key }) => key)
}

export function agentPieces(run) {
  return run.agents.map((a) => ({
    agentId: a.agentId,
    pieces: Object.values(a.usage || {}).map(({ family, effort, input, output, cacheRead, cacheWrite, long }) => ({
      family,
      effort,
      input,
      output,
      cacheRead,
      cacheWrite,
      ...(long ? { long: true } : {})
    }))
  }))
}

export function bandView(state) {
  const live = activeRuns(state)
  if (live.length === 0) return null
  const red = live.filter((r) => runChecks(r).some((c) => !c.ok)).length
  return { color: red > 0 ? 'red' : 'green', running: live.length, red }
}

export function bandText(view) {
  return view.red > 0 ? `${view.running} running  ${view.red} red` : `${view.running} running`
}

const CHECK_TITLES = {
  gate: () => 'Approved by the gate',
  plan: () => 'Every agent matches the plan',
  requests: () => 'Every request as approved',
  opus: (run) => `At most ${run.limit} Opus at once`
}

const clockOf = (iso) => {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN
  if (Number.isNaN(t)) return null
  const d = new Date(t)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}

const CHECK_DETAILS = {
  gate: (run) => [clockOf(run.gate && run.gate.at), 'script fingerprint matches'].filter(Boolean).join('  '),
  plan: (run) => `${run.agents.length} agent${run.agents.length === 1 ? '' : 's'}`,
  requests: (run) => {
    const n = run.agents.reduce((sum, a) => sum + a.sent.length, 0)
    return `${n} request${n === 1 ? '' : 's'}`
  },
  opus: (run) => `peak ${run.peakOpus}`
}

const hhmm = (ms) => {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes()].map((n) => String(n).padStart(2, '0')).join(':')
}

const pairText = (model, effort) => `${model || '?'} · ${effort || '—'}`

function agentView(plan, agent) {
  const j = judge(plan, agent)
  const reason = j.planReason || j.requestReason
  const families = unique(agent.sent.map((s) => familyOf(s.model) || s.model))
  const ranModel = agent.sent.length > 0 ? families.join(' / ') : agentFamily(agent) || agent.ranModel || '?'
  const ranEffort = unique(agent.sent.map((s) => s.effort || '—')).join(' / ')
  return {
    agentId: agent.agentId,
    label: agent.label,
    ok: reason === null,
    reason,
    done: agent.done,
    approved: j.stage ? pairText(j.stage.model, j.stage.effort) : null,
    ran: pairText(ranModel, ranEffort || null),
    approvedModel: j.stage ? j.stage.model : null,
    approvedEffort: j.stage ? j.stage.effort : null,
    ranModel,
    ranEffort: ranEffort || null,
    phase: phaseOf(plan, agent)
  }
}

function phaseViews(run, plan, views) {
  const titles = plan ? unique([...(run.gate.phases || []), ...plan.map((s) => s.phase).filter(isId)]) : []
  if (titles.length === 0) return null
  const ended = run.status !== 'running'
  const groups = titles.map((title) => ({ key: title, title, members: [] }))
  const byTitle = new Map(groups.map((g) => [g.title, g]))
  const unknown = { key: UNKNOWN_PHASE, title: 'phase unknown', members: [] }
  run.agents.forEach((a, i) => (byTitle.get(views[i].phase) || unknown).members.push(i))
  const all = unknown.members.length > 0 ? [...groups, unknown] : groups
  return all.map((g, gi) => {
    const agents = g.members.map((i) => views[i])
    const done = g.members.filter((i) => run.agents[i].done).length
    const red = agents.filter((a) => !a.ok).length
    const later = all.some((h, hi) => hi > gi && h.members.length > 0)
    const state = agents.length === 0 ? (ended ? 'did not run' : 'not started') : ended || (done === agents.length && later) ? 'done' : 'running'
    const counts = { opus: 0, sonnet: 0, haiku: 0 }
    for (const i of g.members) {
      const f = agentFamily(run.agents[i])
      if (f) counts[f] += 1
    }
    return {
      key: g.key,
      title: g.title,
      state,
      total: agents.length,
      done,
      red,
      ok: red === 0,
      open: false,
      counts,
      agentIds: agents.map((a) => a.agentId),
      agents
    }
  })
}

export function runView(run) {
  const checks = runChecks(run)
  const bad = checks.find((c) => !c.ok)
  const plan = planOf(run)
  const counts = { opus: 0, sonnet: 0, haiku: 0 }
  for (const a of run.agents) {
    const f = agentFamily(a)
    if (f) counts[f] += 1
  }
  const id = run.runId || run.key
  const agents = run.agents.map((a) => agentView(plan, a))
  return {
    key: run.key,
    ok: !bad,
    color: bad ? 'red' : 'green',
    reason: bad ? bad.reason : null,
    title: run.name || (run.launched ? 'workflow' : 'unknown launch'),
    shortId: id.replace(/^wf_/, '').slice(0, 6),
    status: run.status,
    counts,
    saved: run.saved || null,
    endedClock: run.endedAt ? hhmm(run.endedAt) : null,
    stoppedClock: run.status === STOPPED && run.endedAt ? hhmm(run.endedAt) : null,
    countsText: [`${counts.opus} opus`, `${counts.sonnet} sonnet`, ...(counts.haiku > 0 ? [`${counts.haiku} haiku`] : [])].join('  '),
    checks: checks.map((c) => ({ ...c, title: CHECK_TITLES[c.id](run), detail: c.ok ? CHECK_DETAILS[c.id](run) : null })),
    agents,
    phases: phaseViews(run, plan, agents)
  }
}

export function evalRecord(state, run) {
  const view = runView(run)
  return {
    v: EVAL_VERSION,
    kind: 'eval',
    key: run.key,
    tool_use_id: run.toolUseId,
    run_id: run.runId,
    task_id: run.taskId,
    name: run.name,
    launched: run.launched,
    status: run.status,
    startedAt: iso(run.at),
    endedAt: iso(run.endedAt),
    ok: view.ok,
    reason: view.reason,
    fingerprint: run.fingerprint,
    gate: run.gate ? { decision: run.gate.decision, fingerprint: run.gate.fingerprint, maxOpus: run.gate.maxOpus } : null,
    limit: run.limit,
    peakOpus: run.peakOpus,
    checks: view.checks.map(({ id, ok, reason }) => ({ id, ok, reason })),
    failures: unique([...view.checks.filter((c) => !c.ok).map((c) => c.reason), ...view.agents.filter((a) => !a.ok).map((a) => a.reason)]),
    savings: {
      baseline: run.baseline,
      seed: seedOf(run.key),
      saved: run.saved || null,
      usage: run.agents.map((a) => ({ agent_id: a.agentId, usage: Object.values(a.usage || {}) }))
    },
    agents: run.agents.map((a, i) => ({
      agent_id: a.agentId,
      label: a.label,
      askedModel: a.askedModel,
      ranModel: a.ranModel,
      approved: view.agents[i].approved,
      sent: a.sent,
      done: a.done,
      phase: view.agents[i].phase,
      ok: view.agents[i].ok,
      reason: view.agents[i].reason
    })),
    phases: view.phases ? view.phases.map((p) => ({ title: p.key === UNKNOWN_PHASE ? null : p.title, state: p.state, agents: p.agentIds })) : null
  }
}
