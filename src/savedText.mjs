import { savedColor } from './palette.mjs'

const FAMILY_STYLES = new Set(['opus', 'sonnet', 'haiku', 'fable'])
const AMOUNT_COLUMN = 36
const DASH = '—'

const seg = (text, style = 'plain') => ({ text, style })
const dim = (text) => seg(text, 'dim')
const bold = (text) => seg(text, 'bold')
const savedSeg = (text, pct) => ({ text, style: 'saved', pct })
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const familySeg = (family) => seg(capitalize(family), FAMILY_STYLES.has(family) ? family : 'plain')
const textOf = (line) => line.reduce((n, s) => n + s.text.length, 0)
const configText = (config) => config.replace(':', ' · ')

export const fmtPct = (x) => (Math.abs(x) < 0.1 ? '< 0.1%' : `${x.toFixed(1)}%`)

export const fmtUsd = (x) => `${x < 0 ? '-' : ''}$${Math.abs(x).toFixed(2)}`

export function fmtTokens(n) {
  const abs = Math.abs(n)
  if (abs >= 1e6 || Math.round(abs / 1000) >= 1000) return `${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1000) return `${Math.round(abs / 1000)}k`
  return String(Math.round(abs))
}

const fiveHourOf = (saved) => (saved?.subscription === true && saved.limits?.five_hour) || null

function figure(amount, label, range, pm, tail, pct) {
  const left = [seg('  '), pct === undefined ? bold(amount) : savedSeg(amount, pct), seg(label)]
  const pad = Math.max(AMOUNT_COLUMN - textOf(left), 2)
  return { range, line: [...left, seg(' '.repeat(pad)), dim(`± ${pm}`), ...tail] }
}

function limitRows(saved) {
  if (saved.subscription !== true || !saved.limits) return []
  const { limits } = saved
  return [
    ['five_hour', '5-hour', 'your 5-hour limit'],
    ['seven_day', 'weekly', 'your weekly limit']
  ].map(([key, name, label]) => {
    const range = limits[key]
    if (range) return figure(fmtPct(range.mid), ` of ${label}`, range, range.pm.toFixed(1), [], range.mid)
    const readings = limits.readings?.[key] ?? 0
    return { line: [dim(`  ${name} limit: learning how fast your limit fills, ${readings} of 5 readings so far`)] }
  })
}

function dollarRow(saved) {
  const { dollars, baselineDollars, baseline } = saved
  if (!dollars) return null
  const tail = []
  if (baselineDollars > 0 && dollars.mid > 0) {
    tail.push(dim(`   ${Math.round((100 * dollars.mid) / baselineDollars)}% of the ${fmtUsd(baselineDollars)} ${capitalize(baseline.family)} would cost`))
  }
  const label = saved.subscription === false ? ' off your API bill' : ' at API prices'
  return figure(fmtUsd(dollars.mid), label, dollars, fmtUsd(dollars.pm), tail)
}

function tokensLine(saved) {
  if (!saved.tokens) return null
  const n = fmtTokens(saved.tokens.saved)
  if (saved.tokens.saved >= 0) return [seg('  '), bold(n), seg(' fewer tokens')]
  const families = [...new Set(saved.transitions.filter((t) => t.source !== 'identical').map((t) => t.from.split(':')[0]))]
  const joiner = (i) => (i === families.length - 1 ? ' and ' : ', ')
  const who = families.length ? families.flatMap((f, i) => (i ? [seg(joiner(i)), familySeg(f)] : [familySeg(f)])) : [seg('the agents')]
  return [seg('  '), bold(n), seg(' more tokens: '), ...who, seg(' read and wrote more, at a lower price per token')]
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

const versusLine = (baseline) => [
  dim('compared with running every agent on '),
  familySeg(baseline.family),
  dim(` at ${baseline.effort} effort, your session's setting`)
]

export function savedBlock(saved) {
  const head = [bold(saved.running ? 'ultraguard saved so far' : 'ultraguard saved')]
  if (saved.status === 'none') return [head, [seg("  every agent ran on your session's model and effort, so nothing was saved")]]
  if (!saved.baseline) return [head, [seg("  ultraguard could not read your session's model or effort, so it has no estimate")]]

  const out = [head, versusLine(saved.baseline)]
  const { base, reasons } = coverageText(saved)
  if (saved.status !== 'estimated') {
    out.push([dim(`  ${base}${reasons.length ? `: ${reasons.join('; ')}` : ''}`)])
    return out
  }

  const rows = [...limitRows(saved), dollarRow(saved)].filter(Boolean)
  const first = rows.find((r) => r.range)
  if (first && first.range.lo < 0) first.line.push(dim('   this run may have saved nothing'))
  out.push(...rows.map((r) => r.line))
  const tokens = tokensLine(saved)
  if (tokens) out.push(tokens)

  const { measured, others } = sourceLines(saved)
  const coverage = reasons.length ? `${base}: ${reasons.join('; ')}` : measured ? `${base} · ${measured}` : base
  const lines = ['± = how far off the estimate can be, 9 times out of 10', coverage]
  if (reasons.length && measured) lines.push(measured)
  lines.push(...others)
  out.push(...lines.map((l) => [dim(`  ${l}`)]))
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
    header: limit ? 'saved of 5-hour limit' : 'saved at API prices',
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

export function phaseLayout(labels, bodyColumns, column) {
  const wanted = Math.min(34, Math.max(12, ...labels.map((l) => l.length + 4)))
  const field = column ? Math.max(12, Math.min(wanted, bodyColumns - 6 - 36 - 7)) : wanted
  const savedAt = 6 + field + 36
  return { field, savedAt, roomy: column !== null && savedAt + column.header.length <= bodyColumns }
}

export function listHeader(views) {
  const limit = views.some((v) => fiveHourOf(v.saved))
  return [dim(limit ? 'saved of 5-hour limit' : 'saved at API prices')]
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
  const head = `ultraguard: ${view.title} finished`
  if (!view.ok) return `${head}, but ${view.reason}`
  const saved = view.saved
  if (saved?.status === 'none') return `${head} as approved; every agent ran on your session's model and effort`
  if (saved?.status !== 'estimated') return `${head} as approved`
  const limit = fiveHourOf(saved)
  if (limit) return `${head} as approved and saved about ${fmtPct(limit.mid)} of your 5-hour limit`
  if (!saved.dollars) return `${head} as approved`
  const where = saved.subscription === false ? 'off your API bill' : 'at API prices'
  return `${head} as approved and saved about ${fmtUsd(saved.dollars.mid)} ${where}`
}
