import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmtPct, fmtUsd, fmtTokens, savedBlock, agentColumn, listHeader, listCell, toastText } from '../src/savedText.mjs'

const range = (mid, pm, lo = mid - pm) => ({ mid, lo, hi: mid + pm, pm })
const text = (line) => line.map((s) => s.text).join('')
const lines = (saved) => savedBlock(saved).map(text)
const at36 = (left, right) => left.padEnd(36) + right

const PM = '  ± = how far off the estimate can be, 9 times out of 10'
const COVERAGE = '  from 4 of 4 agents · ratio measured on 22 replayed agents'
const VERSUS = "compared with running every agent on Opus at high effort, your session's setting"

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

test('the detail block shows both limits, dollars and tokens', () => {
  assert.deepEqual(lines(saved()), [
    'ultraguard saved',
    VERSUS,
    at36('  1.4% of your 5-hour limit', '± 0.6'),
    at36('  0.2% of your weekly limit', '± 0.1'),
    at36('  $2.32 at API prices', '± $0.59   62% of the $3.77 Opus would cost'),
    '  2.9M fewer tokens',
    PM,
    COVERAGE
  ])
})

test('the ± column starts at column 36', () => {
  const block = lines(saved())
  for (const row of block.slice(2, 5)) assert.equal(row.indexOf('±'), 36)
})

test('headline, family and figures carry their styles', () => {
  const block = savedBlock(saved())
  assert.deepEqual(block[0], [{ text: 'ultraguard saved', style: 'bold' }])
  const versus = block[1]
  assert.ok(versus.every((s) => ['dim', 'opus'].includes(s.style)))
  assert.deepEqual(versus.find((s) => s.style === 'opus'), { text: 'Opus', style: 'opus' })
  assert.ok(block[2].some((s) => s.style === 'bold' && s.text.trim() === '1.4%'))
  assert.ok(block[2].some((s) => s.style === 'dim' && s.text === '± 0.6'))
  assert.ok(block[6].every((s) => s.style === 'dim'))
})

test('other families take their own style', () => {
  const block = savedBlock(saved({ baseline: { family: 'fable', effort: 'max' } }))
  assert.deepEqual(block[1].find((s) => s.style === 'fable'), { text: 'Fable', style: 'fable' })
  assert.equal(text(block[1]), "compared with running every agent on Fable at max effort, your session's setting")
})

test('a running block says so far', () => {
  assert.equal(lines(saved({ running: true }))[0], 'ultraguard saved so far')
})

test('an API key shows dollars first and no limit lines', () => {
  const block = lines(saved({ subscription: false, limits: null }))
  assert.deepEqual(block.slice(2, 4), [at36('  $2.32 off your API bill', '± $0.59   62% of the $3.77 Opus would cost'), '  2.9M fewer tokens'])
  assert.ok(!block.join('\n').includes('5-hour'))
  assert.ok(!block.join('\n').includes('weekly'))
})

test('no limit reading yet reads at API prices without limit lines', () => {
  const block = lines(saved({ subscription: null, limits: null }))
  assert.equal(block[2], at36('  $2.32 at API prices', '± $0.59   62% of the $3.77 Opus would cost'))
  assert.ok(!block.join('\n').includes('limit'))
})

test('an uncalibrated limit says how many readings it has', () => {
  const block = lines(saved({ limits: { five_hour: null, seven_day: null, readings: { five_hour: 3, seven_day: 1 } } }))
  assert.deepEqual(block.slice(2, 5), [
    '  5-hour limit: learning how fast your limit fills, 3 of 5 readings so far',
    '  weekly limit: learning how fast your limit fills, 1 of 5 readings so far',
    at36('  $2.32 at API prices', '± $0.59   62% of the $3.77 Opus would cost')
  ])
})

test('a calibrated window shows next to an uncalibrated one', () => {
  const block = lines(saved({ limits: { five_hour: range(1.4, 0.6), seven_day: null, readings: { five_hour: 8, seven_day: 2 } } }))
  assert.equal(block[2], at36('  1.4% of your 5-hour limit', '± 0.6'))
  assert.equal(block[3], '  weekly limit: learning how fast your limit fills, 2 of 5 readings so far')
})

test('negative saved tokens read as more tokens', () => {
  const block = savedBlock(saved({ tokens: { saved: -8_800_000, outputSaved: -1 }, transitions: [{ from: 'sonnet:high', to: 'opus:high', source: 'measured' }] }))
  assert.equal(text(block[5]), '  8.8M more tokens: Sonnet read and wrote more, at a lower price per token')
  assert.ok(block[5].some((s) => s.style === 'sonnet' && s.text === 'Sonnet'))
})

test('a range below zero says the run may have saved nothing', () => {
  const block = lines(
    saved({
      dollars: range(0.7, 1.9, -1.2),
      limits: { five_hour: range(0.4, 1.1, -0.7), seven_day: range(0.1, 0.5, -0.4), readings: { five_hour: 9, seven_day: 9 } }
    })
  )
  assert.equal(block[2], at36('  0.4% of your 5-hour limit', '± 1.1   this run may have saved nothing'))
  assert.equal(block[3], at36('  0.1% of your weekly limit', '± 0.5'))
  assert.equal(block[4], at36('  $0.70 at API prices', '± $1.90   19% of the $3.77 Opus would cost'))
})

test('the nothing-saved sentence rides the first figure line when there are no limit lines', () => {
  const block = lines(saved({ subscription: null, limits: null, dollars: range(0.7, 1.9, -1.2) }))
  assert.equal(block[2], at36('  $0.70 at API prices', '± $1.90   19% of the $3.77 Opus would cost   this run may have saved nothing'))
})

test('sources say how the ratio was obtained', () => {
  const chained = lines(
    saved({
      sources: { measuredPairs: 0, chained: [{ from: 'sonnet:high', to: 'opus:xhigh', via: 'high' }], priors: [] }
    })
  )
  assert.equal(chained.at(-2), '  from 4 of 4 agents')
  assert.equal(chained.at(-1), '  ratio measured at high effort, adjusted with published figures for xhigh')

  const prior = lines(
    saved({
      sources: { measuredPairs: 0, chained: [], priors: [{ from: 'sonnet:high', to: 'opus:xhigh' }] }
    })
  )
  assert.equal(prior.at(-2), '  from 4 of 4 agents')
  assert.equal(prior.at(-1), '  no replay measured sonnet · high against opus · xhigh; using published figures, so ± is wide')
})

test('an unpriced agent is named in the coverage line', () => {
  const block = lines(saved({ coverage: { used: 5, total: 6, unpriced: 1, noRatio: [] } }))
  assert.deepEqual(block.slice(-2), [
    '  from 5 of 6 agents: ultraguard has no price for the model one agent ran on',
    '  ratio measured on 22 replayed agents'
  ])
})

test('several unpriced agents are counted', () => {
  const block = lines(saved({ coverage: { used: 3, total: 6, unpriced: 3, noRatio: [] }, sources: { measuredPairs: 0, chained: [], priors: [] } }))
  assert.equal(block.at(-1), '  from 3 of 6 agents: ultraguard has no price for the models 3 agents ran on')
})

test('an agent with no ratio is named in the coverage line', () => {
  const block = lines(saved({ coverage: { used: 3, total: 4, unpriced: 0, noRatio: ['haiku:low>opus:high'] }, sources: { measuredPairs: 0, chained: [], priors: [] } }))
  assert.equal(block.at(-1), '  from 3 of 4 agents: ultraguard has no ratio for haiku · low against opus · high')
})

test('an agent with no usage only lowers the count', () => {
  const block = lines(saved({ coverage: { used: 1, total: 2, unpriced: 0, noRatio: [] } }))
  assert.equal(block.at(-1), '  from 1 of 2 agents · ratio measured on 22 replayed agents')
})

test('nothing saved when every agent ran on the session setting', () => {
  const block = lines(saved({ status: 'none', dollars: range(0, 0), limits: null, tokens: { saved: 0, outputSaved: 0 } }))
  assert.deepEqual(block, ['ultraguard saved', "  every agent ran on your session's model and effort, so nothing was saved"])
})

test('no baseline means no estimate', () => {
  const block = lines(saved({ status: 'unknown', why: 'no-baseline', baseline: null, dollars: null, tokens: null, limits: null }))
  assert.deepEqual(block, ['ultraguard saved', "  ultraguard could not read your session's model or effort, so it has no estimate"])
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
    })
  )
  assert.deepEqual(block, ['ultraguard saved', VERSUS, '  from 0 of 2 agents: ultraguard has no price for the models 2 agents ran on'])
})

test('the agent column follows the figure that shows', () => {
  const limit = agentColumn(saved())
  assert.equal(limit.header, 'saved of 5-hour limit')
  assert.equal(limit.cell('a1'), '0.4%')
  assert.equal(limit.cell('a2'), '—')
  assert.equal(limit.cell('nope'), '—')

  const dollars = agentColumn(saved({ limits: null, subscription: false }))
  assert.equal(dollars.header, 'saved at API prices')
  assert.equal(dollars.cell('a1'), '$0.63')
  assert.equal(dollars.cell('a2'), '—')

  const noLimit = agentColumn(saved({ limits: { five_hour: null, seven_day: null, readings: { five_hour: 1, seven_day: 1 } } }))
  assert.equal(noLimit.header, 'saved at API prices')
  assert.equal(agentColumn(null).cell('a1'), '—')
})

test('the list header picks the unit any view can show', () => {
  assert.deepEqual(listHeader([view()]), [{ text: 'saved of 5-hour limit', style: 'dim' }])
  const dollars = view({ saved: saved({ limits: null }) })
  assert.equal(text(listHeader([dollars, view({ saved: null })])), 'saved at API prices')
  assert.equal(text(listHeader([dollars, view()])), 'saved of 5-hour limit')
  assert.equal(text(listHeader([])), 'saved at API prices')
})

test('list cells show the figure, so far, dollars or a dash', () => {
  assert.equal(text(listCell(view())), '1.4% ± 0.6')
  assert.deepEqual(listCell(view()), [
    { text: '1.4%', style: 'bold' },
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
