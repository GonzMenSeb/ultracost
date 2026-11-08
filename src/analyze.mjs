import * as acorn from '../vendor/acorn.mjs'

const PARSE_OPTIONS = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: true,
  locations: true
}

const LEAF_TYPES = new Set([
  'BreakStatement',
  'ContinueStatement',
  'MetaProperty',
  'ImportSpecifier',
  'ImportDefaultSpecifier',
  'ImportNamespaceSpecifier',
  'ExportSpecifier'
])

const GLOBAL_ROUTES = new Set(['globalThis', 'eval', 'Function'])
const TRACKED = new Set(['model', 'effort', 'label', 'schema', 'agentType'])
const LABEL_PREFIX = /^([a-z]+):/

const isNode = (v) => v !== null && typeof v === 'object' && typeof v.type === 'string'

function childNodes(node) {
  switch (node.type) {
    case 'MemberExpression':
      return node.computed ? [node.object, node.property] : [node.object]
    case 'Property':
    case 'MethodDefinition':
    case 'PropertyDefinition':
      return (node.computed ? [node.key, node.value] : [node.value]).filter(isNode)
    case 'LabeledStatement':
      return [node.body]
    default:
      return LEAF_TYPES.has(node.type) ? [] : Object.values(node).flat().filter(isNode)
  }
}

function visitAst(root, fn) {
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    fn(node)
    const kids = childNodes(node)
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i])
  }
}

export function identifiers(ast) {
  const found = []
  visitAst(ast, (node) => {
    if (node.type === 'Identifier') found.push(node)
  })
  return found
}

const lineOf = (node) => (node.loc ? node.loc.start.line : null)
const isString = (node) => node.type === 'Literal' && typeof node.value === 'string'

function keyName(prop) {
  if (prop.key.type === 'Identifier') return prop.key.name
  if (prop.key.type === 'Literal') return String(prop.key.value)
  return null
}

const isPlainProp = (p) => p.type === 'Property' && !p.computed
const isReadable = (p) => p.kind === 'init' && !p.method

function member(obj, name) {
  const matches = obj.properties.filter((p) => isPlainProp(p) && keyName(p) === name)
  if (matches.length === 0) return { problem: 'is missing' }
  if (matches.length > 1) return { problem: 'is defined more than once' }
  if (!isReadable(matches[0])) return { problem: 'must be a plain name: value property' }
  return { prop: matches[0] }
}

function isLiteralTree(node) {
  switch (node.type) {
    case 'Literal':
      return true
    case 'ArrayExpression':
      return node.elements.every((e) => e !== null && isLiteralTree(e))
    case 'ObjectExpression':
      return node.properties.every((p) => isPlainProp(p) && isReadable(p) && !p.shorthand && keyName(p) !== null && isLiteralTree(p.value))
    default:
      return false
  }
}

function duplicateKey(obj) {
  const seen = new Set()
  for (const p of obj.properties) {
    const k = keyName(p)
    if (seen.has(k)) return k
    seen.add(k)
  }
  return null
}

function bindingTargets(pattern, into) {
  if (!pattern) return
  switch (pattern.type) {
    case 'Identifier':
      into.add(pattern)
      break
    case 'ObjectPattern':
      for (const p of pattern.properties) bindingTargets(p.type === 'Property' ? p.value : p, into)
      break
    case 'ArrayPattern':
      for (const e of pattern.elements) bindingTargets(e, into)
      break
    case 'AssignmentPattern':
      bindingTargets(pattern.left, into)
      break
    case 'RestElement':
      bindingTargets(pattern.argument, into)
      break
  }
}

function checkBlockedOn(call, schema, fail) {
  const blocked = (node, message) => fail(node, message, { needsBlockedOn: true })

  if (schema.problem) {
    blocked(call, `Sonnet and Haiku stages need an inline schema with blocked_on: schema ${schema.problem}`)
    return
  }
  if (schema.prop.value.type !== 'ObjectExpression') {
    blocked(schema.prop.value, 'schema must be an inline object literal; a shared schema const is not allowed')
    return
  }
  const schemaObj = schema.prop.value
  if (!schemaObj.properties.every(isPlainProp)) {
    blocked(schemaObj, 'schema must not use spread or computed keys')
    return
  }
  const props = member(schemaObj, 'properties')
  if (props.problem) {
    blocked(schemaObj, `schema.properties ${props.problem}; it must be an inline object literal containing blocked_on`)
    return
  }
  const propsObj = props.prop.value
  if (propsObj.type !== 'ObjectExpression') {
    blocked(propsObj, 'schema.properties must be an inline object literal')
    return
  }
  if (!propsObj.properties.every(isPlainProp)) {
    blocked(propsObj, 'schema.properties must not use spread or computed keys')
    return
  }
  const dup = duplicateKey(propsObj)
  if (dup !== null) {
    blocked(propsObj, `schema.properties defines "${dup}" more than once`)
    return
  }
  const bo = member(propsObj, 'blocked_on')
  if (bo.problem) {
    blocked(propsObj, `schema.properties.blocked_on ${bo.problem}`)
    return
  }
  const boObj = bo.prop.value
  if (boObj.type !== 'ObjectExpression') {
    blocked(boObj, 'blocked_on must be an inline object literal')
    return
  }
  if (!isLiteralTree(boObj)) {
    blocked(boObj, 'blocked_on must contain only literals: no identifiers, spread, computed keys or expressions')
    return
  }
  const type = member(boObj, 'type')
  const typeOk =
    type.prop &&
    type.prop.value.type === 'ArrayExpression' &&
    type.prop.value.elements.length === 2 &&
    isString(type.prop.value.elements[0]) &&
    type.prop.value.elements[0].value === 'string' &&
    isString(type.prop.value.elements[1]) &&
    type.prop.value.elements[1].value === 'null'
  if (!typeOk) blocked(type.prop ? type.prop.value : boObj, "blocked_on.type must be the array literal ['string', 'null']")
  const desc = member(boObj, 'description')
  const descOk = desc.prop && isString(desc.prop.value) && desc.prop.value.value.trim() !== ''
  if (!descOk) blocked(desc.prop ? desc.prop.value : boObj, 'blocked_on.description must be a non-empty quoted string')
}

function isVerdictSchema(schema) {
  const propsObj = member(schema.prop.value, 'properties').prop.value
  if (propsObj.properties.length !== 3) return false
  const typed = (name, type) => {
    const entry = member(propsObj, name)
    if (!entry.prop || entry.prop.value.type !== 'ObjectExpression' || !isLiteralTree(entry.prop.value)) return false
    const t = member(entry.prop.value, 'type')
    return Boolean(t.prop) && isString(t.prop.value) && t.prop.value.value === type
  }
  return typed('pass', 'boolean') && typed('evidence', 'string')
}

function analyzeCall(call, index, errors) {
  const stage = { line: lineOf(call), label: null, class: null, model: null, effort: null, hasBlockedOn: false, verdict: false }
  const found = []
  const fail = (node, message, extra) => found.push({ node, message, extra })
  const failLabel = (node, message) => found.push({ node, message, classless: true })
  const args = call.arguments
  const argsOk = args.length === 2 && args.every((a) => a.type !== 'SpreadElement')
  const opts = args[1]
  const modelUnreadable = !(opts && opts.type === 'ObjectExpression') ? { needsBlockedOn: true } : undefined
  if (!argsOk) {
    fail(call, `agent() takes exactly 2 arguments with no spread: a prompt and an options object literal with label, model and effort (got ${args.length})`, modelUnreadable)
  }
  if (opts && opts.type === 'ObjectExpression') {
    if (opts.properties.some((p) => p.type === 'SpreadElement')) fail(opts, 'agent() options must not use spread')
    const by = new Map()
    for (const p of opts.properties) {
      if (!isPlainProp(p)) continue
      const k = keyName(p)
      if (!TRACKED.has(k)) continue
      if (!by.has(k)) by.set(k, [])
      by.get(k).push(p)
    }
    const isDuplicated = (name) => (by.get(name) || []).length > 1

    for (const name of ['model', 'effort']) {
      const props = by.get(name)
      const extra = name === 'model' ? { needsBlockedOn: true } : undefined
      if (!props) fail(opts, `${name} is missing; every agent() must name a model and an effort`, extra)
      else if (props.length === 1) {
        const p = props[0]
        if (isReadable(p) && isString(p.value)) stage[name] = p.value.value
        else fail(p.value, 'model/effort must be a quoted string literal', extra)
      }
    }

    const labelProps = by.get('label')
    if (!labelProps) {
      failLabel(opts, "label is missing; it must start with the class prefix, such as 'build: parser'")
    } else if (labelProps.length === 1) {
      const v = labelProps[0].value
      let head = null
      if (isReadable(labelProps[0]) && isString(v)) {
        stage.label = v.value
        head = v.value
      } else if (isReadable(labelProps[0]) && v.type === 'TemplateLiteral') {
        const part = (q) => (q.value.cooked !== null && q.value.cooked !== undefined ? q.value.cooked : q.value.raw)
        stage.label = v.quasis.map((q, i) => part(q) + (i < v.expressions.length ? '${…}' : '')).join('')
        head = v.quasis[0].value.cooked
      }
      if (stage.label === null) {
        failLabel(v, "label must be literal text at the very start of a string or template literal in the agent() call itself, such as 'build: parser' or `grunt: ${name}`; a variable or helper parameter cannot pass")
      } else {
        const m = LABEL_PREFIX.exec(head === null || head === undefined ? '' : head)
        if (m) stage.class = m[1]
        else failLabel(v, "label must start with a literal class prefix (lowercase letters and a colon), such as 'build: parser'")
      }
    }

    for (const name of ['model', 'effort', 'label', 'schema']) {
      const props = by.get(name) || []
      const sensitive =
        (name === 'schema' && typeof stage.model === 'string' && stage.model !== 'opus') || (name === 'model' && stage.model === null)
      if (props.length > 1) {
        fail(props[1], `duplicate "${name}" option`, sensitive ? { needsBlockedOn: true } : undefined)
      }
    }
    if (by.has('agentType')) fail(by.get('agentType')[0], 'agentType is not allowed')

    if (!isDuplicated('schema')) {
      const schemaProps = by.get('schema')
      const schema = !schemaProps
        ? { problem: 'is missing' }
        : isReadable(schemaProps[0])
          ? { prop: schemaProps[0] }
          : { problem: 'must be a plain name: value property' }
      let valid = true
      checkBlockedOn(opts, schema, () => {
        valid = false
      })
      stage.hasBlockedOn = valid
      stage.verdict = valid && isVerdictSchema(schema)
      if (typeof stage.model === 'string' && stage.model !== 'opus') {
        checkBlockedOn(opts, schema, fail)
      } else if (stage.model === null && schemaProps && isReadable(schemaProps[0])) {
        if (schemaProps[0].value.type !== 'ObjectExpression') {
          fail(schemaProps[0].value, 'schema must be an inline object literal; a shared schema const is not allowed', { needsBlockedOn: true })
        } else {
          checkBlockedOn(opts, schema, (node, message) => fail(node, `If this stage runs on sonnet or haiku, ${message}`, { needsBlockedOn: true }))
        }
      }
    }
  } else if (argsOk) {
    fail(opts, 'agent() options must be an object literal with label, model and effort', modelUnreadable)
  }

  const movesToSonnet = stage.model !== 'sonnet' && stage.model !== 'haiku' && !stage.hasBlockedOn
  for (const { node, message, extra, classless } of found) {
    errors.push({
      code: 'SHAPE',
      line: lineOf(node),
      label: stage.label,
      message,
      stage: index,
      ...(classless && movesToSonnet ? { needsBlockedOn: true } : extra)
    })
  }
  return stage
}

export function analyze(source) {
  if (typeof source !== 'string') throw new TypeError('analyze() needs the script source as a string')
  let ast
  try {
    ast = acorn.parse(source, PARSE_OPTIONS)
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e
    const line = e.loc && typeof e.loc.line === 'number' ? e.loc.line : null
    return { ast: null, stages: [], calls: [], errors: [{ code: 'PARSE', line, label: null, message: e.message, stage: null }] }
  }

  const errors = []
  const bindings = new Set()
  const callees = new Set()
  const calls = []
  const workflowRefs = []
  const report = (code, node, message, extra) => errors.push({ code, line: lineOf(node), label: null, message, stage: null, ...extra })

  visitAst(ast, (node) => {
    switch (node.type) {
      case 'ThisExpression':
        report('SHAPE', node, 'this is not allowed')
        break
      case 'VariableDeclarator':
        bindingTargets(node.id, bindings)
        break
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        bindingTargets(node.id, bindings)
        for (const p of node.params) bindingTargets(p, bindings)
        break
      case 'ClassDeclaration':
      case 'ClassExpression':
        bindingTargets(node.id, bindings)
        break
      case 'CatchClause':
        bindingTargets(node.param, bindings)
        break
      case 'CallExpression':
        if (!node.optional && node.callee.type === 'Identifier') {
          callees.add(node.callee)
          if (node.callee.name === 'agent') calls.push(node)
        }
        break
      case 'Identifier':
        if (node.name === 'agent') {
          if (bindings.has(node)) {
            report('SHAPE', node, 'Nothing may be named agent (variable, parameter, function, class or destructuring target); rename the variable')
          } else if (!callees.has(node)) {
            report(
              'SHAPE',
              node,
              'agent must be called directly as agent(prompt, options); do not pass it as a value, alias it, call it with ?. or new, or wrap it. Each call needs inline label, model and effort options, and a schema with blocked_on for sonnet and haiku',
              { needsBlockedOn: true }
            )
          }
        } else if (node.name === 'workflow') {
          workflowRefs.push(node)
        } else if (GLOBAL_ROUTES.has(node.name)) {
          report('SHAPE', node, `${node.name} is not allowed`)
        }
        break
    }
  })

  const workflowBound = workflowRefs.some((n) => bindings.has(n))
  for (const node of workflowRefs) {
    report(
      'SOURCE',
      node,
      workflowBound
        ? 'Nothing may be named workflow (variable, parameter, function, class or destructuring target); rename the variable'
        : 'workflow is not allowed; inline the child workflow into this script'
    )
  }

  calls.sort((a, b) => a.start - b.start)
  const stages = calls.map((call, index) => analyzeCall(call, index, errors))

  const seen = new Set()
  const unique = errors.filter((e) => {
    const key = JSON.stringify([e.code, e.line, e.stage, e.message])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const order = new Map(unique.map((e, i) => [e, i]))
  unique.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity) || order.get(a) - order.get(b))
  return { ast, stages, calls, errors: unique }
}
