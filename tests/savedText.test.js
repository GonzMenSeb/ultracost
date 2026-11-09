import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fmtPct, fmtUsd, fmtTokens, modelLines, phaseHeadLength, phaseLayout, phaseStatus, phaseTitle, rangeText, savedBlock, savedBody, overallBlock, sectionHead, subHead, baselineLine, RULE, SUB_RULE, agentColumn, listHeader, listCell, toastText, SAME_MODEL, WORKFLOWS_HEAD, RUNNING_EXTRA, NO_RUNNING, FINISHED_TITLE, STOPPED_TITLE, MORE_ABOVE, MORE_BELOW, LIST_HINT, FOLD_HINT, FOCUS_HINT, PHASES_HEAD, AGENTS_HEAD, CHECKS_HEAD, foldLine, endedText } from '../src/savedText.mjs'
import { modelColor, savedColor } from '../src/palette.mjs'
import { createTally, noteTallyRun, overallInput, combine } from '../src/tally.mjs'
import { estimateRun } from '../src/savings.mjs'
import { loadPrices } from '../src/prices.mjs'
import { seedOf } from '../src/stats.mjs'
import { createMeter } from '../src/meter.mjs'

const range = (mid, pm, lo = mid - pm) => ({ mid, lo, hi: mid + pm, pm })
const text = (line) => line.map((s) => s.text).join('')
const lines = (saved, opts) => savedBlock(saved, opts).map(text)
const head = (title, width = 56) => `══ ${title} ` + '═'.repeat(width - title.length - 4)

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

test('a range reads low to high, in tenths of a point or in cents', () => {
  assert.equal(rangeText({ mid: 30.06, lo: 3.04, hi: 91.55 }, 'points'), ' (3.0 to 91.6)')
  assert.equal(rangeText({ mid: 12.04, lo: 1.2, hi: 35.21 }, 'usd'), ' ($1.20 to $35.21)')
  assert.equal(rangeText({ mid: 1.4, lo: -0.3, hi: 2.1 }, 'points'), ' (-0.3 to 2.1)')
  assert.equal(rangeText({ mid: 1.4, lo: -0.04, hi: 2.1 }, 'points'), ' (0.0 to 2.1)')
  assert.equal(rangeText({ mid: 1, lo: -0.004, hi: 2 }, 'usd'), ' ($0.00 to $2.00)')
  assert.equal(rangeText({ mid: -0.001, lo: -0.3, hi: -0.0049 }, 'usd'), ' (-$0.30 to $0.00)')
  assert.equal(rangeText({ mid: 1, lo: -0.006, hi: 2 }, 'usd'), ' (-$0.01 to $2.00)')
})

test('every saving figure of the block reads as a range, never with ±', () => {
  const wide = { mid: 30.06, lo: 3.04, hi: 91.55, pm: 61.49 }
  const block = lines(saved({ limits: { five_hour: wide, seven_day: range(0.2, 0.1), readings: { five_hour: 8, seven_day: 8 } }, used: { five_hour: 10, seven_day: 10 }, dollars: { mid: 12.04, lo: 1.2, hi: 35.21, pm: 23.17 } }))
  assert.ok(block[2].endsWith('+30.1 (3.0 to 91.6)'))
  assert.ok(block.includes('  $12.04 ($1.20 to $35.21) at API prices'))
  assert.ok(block.includes('  range = 9 times in 10'))
  assert.ok(!block.join('\n').includes('±'))
})

const CONTEXT = { tokens: 125_000, window: 1_000_000, pct: 12.4 }
const barOf = (line) => line.slice(line.findIndex((s) => s.text === '│') - 25, line.findIndex((s) => s.text === '│') + 1)
const hex = (s) => typeof s.color === 'string' && s.color.startsWith('#')

test('the block shows both limit bars, the money line, the tokens and one note', () => {
  assert.deepEqual(lines(saved()), [
    head('ultraguard saved'),
    '  vs every agent on Opus high',
    '  5-hour  ' + '━'.repeat(8) + '╸' + '─'.repeat(11) + '│' + '   40%  +1.4 (0.8 to 2.0)',
    '  weekly  ' + '━━╸' + '─'.repeat(17) + '│' + '   10%  +0.2 (0.1 to 0.3)',
    '  $2.32 ($1.73 to $2.91) at API prices',
    '  2.9M fewer tokens',
    '  range = 9 times in 10'
  ])
})

test('the context row leads, with its fill and window', () => {
  const block = lines(saved(), { context: CONTEXT })
  assert.equal(block[2], '  context ' + '━━╸' + '─'.repeat(17) + '│' + '   12%  125k of 1M')
  assert.equal(block[3].slice(0, 10), '  5-hour  ')
})

test('a context with no reading yet shows an empty track and a dash', () => {
  const block = lines(saved(), { context: { tokens: null, window: 1_000_000, pct: null } })
  assert.equal(block[2], '  context ' + '─'.repeat(20) + '│' + '     —  — of 1M')
  assert.equal(lines(saved(), { context: null })[2].slice(0, 10), '  5-hour  ')
})

test('the context window prints in millions or thousands', () => {
  assert.ok(lines(saved(), { context: { tokens: 84_000, window: 200_000, pct: 42 } })[2].endsWith('42%  84k of 200k'))
})

test('a section head is a double rule with a bold title, a dim extra and a subtle fill to the width', () => {
  const line = sectionHead('workflows', { extra: '2 running', width: 40 })
  assert.equal(text(line), '══ workflows  2 running ' + '═'.repeat(16))
  assert.equal(text(line).length, 40)
  assert.deepEqual(line.find((s) => s.text === 'workflows'), { text: 'workflows', style: 'bold' })
  assert.deepEqual(line.find((s) => s.text === '  2 running'), { text: '  2 running', style: 'dim' })
  const rules = line.filter((s) => s.text.includes(RULE))
  assert.ok(rules.length === 2 && rules.every((s) => s.color === 'subtle' && s.style === 'plain' && [...s.text].every((c) => c === RULE)))
  assert.equal(text(sectionHead('checks', { width: 20 })), '══ checks ' + '═'.repeat(10))
})

test('a section head too wide for its width drops the extra, then cuts the title, and keeps two fill glyphs', () => {
  assert.equal(text(sectionHead('workflows', { extra: '2 running', width: 20 })), '══ workflows ' + '═'.repeat(7))
  const cut = text(sectionHead('overall savings for this session so far', { extra: '15 workflows', width: 30 }))
  assert.equal(cut.length, 30)
  assert.ok(cut.startsWith('══ overall') && cut.endsWith('… ══'))
  assert.ok(!cut.includes('15 workflows'))
})

test('a subgroup head is a thin rule with a dim label', () => {
  const line = subHead('finished this session', { width: 40 })
  assert.equal(text(line), '─ finished this session ' + '─'.repeat(16))
  assert.deepEqual(line.find((s) => s.text === 'finished this session'), { text: 'finished this session', style: 'dim' })
  assert.ok(line.filter((s) => s.text.includes(SUB_RULE)).every((s) => s.color === 'subtle'))
  const cut = text(subHead('finished this session', { width: 12 }))
  assert.equal(cut.length, 12)
  assert.ok(cut.startsWith('─ ') && cut.endsWith('… ──'))
})

test('the baseline line names the model and effort, or says the model changed with each launch', () => {
  assert.equal(text(baselineLine({ family: 'sonnet', effort: 'xhigh' })), '  vs every agent on Sonnet xhigh')
  assert.equal(text(baselineLine(null)), "  vs your session's model at each launch")
})

test('the saved block opens with its section head, then the baseline line, at every width', () => {
  for (const width of [30, 44, 56, 72, 110]) {
    const block = lines(saved({ running: true, baseline: { family: 'sonnet', effort: 'xhigh' } }), { width })
    assert.equal(block[0], head('ultraguard saved so far', width))
    assert.equal(block[1], '  vs every agent on Sonnet xhigh')
  }
  assert.equal(lines(saved(), { width: 56, headWidth: 80 })[0], head('ultraguard saved', 80))
})

test('the saved body is the block without its head and its coverage lines', () => {
  const state = saved({ coverage: { used: 1, total: 2, unpriced: 0, noRatio: [] }, limits: { five_hour: range(0.4, 1.1, -0.7), seven_day: range(0.1, 0.5), readings: { five_hour: 9, seven_day: 9 } } })
  const body = savedBody(state, { width: 56, context: CONTEXT, nothing: 'these workflows may have saved nothing' }).map(text)
  const block = lines(state, { width: 56, context: CONTEXT })
  assert.deepEqual(body.slice(0, -1), block.slice(2, body.length + 1))
  assert.equal(body.at(-1), '  these workflows may have saved nothing')
  assert.equal(block[body.length + 1], '  this run may have saved nothing')
  assert.deepEqual(block.slice(body.length + 2), ['  from 1 of 2 agents', '  ratio measured on 22 replayed agents'])
})

test('the model in the baseline line takes its effort color', () => {
  const model = (over) => savedBlock(saved(over))[1].find((s) => s.text === over.baseline.family.replace(/^./, (c) => c.toUpperCase()))
  assert.deepEqual(model({ baseline: { family: 'sonnet', effort: 'xhigh' } }), { text: 'Sonnet', style: 'bold', color: '#ef790c' })
  assert.deepEqual(model({ baseline: { family: 'fable', effort: 'max' } }), { text: 'Fable', style: 'bold', color: modelColor('fable', 'max') })
})

test('the bar segments carry the ink, the track, the limit mark and the saving gradient', () => {
  const [, , five] = savedBlock(saved())
  const bar = five.filter((s) => ['━', '╸', '─', '│'].includes(s.text))
  assert.ok(bar.slice(0, 8).every((s) => s.text === '━' && s.color === 'text' && s.style === 'plain'))
  const savedCells = bar.filter(hex)
  assert.equal(savedCells.at(-1).color, savedColor(1.4))
  assert.ok(bar.filter((s) => s.text === '─').every((s) => s.color === 'subtle'))
  assert.deepEqual(bar.find((s) => s.text === '│'), { text: '│', style: 'plain', color: 'inactive' })
  const figure = five.find((s) => s.style === 'saved')
  assert.deepEqual(figure, { text: '+1.4', style: 'saved', pct: 1.4 })
  assert.ok(five.some((s) => s.style === 'dim' && s.text === ' (0.8 to 2.0)'))
})

test('the last saved cell and the figure share one color for a large saving', () => {
  const block = savedBlock(saved({ limits: { five_hour: range(30, 5), seven_day: range(0.2, 0.1), readings: { five_hour: 8, seven_day: 8 } }, used: { five_hour: 10, seven_day: 10 } }))
  const cells = block[2].filter(hex)
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
  assert.ok(block[2].includes('│'))
  assert.ok(block[2].indexOf('│') < block[2].lastIndexOf('━'))
  assert.deepEqual(block.slice(4, 6), ['  without ultraguard you would have blown past your', '  5-hour limit'])
})

test('a saving past half of a limit says so, hedged on a small margin', () => {
  const half = (used, mid) => lines(saved({ limits: { five_hour: range(mid, 4, mid - 2), seven_day: range(0.2, 0.1), readings: { five_hour: 8, seven_day: 8 } }, used: { five_hour: used, seven_day: 10 } }))
  const said = (block) => block.slice(4, -3).join(' ').replace(/\s+/g, ' ').trim()
  assert.equal(said(half(40, 15)), 'without ultraguard you would have been past half of your 5-hour limit already')
  assert.equal(said(half(46, 5)), 'without ultraguard you would likely have been past half of your 5-hour limit already')
  assert.ok(!half(40, 5).join('\n').includes('past half'))
})

test('long messages wrap inside the width', () => {
  const block = lines(saved({ limits: { five_hour: range(30, 12, 18), seven_day: range(8, 6, 2), readings: { five_hour: 8, seven_day: 8 } }, used: { five_hour: 85, seven_day: 96 } }), { width: 44 })
  assert.deepEqual(block.slice(4, 6), ['  without ultraguard you would have blown', '  past your 5-hour and weekly limits'])
})

test('the head spans the width and no other line is wider than the block, which is capped at 56 columns', () => {
  const wide = { five_hour: { mid: 30.06, lo: 3.04, hi: 91.55, pm: 61.49 }, seven_day: { mid: 12.5, lo: -1.25, hi: 40.3, pm: 27.8 }, readings: { five_hour: 8, seven_day: 8 } }
  const states = [
    saved(),
    saved({ subscription: false, limits: null }),
    saved({ tokens: { saved: -8_800_000, outputSaved: -1 }, transitions: [{ from: 'sonnet:high', to: 'opus:high', source: 'measured' }] }),
    saved({ limits: wide, used: { five_hour: 60, seven_day: 70 }, dollars: { mid: 12.04, lo: 1.2, hi: 35.21, pm: 23.17 } }),
    saved({ subscription: false, limits: null, dollars: { mid: 9.5, lo: 1.2, hi: 9.99, pm: 8.3 }, actualDollars: 4.5, baselineDollars: 14 }),
    saved({ subscription: false, limits: null, dollars: { mid: 12.04, lo: 1.2, hi: 35.21, pm: 23.17 }, actualDollars: 5.5, baselineDollars: 17.54 })
  ]
  for (const mid of [0.004, 1.5, 12.04, 123.45, 1234.56]) {
    const dollars = { mid, lo: mid / 10, hi: mid * 3, pm: mid * 2 }
    states.push(saved({ subscription: false, limits: null, dollars, actualDollars: mid / 2.2, baselineDollars: mid + mid / 2.2 }))
    states.push(saved({ subscription: null, limits: null, dollars }))
  }
  for (const mid of [0.04, 1.4, 17.8, 99.9]) {
    const limit = { mid, lo: -mid / 10, hi: mid * 3, pm: mid * 2 }
    states.push(saved({ limits: { five_hour: limit, seven_day: limit, readings: { five_hour: 8, seven_day: 8 } }, used: { five_hour: 100, seven_day: 7 } }))
  }
  for (const state of states) {
    for (const width of [44, 56, 72, 110]) {
      const [first, ...rest] = savedBlock(state, { width, context: CONTEXT })
      assert.equal(text(first).length, width)
      for (const line of rest) assert.ok(text(line).length <= Math.min(width, 56), `${width}: ${text(line)}`)
    }
  }
})

test('a cost row too wide for a 12-cell bar keeps to 56 columns, and below 48 its range moves under the bar', () => {
  const state = saved({ subscription: false, limits: null, dollars: { mid: 12.04, lo: 1.2, hi: 35.21, pm: 23.17 }, actualDollars: 5.5, baselineDollars: 17.54 })
  const at56 = lines(state)
  assert.equal(at56[2].length, 56)
  assert.ok(at56[2].endsWith('  $5.50  +$12.04 ($1.20 to $35.21)'))
  const at44 = lines(state, { width: 44 })
  assert.ok(at44[2].endsWith('  $5.50  +$12.04'))
  assert.equal(at44[3], '          ($1.20 to $35.21)')
})

test('a money line wider than the block wraps, its parts keeping their looks', () => {
  const block = savedBlock(saved({ subscription: null, limits: null, dollars: { mid: 1234.56, lo: 123.46, hi: 3703.68, pm: 2469.12 } }), { width: 44 })
  const i = block.findIndex((l) => text(l).includes('$1234.56'))
  assert.equal(text(block[i]), '  $1234.56 ($123.46 to $3703.68) at API')
  assert.equal(text(block[i + 1]), '  prices')
  assert.deepEqual(block[i].find((s) => s.text === '$1234.56'), { text: '$1234.56', style: 'bold' })
  assert.ok(block[i].some((s) => s.text === '$3703.68)' && s.style === 'dim'))
})

test('an API key shows a cost bar from the bill it avoided', () => {
  const block = savedBlock(saved({ subscription: false, limits: null, used: undefined }))
  const cost = text(block[2])
  assert.ok(cost.startsWith('  cost    '))
  assert.ok(cost.endsWith('  $1.45  +$2.32 ($1.73 to $2.91)'))
  const cells = block[2].filter(hex)
  assert.equal(cells.at(-1).color, savedColor((100 * 2.32) / 3.77))
  assert.deepEqual(block[2].find((s) => s.style === 'saved'), { text: '+$2.32', style: 'saved', pct: (100 * 2.32) / 3.77 })
  assert.equal(lines(saved({ subscription: false, limits: null })).join('\n').includes('API prices'), false)
  assert.ok(!lines(saved({ subscription: false, limits: null })).join('\n').includes('5-hour'))
})

test('an API key with no baseline cost keeps the dollars as a line', () => {
  const block = lines(saved({ subscription: false, limits: null, baselineDollars: null }))
  assert.ok(block.includes('  $2.32 ($1.73 to $2.91) off your API bill'))
  assert.ok(!block.some((l) => l.startsWith('  cost')))
})

test('no limit reading yet reads at API prices without bars', () => {
  const block = lines(saved({ subscription: null, limits: null }))
  assert.deepEqual(block.slice(2, 4), ['  $2.32 ($1.73 to $2.91) at API prices', '  2.9M fewer tokens'])
  assert.ok(!block.join('\n').includes('5-hour'))
})

test('a limit with no usage reading draws its figure without a bar', () => {
  const block = lines(saved({ used: { five_hour: null, seven_day: null } }))
  assert.equal(block[2], '  5-hour  ' + ' '.repeat(29) + '+1.4 (0.8 to 2.0)')
  assert.ok(!block[2].includes('━') && !block[2].includes('│') && !block[2].includes('%'))
  assert.equal(lines(saved({ used: undefined }))[2], block[2])
})

test('an uncalibrated limit says how many readings it has, beside its usage', () => {
  const block = lines(saved({ limits: { five_hour: null, seven_day: null, readings: { five_hour: 3, seven_day: 1 } } }))
  assert.ok(block[2].endsWith('40%  learning 3/5'))
  assert.ok(block[3].endsWith('10%  learning 1/5'))
  assert.ok(!block[2].includes('╸'))
})

test('a calibrated window shows next to an uncalibrated one', () => {
  const block = lines(saved({ limits: { five_hour: range(1.4, 0.6), seven_day: null, readings: { five_hour: 8, seven_day: 2 } } }))
  assert.ok(block[2].endsWith('+1.4 (0.8 to 2.0)'))
  assert.ok(block[3].endsWith('learning 2/5'))
})

test('a tiny saving reads below 0.1 and a negative one has no plus', () => {
  const tiny = lines(saved({ limits: { five_hour: range(0.04, 0.5), seven_day: range(-0.4, 0.5), readings: { five_hour: 8, seven_day: 8 } } }))
  assert.ok(tiny[2].endsWith('+<0.1 (-0.5 to 0.5)'))
  assert.ok(tiny[3].endsWith('-0.4 (-0.9 to 0.1)'))
  assert.ok(!tiny[3].includes('+'))
  assert.equal(savedBlock(saved({ limits: { five_hour: range(0.04, 0.5), seven_day: range(-0.4, 0.5), readings: { five_hour: 8, seven_day: 8 } } }))[3].filter(hex).length, 0)
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
  assert.deepEqual(block.slice(-2), ['  range = 9 times in 10', '  this run may have saved nothing'])
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
  assert.deepEqual(chained.slice(-3), ['  range = 9 times in 10', '  ratio measured at high effort, adjusted with published', '  figures for xhigh'])
  const prior = lines(saved({ sources: { measuredPairs: 0, chained: [], priors: [{ from: 'sonnet:high', to: 'opus:xhigh' }] } }))
  assert.equal(prior.at(-3), '  range = 9 times in 10')
  assert.equal(prior.slice(-2).join(' ').replace(/\s+/g, ' ').trim(), 'no replay measured sonnet high against opus xhigh; using published figures, so the range is wide')
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
  assert.deepEqual(block, [head('ultraguard saved'), '  vs every agent on Opus high', "  every agent ran on your session's model and effort, so", '  nothing was saved'])
})

test('no baseline means no estimate', () => {
  const block = lines(saved({ status: 'unknown', why: 'no-baseline', baseline: null, dollars: null, tokens: null, limits: null }))
  assert.deepEqual(block, [head('ultraguard saved'), "  ultraguard could not read your session's model or", '  effort, so it has no estimate'])
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
  assert.equal(block[0], head('ultraguard saved', 100))
  assert.equal(block[1], '  vs every agent on Opus high')
  assert.equal(block.slice(2).join(' ').replace(/\s+/g, ' ').trim(), 'from 0 of 2 agents: ultraguard has no price for the models 2 agents ran on')
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
    return block.slice(i, block.findIndex((l) => l.startsWith('  range =')))
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
  assert.equal(text(listCell(view())), '1.4% (0.8 to 2.0)')
  assert.deepEqual(listCell(view()), [
    { text: '1.4%', style: 'saved', pct: 1.4 },
    { text: ' (0.8 to 2.0)', style: 'dim' }
  ])
  assert.equal(text(listCell(view({ saved: saved({ running: true, limits: { five_hour: range(0.6, 0.3), seven_day: null, readings: { five_hour: 6, seven_day: 6 } } }) }))), '0.6% so far')
  assert.equal(text(listCell(view({ saved: saved({ limits: null, dollars: range(2.32, 1.1) }) }))), '$2.32 ($1.22 to $3.42)')
  assert.equal(text(listCell(view({ saved: saved({ running: true, limits: null, dollars: range(0.63, 0.2) }) }))), '$0.63 so far')
  const limits = (five_hour) => ({ five_hour, seven_day: null, readings: { five_hour: 8, seven_day: 8 } })
  assert.equal(text(listCell(view({ saved: saved({ limits: limits({ mid: 4.1, lo: 1.8, hi: 6.4, pm: 2.3 }) }) }))), '4.1% (1.8 to 6.4)')
  assert.equal(text(listCell(view({ saved: saved({ running: true, limits: limits({ mid: 4.1, lo: 1.8, hi: 6.4, pm: 2.3 }) }) }))), '4.1% so far')
})

test('list cells show a dash when nothing is known', () => {
  assert.equal(text(listCell(view({ saved: null }))), '—')
  assert.equal(text(listCell(view({ saved: saved({ status: 'unknown', dollars: null, limits: null }) }))), '—')
})

test('a run whose agents all ran on the session model and effort reads a dim same model', () => {
  assert.equal(SAME_MODEL, 'same model')
  assert.deepEqual(listCell(view({ saved: saved({ status: 'none', limits: null }) })), [{ text: SAME_MODEL, style: 'dim' }])
  assert.deepEqual(listCell(view({ saved: saved({ status: 'none', running: true }) })), [{ text: SAME_MODEL, style: 'dim' }])
})

test('the list strings: section titles, more lines, hints, all without middle dots', () => {
  assert.equal(WORKFLOWS_HEAD, 'workflows')
  assert.equal(RUNNING_EXTRA(2), '2 running')
  assert.equal(RUNNING_EXTRA(0), 'none running')
  assert.equal(NO_RUNNING, 'No workflow is running.')
  assert.equal(FINISHED_TITLE, 'finished this session')
  assert.equal(STOPPED_TITLE, 'stopped this session')
  assert.equal(MORE_ABOVE(3), '  ↑ 3 more')
  assert.equal(MORE_BELOW(5), '  ↓ 5 more')
  assert.equal(LIST_HINT, '↑↓ choose  enter details  esc close')
  assert.equal(FOLD_HINT(false), '↑↓ choose  enter opens the stopped ones  esc close')
  assert.equal(FOLD_HINT(true), '↑↓ choose  enter folds the stopped ones  esc close')
  assert.equal(FOCUS_HINT, 'ctrl+x tab: focus this pane')
  assert.deepEqual([PHASES_HEAD, AGENTS_HEAD, CHECKS_HEAD], ['phases', 'agents', 'checks'])
  const all = [SAME_MODEL, WORKFLOWS_HEAD, RUNNING_EXTRA(1), NO_RUNNING, FINISHED_TITLE, STOPPED_TITLE, MORE_ABOVE(1), MORE_BELOW(1), LIST_HINT, FOLD_HINT(true), FOLD_HINT(false), FOCUS_HINT]
  assert.ok(all.every((s) => !s.includes('·')))
})

test('the stopped fold row reads its state, its title and how many workflows it holds', () => {
  assert.equal(text(foldLine({ open: false, count: 2, picked: false })), '▸ stopped this session  2 workflows')
  assert.equal(text(foldLine({ open: true, count: 1, picked: false })), '▾ stopped this session  1 workflow')
  const line = foldLine({ open: false, count: 2, picked: true })
  assert.deepEqual(line[0], { text: '▸', style: 'dim' })
  assert.deepEqual(line.find((s) => s.text === STOPPED_TITLE), { text: STOPPED_TITLE, style: 'bold' })
  assert.deepEqual(foldLine({ open: false, count: 2, picked: false }).find((s) => s.text === STOPPED_TITLE), { text: STOPPED_TITLE, style: 'plain' })
  assert.deepEqual(line.at(-1), { text: '  2 workflows', style: 'dim' })
})

test('an ended row says when it finished or when it was stopped', () => {
  assert.equal(endedText(view()), 'done 14:51')
  assert.equal(endedText(view({ endedClock: null })), 'done')
  assert.equal(endedText(view({ status: 'killed', endedClock: '15:02', stoppedClock: '15:02' })), 'stopped 15:02')
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

const data = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'))
const RATIOS = data('ratios')
const PRICES = loadPrices(data('prices'))
const NOW = 3000
const SONNET_XHIGH = { family: 'sonnet', effort: 'xhigh' }
const OPUS_HIGH = { family: 'opus', effort: 'high' }
const SUBSCRIBED = { ...createMeter(), subscription: true, last: { five_hour: { pct: 13, resetsAt: 'B' }, seven_day: { pct: 50, resetsAt: 'W' } } }
const API_KEY = { ...createMeter(), subscription: false }
const INTERVALS = Array.from({ length: 8 }, (_, i) => ({ d: 1, u: 0.5, c: 0.4, at: i }))
const tallyRun = (key, over = {}) => ({
  key,
  status: 'completed',
  baseline: SONNET_XHIGH,
  agents: [0, 1].map((i) => ({ agentId: `${key}-a${i}`, pieces: [{ family: 'haiku', effort: 'high', input: 2000, output: 40000, cacheRead: 300000, cacheWrite: 30000 }] })),
  windows: { five_hour: 'B', seven_day: 'W' },
  at: 1000,
  ...over
})

function overallOf(runs, meter = SUBSCRIBED) {
  const tally = runs.reduce((t, r) => noteTallyRun(t, r), createTally())
  const current = { five_hour: meter.last?.five_hour?.resetsAt ?? null, seven_day: meter.last?.seven_day?.resetsAt ?? null }
  const one = (baseline, agents) =>
    estimateRun({ agents, baseline, ratios: RATIOS, prices: PRICES, meter: { subscription: meter.subscription, five_hour: INTERVALS, seven_day: INTERVALS }, seed: seedOf('overall') })
  const estimates = overallInput(tally, current, NOW).groups.map((g) => ({ all: one(g.baseline, g.all), five_hour: one(g.baseline, g.five_hour), seven_day: one(g.baseline, g.seven_day) }))
  return combine(estimates, { tally, meter, now: NOW })
}

const fifteen = (over = () => ({})) => Array.from({ length: 15 }, (_, i) => tallyRun(`r${i}`, { at: 1000 + i, windows: { five_hour: i < 8 ? 'A' : 'B', seven_day: 'W' }, ...over(i) }))
const overallLines = (overall, opts) => overallBlock(overall, opts).map(text)
const SCOPE_FIVE = (n) => `  5-hour counts the ${n} workflows of this window`
const SCOPE_WEEK = (n) => `  weekly counts the ${n} workflows of this window`

test('the overall block opens with its section head at the pane width, so far while a run is going', () => {
  const going = overallBlock(overallOf(fifteen((i) => (i === 14 ? { status: 'running' } : {}))), { width: 80, context: CONTEXT })
  assert.ok(text(going[0]).startsWith('══ overall savings for this session so far'))
  assert.ok(text(going[0]).includes('  15 workflows'))
  assert.equal(text(going[0]).length, 80)
  assert.deepEqual(going[0].find((s) => s.style === 'bold'), { text: 'overall savings for this session so far', style: 'bold' })
  const ended = overallLines(overallOf(fifteen()), { width: 80, context: CONTEXT })
  assert.equal(ended[0], '══ overall savings for this session  15 workflows ' + '═'.repeat(30))
})

test('the overall block names the baseline, or the session model at each launch when the baselines differ', () => {
  assert.equal(overallLines(overallOf(fifteen()), { width: 80 })[1], '  vs every agent on Sonnet xhigh')
  const mixed = overallOf(fifteen((i) => (i % 2 ? { baseline: OPUS_HIGH } : {})))
  assert.equal(mixed.baseline, null)
  assert.equal(overallLines(mixed, { width: 80 })[1], "  vs your session's model at each launch")
})

test('the overall rows are the rows a run block draws for the same figures', () => {
  const overall = overallOf(fifteen())
  const rowsOf = (block) => block.filter((l) => text(l).includes('│'))
  const mine = rowsOf(overallBlock(overall, { width: 80, context: CONTEXT }))
  assert.deepEqual(mine.map((l) => text(l).slice(2, 9)), ['context', '5-hour ', 'weekly '])
  assert.ok(mine.every((l) => text(l).includes('│')))
  assert.deepEqual(mine, rowsOf(savedBlock(overall, { width: 80, context: CONTEXT })))
})

test('a scope line says how many workflows a limit counts when it is fewer than all', () => {
  const block = overallLines(overallOf(fifteen()), { width: 80, context: CONTEXT })
  assert.equal(block.at(-1), SCOPE_FIVE(7))
  assert.ok(!block.some((l) => l.startsWith('  weekly counts')))
  assert.ok(overallBlock(overallOf(fifteen()), { width: 80 }).at(-1).every((s) => s.style === 'dim'))
  const weeks = overallLines(overallOf(fifteen((i) => ({ windows: { five_hour: 'B', seven_day: i < 3 ? 'V' : 'W' } }))), { width: 80 })
  assert.deepEqual(weeks.slice(-1), [SCOPE_WEEK(12)])
  assert.ok(!weeks.some((l) => l.startsWith('  5-hour counts')))
  const all = overallLines(overallOf(fifteen(() => ({ windows: { five_hour: 'B', seven_day: 'W' } }))), { width: 80 })
  assert.ok(!all.some((l) => l.includes('counts the')))
})

test('on an API key the overall block has a cost row, no money line and no scope line', () => {
  const block = overallLines(overallOf(fifteen(), API_KEY), { width: 80, context: CONTEXT })
  assert.ok(block.some((l) => l.startsWith('  cost    ')))
  assert.ok(!block.some((l) => l.includes('API bill') || l.includes('API prices')))
  assert.ok(!block.some((l) => l.includes('counts the')))
})

test('a range below zero says these workflows may have saved nothing', () => {
  const overall = overallOf(fifteen())
  const block = overallLines({ ...overall, limits: { ...overall.limits, five_hour: { mid: 0.4, lo: -0.7, hi: 1.5, pm: 1.1 } } }, { width: 80 })
  assert.deepEqual(block.slice(-3), ['  range = 9 times in 10', '  these workflows may have saved nothing', SCOPE_FIVE(7)])
})

const onlyOn = (family, effort) => (i) => ({ status: i === 0 ? 'running' : 'completed', agents: [{ agentId: `s${i}`, pieces: [{ family, effort, input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }] }] })

test('the overall block is empty with no workflow and says no estimate yet without one', () => {
  assert.deepEqual(overallBlock(combine([], { tally: createTally(), meter: SUBSCRIBED, now: NOW }), { width: 80 }), [])
  const unknown = overallOf(fifteen(onlyOn('gpt', 'high')))
  assert.equal(unknown.status, 'unknown')
  const block = overallBlock(unknown, { width: 80, context: CONTEXT })
  assert.equal(block.length, 2)
  assert.ok(text(block[0]).startsWith('══ overall savings for this session so far  15 workflows '))
  assert.deepEqual(block[1], [{ text: '  no estimate yet', style: 'dim' }])
})

test('with every agent on its baseline the overall block says nothing was saved, as a run block does', () => {
  const none = overallOf(fifteen(onlyOn('sonnet', 'xhigh')))
  assert.equal(none.status, 'none')
  const block = overallLines(none, { width: 80, context: CONTEXT })
  assert.ok(block[0].startsWith('══ overall savings for this session so far  15 workflows '))
  const run = lines({ ...saved(), status: 'none', baseline: SONNET_XHIGH }, { width: 80 })
  assert.deepEqual(block.slice(1), run.slice(1))
  assert.deepEqual(block.slice(1), ['  vs every agent on Sonnet xhigh', "  every agent ran on your session's model and effort, so", '  nothing was saved'])
  const mixed = overallOf(fifteen((i) => ({ ...onlyOn(i % 2 ? 'opus' : 'sonnet', i % 2 ? 'high' : 'xhigh')(i), ...(i % 2 ? { baseline: OPUS_HIGH } : {}) })))
  assert.equal(mixed.status, 'none')
  assert.deepEqual(overallLines(mixed, { width: 56 }).slice(1), ["  vs your session's model at each launch", "  every agent ran on your session's model and effort, so", '  nothing was saved'])
})

test('every overall line fits the width, capped at 56, past its head', () => {
  for (const overall of [overallOf(fifteen()), overallOf(fifteen(), API_KEY), overallOf(fifteen((i) => (i % 2 ? { baseline: OPUS_HIGH } : {})))]) {
    for (const width of [44, 56, 72, 110]) {
      const [first, ...rest] = overallBlock(overall, { width, context: CONTEXT })
      assert.equal(text(first).length, width)
      for (const line of rest) assert.ok(text(line).length <= Math.min(width, 56), `${width}: ${text(line)}`)
    }
  }
})

test('a dollar figure just under zero prints as $0.00, never -$0.00', () => {
  assert.equal(fmtUsd(-0.001), '$0.00')
  assert.equal(fmtUsd(-0.005), '-$0.01')
  assert.equal(fmtUsd(-1.234), '-$1.23')
})
