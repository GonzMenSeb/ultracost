export const RECORD_VERSION = 1
export const ID_RE = /^[A-Za-z0-9_-]{1,128}$/

export function recordPath(configDir, sessionId, id, kind) {
  if (typeof configDir !== 'string' || configDir === '') return null
  if (kind !== 'gate' && kind !== 'eval') return null
  if (typeof id !== 'string' || !ID_RE.test(id)) return null
  const session = typeof sessionId === 'string' && ID_RE.test(sessionId) ? sessionId : 'unknown'
  return `${configDir.replace(/[\\/]+$/, '')}/ultraguard/sessions/${session}/${id}.${kind}.json`
}
