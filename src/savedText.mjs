import { modelColor, savedColor } from './palette.mjs'
import { MAX_WIDTH, layoutOf, rowLines } from './bars.mjs'
import { limitMessages, wrapText } from './limitText.mjs'
import { STOPPED } from './eval.mjs'
import { familyOfRow } from './prices.mjs'

const FAMILY_STYLES = new Set(['opus', 'sonnet', 'haiku', 'fable'])
const DASH = '—'
const STOPPED_TOAST = (title) => `ultraguard: ${title} stopped`

const seg = (text, style = 'plain') => ({ text, style })
const dim = (text) => seg(text, 'dim')
const bold = (text) => seg(text, 'bold')
const savedSeg = (text, pct) => ({ text, style: 'saved', pct })
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const familySeg = (family) => seg(capitalize(family), FAMILY_STYLES.has(family) ? family : 'plain')
const textOf = (line) => line.reduce((n, s) => n + s.text.length, 0)
const configText = (config) => config.replace(':', ' ')

export const fmtPct = (x) => (Math.abs(x) < 0.1 ? '< 0.1%' : `${x.toFixed(1)}%`)

export const fmtUsd = (x) => `${x <= -0.005 ? '-' : ''}$${Math.abs(x).toFixed(2)}`

export const rangeText = (range, kind) => {
  const f = kind === 'usd' ? fmtUsd : tenths
  return ` (${f(range.lo)} to ${f(range.hi)})`
}

export function fmtTokens(n) {
  const abs = Math.abs(n)
  if (abs >= 1e6 || Math.round(abs / 1000) >= 1000) return `${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1000) return `${Math.round(abs / 1000)}k`
  return String(Math.round(abs))
}

const fiveHourOf = (saved) => (saved?.subscription === true && saved.limits?.five_hour) || null

const finite = (x) => typeof x === 'number' && Number.isFinite(x)
const clampPct = (x) => Math.min(100, Math.max(0, x))
const fmtWindow = (n) => (n % 1e6 === 0 ? `${n / 1e6}M` : fmtTokens(n))
const signed = (x, fixed) => (Math.abs(x) < 0.05 ? 0 : x).toFixed(fixed)
const tenths = (x) => (Math.round(x * 10) / 10).toFixed(1)
const RANGE_NOTE = 'range = 9 times in 10'
const RANGE_WIDE = 'so the range is wide'
const MIXED_BASELINE = "vs your session's model at each launch"
const RUN_NOTHING = 'this run may have saved nothing'
const ALL_ON_BASELINE = "every agent ran on your session's model and effort, so nothing was saved"
const OVERALL_TITLE = 'overall savings for this session'
const workflows = (n) => `${n} workflow${n === 1 ? '' : 's'}`
const OVERALL_COUNT = workflows
const OVERALL_NOTHING = 'these workflows may have saved nothing'
const OVERALL_SCOPE = (label, n) => `${label} counts the ${workflows(n)} of this window`
const NO_ESTIMATE = 'no estimate yet'
const CANT_TELL = "can't tell"

export const PHASES_HEAD = 'phases'
export const AGENTS_HEAD = 'agents'
export const CHECKS_HEAD = 'checks'
export const WORKFLOWS_HEAD = 'workflows'
export const RUNNING_EXTRA = (n) => (n > 0 ? `${n} running` : 'none running')
export const NO_RUNNING = 'No workflow is running.'
export const FINISHED_TITLE = 'finished this session'
export const STOPPED_TITLE = 'stopped this session'
export const MORE_ABOVE = (n) => `  ↑ ${n} more`
export const MORE_BELOW = (n) => `  ↓ ${n} more`
export const LIST_HINT = '↑↓ choose  enter details  esc close'
export const FOLD_HINT = (open) => `↑↓ choose  enter ${open ? 'folds' : 'opens'} the stopped ones  esc close`
export const FOCUS_HINT = 'ctrl+x tab: focus this pane'
export const SAME_MODEL = 'same model'

export const RULE = '═'
export const SUB_RULE = '─'
const rule = (text) => ({ text, style: 'plain', color: 'subtle' })
const cut = (s, n) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s)
const LIMIT_KEYS = [
  ['five_hour', '5-hour'],
  ['seven_day', 'weekly']
]

function wrapLine(line, width) {
  const words = [[]]
  for (const part of line) {
    for (const piece of part.text.split(/(?<= )/)) {
      if (piece === '') continue
      words[words.length - 1].push({ ...part, text: piece })
      if (piece.endsWith(' ')) words.push([])
    }
  }
  const trim = (l) => l.map((p, i) => (i === l.length - 1 ? { ...p, text: p.text.trimEnd() } : p))
  const lines = [[seg('  ')]]
  let used = 2
  for (const word of words) {
    if (word.length === 0) continue
    const full = textOf(word)
    const bare = word[word.length - 1].text.endsWith(' ') ? full - 1 : full
    if (used > 2 && used + bare > width) {
      lines[lines.length - 1] = trim(lines[lines.length - 1])
      lines.push([seg('  ')])
      used = 2
    }
    lines[lines.length - 1].push(...word)
    used += full
  }
  lines[lines.length - 1] = trim(lines[lines.length - 1])
  return lines
}

const proseLines = (text, width, style = 'plain') => wrapText(text, Math.max(width - 2, 10)).map((l) => [seg(`  ${l}`, style)])

function modelSeg(baseline) {
  const family = familyOfRow(baseline.family)
  const color = modelColor(family, baseline.effort)
  return color ? { text: capitalize(family), style: 'bold', color } : familySeg(family)
}

export function sectionHead(title, { extra = '', width }) {
  const room = Math.max(1, width - 6)
  const tail = extra && title.length + 2 + extra.length <= room ? `  ${extra}` : ''
  const name = cut(title, room)
  const fill = Math.max(2, width - 4 - name.length - tail.length)
  return [rule(RULE.repeat(2)), seg(' '), bold(name), ...(tail ? [dim(tail)] : []), seg(' '), rule(RULE.repeat(fill))]
}

export function subHead(label, { width }) {
  const name = cut(label, Math.max(1, width - 5))
  return [rule(SUB_RULE), seg(' '), dim(name), seg(' '), rule(SUB_RULE.repeat(Math.max(2, width - 3 - name.length)))]
}

export function baselineLine(baseline) {
  if (!baseline) return [dim(`  ${MIXED_BASELINE}`)]
  return [dim('  vs every agent on '), modelSeg(baseline), dim(` ${baseline.effort}`)]
}

function contextRow(context) {
  if (!context || !(context.window > 0)) return null
  const known = finite(context.pct)
  const of = fmtWindow(context.window)
  return {
    label: 'context',
    used: known ? clampPct(context.pct) : 0,
    usedText: known ? `${Math.round(context.pct)}%` : DASH,
    saved: 0,
    fig: [dim(`${finite(context.tokens) ? fmtTokens(context.tokens) : DASH} of ${of}`)],
    range: null
  }
}

function limitRows(saved) {
  if (saved.subscription !== true || !saved.limits) return []
  return LIMIT_KEYS.map(([key, label]) => {
    const used = finite(saved.used?.[key]) ? clampPct(saved.used[key]) : null
    const usedText = used === null ? '' : `${Math.round(used)}%`
    const range = saved.limits[key]
    if (!range) {
      const text = saved.limits.implausible?.includes(key) ? CANT_TELL : `learning ${saved.limits.readings?.[key] ?? 0}/5`
      return { label, used, usedText, saved: 0, fig: [dim(text)], range: null }
    }
    const gain = range.mid > 0 ? range.mid : 0
    const amount = gain > 0 ? savedSeg(`+${range.mid < 0.1 ? '<0.1' : tenths(range.mid)}`, range.mid) : seg(signed(range.mid, 1))
    return { label, used, usedText, saved: gain, fig: [amount, dim(rangeText(range, 'points'))], range }
  })
}

function costRow(saved) {
  const { dollars, baselineDollars: base, actualDollars } = saved
  if (saved.subscription !== false || !dollars || !(base > 0)) return null
  const gain = dollars.mid > 0 ? Math.min(100, (100 * dollars.mid) / base) : 0
  const spent = finite(actualDollars) ? actualDollars : base - dollars.mid
  const amount = gain > 0 ? savedSeg(`+${fmtUsd(dollars.mid)}`, gain) : seg(fmtUsd(dollars.mid))
  return {
    label: 'cost',
    used: Math.max(0, Math.min((100 * spent) / base, 100 - gain)),
    usedText: fmtUsd(spent),
    saved: gain,
    fig: [amount, dim(rangeText(dollars, 'usd'))],
    range: dollars
  }
}

function moneyLines(saved, width) {
  const { dollars } = saved
  if (!dollars) return []
  const parts = [bold(fmtUsd(dollars.mid)), dim(rangeText(dollars, 'usd')), seg(saved.subscription === false ? ' off your API bill' : ' at API prices')]
  return 2 + textOf(parts) <= width ? [[seg('  '), ...parts]] : wrapLine(parts, width)
}

function tokenLines(saved, width) {
  if (!saved.tokens) return []
  const n = fmtTokens(saved.tokens.saved)
  if (saved.tokens.saved >= 0) return [[seg('  '), bold(n), seg(' fewer tokens')]]
  const families = [...new Set(saved.transitions.filter((t) => t.source !== 'identical').map((t) => t.from.split(':')[0]))]
  const joiner = (i) => (i === families.length - 1 ? ' and ' : ', ')
  const who = families.length ? families.flatMap((f, i) => (i ? [seg(joiner(i)), familySeg(f)] : [familySeg(f)])) : [seg('the agents')]
  return wrapLine([bold(n), seg(' more tokens: '), ...who, seg(' read and wrote more, at a lower price per token')], width)
}

function coverageText({ coverage }) {
  const reasons = []
  if (coverage.unpriced > 0) {
    reasons.push(
      coverage.unpriced === 1
        ? 'ultraguard has no price for the model one agent ran on'
        : `ultraguard has no price for the models ${coverage.unpriced} agents ran on`
    )
  }
  for (const key of coverage.noRatio) {
    const [from, to] = key.split('>')
    reasons.push(`ultraguard has no ratio for ${configText(from)} against ${configText(to)}`)
  }
  return { base: `from ${coverage.used} of ${coverage.total} agents`, reasons }
}

function sourceLines({ sources }) {
  const adjusted = sources.chained.map((c) => `ratio measured at ${c.via} effort, adjusted with published figures for ${c.to.split(':')[1]}`)
  const priors = sources.priors.map((p) => `no replay measured ${configText(p.from)} against ${configText(p.to)}; using published figures, ${RANGE_WIDE}`)
  return {
    measured: sources.measuredPairs > 0 ? `ratio measured on ${sources.measuredPairs} replayed agents` : null,
    others: [...new Set([...adjusted, ...priors])]
  }
}

function coverageLines(saved) {
  const { base, reasons } = coverageText(saved)
  const { measured, others } = sourceLines(saved)
  if (reasons.length === 0 && saved.coverage.used >= saved.coverage.total && others.length === 0) return []
  const complete = reasons.length === 0 && saved.coverage.used >= saved.coverage.total
  if (complete) return others
  return [reasons.length ? `${base}: ${reasons.join('; ')}` : base, ...(measured ? [measured] : []), ...others]
}

export function savedBody(saved, { width = MAX_WIDTH, context = null, nothing } = {}) {
  const limits = limitRows(saved)
  const cost = costRow(saved)
  const rows = [contextRow(context), ...limits, cost].filter(Boolean)
  const out = []
  if (rows.length > 0) {
    const layout = layoutOf(rows, width)
    out.push(...rows.flatMap((r) => rowLines(r, layout)))
  }
  for (const message of limitMessages(limits)) out.push(...proseLines(message, width))

  if (!cost) out.push(...moneyLines(saved, width))
  out.push(...tokenLines(saved, width))

  const firstRange = rows.find((r) => r.range)?.range ?? saved.dollars
  if (firstRange) {
    out.push(...proseLines(RANGE_NOTE, width, 'dim'))
    if (firstRange.lo < 0 && nothing) out.push(...proseLines(nothing, width, 'dim'))
  }
  return out
}

export function savedBlock(saved, { width = MAX_WIDTH, headWidth = width, context = null } = {}) {
  const room = Math.min(width, MAX_WIDTH)
  const head = [sectionHead(saved.running ? 'ultraguard saved so far' : 'ultraguard saved', { width: headWidth })]
  if (saved.baseline) head.push(baselineLine(saved.baseline))
  if (saved.status === 'none') return [...head, ...proseLines(ALL_ON_BASELINE, room)]
  if (!saved.baseline) return [...head, ...proseLines("ultraguard could not read your session's model or effort, so it has no estimate", room)]

  if (saved.status !== 'estimated') {
    const { base, reasons } = coverageText(saved)
    return [...head, ...proseLines(`${base}${reasons.length ? `: ${reasons.join('; ')}` : ''}`, room, 'dim')]
  }

  const out = [...head, ...savedBody(saved, { width: room, context, nothing: RUN_NOTHING })]
  for (const line of coverageLines(saved)) out.push(...proseLines(line, room, 'dim'))
  return out
}

export function overallBlock(overall, { width = MAX_WIDTH, context = null } = {}) {
  if (!(overall?.count > 0)) return []
  const room = Math.min(width, MAX_WIDTH)
  const head = sectionHead(overall.running ? `${OVERALL_TITLE} so far` : OVERALL_TITLE, { extra: OVERALL_COUNT(overall.count), width })
  if (overall.status === 'none') return [head, baselineLine(overall.baseline), ...proseLines(ALL_ON_BASELINE, room)]
  if (overall.status !== 'estimated') return [head, ...proseLines(NO_ESTIMATE, room, 'dim')]
  const out = [head, baselineLine(overall.baseline), ...savedBody(overall, { width: room, context, nothing: OVERALL_NOTHING })]
  if (overall.subscription === true && overall.limits) {
    for (const [key, label] of LIMIT_KEYS) {
      const n = overall.counted?.[key]
      if (finite(n) && n < overall.count) out.push(...proseLines(OVERALL_SCOPE(label, n), room, 'dim'))
    }
  }
  return out
}

export function agentColumn(saved) {
  const limit = fiveHourOf(saved)
  const field = limit ? 'five_hour' : 'dollars'
  const byId = new Map((saved?.agents ?? []).map((a) => [a.agentId, a]))
  const byKey = new Map((saved?.groups ?? []).map((g) => [g.key, g]))
  const show = (value) => (value === null || value === undefined ? DASH : limit ? fmtPct(value) : fmtUsd(value))
  const tint = (value) => (limit && typeof value === 'number' ? savedColor(value) : undefined)
  const missingOf = (phase) => phase.agents.some((a) => a.done && (byId.get(a.agentId)?.[field] ?? null) === null)
  return {
    header: limit ? '5h saves' : 'API saves',
    cell: (agentId) => show(byId.get(agentId)?.[field]),
    color: (agentId) => tint(byId.get(agentId)?.[field]),
    group(phase) {
      return missingOf(phase) ? DASH : show(byKey.get(phase.key)?.[field])
    },
    groupColor(phase) {
      return missingOf(phase) ? undefined : tint(byKey.get(phase.key)?.[field])
    }
  }
}

const FAMILIES = ['opus', 'sonnet', 'haiku']
const SAVED_GAP = 3
const MODELS_MIN = 12

export function phaseStatus(phase) {
  const n = phase.total
  return phase.state === 'running' ? `running  ${phase.done} of ${n} done` : `${n} agent${n === 1 ? '' : 's'}`
}

export function phaseHeadLength(phase) {
  return 4 + phase.title.length + 2 + phaseStatus(phase).length + (phase.red > 0 ? `  ${phase.red} red`.length : 0)
}

export function phaseTitle(phase, savedAt) {
  const room = savedAt - 2 - 4 - phaseStatus(phase).length - 2 - (phase.red > 0 ? `  ${phase.red} red`.length : 0)
  return phase.title.length > room ? `${phase.title.slice(0, Math.max(1, room - 1))}…` : phase.title
}

export function phaseLayout({ labels, heads, cells, header, width }) {
  const savedWidth = header ? Math.max(header.length, ...cells.map((c) => c.length)) + SAVED_GAP : 0
  const wanted = Math.min(34, Math.max(12, ...labels.map((l) => l.length + 4), ...heads.map((h) => h - 4)))
  const field = Math.max(12, Math.min(wanted, width - 6 - savedWidth - MODELS_MIN))
  const savedAt = 6 + field
  return { field, savedAt, savedWidth, modelsAt: savedAt + savedWidth }
}

export function modelLines(counts, width) {
  const names = FAMILIES.filter((m) => counts[m] > 0)
  if (names.length === 0) return [[dim('no agents yet')]]
  const lines = [[]]
  let used = 0
  for (const m of names) {
    const w = `${m} ${counts[m]}`.length
    if (used > 0 && used + 2 + w > width) {
      lines.push([])
      used = 0
    }
    const line = lines[lines.length - 1]
    if (line.length > 0) line.push(seg('  '))
    line.push(seg(m, m), dim(` ${counts[m]}`))
    used += (used > 0 ? 2 : 0) + w
  }
  return lines
}

export function listHeader(views) {
  const limit = views.some((v) => fiveHourOf(v.saved))
  return [dim(limit ? '5h saves' : 'API saves')]
}

export function foldLine({ open, count, picked }) {
  return [dim(open ? '▾' : '▸'), seg(' '), picked ? bold(STOPPED_TITLE) : seg(STOPPED_TITLE), dim(`  ${workflows(count)}`)]
}

export function endedText(view) {
  return view.status === STOPPED ? `stopped ${view.stoppedClock ?? ''}`.trim() : `done ${view.endedClock ?? ''}`.trim()
}

export function listCell(view) {
  if (!view.ok) return []
  const saved = view.saved
  if (saved?.status === 'none') return [dim(SAME_MODEL)]
  if (saved?.status !== 'estimated') return [dim(DASH)]
  const limit = fiveHourOf(saved)
  const range = limit || saved.dollars
  if (!range) return [dim(DASH)]
  const amount = limit ? fmtPct(range.mid) : fmtUsd(range.mid)
  const figureSeg = limit ? savedSeg(amount, range.mid) : bold(amount)
  if (saved.running) return [figureSeg, dim(' so far')]
  return [figureSeg, dim(rangeText(range, limit ? 'points' : 'usd'))]
}

export function toastText(view) {
  const stopped = view.status === STOPPED
  const head = stopped ? STOPPED_TOAST(view.title) : `ultraguard: ${view.title} finished`
  if (!view.ok) return `${head}, but ${view.reason}`
  const approved = stopped ? head : `${head} as approved`
  const saved = view.saved
  if (saved?.status === 'none') return stopped ? head : `${approved}; every agent ran on your session's model and effort`
  if (saved?.status !== 'estimated') return approved
  const limit = fiveHourOf(saved)
  if (limit) return `${approved} and saved about ${fmtPct(limit.mid)} of your 5-hour limit`
  if (!saved.dollars) return approved
  const where = saved.subscription === false ? 'off your API bill' : 'at API prices'
  return `${approved} and saved about ${fmtUsd(saved.dollars.mid)} ${where}`
}
