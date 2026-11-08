import { openSync, readSync, fstatSync, closeSync } from 'node:fs'

const CHUNK = 64 * 1024
const TOKENS = ['opus', 'sonnet', 'haiku', 'fable']
const RANK = { haiku: 0, sonnet: 1, opus: 2 }
const MODEL_CMD = '<command-name>/model</command-name>'
const STDOUT_OK_RE = /^<local-command-stdout>\s*Set model to\b/
const ARGS_RE = /<command-args>([\s\S]*?)<\/command-args>/

function mapModel(id) {
  if (typeof id !== 'string') return null
  const lower = id.toLowerCase()
  const hits = TOKENS.filter((t) => lower.includes(t))
  if (hits.length !== 1) return null
  return hits[0] === 'fable' ? 'opus' : hits[0]
}

function mapCommand(arg) {
  if (typeof arg === 'string' && /^opusplan(\[1m\])?$/i.test(arg.trim())) return 'sonnet'
  return mapModel(arg)
}

function* reverseLines(fd) {
  let pos = fstatSync(fd).size
  let buf = Buffer.alloc(0)
  while (pos > 0) {
    const len = Math.min(CHUNK, pos)
    pos -= len
    const chunk = Buffer.alloc(len)
    readSync(fd, chunk, 0, len, pos)
    buf = Buffer.concat([chunk, buf])
    let lines = buf
    if (pos > 0) {
      const nl = buf.indexOf(0x0a)
      if (nl === -1) continue
      lines = buf.subarray(nl + 1)
      buf = buf.subarray(0, nl)
    } else {
      buf = Buffer.alloc(0)
    }
    const parts = lines.toString('utf8').split('\n')
    for (let i = parts.length - 1; i >= 0; i--) yield parts[i]
  }
}

function parse(line) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function isMain(o) {
  return o.isSidechain !== true && o.agentId === undefined
}

function isMainRequest(o) {
  const qs = o.querySource
  return (
    isMain(o) &&
    typeof qs === 'string' &&
    (qs.startsWith('repl_main_thread') || qs === 'sdk') &&
    typeof (o.params && o.params.model) === 'string'
  )
}

function contentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((b) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('\n')
}

function rowText(o) {
  return contentText(o.message && o.message.content)
}

function modelCommandArg(o) {
  const text = rowText(o)
  if (!text.includes(MODEL_CMD)) return undefined
  const m = ARGS_RE.exec(text)
  return m ? m[1].trim() : ''
}

function scan(fd) {
  let request
  let command
  let confirmed = false
  for (const line of reverseLines(fd)) {
    let o
    if (line.includes('"assistant"')) {
      o = parse(line)
      if (o && o.type === 'assistant' && isMain(o)) {
        return { assistant: o, request, command }
      }
    }
    if (request === undefined && line.includes('"api-request"')) {
      o = o || parse(line)
      if (o && o.type === 'api-request' && isMainRequest(o)) request = o
    }
    if (command === undefined && line.includes('"user"')) {
      o = o || parse(line)
      if (o && o.type === 'user' && isMain(o)) {
        const arg = modelCommandArg(o)
        if (arg !== undefined) {
          if (confirmed) command = arg
          confirmed = false
        } else {
          confirmed = STDOUT_OK_RE.test(rowText(o).trimStart())
        }
      }
    }
  }
  return { assistant: undefined, request, command }
}

function lowerTier(a, b) {
  if (a === null || b === null) return null
  return RANK[a] <= RANK[b] ? a : b
}

export function sessionModel(transcriptPath) {
  if (typeof transcriptPath !== 'string' || transcriptPath === '') return null
  let fd
  try {
    fd = openSync(transcriptPath, 'r')
    const { assistant, request, command } = scan(fd)
    if (request) return mapModel(request.params.model)
    const served = assistant ? mapModel(assistant.message && assistant.message.model) : null
    if (command === undefined) return served
    const mapped = mapCommand(command)
    if (served === null) return mapped === 'haiku' ? 'haiku' : null
    return lowerTier(served, mapped)
  } catch {
    return null
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {}
    }
  }
}
