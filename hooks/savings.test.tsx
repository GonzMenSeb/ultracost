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

type Options = { subscription: boolean; context?: { tokens?: number }; compact?: number; gate?: boolean; agents?: number; readings?: number; finish?: boolean; complete?: boolean; preload?: Record<string, unknown>; now?: number; record?: Record<string, unknown> }

async function flow($: any, on: any, options: Options) {
  const { subscription, context = {}, compact, gate = true, agents = 1, readings = 6, finish = true, complete = true, preload = {}, now = 5000, record = {} } = options
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
  return { writes, toasts, store, clock, id: () => toolUseId, setContext: (next: Record<string, unknown>) => (fill = { window: 200000, ...next }) }
}

const detail = async ($: any, id: string) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `run:${id}` })
  return ui
}

test('the detail shows what a finished run saved, against the session model and effort', async ($, on) => {
  const w = await flow($, on, { subscription: true })
  const ui = await detail($, w.id())
  expect(await ui.find({ type: 'Text', text: /ultraguard saved\s+vs every agent on Opus high/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ +5-hour +[━╸─│ ]+ +13% +\+\d+\.\d ±\d+\.\d$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ +weekly +[━╸─│ ]+ +3% +\+/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ +\$\d+\.\d\d ±\$\d+\.\d\d at API prices$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ +± = how far off, 9 times in 10$/ })).toBeDefined()
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
  expect(Object.keys(w.store)).toEqual([`meter:${SESSION}`])
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
  expect(await ui.find({ type: 'Text', text: /^ +cost +[━╸─│ ]+ +\$\d+\.\d\d +\+\$\d+\.\d\d ±\$\d+\.\d\d$/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /\+\d+\.\d ±/ })).toBeUndefined()
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
  expect(await ui.find({ type: 'Text', text: /ultraguard saved so far/ })).toBeDefined()
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
  expect(Object.keys(w.store).sort()).toEqual(['meter:recent', `meter:${SESSION}`].sort())
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
  const header = await ui.find({ type: 'Text', text: /^▾ ● Investigate/ })
  expect(header?.text).toMatch(/^▾ ● Investigate {2}1 agent\s+\$\d+\.\d\d\s*$/)
  expect((await ui.find({ type: 'Text', text: /Decide/ }))?.text).toBe('      Decide  did not run')
  await ui.unmount()
})

test('a subscription phase block shows its share of the 5-hour limit', async ($, on) => {
  const w = await flow($, on, { subscription: true, record: ONE_PHASE('Investigate') })
  const ui = await detail($, w.id())
  expect((await ui.find({ type: 'Text', text: /^▾ ● Investigate/ }))?.text).toMatch(/^▾ ● Investigate {2}1 agent\s+\S+%\s*$/)
  expect((await ui.find({ type: 'Text', text: /^ +agent/ }))?.text).toMatch(/agent\s+5h saves {3}ran on$/)
  await ui.unmount()
})

test('the saved column comes before ran on, and the phase and agent figures share its column', async ($, on) => {
  const w = await flow($, on, { subscription: false, record: ONE_PHASE('Investigate') })
  const ui = await detail($, w.id())
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
  const agentRow = (await ui.find({ type: 'Text', text: /^ {4}✓ investigate: map/ }))?.text ?? ''
  await ui.press({ key: 'phase:Investigate' })
  const folded = (await ui.find({ type: 'Text', text: /^▸ ● Investigate/ }))?.text ?? ''
  expect(folded).toMatch(/\$\d+\.\d\d\s+sonnet 1$/)
  expect(folded.indexOf('$')).toBe(agentRow.indexOf('$'))
  expect(folded.indexOf('sonnet 1')).toBe(agentRow.indexOf('sonnet high'))
  expect(await ui.find({ type: 'Text', text: /^ {4}✓ investigate: map/ })).toBeUndefined()
  await ui.unmount()
})

test('on a narrow pane a long phase title is shortened so the saved figure keeps its column', async ($, on) => {
  const w = await flow($, on, { subscription: false, record: ONE_PHASE('Investigate the repository') })
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 60 }, surface: 'terminal' })
  await ui.press({ key: `run:${w.id()}` })
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
  const block = texts.findIndex(t => /^ultraguard saved/.test(t))
  expect(block).toBeGreaterThan(-1)
  expect(texts.join('\n')).not.toContain(' · ')
  await ui.press({ key: 'back' })
  const list: string[] = (await ui.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? ''))
  expect(list.some(t => /workflow\s+id\s+agents\s+API saves/.test(t))).toBe(true)
  expect(list.join('\n')).not.toContain(' · ')
  await ui.unmount()
})

const order = async (ui: any, first: RegExp, second: RegExp) => {
  const texts: string[] = (await ui.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? ''))
  return [texts.findIndex(t => first.test(t)), texts.findIndex(t => second.test(t))]
}

test('the flat table keeps the saved block above it, the phase tree sits above the saved block', async ($, on) => {
  const flat = await flow($, on, { subscription: false })
  const flatUi = await detail($, flat.id())
  const [saved, header] = await order(flatUi, /^ultraguard saved/, /^ +agent/)
  expect(saved).toBeGreaterThan(-1)
  expect(header).toBeGreaterThan(saved)
  await flatUi.unmount()
})

test('with phases the tree comes before the saved block', async ($, on) => {
  const w = await flow($, on, { subscription: false, record: ONE_PHASE('Investigate') })
  const ui = await detail($, w.id())
  const [header, saved] = await order(ui, /^ +agent/, /^ultraguard saved/)
  expect(header).toBeGreaterThan(-1)
  expect(saved).toBeGreaterThan(header)
  await ui.unmount()
})
