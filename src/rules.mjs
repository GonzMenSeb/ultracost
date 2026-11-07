import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const POLICY_PATH = fileURLToPath(new URL('../policy/default.json', import.meta.url))

const MODELS = ['haiku', 'sonnet', 'opus']
const EFFORTS = ['medium', 'high', 'xhigh']
const rank = (m) => MODELS.indexOf(m)
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

export function loadPolicy(path = POLICY_PATH) {
  const policy = JSON.parse(readFileSync(path, 'utf8'))
  const classes = policy && policy.classes
  if (!classes || typeof classes !== 'object' || Array.isArray(classes) || Object.keys(classes).length === 0) {
    throw new Error(`policy ${path}: no classes`)
  }
  for (const [cls, def] of Object.entries(classes)) {
    const pairs = def && def.pairs
    if (!pairs || typeof pairs !== 'object' || Array.isArray(pairs) || Object.keys(pairs).length === 0) {
      throw new Error(`policy ${path}: class "${cls}" has no pairs`)
    }
    for (const [model, efforts] of Object.entries(pairs)) {
      if (!MODELS.includes(model)) throw new Error(`policy ${path}: class "${cls}" has invalid model "${model}"`)
      if (!Array.isArray(efforts) || efforts.length === 0) {
        throw new Error(`policy ${path}: class "${cls}" model "${model}" has no efforts`)
      }
      for (const e of efforts) {
        if (!EFFORTS.includes(e)) throw new Error(`policy ${path}: class "${cls}" model "${model}" has invalid effort "${e}"`)
      }
      if (new Set(efforts).size !== efforts.length) {
        throw new Error(`policy ${path}: class "${cls}" model "${model}" has duplicate efforts`)
      }
    }
  }
  return policy
}

function listsHaiku(policy) {
  return Object.values(policy.classes).some((c) => has(c.pairs, 'haiku'))
}

export function effectivePairs(policy, cls, sessionModel) {
  if (typeof cls !== 'string' || !has(policy.classes, cls)) return {}
  const session = sessionModel === null || sessionModel === undefined ? 'sonnet' : sessionModel
  const base = policy.classes[cls].pairs
  if (session === 'opus') return { ...base }
  const out = {}
  for (const [model, efforts] of Object.entries(base)) {
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

export function rules(stages, policy, ctx) {
  const sessionModel = ctx ? ctx.sessionModel : null
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
    const pairs = effectivePairs(policy, stage.class, sessionModel)
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
    const entries = Object.entries(pairs)
    const ok = noEffort
      ? has(pairs, stage.model)
      : noModel
        ? entries.some(([, efforts]) => efforts.includes(stage.effort))
        : has(pairs, stage.model) && pairs[stage.model].includes(stage.effort)
    if (!ok) {
      const given = noEffort
        ? `model "${stage.model}"`
        : noModel
          ? `effort "${stage.effort}"`
          : `model "${stage.model}" with effort "${stage.effort}"`
      const movesOffOpus = !has(pairs, 'opus') && stage.model !== 'sonnet' && stage.model !== 'haiku' && stage.hasBlockedOn !== true
      errors.push({
        code: 'PAIR',
        ...base,
        message: `Class "${stage.class}:" does not allow ${given}. Allowed: ${formatPairs(pairs)}.`,
        ...(movesOffOpus ? { needsBlockedOn: true } : {})
      })
    }
  })
  return errors
}
