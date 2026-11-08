export const meta = {
  name: 'verify-release-notes',
  description: 'Build the release notes, then ask a yes/no question per claim on sonnet and one complex review on opus',
  phases: [
    { title: 'Build', detail: 'one build agent' },
    { title: 'Verify', detail: 'a yes/no verdict, then a full review' }
  ]
}

phase('Build')
const notes = await agent('Write the release notes for the commits since the last tag into RELEASE_NOTES.md.', {
  label: 'build: release notes',
  phase: 'Build',
  model: 'sonnet',
  effort: 'high',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
    },
    required: ['path', 'blocked_on']
  }
})

phase('Verify')
const verdict = await agent(`Does ${notes ? notes.path : 'RELEASE_NOTES.md'} mention every breaking change since the last tag? Answer pass: true or false.`, {
  label: 'judge: every breaking change is listed',
  phase: 'Verify',
  model: 'sonnet',
  effort: 'high',
  schema: {
    type: 'object',
    properties: {
      pass: { type: 'boolean' },
      evidence: { type: 'string', description: 'The commit or line that decided the verdict' },
      blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
    },
    required: ['pass', 'evidence', 'blocked_on']
  }
})

return agent(`Review the release notes for accuracy, tone and omissions against the commit history.\n\nQuick check: ${JSON.stringify(verdict)}`, {
  label: 'judge: release notes review',
  phase: 'Verify',
  model: 'opus',
  effort: 'high'
})
