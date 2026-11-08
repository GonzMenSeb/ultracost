const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

const FIX = 'Ask the user to remove it and restart Claude Code; do not relaunch until then.'
const msg = (name, what) => `${name} is set in the environment or a settings env block and overrides ${what}. ${FIX}`

const err = (message) => ({ code: 'ENV', line: null, label: null, message, stage: null })

export function env(environ) {
  const errors = []
  const wf = environ.CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL
  const wfv = wf === undefined || wf === null ? '' : String(wf).trim().toLowerCase()
  if (wfv !== '' && wfv !== 'inherit') {
    errors.push(err(msg('CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL', 'every agent() model')))
  }
  const force = environ.CLAUDE_CODE_SUBAGENT_MODEL_FORCE
  if (force !== undefined && force !== null && TRUTHY.has(String(force).toLowerCase().trim())) {
    errors.push(err(msg('CLAUDE_CODE_SUBAGENT_MODEL_FORCE', 'every agent() model')))
  }
  const effort = environ.CLAUDE_CODE_EFFORT_LEVEL
  if (effort !== undefined && effort !== null && String(effort).trim() !== '') {
    errors.push(err(msg('CLAUDE_CODE_EFFORT_LEVEL', 'every agent() effort (even the values auto and unset)')))
  }
  return errors
}
