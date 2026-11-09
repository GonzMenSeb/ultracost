import { modelColor, savedColor } from './palette.mjs'
import { MAX_WIDTH, layoutOf, rowLine } from './bars.mjs'
import { limitMessages, wrapText } from './limitText.mjs'
import { STOPPED } from './eval.mjs'

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

export const fmtUsd = (x) => `${x < 0 ? '-' : ''}$${Math.abs(x).toFixed(2)}`

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
  const color = modelColor(baseline.family, baseline.effort)
  return color ? { text: capitalize(baseline.family), style: 'bold', color } : familySeg(baseline.family)
}

function headLines(saved, width) {
  const head = bold(saved.running ? 'ultraguard saved so far' : 'ultraguard saved')
  if (!saved.baseline) return [[head]]
  const vs = [dim('vs every agent on '), modelSeg(saved.baseline), dim(` ${saved.baseline.effort}`)]
  const oneLine = [head, dim('  '), ...vs]
  return textOf(oneLine) <= width ? [oneLine] : [[head], vs]
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
    if (!range) return { label, used, usedText, saved: 0, fig: [dim(`learning ${saved.limits.readings?.[key] ?? 0}/5`)], range: null }
    const gain = range.mid > 0 ? range.mid : 0
    const amount = gain > 0 ? savedSeg(`+${range.mid < 0.1 ? '<0.1' : range.mid.toFixed(1)}`, range.mid) : seg(signed(range.mid, 1))
    return { label, used, usedText, saved: gain, fig: [amount, dim(` ±${range.pm.toFixed(1)}`)], range }
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
    fig: [amount, dim(` ±${fmtUsd(dollars.pm)}`)],
    range: dollars
  }
}

function moneyLine(saved) {
  const { dollars } = saved
  if (!dollars) return null
  return [seg('  '), bold(fmtUsd(dollars.mid)), dim(` ±${fmtUsd(dollars.pm)}`), seg(saved.subscription === false ? ' off your API bill' : ' at API prices')]
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
  const priors = sources.priors.map((p) => `no replay measured ${configText(p.from)} against ${configText(p.to)}; using published figures, so ± is wide`)
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

export function savedBlock(saved, { width = MAX_WIDTH, context = null } = {}) {
  const room = Math.min(width, MAX_WIDTH)
  const head = headLines(saved, room)
  if (saved.status === 'none') return [...head, ...proseLines("every agent ran on your session's model and effort, so nothing was saved", room)]
  if (!saved.baseline) return [...head, ...proseLines("ultraguard could not read your session's model or effort, so it has no estimate", room)]

  if (saved.status !== 'estimated') {
    const { base, reasons } = coverageText(saved)
    return [...head, ...proseLines(`${base}${reasons.length ? `: ${reasons.join('; ')}` : ''}`, room, 'dim')]
  }

  const limits = limitRows(saved)
  const cost = costRow(saved)
  const rows = [contextRow(context), ...limits, cost].filter(Boolean)
  const out = [...head]
  if (rows.length > 0) {
    const layout = layoutOf(rows, room)
    out.push(...rows.map((r) => rowLine(r, layout)))
  }
  for (const message of limitMessages(limits)) out.push(...proseLines(message, room))

  if (!cost) {
    const money = moneyLine(saved)
    if (money) out.push(money)
  }
  out.push(...tokenLines(saved, room))

  const firstRange = rows.find((r) => r.range)?.range ?? saved.dollars
  if (firstRange) {
    out.push(...proseLines('± = how far off, 9 times in 10', room, 'dim'))
    if (firstRange.lo < 0) out.push(...proseLines('this run may have saved nothing', room, 'dim'))
  }
  for (const line of coverageLines(saved)) out.push(...proseLines(line, room, 'dim'))
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

export function listCell(view) {
  if (!view.ok) return []
  const saved = view.saved
  if (saved?.status !== 'estimated') return [dim(DASH)]
  const limit = fiveHourOf(saved)
  const range = limit || saved.dollars
  if (!range) return [dim(DASH)]
  const amount = limit ? fmtPct(range.mid) : fmtUsd(range.mid)
  const figureSeg = limit ? savedSeg(amount, range.mid) : bold(amount)
  if (saved.running) return [figureSeg, dim(' so far')]
  return [figureSeg, dim(` ± ${limit ? range.pm.toFixed(1) : fmtUsd(range.pm)}`)]
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
