import { expect, mock, test } from 'claude-code/testing'

import { sha256Hex } from '../src/fingerprint.mjs'

const SCRIPT = "export const meta = { name: 'map', description: 'x', phases: [] }\nawait agent('p', { label: 'investigate: map', model: 'sonnet', effort: 'high' })\n"
const CONFIG = '/cfg'
const SESSION = 'sess-1'
const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'

const PANE = {
  plugin: 'ultraguard',
  component: 'Pane',
  requestId: 'ultraguard',
  props: { title: 'ultraguard-eval', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const bucket = (r: number) => ({ r, lo: r * 0.8, hi: r * 1.25, mu: Math.log(r), sigma: 0.12, agentSd: 0.3 })
const PRICES = {
  v: 1,
  families: {
    opus: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    sonnet: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  },
}
const RATIOS = {
  v: 1,
  tau: 0.3,
  pooledAgentSd: { output: 0.4, fresh: 0.2, read: 0.6 },
  measured: { 'sonnet:high>opus:high': { pairs: 4, workflows: 1, output: bucket(1.07), fresh: bucket(1.15), read: bucket(2.29), dollars: { r: 2.6, lo: 2.2, hi: 2.9 } } },
  steps: {},
  priors: {},
}
const data = (name: 'prices' | 'ratios') => JSON.stringify(name === 'prices' ? PRICES : RATIOS)

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

const limits = (five: number) => [
  { kind: 'five_hour', percentUsed: five, resetsAt: '2026-11-08T12:00:00Z' },
  { kind: 'seven_day', percentUsed: five / 5, resetsAt: '2026-11-12T12:00:00Z' },
]

const drain = async (stream: AsyncGenerator<unknown, unknown>) => {
  let r = await stream.next()
  while (!r.done) r = await stream.next()
  return r.value
}

type Options = { subscription: boolean; context?: { tokens?: number }; compact?: number; gate?: boolean; agents?: number; readings?: number; finish?: boolean; complete?: boolean; preload?: Record<string, unknown>; now?: number; record?: Record<string, unknown>; name?: string }

async function flow($: any, on: any, options: Options) {
  const { subscription, context = {}, compact, gate = true, agents = 1, readings = 6, finish = true, complete = true, preload = {}, now = 5000, record = {}, name = 'map' } = options
  const writes: Record<string, string> = {}
  const toasts: string[] = []
  const store: Record<string, unknown> = { ...preload }
  const notices: unknown[] = []
  let toolUseId = ''
  let percent = 10
  let spawned = 0
  let index = 0
  mock.env(on, { CLAUDE_CONFIG_DIR: CONFIG })
  const clock = mock.clock(on, { now })
  on('session.id', () => ({ value: SESSION }))
  on('session.end', () => ({ sessionId: SESSION }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: notices }))
  let fill: Record<string, unknown> = { window: 200000, ...context }
  on('session.usage', (_: any, e: any) => ({
    value: { startedAt: 0, context: e.breakdown && compact ? { ...fill, breakdown: { rawMaxTokens: compact, isAutoCompactEnabled: true } } : fill, rateLimits: subscription ? limits(percent) : [] }
  }))
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))
  on('command.register', () => ({ value: { command: 'ultraguard' } }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', (_: any, e: any) => (toasts.push(String(e.text)), { value: undefined }))
  on('fs.write', (_: any, e: any) => ((writes[e.path] = e.text), { value: undefined }))
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('store.get', (_: any, e: any) => ({ value: store[e.key] }))
  on('store.delete', (_: any, e: any) => (delete store[e.key], { value: undefined }))
  on('store.set', (_: any, e: any) => ((store[e.key] = e.value), { value: undefined }))
  on('fs.read', (_: any, e: any) => {
    const path = String(e.path)
    if (path.endsWith('/policy/default.json')) return { value: JSON.stringify({ limits: { maxConcurrentOpus: 3 } }) }
    if (path.endsWith('/data/prices.json')) return { value: data('prices') }
    if (path.endsWith('/data/ratios.json')) return { value: data('ratios') }
    if (gate && path === `${CONFIG}/ultraguard/sessions/${SESSION}/${toolUseId}.gate.json`) return { value: gateRecord(toolUseId, record) }
    return { deny: `ENOENT ${path}` }
  })
  on('tool.call', (_: any, e: any) => {
    if (e.tool === 'TaskStop') return { result: { message: 'stopped', task_id: e.task_id, task_type: 'local_workflow' } }
    toolUseId = e.tool_use_id
    return { result: { status: 'async_launched', taskId: 'w1', runId: 'wf_run001', workflowName: name } }
  })
  on('agent.spawn', () => ({ model: SONNET, agentId: `a${(spawned += 1)}` }))
  on('turn.step', async function* (_: any, e: any) {
    const big = e.agentId !== undefined
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { input_tokens: big ? 1000 : 300, output_tokens: big ? 2000 : 100, cache_read_input_tokens: big ? 50000 : 9000, cache_creation_input_tokens: big ? 5000 : 500, model: e.model },
    }
  })
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const step = (over: Record<string, unknown>) => drain($.turn.step({ turnId: 't1', index: (index += 1), model: SONNET, messageCount: 1, ...over }))
  const measure = () => $.session.measure({ context: fill, rateLimits: subscription ? limits(percent) : [], changed: ['rateLimits'] })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step({ model: OPUS, effort: 'high' })
  await $.tool.call({ tool: 'Workflow', script: SCRIPT })
  for (let i = 1; i <= agents; i++) {
    await $.agent.spawn({
      tool_use_id: toolUseId,
      prompt: 'p',
      description: 'investigate: map',
      subagentType: 'general-purpose',
      provider: { plugin: 'engine', tier: 'core' },
      model: 'sonnet',
      parentModel: OPUS,
      background: true,
      fork: false,
      workflow: { runId: 'wf_run001', agentIndex: i },
    })
  }
  for (let i = 1; i <= readings; i++) {
    await step({ agentId: 'a1', model: SONNET, effort: 'high' })
    percent = 10 + i * 0.5
    await clock.advance(60000)
    await measure()
  }
  if (complete) await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
  let notified = 0
  const end = (id: string, status = 'completed') =>
    $.session.append({
      message: {
        type: 'user',
        content: [{ type: 'text', text: `<task-notification>\n<task-id>w1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n</task-notification>` }],
      },
      door: 'queue',
      origin: { kind: 'task-notification' },
      uuid: `u${(notified += 1)}`,
    })
  const launch = async () => {
    await $.tool.call({ tool: 'Workflow', script: SCRIPT })
    return toolUseId
  }
  if (finish) await end(toolUseId)
  return { writes, toasts, store, clock, id: () => toolUseId, end, launch, setContext: (next: Record<string, unknown>) => (fill = { window: 200000, ...next }) }
}

const detail = async ($: any, id: string) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `run:${id}` })
  return ui
}

test('the detail shows what a finished run saved, against the session model and effort', async ($, on) => {
  const w = await flow($, on, { subscription: true })
  const ui = await detail($, w.id())
  expect(await ui.find({ type: 'Text', text: /^══ ultraguard saved ═+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ +vs every agent on Opus high$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ +5-hour +[━╸─│ ]+ +13% +\+\d+\.\d \(-?\d+\.\d to \d+\.\d\)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ +weekly +[━╸─│ ]+ +3% +\+/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ +\$\d+\.\d\d \(-?\$\d+\.\d\d to \$\d+\.\d\d\) at API prices$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ +range = 9 times in 10$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /from 1 of 1 agents/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^ +agent\s+5h saves {3}ran on$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /saved of 5-hour limit/ })).toBeUndefined()
  await ui.unmount()
  const record = JSON.parse(w.writes[`${CONFIG}/ultraguard/sessions/${SESSION}/${w.id()}.eval.json`] ?? '{}')
  expect(record.savings.baseline).toEqual({ model: OPUS, effort: 'high' })
  expect(record.savings.saved.status).toBe('estimated')
  expect(record.savings.saved.running).toBe(false)
  expect(record.savings.saved.used.five_hour).toBe(13)
  expect(JSON.stringify(record)).not.toContain('"compact"')
  expect(Object.keys(w.store).sort()).toEqual([`meter:${SESSION}`, `tally:${SESSION}`])
})

test('the saving is drawn as a bar whose cells are text, track and saved colors', async ($, on) => {
  const w = await flow($, on, { subscription: true })
  const ui = await detail($, w.id())
  const cells = await ui.findAll({ type: 'Text', text: /^[━╸]$/ })
  const colors = cells.map((c: any) => String(c.props.color))
  expect(colors).toContain('text')
  expect(colors.some((c: string) => /^#[0-9a-f]{6}$/.test(c))).toBe(true)
  expect((await ui.findAll({ type: 'Text', text: /^─$/ })).every((c: any) => c.props.color === 'subtle')).toBe(true)
  expect((await ui.findAll({ type: 'Text', text: /^│$/ })).every((c: any) => c.props.color === 'inactive')).toBe(true)
  await ui.unmount()
})

test('the context row shows the live fill against the window', async ($, on) => {
  const w = await flow($, on, { subscription: true, context: { tokens: 50000 } })
  const ui = await detail($, w.id())
  expect(await ui.find({ type: 'Text', text: /^ +context +[━╸─│ ]+ +25% +50k of 200k$/ })).toBeDefined()
  await ui.unmount()
})

test('the context row measures against the compaction window when one is set', async ($, on) => {
  const w = await flow($, on, { subscription: true, context: { tokens: 50000 }, compact: 100000 })
  const ui = await detail($, w.id())
  expect(await ui.find({ type: 'Text', text: /^ +context +[━╸─│ ]+ +50% +50k of 100k$/ })).toBeDefined()
  await ui.unmount()
})

test('the context row reads the live usage when it is drawn, so a compaction empties it', async ($, on) => {
  const w = await flow($, on, { subscription: true, context: { tokens: 50000 } })
  w.setContext({})
  const ui = await detail($, w.id())
  expect(await ui.find({ type: 'Text', text: /^ +context +[─│ ]+ +— +— of 200k$/ })).toBeDefined()
  await ui.unmount()
})

test('the context row waits with a dash until the first response of a window', async ($, on) => {
  const w = await flow($, on, { subscription: true })
  const ui = await detail($, w.id())
  expect(await ui.find({ type: 'Text', text: /^ +context +[─│ ]+ +— +— of 200k$/ })).toBeDefined()
  await ui.unmount()
})

test('an API session shows a cost bar and no limit lines', async ($, on) => {
  const w = await flow($, on, { subscription: false })
  const ui = await detail($, w.id())
  expect(await ui.find({ type: 'Text', text: /^ +cost +[━╸─│ ]+ +\$\d+\.\d\d +\+\$\d+\.\d\d \(-?\$\d+\.\d\d to \$\d+\.\d\d\)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /off your API bill/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /5-hour/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^ +agent\s+API saves {3}ran on$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /5h saves/ })).toBeUndefined()
  await ui.unmount()
})

test('a subscription with too few readings says it is still learning', async ($, on) => {
  const w = await flow($, on, { subscription: true, readings: 2 })
  const ui = await detail($, w.id())
  expect(await ui.find({ type: 'Text', text: /learning \d\/5$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\+\d+\.\d \(/ })).toBeUndefined()
  await ui.unmount()
})

test('the run list labels the saved column and keeps red reasons', async ($, on) => {
  const w = await flow($, on, { subscription: false, gate: false, finish: false })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /workflow\s+id\s+agents\s+API saves/ })).toBeDefined()
  expect((await ui.find({ type: 'Box', key: `box:${w.id()}` }))?.text).toContain('not approved by the gate')
  await ui.unmount()
})

test('a running run shows its saving so far', async ($, on) => {
  const w = await flow($, on, { subscription: true, finish: false })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Box', key: `box:${w.id()}` }))?.text).toContain('so far')
  await ui.press({ key: `run:${w.id()}` })
  expect(await ui.find({ type: 'Text', text: /^══ ultraguard saved so far ═+$/ })).toBeDefined()
  await ui.unmount()
})

test('a finished run stays listed under "finished this session" and opens', async ($, on) => {
  const w = await flow($, on, { subscription: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /finished this session/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No workflow is running/ })).toBeDefined()
  const d = new Date(w.clock.now())
  const clock = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const row = await ui.find({ type: 'Box', key: `box:${w.id()}` })
  expect(row?.text).toContain(`done ${clock}`)
  await ui.press({ key: `run:${w.id()}` })
  expect(await ui.find({ type: 'Text', text: /Approved by the gate/ })).toBeDefined()
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Button', key: `run:${w.id()}` })).toBeDefined()
  await ui.unmount()
})

test('a toast says what the run saved when it ends', async ($, on) => {
  const w = await flow($, on, { subscription: true })
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toMatch(/^ultraguard: map finished as approved and saved about .*% of your 5-hour limit$/)
})

test('an API toast says what came off the bill', async ($, on) => {
  const w = await flow($, on, { subscription: false })
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toMatch(/^ultraguard: map finished as approved and .*\$\d+\.\d\d off your API bill$/)
})

test('an agent with no usage leaves the coverage line at "from 1 of 2 agents"', async ($, on) => {
  const w = await flow($, on, { subscription: true, agents: 2 })
  const ui = await detail($, w.id())
  expect(await ui.find({ type: 'Text', text: /from 1 of 2 agents/ })).toBeDefined()
  await ui.unmount()
})

test('a run with no estimate yet still shows the effort an agent ran at', async ($, on) => {
  const w = await flow($, on, { subscription: true, readings: 1, finish: false, complete: false })
  const ui = await detail($, w.id())
  expect(await ui.find({ type: 'Text', text: /^ {4}□ investigate: map\s+sonnet high$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /sonnet…/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /ultraguard saved/ })).toBeUndefined()
  await ui.unmount()
})

test('a clear takes the finished runs out of the pane', async ($, on) => {
  const w = await flow($, on, { subscription: true })
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /finished this session/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: `run:${w.id()}` })).toBeUndefined()
  await ui.unmount()
})

test('a session start removes the stored meter readings that are all older than 30 days', async ($, on) => {
  const now = 100 * 24 * 3600 * 1000
  const old = { v: 1, five_hour: [{ d: 1, u: 1, c: 0, at: 1000 }], seven_day: [] }
  const fresh = { v: 1, five_hour: [{ d: 1, u: 1, c: 0, at: now - 3600 * 1000 }], seven_day: [] }
  const w = await flow($, on, { subscription: true, now, preload: { 'meter:ancient': old, 'meter:recent': fresh } })
  expect(Object.keys(w.store).sort()).toEqual(['meter:recent', `meter:${SESSION}`, `tally:${SESSION}`].sort())
})

test('the saved block is laid out for the pane and the saved column keeps the same title on a narrow pane', async ($, on) => {
  const w = await flow($, on, { subscription: false })
  const narrow = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 60 }, surface: 'terminal' })
  await narrow.press({ key: `run:${w.id()}` })
  expect((await narrow.find({ type: 'Text', text: /vs every agent on Opus high/ }))?.props.wrap).toBe('truncate-end')
  expect((await narrow.find({ type: 'Text', text: /^ +agent\s/ }))?.text).toMatch(/^ +agent\s+API saves {3}ran on$/)
  await narrow.unmount()
  const wide = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 140 }, surface: 'terminal' })
  expect((await wide.find({ type: 'Text', text: /^ +agent\s/ }))?.text).toMatch(/^ +agent\s+API saves {3}ran on$/)
  await wide.unmount()
})

const ONE_PHASE = (title: string) => ({
  phases: [title],
  stages: [{ index: 0, line: 2, label: 'investigate: map', class: 'investigate', model: 'sonnet', effort: 'high', inFanout: false, bigFanout: false, verdict: false, phase: title }],
})

test('a phase block shows what its agents saved, and the unit follows the limit figure', async ($, on) => {
  const record = { ...ONE_PHASE('Investigate'), phases: ['Investigate', 'Decide'] }
  const api = await flow($, on, { subscription: false, record })
  const ui = await detail($, api.id())
  const header = await ui.find({ type: 'Text', text: /^▸ ● Investigate/ })
  expect(header?.text).toMatch(/^▸ ● Investigate {2}1 agent\s+\$\d+\.\d\d\s+sonnet 1$/)
  expect(await ui.find({ type: 'Text', text: /^ {4}✓ investigate: map/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /Decide/ }))?.text).toBe('      Decide  did not run')
  await ui.unmount()
})

test('a subscription phase block shows its share of the 5-hour limit', async ($, on) => {
  const w = await flow($, on, { subscription: true, record: ONE_PHASE('Investigate') })
  const ui = await detail($, w.id())
  expect((await ui.find({ type: 'Text', text: /^▸ ● Investigate/ }))?.text).toMatch(/^▸ ● Investigate {2}1 agent\s+\S+%\s+sonnet 1$/)
  expect((await ui.find({ type: 'Text', text: /^ +agent/ }))?.text).toMatch(/agent\s+5h saves {3}ran on$/)
  await ui.unmount()
})

test('the saved column comes before ran on, and the phase and agent figures share its column', async ($, on) => {
  const w = await flow($, on, { subscription: false, record: ONE_PHASE('Investigate') })
  const ui = await detail($, w.id())
  await ui.press({ key: 'phase:Investigate' })
  const title = (await ui.find({ type: 'Text', text: /^ +agent/ }))?.text ?? ''
  const phaseRow = (await ui.find({ type: 'Text', text: /^▾ ● Investigate/ }))?.text ?? ''
  const agentRow = (await ui.find({ type: 'Text', text: /^ {4}✓ investigate: map/ }))?.text ?? ''
  expect(title.indexOf('API saves')).toBeGreaterThan(0)
  expect(title.indexOf('ran on')).toBeGreaterThan(title.indexOf('API saves'))
  expect(title.indexOf('ran on') - title.indexOf('API saves')).toBe(agentRow.indexOf('sonnet') - agentRow.indexOf('$'))
  expect(phaseRow.indexOf('$')).toBe(agentRow.indexOf('$'))
  expect(agentRow).toMatch(/\$\d+\.\d\d\s+sonnet high$/)
  await ui.unmount()
})

test('a folded phase keeps its saved total and puts its models under ran on', async ($, on) => {
  const w = await flow($, on, { subscription: false, record: ONE_PHASE('Investigate') })
  const ui = await detail($, w.id())
  const folded = (await ui.find({ type: 'Text', text: /^▸ ● Investigate/ }))?.text ?? ''
  expect(await ui.find({ type: 'Text', text: /^ {4}✓ investigate: map/ })).toBeUndefined()
  await ui.press({ key: 'phase:Investigate' })
  const agentRow = (await ui.find({ type: 'Text', text: /^ {4}✓ investigate: map/ }))?.text ?? ''
  expect(folded).toMatch(/\$\d+\.\d\d\s+sonnet 1$/)
  expect(folded.indexOf('$')).toBe(agentRow.indexOf('$'))
  expect(folded.indexOf('sonnet 1')).toBe(agentRow.indexOf('sonnet high'))
  await ui.unmount()
})

test('on a narrow pane a long phase title is shortened so the saved figure keeps its column', async ($, on) => {
  const w = await flow($, on, { subscription: false, record: ONE_PHASE('Investigate the repository') })
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 60 }, surface: 'terminal' })
  await ui.press({ key: `run:${w.id()}` })
  await ui.press({ key: 'phase:Investigate the repository' })
  const header = (await ui.find({ type: 'Text', text: /^▾ ● Investigate/ }))?.text ?? ''
  const agentRow = (await ui.find({ type: 'Text', text: /^ {4}✓ investigate: map/ }))?.text ?? ''
  expect(header).toMatch(/^▾ ● Investigate[^…]*…  1 agent\s+\$\d+\.\d\d\s*$/)
  expect(header).not.toContain('repository')
  expect(header.indexOf('$')).toBe(agentRow.indexOf('$'))
  await ui.unmount()
})

test('the pane text has no middle dots, the saved block included', async ($, on) => {
  const w = await flow($, on, { subscription: false, record: ONE_PHASE('Investigate') })
  const ui = await detail($, w.id())
  const texts: string[] = (await ui.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? ''))
  const block = texts.findIndex(t => /^══ ultraguard saved/.test(t))
  expect(block).toBeGreaterThan(-1)
  expect(texts.join('\n')).not.toContain(' · ')
  await ui.press({ key: 'back' })
  const list: string[] = (await ui.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? ''))
  expect(list.some(t => /workflow\s+id\s+agents\s+API saves/.test(t))).toBe(true)
  expect(list.join('\n')).not.toContain(' · ')
  await ui.unmount()
})

const order = async (ui: any, steps: RegExp[]) => {
  const texts: string[] = (await ui.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? ''))
  return { at: steps.map(p => texts.findIndex(t => p.test(t))), heads: texts.filter(t => /^══ /.test(t)).map(t => t.length) }
}
const inOrder = (at: number[]) => at.every(i => i > -1) && at.every((i, n) => n === 0 || i > at[n - 1])

test('the flat table comes after the saved block, under an agents head, and the checks after it', async ($, on) => {
  const flat = await flow($, on, { subscription: false })
  const ui = await detail($, flat.id())
  const { at, heads } = await order(ui, [/^ultraguard-eval › map/, /^══ ultraguard saved ═+$/, /^ +cost /, /^══ agents {2}1 agent ═+$/, /^ +agent/, /^ {4}□ investigate: map/, /^══ checks ═+$/, /Approved by the gate/, /^back to the list$/])
  expect(inOrder(at)).toBe(true)
  expect(heads).toEqual([96, 96, 96])
  await ui.unmount()
})

test('with phases the run view shows the saved block, then the phases, then the checks', async ($, on) => {
  const w = await flow($, on, { subscription: false, record: ONE_PHASE('Investigate') })
  const ui = await detail($, w.id())
  const { at, heads } = await order(ui, [
    /^ultraguard-eval › map/,
    /^══ ultraguard saved ═+$/,
    /^ +cost /,
    /^══ phases {2}1 agent ═+$/,
    /^ +agent\s+API saves {3}ran on$/,
    /^▸ ● Investigate/,
    /^ {2}✓ ran as the gate approved {2}✗ did not$/,
    /^══ checks ═+$/,
    /Approved by the gate/,
    /^↑↓ choose {2}enter opens or folds a phase$/,
    /^expand all$/,
    /^back to the list$/,
  ])
  expect(inOrder(at)).toBe(true)
  expect(heads).toEqual([96, 96, 96])
  expect(await ui.find({ type: 'Text', text: /^▾ / })).toBeUndefined()
  await ui.unmount()
})

const TALLY = `tally:${SESSION}`
const tallyOf = (w: { store: Record<string, unknown> }) => w.store[TALLY] as any

test('the session tally is mirrored to the plugin store under tally:<session id>', async ($, on) => {
  const w = await flow($, on, { subscription: true })
  const stored = tallyOf(w)
  expect(Object.keys(stored.runs)).toEqual([w.id()])
  expect(stored.runs[w.id()]).toMatchObject({
    key: w.id(),
    status: 'completed',
    baseline: { family: 'opus', effort: 'high' },
    windows: { five_hour: '2026-11-08T12:00:00Z', seven_day: '2026-11-12T12:00:00Z' },
    at: w.clock.now(),
  })
  expect(stored.runs[w.id()].agents.map((a: any) => a.agentId)).toEqual(['a1'])
  expect(stored.overall).toMatchObject({ status: 'estimated', count: 1, counted: { five_hour: 1, seven_day: 1 }, running: false, subscription: true, baseline: { family: 'opus', effort: 'high' } })
  expect(stored.overall.limits.five_hour.mid).toBeGreaterThan(0)
})

test('a running workflow is tallied as running, and the overall says so', async ($, on) => {
  const w = await flow($, on, { subscription: true, finish: false })
  expect(tallyOf(w).runs[w.id()].status).toBe('running')
  expect(tallyOf(w).overall).toMatchObject({ status: 'estimated', count: 1, running: true })
})

test('a workflow stopped with TaskStop is counted in the session tally', async ($, on) => {
  const w = await flow($, on, { subscription: true, finish: false })
  await $.tool.call({ tool: 'TaskStop', task_id: 'w1' })
  expect(tallyOf(w).runs[w.id()].status).toBe('killed')
  expect(tallyOf(w).overall).toMatchObject({ status: 'estimated', count: 1, running: false })
})

test('the session tally counts every ended workflow, past the 20 the list keeps', async ($, on) => {
  const w = await flow($, on, { subscription: true })
  for (let i = 0; i < 21; i++) await w.end(await w.launch())
  expect(Object.keys(tallyOf(w).runs)).toHaveLength(22)
  expect(tallyOf(w).overall.count).toBe(22)
  expect(tallyOf(w).overall.status).toBe('estimated')
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 100 } }, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Button' })).filter((b: any) => String(b.key).startsWith('run:'))).toHaveLength(20)
  await ui.unmount()
})

test('with only stopped workflows the list shows the overall section, says none is running and keeps the folded row', async ($, on) => {
  await flow($, on, { subscription: true, finish: false })
  await $.tool.call({ tool: 'TaskStop', task_id: 'w1' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const { at, heads } = await order(ui, [
    /^ultraguard-eval$/,
    /^══ overall savings for this session {2}1 workflow ═+$/,
    /^ +vs every agent on Opus high$/,
    /^══ workflows {2}none running ═+$/,
    /^ {2}No workflow is running\.$/,
    /workflow\s+id\s+agents\s+5h saves/,
    /^▸ stopped this session {2}1 workflow$/,
    /^↑↓ choose {2}enter details {2}esc close$/,
  ])
  expect(inOrder(at)).toBe(true)
  expect(heads).toEqual([96, 96])
  expect(await ui.find({ type: 'Text', text: /finished this session/ })).toBeUndefined()
  expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.key)).toEqual(['fold:stopped'])
  expect((await ui.find({ type: 'Box', key: 'box:fold:stopped' }))?.props.marginTop).toBe(0)
  await ui.unmount()
})

test('a long list draws its rows in a window, and the overall section stays the first one', async ($, on) => {
  const w = await flow($, on, { subscription: true })
  for (let i = 0; i < 14; i++) await w.launch()
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 20 } }, surface: 'terminal' })
  const texts: string[] = (await ui.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? ''))
  expect(texts.find(t => /^══ /.test(t))).toMatch(/^══ overall savings for this session {2}1 workflow ═+$/)
  const below = texts.find(t => /^ {2}↓ \d+ more$/.test(t))
  expect(below).toBeDefined()
  const drawn = (await ui.findAll({ type: 'Button' })).filter((b: any) => String(b.key).startsWith('run:')).length
  expect(drawn).toBeGreaterThan(0)
  expect(drawn + Number(below?.match(/\d+/)?.[0])).toBe(15)
  await ui.unmount()
})

test('the overall section of the list draws the context row from the live usage, like the run view', async ($, on) => {
  await flow($, on, { subscription: true, context: { tokens: 50000 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts: string[] = (await ui.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? ''))
  const head = texts.findIndex(t => /^══ overall savings for this session/.test(t))
  const context = texts.findIndex(t => /^ +context +[━╸─│ ]+ +25% +50k of 200k$/.test(t))
  expect(head).toBeGreaterThan(-1)
  expect(context).toBeGreaterThan(head)
  expect(context).toBeLessThan(texts.findIndex(t => /^══ workflows/.test(t)))
  await ui.unmount()
})

test('a clear resets the session tally and leaves the stored one of the ended session alone', async ($, on) => {
  const w = await flow($, on, { subscription: true, finish: false })
  const before = w.id()
  expect(Object.keys(tallyOf(w).runs)).toEqual([before])
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } })
  expect(Object.keys(tallyOf(w).runs)).toEqual([before])
  await $.agent.spawn({
    tool_use_id: before,
    prompt: 'p',
    description: 'investigate: map',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    model: 'sonnet',
    parentModel: OPUS,
    background: true,
    fork: false,
    workflow: { runId: 'wf_run001', agentIndex: 2 },
  })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', agentId: 'a2' })
  const next = await w.launch()
  await w.end(next)
  expect(Object.keys(tallyOf(w).runs)).toEqual([next])
  expect(tallyOf(w).overall).toEqual({ status: 'unknown', count: 1, running: false })
})

test('a session start loads its own stored tally and removes tally keys older than 30 days', async ($, on) => {
  const now = 100 * 24 * 3600 * 1000
  const run = (key: string, at: number) => ({ key, status: 'completed', baseline: { family: 'opus', effort: 'high' }, agents: [], windows: { five_hour: null, seven_day: null }, at })
  const preload = {
    [TALLY]: { v: 1, runs: { earlier: run('earlier', now - 3600 * 1000) } },
    'tally:ancient': { v: 1, runs: { old: run('old', 1000) } },
    'tally:recent': { v: 1, runs: { young: run('young', now - 3600 * 1000) } },
  }
  const w = await flow($, on, { subscription: true, now, preload })
  expect(Object.keys(w.store).filter(k => k.startsWith('tally:')).sort()).toEqual(['tally:recent', TALLY])
  expect(Object.keys(tallyOf(w).runs).sort()).toEqual(['earlier', w.id()].sort())
  expect(tallyOf(w).overall.count).toBe(2)
})

const LONG = 'a-rather-long-workflow-name-for-the-list'
const listRow = async (ui: any, id: string) => String((await ui.find({ type: 'Box', key: `box:${id}` }))?.text ?? '').replace(/^\u200b/, '')
const headerRow = async (ui: any) => String((await ui.find({ type: 'Text', text: /workflow\s+id\s+agents/ }))?.text ?? '')

test('the list columns are sized from the pane width, so the saves cell is not cut and long titles are', async ($, on) => {
  const w = await flow($, on, { subscription: true, name: LONG })
  const done = w.id()
  await w.end(await w.launch(), 'killed')
  for (const columns of [44, 60, 80, 120]) {
    const width = columns - 4
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns }, surface: 'terminal' })
    const row = await listRow(ui, done)
    const cell = row.match(/-?\d+\.\d% \(-?\d+\.\d to -?\d+\.\d\)$/)?.[0] ?? ''
    expect(cell).not.toBe('')
    const name = Math.max(12, Math.min(30, LONG.length + 4, width - 9 - 12 - cell.length))
    expect(row.length - cell.length).toBe(name + 9 + 12)
    expect(row.startsWith(`□ ${LONG.slice(0, name - 4)}… `)).toBe(true)
    expect((await headerRow(ui)).indexOf('5h saves')).toBe(2 + name + 9 + 12)
    if (columns === 44) expect(name).toBe(12)
    else expect(row.length).toBeLessThanOrEqual(width)
    await ui.unmount()
  }
})

test('a stopped row widens the agents column only while the stopped fold is open', async ($, on) => {
  const w = await flow($, on, { subscription: true, name: LONG })
  const done = w.id()
  const stopped = await w.launch()
  await w.end(stopped, 'killed')
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 80 }, surface: 'terminal' })
  const closed = await listRow(ui, done)
  expect(closed.slice(30 + 9)).toMatch(/^done \d\d:\d\d {2}\d+\.\d% \(/)
  await ui.press({ key: 'fold:stopped' })
  const open = await listRow(ui, done)
  expect(open.slice(30 + 9)).toMatch(/^done \d\d:\d\d {5}\d+\.\d% \(/)
  expect((await listRow(ui, stopped)).slice(30 + 9, 30 + 9 + 15)).toMatch(/^stopped \d\d:\d\d {2}$/)
  expect(open.length).toBeLessThanOrEqual(76)
  await ui.unmount()
})
