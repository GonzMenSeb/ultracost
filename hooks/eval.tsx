import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { EvalAgentView, EvalState } from '../types'
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
  noteMeterReading,
  noteRunEnd,
  noteSaved,
  noteSpawn,
  noteStep,
  noteStored,
  noteUsage,
  openRun,
  parseTaskNotifications,
  runOfAgent,
  runView
} from '../src/eval.mjs'
import { intervalsOf, staleKeys, storedValue } from '../src/meter.mjs'
import { loadPrices, priceFamily } from '../src/prices.mjs'
import { agentColumn, listCell, listHeader, savedBlock, toastText } from '../src/savedText.mjs'
import { estimateRun } from '../src/savings.mjs'
import { seedOf } from '../src/stats.mjs'

const PANE = 'ultraguard'
const TITLE = 'ultraguard-eval'
const KEPT = 20
const TOAST_MS = 8000
const DRAWS_RUNNING = 1000

const ev = atom({ plugin: 'ultraguard', key: 'eval' } as const, createState() as EvalState, { shape: 'eval-2' })

type Ids = { toolUseId: string; runId: string }
type Notice = { toolUseId: string | null | undefined; taskId: string | null | undefined; status: string }
type Segment = { text: string; style: string }
type Data = { prices: any; ratios: any }
type WorkflowOutput = { taskId?: string; runId?: string; workflowName?: string; summary?: string; error?: string }

const tone = (ok: boolean) => (ok ? 'success' : 'error')
const fit = (text: string, width: number) => (text.length > width ? `${text.slice(0, Math.max(0, width - 2))}… ` : text.padEnd(width))
const countsWidth = (c: { opus: number; sonnet: number; haiku: number }) => {
  const parts = (['opus', 'sonnet', 'haiku'] as const).filter(m => c[m] > 0).map(m => `${m} ${c[m]}`)
  return parts.length === 0 ? 'no agents yet'.length : parts.join(' · ').length
}
const MODEL_COLORS: Record<string, string> = { opus: '#c084fc', sonnet: '#60a5fa', haiku: '#2dd4bf', fable: '#fbbf24' }
const modelColor = (model: string | null) => (model && MODEL_COLORS[model]) || undefined


const lineOf = (Text: any, wrap: 'truncate-end' | 'wrap' = 'truncate-end') => (line: Segment[]) => (
  <Text wrap={wrap}>
    {line.map(g => (
      <Text weight={g.style === 'bold' ? 'bold' : undefined} dimColor={g.style === 'dim' ? true : undefined} color={MODEL_COLORS[g.style]}>
        {g.text}
      </Text>
    ))}
  </Text>
)

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
  const grew = (['five_hour', 'seven_day'] as const).some(k => after.meter.mine[k] !== before.meter.mine[k])
  if (grew) await $.store.set(`meter:${await $.session.id()}`, storedValue(after.meter))
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
  const family = priceFamily(run.baseline.model)
  const running = run.status === 'running'
  const saved = estimateRun({
    agents: agentPieces(run),
    baseline: family && run.baseline.effort ? { family, effort: run.baseline.effort } : null,
    ratios: data.ratios,
    prices: data.prices,
    meter: { subscription: s.meter.subscription, five_hour: intervalsOf(s.meter, 'five_hour', at), seven_day: intervalsOf(s.meter, 'seven_day', at) },
    seed: seedOf(run.key),
    ...(running ? { draws: DRAWS_RUNNING } : {}),
    running
  })
  await update($, ev, st => noteSaved(st, key, saved))
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
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await guard($, 'measure', () => recordReading($, e.rateLimits))
    return next(e)
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
    return next(e)
  })

  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const toolUseId = e.tool_use_id
    await guard($, 'launch', async () => {
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
      if (s.runs[toolUseId]) await persist($, toolUseId)
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
      if (e.origin.kind === 'person' && [...activeRuns(state), ...finishedRuns(state)].some(r => r.key === state.ui.run)) return { value: undefined }
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const view = bandView(await read($, ev))
    if (!view) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Button key="open" plain onPress={() => openPane($)}>
          <Text color={tone(view.color === 'green')}>■</Text> <Text weight="bold">{TITLE}</Text> <Text dimColor>{bandText(view)}</Text>
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const line = lineOf(Text)
    const wrapped = lineOf(Text, 'wrap')
    const state = await read($, ev)
    const runs = activeRuns(state).map(r => runView(r))
    const finished = finishedRuns(state).map(r => runView(r))
    const open = [...runs, ...finished].find(v => v.key === state.ui.run)
    const pair = (model: string | null, effort: string | null, width: number) => {
      const m = model ?? '—'
      const rest = ` · ${effort ?? '—'}`
      return (
        <Text>
          <Text color={modelColor(model)}>{m}</Text>
          <Text dimColor>{fit(rest, Math.max(0, width - m.length))}</Text>
        </Text>
      )
    }

    const counts = (c: { opus: number; sonnet: number; haiku: number }) => {
      const parts = (['opus', 'sonnet', 'haiku'] as const).filter(m => c[m] > 0)
      if (parts.length === 0) return <Text dimColor>no agents yet</Text>
      return (
        <Text>
          {parts.map((m, i) => (
            <Text>
              {i > 0 && <Text dimColor>{' · '}</Text>}
              <Text color={MODEL_COLORS[m]}>{`${m} ${c[m]}`}</Text>
            </Text>
          ))}
        </Text>
      )
    }

    if (open) {
      const labelWidth = Math.min(34, Math.max(12, ...open.agents.map((a: EvalAgentView) => a.label.length + 4)))
      const column = open.saved ? agentColumn(open.saved) : null
      const roomy = column !== null && labelWidth + 36 + column.header.length <= e.props.bodyColumns
      return (
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            <Text weight="bold">{TITLE}</Text>
            <Text dimColor>{' › '}</Text>
            <Text weight="bold">{open.title}</Text>
            <Text dimColor>{` · ${open.shortId}`}</Text>
          </Text>
          <Text> </Text>
          {open.checks.map((c: { id: string; ok: boolean; title: string; reason: string | null; detail: string | null }) => (
            <Text wrap="truncate-end">
              <Text color={tone(c.ok)}>{c.ok ? '✓' : '✗'}</Text>
              {` ${c.title}`}
              {c.ok ? c.detail && <Text dimColor>{`  ${c.detail}`}</Text> : <Text color="error">{`  ${c.reason}`}</Text>}
            </Text>
          ))}
          <Text> </Text>
          {open.saved && savedBlock(open.saved).map(wrapped)}
          {open.saved && <Text> </Text>}
          <Text dimColor wrap="truncate-end">{`${fit('  agent', labelWidth)}${fit('approved', 18)}${column ? fit('ran on', 18) : 'ran on'}${column ? (roomy ? column.header : 'saved') : ''}`}</Text>
          {open.agents.map((a: EvalAgentView) => (
            <Text wrap="truncate-end">
              <Text color={tone(a.ok)}>■</Text>
              {` ${fit(a.label, labelWidth - 2)}`}
              {pair(a.approvedModel, a.approvedEffort, 18)}
              {pair(a.ranModel, a.ranEffort, 18)}
              {column && <Text>{column.cell(a.agentId)}</Text>}
              {a.reason && <Text color="error">{`  ${a.reason}`}</Text>}
            </Text>
          ))}
          <Text> </Text>
          <Button key="back" label="back to the list" plain hotkey="b" autoFocus onPress={() => update($, ev, closeRun)} />
        </Box>
      )
    }

    const view = bandView(state)
    const all = [...runs, ...finished]
    const nameWidth = Math.min(30, Math.max(12, 12, ...all.map(v => v.title.length + 4)))
    const agentsWidth = Math.max(12, ...runs.map(v => countsWidth(v.counts) + 2))
    const row = (v: (typeof all)[number], i: number, ended: boolean) => (
      <Button key={`run:${v.key}`} plain autoFocus={i === 0 && !ended ? true : undefined} onPress={() => update($, ev, s => openRun(s, v.key))}>
        <Text color={tone(v.ok)}>■</Text>
        {` ${fit(v.title, nameWidth - 2)}`}
        <Text dimColor>{fit(v.shortId, 9)}</Text>
        {ended ? <Text dimColor>{fit(`done ${v.endedClock ?? ''}`.trim(), agentsWidth)}</Text> : <Text>{counts(v.counts)}{' '.repeat(Math.max(1, agentsWidth - countsWidth(v.counts)))}</Text>}
        {v.ok ? line(listCell(v)) : <Text color="error">{v.reason}</Text>}
      </Button>
    )
    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text weight="bold">{TITLE}</Text>
          <Text dimColor>{view ? ` · ${bandText(view)}` : ''}</Text>
        </Text>
        <Text> </Text>
        {runs.length === 0 && <Text dimColor>No workflow is running.</Text>}
        {all.length > 0 && (
          <Text wrap="truncate-end">
            <Text dimColor>{`${fit('  workflow', nameWidth)}${fit('id', 9)}${fit('agents', agentsWidth)}`}</Text>
            {line(listHeader(all))}
          </Text>
        )}
        {runs.map((v, i) => row(v, i, false))}
        {finished.length > 0 && <Text> </Text>}
        {finished.length > 0 && <Text dimColor>finished this session</Text>}
        {finished.map((v, i) => row(v, runs.length + i, true))}
        {all.length > 0 && <Text> </Text>}
        {all.length > 0 && <Text dimColor>{e.props.isFocused ? '↑↓ choose · enter details · esc close' : 'ctrl+x tab: focus this pane'}</Text>}
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
