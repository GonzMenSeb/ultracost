const INF = Infinity
const ZERO = Object.freeze({ o: 0, a: 0, reach: new Set() })
const THEN = new Set(['then', 'catch', 'finally'])
const ALL = new Set(['allSettled'])
const RACE = new Set(['all', 'any', 'race'])
const SHADOWABLE = new Set(['slice', 'map', 'flatMap', 'filter'])
const READ_METHODS = new Set([
  'map', 'filter', 'flatMap', 'flat', 'slice', 'concat', 'forEach', 'some', 'every', 'find', 'findIndex', 'findLast',
  'findLastIndex', 'includes', 'indexOf', 'lastIndexOf', 'join', 'reduce', 'reduceRight', 'at', 'keys', 'values', 'entries', 'toString'
])
const CALLBACK_METHODS = new Set(['map', 'filter', 'flatMap', 'forEach', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'reduce', 'reduceRight'])
const SAFE_ARG_CALLEES = [
  ['Array', new Set(['from', 'isArray']), Infinity],
  ['JSON', new Set(['stringify']), 1]
]
const NUMERIC_BINARY = new Set(['-', '*', '/', '%', '**', '|', '&', '^', '<<', '>>', '>>>'])
const LEAVES = new Set([
  'BreakStatement', 'ContinueStatement', 'MetaProperty', 'ImportDeclaration', 'ImportSpecifier', 'ImportDefaultSpecifier',
  'ImportNamespaceSpecifier', 'ExportAllDeclaration'
])

const isNode = (v) => v !== null && typeof v === 'object' && typeof v.type === 'string'
const isFn = (n) => n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression'
const mul = (a, b) => (a === 0 || b === 0 ? 0 : a * b)
const isNamed = (m) => m.type === 'MemberExpression' && !m.computed && m.property.type === 'Identifier'

function kids(node) {
  switch (node.type) {
    case 'MemberExpression':
      return node.computed ? [node.object, node.property] : [node.object]
    case 'Property':
    case 'MethodDefinition':
    case 'PropertyDefinition':
      return (node.computed ? [node.key, node.value] : [node.value]).filter(isNode)
    case 'LabeledStatement':
      return [node.body]
    case 'ExportSpecifier':
      return [node.local]
    default:
      return LEAVES.has(node.type) ? [] : Object.values(node).flat().filter(isNode)
  }
}

function patternIds(p, out) {
  if (!p) return out
  switch (p.type) {
    case 'Identifier':
      out.push(p)
      break
    case 'ObjectPattern':
      for (const x of p.properties) patternIds(x.type === 'Property' ? x.value : x, out)
      break
    case 'ArrayPattern':
      for (const x of p.elements) patternIds(x, out)
      break
    case 'AssignmentPattern':
      patternIds(p.left, out)
      break
    case 'RestElement':
      patternIds(p.argument, out)
      break
  }
  return out
}

function analyzeScopes(ast) {
  const parent = new Map()
  const refScope = new Map()
  const idNodes = []
  const declIds = new Set()
  const declared = new Map()
  const writeSites = []
  const newScope = (up, isFnScope) => ({ up, isFnScope, names: new Map() })
  const root = newScope(null, true)

  const declare = (scope, id, kind, extra) => {
    let target = scope
    if (kind === 'var') while (!target.isFnScope) target = target.up
    declIds.add(id)
    const prior = target.names.get(id.name)
    if (prior) {
      prior.multi = true
      declared.set(id, prior)
      return
    }
    const b = { name: id.name, kind, init: null, fn: null, multi: false, refs: [], writes: [], ...extra }
    target.names.set(id.name, b)
    declared.set(id, b)
  }

  const walkFn = (node, scope) => {
    const s = newScope(scope, true)
    if (node.type === 'FunctionExpression' && node.id) declare(s, node.id, 'fname', { fn: node })
    for (const p of node.params) {
      for (const id of patternIds(p, [])) declare(s, id, 'param')
      walk(p, s, node)
    }
    if (node.body.type === 'BlockStatement') {
      parent.set(node.body, node)
      for (const st of node.body.body) walk(st, s, node.body)
    } else {
      walk(node.body, s, node)
    }
  }

  function walk(node, scope, par) {
    parent.set(node, par)
    switch (node.type) {
      case 'Identifier':
        idNodes.push(node)
        refScope.set(node, scope)
        return
      case 'FunctionDeclaration':
        if (node.id) declare(scope, node.id, 'function', { fn: node })
        walkFn(node, scope)
        return
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        walkFn(node, scope)
        return
      case 'ClassDeclaration':
        if (node.id) declare(scope, node.id, 'class')
        for (const k of kids(node)) walk(k, scope, node)
        return
      case 'ClassExpression': {
        const s = newScope(scope, false)
        if (node.id) declare(s, node.id, 'class')
        for (const k of kids(node)) walk(k, s, node)
        return
      }
      case 'StaticBlock': {
        const s = newScope(scope, true)
        for (const st of node.body) walk(st, s, node)
        return
      }
      case 'BlockStatement': {
        const s = newScope(scope, false)
        for (const st of node.body) walk(st, s, node)
        return
      }
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement': {
        if (node.type !== 'ForStatement' && node.left.type !== 'VariableDeclaration') {
          for (const id of patternIds(node.left, [])) writeSites.push({ id, w: { kind: 'other' } })
        }
        const s = newScope(scope, false)
        for (const k of kids(node)) walk(k, s, node)
        return
      }
      case 'SwitchStatement': {
        walk(node.discriminant, scope, node)
        const s = newScope(scope, false)
        for (const c of node.cases) walk(c, s, node)
        return
      }
      case 'CatchClause': {
        const s = newScope(scope, false)
        if (node.param) {
          for (const id of patternIds(node.param, [])) declare(s, id, 'catch')
          walk(node.param, s, node)
        }
        walk(node.body, s, node)
        return
      }
      case 'VariableDeclaration':
        for (const d of node.declarations) {
          parent.set(d, node)
          for (const id of patternIds(d.id, [])) {
            const direct = d.id === id
            declare(scope, id, node.kind, direct ? { init: d.init || null, fn: node.kind === 'const' && d.init && isFn(d.init) ? d.init : null } : {})
          }
          walk(d.id, scope, d)
          if (d.init) walk(d.init, scope, d)
        }
        return
      case 'ImportDeclaration':
        for (const sp of node.specifiers) declare(root, sp.local, 'import')
        return
      case 'AssignmentExpression':
        if (node.left.type === 'Identifier') {
          writeSites.push({ id: node.left, w: { kind: 'assign', op: node.operator, right: node.right } })
        } else {
          for (const id of patternIds(node.left, [])) writeSites.push({ id, w: { kind: 'other' } })
        }
        break
      case 'UpdateExpression':
        if (node.argument.type === 'Identifier') writeSites.push({ id: node.argument, w: { kind: 'update' } })
        break
    }
    for (const k of kids(node)) walk(k, scope, node)
  }

  parent.set(ast, null)
  for (const st of ast.body) walk(st, root, ast)

  const lookup = (scope, name) => {
    for (let s = scope; s; s = s.up) {
      const b = s.names.get(name)
      if (b) return b
    }
    return null
  }
  const resolved = new Map()
  for (const r of idNodes) {
    if (declIds.has(r)) continue
    const b = lookup(refScope.get(r), r.name)
    if (b) {
      resolved.set(r, b)
      b.refs.push(r)
    }
  }
  for (const { id, w } of writeSites) {
    const b = lookup(refScope.get(id), id.name)
    if (b) b.writes.push(w)
  }
  return { parent, declared, bindingOf: (id) => resolved.get(id) || null }
}

function makeSizer({ parent, bindingOf }, ast) {
  const globalMember = (callee, object, props) =>
    isNamed(callee) && callee.object.type === 'Identifier' && callee.object.name === object && !bindingOf(callee.object) && props.has(callee.property.name)

  const isReadPosition = (p) => {
    const g = parent.get(p)
    switch (g.type) {
      case 'AssignmentExpression':
      case 'AssignmentPattern':
      case 'ForInStatement':
      case 'ForOfStatement':
        return g.left !== p
      case 'UpdateExpression':
      case 'ArrayPattern':
      case 'RestElement':
        return false
      case 'UnaryExpression':
        return g.operator !== 'delete'
      case 'Property':
        return parent.get(g).type !== 'ObjectPattern'
      default:
        return true
    }
  }

  const usesArguments = (node) => {
    const stack = [node]
    while (stack.length) {
      const n = stack.pop()
      if (n.type === 'Identifier' && n.name === 'arguments') return true
      for (const k of kids(n)) stack.push(k)
    }
    return false
  }

  const callbackOk = (name, call) => {
    if (!CALLBACK_METHODS.has(name)) return true
    const a = call.arguments[0]
    if (!a) return true
    let fn = null
    if (isFn(a)) fn = a
    else if (a.type === 'Identifier') {
      const b = bindingOf(a)
      if (b && b.fn && !b.multi && b.writes.length === 0) fn = b.fn
    }
    if (!fn) return false
    if (fn.type !== 'ArrowFunctionExpression' && usesArguments(fn.body)) return false
    return fn.params.length <= (name.startsWith('reduce') ? 3 : 2) && !fn.params.some((p) => p.type === 'RestElement')
  }

  const safeUse = (r) => {
    const p = parent.get(r)
    switch (p.type) {
      case 'MemberExpression': {
        if (p.object !== r) return false
        if (p.computed) return isReadPosition(p)
        const name = p.property.name
        if (name === 'length') return isReadPosition(p)
        if (!READ_METHODS.has(name)) return false
        const g = parent.get(p)
        return g.type === 'CallExpression' && g.callee === p && callbackOk(name, g)
      }
      case 'SpreadElement':
      case 'TemplateLiteral':
        return true
      case 'ForOfStatement':
        return p.right === r
      case 'CallExpression':
        return (
          p.arguments[0] === r &&
          (SAFE_ARG_CALLEES.some(([obj, props, max]) => p.arguments.length <= max && globalMember(p.callee, obj, props)) ||
            (p.callee.type === 'Identifier' && p.callee.name === 'pipeline' && !bindingOf(p.callee)))
        )
      default:
        return false
    }
  }

  const literalInt = (n) => {
    if (n.type === 'Literal') return typeof n.value === 'number' && Number.isInteger(n.value) && n.value >= 0 ? n.value : null
    if (n.type === 'Identifier') {
      const b = bindingOf(n)
      if (b && b.kind === 'const' && !b.multi && b.init && b.init.type === 'Literal') return literalInt(b.init)
    }
    return null
  }

  const isNumeric = (n, assume = new Set()) => {
    switch (n.type) {
      case 'Literal':
        return typeof n.value === 'number'
      case 'Identifier': {
        const b = bindingOf(n)
        if (!b || b.multi || !b.init || (b.kind !== 'let' && b.kind !== 'const')) return false
        if (assume.has(b)) return true
        assume.add(b)
        const ok =
          isNumeric(b.init, assume) &&
          b.writes.every((w) => {
            if (w.kind === 'update') return true
            if (w.kind !== 'assign') return false
            return w.op === '=' || w.op === '+=' ? isNumeric(w.right, assume) : w.op !== '||=' && w.op !== '&&=' && w.op !== '??='
          })
        assume.delete(b)
        return ok
      }
      case 'BinaryExpression':
        return NUMERIC_BINARY.has(n.operator) || (n.operator === '+' && isNumeric(n.left, assume) && isNumeric(n.right, assume))
      case 'UnaryExpression':
        return n.operator === '+' || n.operator === '-' || n.operator === '~'
      default:
        return false
    }
  }

  const sameExpr = (a, b) => {
    if (a.type !== b.type) return false
    switch (a.type) {
      case 'Identifier':
        return a.name === b.name
      case 'Literal':
        return a.value === b.value
      case 'BinaryExpression':
        return a.operator === b.operator && sameExpr(a.left, b.left) && sameExpr(a.right, b.right)
      case 'UnaryExpression':
        return a.operator === b.operator && sameExpr(a.argument, b.argument)
      default:
        return false
    }
  }

  const windowSize = (first, second) => {
    if (second.type !== 'BinaryExpression' || second.operator !== '+') return null
    if (!sameExpr(first, second.left) || !isNumeric(first)) return null
    return literalInt(second.right)
  }

  const shadowed = new Set()
  {
    const stack = [ast]
    while (stack.length) {
      const n = stack.pop()
      switch (n.type) {
        case 'Property':
        case 'MethodDefinition':
        case 'PropertyDefinition': {
          const k = n.key
          if (!n.computed && ((k.type === 'Identifier' && SHADOWABLE.has(k.name)) || (k.type === 'Literal' && SHADOWABLE.has(k.value)))) shadowed.add(k.name === undefined ? k.value : k.name)
          break
        }
        case 'Literal':
          if (typeof n.value === 'string' && SHADOWABLE.has(n.value)) shadowed.add(n.value)
          break
        case 'MemberExpression':
          if (!n.computed && SHADOWABLE.has(n.property.name) && !isReadPosition(n)) shadowed.add(n.property.name)
          break
      }
      for (const k of kids(n)) stack.push(k)
    }
  }

  const active = new Set()

  function sizeOf(node) {
    switch (node.type) {
      case 'ArrayExpression': {
        let n = 0
        for (const el of node.elements) n += el !== null && el.type === 'SpreadElement' ? sizeOf(el.argument) : 1
        return n
      }
      case 'Identifier': {
        const b = bindingOf(node)
        if (!b || b.kind !== 'const' || b.multi || !b.init || b.writes.length || active.has(b)) return INF
        if (!b.refs.every(safeUse)) return INF
        active.add(b)
        const n = sizeOf(b.init)
        active.delete(b)
        return n
      }
      case 'CallExpression': {
        if (node.optional || node.arguments.some((a) => a.type === 'SpreadElement')) return INF
        const c = node.callee
        if (globalMember(c, 'Array', new Set(['from'])) && node.arguments.length >= 1) return arrayLikeSize(node.arguments[0])
        if (!isNamed(c) || shadowed.has(c.property.name)) return INF
        const args = node.arguments
        switch (c.property.name) {
          case 'map':
          case 'filter':
            return args.length >= 1 ? sizeOf(c.object) : INF
          case 'slice': {
            const base = sizeOf(c.object)
            if (args.length === 1) {
              const s = literalInt(args[0])
              return s === null || base === INF ? INF : Math.max(0, base - s)
            }
            if (args.length === 2) {
              const s = literalInt(args[0])
              const e = literalInt(args[1])
              if (s !== null && e !== null) return Math.min(Math.max(0, e - s), Math.max(0, base - s))
              const k = windowSize(args[0], args[1])
              if (k !== null) return Math.min(k, base)
            }
            return INF
          }
          default:
            return INF
        }
      }
      default:
        return INF
    }
  }

  function arrayLikeSize(node) {
    if (node.type === 'ObjectExpression') {
      const p = node.properties
      if (p.length !== 1 || p[0].type !== 'Property' || p[0].computed || p[0].kind !== 'init' || p[0].method) return INF
      const key = p[0].key
      if (!(key.type === 'Identifier' ? key.name === 'length' : key.type === 'Literal' && key.value === 'length')) return INF
      const n = literalInt(p[0].value)
      return n === null ? INF : n
    }
    return sizeOf(node)
  }

  return { sizeOf, arrayLikeSize, shadowed }
}

function describe(node) {
  switch (node.type) {
    case 'Identifier':
      return node.name
    case 'MemberExpression':
      return node.computed ? `${describe(node.object)}[...]` : `${describe(node.object)}.${node.property.name}`
    case 'CallExpression':
      return `${describe(node.callee)}(...)`
    case 'AwaitExpression':
      return `await ${describe(node.argument)}`
    default:
      return 'the list'
  }
}

function seq(list) {
  let o = 0
  let a = 0
  const reach = new Set()
  for (const r of list) {
    if (r.o > o) o = r.o
    if (r.a > a) a = r.a
    for (const i of r.reach) reach.add(i)
  }
  return list.length === 0 ? ZERO : { o, a, reach }
}

function par(list) {
  let o = 0
  let a = 0
  const reach = new Set()
  for (const r of list) {
    o += r.o
    a += r.a
    for (const i of r.reach) reach.add(i)
  }
  return list.length === 0 ? ZERO : { o, a, reach }
}

const times = (r, n) => ({ o: mul(n, r.o), a: mul(n, r.a), reach: r.reach })

function evaluate(ast, calls, isOpus, scopes, sizer, sink) {
  const { bindingOf, declared } = scopes
  const { sizeOf, arrayLikeSize, shadowed } = sizer
  const callIndex = new Map(calls.map((c, i) => [c, i]))
  const reached = new Set()
  const memo = new Map()
  const visiting = new Set()
  const callsInCache = new Map()
  let retMode = 'call'

  const callsIn = (node) => {
    let r = callsInCache.get(node)
    if (!r) {
      r = []
      calls.forEach((c, i) => {
        if (c.start >= node.start && c.end <= node.end) r.push(i)
      })
      callsInCache.set(node, r)
    }
    return r
  }

  function escaped(idx, why) {
    const op = idx.filter((i) => isOpus[i])
    if (op.length) sink.unknowns.push({ why, stages: op })
    return { o: op.length ? INF : 0, a: idx.length ? INF : 0, reach: new Set() }
  }

  const unconsumed = (r, why) => (r.o === 0 && r.a === 0 ? r : seq([r, escaped([...r.reach], why)]))
  const opusIn = (r) => [...r.reach].filter((i) => isOpus[i])
  const unknownSize = (n, body, source) => {
    if (n === INF && body.o > 0) sink.unknowns.push({ why: `the size of ${describe(source)} is not known`, stages: opusIn(body) })
  }

  const knownFn = (id) => {
    const b = bindingOf(id)
    return b && b.fn && !b.multi && b.writes.length === 0 ? b.fn : null
  }
  const fnNodeOf = (n) => (isFn(n) ? n : n.type === 'Identifier' ? knownFn(n) : null)
  const reachCache = new Map()
  const reachIn = (fn) => {
    let r = reachCache.get(fn)
    if (r) return r
    const seen = new Set([fn])
    const queue = [fn]
    const out = new Set()
    while (queue.length) {
      const f = queue.pop()
      for (const i of callsIn(f)) out.add(i)
      const stack = [f]
      while (stack.length) {
        const n = stack.pop()
        if (n.type === 'Identifier') {
          const b = bindingOf(n)
          if (b && b.fn && !seen.has(b.fn)) {
            seen.add(b.fn)
            queue.push(b.fn)
          }
        }
        for (const k of kids(n)) stack.push(k)
      }
    }
    r = [...out]
    reachCache.set(fn, r)
    return r
  }
  const fnValue = (fn) => escaped(reachIn(fn), 'an opus agent() is inside a function that is used as a value')
  const generic = (node) => seq(kids(node).map((k) => ev(k, false)))

  function combinatorKind(c) {
    if (c.type === 'Identifier' && !bindingOf(c)) {
      if (c.name === 'parallel' || c.name === 'pipeline') return c.name
    }
    if (isNamed(c) && c.object.type === 'Identifier' && c.object.name === 'Promise' && !bindingOf(c.object)) {
      if (ALL.has(c.property.name)) return 'all'
      if (RACE.has(c.property.name)) return 'race'
    }
    return null
  }

  function isPromiseSource(x) {
    if (x.type !== 'CallExpression' || x.optional) return false
    if (callIndex.has(x) || combinatorKind(x.callee)) return true
    const c = x.callee
    if (isNamed(c) && THEN.has(c.property.name)) return isPromiseSource(c.object)
    const fn = fnNodeOf(c)
    return !!fn && fn.async === true && !fn.generator
  }

  function runFn(fn, mode) {
    if (fn.generator) return escaped(reachIn(fn), 'an opus agent() is inside a generator function')
    let m = memo.get(fn)
    if (!m) memo.set(fn, (m = {}))
    if (m[mode]) return m[mode]
    if (visiting.has(fn)) return escaped(reachIn(fn), 'a function that runs opus agents calls itself')
    visiting.add(fn)
    const saved = retMode
    retMode = mode
    let r
    try {
      if (fn.body.type === 'BlockStatement') r = ev(fn.body, false)
      else r = mode === 'make' ? thunkValue(fn.body) : ev(fn.body, true)
    } finally {
      retMode = saved
      visiting.delete(fn)
    }
    m[mode] = r
    return r
  }

  function thunkValue(node) {
    if (node.type === 'ConditionalExpression') return seq([ev(node.test, false), thunkValue(node.consequent), thunkValue(node.alternate)])
    const fn = fnNodeOf(node)
    return fn && !fn.generator ? runFn(fn, 'call') : ev(node, false)
  }

  const thunkMaker = (cb) => {
    const fn = fnNodeOf(cb)
    return fn && !fn.async && !fn.generator ? runFn(fn, 'make') : ev(cb, false)
  }

  const promiseMaker = (cb) => {
    const fn = fnNodeOf(cb)
    return fn && !fn.generator ? runFn(fn, 'call') : ev(cb, false)
  }

  function mapForm(A) {
    if (A.type !== 'CallExpression' || A.optional || A.arguments.some((x) => x.type === 'SpreadElement')) return null
    const c = A.callee
    if (!isNamed(c)) return null
    const name = c.property.name
    if ((name === 'map' || name === 'flatMap') && A.arguments.length === 1 && !shadowed.has(name)) {
      return { source: c.object, cb: A.arguments[0], size: () => sizeOf(c.object) }
    }
    if (name === 'from' && c.object.type === 'Identifier' && c.object.name === 'Array' && !bindingOf(c.object) && A.arguments.length === 2) {
      return { source: A.arguments[0], cb: A.arguments[1], size: () => arrayLikeSize(A.arguments[0]) }
    }
    return null
  }

  function evList(A, kind) {
    if (A.type === 'ArrayExpression') {
      const parts = []
      const pre = []
      for (const el of A.elements) {
        if (el === null) continue
        if (el.type === 'SpreadElement') {
          const s = evList(el.argument, kind)
          parts.push(s.conc)
          pre.push(s.pre)
        } else {
          parts.push(kind === 'thunk' ? thunkValue(el) : ev(el, true))
        }
      }
      return { conc: par(parts), pre: seq(pre) }
    }
    const m = mapForm(A)
    if (m) {
      const pre = ev(m.source, false)
      const n = m.size()
      const body = kind === 'thunk' ? thunkMaker(m.cb) : promiseMaker(m.cb)
      unknownSize(n, body, m.source)
      return { conc: times(body, n), pre }
    }
    return { conc: ev(A, false), pre: ZERO }
  }

  function evParallelLike(node, kind, name, race) {
    const [first, ...rest] = node.arguments
    const restR = rest.map((a) => ev(a, false))
    if (!first) return seq(restR)
    if (first.type === 'SpreadElement') return seq([ev(first.argument, false), ...restR])
    const { conc, pre } = evList(first, kind)
    let r = conc
    const single = first.type === 'ArrayExpression' && first.elements.length === 1 && first.elements[0] !== null && first.elements[0].type !== 'SpreadElement'
    sink.constructs.push(r)
    if (race && !single) {
      const why = name === 'all' ? 'Promise.all leaves the other agents running when one fails' : `Promise.${name} leaves the other agents running`
      r = seq([r, escaped([...conc.reach], why)])
    }
    return seq([...restR, pre, r])
  }

  function evPipeline(node) {
    const [X, ...stageArgs] = node.arguments
    if (!X || X.type === 'SpreadElement' || stageArgs.length === 0 || stageArgs.some((s) => s.type === 'SpreadElement')) return generic(node)
    const pre = ev(X, false)
    const n = sizeOf(X)
    const body = seq(stageArgs.map(thunkValue))
    unknownSize(n, body, X)
    const r = times(body, n)
    sink.constructs.push(r)
    return seq([pre, r])
  }

  function evAgent(node, idx, consumed) {
    reached.add(idx)
    const inner = seq(node.arguments.map((a) => ev(a, false)))
    const r = seq([inner, { o: isOpus[idx] ? 1 : 0, a: 1, reach: new Set([idx]) }])
    return consumed ? r : seq([r, escaped([idx], 'an opus agent() call is neither awaited nor returned')])
  }

  function evCall(node, consumed) {
    const idx = callIndex.get(node)
    if (idx !== undefined) return evAgent(node, idx, consumed)
    if (node.optional) return generic(node)
    const c = node.callee
    const kind = combinatorKind(c)
    if (kind) {
      const r = kind === 'pipeline' ? evPipeline(node) : evParallelLike(node, kind === 'parallel' ? 'thunk' : 'promise', isNamed(c) ? c.property.name : '', kind === 'race')
      return consumed ? r : unconsumed(r, 'the opus agents started here are neither awaited nor returned')
    }
    if (isNamed(c) && THEN.has(c.property.name) && isPromiseSource(c.object)) {
      const r = seq([ev(c.object, true), ...node.arguments.map(thunkValue)])
      return consumed ? r : unconsumed(r, 'the opus agents started here are neither awaited nor returned')
    }
    const fn = fnNodeOf(c)
    if (fn && !fn.generator) {
      const r = seq([...node.arguments.map((a) => ev(a, false)), runFn(fn, 'call')])
      return consumed ? r : unconsumed(r, 'the opus agents started by this call are neither awaited nor returned')
    }
    return generic(node)
  }

  function evDecl(node) {
    return seq(
      node.declarations.map((d) => {
        const b = declared.get(d.id)
        if (d.init && b && d.id.type === 'Identifier' && b.fn === d.init && !b.multi && b.writes.length === 0) return ZERO
        return seq([ev(d.id, false), d.init ? ev(d.init, false) : ZERO])
      })
    )
  }

  function ev(node, consumed) {
    switch (node.type) {
      case 'AwaitExpression':
        return ev(node.argument, true)
      case 'ConditionalExpression':
        return seq([ev(node.test, false), ev(node.consequent, consumed), ev(node.alternate, consumed)])
      case 'LogicalExpression':
        return seq([ev(node.left, consumed), ev(node.right, consumed)])
      case 'SequenceExpression':
        return seq(node.expressions.map((e, i) => ev(e, consumed && i === node.expressions.length - 1)))
      case 'ChainExpression':
        return ev(node.expression, consumed)
      case 'CallExpression':
        return evCall(node, consumed)
      case 'ReturnStatement':
        if (!node.argument) return ZERO
        return retMode === 'make' ? thunkValue(node.argument) : ev(node.argument, true)
      case 'FunctionDeclaration':
        return ZERO
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        return fnValue(node)
      case 'Identifier': {
        const fn = knownFn(node)
        return fn ? fnValue(fn) : ZERO
      }
      case 'VariableDeclaration':
        return evDecl(node)
      default:
        return generic(node)
    }
  }

  const top = ev(ast, false)
  const lost = []
  calls.forEach((_, i) => {
    if (!reached.has(i)) lost.push(escaped([i], 'an opus agent() call cannot be traced to where it runs'))
  })
  return seq([top, ...lost])
}

const overLimit = (n, limit) =>
  `Up to ${n} opus agents can run at once here; the limit is ${limit}. Keep at most the ${limit} most complex on opus and run the rest on sonnet (items.slice(0, ${limit}) on opus, items.slice(${limit}) on sonnet), or batch them: for (let i = 0; i < items.length; i += ${limit}) await parallel(items.slice(i, i + ${limit}).map(...)).`

const unknownCount = (why, limit) =>
  `ultraguard cannot count how many opus agents run at once here (${why}). Give the opus part a literal list, a const array literal, Array.from({ length: N }), .slice(0, N) or .slice(i, i + N) with N at most ${limit}, or await the opus agents one at a time.`

export function fanout(ast, calls, stages, limits) {
  const cap = limits.maxConcurrentOpus
  const bigAt = limits.bigFanout
  const isOpus = calls.map((_, i) => stages[i].model !== 'sonnet' && stages[i].model !== 'haiku')
  const flags = calls.map(() => ({ inFanout: false, bigFanout: false }))
  if (calls.length === 0 || !ast) return { maxOpus: 0, maxAll: 0, stages: flags, errors: [] }

  const sink = { unknowns: [], constructs: [] }
  let top
  try {
    const scopes = analyzeScopes(ast)
    top = evaluate(ast, calls, isOpus, scopes, makeSizer(scopes, ast), sink)
  } catch {
    const all = calls.map((_, i) => i)
    sink.unknowns = [{ why: 'ultraguard could not analyse the script', stages: all.filter((i) => isOpus[i]) }]
    sink.constructs = []
    top = { o: sink.unknowns[0].stages.length ? INF : 0, a: INF, reach: new Set() }
  }

  for (const c of sink.constructs) {
    if (c.a <= 1) continue
    for (const i of c.reach) {
      flags[i].inFanout = true
      if (c.a > bigAt) flags[i].bigFanout = true
    }
  }

  const reasons = new Map()
  if (top.o > cap) {
    if (top.o === INF) {
      for (const u of sink.unknowns) for (const i of u.stages) if (!reasons.has(i)) reasons.set(i, unknownCount(u.why, cap))
    } else {
      const worst = new Map()
      for (const c of sink.constructs) {
        if (c.o <= cap || c.o === INF) continue
        for (const i of c.reach) if (isOpus[i]) worst.set(i, Math.max(worst.get(i) || 0, c.o))
      }
      for (const [i, n] of worst) reasons.set(i, overLimit(n, cap))
    }
    if (reasons.size === 0) {
      for (let i = 0; i < calls.length; i++) {
        if (isOpus[i]) reasons.set(i, top.o === INF ? unknownCount('the shape of the script', cap) : overLimit(top.o, cap))
      }
    }
  }
  const errors = [...reasons.keys()]
    .sort((x, y) => x - y)
    .map((i) => ({
      code: 'FANOUT',
      line: stages[i].line === undefined ? null : stages[i].line,
      label: stages[i].label === undefined ? null : stages[i].label,
      message: reasons.get(i),
      stage: i
    }))
  return { maxOpus: top.o, maxAll: top.a, stages: flags, errors }
}
