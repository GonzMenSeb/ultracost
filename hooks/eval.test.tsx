import { expect, mock, test } from 'claude-code/testing'

import { sha256Hex } from '../src/fingerprint.mjs'

const SCRIPT = "export const meta = { name: 'map', description: 'x', phases: [] }\nawait agent('p', { label: 'investigate: map', model: 'sonnet', effort: 'high' })\n"
const CONFIG = '/cfg'
const SESSION = 'sess-1'
const SONNET = 'claude-sonnet-4-6'
const FULL: Record<string, string> = { opus: 'claude-opus-4-7', sonnet: SONNET, haiku: 'claude-haiku-4-5' }

const BAND = {
  plugin: 'ultraguard',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const PANE = {
  plugin: 'ultraguard',
  component: 'Pane',
  requestId: 'ultraguard',
  props: { title: 'ultraguard-eval', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const gateRecord = (toolUseId: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    v: 1,
    kind: 'gate',
    at: '2026-11-07T00:00:00.000Z',
    session_id: SESSION,
    tool_use_id: toolUseId,
    decision: 'pass',
    fingerprint: sha256Hex(SCRIPT),
    scriptPath: null,
    sessionModel: 'opus',
    maxOpus: 0,
    stages: [{ index: 0, line: 2, label: 'investigate: map', class: 'investigate', model: 'sonnet', effort: 'high', inFanout: false, bigFanout: false, verdict: false }],
    errors: [],
    ...over,
  })

const PRICES = { v: 1, families: { opus: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }, sonnet: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 } } }
const RATIOS = { v: 1, tau: 0.3, pooledAgentSd: { output: 0.4, fresh: 0.2, read: 0.6 }, measured: {}, steps: {}, priors: {} }

async function world($: any, on: any, options: { gate: boolean; launch?: Record<string, unknown>; record?: Record<string, unknown>; stop?: (e: any) => unknown; focus?: (e: any) => unknown }) {
  const writes: Record<string, string> = {}
  const logs: string[] = []
  const toasts: string[] = []
  const notices: unknown[] = []
  let toolUseId = ''
  let launches = 0
  mock.env(on, { CLAUDE_CONFIG_DIR: CONFIG })
  mock.clock(on, { now: 5000 })
  mock.store(on)
  on('session.id', () => ({ value: SESSION }))
  on('session.end', () => ({ sessionId: SESSION }))
  on('turn.complete', () => ({ text: '' }))
  on('session.messages', () => ({ value: notices }))
  on('ui.log', (_: any, e: any) => (logs.push(String(e.text)), { value: undefined }))
  on('ui.toast', (_: any, e: any) => (toasts.push(String(e.text)), { value: undefined }))
  on('fs.write', (_: any, e: any) => ((writes[e.path] = e.text), { value: undefined }))
  on('fs.read', (_: any, e: any) =>
    options.gate && e.path === `${CONFIG}/ultraguard/sessions/${SESSION}/${toolUseId}.gate.json`
      ? { value: gateRecord(toolUseId, options.record) }
      : String(e.path).endsWith('/saved/map.js')
        ? { value: SCRIPT }
        : String(e.path).endsWith('/data/prices.json')
          ? { value: JSON.stringify(PRICES) }
          : String(e.path).endsWith('/data/ratios.json')
            ? { value: JSON.stringify(RATIOS) }
            : { deny: `ENOENT ${e.path}` },
  )
  on('tool.call', (_: any, e: any) => {
    if (e.tool === 'TaskStop') return options.stop ? options.stop(e) : { result: { message: 'stopped', task_id: e.task_id, task_type: 'local_workflow' } }
    toolUseId = e.tool_use_id
    return { result: { status: 'async_launched', taskId: `w${(launches += 1)}`, runId: 'wf_run001', workflowName: 'map' } }
  })
  let spawned = 0
  on('agent.spawn', (_: any, e: any) => ({ model: FULL[String(e.model)] ?? SONNET, agentId: `a${(spawned += 1)}` }))
  on('ui.focus', (_: any, e: any) => (options.focus ? options.focus(e) : {}))
  on('ui.scroll', () => ({}))
  on('ui.close', () => ({ value: undefined }))
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.tool.call({ tool: 'Workflow', ...(options.launch ?? { script: SCRIPT }) })
  await $.agent.spawn({
    tool_use_id: toolUseId,
    prompt: 'p',
    description: 'investigate: map',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    model: 'sonnet',
    parentModel: 'claude-opus-4-7',
    background: true,
    fork: false,
    workflow: { runId: 'wf_run001', agentIndex: 1 },
  })
  const spawn = (description: string, model: string, agentIndex: number) =>
    $.agent.spawn({
      tool_use_id: toolUseId,
      prompt: 'p',
      description,
      subagentType: 'general-purpose',
      provider: { plugin: 'engine', tier: 'core' },
      model,
      parentModel: 'claude-opus-4-7',
      background: true,
      fork: false,
      workflow: { runId: 'wf_run001', agentIndex },
    })
  const launch = async () => {
    await $.tool.call({ tool: 'Workflow', script: SCRIPT })
    return toolUseId
  }
  const end = (id: string, status = 'completed') =>
    $.session.append({
      message: { type: 'user', content: [{ type: 'text', text: `<task-notification>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n</task-notification>` }] },
      door: 'queue',
      origin: { kind: 'task-notification' },
      uuid: `u-${id}`,
    })
  return { writes, logs, notices, toasts, id: () => toolUseId, spawn, launch, end }
}

const focus = ($: any, element: string) => $.ui.focus({ component: 'Pane', requestId: 'ultraguard', element, origin: { kind: 'person' } })
const shown = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? ''))
const ZERO_WIDTH = '\u200b'

test('a compliant workflow draws a green band and writes its eval record', async ($, on) => {
  const w = await world($, on, { gate: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Button' }))?.text).toContain('ultraguard-eval')
    expect((await ui.find({ type: 'Button' }))?.text).toContain('1 running');
    expect((await ui.find({ type: 'Text', text: '□' }))?.props.color).toBe('success')
    await ui.unmount()
  }

  expect(w.logs).toEqual([])
  const path = `${CONFIG}/ultraguard/sessions/${SESSION}/${w.id()}.eval.json`
  const record = JSON.parse(w.writes[path] ?? '{}')
  expect(record).toMatchObject({ kind: 'eval', status: 'running', ok: true, name: 'map', run_id: 'wf_run001', session_id: SESSION })
  expect(record.agents).toHaveLength(1)
})

test('a run with no gate record draws a red band', async ($, on) => {
  const w = await world($, on, { gate: false })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Button' }))?.text).toContain('ultraguard-eval')
    expect((await ui.find({ type: 'Button' }))?.text).toContain('1 running  1 red')
    expect((await ui.find({ type: 'Text', text: '□' }))?.props.color).toBe('error')
    await ui.unmount()
  }

  const record = JSON.parse(w.writes[`${CONFIG}/ultraguard/sessions/${SESSION}/${w.id()}.eval.json`] ?? '{}')
  expect(record).toMatchObject({ ok: false, reason: 'not approved by the gate' })
})

test('the pane lists the run and drills into its checks and agents', async ($, on) => {
  const w = await world($, on, { gate: false })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const row = await ui.find({ type: 'Box', key: `box:${w.id()}` })
    expect(row?.text).toContain('map')
    expect(row?.text).toContain('not approved by the gate')
    await ui.press({ key: `run:${w.id()}` })
    expect((await ui.find({ type: 'Text', text: /Approved by the gate/ }))?.text).toContain('✗')
    expect((await ui.find({ type: 'Text', text: /investigate: map/ }))?.text).toContain('sonnet')
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Button', key: `run:${w.id()}` })).toBeDefined()
    await ui.unmount()
  }
})

test('a completion notice takes the run off the band and the list', async ($, on) => {
  const w = await world($, on, { gate: true })
  await $.session.append({
    message: {
      type: 'user',
      content: [{ type: 'text', text: `<task-notification>\n<task-id>w1</task-id>\n<tool-use-id>${w.id()}</tool-use-id>\n<status>completed</status>\n</task-notification>` }],
    },
    door: 'queue',
    origin: { kind: 'task-notification' },
    uuid: 'u1',
  })

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(await band.find({ type: 'Button' })).toBeUndefined()
  await band.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /No workflow is running/ })).toBeDefined()
  await pane.unmount()

  const record = JSON.parse(w.writes[`${CONFIG}/ultraguard/sessions/${SESSION}/${w.id()}.eval.json`] ?? '{}')
  expect(record).toMatchObject({ status: 'completed', ok: true })
})

test('a survey keeps the band quiet', async ($, on) => {
  await world($, on, { gate: true })
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'terminal' })
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
})

test('a refused launch is not shown and the tool call is passed on untouched', async ($, on) => {
  mock.env(on, { CLAUDE_CONFIG_DIR: CONFIG })
  mock.clock(on, { now: 5000 })
  on('session.id', () => ({ value: SESSION }))
  on('ui.log', () => ({ value: undefined }))
  on('fs.read', (_: any, e: any) => ({ deny: `ENOENT ${e.path}` }))
  on('tool.call', () => ({ deny: 'refused by the gate' }))
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ran = await $.tool.call({ tool: 'Workflow', script: SCRIPT })
  expect(ran.deny).toBe('refused by the gate')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
})

test('a launch by scriptPath is fingerprinted from the file and stays green', async ($, on) => {
  const w = await world($, on, { gate: true, launch: { scriptPath: 'saved/map.js' } })
  expect(w.logs).toEqual([])
  expect(JSON.parse(w.writes[`${CONFIG}/ultraguard/sessions/${SESSION}/${w.id()}.eval.json`] ?? '{}').reason).toBe(null)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Button' }))?.text).toContain('1 running')
  expect((await ui.find({ type: 'Text', text: '□' }))?.props.color).toBe('success')
  await ui.unmount()
})

test('a script that is not the one the gate approved is red', async ($, on) => {
  await world($, on, { gate: true, launch: { script: `${SCRIPT}// edited after approval\n` } })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Button' }))?.text).toContain('1 red')
  await ui.unmount()
})

test('/ultraguard opens the pane and the policy limit applies to opus agents', async ($, on) => {
  const opened: unknown[] = []
  let toolUseId = ''
  mock.env(on, { CLAUDE_CONFIG_DIR: CONFIG })
  mock.clock(on, { now: 5000 })
  on('session.id', () => ({ value: SESSION }))
  on('ui.log', () => ({ value: undefined }))
  on('fs.write', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'ultraguard' } }))
  on('ui.open', (_: any, e: any) => (opened.push(e), { value: { isPlaced: true } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('fs.read', (_: any, e: any) =>
    String(e.path).endsWith('/policy/default.json')
      ? { value: JSON.stringify({ limits: { maxConcurrentOpus: 2, bigFanout: 3 } }) }
      : e.path === `${CONFIG}/ultraguard/sessions/${SESSION}/${toolUseId}.gate.json`
        ? { value: gateRecord(toolUseId, { stages: [{ index: 0, line: 2, label: 'design: ${…}', class: 'design', model: 'opus', effort: 'high' }] }) }
        : { deny: `ENOENT ${e.path}` },
  )
  on('tool.call', (_: any, e: any) => ((toolUseId = e.tool_use_id), { result: { status: 'async_launched', taskId: 'w1', runId: 'wf_run001', workflowName: 'map' } }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-4-7', agentId: `a${(n += 1)}` }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'ultraguard', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  expect(ran.text).toBe('ultraguard-eval opened.')
  expect(opened).toEqual([{ id: 'ultraguard', title: 'ultraguard-eval', focus: true, closeOnEscape: true }])

  await $.tool.call({ tool: 'Workflow', script: SCRIPT })
  for (let i = 1; i <= 3; i++) {
    await $.agent.spawn({
      tool_use_id: toolUseId,
      prompt: 'p',
      description: `design: part ${i}`,
      subagentType: 'general-purpose',
      provider: { plugin: 'engine', tier: 'core' },
      model: 'opus',
      parentModel: 'claude-opus-4-7',
      background: true,
      fork: false,
      workflow: { runId: 'wf_run001', agentIndex: i },
    })
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `run:${toolUseId}` })
  expect((await ui.find({ type: 'Text', text: /At most 2 Opus at once/ }))?.text).toContain('✗')
  await ui.unmount()
})

test('a clear ends the running workflows', async ($, on) => {
  const w = await world($, on, { gate: true })
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
  const record = JSON.parse(w.writes[`${CONFIG}/ultraguard/sessions/${SESSION}/${w.id()}.eval.json`] ?? '{}')
  expect(record.status).toBe('cleared')
})

test('a completion notice the append hook never saw still ends the run at the next main turn', async ($, on) => {
  const w = await world($, on, { gate: true })
  w.notices.push({ role: 'user', text: `<task-notification>\n<task-id>w1</task-id>\n<tool-use-id>${w.id()}</tool-use-id>\n<status>killed</status>\n</task-notification>`, toolUses: [] })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
  const record = JSON.parse(w.writes[`${CONFIG}/ultraguard/sessions/${SESSION}/${w.id()}.eval.json`] ?? '{}')
  expect(record.status).toBe('killed')
})

const stopRun = ($: any, input: Record<string, unknown>) => $.tool.call({ tool: 'TaskStop', ...input })
const evalRecordOf = (w: { writes: Record<string, string>; id: () => string }) => JSON.parse(w.writes[`${CONFIG}/ultraguard/sessions/${SESSION}/${w.id()}.eval.json`] ?? '{}')
const bandRunning = async ($: any) => {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const text = (await ui.find({ type: 'Button' }))?.text ?? null
  await ui.unmount()
  return text
}

test('a workflow stopped with TaskStop ends as stopped, gets its estimate, record and toast', async ($, on) => {
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  const w = await world($, on, { gate: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(evalRecordOf(w).savings.saved).toBe(null)

  const ran = await stopRun($, { task_id: 'w1' })
  expect(ran.result).toMatchObject({ message: 'stopped', task_id: 'w1' })
  expect(await bandRunning($)).toBe(null)
  const record = evalRecordOf(w)
  expect(record.status).toBe('killed')
  expect(record.savings.saved).toMatchObject({ running: false })
  expect(w.toasts).toEqual(['ultraguard: map stopped'])
})

test('a TaskStop by the deprecated shell_id stops the workflow too', async ($, on) => {
  const w = await world($, on, { gate: true })
  await stopRun($, { shell_id: 'w1' })
  expect(evalRecordOf(w).status).toBe('killed')
})

test('a TaskStop of another task, a denied one or a failed one leaves the workflow running', async ($, on) => {
  let answer: (e: any) => unknown = (e: any) => ({ result: { message: 'stopped', task_id: e.task_id, task_type: 'local_bash' } })
  const w = await world($, on, { gate: true, stop: e => answer(e) })
  await stopRun($, { task_id: 'b7' })
  answer = () => ({ deny: 'not allowed' })
  expect((await stopRun($, { task_id: 'w1' })).deny).toBe('not allowed')
  answer = () => ({ result: 'No task found with ID: w1', isError: true })
  await stopRun($, { task_id: 'w1' })
  expect(await bandRunning($)).toContain('1 running')
  expect(evalRecordOf(w).status).toBe('running')
  expect(w.toasts).toEqual([])
})

test('a notice after the TaskStop leaves the run stopped and toasts once', async ($, on) => {
  const w = await world($, on, { gate: true })
  await stopRun($, { task_id: 'w1' })
  await $.session.append({
    message: {
      type: 'user',
      content: [{ type: 'text', text: `<task-notification>\n<task-id>w1</task-id>\n<tool-use-id>${w.id()}</tool-use-id>\n<status>completed</status>\n</task-notification>` }],
    },
    door: 'queue',
    origin: { kind: 'task-notification' },
    uuid: 'u1',
  })
  expect(evalRecordOf(w).status).toBe('killed')
  expect(w.toasts).toEqual(['ultraguard: map stopped'])
})

test('a run open in the pane stays open when it is stopped', async ($, on) => {
  const w = await world($, on, { gate: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `run:${w.id()}` })
  await stopRun($, { task_id: 'w1' })
  expect(evalRecordOf(w).status).toBe('killed')
  expect(await ui.find({ type: 'Text', text: /^ultraguard-eval › map/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Approved by the gate/ })).toBeDefined()
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Text', text: /^ultraguard-eval › map/ })).toBeUndefined()
  await ui.unmount()
})

const PHASED = {
  phases: ['Collect', 'Decide'],
  stages: [
    { index: 0, line: 2, label: 'investigate: map', class: 'investigate', model: 'sonnet', effort: 'high', inFanout: false, bigFanout: false, verdict: false, phase: 'Collect' },
    { index: 1, line: 3, label: 'decide: pick', class: 'decide', model: 'opus', effort: 'high', inFanout: false, bigFanout: false, verdict: false, phase: 'Decide' },
  ],
}

test('the detail groups agents under phases that start collapsed and open with enter', async ($, on) => {
  const w = await world($, on, { gate: true, record: PHASED })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: `run:${w.id()}` })

    const header = await ui.find({ type: 'Text', text: /^▸ ● Collect/ })
    expect(header?.text).toContain('Collect  running  0 of 1 done')
    expect(header?.text).toContain('sonnet 1')
    expect((await ui.find({ type: 'Button', key: 'phase:Collect' }))?.text).toBe(ZERO_WIDTH)
    expect((await ui.find({ type: 'Text', text: /^●$/ }))?.props.color).toBe('success')
    expect(await ui.find({ type: 'Text', text: /^ {4}✓ investigate: map/ })).toBeUndefined()
    const decide = await ui.find({ type: 'Text', text: /Decide/ })
    expect(decide?.text).toMatch(/^ {6}Decide {2}not started$/)
    expect(decide?.props.dimColor).toBe(true)
    expect(await ui.find({ type: 'Button', key: 'phase:Decide' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /ran as the gate approved/ }))?.text).toBe('  ✓ ran as the gate approved  ✗ did not')
    expect(await ui.find({ type: 'Text', text: 'expand all' })).toBeDefined()

    await ui.press({ key: 'phase:Collect' })
    expect((await ui.find({ type: 'Text', text: /^▾ ● Collect/ }))?.text).not.toContain('sonnet')
    expect(await ui.find({ type: 'Text', text: /^ {4}✓ investigate: map/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'collapse all' })).toBeDefined()

    await ui.press({ key: 'all' })
    expect(await ui.find({ type: 'Text', text: /^▸ ● Collect/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ {4}✓ investigate: map/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'expand all' })).toBeDefined()

    await ui.press({ key: 'phase:Collect' })
    await ui.press({ key: 'back' })
    await ui.press({ key: `run:${w.id()}` })
    expect(await ui.find({ type: 'Text', text: /^▸ ● Collect/ })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('the run view draws the phases under a section head, then the checks, then the hint and buttons', async ($, on) => {
  const w = await world($, on, { gate: true, record: PHASED })
  await w.spawn('decide: pick', 'opus', 2)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `run:${w.id()}` })
  const texts = await shown(ui)
  const at = (pattern: RegExp) => texts.findIndex(t => pattern.test(t))
  const steps = [
    /^ultraguard-eval › map/,
    /^══ phases {2}2 agents ═+$/,
    /^ +agent\s+ran on$/,
    /^▸ ● Collect/,
    /^▸ ○ Decide/,
    /^ {2}✓ ran as the gate approved {2}✗ did not$/,
    /^══ checks ═+$/,
    /Approved by the gate/,
    /At most \d+ Opus at once/,
    /^↑↓ choose {2}enter opens or folds a phase$/,
    /^expand all$/,
    /^back to the list$/,
  ].map(at)
  expect(steps.every(i => i > -1)).toBe(true)
  expect(steps).toEqual([...steps].sort((a, b) => a - b))
  expect(texts.filter(t => /^══ /.test(t)).map(t => t.length)).toEqual([PANE.props.bodyColumns - 4, PANE.props.bodyColumns - 4])
  expect(await ui.find({ type: 'Text', text: /^▾ / })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'phase:Collect' }))?.props.autoFocus).toBe(true)
  expect((await ui.find({ type: 'Button', key: 'phase:Decide' }))?.props.autoFocus).toBeUndefined()
  await ui.unmount()
})

test('an agent that broke the plan turns its phase red and says why on its own line', async ($, on) => {
  const w = await world($, on, { gate: true, record: { phases: ['Map'], stages: [{ ...PHASED.stages[0], model: 'opus', phase: 'Map' }] } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `run:${w.id()}` })

  expect((await ui.find({ type: 'Text', text: /^▸ ● Map/ }))?.text).toContain('  1 red')
  expect((await ui.find({ type: 'Text', text: /^●$/ }))?.props.color).toBe('error')
  expect(await ui.find({ type: 'Text', text: /^ {4}✗ investigate: map/ })).toBeUndefined()
  await ui.press({ key: 'phase:Map' })
  expect(await ui.find({ type: 'Text', text: /^ {4}✗ investigate: map/ })).toBeDefined()
  const reason = await ui.find({ type: 'Text', text: /^ {6}agent "investigate: map" ran on sonnet, the gate approved opus/ })
  expect(reason?.props.color).toBe('error')
  await ui.unmount()
})

test('a gate with no phases keeps the flat agent table', async ($, on) => {
  const w = await world($, on, { gate: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `run:${w.id()}` })
  expect(await ui.find({ type: 'Button', key: 'all' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}□ investigate: map\s+sonnet —$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ +agent\s+ran on$/ })).toBeDefined()
  const texts = await shown(ui)
  const steps = [/^ultraguard-eval › map/, /^══ agents {2}1 agent ═+$/, /^ +agent\s+ran on$/, /^ {4}□ investigate: map/, /^══ checks ═+$/, /Approved by the gate/, /^back to the list$/].map(p => texts.findIndex(t => p.test(t)))
  expect(steps.every(i => i > -1)).toBe(true)
  expect(steps).toEqual([...steps].sort((a, b) => a - b))
  expect(texts.filter(t => /^══ /.test(t)).map(t => t.length)).toEqual([PANE.props.bodyColumns - 4, PANE.props.bodyColumns - 4])
  expect(await ui.find({ type: 'Text', text: /^══ phases/ })).toBeUndefined()
  await ui.unmount()
})

test('a run no one has focused only reserves the room of the outline, and its button is an invisible anchor', async ($, on) => {
  const w = await world($, on, { gate: true })
  const ui = await $.ui.mount({ ...BAND_FREE_PANE, surface: 'terminal' })
  const rest = await ui.find({ type: 'Box', key: `box:${w.id()}` })
  expect(rest?.props.borderStyle).toBeUndefined()
  expect(rest?.props.paddingX).toBe(2)
  expect(rest?.props.paddingY).toBe(1)
  expect(rest?.props.backgroundColor).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: `run:${w.id()}` }))?.text).toBe(ZERO_WIDTH)
  expect(await ui.find({ type: 'Text', text: '□' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '■' })).toBeUndefined()
  await ui.unmount()
})

test('the focused phase block is drawn inside the round outline with a filled circle, the others stay hollow', async ($, on) => {
  const stages = [...PHASED.stages]
  const w = await world($, on, { gate: true, record: { ...PHASED, stages: [{ ...stages[0], phase: 'Collect' }, { ...stages[1], phase: 'Decide' }] } })
  await w.spawn('decide: pick', 'opus', 2)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `run:${w.id()}` })

  const collect = async () => ui.find({ type: 'Box', key: 'box:phase:Collect' })
  const decide = async () => ui.find({ type: 'Box', key: 'box:phase:Decide' })
  expect((await collect())?.props).toMatchObject({ borderStyle: 'round', borderColor: 'text', paddingX: 1, paddingY: 0, marginTop: 0 })
  expect((await collect())?.text).toContain('●')
  expect((await decide())?.props).toMatchObject({ paddingX: 2, paddingY: 1, marginTop: -1 })
  expect((await decide())?.props.borderStyle).toBeUndefined()
  expect((await decide())?.text).toContain('○')
  expect((await decide())?.text).not.toContain('●')
  expect((await ui.find({ type: 'Button', key: 'phase:Decide' }))?.text).toBe(ZERO_WIDTH)

  await focus($, 'phase:Decide')
  expect((await decide())?.props).toMatchObject({ borderStyle: 'round', borderColor: 'text', paddingX: 1, paddingY: 0, marginTop: -1 })
  expect((await decide())?.text).toContain('●')
  expect((await collect())?.props.borderStyle).toBeUndefined()
  expect((await collect())?.text).toContain('○')

  expect((await ui.find({ type: 'Box', key: 'box:back' }))?.props.borderStyle).toBeUndefined()
  await focus($, 'back')
  expect((await ui.find({ type: 'Box', key: 'box:back' }))?.props).toMatchObject({ borderStyle: 'round', borderColor: 'text', paddingX: 1, paddingY: 0 })
  expect((await decide())?.props.borderStyle).toBeUndefined()
  await focus($, 'all')
  expect((await ui.find({ type: 'Box', key: 'box:all' }))?.props).toMatchObject({ borderStyle: 'round', borderColor: 'text', paddingX: 1, paddingY: 0 })
  expect((await ui.find({ type: 'Box', key: 'box:back' }))?.props.borderStyle).toBeUndefined()
  await ui.unmount()
})

const BAND_FREE_PANE = { ...PANE, props: { ...PANE.props, isFocused: false } }

test('the focused run row is drawn inside the round outline with a filled square', async ($, on) => {
  const w = await world($, on, { gate: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Box', key: `box:${w.id()}` }))?.props).toMatchObject({ borderStyle: 'round', borderColor: 'text', paddingX: 1, paddingY: 0 })
  expect(await ui.find({ type: 'Text', text: '■' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '□' })).toBeUndefined()
  await ui.unmount()
})

test('the flat table gives its back button the outline too, and its header lines up with the rows', async ($, on) => {
  const w = await world($, on, { gate: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `run:${w.id()}` })
  expect((await ui.find({ type: 'Box', key: 'box:back' }))?.props).toMatchObject({ borderStyle: 'round', paddingX: 1, paddingY: 0 })
  const header = (await ui.find({ type: 'Text', text: /^ +agent\s+ran on$/ }))?.text ?? ''
  const row = (await ui.find({ type: 'Text', text: /^ {4}□ investigate: map/ }))?.text ?? ''
  expect(header.indexOf('agent')).toBe(row.indexOf('investigate'))
  expect(header.indexOf('ran on')).toBe(row.indexOf('sonnet'))
  await ui.unmount()
})

test('a phase block after a not started phase does not pull its margin onto that row', async ($, on) => {
  const stages = [
    { ...PHASED.stages[0], phase: 'Collect' },
    { ...PHASED.stages[1], phase: 'Decide' },
  ]
  const w = await world($, on, { gate: true, record: { phases: ['Collect', 'Mid', 'Decide'], stages } })
  await w.spawn('decide: pick', 'opus', 2)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `run:${w.id()}` })
  expect((await ui.find({ type: 'Box', key: 'box:phase:Collect' }))?.props.marginTop).toBe(0)
  expect((await ui.find({ type: 'Box', key: 'box:phase:Decide' }))?.props.marginTop).toBe(0)
  await ui.unmount()
})

test('a red run keeps the pane header free of middle dots', async ($, on) => {
  await world($, on, { gate: false })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Text', text: /running/ })).every((t: any) => !t.text.includes('·'))).toBe(true)
  await ui.unmount()
})

const THREE = {
  phases: ['Collect'],
  stages: [
    { index: 0, line: 2, label: 'investigate: map', class: 'investigate', model: 'sonnet', effort: 'high', inFanout: false, bigFanout: false, verdict: false, phase: 'Collect' },
    { index: 1, line: 3, label: 'decide: pick', class: 'decide', model: 'opus', effort: 'high', inFanout: false, bigFanout: false, verdict: false, phase: 'Collect' },
    { index: 2, line: 4, label: 'grunt: tidy', class: 'grunt', model: 'haiku', effort: 'medium', inFanout: false, bigFanout: false, verdict: false, phase: 'Collect' },
  ],
}

const threeModels = async ($: any, on: any) => {
  const w = await world($, on, { gate: true, record: THREE })
  await w.spawn('decide: pick', 'opus', 2)
  await w.spawn('grunt: tidy', 'haiku', 3)
  return w
}

test('a folded phase lists its models in order after the status, name bold in its family color and count dim', async ($, on) => {
  const w = await threeModels($, on)
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 100 }, surface: 'terminal' })
  await ui.press({ key: `run:${w.id()}` })

  const head = await ui.find({ type: 'Text', text: /^▸ ● Collect/ })
  expect(head?.text).toMatch(/Collect {2}running {2}0 of 3 done\s+opus 1 {2}sonnet 1 {2}haiku 1$/)
  const box = await ui.find({ type: 'Box', key: 'box:phase:Collect' })
  expect(box?.text).not.toMatch(/\n/)
  const opus = await ui.findAll({ type: 'Text', text: /^opus$/ })
  expect(opus.at(-1)?.props.weight).toBe('bold')
  expect(opus.at(-1)?.props.color).toBe('#e2484f')
  const haiku = await ui.findAll({ type: 'Text', text: /^haiku$/ })
  expect(haiku.at(-1)?.props.weight).toBe('bold')
  expect((await ui.findAll({ type: 'Text', text: /^ 1$/ })).at(-1)?.props.dimColor).toBe(true)
  await ui.press({ key: 'phase:Collect' })
  expect((await ui.find({ type: 'Text', text: /^▾ ● Collect/ }))?.text).not.toMatch(/opus|haiku/)
  await ui.unmount()
})

test('a folded phase wraps its models onto continuation lines at the same column on a narrow pane', async ($, on) => {
  const w = await threeModels($, on)
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 59 }, surface: 'terminal' })
  await ui.press({ key: `run:${w.id()}` })

  const head = (await ui.find({ type: 'Text', text: /^▸ ● Collect/ }))?.text ?? ''
  const at = head.indexOf('opus 1')
  expect(at).toBeGreaterThan(0)
  expect(head).toMatch(/opus 1 {2}sonnet 1$/)
  expect(head).not.toContain('haiku')
  const rest = (await ui.find({ type: 'Text', text: /^ +haiku 1$/ }))?.text ?? ''
  expect(rest.indexOf('haiku')).toBe(at)
  await ui.unmount()
})

test('the pane text has no middle dot separators', async ($, on) => {
  const w = await world($, on, { gate: true, record: PHASED })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const list = await shown(ui)
  expect(list.join('\n')).not.toContain(' · ')
  expect(list).toContain('↑↓ choose  enter details  esc close')
  await ui.press({ key: `run:${w.id()}` })
  const detail = await shown(ui)
  expect(detail.join('\n')).not.toContain(' · ')
  expect(detail).toContain(`ultraguard-eval › map  run001`)
  expect(detail).toContain('↑↓ choose  enter opens or folds a phase')
  expect(detail.find(t => /Approved by the gate/.test(t))).toMatch(/\d\d:\d\d:\d\d {2}script fingerprint matches$/)
  expect(detail.find(t => /Every agent matches the plan/.test(t))).toMatch(/ {2}1 agent$/)
  await ui.press({ key: 'phase:Collect' })
  expect((await shown(ui)).join('\n')).not.toContain(' · ')
  await ui.unmount()
})

test('the model in a row is bold in its family color and the count stays dim', async ($, on) => {
  await world($, on, { gate: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const name = await ui.find({ type: 'Text', text: /^sonnet$/ })
  expect(name?.props.weight).toBe('bold')
  expect(name?.props.color).toBe('#f48815')
  expect((await ui.find({ type: 'Text', text: /^ 1$/ }))?.props.dimColor).toBe(true)
  await ui.unmount()
})

const arrow = ($: any, by: number) =>
  $.ui.scroll({ component: 'Pane', requestId: 'ultraguard', offset: 0, by, bodyRows: PANE.props.scroll.bodyRows, contentRows: 100, origin: { kind: 'person' } })
const rowBoxes = async (ui: any) => (await ui.findAll({ type: 'Box' })).filter((b: any) => /^box:/.test(String(b.key ?? '')))
const runButtons = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: any) => String(b.key)).filter((k: string) => k.startsWith('run:'))
const ringed = async (ui: any) => (await rowBoxes(ui)).filter((b: any) => b.props.borderStyle === 'round').map((b: any) => String(b.key))
const CLOSER = {
  name: 'closer',
  register: (on: any) => {
    on('ui.render', { component: 'Pane', requestId: 'closer' }, async ($: any, e: any) => {
      const { Box, Button } = $.ui.resolve(e)
      return (
        <Box>
          <Button key="close" plain onPress={() => $.ui.close({ id: 'ultraguard' })}>close</Button>
        </Box>
      )
    })
  },
}
const closePane = async ($: any) => {
  const closer = await $.ui.mount({ ...PANE, plugin: 'closer', requestId: 'closer', surface: 'terminal' })
  await closer.press({ key: 'close' })
  await closer.unmount()
}
const shortPane = (bodyRows: number) => ({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows } } })
const moreOf = (texts: string[], arrowGlyph: string) => Number(texts.find(t => t.startsWith(`  ${arrowGlyph} `))?.match(/(\d+) more$/)?.[1] ?? 0)

test('the list draws its title, the overall head, the workflows head, the column header, the rows and the hint in that order', async ($, on) => {
  await world($, on, { gate: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts = await shown(ui)
  const steps = [
    /^ultraguard-eval$/,
    /^══ overall savings for this session so far ═+$/,
    /^══ workflows {2}1 running ═+$/,
    /workflow\s+id\s+agents/,
    /^■ map/,
    /^↑↓ choose {2}enter details {2}esc close$/,
  ].map(p => texts.findIndex(t => p.test(t)))
  expect(steps.every(i => i > -1)).toBe(true)
  expect(steps).toEqual([...steps].sort((a, b) => a - b))
  expect(texts.filter(t => /^══ /.test(t)).map(t => t.length)).toEqual([PANE.props.bodyColumns - 4, PANE.props.bodyColumns - 4])
  expect(texts.some(t => /more$/.test(t))).toBe(false)
  expect(await ui.find({ type: 'Text', text: /No workflow is running/ })).toBeUndefined()
  await ui.unmount()
})

test('with no workflow at all the list says none is running and draws no header or hint', async ($, on) => {
  on('ui.log', () => ({ value: undefined }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts = await shown(ui)
  expect(texts.filter(t => /^══ /.test(t))).toEqual([`══ workflows  none running ${'═'.repeat(PANE.props.bodyColumns - 4 - 27)}`])
  expect(texts).toContain('  No workflow is running.')
  expect(texts.some(t => /workflow\s+id\s+agents/.test(t))).toBe(false)
  expect(texts.some(t => /^↑↓ choose/.test(t))).toBe(false)
  await ui.unmount()
})

test('list rows take two lines: the first of a group has no margin, the rest overlap by one, and the picked row keeps the outline', async ($, on) => {
  const w = await world($, on, { gate: true })
  await w.launch()
  const third = await w.launch()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = await rowBoxes(ui)
  expect(rows).toHaveLength(3)
  expect(rows[0]?.props).toMatchObject({ marginTop: 0, borderStyle: 'round', borderColor: 'text', paddingX: 1, paddingY: 0 })
  expect(rows[1]?.props).toMatchObject({ marginTop: -1, paddingX: 2, paddingY: 1 })
  expect(rows[1]?.props.borderStyle).toBeUndefined()
  expect(rows[2]?.props.marginTop).toBe(-1)

  const second = String(rows[1]?.key).slice(4)
  await focus($, `run:${second}`)
  expect((await ui.find({ type: 'Box', key: `box:${second}` }))?.props).toMatchObject({ marginTop: -1, borderStyle: 'round', borderColor: 'text', paddingX: 1, paddingY: 0 })
  expect(await ringed(ui)).toEqual([`box:${second}`])

  await w.end(third)
  const texts = await shown(ui)
  expect(texts.find(t => /finished this session/.test(t))).toBe(`─ finished this session ${'─'.repeat(PANE.props.bodyColumns - 4 - 24)}`)
  expect((await ui.find({ type: 'Box', key: `box:${third}` }))?.props.marginTop).toBe(0)
  await ui.unmount()
})

test('the stopped runs sit in a fold that opens with enter, keeps open through a run view, and folds again when the pane closes', { plugins: [CLOSER as any] }, async ($, on) => {
  const w = await world($, on, { gate: true })
  const running = w.id()
  const first = await w.launch()
  const second = await w.launch()
  await w.end(first, 'killed')
  await w.end(second, 'killed')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const fold = await ui.find({ type: 'Box', key: 'box:fold:stopped' })
  expect(fold?.text).toContain('▸ stopped this session  2 workflows')
  expect(fold?.props.marginTop).toBe(0)
  expect((await ui.find({ type: 'Button', key: 'fold:stopped' }))?.text).toBe(ZERO_WIDTH)
  expect(await runButtons(ui)).toEqual([`run:${running}`])

  await ui.press({ key: 'fold:stopped' })
  expect((await ui.find({ type: 'Box', key: 'box:fold:stopped' }))?.text).toContain('▾ stopped this session  2 workflows')
  for (const id of [first, second]) {
    const row = await ui.find({ type: 'Box', key: `box:${id}` })
    expect(row?.text).toMatch(/stopped \d\d:\d\d/)
    expect(row?.props.marginTop).toBe(-1)
  }

  await ui.press({ key: `run:${first}` })
  expect(await ui.find({ type: 'Text', text: /^ultraguard-eval › map/ })).toBeDefined()
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Text', text: /^ultraguard-eval › map/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: `run:${first}` })).toBeDefined()

  await closePane($)
  expect((await ui.find({ type: 'Box', key: 'box:fold:stopped' }))?.text).toContain('▸ stopped this session  2 workflows')
  expect(await ui.find({ type: 'Button', key: `run:${first}` })).toBeUndefined()
  await ui.unmount()
})

test('the hint on the fold row says enter opens or folds the stopped ones', async ($, on) => {
  const w = await world($, on, { gate: true })
  const running = w.id()
  await w.end(await w.launch(), 'killed')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await shown(ui)).toContain('↑↓ choose  enter details  esc close')
  await focus($, 'fold:stopped')
  expect(await ringed(ui)).toEqual(['box:fold:stopped'])
  expect((await ui.find({ type: 'Text', text: /^▸ stopped this session/ }))?.text).toBe('▸ stopped this session  1 workflow')
  expect(await shown(ui)).toContain('↑↓ choose  enter opens the stopped ones  esc close')
  await ui.press({ key: 'fold:stopped' })
  expect(await shown(ui)).toContain('↑↓ choose  enter folds the stopped ones  esc close')
  await focus($, `run:${running}`)
  expect(await shown(ui)).toContain('↑↓ choose  enter details  esc close')
  await ui.unmount()
})

test('the window follows the focus down a long list, and the more lines count what is hidden', async ($, on) => {
  const w = await world($, on, { gate: true })
  const ids = [w.id()]
  for (let i = 0; i < 11; i++) ids.push(await w.launch())
  const order = [...ids].sort()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  let texts = await shown(ui)
  expect(moreOf(texts, '↑')).toBe(0)
  expect(moreOf(texts, '↓')).toBeGreaterThan(0)
  expect(moreOf(texts, '↓') + (await runButtons(ui)).length).toBe(12)
  for (const [i, id] of order.entries()) {
    await focus($, `run:${id}`)
    expect(await ringed(ui)).toEqual([`box:${id}`])
    const drawn = await runButtons(ui)
    if (i < order.length - 1) expect(drawn).toContain(`run:${order[i + 1]}`)
    if (i > 0) expect(drawn).toContain(`run:${order[i - 1]}`)
    texts = await shown(ui)
    expect(moreOf(texts, '↑') + drawn.length + moreOf(texts, '↓')).toBe(12)
  }
  expect(moreOf(texts, '↑')).toBeGreaterThan(0)
  expect(moreOf(texts, '↓')).toBe(0)
  const boxes = await rowBoxes(ui)
  expect(boxes.at(-1)?.key).toBe(`box:${order.at(-1)}`)
  expect(boxes[0]?.props.marginTop).toBe(0)
  expect(boxes.slice(1).every((b: any) => b.props.marginTop === -1)).toBe(true)
  await ui.unmount()
})

test('a pane too short for its fixed lines still draws the focused row, alone', async ($, on) => {
  const w = await world($, on, { gate: true })
  const ids = [w.id()]
  for (let i = 0; i < 3; i++) ids.push(await w.launch())
  const order = [...ids].sort()
  const ui = await $.ui.mount({ ...shortPane(5), surface: 'terminal' })
  expect(await runButtons(ui)).toEqual([`run:${order[0]}`])
  expect(await ringed(ui)).toEqual([`box:${order[0]}`])
  await focus($, `run:${order[2]}`)
  expect(await runButtons(ui)).toEqual([`run:${order[2]}`])
  expect(await ringed(ui)).toEqual([`box:${order[2]}`])
  await ui.unmount()
})

test('an arrow whose focus move does not land leaves the focus where it was', async ($, on) => {
  const w = await world($, on, { gate: true, focus: e => (e.origin?.kind === 'plugin' ? { deny: 'another move came first' } : {}) })
  await w.launch()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const before = await ringed(ui)
  expect(before).toHaveLength(1)
  await arrow($, 1)
  expect(await ringed(ui)).toEqual(before)
  await ui.unmount()
})
