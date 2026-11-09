import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ContextState, EvalAgentView, EvalMeter, EvalPhaseView, EvalRun, EvalState, TallyOverall, TallyRun, TallyState } from '../types'
import { sha256Hex } from '../src/fingerprint.mjs'
import { recordPath } from '../src/record.mjs'
import {
  activeRuns,
  agentPieces,
  bandText,
  bandView,
  closeRun,
  createState,
  endAllRuns,
  endedRecord,
  endTallyRun,
  evalRecord,
  finishedRuns,
  gateWanted,
  hideFinished,
  noteAgentDone,
  noteGateRecord,
  noteLaunch,
  noteLaunchResult,
  noteLimit,
  noteMainStep,
  noteFocus,
  noteMeterReading,
  noteRunEnd,
  noteSaved,
  noteSpawn,
  noteStep,
  noteStored,
  noteUsage,
  openRun,
  parseTaskNotifications,
  phaseOpen,
  runOfAgent,
  runView,
  setFolds,
  setStoppedOpen,
  staleTallies,
  STOPPED,
  stoppedOpen,
  stoppedRuns,
  TALLY_PREFIX,
  TALLY_STORE_MAX,
  tallyFor
} from '../src/eval.mjs'
import { contextFill, createContext, forgetCompactRead, noteBreakdown, noteContext } from '../src/context.mjs'
import { listLayout } from '../src/listWindow.mjs'
import { intervalsOf, staleKeys, storedValue, usedOf } from '../src/meter.mjs'
import { STOPPED_FOLD, arrowOf, boxKeyOf, listShown, paneNav, stepFocus } from '../src/nav.mjs'
import { familyColor, modelColor, savedColor } from '../src/palette.mjs'
import { loadPrices, priceFamily } from '../src/prices.mjs'
import {
  AGENTS_HEAD,
  agentColumn,
  CHECKS_HEAD,
  endedText,
  FINISHED_TITLE,
  FOCUS_HINT,
  FOLD_HINT,
  foldLine,
  LIST_HINT,
  listCell,
  listHeader,
  modelLines,
  MORE_ABOVE,
  MORE_BELOW,
  NO_RUNNING,
  overallBlock,
  PHASES_HEAD,
  phaseHeadLength,
  phaseLayout,
  phaseStatus,
  phaseTitle,
  RUNNING_EXTRA,
  savedBlock,
  sectionHead,
  subHead,
  toastText,
  WORKFLOWS_HEAD
} from '../src/savedText.mjs'
import { estimateRun } from '../src/savings.mjs'
import { seedOf } from '../src/stats.mjs'
import { combine, createTally, noteTallyRun, overallInput } from '../src/tally.mjs'

const PANE = 'ultraguard'
const TITLE = 'ultraguard-eval'
const KEPT = 20
const TOAST_MS = 8000
const DRAWS_RUNNING = 1000
const OVERALL_EVERY_MS = 30 * 1000
const TALLY_TOO_BIG = `ultraguard: the session tally is over ${TALLY_STORE_MAX / 1024} KiB, so it is no longer kept in the plugin store`
const agentsText = (n: number) => `${n} agent${n === 1 ? '' : 's'}`

const ev = atom({ plugin: 'ultraguard', key: 'eval' } as const, createState() as EvalState, { shape: 'eval-2' })
const ctx = atom({ plugin: 'ultraguard', key: 'context' } as const, createContext() as ContextState, { shape: 'context-1' })
const tally = atom({ plugin: 'ultraguard', key: 'tally' } as const, createTally() as TallyState, { shape: 'tally-1' })

const windowFrom = new Map<string, number>()
let ringHeld = true

type Ids = { toolUseId: string; runId: string }
type Notice = { toolUseId: string | null | undefined; taskId: string | null | undefined; status: string }
type Segment = { text: string; style: string; pct?: number; color?: string }
type Data = { prices: any; ratios: any }
type WorkflowOutput = { taskId?: string; runId?: string; workflowName?: string; summary?: string; error?: string }

const tone = (ok: boolean) => (ok ? 'success' : 'error')
const fit = (text: string, width: number) => (text.length > width ? `${text.slice(0, Math.max(0, width - 2))}… ` : text.padEnd(width))
const countsWidth = (c: { opus: number; sonnet: number; haiku: number }) => {
  const parts = (['opus', 'sonnet', 'haiku'] as const).filter(m => c[m] > 0).map(m => `${m} ${c[m]}`)
  return parts.length === 0 ? 'no agents yet'.length : parts.join('  ').length
}

const segmentLook = (g: Segment) => {
  if (g.color) return { weight: g.style === 'bold' ? ('bold' as const) : undefined, color: g.color }
  if (g.style === 'saved') return { weight: 'bold' as const, color: savedColor(g.pct ?? 0) }
  const family = familyColor(g.style)
  if (family) return { weight: 'bold' as const, color: family }
  return { weight: g.style === 'bold' ? ('bold' as const) : undefined, dimColor: g.style === 'dim' ? true : undefined }
}

const lineOf = (Text: any, wrap: 'truncate-end' | 'wrap' = 'truncate-end') => (line: Segment[]) => (
  <Text wrap={wrap}>
    {line.map(g => (
      <Text {...segmentLook(g)}>{g.text}</Text>
    ))}
  </Text>
)

const ring = (picked: boolean) => ({
  borderStyle: picked ? 'round' : undefined,
  borderColor: picked ? 'text' : undefined,
  paddingX: picked ? 1 : 2,
  paddingY: picked ? 0 : 1
})

const mark = (picked: boolean, hollow: string, filled: string) => (picked ? filled : hollow)

const ZERO_WIDTH = '\u200b'

const tinted = (Text: any, text: string, color: string | undefined) =>
  color ? <Text weight="bold" color={color}>{text}</Text> : <Text dimColor={text === '—' ? true : undefined}>{text}</Text>

function cap<V>(map: Map<string, V>) {
  while (map.size > KEPT) map.delete(map.keys().next().value as string)
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(b => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : '')).join('\n')
}

async function configDir($: EngineInterface): Promise<string | null> {
  const given = (await $.env.get('CLAUDE_CONFIG_DIR'))?.trim()
  if (given) return given
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  const home = windows
    ? (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
    : (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  return home ? `${home.replace(/[\\/]+$/, '')}/.claude` : null
}

async function fingerprintOf($: EngineInterface, e: { script?: unknown; scriptPath?: unknown; name?: unknown }): Promise<string | null> {
  const given = (v: unknown) => v !== undefined && v !== null
  if (given(e.name) || (given(e.script) && given(e.scriptPath))) return null
  if (typeof e.script === 'string') return sha256Hex(e.script)
  if (typeof e.scriptPath === 'string') return sha256Hex(await $.fs.read(e.scriptPath))
  return null
}

async function openPane($: EngineInterface) {
  await update($, ev, closeRun)
  return $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
}

let dataLoad: Promise<Data | null> | null = null

function getData($: EngineInterface): Promise<Data | null> {
  if (!dataLoad) {
    dataLoad = (async () => {
      const dir = `${$.plugin.root}/data`
      return {
        prices: loadPrices(JSON.parse(await $.fs.read(`${dir}/prices.json`))),
        ratios: JSON.parse(await $.fs.read(`${dir}/ratios.json`))
      }
    })().catch(err => {
      note($, 'data', err)
      return null
    })
  }
  return dataLoad
}

async function recordReading($: EngineInterface, rateLimits: unknown) {
  const data = await getData($)
  if (!data) return
  const at = await $.clock.now()
  const before = await read($, ev)
  const after = await update($, ev, s => noteMeterReading(s, rateLimits, at, data.prices))
  const sid = await $.session.id()
  const grew = (['five_hour', 'seven_day'] as const).some(k => after.meter.mine[k] !== before.meter.mine[k])
  if (grew) await $.store.set(`meter:${sid}`, storedValue(after.meter))
  const t = await read($, tally)
  const built = t.sid === sid ? t.overall?.windows : undefined
  const stamps = stampsOf(after.meter)
  if (built && (built.five_hour !== stamps.five_hour || built.seven_day !== stamps.seven_day)) await noteTally($, sid, null, 'always')
}

async function loadMeter($: EngineInterface) {
  if (!(await getData($))) return
  const stored: Record<string, unknown> = {}
  for (const key of await $.store.keys()) if (key.startsWith('meter:')) stored[key] = await $.store.get(key)
  const own = `meter:${await $.session.id()}`
  const now = await $.clock.now()
  for (const key of staleKeys(stored, own, now)) {
    await $.store.delete(key)
    delete stored[key]
  }
  await update($, ev, s => noteStored(s, stored, own, now))
  await recordReading($, (await $.session.usage()).rateLimits)
}

async function estimate($: EngineInterface, key: string) {
  const sid = await $.session.id()
  const data = await getData($)
  if (!data) return
  try {
    await recordReading($, (await $.session.usage()).rateLimits)
  } catch (err) {
    note($, 'usage', err)
  }
  const at = await $.clock.now()
  const s = await read($, ev)
  const run = s.runs[key]
  if (!run) return
  const running = run.status === 'running'
  const baseline = baselineOf(run)
  const meter = meterOf(s.meter, at)
  const agents = agentPieces(run)
  const saved = estimateRun({
    agents,
    groups: (runView(run).phases ?? []).map((p: EvalPhaseView) => ({ key: p.key, agentIds: p.agentIds })),
    baseline,
    ratios: data.ratios,
    prices: data.prices,
    meter,
    seed: seedOf(run.key),
    ...(running ? { draws: DRAWS_RUNNING } : {}),
    running
  })
  const used = s.meter.subscription === true ? { five_hour: usedOf(s.meter.last.five_hour, at), seven_day: usedOf(s.meter.last.seven_day, at) } : { five_hour: null, seven_day: null }
  const after = await update($, ev, st => noteSaved(st, key, { ...saved, used }))
  const current = after.runs[key]
  if (!current || current.hidden || (running && current.status !== 'running')) return
  await guard($, 'tally', () => noteTally($, sid, { key, status: run.status, baseline, agents, windows: stampsOf(s.meter), at }, running ? 'due' : 'always'))
}

type Pooled = { baseline: TallyRun['baseline'] } & Record<'all' | 'five_hour' | 'seven_day', TallyRun['agents']>
type Build = 'missing' | 'due' | 'always'

const stampsOf = (m: EvalMeter) => ({ five_hour: m.last.five_hour?.resetsAt ?? null, seven_day: m.last.seven_day?.resetsAt ?? null })
const meterOf = (m: EvalMeter, at: number) => ({ subscription: m.subscription, five_hour: intervalsOf(m, 'five_hour', at), seven_day: intervalsOf(m, 'seven_day', at) })
const tallyKey = (sid: string) => `${TALLY_PREFIX}${sid}`

function baselineOf(run: EvalRun) {
  const family = priceFamily(run.baseline.model)
  return family && run.baseline.effort ? { family, effort: run.baseline.effort } : null
}

function overallOf(t: TallyState, data: Data, last: EvalMeter, now: number): TallyOverall {
  const running = Object.values(t.runs).some(r => r.status === 'running')
  const meter = meterOf(last, now)
  const one = (baseline: TallyRun['baseline'], agents: TallyRun['agents']) =>
    estimateRun({ agents, baseline, ratios: data.ratios, prices: data.prices, meter, seed: seedOf('overall'), draws: DRAWS_RUNNING, running })
  const estimates = overallInput(t, stampsOf(last), now).groups.map((g: Pooled) => ({
    all: one(g.baseline, g.all),
    five_hour: one(g.baseline, g.five_hour),
    seven_day: one(g.baseline, g.seven_day)
  }))
  return { ...combine(estimates, { tally: t, meter: last, now }), windows: stampsOf(last), at: now }
}

let tallyQueue: Promise<void> = Promise.resolve()

type Ending = { key: string; status: string }

function noteTally($: EngineInterface, sid: string, run: TallyRun | null, build: Build, ifAbsent = false, ending: Ending | null = null) {
  const done = tallyQueue.then(() => tallyTurn($, sid, run, build, ifAbsent, ending)).catch(err => note($, 'tally', err))
  tallyQueue = done
  return done
}

async function tallyTurn($: EngineInterface, sid: string, run: TallyRun | null, build: Build, ifAbsent: boolean, ending: Ending | null) {
  if ((await $.session.id()) !== sid) return
  const data = await getData($)
  if (!data) return
  let t = await read($, tally)
  if (t.sid !== sid) {
    const stored = await $.store.get(tallyKey(sid))
    t = await update($, tally, cur => tallyFor(cur, sid, stored) as TallyState)
  }
  if (ending) {
    const was = t.runs[ending.key]?.status
    t = await update($, tally, cur => (cur.sid === sid ? (endTallyRun(cur, ending.key, ending.status) as TallyState) : cur))
    if (t.runs[ending.key]?.status !== was) build = 'always'
  }
  const dropped: string[] = []
  if (run) {
    t = await update($, tally, cur => {
      dropped.length = 0
      return cur.sid === sid ? (noteTallyRun(cur, run, { log: (line: string) => dropped.push(line), ifAbsent }) as TallyState) : cur
    })
  }
  if (t.sid !== sid) return
  const now = await $.clock.now()
  const due = build === 'always' || !t.overall || (build === 'due' && !(now - t.overall.at < OVERALL_EVERY_MS))
  if (due) {
    const overall = overallOf(t, data, (await read($, ev)).meter, now)
    t = await update($, tally, cur => (cur.sid === sid ? { ...cur, overall } : cur))
    if (t.sid !== sid) return
  }
  if ((run || due) && Object.keys(t.runs).length > 0) {
    await guard($, 'tally store', async () => {
      if (JSON.stringify(t).length <= TALLY_STORE_MAX) return $.store.set(tallyKey(sid), t)
      await $.store.delete(tallyKey(sid))
      dropped.push(TALLY_TOO_BIG)
    })
  }
  for (const line of dropped) $.ui.log(line, { to: 'debug' })
}

async function loadTally($: EngineInterface) {
  const sid = await $.session.id()
  const stored: Record<string, unknown> = {}
  for (const key of await $.store.keys()) if (key.startsWith(TALLY_PREFIX)) stored[key] = await $.store.get(key)
  for (const key of staleTallies(stored, tallyKey(sid), await $.clock.now())) await $.store.delete(key)
  await noteTally($, sid, null, 'always')
}

async function swapTally($: EngineInterface, ended: string) {
  const sid = await $.session.id()
  const next = sid === ended ? null : sid
  const stored = next === null ? undefined : await $.store.get(tallyKey(next))
  await update($, tally, cur => tallyFor(cur, next, stored) as TallyState)
}

async function readWindow($: EngineInterface, window: number) {
  const r = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  await update($, ctx, x => noteBreakdown(x, window, r?.context.breakdown))
}

async function noteWindow($: EngineInterface, context: { tokens?: number; window: number; percent?: number }) {
  let ask = false
  await update($, ctx, x => {
    const next = noteContext(x, context)
    ask = next.ask
    return next.state
  })
  return ask
}

let inflight = 0
const chain = new Map<string, Promise<void>>()
const written = new Map<string, string>()

function note($: EngineInterface, where: string, err: unknown) {
  try {
    $.ui.log(`ultraguard-eval: ${where}: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
  } catch {}
}

async function guard($: EngineInterface, where: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (err) {
    note($, where, err)
  }
}

async function loadGate($: EngineInterface, toolUseId: string) {
  let record: unknown = null
  try {
    const dir = await configDir($)
    const path = dir ? recordPath(dir, await $.session.id(), toolUseId, 'gate') : null
    if (path) record = JSON.parse(await $.fs.read(path))
  } catch {
    record = null
  }
  await update($, ev, s => noteGateRecord(s, toolUseId, record))
}

async function ensureGate($: EngineInterface, ids: Ids) {
  const id = gateWanted(await read($, ev), ids)
  if (id) await loadGate($, id)
}

function persist($: EngineInterface, key: string) {
  const done = (chain.get(key) ?? Promise.resolve())
    .then(async () => {
      const s = await read($, ev)
      const run = s.runs[key]
      if (!run) return
      const dir = await configDir($)
      const sid = await $.session.id()
      const path = dir ? recordPath(dir, sid, run.key, 'eval') : null
      if (!path) return
      const body = `${JSON.stringify({ session_id: sid, ...evalRecord(s, run) }, null, 2)}\n`
      if (written.get(path) === body) return
      await $.fs.write(path, body)
      written.set(path, body)
      cap(written)
    })
    .catch(err => note($, 'eval.json', err))
  chain.set(key, done)
  cap(chain)
  return done
}

async function endRuns($: EngineInterface, notices: Notice[]) {
  if (notices.length === 0) return
  const at = await $.clock.now()
  for (const n of notices) {
    const before = await read($, ev)
    const out = await update($, ev, s => noteRunEnd(s, { ...n, at }))
    const run = (n.toolUseId && out.runs[n.toolUseId]) || Object.values(out.runs).find(r => (n.toolUseId && r.toolUseId === n.toolUseId) || (n.taskId && r.taskId === n.taskId))
    if (!run && n.toolUseId) await guard($, 'orphan end', () => endOrphan($, n.toolUseId as string, n.status, at))
    if (!run || run.status === 'running') continue
    const fresh = before.runs[run.key]?.status === 'running'
    if (fresh) await guard($, 'savings', () => estimate($, run.key))
    await persist($, run.key)
    if (fresh) {
      await guard($, 'toast', async () => {
        const final = (await read($, ev)).runs[run.key]
        if (final) await $.ui.toast(toastText(runView(final)), { timeoutMs: TOAST_MS })
      })
    }
  }
}

async function endOrphan($: EngineInterface, key: string, status: string, at: number) {
  const sid = await $.session.id()
  await noteTally($, sid, null, 'missing', false, { key, status })
  const t = await read($, tally)
  if (t.sid !== sid || t.runs[key]?.status !== status) return
  const dir = await configDir($)
  const path = dir ? recordPath(dir, sid, key, 'eval') : null
  if (!path) return
  const ended = endedRecord(JSON.parse(await $.fs.read(path)), status, at)
  if (ended) await $.fs.write(path, `${JSON.stringify(ended, null, 2)}\n`)
}

async function reconcile($: EngineInterface) {
  if (activeRuns(await read($, ev)).length === 0) return
  const rows = await $.session.messages()
  await endRuns($, rows.slice(-40).filter(r => r.role === 'user').flatMap(r => parseTaskNotifications(r.text)))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await guard($, 'start', async () => {
      await $.command.register({ name: 'ultraguard', description: 'Open ultraguard-eval, the live check of running workflows' })
      const limits = JSON.parse(await $.fs.read(`${$.plugin.root}/policy/default.json`))?.limits
      const limit = limits?.maxConcurrentOpus
      await update($, ev, s => noteLimit(s, limit))
    })
    dataLoad = null
    await guard($, 'meter', () => loadMeter($))
    await guard($, 'tally', () => loadTally($))
    await guard($, 'context', async () => {
      const { context } = await $.session.usage()
      if (await noteWindow($, context)) await readWindow($, context.window)
    })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await guard($, 'measure', () => recordReading($, e.rateLimits))
    await guard($, 'tally', async () => noteTally($, await $.session.id(), null, 'missing'))
    let ask = false
    await guard($, 'context', async () => {
      ask = await noteWindow($, e.context)
    })
    const done = await next(e)
    if (ask) await guard($, 'context window', () => readWindow($, e.context.window))
    return done
  })

  on('command.run', { command: 'ultraguard' }, async $ => {
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'ultraguard-eval opened.' : `ultraguard-eval is not shown yet: ${opened.reason}` }
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await guard($, 'clear', async () => {
        const live = Object.values((await read($, ev)).runs).filter(r => r.status === 'running')
        const at = await $.clock.now()
        await update($, ev, s => hideFinished(endAllRuns(s, 'cleared', at)))
        for (const run of live) await persist($, run.key)
      })
    }
    const done = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') await guard($, 'swap tally', () => swapTally($, e.sessionId))
    return done
  })

  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const toolUseId = e.tool_use_id
    let sid = null as string | null
    await guard($, 'launch', async () => {
      sid = await $.session.id()
      const fingerprint = await fingerprintOf($, e).catch(() => null)
      const at = await $.clock.now()
      await update($, ev, s => noteLaunch(s, { toolUseId, fingerprint, at }))
    })
    const ran = await next(e)
    await guard($, 'launch result', async () => {
      const out = (ran.result ?? {}) as WorkflowOutput
      const isError = ran.deny !== undefined || ran.isError === true || typeof out.error === 'string'
      if (!isError) await ensureGate($, { toolUseId, runId: '' })
      const at = await $.clock.now()
      const name = out.workflowName || (out.summary ? out.summary.slice(0, 48) : null)
      const s = await update($, ev, st => noteLaunchResult(st, { toolUseId, isError, taskId: out.taskId ?? null, runId: out.runId ?? null, name, at }))
      const run = s.runs[toolUseId]
      if (!run) return
      await persist($, toolUseId)
      const entry = { key: toolUseId, status: run.status, baseline: baselineOf(run), agents: agentPieces(run), windows: stampsOf(s.meter), at }
      if (sid !== null) await noteTally($, sid, entry, 'always', true)
    })
    return ran
  })

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const ran = await next(e)
    await guard($, 'stop', async () => {
      const taskId = e.task_id ?? e.shell_id
      if (ran.deny !== undefined || ran.isError === true || typeof taskId !== 'string') return
      await endRuns($, [{ toolUseId: null, taskId, status: STOPPED }])
    })
    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    const workflow = e.workflow
    if (!workflow) return next(e)
    inflight += 1
    try {
      const started = await next(e)
      await guard($, 'spawn', async () => {
        const agentId = started.agentId
        if (started.deny !== undefined || !agentId) return
        const ids = { toolUseId: e.tool_use_id, runId: workflow.runId }
        await ensureGate($, ids)
        const at = await $.clock.now()
        const out = await update($, ev, s =>
          noteSpawn(s, { ...ids, agentId, label: e.description, askedModel: e.model ?? null, resolvedModel: started.model, parentModel: e.parentModel, at }),
        )
        await ensureGate($, ids)
        const key = runOfAgent(out, agentId)
        if (key) await persist($, key)
      })
      return started
    } finally {
      inflight -= 1
    }
  })

  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    if (agentId !== undefined) {
      await guard($, 'step', async () => {
        const before = await read($, ev)
        const args = { agentId, model: e.model, effort: e.effort }
        if (runOfAgent(before, agentId) === null && inflight === 0) return
        if (noteStep(before, args) === before) return
        const out = await update($, ev, s => noteStep(s, args))
        const key = runOfAgent(out, agentId)
        if (key) await persist($, key)
      })
    } else {
      await guard($, 'main step', async () => {
        const before = await read($, ev)
        const args = { model: e.model, effort: e.effort }
        if (noteMainStep(before, args) !== before) await update($, ev, s => noteMainStep(s, args))
        if (before.main.model !== null && typeof e.model === 'string' && before.main.model !== e.model) await update($, ctx, forgetCompactRead)
      })
    }
    const result = yield* next(e)
    await guard($, 'usage', async () => {
      if (!result.usage) return
      const data = await getData($)
      const own = agentId !== undefined && (runOfAgent(await read($, ev), agentId) !== null || inflight > 0)
      await update($, ev, s => noteUsage(s, { agentId: own ? agentId : undefined, effort: e.effort, usage: result.usage, prices: data?.prices }))
    })
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId === undefined) {
      await guard($, 'reconcile', () => reconcile($))
    } else {
      await guard($, 'complete', async () => {
        const before = await read($, ev)
        if (runOfAgent(before, agentId) === null && inflight === 0) return
        if (noteAgentDone(before, { agentId }) === before) return
        const out = await update($, ev, s => noteAgentDone(s, { agentId }))
        const key = runOfAgent(out, agentId)
        if (!key) return
        await guard($, 'savings', () => estimate($, key))
        await persist($, key)
      })
    }
    return next(e)
  })

  on('session.append', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.message.type !== 'assistant') {
      await guard($, 'notice', () => endRuns($, parseTaskNotifications(textOf(e.message.content))))
    }
    return done
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const state = await read($, ev)
    if (state.ui.run !== null) {
      await update($, ev, closeRun)
      if (e.origin.kind === 'person' && [...activeRuns(state), ...finishedRuns(state), ...stoppedRuns(state)].some(r => r.key === state.ui.run)) return { value: undefined }
    }
    await update($, ev, s => setStoppedOpen(s, false))
    return next(e)
  })

  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const element = e.element
    if (element !== undefined) await guard($, 'focus', () => update($, ev, s => noteFocus(s, element)))
    if (ringHeld !== (element !== undefined)) {
      ringHeld = element !== undefined
      await guard($, 'focus ring', async () => $.ui.invalidate('ui.render'))
    }
    const done = await next(e)
    if (element !== undefined) {
      await guard($, 'focus scroll', async () => {
        await $.ui.scroll({ to: { key: boxKeyOf(element) }, in: PANE })
      })
    }
    return done
  })

  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const state = await read($, ev).catch(() => null)
    const dir = arrowOf(e)
    const before = state?.ui.focus ?? null
    const target = state && dir !== 0 ? stepFocus(paneNav(state), before, dir) : null
    let moved = false
    if (target !== null) {
      await guard($, `arrow to ${target}`, async () => {
        await update($, ev, s => noteFocus(s, target))
        try {
          moved = (await $.ui.focus({ requestId: PANE, key: target })).deny === undefined
        } finally {
          if (!moved) await update($, ev, s => noteFocus(s, before))
        }
      })
    }
    if (moved) return {}
    const last = state && listShown(state) ? Math.max(0, e.contentRows - e.bodyRows - 1) : e.offset
    return e.offset > last ? next({ ...e, offset: last }) : next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const view = bandView(await read($, ev))
    if (!view) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Button key="open" plain onPress={() => openPane($)}>
          <Text color={tone(view.color === 'green')}>□</Text> <Text weight="bold">{TITLE}</Text> <Text dimColor>{bandText(view)}</Text>
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const line = lineOf(Text)
    const state = await read($, ev)
    const runs = activeRuns(state).map(r => runView(r))
    const finished = finishedRuns(state).map(r => runView(r))
    const stopped = stoppedRuns(state).map(r => runView(r))
    const open = [...runs, ...finished, ...stopped].find(v => v.key === state.ui.run)
    const { reachable, resting } = paneNav(state)
    const focusKey = reachable.includes(state.ui.focus ?? '') ? (state.ui.focus ?? null) : resting
    const picked = (key: string) => e.props.isFocused && ringHeld && focusKey === key
    const width = e.props.bodyColumns - 4
    const held = open ? null : await read($, tally)
    const overall = held?.overall && held.sid === (await $.session.id()) ? held.overall : null
    const stored = await read($, ctx)
    const wanted = open ? Boolean(open.saved) : overall?.status === 'estimated'
    const live = wanted ? await $.session.usage().then(u => u?.context ?? null, () => null) : null
    const context = contextFill(live ? { ...stored, window: live.window > 0 ? live.window : stored.window, tokens: typeof live.tokens === 'number' ? live.tokens : null } : stored)

    const counts = (c: { opus: number; sonnet: number; haiku: number }) => {
      const parts = (['opus', 'sonnet', 'haiku'] as const).filter(m => c[m] > 0)
      if (parts.length === 0) return <Text dimColor>no agents yet</Text>
      return (
        <Text>
          {parts.map((m, i) => (
            <Text>
              {i > 0 && <Text>{'  '}</Text>}
              <Text weight="bold" color={familyColor(m)}>{m}</Text>
              <Text dimColor>{` ${c[m]}`}</Text>
            </Text>
          ))}
        </Text>
      )
    }

    if (open) {
      const phases: EvalPhaseView[] | null = open.phases
      const column = open.saved ? agentColumn(open.saved) : null
      const section = (title: string, extra = '') => line(sectionHead(title, { extra, width }))
      const crumb = (
        <Text wrap="truncate-end">
          <Text weight="bold">{TITLE}</Text>
          <Text dimColor>{' › '}</Text>
          <Text weight="bold">{open.title}</Text>
          <Text dimColor>{`  ${open.shortId}`}</Text>
        </Text>
      )
      const checks = open.checks.map((c: { id: string; ok: boolean; title: string; reason: string | null; detail: string | null }) => (
        <Text wrap="truncate-end">
          <Text color={tone(c.ok)}>{c.ok ? '✓' : '✗'}</Text>
          {` ${c.title}`}
          {c.ok ? c.detail && <Text dimColor>{`  ${c.detail}`}</Text> : <Text color="error">{`  ${c.reason}`}</Text>}
        </Text>
      ))
      const top = (
        <Box flexDirection="column">
          {crumb}
          <Text> </Text>
          {open.saved && savedBlock(open.saved, { width, headWidth: width, context }).map(line)}
          {open.saved && <Text> </Text>}
        </Box>
      )
      const checksSection = (
        <Box flexDirection="column">
          {section(CHECKS_HEAD)}
          {checks}
          <Text> </Text>
        </Box>
      )
      const agentCount = agentsText(open.agents.length)

      const filled = (phases ?? []).filter(p => p.total > 0)
      const { field, savedAt, savedWidth, modelsAt } = phaseLayout({
        labels: open.agents.map((a: EvalAgentView) => a.label),
        heads: filled.map(phaseHeadLength),
        cells: column ? [...open.agents.map((a: EvalAgentView) => column.cell(a.agentId)), ...filled.map(p => column.group(p))] : [],
        header: column ? column.header : '',
        width
      })
      const savedCell = (text: string, color: string | undefined) => (column ? [tinted(Text, text, color), ' '.repeat(Math.max(0, savedWidth - text.length))] : [])
      const ranCell = (a: EvalAgentView) => [
        <Text weight="bold" color={modelColor(a.ranModel, a.ranEffort)}>{a.ranModel ?? '—'}</Text>,
        <Text dimColor>{` ${a.ranEffort ?? '—'}`}</Text>
      ]
      const agentRow = (a: EvalAgentView, lead: any) => (
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            {'    '}
            {lead}
            {` ${fit(a.label, field)}`}
            {savedCell(column ? column.cell(a.agentId) : '', column ? column.color(a.agentId) : undefined)}
            {ranCell(a)}
          </Text>
          {a.reason && <Text color="error" wrap="wrap">{`      ${a.reason}`}</Text>}
        </Box>
      )
      const headerRow = (indent: number) => (
        <Text dimColor wrap="truncate-end">{`${' '.repeat(indent)}${fit('agent', field)}${column ? fit(column.header, savedWidth) : ''}ran on`}</Text>
      )
      const backButton = () => (
        <Box key="box:back" {...ring(picked('back'))}>
          <Button key="back" label="back to the list" plain hotkey="b" autoFocus={filled.length === 0 ? true : undefined} onPress={() => update($, ev, closeRun)}>{ZERO_WIDTH}</Button>
          <Text>back to the list</Text>
        </Box>
      )

      if (phases) {
        const openOf = (p: EvalPhaseView) => phaseOpen(p, state.ui.folds)
        const anyFolded = filled.some(p => !openOf(p))
        const focusKey = (filled.find(p => p.state === 'running' || p.red > 0) ?? filled[0])?.key
        let follows = false
        const phaseBlock = (p: EvalPhaseView, first: boolean) => {
          const key = `phase:${p.key}`
          const isOpen = openOf(p)
          const here = picked(key)
          const sub = column ? column.group(p) : null
          const title = phaseTitle(p, savedAt)
          const head = phaseHeadLength({ ...p, title })
          const models = isOpen ? [] : modelLines(p.counts, Math.max(12, width - modelsAt))
          return (
            <Box key={`box:${key}`} flexDirection="column" marginTop={first ? 0 : -1} {...ring(here)}>
              <Box>
                <Button key={key} plain autoFocus={p.key === focusKey ? true : undefined} onPress={() => update($, ev, s => setFolds(s, [p.key], isOpen))}>{ZERO_WIDTH}</Button>
                <Text wrap="truncate-end">
                  <Text dimColor>{isOpen ? '▾' : '▸'}</Text>
                  {' '}
                  <Text color={tone(p.ok)}>{mark(here, '○', '●')}</Text>
                  {' '}
                  <Text weight="bold">{title}</Text>
                  <Text dimColor>{`  ${phaseStatus(p)}`}</Text>
                  {p.red > 0 && <Text color="error">{`  ${p.red} red`}</Text>}
                  {' '.repeat(Math.max(2, savedAt - head))}
                  {sub !== null && savedCell(sub, column?.groupColor(p))}
                  {models.length > 0 && line(models[0])}
                </Text>
              </Box>
              {models.slice(1).map(m => (
                <Text wrap="truncate-end">{' '.repeat(modelsAt)}{line(m)}</Text>
              ))}
              {isOpen && p.agents.map(a => agentRow(a, <Text color={tone(a.ok)}>{a.ok ? '✓' : '✗'}</Text>))}
            </Box>
          )
        }
        return (
          <Box flexDirection="column">
            {top}
            {section(PHASES_HEAD, agentCount)}
            {headerRow(8)}
            {phases.map(p => {
              if (p.total === 0) {
                follows = false
                return <Text dimColor wrap="truncate-end">{`      ${p.title}  ${p.state}`}</Text>
              }
              const block = phaseBlock(p, !follows)
              follows = true
              return block
            })}
            <Text dimColor>{'  ✓ ran as the gate approved  ✗ did not'}</Text>
            <Text> </Text>
            {checksSection}
            <Text dimColor>↑↓ choose  enter opens or folds a phase</Text>
            {filled.length > 0 && (
              <Box key="box:all" {...ring(picked('all'))}>
                <Button key="all" label={anyFolded ? 'expand all' : 'collapse all'} plain hotkey="a" onPress={() => update($, ev, s => setFolds(s, filled.map(p => p.key), !anyFolded))}>{ZERO_WIDTH}</Button>
                <Text>{anyFolded ? 'expand all' : 'collapse all'}</Text>
              </Box>
            )}
            {backButton()}
          </Box>
        )
      }

      return (
        <Box flexDirection="column">
          {top}
          {section(AGENTS_HEAD, agentCount)}
          {headerRow(6)}
          {open.agents.map((a: EvalAgentView) => agentRow(a, <Text color={tone(a.ok)}>□</Text>))}
          <Text> </Text>
          {checksSection}
          {backButton()}
        </Box>
      )
    }

    const all = [...runs, ...finished, ...stopped]
    const foldOpen = stoppedOpen(state)
    const agentsWidth = Math.max(12, ...runs.map(v => countsWidth(v.counts) + 2), ...[...finished, ...(foldOpen ? stopped : [])].map(v => endedText(v).length + 2))
    const cellWidth = Math.max(...[listHeader(all), ...all.map(v => listCell(v))].map(segs => segs.reduce((n, g) => n + g.text.length, 0)))
    const nameWidth = Math.max(12, Math.min(30, width - 9 - agentsWidth - cellWidth, Math.max(0, ...all.map(v => v.title.length + 4))))
    type Draw = (first: boolean) => any
    const runRow = (v: (typeof all)[number], live: boolean): Draw => first => {
      const rowKey = `run:${v.key}`
      const here = picked(rowKey)
      return (
        <Box key={boxKeyOf(rowKey)} marginTop={first ? 0 : -1} {...ring(here)}>
          <Button key={rowKey} plain autoFocus={rowKey === focusKey ? true : undefined} onPress={() => update($, ev, s => openRun(s, v.key))}>{ZERO_WIDTH}</Button>
          <Text wrap="truncate-end">
            <Text color={tone(v.ok)}>{mark(here, '□', '■')}</Text>
            {' '}
            <Text weight={here ? 'bold' : undefined}>{fit(v.title, nameWidth - 2)}</Text>
            <Text dimColor>{fit(v.shortId, 9)}</Text>
            {live ? <Text>{counts(v.counts)}{' '.repeat(Math.max(1, agentsWidth - countsWidth(v.counts)))}</Text> : <Text dimColor>{fit(endedText(v), agentsWidth)}</Text>}
            {v.ok ? line(listCell(v)) : <Text color="error">{v.reason}</Text>}
          </Text>
        </Box>
      )
    }
    const foldRow: Draw = first => {
      const here = picked(STOPPED_FOLD)
      return (
        <Box key={boxKeyOf(STOPPED_FOLD)} marginTop={first ? 0 : -1} {...ring(here)}>
          <Button key={STOPPED_FOLD} plain autoFocus={focusKey === STOPPED_FOLD ? true : undefined} onPress={() => update($, ev, s => setStoppedOpen(s, !stoppedOpen(s)))}>{ZERO_WIDTH}</Button>
          {line(foldLine({ open: foldOpen, count: stopped.length, picked: here }))}
        </Box>
      )
    }

    const items: { key: string; lines: number; row: boolean; first: boolean; draw: Draw }[] = []
    const group = (rows: { key: string; draw: Draw }[], head?: string) => {
      if (rows.length === 0) return
      if (head) items.push({ key: `head:${head}`, lines: 2, row: false, first: false, draw: () => <Box flexDirection="column"><Text> </Text>{line(subHead(head, { width }))}</Box> })
      rows.forEach((r, i) => items.push({ ...r, lines: i === 0 ? 3 : 2, row: true, first: i === 0 }))
    }
    const ended = (list: typeof all) => list.map(v => ({ key: `run:${v.key}`, draw: runRow(v, false) }))
    group(runs.map(v => ({ key: `run:${v.key}`, draw: runRow(v, true) })))
    group(ended(finished), FINISHED_TITLE)
    if (stopped.length > 0) group([{ key: STOPPED_FOLD, draw: foldRow }, ...(foldOpen ? ended(stopped) : [])])

    const overallLines = overall ? overallBlock(overall, { width, context }) : []
    const top = [
      <Text weight="bold">{TITLE}</Text>,
      <Text> </Text>,
      ...overallLines.map(line),
      ...(overallLines.length > 0 ? [<Text> </Text>] : []),
      line(sectionHead(WORKFLOWS_HEAD, { extra: RUNNING_EXTRA(runs.length), width })),
      ...(runs.length === 0 ? [<Text dimColor>{`  ${NO_RUNNING}`}</Text>] : []),
      ...(all.length > 0
        ? [
            <Text wrap="truncate-end">
              <Text dimColor>{`  ${fit('  workflow', nameWidth)}${fit('id', 9)}${fit('agents', agentsWidth)}`}</Text>
              {line(listHeader(all))}
            </Text>
          ]
        : [])
    ]
    const hint = !e.props.isFocused ? FOCUS_HINT : focusKey === STOPPED_FOLD ? FOLD_HINT(foldOpen) : LIST_HINT
    const bottom = all.length > 0 ? [<Text> </Text>, <Text dimColor>{hint}</Text>] : []
    const shown = listLayout({ items, bodyRows: e.props.scroll.bodyRows, fixed: top.length + bottom.length, focusKey, prevFrom: windowFrom.get(e.surface) })
    windowFrom.set(e.surface, shown.from)
    const more = (n: number, text: (n: number) => string) => (n > 0 ? <Text dimColor>{text(n)}</Text> : <Text> </Text>)
    return (
      <Box flexDirection="column">
        {top}
        {shown.windowed && more(shown.above, MORE_ABOVE)}
        {items.slice(shown.from, shown.to).map((it, i) => it.draw(it.first || i === 0))}
        {shown.windowed && more(shown.below, MORE_BELOW)}
        {bottom}
        {Array.from({ length: shown.pad }, () => <Text> </Text>)}
      </Box>
    )
  }).catch(($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text weight="bold">{TITLE}</Text>
        <Text color="error" wrap="wrap">{`draw failed (${next.error.kind}): ${next.error.message ?? 'no message'}`}</Text>
      </Box>
    )
  })
}
