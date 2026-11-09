import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmtPct, fmtUsd, fmtTokens, modelLines, phaseHeadLength, phaseLayout, phaseStatus, phaseTitle, savedBlock, agentColumn, listHeader, listCell, toastText } from '../src/savedText.mjs'
import { modelColor, savedColor } from '../src/palette.mjs'

const range = (mid, pm, lo = mid - pm) => ({ mid, lo, hi: mid + pm, pm })
const text = (line) => line.map((s) => s.text).join('')
const lines = (saved, opts) => savedBlock(saved, opts).map(text)

const saved = (over = {}) => ({
  status: 'estimated',
  why: null,
  running: false,
  subscription: true,
  baseline: { family: 'opus', effort: 'high' },
  dollars: range(2.32, 0.59),
  actualDollars: 1.45,
  baselineDollars: 3.77,
  tokens: { saved: 2_900_000, outputSaved: 10_000 },
  limits: { five_hour: range(1.4, 0.6), seven_day: range(0.2, 0.1), readings: { five_hour: 8, seven_day: 8 } },
  used: { five_hour: 40, seven_day: 10 },
  agents: [
    { agentId: 'a1', dollars: 0.63, five_hour: 0.4 },
    { agentId: 'a2', dollars: null, five_hour: null }
  ],
  coverage: { used: 4, total: 4, unpriced: 0, noRatio: [] },
  sources: { measuredPairs: 22, chained: [], priors: [] },
  transitions: [],
  ...over
})

const view = (over = {}) => ({
  key: 'k1',
  ok: true,
  color: 'green',
  reason: null,
  title: 'research-config',
  status: 'completed',
  saved: saved(),
  endedClock: '14:51',
  ...over
})

test('fmtPct keeps one decimal and floors tiny values', () => {
  assert.equal(fmtPct(1.44), '1.4%')
  assert.equal(fmtPct(0.04), '< 0.1%')
  assert.equal(fmtPct(0), '< 0.1%')
  assert.equal(fmtPct(12), '12.0%')
  assert.equal(fmtPct(-0.7), '-0.7%')
})

test('fmtUsd keeps two decimals', () => {
  assert.equal(fmtUsd(2.316), '$2.32')
  assert.equal(fmtUsd(0), '$0.00')
  assert.equal(fmtUsd(-0.7), '-$0.70')
})

test('fmtTokens uses M, k and plain counts on the absolute value', () => {
  assert.equal(fmtTokens(2_900_000), '2.9M')
  assert.equal(fmtTokens(84_123), '84k')
  assert.equal(fmtTokens(512), '512')
  assert.equal(fmtTokens(-8_800_000), '8.8M')
  assert.equal(fmtTokens(999_900), '1.0M')
})

const CONTEXT = { tokens: 125_000, window: 1_000_000, pct: 12.4 }
const barOf = (line) => line.slice(line.findIndex((s) => s.text === '│') - 25, line.findIndex((s) => s.text === '│') + 1)
const hex = (s) => typeof s.color === 'string' && s.color.startsWith('#')

test('the block shows both limit bars, the money line, the tokens and one note', () => {
  assert.deepEqual(lines(saved()), [
    'ultraguard saved  vs every agent on Opus high',
    '  5-hour  ' + '━'.repeat(10) + '╸' + '─'.repeat(14) + '│' + '   40%  +1.4 ±0.6',
    '  weekly  ' + '━━━╸' + '─'.repeat(21) + '│' + '   10%  +0.2 ±0.1',
    '  $2.32 ±$0.59 at API prices',
    '  2.9M fewer tokens',
    '  ± = how far off, 9 times in 10'
  ])
})

test('the context row leads, with its fill and window', () => {
  const block = lines(saved(), { context: CONTEXT })
  assert.equal(block[1], '  context ' + '━━━' + '─'.repeat(22) + '│' + '   12%  125k of 1M')
  assert.equal(block[2].slice(0, 10), '  5-hour  ')
})

test('a context with no reading yet shows an empty track and a dash', () => {
  const block = lines(saved(), { context: { tokens: null, window: 1_000_000, pct: null } })
  assert.equal(block[1], '  context ' + '─'.repeat(25) + '│' + '     —  — of 1M')
  assert.equal(lines(saved(), { context: null })[1].slice(0, 10), '  5-hour  ')
})

test('the context window prints in millions or thousands', () => {
  assert.ok(lines(saved(), { context: { tokens: 84_000, window: 200_000, pct: 42 } })[1].endsWith('42%  84k of 200k'))
})

test('the header holds one line when it fits and two when it does not', () => {
  assert.equal(lines(saved({ running: true }), { width: 56 })[0], 'ultraguard saved so far  vs every agent on Opus high')
  assert.deepEqual(lines(saved({ running: true }), { width: 40 }).slice(0, 2), ['ultraguard saved so far', 'vs every agent on Opus high'])
})

test('the model in the header takes its effort color', () => {
  const model = (over) => savedBlock(saved(over))[0].find((s) => s.text === over.baseline.family.replace(/^./, (c) => c.toUpperCase()))
  assert.deepEqual(model({ baseline: { family: 'sonnet', effort: 'xhigh' } }), { text: 'Sonnet', style: 'bold', color: '#ef790c' })
  assert.deepEqual(model({ baseline: { family: 'fable', effort: 'max' } }), { text: 'Fable', style: 'bold', color: modelColor('fable', 'max') })
})

test('the bar segments carry the ink, the track, the limit mark and the saving gradient', () => {
  const [, five] = savedBlock(saved())
  const bar = five.filter((s) => ['━', '╸', '─', '│'].includes(s.text))
  assert.ok(bar.slice(0, 10).every((s) => s.text === '━' && s.color === 'text' && s.style === 'plain'))
  const savedCells = bar.filter(hex)
  assert.equal(savedCells.at(-1).color, savedColor(1.4))
  assert.ok(bar.filter((s) => s.text === '─').every((s) => s.color === 'subtle'))
  assert.deepEqual(bar.find((s) => s.text === '│'), { text: '│', style: 'plain', color: 'inactive' })
  const figure = five.find((s) => s.style === 'saved')
  assert.deepEqual(figure, { text: '+1.4', style: 'saved', pct: 1.4 })
  assert.ok(five.some((s) => s.style === 'dim' && s.text === ' ±0.6'))
})

test('the last saved cell and the figure share one color for a large saving', () => {
  const block = savedBlock(saved({ limits: { five_hour: range(30, 5), seven_day: range(0.2, 0.1), readings: { five_hour: 8, seven_day: 8 } }, used: { five_hour: 10, seven_day: 10 } }))
  const cells = block[1].filter(hex)
  assert.equal(cells.at(-1).color, savedColor(30))
  assert.ok(new Set(cells.map((s) => s.color)).size >= 5)
  const lum = cells.map((s) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(s.color.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  })
  for (let i = 1; i < lum.length; i++) assert.ok(lum[i] <= lum[i - 1] + 1e-3)
})

test('use plus saving over the limit spills the bar past the mark and says so', () => {
  const block = lines(saved({ limits: { five_hour: range(30, 12, 18), seven_day: range(0.2, 0.1), readings: { five_hour: 8, seven_day: 8 } }, used: { five_hour: 85, seven_day: 10 } }))
  assert.ok(block[1].includes('│'))
  assert.ok(block[1].indexOf('│') < block[1].lastIndexOf('━'))
  assert.deepEqual(block.slice(3, 5), ['  without ultraguard you would have blown past your', '  5-hour limit'])
})

test('a saving past half of a limit says so, hedged on a small margin', () => {
  const half = (used, mid) => lines(saved({ limits: { five_hour: range(mid, 4, mid - 2), seven_day: range(0.2, 0.1), readings: { five_hour: 8, seven_day: 8 } }, used: { five_hour: used, seven_day: 10 } }))
  const said = (block) => block.slice(3, -3).join(' ').replace(/\s+/g, ' ').trim()
  assert.equal(said(half(40, 15)), 'without ultraguard you would have been past half of your 5-hour limit already')
  assert.equal(said(half(46, 5)), 'without ultraguard you would likely have been past half of your 5-hour limit already')
  assert.ok(!half(40, 5).join('\n').includes('past half'))
})

test('long messages wrap inside the width', () => {
  const block = lines(saved({ limits: { five_hour: range(30, 12, 18), seven_day: range(8, 6, 2), readings: { five_hour: 8, seven_day: 8 } }, used: { five_hour: 85, seven_day: 96 } }), { width: 44 })
  assert.deepEqual(block.slice(4, 6), ['  without ultraguard you would have blown', '  past your 5-hour and weekly limits'])
})

test('no line is wider than the block, which is capped at 56 columns', () => {
  const states = [saved(), saved({ subscription: false, limits: null }), saved({ tokens: { saved: -8_800_000, outputSaved: -1 }, transitions: [{ from: 'sonnet:high', to: 'opus:high', source: 'measured' }] })]
  for (const state of states) {
    for (const width of [44, 56, 72, 110]) {
      for (const line of savedBlock(state, { width, context: CONTEXT })) {
        const size = text(line).length
        assert.ok(size <= 56, `${width}: ${size} ${text(line)}`)
        if (!text(line).includes('│')) assert.ok(size <= Math.max(width, 10), `${width}: ${text(line)}`)
      }
    }
  }
})

test('an API key shows a cost bar from the bill it avoided', () => {
  const block = savedBlock(saved({ subscription: false, limits: null, used: undefined }))
  const cost = text(block[1])
  assert.ok(cost.startsWith('  cost    '))
  assert.ok(cost.endsWith('  $1.45  +$2.32 ±$0.59'))
  const cells = block[1].filter(hex)
  assert.equal(cells.at(-1).color, savedColor((100 * 2.32) / 3.77))
  assert.deepEqual(block[1].find((s) => s.style === 'saved'), { text: '+$2.32', style: 'saved', pct: (100 * 2.32) / 3.77 })
  assert.equal(lines(saved({ subscription: false, limits: null })).join('\n').includes('API prices'), false)
  assert.ok(!lines(saved({ subscription: false, limits: null })).join('\n').includes('5-hour'))
})

test('an API key with no baseline cost keeps the dollars as a line', () => {
  const block = lines(saved({ subscription: false, limits: null, baselineDollars: null }))
  assert.ok(block.includes('  $2.32 ±$0.59 off your API bill'))
  assert.ok(!block.some((l) => l.startsWith('  cost')))
})

test('no limit reading yet reads at API prices without bars', () => {
  const block = lines(saved({ subscription: null, limits: null }))
  assert.deepEqual(block.slice(1, 3), ['  $2.32 ±$0.59 at API prices', '  2.9M fewer tokens'])
  assert.ok(!block.join('\n').includes('5-hour'))
})

test('a limit with no usage reading draws its figure without a bar', () => {
  const block = lines(saved({ used: { five_hour: null, seven_day: null } }))
  assert.equal(block[1], '  5-hour  ' + ' '.repeat(34) + '+1.4 ±0.6')
  assert.ok(!block[1].includes('━') && !block[1].includes('│') && !block[1].includes('%'))
  assert.equal(lines(saved({ used: undefined }))[1], block[1])
})

test('an uncalibrated limit says how many readings it has, beside its usage', () => {
  const block = lines(saved({ limits: { five_hour: null, seven_day: null, readings: { five_hour: 3, seven_day: 1 } } }))
  assert.ok(block[1].endsWith('40%  learning 3/5'))
  assert.ok(block[2].endsWith('10%  learning 1/5'))
  assert.ok(!block[1].includes('╸'))
})

test('a calibrated window shows next to an uncalibrated one', () => {
  const block = lines(saved({ limits: { five_hour: range(1.4, 0.6), seven_day: null, readings: { five_hour: 8, seven_day: 2 } } }))
  assert.ok(block[1].endsWith('+1.4 ±0.6'))
  assert.ok(block[2].endsWith('learning 2/5'))
})

test('a tiny saving reads below 0.1 and a negative one has no plus', () => {
  const tiny = lines(saved({ limits: { five_hour: range(0.04, 0.5), seven_day: range(-0.4, 0.5), readings: { five_hour: 8, seven_day: 8 } } }))
  assert.ok(tiny[1].endsWith('+<0.1 ±0.5'))
  assert.ok(tiny[2].endsWith('-0.4 ±0.5'))
  assert.ok(!tiny[2].includes('+'))
  assert.equal(savedBlock(saved({ limits: { five_hour: range(0.04, 0.5), seven_day: range(-0.4, 0.5), readings: { five_hour: 8, seven_day: 8 } } }))[2].filter(hex).length, 0)
})

test('negative saved tokens read as more tokens and wrap inside the width', () => {
  const block = savedBlock(saved({ tokens: { saved: -8_800_000, outputSaved: -1 }, transitions: [{ from: 'sonnet:high', to: 'opus:high', source: 'measured' }] }))
  const i = block.findIndex((l) => text(l).includes('more tokens'))
  assert.equal(text(block[i]), '  8.8M more tokens: Sonnet read and wrote more, at a')
  assert.equal(text(block[i + 1]), '  lower price per token')
  assert.ok(block[i].some((s) => s.style === 'sonnet' && s.text === 'Sonnet'))
  assert.ok(block[i].some((s) => s.style === 'bold' && s.text === '8.8M'))
})

test('a range below zero says the run may have saved nothing', () => {
  const block = lines(saved({ limits: { five_hour: range(0.4, 1.1, -0.7), seven_day: range(0.1, 0.5, -0.4), readings: { five_hour: 9, seven_day: 9 } } }))
  assert.deepEqual(block.slice(-2), ['  ± = how far off, 9 times in 10', '  this run may have saved nothing'])
})

test('without limit bars the money range decides the nothing-saved line', () => {
  const block = lines(saved({ subscription: null, limits: null, dollars: range(0.7, 1.9, -1.2) }))
  assert.equal(block.at(-1), '  this run may have saved nothing')
  assert.ok(!lines(saved({ subscription: null, limits: null })).includes('  this run may have saved nothing'))
})

test('the note lines are dim and the money line is not', () => {
  const block = savedBlock(saved())
  assert.ok(block.at(-1).every((s) => s.style === 'dim'))
  const money = block.find((l) => text(l).includes('API prices'))
  assert.deepEqual(money.map((s) => s.style), ['plain', 'bold', 'dim', 'plain'])
})

test('a complete, measured run shows no coverage line', () => {
  assert.ok(!lines(saved()).join('\n').includes('agents'))
  assert.ok(!lines(saved()).join('\n').includes('replayed'))
})

test('sources say how the ratio was obtained, without a bare agent count above them', () => {
  const chained = lines(saved({ sources: { measuredPairs: 0, chained: [{ from: 'sonnet:high', to: 'opus:xhigh', via: 'high' }], priors: [] } }))
  assert.deepEqual(chained.slice(-3), ['  ± = how far off, 9 times in 10', '  ratio measured at high effort, adjusted with published', '  figures for xhigh'])
  const prior = lines(saved({ sources: { measuredPairs: 0, chained: [], priors: [{ from: 'sonnet:high', to: 'opus:xhigh' }] } }))
  assert.equal(prior.at(-3), '  ± = how far off, 9 times in 10')
  assert.equal(prior.slice(-2).join(' ').replace(/\s+/g, ' ').trim(), 'no replay measured sonnet high against opus xhigh; using published figures, so ± is wide')
  assert.ok(!prior.join('\n').includes('from 4 of 4'))
})

test('an unpriced agent is named in the coverage line, with the measured line after it', () => {
  const block = lines(saved({ coverage: { used: 5, total: 6, unpriced: 1, noRatio: [] } }), { width: 100 })
  assert.deepEqual(block.slice(-3), [
    '  from 5 of 6 agents: ultraguard has no price for the',
    '  model one agent ran on',
    '  ratio measured on 22 replayed agents'
  ])
})

test('several unpriced agents are counted', () => {
  const block = lines(saved({ coverage: { used: 3, total: 6, unpriced: 3, noRatio: [] }, sources: { measuredPairs: 0, chained: [], priors: [] } }))
  assert.equal(block.slice(-2).join(' ').replace(/\s+/g, ' ').trim(), 'from 3 of 6 agents: ultraguard has no price for the models 3 agents ran on')
})

test('an agent with no ratio is named in the coverage line', () => {
  const block = lines(saved({ coverage: { used: 3, total: 4, unpriced: 0, noRatio: ['haiku:low>opus:high'] }, sources: { measuredPairs: 0, chained: [], priors: [] } }))
  assert.ok(block.join(' ').replace(/\s+/g, ' ').includes('from 3 of 4 agents: ultraguard has no ratio for haiku low against opus high'))
})

test('an agent with no usage only lowers the count', () => {
  const block = lines(saved({ coverage: { used: 1, total: 2, unpriced: 0, noRatio: [] } }))
  assert.deepEqual(block.slice(-2), ['  from 1 of 2 agents', '  ratio measured on 22 replayed agents'])
})

test('nothing saved when every agent ran on the session setting', () => {
  const block = lines(saved({ status: 'none', dollars: range(0, 0), limits: null, tokens: { saved: 0, outputSaved: 0 } }))
  assert.deepEqual(block, ['ultraguard saved  vs every agent on Opus high', "  every agent ran on your session's model and effort, so", '  nothing was saved'])
})

test('no baseline means no estimate', () => {
  const block = lines(saved({ status: 'unknown', why: 'no-baseline', baseline: null, dollars: null, tokens: null, limits: null }))
  assert.deepEqual(block, ['ultraguard saved', "  ultraguard could not read your session's model or", '  effort, so it has no estimate'])
})

test('no usable agents shows only the coverage line', () => {
  const block = lines(
    saved({
      status: 'unknown',
      why: 'no-agents',
      dollars: null,
      tokens: null,
      limits: null,
      coverage: { used: 0, total: 2, unpriced: 2, noRatio: [] },
      sources: { measuredPairs: 0, chained: [], priors: [] }
    }),
    { width: 100 }
  )
  assert.equal(block[0], 'ultraguard saved  vs every agent on Opus high')
  assert.equal(block.slice(1).join(' ').replace(/\s+/g, ' ').trim(), 'from 0 of 2 agents: ultraguard has no price for the models 2 agents ran on')
})

test('the agent column follows the figure that shows', () => {
  const limit = agentColumn(saved())
  assert.equal(limit.header, '5h saves')
  assert.equal(limit.cell('a1'), '0.4%')
  assert.equal(limit.cell('a2'), '—')
  assert.equal(limit.cell('nope'), '—')

  const dollars = agentColumn(saved({ limits: null, subscription: false }))
  assert.equal(dollars.header, 'API saves')
  assert.equal(dollars.cell('a1'), '$0.63')
  assert.equal(dollars.cell('a2'), '—')

  const noLimit = agentColumn(saved({ limits: { five_hour: null, seven_day: null, readings: { five_hour: 1, seven_day: 1 } } }))
  assert.equal(noLimit.header, 'API saves')
  assert.equal(agentColumn(null).cell('a1'), '—')
})

test('a phase subtotal comes from its group and a finished agent without a figure hides it', () => {
  const groups = [{ key: 'P', dollars: 0.63, five_hour: 0.4, used: 1, total: 2 }]
  const limit = agentColumn(saved({ groups }))
  const phase = (...agents) => ({ key: 'P', agents: agents.map(([agentId, done]) => ({ agentId, done })) })
  assert.equal(limit.group(phase(['a1', true])), '0.4%')
  assert.equal(limit.group(phase(['a1', true], ['a2', false])), '0.4%')
  assert.equal(limit.group(phase(['a1', true], ['a2', true])), '—')
  assert.equal(limit.group({ key: 'other', agents: [] }), '—')
  const dollars = agentColumn(saved({ groups, limits: null, subscription: false }))
  assert.equal(dollars.group(phase(['a1', true])), '$0.63')
  assert.equal(agentColumn(saved()).group(phase(['a1', true])), '—')
  assert.equal(agentColumn(null).group(phase()), '—')
})

test('column colors follow the percentage, dollars and dashes have none', () => {
  const groups = [{ key: 'P', dollars: 0.63, five_hour: 0.4, used: 1, total: 2 }]
  const limit = agentColumn(saved({ groups }))
  assert.equal(limit.color('a1'), savedColor(0.4))
  assert.equal(limit.color('a2'), undefined)
  assert.equal(limit.color('nope'), undefined)
  const phase = (...agents) => ({ key: 'P', agents: agents.map(([agentId, done]) => ({ agentId, done })) })
  assert.equal(limit.groupColor(phase(['a1', true])), savedColor(0.4))
  assert.equal(limit.groupColor(phase(['a1', true], ['a2', true])), undefined)
  const dollars = agentColumn(saved({ groups, limits: null, subscription: false }))
  assert.equal(dollars.color('a1'), undefined)
  assert.equal(dollars.groupColor(phase(['a1', true])), undefined)
  assert.equal(agentColumn(null).color('a1'), undefined)
})

test('the tokens line joins the families with commas and a last "and"', () => {
  const transition = (family) => ({ from: `${family}:high`, to: 'fable:high', source: 'prior' })
  const line = (...families) => {
    const block = lines(saved({ tokens: { saved: -46_000, outputSaved: -1 }, transitions: families.map(transition) }))
    const i = block.findIndex((l) => l.includes('more tokens'))
    return block.slice(i, block.findIndex((l) => l.startsWith('  ± =')))
  }
  const said = (...families) => line(...families).join(' ').replace(/\s+/g, ' ').trim()
  assert.equal(said('haiku'), '46k more tokens: Haiku read and wrote more, at a lower price per token')
  assert.equal(said('haiku', 'opus'), '46k more tokens: Haiku and Opus read and wrote more, at a lower price per token')
  assert.equal(said('haiku', 'opus', 'sonnet'), '46k more tokens: Haiku, Opus and Sonnet read and wrote more, at a lower price per token')
  assert.ok(line('haiku', 'opus', 'sonnet').every((l) => l.length <= 56))
})

const phase = (over = {}) => ({ title: 'Investigate', state: 'done', total: 2, done: 2, red: 0, ...over })

test('a phase says how many agents it has, or how far a running one is', () => {
  assert.equal(phaseStatus(phase()), '2 agents')
  assert.equal(phaseStatus(phase({ total: 1, done: 1 })), '1 agent')
  assert.equal(phaseStatus(phase({ state: 'running', total: 5, done: 3 })), 'running  3 of 5 done')
})

test('the head of a phase row counts its caret, circle, title, status and red marker', () => {
  assert.equal(phaseHeadLength(phase()), '▸ ○ Investigate  2 agents'.length)
  assert.equal(phaseHeadLength(phase({ red: 1 })), '▸ ○ Investigate  2 agents  1 red'.length)
})

test('the phase table puts the saved column right after the labels and keeps the models column the rest', () => {
  const heads = [phaseHeadLength(phase())]
  const base = { labels: ['grunt: merged PRs', 'investigate: deprecations'], heads, cells: ['1.0%', '14.6%'], header: '5h saves' }
  assert.deepEqual(phaseLayout({ ...base, width: 76 }), { field: 29, savedAt: 35, savedWidth: 11, modelsAt: 46 })
  assert.deepEqual(phaseLayout({ ...base, width: 60 }), { field: 29, savedAt: 35, savedWidth: 11, modelsAt: 46 })
  assert.equal(phaseLayout({ ...base, width: 40 }).field, 12)
  assert.equal(phaseLayout({ ...base, labels: ['x'.repeat(60)], width: 200 }).field, 34)
  assert.equal(phaseLayout({ ...base, labels: [], heads: [], width: 200 }).field, 12)
})

test('a long phase title widens the label column up to its cap, then the title is cut with an ellipsis', () => {
  const mid = phase({ title: 'Investigate', state: 'running', total: 12, done: 7 })
  const wide = phaseLayout({ labels: ['a'], heads: [phaseHeadLength(mid)], cells: ['1.0%'], header: '5h saves', width: 120 })
  assert.equal(phaseTitle(mid, wide.savedAt), 'Investigate')
  const long = phase({ title: 'x'.repeat(40), red: 1 })
  const capped = phaseLayout({ labels: ['a'], heads: [phaseHeadLength(long)], cells: ['1.0%'], header: '5h saves', width: 120 })
  assert.equal(capped.field, 34)
  const cut = phaseTitle(long, capped.savedAt)
  assert.ok(cut.endsWith('…') && cut.length < 40)
  assert.ok(phaseHeadLength({ ...long, title: cut }) + 2 <= capped.savedAt)
})

test('a pane with no saved column gives the models column the room', () => {
  assert.deepEqual(phaseLayout({ labels: ['a: b'], heads: [], cells: [], header: '', width: 76 }), { field: 12, savedAt: 18, savedWidth: 0, modelsAt: 18 })
})

test('the models of a folded phase read opus, sonnet, haiku with two spaces between them', () => {
  const [line] = modelLines({ opus: 11, sonnet: 10, haiku: 12 }, 40)
  assert.equal(text(line), 'opus 11  sonnet 10  haiku 12')
  assert.deepEqual(line.map((s) => s.style), ['opus', 'dim', 'plain', 'sonnet', 'dim', 'plain', 'haiku', 'dim'])
  assert.equal(text(modelLines({ opus: 0, sonnet: 0, haiku: 14 }, 40)[0]), 'haiku 14')
  assert.equal(text(modelLines({ opus: 0, sonnet: 0, haiku: 0 }, 40)[0]), 'no agents yet')
})

test('models that do not fit the width wrap onto the next line, a family never split', () => {
  const lines = modelLines({ opus: 11, sonnet: 10, haiku: 12 }, 20)
  assert.deepEqual(lines.map(text), ['opus 11  sonnet 10', 'haiku 12'])
  assert.deepEqual(modelLines({ opus: 1, sonnet: 0, haiku: 0 }, 3).map(text), ['opus 1'])
})

test('the list header picks the unit any view can show', () => {
  assert.deepEqual(listHeader([view()]), [{ text: '5h saves', style: 'dim' }])
  const dollars = view({ saved: saved({ limits: null }) })
  assert.equal(text(listHeader([dollars, view({ saved: null })])), 'API saves')
  assert.equal(text(listHeader([dollars, view()])), '5h saves')
  assert.equal(text(listHeader([])), 'API saves')
})

test('list cells show the figure, so far, dollars or a dash', () => {
  assert.equal(text(listCell(view())), '1.4% ± 0.6')
  assert.deepEqual(listCell(view()), [
    { text: '1.4%', style: 'saved', pct: 1.4 },
    { text: ' ± 0.6', style: 'dim' }
  ])
  assert.equal(text(listCell(view({ saved: saved({ running: true, limits: { five_hour: range(0.6, 0.3), seven_day: null, readings: { five_hour: 6, seven_day: 6 } } }) }))), '0.6% so far')
  assert.equal(text(listCell(view({ saved: saved({ limits: null, dollars: range(2.32, 1.1) }) }))), '$2.32 ± $1.10')
  assert.equal(text(listCell(view({ saved: saved({ running: true, limits: null, dollars: range(0.63, 0.2) }) }))), '$0.63 so far')
})

test('list cells show a dash when nothing is known or saved', () => {
  assert.equal(text(listCell(view({ saved: null }))), '—')
  assert.equal(text(listCell(view({ saved: saved({ status: 'unknown', dollars: null, limits: null }) }))), '—')
  assert.equal(text(listCell(view({ saved: saved({ status: 'none', limits: null }) }))), '—')
})

test('a red view leaves its reason to the caller', () => {
  assert.deepEqual(listCell(view({ ok: false, color: 'red', reason: 'agent off-plan' })), [])
})

test('the toast says what the run saved', () => {
  assert.equal(toastText(view()), 'ultraguard: research-config finished as approved and saved about 1.4% of your 5-hour limit')
})

test('the toast falls back to dollars at API prices when the limit is not calibrated', () => {
  const limits = { five_hour: null, seven_day: null, readings: { five_hour: 2, seven_day: 2 } }
  assert.equal(toastText(view({ saved: saved({ limits }) })), 'ultraguard: research-config finished as approved and saved about $2.32 at API prices')
  assert.equal(toastText(view({ saved: saved({ limits: null, subscription: null }) })), 'ultraguard: research-config finished as approved and saved about $2.32 at API prices')
})

test('the toast speaks of the API bill on an API key', () => {
  assert.equal(toastText(view({ saved: saved({ limits: null, subscription: false }) })), 'ultraguard: research-config finished as approved and saved about $2.32 off your API bill')
})

test('the toast says nothing changed when every agent ran on the session setting', () => {
  assert.equal(toastText(view({ saved: saved({ status: 'none' }) })), "ultraguard: research-config finished as approved; every agent ran on your session's model and effort")
})

test('the toast names the reason of a red run', () => {
  assert.equal(toastText(view({ ok: false, color: 'red', reason: 'agent off-plan' })), 'ultraguard: research-config finished, but agent off-plan')
})

test('the toast stays plain when there is no estimate', () => {
  assert.equal(toastText(view({ saved: null })), 'ultraguard: research-config finished as approved')
  assert.equal(toastText(view({ saved: saved({ status: 'unknown', dollars: null }) })), 'ultraguard: research-config finished as approved')
})
