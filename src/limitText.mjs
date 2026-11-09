export const NEAR = 10
export const TINY = 2
export const HALF = 50
export const HALF_MARGIN = 5

export const bandOf = (total) => (total > 100 ? 'over' : total >= 100 - NEAR ? 'near' : 'far')

const kindOf = (r, total, band) => {
  if (band === 'far') {
    if (!(r.used < HALF && total > HALF)) return null
    return { kind: 'half', hedge: total - HALF < HALF_MARGIN ? 'likely' : '' }
  }
  const hedge = r.saved >= TINY ? '' : bandOf(r.used + r.range.lo) === band ? 'likely' : 'might'
  return { kind: band, hedge }
}

export const limitMessages = (rows) => {
  const groups = []
  for (const r of rows) {
    if (!r.range || !(r.saved > 0) || r.used === null) continue
    const total = r.used + r.saved
    const found = kindOf(r, total, bandOf(total))
    if (!found) continue
    const { kind, hedge } = found
    const same = kind !== 'near' && groups.find((g) => g.kind === kind && g.hedge === hedge)
    if (same) same.rows.push(r)
    else groups.push({ kind, hedge, rows: [r] })
  }
  return groups.map(({ kind, hedge, rows: rs }) => {
    const lead = 'without ultraguard you ' + (hedge === 'might' ? 'might' : hedge === 'likely' ? 'would likely' : 'would') + ' have'
    const limits = rs.map((r) => r.label).join(' and ') + ' limit' + (rs.length > 1 ? 's' : '')
    if (kind === 'over') return `${lead} ${hedge ? 'hit' : 'blown past'} your ${limits}`
    if (kind === 'half') return `${lead} been past half of your ${limits} already`
    const left = 100 - (rs[0].used + rs[0].saved)
    return `${lead} had ${left < 1 ? 'less than 1%' : 'only ' + Math.round(left) + '%'} of your ${rs[0].label} limit left`
  })
}

export const wrapText = (text, width) => {
  const lines = []
  for (const w of text.split(' ')) {
    const last = lines[lines.length - 1]
    if (last !== undefined && last.length + 1 + w.length <= width) lines[lines.length - 1] = last + ' ' + w
    else lines.push(w)
  }
  return lines
}
