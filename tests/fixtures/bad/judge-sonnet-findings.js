export const meta = {
  name: 'review-findings-on-sonnet',
  description: 'A judge on sonnet that returns a findings list, which only opus may do',
  phases: [{ title: 'Review', detail: 'one reviewer' }]
}

phase('Review')
return agent('Review the current git diff and list every problem with file and line.', {
  label: 'judge: diff review',
  phase: 'Review',
  model: 'sonnet',
  effort: 'high',
  schema: {
    type: 'object',
    properties: {
      findings: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, problem: { type: 'string' } } } },
      blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
    },
    required: ['findings', 'blocked_on']
  }
})
