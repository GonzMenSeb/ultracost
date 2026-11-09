import { readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildRatios, BORROWED_FRESH_EXPONENT } from '../src/calibrate.mjs'
import { loadPrices, requestCost } from '../src/prices.mjs'
import { totalsOf } from './lowo.mjs'

export const BUCKET_NAMES = ['output', 'fresh', 'read']
export const CANDIDATES = ['current', 'A', 'A2', 'B']
const PRICE_CLASS = { output: 'output', fresh: 'input', read: 'cacheRead' }
const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable']
const SHOWN_EFFORTS = ['medium', 'high', 'xhigh']
const SHOWN_PAIRS = [
  [['haiku'], ['opus', 'sonnet']],
  [['opus', 'sonnet'], ['haiku']],
]
const TIE = 0.02
const EPS = 1e-9

const sum = (v) => v.reduce((s, x) => s + x, 0)
const mean = (v) => sum(v) / v.length
const familyOf = (config) => config.split(':')[0]
const ratioKey = (from, to) => `${from}>${to}`

export function tokenRatios(wholeIndex, from, to) {
  const [f1, e1] = from.split(':')
  const [f2, e2] = to.split(':')
  const a = wholeIndex?.[f1]?.efforts?.[e1]
  const b = wholeIndex?.[f2]?.efforts?.[e2]
  if (!(a?.outputTokens > 0 && a.inputTokens > 0 && b?.outputTokens > 0 && b.inputTokens > 0)) return null
  return { output: b.outputTokens / a.outputTokens, input: b.inputTokens / a.inputTokens }
}

export function candidateRatios(key, { priors, wholeIndex, prices }) {
  const prior = priors[key]
  if (!prior) return null
  const [from, to] = key.split('>')
  const [f1, f2] = [familyOf(from), familyOf(to)]
  const price = (name) => prices.families[f2][name] / prices.families[f1][name]
  const scalar = Math.exp(prior.mu)
  const cost = scalar * price('input')
  const t = tokenRatios(wholeIndex, from, to)
  return {
    current: { output: scalar, fresh: scalar, read: scalar },
    A: t && { output: t.output, fresh: Math.exp(BORROWED_FRESH_EXPONENT * Math.log(t.output)), read: t.input },
    A2: t && { output: t.output, fresh: t.input, read: t.input },
    B: Object.fromEntries(BUCKET_NAMES.map((name) => [name, cost / price(PRICE_CLASS[name])])),
  }
}

export function truthOf(pairs, prices) {
  const groups = new Map()
  for (const p of pairs) {
    const key = `${p.workflow}\t${ratioKey(p.from, p.to)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
  }
  return [...groups.values()].map((list) => {
    const totals = totalsOf(list, prices)
    return {
      workflow: list[0].workflow,
      transition: ratioKey(list[0].from, list[0].to),
      pairs: list,
      ratios: Object.fromEntries(BUCKET_NAMES.map((name) => [name, totals.baseline[name] / totals.actual[name]])),
      dollars: totals.baseline.dollars,
    }
  })
}

export function predictedDollars(pairs, ratios, prices) {
  return sum(
    pairs.map((p) =>
      requestCost(prices, familyOf(p.to), {
        input: p.actual.input * ratios.fresh,
        output: p.actual.output * ratios.output,
        cacheRead: p.actual.cacheRead * ratios.read,
        cacheWrite: p.actual.cacheWrite * ratios.fresh,
      }),
    ),
  )
}

export function scoreCases({ truth, priors, wholeIndex, prices }) {
  return truth.map((t) => {
    const all = candidateRatios(t.transition, { priors, wholeIndex, prices })
    const byCandidate = {}
    for (const name of CANDIDATES) {
      const ratios = all?.[name]
      if (!ratios) continue
      const predicted = predictedDollars(t.pairs, ratios, prices)
      byCandidate[name] = {
        ratios,
        predicted,
        errors: {
          ...Object.fromEntries(BUCKET_NAMES.map((b) => [b, Math.log(ratios[b] / t.ratios[b])])),
          dollars: Math.log(predicted / t.dollars),
        },
      }
    }
    return { workflow: t.workflow, transition: t.transition, truth: t.ratios, dollars: t.dollars, byCandidate }
  })
}

export function summaryOf(cases) {
  return Object.fromEntries(
    CANDIDATES.map((name) => {
      const rows = cases.filter((c) => c.byCandidate[name])
      const abs = (get) => rows.map((c) => Math.abs(get(c.byCandidate[name].errors)))
      const perBucket = Object.fromEntries(BUCKET_NAMES.map((b) => [b, rows.length ? mean(abs((e) => e[b])) : null]))
      const buckets = rows.flatMap((c) => BUCKET_NAMES.map((b) => Math.abs(c.byCandidate[name].errors[b])))
      return [
        name,
        {
          cases: buckets.length,
          buckets: buckets.length ? mean(buckets) : null,
          perBucket,
          dollars: rows.length ? mean(abs((e) => e.dollars)) : null,
        },
      ]
    }),
  )
}

export function pickOf(summary) {
  const scored = CANDIDATES.filter((name) => summary[name].buckets !== null)
  const best = Math.min(...scored.map((name) => summary[name].buckets))
  const near = scored.filter((name) => summary[name].buckets <= best + TIE + EPS)
  const dollars = (name) => summary[name].dollars ?? Infinity
  return near.reduce((a, b) => (dollars(b) < dollars(a) - EPS ? b : a))
}

export function crossRows({ priors, wholeIndex, prices }) {
  const rows = []
  for (const [fromFamilies, toFamilies] of SHOWN_PAIRS) {
    for (const f2 of toFamilies) {
      for (const f1 of fromFamilies) {
        for (const e1 of SHOWN_EFFORTS) {
          for (const e2 of SHOWN_EFFORTS) {
            const key = ratioKey(`${f1}:${e1}`, `${f2}:${e2}`)
            const ratios = candidateRatios(key, { priors, wholeIndex, prices })
            if (ratios) rows.push({ key, ratios })
          }
        }
      }
    }
  }
  return rows
}

export function priceClassRatios(prices, from, to) {
  return Object.fromEntries(['output', 'input', 'cacheRead', 'cacheWrite'].map((name) => [name, prices.families[to][name] / prices.families[from][name]]))
}

const fixed = (x, digits = 3) => x.toFixed(digits)
const signed = (x) => `${x < 0 ? '-' : '+'}${Math.abs(x).toFixed(3)}`

function table(header, rows, align) {
  const all = [header, ...rows]
  const widths = header.map((_, i) => Math.max(...all.map((r) => String(r[i]).length)))
  const line = (r) => r.map((c, i) => (align[i] === 'r' ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i]))).join('  ').trimEnd()
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n')
}

function errorRows(cases) {
  return cases.flatMap((c) => [
    ...BUCKET_NAMES.map((b) => [
      c.workflow,
      c.transition,
      b,
      fixed(c.truth[b]),
      ...CANDIDATES.flatMap((name) => {
        const x = c.byCandidate[name]
        return x ? [fixed(x.ratios[b]), signed(x.errors[b])] : ['-', '-']
      }),
    ]),
    [
      c.workflow,
      c.transition,
      'dollars',
      `$${fixed(c.dollars, 2)}`,
      ...CANDIDATES.flatMap((name) => {
        const x = c.byCandidate[name]
        return x ? [`$${fixed(x.predicted, 2)}`, signed(x.errors.dollars)] : ['-', '-']
      }),
    ],
  ])
}

const cell = (r) => (r ? BUCKET_NAMES.map((b) => fixed(r[b], 2)).join(' ') : '-')

export function report({ cases, summary, pick, cross, prices, truth }) {
  const sonnetToOpus = priceClassRatios(prices, 'sonnet', 'opus')
  const classes = Object.entries(sonnetToOpus).map(([name, r]) => `${name} ${fixed(r, 2)}`).join(', ')
  const uniform = Object.values(sonnetToOpus).every((r) => Math.abs(r - Object.values(sonnetToOpus)[0]) < EPS)
  const spread = Math.max(
    ...cases.flatMap((c) =>
      BUCKET_NAMES.map((b) => Math.abs(Math.log(c.byCandidate.B.ratios[b] / c.byCandidate.current.ratios[b]))),
    ),
  )
  const transitions = [...new Set(truth.map((t) => t.transition))]
  const summaryRows = CANDIDATES.map((name) => {
    const s = summary[name]
    return [name, s.cases, ...BUCKET_NAMES.map((b) => (s.perBucket[b] === null ? '-' : fixed(s.perBucket[b]))), s.buckets === null ? '-' : fixed(s.buckets), s.dollars === null ? '-' : fixed(s.dollars)]
  })
  const margin = summary.A.buckets - summary.A2.buckets
  const best = CANDIDATES.filter((name) => summary[name].buckets !== null).sort((a, b) => summary[a].buckets - summary[b].buckets)[0]
  return [
    `Cross-family prior backtest: ${truth.length} workflows on ${transitions.length} transitions (${transitions.join(', ')}), all Sonnet to Opus.`,
    `Opus over Sonnet price ratio per class: ${classes}. ${uniform ? `Every class is the same, so B equals current here (largest |ln B / current| ${fixed(spread)}) and this backtest cannot tell them apart.` : `The classes differ (largest |ln B / current| ${fixed(spread)}).`}`,
    'The measured data has no Haiku pair: the Haiku rows below are not backtested.',
    'The candidates use only data/published.json and data/prices.json, never the replays, so each workflow is held out by construction.',
    '',
    'Truth per workflow and transition = sum of the baseline run / sum of the actual run, per bucket (fresh = input + cacheWrite, read = cacheRead); dollars = the baseline run priced at the baseline family. A candidate ratio is applied to the same workflow\'s actual tokens and priced at the baseline family.',
    'ln err = ln(candidate / truth); positive means the candidate over-predicts the baseline.',
    '',
    table(['Workflow', 'Transition', 'Bucket', 'Truth', ...CANDIDATES.flatMap((name) => [name, 'ln err'])], errorRows(cases), 'lllr' + 'rr'.repeat(CANDIDATES.length)),
    '',
    'Mean absolute ln error. Bucket cases are workflows x {output, fresh, read}; dollars are one case per workflow.',
    table(['Candidate', 'Cases', 'output', 'fresh', 'read', 'All buckets', 'Dollars'], summaryRows, 'lrrrrrr'),
    '',
    `A against A2 on all buckets: ${signed(margin)} (A minus A2). Lowest: ${best}. Candidates within ${TIE} of the lowest are ranked by their dollar error.`,
    `Pick: ${pick}`,
    '',
    'Bucket ratios (output fresh read) for Haiku to Opus or Sonnet and Opus or Sonnet to Haiku, efforts medium, high and xhigh on both sides:',
    table(['Prior', ...CANDIDATES], cross.map((r) => [r.key, ...CANDIDATES.map((name) => cell(r.ratios[name]))]), 'l' + 'l'.repeat(CANDIDATES.length)),
  ].join('\n')
}

export function backtest({ replays, published, prices }) {
  const priors = buildRatios({ replays, published, prices }).priors
  const wholeIndex = Object.fromEntries(FAMILIES.map((f) => [f, published.sources.find((s) => s.wholeIndex?.[f])?.wholeIndex[f]]))
  const truth = truthOf(replays.pairs, prices)
  const cases = scoreCases({ truth, priors, wholeIndex, prices })
  const summary = summaryOf(cases)
  return { truth, cases, summary, pick: pickOf(summary), cross: crossRows({ priors, wholeIndex, prices }), prices }
}

function main() {
  const dir = new URL('../data/', import.meta.url)
  const read = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, dir), 'utf8'))
  console.log(report(backtest({ replays: read('replays'), published: read('published'), prices: loadPrices(read('prices')) })))
}

const isMain = () => {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
  } catch {
    return false
  }
}

if (process.argv[1] && isMain()) main()
