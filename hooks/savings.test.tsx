import { expect, mock, test } from 'claude-code/testing'

import { sha256Hex } from '../src/fingerprint.mjs'

const SCRIPT = "export const meta = { name: 'map', description: 'x', phases: [] }\nawait agent('p', { label: 'investigate: map', model: 'sonnet', effort: 'high' })\n"
const CONFIG = '/cfg'
const SESSION = 'sess-1'
const OPUS = 'claude-opus-4-7'
const SONNET = 'claude-sonnet-4-6'

const PANE = {
  plugin: 'tierguard',
  component: 'Pane',
  requestId: 'tierguard',
  props: { title: 'tierguard-eval', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
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

const gateRecord = (toolUseId: string) =>
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

type Options = { subscription: boolean; gate?: boolean; agents?: number; readings?: number; finish?: boolean }

async function flow($: any, on: any, options: Options) {
  const { subscription, gate = true, agents = 1, readings = 6, finish = true } = options
  const writes: Record<string, string> = {}
  const toasts: string[] = []
  const store: Record<string, unknown> = {}
  const notices: unknown[] = []
  let toolUseId = ''
  let percent = 10
  let spawned = 0
  let index = 0
  mock.env(on, { CLAUDE_CONFIG_DIR: CONFIG })
  const clock = mock.clock(on, { now: 5000 })
  on('session.id', () => ({ value: SESSION }))
  on('session.end', () => ({ sessionId: SESSION }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: notices }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: subscription ? limits(percent) : [] } }))
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))
  on('command.register', () => ({ value: { command: 'tierguard' } }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', (_: any, e: any) => (toasts.push(String(e.text)), { value: undefined }))
  on('fs.write', (_: any, e: any) => ((writes[e.path] = e.text), { value: undefined }))
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('store.get', (_: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: any, e: any) => ((store[e.key] = e.value), { value: undefined }))
  on('fs.read', (_: any, e: any) => {
    const path = String(e.path)
    if (path.endsWith('/policy/default.json')) return { value: JSON.stringify({ limits: { maxConcurrentOpus: 3 } }) }
    if (path.endsWith('/data/prices.json')) return { value: data('prices') }
    if (path.endsWith('/data/ratios.json')) return { value: data('ratios') }
    if (gate && path === `${CONFIG}/tierguard/sessions/${SESSION}/${toolUseId}.gate.json`) return { value: gateRecord(toolUseId) }
    return { deny: `ENOENT ${path}` }
  })
  on('tool.call', (_: any, e: any) => {
    toolUseId = e.tool_use_id
    return { result: { status: 'async_launched', taskId: 'w1', runId: 'wf_run001', workflowName: 'map' } }
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
  const measure = () => $.session.measure({ context: { window: 200000 }, rateLimits: subscription ? limits(percent) : [], changed: ['rateLimits'] })

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
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
  if (finish) {
    await $.session.append({
      message: {
        type: 'user',
        content: [{ type: 'text', text: `<task-notification>\n<task-id>w1</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>completed</status>\n</task-notification>` }],
      },
      door: 'queue',
      origin: { kind: 'task-notification' },
      uuid: 'u1',
    })
  }
  return { writes, toasts, store, clock, id: () => toolUseId }
}

const detail = async ($: any, id: string) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `run:${id}` })
  return ui
}

test('the detail shows what a finished run saved, against the session model and effort', async ($, on) => {
  const w = await flow($, on, { subscription: true })
  const ui = await detail($, w.id())
  expect(await ui.find({ type: 'Text', text: /tierguard saved/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /compared with running every agent on Opus at high effort/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /of your 5-hour limit/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /of your weekly limit/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /at API prices/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /± = how far off the estimate can be, 9 times out of 10/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /from 1 of 1 agents/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /saved of 5-hour limit/ })).toBeDefined()
  await ui.unmount()
  const record = JSON.parse(w.writes[`${CONFIG}/tierguard/sessions/${SESSION}/${w.id()}.eval.json`] ?? '{}')
  expect(record.savings.baseline).toEqual({ model: OPUS, effort: 'high' })
  expect(record.savings.saved.status).toBe('estimated')
  expect(record.savings.saved.running).toBe(false)
  expect(Object.keys(w.store)).toEqual([`meter:${SESSION}`])
})

test('an API session shows dollars and no limit lines', async ($, on) => {
  const w = await flow($, on, { subscription: false })
  const ui = await detail($, w.id())
  expect(await ui.find({ type: 'Text', text: /off your API bill/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /5-hour/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /saved at API prices/ })).toBeDefined()
  await ui.unmount()
})

test('a subscription with too few readings says it is still learning', async ($, on) => {
  const w = await flow($, on, { subscription: true, readings: 2 })
  const ui = await detail($, w.id())
  expect(await ui.find({ type: 'Text', text: /learning how fast your limit fills/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /of your 5-hour limit/ })).toBeUndefined()
  await ui.unmount()
})

test('the run list labels the saved column and keeps red reasons', async ($, on) => {
  const w = await flow($, on, { subscription: false, gate: false, finish: false })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /saved at API prices/ })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: `run:${w.id()}` }))?.text).toContain('not approved by the gate')
  await ui.unmount()
})

test('a running run shows its saving so far', async ($, on) => {
  const w = await flow($, on, { subscription: true, finish: false })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Button', key: `run:${w.id()}` }))?.text).toContain('so far')
  await ui.press({ key: `run:${w.id()}` })
  expect(await ui.find({ type: 'Text', text: /tierguard saved so far/ })).toBeDefined()
  await ui.unmount()
})

test('a finished run stays listed under "finished this session" and opens', async ($, on) => {
  const w = await flow($, on, { subscription: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /finished this session/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No workflow is running/ })).toBeDefined()
  const d = new Date(w.clock.now())
  const clock = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const row = await ui.find({ type: 'Button', key: `run:${w.id()}` })
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
  expect(w.toasts[0]).toMatch(/^tierguard: map finished as approved and saved about .*% of your 5-hour limit$/)
})

test('an API toast says what came off the bill', async ($, on) => {
  const w = await flow($, on, { subscription: false })
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toMatch(/^tierguard: map finished as approved and .*\$\d+\.\d\d off your API bill$/)
})

test('an agent with no usage leaves the coverage line at "from 1 of 2 agents"', async ($, on) => {
  const w = await flow($, on, { subscription: true, agents: 2 })
  const ui = await detail($, w.id())
  expect(await ui.find({ type: 'Text', text: /from 1 of 2 agents/ })).toBeDefined()
  await ui.unmount()
})
