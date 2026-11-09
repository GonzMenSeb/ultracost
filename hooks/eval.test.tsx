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

async function world($: any, on: any, options: { gate: boolean; launch?: Record<string, unknown>; record?: Record<string, unknown> }) {
  const writes: Record<string, string> = {}
  const logs: string[] = []
  const notices: unknown[] = []
  let toolUseId = ''
  mock.env(on, { CLAUDE_CONFIG_DIR: CONFIG })
  mock.clock(on, { now: 5000 })
  on('session.id', () => ({ value: SESSION }))
  on('session.end', () => ({ sessionId: SESSION }))
  on('turn.complete', () => ({ text: '' }))
  on('session.messages', () => ({ value: notices }))
  on('ui.log', (_: any, e: any) => (logs.push(String(e.text)), { value: undefined }))
  on('fs.write', (_: any, e: any) => ((writes[e.path] = e.text), { value: undefined }))
  on('fs.read', (_: any, e: any) =>
    options.gate && e.path === `${CONFIG}/ultraguard/sessions/${SESSION}/${toolUseId}.gate.json`
      ? { value: gateRecord(toolUseId, options.record) }
      : String(e.path).endsWith('/saved/map.js')
        ? { value: SCRIPT }
        : { deny: `ENOENT ${e.path}` },
  )
  on('tool.call', (_: any, e: any) => {
    toolUseId = e.tool_use_id
    return { result: { status: 'async_launched', taskId: 'w1', runId: 'wf_run001', workflowName: 'map' } }
  })
  let spawned = 0
  on('agent.spawn', (_: any, e: any) => ({ model: FULL[String(e.model)] ?? SONNET, agentId: `a${(spawned += 1)}` }))
  on('ui.focus', () => ({}))
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
  return { writes, logs, notices, id: () => toolUseId, spawn }
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

const PHASED = {
  phases: ['Collect', 'Decide'],
  stages: [
    { index: 0, line: 2, label: 'investigate: map', class: 'investigate', model: 'sonnet', effort: 'high', inFanout: false, bigFanout: false, verdict: false, phase: 'Collect' },
    { index: 1, line: 3, label: 'decide: pick', class: 'decide', model: 'opus', effort: 'high', inFanout: false, bigFanout: false, verdict: false, phase: 'Decide' },
  ],
}

test('the detail groups agents under phases that fold with enter', async ($, on) => {
  const w = await world($, on, { gate: true, record: PHASED })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: `run:${w.id()}` })

    const header = await ui.find({ type: 'Text', text: /^▾ ● Collect/ })
    expect(header?.text).toContain('Collect  running  0 of 1 done')
    expect(header?.text).not.toContain('sonnet')
    expect((await ui.find({ type: 'Button', key: 'phase:Collect' }))?.text).toBe(ZERO_WIDTH)
    expect((await ui.find({ type: 'Text', text: /^●$/ }))?.props.color).toBe('success')
    expect(await ui.find({ type: 'Text', text: /^ {4}✓ investigate: map/ })).toBeDefined()
    const decide = await ui.find({ type: 'Text', text: /Decide/ })
    expect(decide?.text).toMatch(/^ {6}Decide {2}not started$/)
    expect(decide?.props.dimColor).toBe(true)
    expect(await ui.find({ type: 'Button', key: 'phase:Decide' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /ran as the gate approved/ }))?.text).toBe('  ✓ ran as the gate approved  ✗ did not')

    await ui.press({ key: 'phase:Collect' })
    expect((await ui.find({ type: 'Text', text: /^▸ ● Collect/ }))?.text).toContain('sonnet 1')
    expect(await ui.find({ type: 'Text', text: /^ {4}✓ investigate: map/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'expand all' })).toBeDefined()

    await ui.press({ key: 'all' })
    expect(await ui.find({ type: 'Text', text: /^▾ ● Collect/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ {4}✓ investigate: map/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'collapse all' })).toBeDefined()

    await ui.press({ key: 'back' })
    await ui.press({ key: `run:${w.id()}` })
    expect(await ui.find({ type: 'Text', text: /^▾ ● Collect/ })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('an agent that broke the plan turns its phase red and says why on its own line', async ($, on) => {
  const w = await world($, on, { gate: true, record: { phases: ['Map'], stages: [{ ...PHASED.stages[0], model: 'opus', phase: 'Map' }] } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `run:${w.id()}` })

  expect((await ui.find({ type: 'Text', text: /^▾ ● Map/ }))?.text).toContain('  1 red')
  expect((await ui.find({ type: 'Text', text: /^●$/ }))?.props.color).toBe('error')
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
  expect((await ui.find({ type: 'Text', text: /^▾ ● Collect/ }))?.text).not.toMatch(/opus|haiku/)
  await ui.press({ key: 'phase:Collect' })

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
  await ui.unmount()
})

test('a folded phase wraps its models onto continuation lines at the same column on a narrow pane', async ($, on) => {
  const w = await threeModels($, on)
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 59 }, surface: 'terminal' })
  await ui.press({ key: `run:${w.id()}` })
  await ui.press({ key: 'phase:Collect' })

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
