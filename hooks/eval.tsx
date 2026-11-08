import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { EvalAgentView, EvalState } from '../types'
import { sha256Hex } from '../src/fingerprint.mjs'
import { recordPath } from '../src/record.mjs'
import {
  activeRuns,
  bandText,
  bandView,
  closeRun,
  createState,
  endAllRuns,
  evalRecord,
  gateWanted,
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
  runOfAgent,
  runView
} from '../src/eval.mjs'

const PANE = 'tierguard'
const TITLE = 'tierguard-eval'
const KEPT = 20

const ev = atom({ plugin: 'tierguard', key: 'eval' } as const, createState() as EvalState, { shape: 'eval-1' })

type Ids = { toolUseId: string; runId: string }
type Notice = { toolUseId: string | null | undefined; taskId: string | null | undefined; status: string }
type WorkflowOutput = { taskId?: string; runId?: string; workflowName?: string; summary?: string; error?: string }

const tone = (ok: boolean) => (ok ? 'success' : 'error')

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

let inflight = 0
const chain = new Map<string, Promise<void>>()
const written = new Map<string, string>()

function note($: EngineInterface, where: string, err: unknown) {
  try {
    $.ui.log(`tierguard-eval: ${where}: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
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
    const out = await update($, ev, s => noteRunEnd(s, { ...n, at }))
    const run = (n.toolUseId && out.runs[n.toolUseId]) || Object.values(out.runs).find(r => (n.toolUseId && r.toolUseId === n.toolUseId) || (n.taskId && r.taskId === n.taskId))
    if (run && run.status !== 'running') await persist($, run.key)
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
      await $.command.register({ name: 'tierguard', description: 'Open tierguard-eval, the live check of running workflows' })
      const limits = JSON.parse(await $.fs.read(`${$.plugin.root}/policy/default.json`))?.limits
      const limit = limits?.maxConcurrentOpus
      await update($, ev, s => noteLimit(s, limit))
    })
    return next(e)
  })

  on('command.run', { command: 'tierguard' }, async $ => {
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'tierguard-eval opened.' : `tierguard-eval is not shown yet: ${opened.reason}` }
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await guard($, 'clear', async () => {
        const live = Object.values((await read($, ev)).runs).filter(r => r.status === 'running')
        const at = await $.clock.now()
        await update($, ev, s => endAllRuns(s, 'cleared', at))
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
          noteSpawn(s, { ...ids, agentId, label: e.description, askedModel: e.model ?? null, resolvedModel: started.model, at }),
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
    }
    return yield* next(e)
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
        if (key) await persist($, key)
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
      if (e.origin.kind === 'person' && activeRuns(state).some(r => r.key === state.ui.run)) return { value: undefined }
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
    const state = await read($, ev)
    const runs = activeRuns(state).map(r => runView(r))
    const open = runs.find(v => v.key === state.ui.run)

    if (open) {
      return (
        <Box flexDirection="column">
          <Button key="back" label="back to the list" plain hotkey="b" autoFocus onPress={() => update($, ev, closeRun)} />
          <Text wrap="truncate-end">
            <Text color={tone(open.ok)}>■</Text>
            <Text weight="bold">{` ${open.title}`}</Text>
            <Text dimColor>{` · ${open.shortId} · ${open.countsText}`}</Text>
          </Text>
          {open.checks.map(c => (
            <Text wrap="truncate-end">
              <Text color={tone(c.ok)}>{c.ok ? '✓' : '✗'}</Text>
              {` ${c.title}`}
              {c.reason && <Text color="error">{` · ${c.reason}`}</Text>}
            </Text>
          ))}
          <Text dimColor>{`agents · approved → ran on (${open.agents.length})`}</Text>
          {open.agents.map((a: EvalAgentView) => (
            <Box flexDirection="column">
              <Text wrap="truncate-end">
                <Text color={tone(a.ok)}>■</Text>
                {` ${a.label}  `}
                <Text dimColor>{`${a.approved ?? '—'} → ${a.ran}`}</Text>
              </Text>
              {a.reason && <Text color="error" wrap="truncate-end">{`  ${a.reason}`}</Text>}
            </Box>
          ))}
        </Box>
      )
    }

    const view = bandView(state)
    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text weight="bold">{TITLE}</Text>
          <Text dimColor>{view ? ` · ${bandText(view)}` : ''}</Text>
        </Text>
        {runs.length === 0 && <Text dimColor>No workflow is running.</Text>}
        {runs.map((v, i) => (
          <Button key={`run:${v.key}`} plain autoFocus={i === 0 ? true : undefined} onPress={() => update($, ev, s => openRun(s, v.key))}>
            <Text color={tone(v.ok)}>■</Text>
            {` ${v.title} · ${v.shortId} · ${v.countsText} · `}
            {v.ok ? <Text dimColor>as approved</Text> : <Text color="error">{v.reason}</Text>}
          </Button>
        ))}
        {runs.length > 0 && <Text dimColor>{e.props.isFocused ? 'enter: details · esc: close' : 'ctrl+x tab: focus this pane'}</Text>}
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
