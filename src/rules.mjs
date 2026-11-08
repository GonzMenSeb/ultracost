import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const POLICY_PATH = fileURLToPath(new URL('../policy/default.json', import.meta.url))

const MODELS = ['haiku', 'sonnet', 'opus']
const EFFORTS = ['medium', 'high', 'xhigh']
const LIMIT_KEYS = ['maxConcurrentOpus', 'bigFanout']
export const DEFAULT_LIMITS = Object.freeze({ maxConcurrentOpus: 3, bigFanout: 3 })
const rank = (m) => MODELS.indexOf(m)
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

function checkPairs(path, cls, key, pairs) {
  const label = key === 'pairs' ? `class "${cls}"` : `class "${cls}" ${key}`
  if (!pairs || typeof pairs !== 'object' || Array.isArray(pairs) || Object.keys(pairs).length === 0) {
    throw new Error(`policy ${path}: ${label} has no pairs`)
  }
  for (const [model, efforts] of Object.entries(pairs)) {
    if (!MODELS.includes(model)) throw new Error(`policy ${path}: ${label} has invalid model "${model}"`)
    if (!Array.isArray(efforts) || efforts.length === 0) {
      throw new Error(`policy ${path}: ${label} model "${model}" has no efforts`)
    }
    for (const e of efforts) {
      if (!EFFORTS.includes(e)) throw new Error(`policy ${path}: ${label} model "${model}" has invalid effort "${e}"`)
    }
    if (new Set(efforts).size !== efforts.length) {
      throw new Error(`policy ${path}: ${label} model "${model}" has duplicate efforts`)
    }
  }
}

function checkLimits(path, limits) {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) throw new Error(`policy ${path}: limits must be an object`)
  for (const [key, value] of Object.entries(limits)) {
    if (!LIMIT_KEYS.includes(key)) throw new Error(`policy ${path}: limits has unknown key "${key}"`)
    if (!Number.isInteger(value) || value < 1) throw new Error(`policy ${path}: limits.${key} must be a positive integer`)
  }
}

export function loadPolicy(path = POLICY_PATH) {
  const policy = JSON.parse(readFileSync(path, 'utf8'))
  const classes = policy && policy.classes
  if (!classes || typeof classes !== 'object' || Array.isArray(classes) || Object.keys(classes).length === 0) {
    throw new Error(`policy ${path}: no classes`)
  }
  for (const [cls, def] of Object.entries(classes)) {
    checkPairs(path, cls, 'pairs', def && def.pairs)
    for (const key of ['fanoutPairs', 'verdictPairs']) {
      if (has(def, key)) checkPairs(path, cls, key, def[key])
    }
  }
  if (has(policy, 'limits')) checkLimits(path, policy.limits)
  if (has(policy, 'labelCheck')) checkLabelCheck(path, policy.labelCheck, classes)
  return policy
}

function checkLabelCheck(path, lc, classes) {
  if (!lc || typeof lc !== 'object' || Array.isArray(lc)) throw new Error(`policy ${path}: labelCheck must be an object`)
  for (const key of Object.keys(lc)) {
    if (!['words', 'classes', 'fanoutClasses', 'use'].includes(key)) throw new Error(`policy ${path}: labelCheck has unknown key "${key}"`)
  }
  if (!Array.isArray(lc.words) || lc.words.length === 0 || !lc.words.every((w) => typeof w === 'string' && /^[a-z]+$/.test(w))) {
    throw new Error(`policy ${path}: labelCheck.words must be a non-empty list of lowercase words`)
  }
  for (const key of ['classes', 'fanoutClasses']) {
    const list = lc[key] === undefined ? [] : lc[key]
    if (!Array.isArray(list) || !list.every((c) => typeof c === 'string' && has(classes, c))) {
      throw new Error(`policy ${path}: labelCheck.${key} must list existing classes`)
    }
  }
  if (typeof lc.use !== 'string' || !has(classes, lc.use)) throw new Error(`policy ${path}: labelCheck.use must name an existing class`)
}

export function labelWord(policy, stage, inFanout) {
  const lc = policy.labelCheck
  if (!lc || typeof stage.label !== 'string' || typeof stage.class !== 'string') return null
  const checked = (lc.classes || []).includes(stage.class) || (inFanout === true && (lc.fanoutClasses || []).includes(stage.class))
  if (!checked) return null
  const name = stage.label.slice(stage.label.indexOf(':') + 1).split('${…}').join(' ').toLowerCase()
  return name.split(/[^a-z]+/).find((w) => lc.words.includes(w)) ?? null
}

export function limitsOf(policy) {
  return { ...DEFAULT_LIMITS, ...(policy.limits || {}) }
}

function listsHaiku(policy) {
  return Object.values(policy.classes).some((c) => has(c.pairs, 'haiku'))
}

function mergePairs(...maps) {
  const out = {}
  for (const map of maps) {
    if (!map) continue
    for (const [model, efforts] of Object.entries(map)) {
      out[model] = [...new Set([...(out[model] || []), ...efforts])]
    }
  }
  return out
}

export function effectivePairs(policy, cls, sessionModel, ctx = {}) {
  if (typeof cls !== 'string' || !has(policy.classes, cls)) return {}
  const session = sessionModel === null || sessionModel === undefined ? 'sonnet' : sessionModel
  const def = policy.classes[cls]
  if (session === 'opus') {
    return mergePairs(def.pairs, ctx.bigFanout === true ? def.fanoutPairs : null, ctx.verdict === true ? def.verdictPairs : null)
  }
  const out = {}
  for (const [model, efforts] of Object.entries(def.pairs)) {
    if (rank(model) <= rank(session) && efforts.length > 0) out[model] = [...efforts]
  }
  if (Object.keys(out).length > 0) return out
  if (session === 'sonnet') return { sonnet: [...EFFORTS] }
  if (session === 'haiku' && listsHaiku(policy)) return { haiku: ['xhigh'] }
  return {}
}

export function formatPairs(pairs) {
  const parts = Object.entries(pairs).map(([m, e]) => `${m} × {${e.join(', ')}}`)
  return parts.length ? parts.join('; ') : 'none'
}

export function formatClassPairs(policy, cls) {
  const def = policy.classes[cls]
  const { bigFanout } = limitsOf(policy)
  const parts = [formatPairs(def.pairs)]
  for (const [pairs, mark] of [
    [def.fanoutPairs, `in a fan-out of more than ${bigFanout} only`],
    [def.verdictPairs, 'yes/no verdict schema only']
  ]) {
    if (!pairs) continue
    for (const [model, efforts] of Object.entries(pairs)) parts.push(`${model} × {${efforts.join(', ')}} (${mark})`)
  }
  return parts.join('; ')
}

const HAIKU_NONE = 'This session runs Haiku and no Haiku pair is allowed; switch with /model sonnet or /model opus.'

const mayMoveToSonnet = (stage) => stage.hasBlockedOn !== true && stage.model !== 'sonnet' && stage.model !== 'haiku'

function globalErrors(stage, sessionModel, base, classless, policy) {
  const out = []
  const classExtra = classless && mayMoveToSonnet(stage) ? { needsBlockedOn: true } : undefined
  const push = (message, extra) => out.push({ code: 'PAIR', ...base, message, ...classExtra, ...extra })
  const cap = sessionModel === null || sessionModel === undefined ? 'sonnet' : sessionModel
  const hasEffort = stage.effort !== null && stage.effort !== undefined
  const hasModel = stage.model !== null && stage.model !== undefined
  if (hasEffort && !EFFORTS.includes(stage.effort)) {
    push(`effort "${stage.effort}" is not allowed. Allowed efforts: ${EFFORTS.join(', ')}.`)
  }
  if (hasModel && !MODELS.includes(stage.model)) {
    push(`model "${stage.model}" is not allowed. Allowed models: ${[...MODELS].reverse().join(', ')}.`)
  } else if (hasModel && rank(stage.model) > rank(cap)) {
    const movesToSonnet = cap !== 'opus' && stage.hasBlockedOn !== true
    push(`model "${stage.model}" is above the session model (${cap}).`, movesToSonnet ? { needsBlockedOn: true } : undefined)
  }
  if (stage.model === 'haiku' && EFFORTS.includes(stage.effort)) {
    const allowed = Object.keys(policy.classes).some((c) => has(effectivePairs(policy, c, sessionModel), 'haiku'))
    if (!allowed) push('model "haiku" is not allowed under the current policy; see the allowed pairs per class.')
    else if (stage.effort !== 'xhigh') push(`model "haiku" is only allowed with effort "xhigh", not "${stage.effort}".`)
  }
  return out
}

const pairAllowed = (pairs, model, effort) => {
  const noModel = model === null || model === undefined
  const noEffort = effort === null || effort === undefined
  if (noEffort) return has(pairs, model)
  if (noModel) return Object.values(pairs).some((efforts) => efforts.includes(effort))
  return has(pairs, model) && pairs[model].includes(effort)
}

function conditionHint(policy, stage, sessionModel, cond) {
  if (sessionModel !== 'opus') return ''
  const def = policy.classes[stage.class]
  const { bigFanout } = limitsOf(policy)
  const hints = []
  if (!cond.bigFanout && def.fanoutPairs && pairAllowed(def.fanoutPairs, stage.model, stage.effort)) {
    hints.push(
      `${stage.class}: may use ${Object.keys(def.fanoutPairs).join(' or ')} only in a fan-out of more than ${bigFanout} agents (parallel or pipeline); this stage is not in one.`
    )
  }
  if (!cond.verdict && def.verdictPairs && pairAllowed(def.verdictPairs, stage.model, stage.effort)) {
    hints.push(
      `${stage.class}: may use ${Object.keys(def.verdictPairs).join(' or ')} only for a single yes/no review, with schema.properties exactly pass ({ type: 'boolean' }), evidence ({ type: 'string' }) and blocked_on.`
    )
  }
  return hints.join(' ')
}

export function rules(stages, policy, ctx) {
  const sessionModel = ctx ? ctx.sessionModel : null
  const fanStages = ctx && ctx.fanout && Array.isArray(ctx.fanout.stages) ? ctx.fanout.stages : []
  const errors = []
  stages.forEach((stage, i) => {
    const base = { line: stage.line ?? null, label: stage.label ?? null, stage: i }
    if (stage.class === null || stage.class === undefined) {
      errors.push(...globalErrors(stage, sessionModel, base, true, policy))
      return
    }
    if (!has(policy.classes, stage.class)) {
      errors.push({
        code: 'PAIR',
        ...base,
        message: `Unknown class "${stage.class}:". Valid classes: ${Object.keys(policy.classes).join(', ')}.`,
        ...(mayMoveToSonnet(stage) ? { needsBlockedOn: true } : {})
      })
      errors.push(...globalErrors(stage, sessionModel, base, true, policy))
      return
    }
    const word = labelWord(policy, stage, Boolean(fanStages[i] && fanStages[i].inFanout))
    if (word) {
      const use = policy.labelCheck.use
      errors.push({
        code: 'LABEL',
        ...base,
        message: `"${stage.label}" reads like investigation ("${word}"). Investigation runs as ${use}: on ${formatPairs(effectivePairs(policy, use, sessionModel))}. Keep ${stage.class}: for a stage that owns the ${stage.class === 'judge' ? 'review' : stage.class === 'synth' ? 'synthesis' : stage.class === 'design' ? 'design' : 'decision'} itself, and name it by that.`,
        ...(mayMoveToSonnet(stage) ? { needsBlockedOn: true } : {})
      })
    }
    const cond = { bigFanout: Boolean(fanStages[i] && fanStages[i].bigFanout), verdict: stage.verdict === true }
    const pairs = effectivePairs(policy, stage.class, sessionModel, cond)
    if (Object.keys(pairs).length === 0) {
      errors.push({
        code: 'PAIR',
        ...base,
        message: sessionModel === 'haiku'
          ? HAIKU_NONE
          : `No model/effort pair is allowed for class "${stage.class}:".`
      })
      return
    }
    const noModel = stage.model === null || stage.model === undefined
    const noEffort = stage.effort === null || stage.effort === undefined
    if (noModel && noEffort) return
    const ok = pairAllowed(pairs, stage.model, stage.effort)
    if (!ok) {
      const given = noEffort
        ? `model "${stage.model}"`
        : noModel
          ? `effort "${stage.effort}"`
          : `model "${stage.model}" with effort "${stage.effort}"`
      const movesOffOpus = !has(pairs, 'opus') && stage.model !== 'sonnet' && stage.model !== 'haiku' && stage.hasBlockedOn !== true
      const hint = conditionHint(policy, stage, sessionModel, cond)
      errors.push({
        code: 'PAIR',
        ...base,
        message: `Class "${stage.class}:" does not allow ${given}.${hint ? ` ${hint}` : ''} Allowed: ${formatPairs(pairs)}.`,
        ...(movesOffOpus ? { needsBlockedOn: true } : {})
      })
    }
  })
  return errors
}
